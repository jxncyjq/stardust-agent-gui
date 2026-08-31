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
call :ensure_workspace || exit /b 1
echo [dev] wails dev @ %GUI% (Ctrl+C to stop)
pushd "%GUI%"
wails dev -m
popd
goto :eof

:mode_build
call :assert_node || exit /b 1
call :ensure_wails || exit /b 1
call :ensure_workspace || exit /b 1
echo [build] wails build @ %GUI%
pushd "%GUI%"
wails build -m
popd
if exist "%EXE%" ( echo Output: %EXE% ) else ( echo Build finished but output not found: %EXE% & exit /b 1 )
goto :eof

:mode_run
if not exist "%EXE%" (
    call :assert_node || exit /b 1
    call :ensure_wails || exit /b 1
    call :ensure_workspace || exit /b 1
    echo [run] exe not found, building first...
    pushd "%GUI%"
    wails build -m
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

REM The GUI cannot resolve github.com/stardust/legion-agent on its own: that module
REM is never published, and go.mod deliberately carries no `replace` (depending on a
REM local sibling checkout is a property of the workspace, not of the module).
REM The workspace lives at %ROOT%\go.work, which belongs to NEITHER repo -- it spans
REM both, so nobody can commit it. That is why this has to build it.
REM
REM `go work edit` runs every time on purpose: it is idempotent, and it repairs a
REM go.work that has the two `use` lines but no replace -- that combination fails with
REM a baffling "Repository not found", because the GUI still requires v0.0.0 and Go
REM goes off to resolve that version itself.
:ensure_workspace
if not exist "%AGENT%\go.mod" (
    echo Missing sibling checkout: %AGENT%
    echo   Check out github.com/jxncyjq/stardust-agent-server there, next to this repo.
    exit /b 1
)
REM GOWORK=off is not decoration: `go work init` searches ANCESTOR directories and
REM refuses with "<ancestor>\go.work already exists" if it finds one up there --
REM which is exactly the case when an outer editor-only workspace exists. Turning
REM the search off makes init do what its name says: create one HERE.
if not exist "%ROOT%\go.work" (
    echo [workspace] creating %ROOT%\go.work
    pushd "%ROOT%"
    set "GOWORK=off"
    go work init ./legionAgent ./legionAgentGUI || ( set "GOWORK=" ^& popd ^& exit /b 1 )
    set "GOWORK="
    popd
)
go work edit -replace=github.com/stardust/legion-agent@v0.0.0=./legionAgent "%ROOT%\go.work" || exit /b 1
goto :eof

:ensure_wails
where wails >nul 2>nul || ( echo Missing wails CLI. Install: go install github.com/wailsapp/wails/v2/cmd/wails@latest & exit /b 1 )
goto :eof
