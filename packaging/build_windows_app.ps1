# Build a local-only Windows desktop distribution.
# Run in PowerShell on the Windows CPU architecture you intend to support.

$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $PSScriptRoot
$PythonBin = Join-Path $ProjectDir "backend\venv\Scripts\python.exe"
$FrontendDir = Join-Path $ProjectDir "frontend"
$ReleaseDir = Join-Path $ProjectDir "release"

if (-not (Test-Path $PythonBin)) {
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
Remove-Item -Recurse -Force $ReleaseDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $ReleaseDir | Out-Null

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
        --collect-all ccxt `
        --collect-all diskcache `
        --collect-all orjson `
        --collect-all uvicorn `
        "$ProjectDir\packaging\desktop_entry.py"
} finally {
    Pop-Location
}

Move-Item (Join-Path $ProjectDir "dist\Trade Journal Free") (Join-Path $ReleaseDir "Trade Journal Free")
Remove-Item -Recurse -Force (Join-Path $ProjectDir "dist"), (Join-Path $ProjectDir "build")

$ArchivePath = Join-Path $ReleaseDir "Trade-Journal-Free-Windows.zip"
Compress-Archive -Path (Join-Path $ReleaseDir "Trade Journal Free") -DestinationPath $ArchivePath -Force
Write-Host "Created: $ArchivePath"
