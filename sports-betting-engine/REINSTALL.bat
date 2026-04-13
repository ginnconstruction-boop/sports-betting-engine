@echo off
SETLOCAL
echo.
echo ============================================================
echo   Sports Betting Engine — Clean Reinstall
echo ============================================================
echo.

cd /d "C:\Users\Ginnh\OneDrive\Documents\Bet Claude\sports-betting-engine"

echo Step 1: Clearing old node_modules if present...
IF EXIST node_modules (
  rmdir /s /q node_modules
  echo [OK] Cleared old node_modules
) ELSE (
  echo [OK] No old node_modules to clear
)

IF EXIST package-lock.json del package-lock.json
echo [OK] Cleared package-lock.json

echo.
echo Step 2: Installing all packages fresh...
echo (Takes 1-3 minutes - do not close this window)
echo.
call npm install

IF %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] npm install failed. Check your internet connection.
  pause
  exit /b 1
)

echo.
echo Step 3: Verifying ts-node installed correctly...
IF EXIST node_modules\.bin\ts-node (
  echo [OK] ts-node found in node_modules\.bin
) ELSE (
  echo [WARN] ts-node not in .bin - trying alternate check...
  IF EXIST node_modules\ts-node (
    echo [OK] ts-node package found in node_modules
  ) ELSE (
    echo [ERROR] ts-node not installed. Something went wrong.
    pause
    exit /b 1
  )
)

echo.
echo Step 4: Running mock preview (zero API calls, zero credits)...
echo.
call npm run mock

echo.
pause
