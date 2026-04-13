@echo off
SETLOCAL

echo.
echo ============================================================
echo   Sports Betting Engine — Extract + Setup
echo ============================================================
echo.

:: Set target directory
SET TARGET=C:\Users\Ginnh\OneDrive\Documents\Bet Claude\sports-betting-engine

:: Check if tar file exists next to this script
SET TARFILE=%~dp0sports-betting-engine.tar

IF NOT EXIST "%TARFILE%" (
  SET TARFILE=%~dp0sports-betting-engine-1.tar
)

IF NOT EXIST "%TARFILE%" (
  echo [ERROR] Cannot find sports-betting-engine.tar
  echo.
  echo Make sure this script is in the same folder as the .tar file.
  echo.
  pause
  exit /b 1
)

echo Found: %TARFILE%
echo.
echo Extracting to: %TARGET%
echo.

:: Create target dir if needed
IF NOT EXIST "%TARGET%" mkdir "%TARGET%"

:: Extract using Windows built-in tar (available on Win10+)
tar -xf "%TARFILE%" -C "C:\Users\Ginnh\OneDrive\Documents\Bet Claude\"

IF %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] Extraction failed.
  echo Try right-clicking the .tar file and choosing Extract All
  pause
  exit /b 1
)

echo.
echo [OK] Extracted successfully.
echo.

:: Move into project folder
cd /d "%TARGET%"

IF %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Could not navigate to %TARGET%
  pause
  exit /b 1
)

echo Checking Node.js...
node --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] Node.js is not installed.
  echo Download it from: https://nodejs.org  (LTS version)
  echo Then run this script again.
  pause
  exit /b 1
)

FOR /F "tokens=*" %%i IN ('node --version') DO SET NODE_VER=%%i
echo [OK] Node.js %NODE_VER%

echo.
echo Installing dependencies...
echo (This takes 1-2 minutes the first time)
echo.

call npm install

IF %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

echo.
echo [OK] Dependencies installed.
echo.
echo Running validator (no API calls)...
echo.

call npx ts-node src/utils/validateSetup.ts

echo.
echo ============================================================
echo   Ready. Running mock preview now...
echo   (Zero API calls - Zero credits)
echo ============================================================
echo.

call npx ts-node src/dev/mockRun.ts

echo.
pause
