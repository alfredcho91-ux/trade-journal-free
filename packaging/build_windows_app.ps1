# Build a local-only Windows desktop distribution.
# Run in PowerShell on the Windows CPU architecture you intend to support.

$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $PSScriptRoot
$PythonBin = if ($env:PYTHON_BIN) { $env:PYTHON_BIN } else { Join-Path $ProjectDir "backend\venv\Scripts\python.exe" }
$FrontendDir = Join-Path $ProjectDir "frontend"
$ReleaseDir = if ($env:TRADE_JOURNAL_RELEASE_DIR) { $env:TRADE_JOURNAL_RELEASE_DIR } else { Join-Path $ProjectDir "Windows" }
$ReleaseDir = [IO.Path]::GetFullPath($ReleaseDir)
$BuildRoot = [IO.Path]::GetFullPath((Join-Path $ProjectDir ".cache\windows-build"))
$WindowsAppDir = [IO.Path]::GetFullPath((Join-Path $ReleaseDir "Trade Journal"))
$ArchivePath = Join-Path $ReleaseDir "Trade-Journal-Windows.zip"

function Remove-GeneratedDirectory([string]$Target, [string]$ParentDir) {
    $ResolvedTarget = [IO.Path]::GetFullPath($Target)
    $AllowedPrefix = [IO.Path]::GetFullPath($ParentDir).TrimEnd('\') + '\'
    if (-not $ResolvedTarget.StartsWith($AllowedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a directory outside the generated output parent: $ResolvedTarget"
    }
    if (Test-Path -LiteralPath $ResolvedTarget) {
        Remove-Item -LiteralPath $ResolvedTarget -Recurse -Force
    }
}

if ($env:PYTHON_BIN) {
    if (-not (Get-Command $PythonBin -ErrorAction SilentlyContinue)) {
        throw "Configured Python command was not found: $PythonBin"
    }
} elseif (-not (Test-Path $PythonBin)) {
    throw "Missing backend virtual environment. Run the Windows bootstrap setup first."
}

if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
    throw "Missing frontend dependencies. Install them before packaging."
}

& $PythonBin -m PyInstaller --version *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Missing PyInstaller. Install it with: $PythonBin -m pip install -r packaging\requirements-build.txt"
}
& $PythonBin -c "import webview; import webview.platforms.edgechromium"
if ($LASTEXITCODE -ne 0) {
    throw "Missing Windows webview dependencies. Install packaging\requirements-build.txt."
}

Push-Location $FrontendDir
try {
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }
} finally {
    Pop-Location
}

Remove-GeneratedDirectory $BuildRoot (Join-Path $ProjectDir ".cache")
New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null

Push-Location $ProjectDir
try {
    & $PythonBin -m PyInstaller `
        --noconfirm `
        --clean `
        --windowed `
        --onedir `
        --name "Trade Journal" `
        --distpath "$BuildRoot\dist" `
        --workpath "$BuildRoot\work" `
        --specpath $BuildRoot `
        --paths $ProjectDir `
        --add-data "$ProjectDir\frontend\dist;frontend\dist" `
        --hidden-import ccxt.binance `
        --hidden-import ccxt.binanceusdm `
        --hidden-import ccxt.bybit `
        --hidden-import ccxt.okx `
        --hidden-import keyring.backends.Windows `
        --hidden-import webview.platforms.winforms `
        --hidden-import webview.platforms.edgechromium `
        --exclude-module pytest `
        --exclude-module _pytest `
        --collect-all diskcache `
        --collect-all cryptography `
        --collect-all orjson `
        --collect-all uvicorn `
        --collect-all webview `
        --collect-all pythonnet `
        --collect-all clr_loader `
        "$ProjectDir\packaging\desktop_entry.py"
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed." }
} finally {
    Pop-Location
}

$BuiltAppDir = [IO.Path]::GetFullPath((Join-Path $BuildRoot "dist\Trade Journal"))
if (-not $BuiltAppDir.StartsWith($BuildRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
    -not $WindowsAppDir.StartsWith($ReleaseDir.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Invalid generated distribution paths."
}
Remove-GeneratedDirectory $WindowsAppDir $ReleaseDir
Move-Item -LiteralPath $BuiltAppDir -Destination $WindowsAppDir
$DocsDir = Join-Path $WindowsAppDir "docs"
New-Item -ItemType Directory -Path $DocsDir -Force | Out-Null
Copy-Item (Join-Path $PSScriptRoot "docs\API-CONNECTION-KO.md") $DocsDir -Force
Copy-Item (Join-Path $PSScriptRoot "docs\API-CONNECTION-EN.md") $DocsDir -Force
Copy-Item (Join-Path $PSScriptRoot "docs\WINDOWS-GUIDE-KO.md") $DocsDir -Force
Copy-Item (Join-Path $PSScriptRoot "docs\WINDOWS-GUIDE-EN.md") $DocsDir -Force

& (Join-Path $PSScriptRoot "sign_windows_artifact.ps1") -AppDirectory $WindowsAppDir

Compress-Archive -Path $WindowsAppDir -DestinationPath $ArchivePath -Force
Write-Host "Created: $ArchivePath"
