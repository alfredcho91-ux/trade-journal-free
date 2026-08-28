[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$MsixPath,

    [string]$IdentityName,
    [string]$Publisher,
    [string]$Version = '1.0.23.0'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $MsixPath -PathType Leaf)) {
    throw "MSIX package not found: $MsixPath"
}
if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw "Expected Version is invalid: $Version" }

$workRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("TradeJournalFree-MSIX-validate-" + [guid]::NewGuid().ToString('N'))
try {
    Expand-Archive -LiteralPath $MsixPath -DestinationPath $workRoot -Force
    $manifestPath = Join-Path $workRoot 'AppxManifest.xml'
    $exePath = Join-Path $workRoot 'Trade Journal Free.exe'
    $requiredFiles = @(
        $manifestPath,
        $exePath,
        (Join-Path $workRoot '_internal'),
        (Join-Path $workRoot 'Assets\Square44x44Logo.png'),
        (Join-Path $workRoot 'Assets\Square150x150Logo.png'),
        (Join-Path $workRoot 'Assets\StoreLogo.png')
    )
    $requiredFiles | ForEach-Object {
        if (-not (Test-Path -LiteralPath $_)) { throw "Required MSIX content is missing: $_" }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $workRoot '_internal\frontend') -PathType Container)) {
        throw 'The required _internal\\frontend static bundle is missing.'
    }

    [xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
    $ns = New-Object System.Xml.XmlNamespaceManager($manifest.NameTable)
    $ns.AddNamespace('f', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
    $identity = $manifest.SelectSingleNode('/f:Package/f:Identity', $ns)
    $application = $manifest.SelectSingleNode('/f:Package/f:Applications/f:Application', $ns)
    if ($identity.Name -match '^TODO_' -or $identity.Publisher -match '^TODO_') { throw 'Manifest still contains an Identity TODO placeholder.' }
    if ($identity.Version -ne $Version) { throw "Version mismatch. Expected $Version, found $($identity.Version)." }
    if ($IdentityName -and $identity.Name -ne $IdentityName) { throw "Identity Name mismatch. Expected $IdentityName, found $($identity.Name)." }
    if ($Publisher -and $identity.Publisher -ne $Publisher) { throw "Publisher mismatch. Expected $Publisher, found $($identity.Publisher)." }
    if ($application.Executable -ne 'Trade Journal Free.exe') { throw "Unexpected executable: $($application.Executable)" }
    if ($identity.ProcessorArchitecture -ne 'x64') { throw "Unexpected architecture: $($identity.ProcessorArchitecture)" }
    Write-Host "Validated: $MsixPath"
    Write-Host "Identity: $($identity.Name) / $($identity.Publisher) / $($identity.Version)"
}
finally {
    if (Test-Path -LiteralPath $workRoot) { Remove-Item -LiteralPath $workRoot -Recurse -Force }
}
