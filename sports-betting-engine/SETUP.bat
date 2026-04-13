@echo off
SETLOCAL

echo.
echo ============================================================
echo   Sports Betting Engine — Windows Setup
echo ============================================================
echo.

:: Check Node.js
node --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Node.js not found.
  echo.
  echo Please install Node.js from https://nodejs.org
  echo Download the LTS version ^(v18 or higher^)
  echo Then re-run this script.
  echo.
  pause
  exit /b 1
)

FOR /F "tokens=*" %%i IN ('node --version') DO SET NODE_VER=%%i
echo [OK] Node.js found: %NODE_VER%

:: Check npm
npm --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
  echo [ERROR] npm not found. Reinstall Node.js from https://nodejs.org
  pause
  exit /b 1
)

FOR /F "tokens=*" %%i IN ('npm --version') DO SET NPM_VER=%%i
echo [OK] npm found: %NPM_VER%

echo.
echo Installing dependencies...
echo.

npm install

IF %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] npm install failed. Check your internet connection and try again.
  pause
  exit /b 1
)

echo.
echo [OK] Dependencies installed.
echo.
echo Running setup validator (no API calls)...
echo.

npx ts-node src/utils/validateSetup.ts

IF %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] Validation failed. See errors above.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   Setup complete. System is ready.
echo ============================================================
echo.
echo   Available commands (run in this folder):
echo.
echo   npx ts-node src/index.ts morning        Morning scan
echo   npx ts-node src/index.ts midday         Midday final card
echo   npx ts-node src/index.ts full           Full scan all sports
echo   npx ts-node src/index.ts nba            NBA only
echo   npx ts-node src/index.ts mlb            MLB only
echo   npx ts-node src/index.ts nhl            NHL only
echo.
echo   Add --force to bypass cache and pull fresh data
echo.
pause
