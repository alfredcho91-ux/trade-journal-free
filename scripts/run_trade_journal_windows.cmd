@echo off
setlocal
set "PROJECT_ROOT=%~dp0.."
for %%I in ("%PROJECT_ROOT%") do set "PROJECT_ROOT=%%~fI"
set "PYTHON=%PROJECT_ROOT%\backend\venv\Scripts\python.exe"
set "NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%PYTHON%" (
  echo Trade Journal backend environment is missing: %PYTHON%
  pause
  exit /b 1
)
if not exist "%NODE%" (
  where node >nul 2>nul && set "NODE=node"
)
if not exist "%NODE%" if not "%NODE%"=="node" (
  echo Node.js was not found. Install Node.js 24 LTS, then run this shortcut again.
  pause
  exit /b 1
)
if not exist "%PROJECT_ROOT%\frontend\node_modules\vite\bin\vite.js" (
  echo Trade Journal frontend dependencies are missing. Run npm install in frontend first.
  pause
  exit /b 1
)

pushd "%PROJECT_ROOT%"
netstat -ano | findstr /R /C:":8011 .*LISTENING" >nul || start "Trade Journal Backend" /min "%PYTHON%" -m uvicorn backend.main:app --host 127.0.0.1 --port 8011
pushd "%PROJECT_ROOT%\frontend"
set "VITE_API_TARGET=http://127.0.0.1:8011"
netstat -ano | findstr /R /C:":5181 .*LISTENING" >nul || start "Trade Journal Frontend" /min "%NODE%" "%PROJECT_ROOT%\frontend\node_modules\vite\bin\vite.js" --host 127.0.0.1 --port 5181
start "" "http://127.0.0.1:5181/journal"
