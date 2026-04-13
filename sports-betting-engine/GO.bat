@echo off
SETLOCAL
cd /d "%~dp0"

:MENU
cls
echo.
echo ============================================================
echo   Sports Betting Engine  --  Elite Model v2.2
echo ============================================================
echo.
node --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 ( echo Node.js not installed. Go to https://nodejs.org & pause & exit /b 1 )
IF NOT EXIST node_modules\ts-node (
  echo Installing packages... (one-time setup, about 2 min)
  IF EXIST node_modules rmdir /s /q node_modules
  IF EXIST package-lock.json del /q package-lock.json
  call npm install
  IF %ERRORLEVEL% NEQ 0 ( echo Install failed. & pause & exit /b 1 )
  echo [OK] Packages installed.
  echo.
)

echo  -- FULL SCANS (all sports) ----------------------------------
echo   1   Morning Scan  (auto-grades + PDF report + alerts)
echo   2   Midday Final Card
echo   3   Full Scan all sports
echo.
echo  -- SINGLE SPORT (game lines + props) -----------------------
echo   4   NBA only
echo   5   MLB only
echo   6   NHL only
echo   7   NCAAB only
echo   8   NFL only
echo   9   NCAAF only
echo   10  NCAA Baseball only
echo.
echo  -- PLAYER PROPS (standard lines + scoring) -----------------
echo   11  NBA Player Props
echo  11b  MLB Player Props
echo  11c  NHL Player Props
echo  11d  NFL Player Props
echo.
echo  -- ALT LINE PARLAYS (high probability) ---------------------
echo   12  NBA Alt Line Parlays
echo   13  NFL Alt Line Parlays
echo.
echo  -- SAME-GAME PARLAY CORRELATIONS ---------------------------
echo   14  NBA SGP Correlations
echo   15  NFL SGP Correlations
echo.
echo  -- TRACKING AND REPORTS (no credits) ----------------------
echo   16  Enter game results
echo   17  View Win-Loss report
echo   18  Retrospective analysis
echo   19  Weekly summary
echo   20  Closing line value report
echo   21  Model calibration report
echo   22  Historical odds database
echo   23  List all logged picks
echo   24  Fix wrong results (reset and re-enter)
echo.
echo  -- MONITORING -----------------------------------------------
echo   27  Line Movement Monitor  (Ctrl+C to stop)
echo       Configure: LINE_MONITOR_INTERVAL_MINS in .env
echo.
echo  -- FIRST SCORER PROPS ----------------------------------------
echo   28  NBA First Basket props
echo   29  NFL First TD props
echo.
echo  -- OTHER ----------------------------------------------------
echo   25  Preview output (no credits)
echo   26  Exit
echo.
set /p CHOICE="Enter number (1-27) or 11b/11c/11d: "

IF "%CHOICE%"=="1"   call npm run morning   & goto DONE
IF "%CHOICE%"=="2"   call npm run midday    & goto DONE
IF "%CHOICE%"=="3"   call npm run full      & goto DONE
IF "%CHOICE%"=="4"   call npm run nba       & goto DONE
IF "%CHOICE%"=="5"   call npm run mlb       & goto DONE
IF "%CHOICE%"=="6"   call npm run nhl       & goto DONE
IF "%CHOICE%"=="7"   call npm run ncaab     & goto DONE
IF "%CHOICE%"=="8"   call npm run nfl       & goto DONE
IF "%CHOICE%"=="9"   call npm run ncaaf     & goto DONE
IF "%CHOICE%"=="10"  call npm run ncaa-baseball & goto DONE
IF "%CHOICE%"=="11"  call npm run props     & goto DONE
IF "%CHOICE%"=="11b" call npm run mlbprops  & goto DONE
IF "%CHOICE%"=="11c" call npm run nhlprops  & goto DONE
IF "%CHOICE%"=="11d" call npm run nflprops  & goto DONE
IF "%CHOICE%"=="12"  call npm run altparlays & goto DONE
IF "%CHOICE%"=="13"  node --require ts-node/register src/index.ts altparlays americanfootball_nfl & goto DONE
IF "%CHOICE%"=="14"  call npm run sgp       & goto DONE
IF "%CHOICE%"=="15"  node --require ts-node/register src/index.ts sgp americanfootball_nfl & goto DONE
IF "%CHOICE%"=="16"  call npm run results   & goto DONE
IF "%CHOICE%"=="17"  call npm run record    & goto DONE
IF "%CHOICE%"=="18"  call npm run retro     & goto DONE
IF "%CHOICE%"=="19"  call npm run week      & goto DONE
IF "%CHOICE%"=="20"  call npm run clv       & goto DONE
IF "%CHOICE%"=="21"  call npm run calibrate & goto DONE
IF "%CHOICE%"=="22"  call npm run history   & goto DONE
IF "%CHOICE%"=="23"  call npm run clv:picks & goto DONE
IF "%CHOICE%"=="24"  call npm run fixresults & goto DONE
IF "%CHOICE%"=="25"  call npm run mock      & goto DONE
IF "%CHOICE%"=="26"  exit /b 0
IF "%CHOICE%"=="27"  call npm run monitor   & goto DONE
IF "%CHOICE%"=="28"  call npm run firstbasket & goto DONE
IF "%CHOICE%"=="29"  call npm run firsttd    & goto DONE

echo   Invalid selection.

:DONE
echo.
echo ----------------------------------------------------------------
echo   Scan complete. Press P to open report as PDF, any other key for menu.
echo ----------------------------------------------------------------
choice /c PM /n /m "P=Save PDF  M=Menu: "
IF %ERRORLEVEL%==1 (
  REM Open latest HTML report in default browser
  IF EXIST snapshots\daily_reports\latest.html (
    start "" "snapshots\daily_reports\latest.html"
    echo   Opened in browser. Use Ctrl+P to Save as PDF.
  ) ELSE (
    echo   No report found. Run a scan first.
  )
  pause >nul
)
goto MENU
