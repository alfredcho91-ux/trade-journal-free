# Build a local-only Windows desktop distribution.
# Run in PowerShell on the Windows CPU architecture you intend to support.

$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $PSScriptRoot
$PythonBin = if ($env:PYTHON_BIN) { $env:PYTHON_BIN } else { Join-Path $ProjectDir "backend\venv\Scripts\python.exe" }
$FrontendDir = Join-Path $ProjectDir "frontend"
$ReleaseDir = if ($env:TRADE_JOURNAL_RELEASE_DIR) { $env:TRADE_JOURNAL_RELEASE_DIR } else { Join-Path $ProjectDir "Windows" }

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

Push-Location $FrontendDir
try {
    npm.cmd run build
} finally {
    Pop-Location
}

Remove-Item -Recurse -Force (Join-Path $ProjectDir "build") -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $ProjectDir "dist") -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $ReleaseDir | Out-Null
$WindowsAppDir = Join-Path $ReleaseDir "Trade Journal Free"
$ArchivePath = Join-Path $ReleaseDir "Trade-Journal-Free-Windows.zip"
Remove-Item -Recurse -Force $WindowsAppDir -ErrorAction SilentlyContinue
Remove-Item -Force $ArchivePath -ErrorAction SilentlyContinue

Push-Location $ProjectDir
try {
    & $PythonBin -m PyInstaller `
        --noconfirm `
        --clean `
        --windowed `
        --onedir `
        --name "Trade Journal Free" `
        --paths $ProjectDir `
        --add-data "$ProjectDir\frontend\dist;frontend\dist" `
        --hidden-import ccxt.binance `
        --hidden-import ccxt.binanceusdm `
        --hidden-import ccxt.bybit `
        --hidden-import ccxt.okx `
        --hidden-import keyring.backends.Windows `
        --exclude-module pytest `
        --exclude-module _pytest `
        --collect-all diskcache `
        --collect-all cryptography `
        --collect-all orjson `
        --collect-all uvicorn `
        "$ProjectDir\packaging\desktop_entry.py"
} finally {
    Pop-Location
}

Move-Item (Join-Path $ProjectDir "dist\Trade Journal Free") $WindowsAppDir
Remove-Item -Recurse -Force (Join-Path $ProjectDir "dist"), (Join-Path $ProjectDir "build")

& (Join-Path $PSScriptRoot "sign_windows_artifact.ps1") -AppDirectory $WindowsAppDir

Compress-Archive -Path $WindowsAppDir -DestinationPath $ArchivePath -Force
Write-Host "Created: $ArchivePath"
