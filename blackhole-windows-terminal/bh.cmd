@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "TOOL_DIR=%~dp0"
set "MODE=%~1"
set "SKIP_FIRST=0"

if "%MODE%"=="" (
  set "MODE=codex"
) else if /I "%MODE%"=="auto" (
  set "MODE=codex"
  set "SKIP_FIRST=1"
) else if /I "%MODE%"=="demo" (
  goto run_mode
) else if /I "%MODE%"=="token" (
  goto run_mode
) else if /I "%MODE%"=="tokens" (
  goto run_mode
) else if /I "%MODE%"=="pomodoro" (
  goto run_mode
) else if /I "%MODE%"=="clock" (
  goto run_mode
) else if /I "%MODE%"=="timer" (
  goto run_mode
) else if /I "%MODE%"=="mode" (
  goto run_mode
) else if /I "%MODE%"=="status" (
  goto run_mode
) else if /I "%MODE%"=="current" (
  goto run_mode
) else if /I "%MODE%"=="claude" (
  set "SKIP_FIRST=1"
) else if /I "%MODE%"=="codex" (
  set "SKIP_FIRST=1"
) else if /I "%MODE%"=="__run_claude" (
  set "SKIP_FIRST=1"
) else if /I "%MODE%"=="__run_codex" (
  set "SKIP_FIRST=1"
) else if /I "%MODE%"=="help" (
  goto usage
) else if /I "%MODE%"=="--help" (
  goto usage
) else (
  echo Unknown mode: %MODE%
  goto usage_error
)

if "%SKIP_FIRST%"=="1" shift

set "BH_ARGS="
:collect_args
if "%~1"=="" goto args_done
set "BH_ARGS=!BH_ARGS! "%~1""
shift
goto collect_args

:args_done
if /I "%MODE%"=="claude" goto run_claude
if /I "%MODE%"=="codex" goto run_codex
if /I "%MODE%"=="__run_claude" goto run_claude_inplace
if /I "%MODE%"=="__run_codex" goto run_codex_inplace
goto usage_error

:run_mode
node "%TOOL_DIR%bh-mode.js" %MODE% --open
exit /b %ERRORLEVEL%

:run_claude
node "%TOOL_DIR%bh-mode.js" open-claude %BH_ARGS%
exit /b %ERRORLEVEL%

:run_claude_inplace
node "%TOOL_DIR%bh-mode.js" install-claude >nul
where claude >nul 2>nul
if errorlevel 1 (
  echo claude was not found on PATH.
  exit /b 127
)
endlocal & claude %BH_ARGS%
exit /b %ERRORLEVEL%

:run_codex
node "%TOOL_DIR%bh-mode.js" open-codex %BH_ARGS%
exit /b %ERRORLEVEL%

:run_codex_inplace
node "%TOOL_DIR%bh-mode.js" token >nul
set "WSL_CWD="
for /f "usebackq delims=" %%I in (`C:\Windows\System32\wsl.exe -d Ubuntu --exec wslpath -a "%CD%" 2^>nul`) do set "WSL_CWD=%%I"
if not defined WSL_CWD (
  echo Could not map current Windows directory to WSL: %CD%
  exit /b 1
)
set "WSL_BH="
for /f "usebackq delims=" %%I in (`C:\Windows\System32\wsl.exe -d Ubuntu --exec wslpath -a "%TOOL_DIR%bh" 2^>nul`) do set "WSL_BH=%%I"
if not defined WSL_BH (
  echo Could not map bh script to WSL: %TOOL_DIR%bh
  exit /b 1
)
set "BH_WSLENV=CODEX_BLACKHOLE_MIN_LEVEL/u:CODEX_BLACKHOLE_TOKEN_MAX/u:CODEX_BLACKHOLE_INTERVAL_MS/u:BLACKHOLE_DEBUG_STDOUT/u"
if defined WSLENV (
  set "WSLENV=!WSLENV!:!BH_WSLENV!"
) else (
  set "WSLENV=!BH_WSLENV!"
)
C:\Windows\System32\wsl.exe -d Ubuntu --cd "%WSL_CWD%" --exec "%WSL_BH%" __run_codex %BH_ARGS%
exit /b %ERRORLEVEL%

:usage
echo Usage:
echo   bh demo        Install demo shader and open a new Blackhole tab.
echo   bh token       Install token shader and open a new Blackhole tab.
echo   bh pomodoro    Install pomodoro shader and open a new Blackhole tab.
echo   bh clock       Alias of bh pomodoro.
echo   bh mode        Print the installed shader path and last requested mode.
echo   bh             Open a new Blackhole tab running WSL Codex.
echo   bh claude      Open a new Blackhole tab running Windows Claude Code.
echo   bh codex       Open a new Blackhole tab running WSL Codex.
exit /b 0

:usage_error
echo Usage: bh [demo^|token^|pomodoro^|clock^|mode^|claude^|codex]
exit /b 2
