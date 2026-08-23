# Sign and verify the desktop executable with an Authenticode PFX certificate.
# GitHub Actions receives the PFX as base64 through a repository secret.

param(
    [Parameter(Mandatory = $true)]
    [string]$AppDirectory,
    [string]$TimestampUrl = $(if ($env:WINDOWS_TIMESTAMP_URL) { $env:WINDOWS_TIMESTAMP_URL } else { "http://timestamp.digicert.com" })
)

$ErrorActionPreference = "Stop"
$Required = $env:WINDOWS_SIGNING_REQUIRED -eq "true"
$CertificatePath = $env:WINDOWS_CERTIFICATE_PATH
$CertificatePassword = $env:WINDOWS_CERTIFICATE_PASSWORD
$TemporaryCertificate = $null

try {
    if ($env:WINDOWS_CERTIFICATE_BASE64) {
        if (-not $CertificatePassword) {
            throw "WINDOWS_CERTIFICATE_PASSWORD is required when WINDOWS_CERTIFICATE_BASE64 is configured."
        }
        $TemporaryDirectory = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
        $TemporaryCertificate = Join-Path $TemporaryDirectory "trade-journal-signing.pfx"
        [System.IO.File]::WriteAllBytes(
            $TemporaryCertificate,
            [System.Convert]::FromBase64String($env:WINDOWS_CERTIFICATE_BASE64)
        )
        $CertificatePath = $TemporaryCertificate
    }

    if (-not $CertificatePath -or -not (Test-Path $CertificatePath)) {
        if ($Required) {
            throw "Windows signing is required, but no PFX certificate was configured."
        }
        Write-Warning "Windows package is unsigned. Configure the signing secrets before public distribution."
        return
    }
    if (-not $CertificatePassword) {
        throw "WINDOWS_CERTIFICATE_PASSWORD is required when a PFX certificate is configured."
    }

    $Executable = Join-Path $AppDirectory "Trade Journal.exe"
    if (-not (Test-Path $Executable)) {
        throw "Windows executable was not found: $Executable"
    }

    $SignTool = Get-ChildItem -Path @(
        "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
        "$env:ProgramFiles\Windows Kits\10\bin"
    ) -Filter "signtool.exe" -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "\\x64\\" } |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if (-not $SignTool) {
        throw "signtool.exe was not found on this Windows machine."
    }

    & $SignTool.FullName sign /fd SHA256 /f $CertificatePath /p $CertificatePassword /tr $TimestampUrl /td SHA256 /v $Executable
    if ($LASTEXITCODE -ne 0) {
        throw "Authenticode signing failed."
    }
    & $SignTool.FullName verify /pa /v $Executable
    if ($LASTEXITCODE -ne 0) {
        throw "Authenticode signature verification failed."
    }
    Write-Host "Signed and verified: $Executable"
} finally {
    if ($TemporaryCertificate -and (Test-Path $TemporaryCertificate)) {
        Remove-Item -Force $TemporaryCertificate
    }
}
