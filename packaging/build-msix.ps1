[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$SourceZip,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^(?!TODO_PARTNER_CENTER_IDENTITY_NAME$).+$')]
    [string]$IdentityName,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^CN=.+')]
    [string]$Publisher,

    [string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist')
)

$ErrorActionPreference = 'Stop'

function Find-MakeAppx {
    $kitsRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    if (-not (Test-Path $kitsRoot)) {
        throw 'Windows SDK was not found under Program Files (x86)\\Windows Kits\\10\\bin.'
    }

    $candidates = Get-ChildItem -Path $kitsRoot -Directory -ErrorAction Stop |
        ForEach-Object {
            $makeAppx = Join-Path $_.FullName 'x64\makeappx.exe'
            if (Test-Path $makeAppx) {
                [PSCustomObject]@{ Version = [version]$_.Name; Path = $makeAppx }
            }
        } |
        Sort-Object Version -Descending

    if (-not $candidates) {
        throw 'MakeAppx.exe was not found in an installed Windows SDK.'
    }
    return $candidates[0].Path
}

if (-not (Test-Path -LiteralPath $SourceZip -PathType Leaf)) {
    throw "Windows distribution ZIP not found: $SourceZip"
}

$manifestPath = Join-Path $PSScriptRoot 'AppxManifest.xml'
$assetPaths = @(
    (Join-Path $PSScriptRoot 'Assets\Square44x44Logo.png'),
    (Join-Path $PSScriptRoot 'Assets\Square150x150Logo.png'),
    (Join-Path $PSScriptRoot 'Assets\StoreLogo.png')
)
@($manifestPath) + $assetPaths | ForEach-Object {
    if (-not (Test-Path -LiteralPath $_ -PathType Leaf)) { throw "Required packaging file is missing: $_" }
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw
if ($manifest -notmatch 'TODO_PARTNER_CENTER_IDENTITY_NAME|TODO_PARTNER_CENTER_PUBLISHER') {
    throw 'The packaging manifest must retain its Partner Center TODO placeholders.'
}
$manifest = $manifest.Replace('TODO_PARTNER_CENTER_IDENTITY_NAME', $IdentityName).Replace('TODO_PARTNER_CENTER_PUBLISHER', $Publisher)

$packageVersion = ([xml]$manifest).Package.Identity.Version
if ($packageVersion -notmatch '^\d+\.\d+\.\d+\.\d+$') {
    throw "Manifest Version is invalid: $packageVersion"
}

$workRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("TradeJournalFree-MSIX-" + [guid]::NewGuid().ToString('N'))
$stageRoot = Join-Path $workRoot 'stage'
try {
    New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
    Expand-Archive -LiteralPath $SourceZip -DestinationPath $workRoot -Force
    $distribution = @(
        @{ Root = 'Trade Journal'; Executable = 'Trade Journal.exe' },
        @{ Root = 'Trade Journal Free'; Executable = 'Trade Journal Free.exe' }
    ) | ForEach-Object {
        $root = Join-Path $workRoot $_.Root
        $exe = Join-Path $root $_.Executable
        $internal = Join-Path $root '_internal'
        if ((Test-Path -LiteralPath $exe -PathType Leaf) -and (Test-Path -LiteralPath $internal -PathType Container)) {
            [PSCustomObject]@{ Root = $root; Executable = $exe }
        }
    } | Select-Object -First 1
    if (-not $distribution) {
        throw 'The ZIP does not contain a supported distribution layout: Trade Journal/Trade Journal.exe or Trade Journal Free/Trade Journal Free.exe with _internal/.'
    }
    $distributionRoot = $distribution.Root

    Get-ChildItem -LiteralPath $distributionRoot -Force | Copy-Item -Destination $stageRoot -Recurse -Force
    New-Item -ItemType Directory -Path (Join-Path $stageRoot 'Assets') -Force | Out-Null
    Copy-Item -LiteralPath $assetPaths -Destination (Join-Path $stageRoot 'Assets') -Force
    [System.IO.File]::WriteAllText(
        (Join-Path $stageRoot 'AppxManifest.xml'),
        $manifest,
        (New-Object System.Text.UTF8Encoding($false))
    )

    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $outputMsix = Join-Path $OutputDirectory ("Trade-Journal-Free-$packageVersion-x64.msix")
    if (Test-Path -LiteralPath $outputMsix) { Remove-Item -LiteralPath $outputMsix -Force }
    $makeAppx = Find-MakeAppx
    & $makeAppx pack /d $stageRoot /p $outputMsix /o
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outputMsix -PathType Leaf)) {
        throw 'MakeAppx.exe did not produce an MSIX package.'
    }
    Write-Host "Created: $outputMsix"
}
finally {
    if (Test-Path -LiteralPath $workRoot) { Remove-Item -LiteralPath $workRoot -Recurse -Force }
}
