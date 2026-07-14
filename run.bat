@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM Legion Agent GUI / backend launcher (bat port of run.ps1)
REM   dev   : wails dev (default, desktop window + embedded serve)
REM   build : wails build -> single exe
REM   run   : ensure built, then launch GUI exe
REM   serve : headless backend HTTP service (no GUI)
REM Usage:
REM   run.bat                       = run.bat dev
REM   run.bat build
REM   run.bat run   -Config agent.json
REM   run.bat serve -Addr 127.0.0.1:8080 -Config agent.json
REM ============================================================

REM ----- paths (script lives in legionAgentGUI; ROOT = parent) -----
set "GUI=%~dp0"
if "%GUI:~-1%"=="\" set "GUI=%GUI:~0,-1%"
for %%I in ("%GUI%\..") do set "ROOT=%%~fI"
set "AGENT=%ROOT%\legionAgent"
set "EXE=%GUI%\build\bin\legionAgentGUI.exe"

REM ----- arg parsing -----
set "MODE=dev"
set "CONFIG="
set "ADDR="

:parse
if "%~1"=="" goto parsed
set "ARG=%~1"
if /i "%ARG%"=="dev"     ( set "MODE=dev"   & shift & goto parse )
if /i "%ARG%"=="build"   ( set "MODE=build" & shift & goto parse )
if /i "%ARG%"=="run"     ( set "MODE=run"   & shift & goto parse )
if /i "%ARG%"=="serve"   ( set "MODE=serve" & shift & goto parse )
if /i "%ARG%"=="-Config" ( set "CONFIG=%~2" & shift & shift & goto parse )
if /i "%ARG%"=="-Addr"   ( set "ADDR=%~2"   & shift & shift & goto parse )
echo Unknown arg: %ARG%
exit /b 1
:parsed

REM ----- go is required for all modes -----
where go >nul 2>nul || ( echo Missing dependency: go. Install: https://go.dev/dl/ & exit /b 1 )

REM wails is installed by go install into GOPATH\bin; make sure it is on PATH
for /f "delims=" %%i in ('go env GOPATH 2^>nul') do set "GOPATH_DIR=%%i"
if defined GOPATH_DIR set "PATH=%PATH%;%GOPATH_DIR%\bin"

if /i "%MODE%"=="dev"   goto mode_dev
if /i "%MODE%"=="build" goto mode_build
if /i "%MODE%"=="run"   goto mode_run
if /i "%MODE%"=="serve" goto mode_serve

:mode_dev
call :assert_node || exit /b 1
call :ensure_wails || exit /b 1
echo [dev] wails dev @ %GUI% (Ctrl+C to stop)
pushd "%GUI%"
wails dev
popd
goto :eof

:mode_build
call :assert_node || exit /b 1
call :ensure_wails || exit /b 1
echo [build] wails build @ %GUI%
pushd "%GUI%"
wails build
popd
if exist "%EXE%" ( echo Output: %EXE% ) else ( echo Build finished but output not found: %EXE% & exit /b 1 )
goto :eof

:mode_run
if not exist "%EXE%" (
    call :assert_node || exit /b 1
    call :ensure_wails || exit /b 1
    echo [run] exe not found, building first...
    pushd "%GUI%"
    wails build
    popd
)
echo [run] launching %EXE%
if defined CONFIG ( "%EXE%" "%CONFIG%" ) else ( "%EXE%" )
goto :eof

:mode_serve
echo [serve] headless backend @ %AGENT% (Ctrl+C to stop)
set "GOARGS=run ./cmd serve"
if defined CONFIG set "GOARGS=!GOARGS! --config %CONFIG%"
if defined ADDR   set "GOARGS=!GOARGS! --addr %ADDR%"
pushd "%AGENT%"
go !GOARGS!
popd
goto :eof

:assert_node
where node >nul 2>nul || ( echo Missing dependency: node. Install: https://nodejs.org/ & exit /b 1 )
goto :eof

:ensure_wails
where wails >nul 2>nul || ( echo Missing wails CLI. Install: go install github.com/wailsapp/wails/v2/cmd/wails@latest & exit /b 1 )
goto :eof
