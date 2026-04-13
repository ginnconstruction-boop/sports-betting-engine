@echo off
SETLOCAL

cd /d "C:\Users\Ginnh\OneDrive\Documents\Bet Claude\sports-betting-engine"

IF "%1"=="" (
  echo.
  echo Usage: RUN.bat [command]
  echo.
  echo   mock          Preview output - ZERO credits
  echo   validate      Check setup - ZERO credits
  echo   morning       Morning scan
  echo   midday        Midday final card
  echo   full          Full scan all sports
  echo   live          Live check
  echo   nba / mlb / nhl / ncaab   Single sport
  echo.
  pause
  exit /b 0
)

echo.
echo Running: %1
echo.
call npm run %1

echo.
pause
