@echo off
setlocal

set "REPO=/mnt/i/QtWorkData/MyTools/my_ghostty_blackhole"
set "SCRIPT=%REPO%/blackhole-windows-terminal/codex-blackhole-launch.sh"

if /I "%~1"=="--probe" (
  C:\Windows\System32\wsl.exe -d Ubuntu --cd "%REPO%" --exec bash -lc "echo WSL_CMD_PROBE; pwd; test -x '%SCRIPT%'; echo script=$?"
  exit /b %ERRORLEVEL%
)

C:\Windows\System32\wsl.exe -d Ubuntu --cd "%REPO%" --exec bash -lc "exec '%SCRIPT%'"
exit /b %ERRORLEVEL%
