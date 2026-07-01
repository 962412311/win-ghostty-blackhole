@echo off
setlocal

set "TOOL_DIR=%~dp0"
set "REPO="
for /f "usebackq delims=" %%I in (`C:\Windows\System32\wsl.exe -d Ubuntu --exec wslpath -a "%TOOL_DIR%.." 2^>nul`) do set "REPO=%%I"
set "SCRIPT="
for /f "usebackq delims=" %%I in (`C:\Windows\System32\wsl.exe -d Ubuntu --exec wslpath -a "%TOOL_DIR%codex-blackhole-launch.sh" 2^>nul`) do set "SCRIPT=%%I"

if not defined REPO (
  echo Could not map repo path to WSL.
  exit /b 1
)
if not defined SCRIPT (
  echo Could not map launch script to WSL.
  exit /b 1
)

if /I "%~1"=="--probe" (
  C:\Windows\System32\wsl.exe -d Ubuntu --cd "%REPO%" --exec bash -lc "echo WSL_CMD_PROBE; pwd; test -x '%SCRIPT%'; echo script=$?"
  exit /b %ERRORLEVEL%
)

C:\Windows\System32\wsl.exe -d Ubuntu --cd "%REPO%" --exec bash -lc "exec '%SCRIPT%'"
exit /b %ERRORLEVEL%
