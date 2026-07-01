@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "REPO=%%~fI"
set "TOOL_DIR=%REPO%\blackhole-windows-terminal"
set "BIN_DIR=%USERPROFILE%\bin"
set "SHIM=%BIN_DIR%\bh.cmd"

where node >nul 2>nul
if errorlevel 1 (
  echo node was not found on Windows PATH.
  exit /b 127
)

if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"
(
  echo @echo off
  echo call "%TOOL_DIR%\bh.cmd" %%*
) > "%SHIM%"

node "%TOOL_DIR%\bh-mode.js" token >nul

echo Installed Windows bh shim: %SHIM%
echo If bh is not found in a new cmd window, add this directory to the user PATH:
echo   %BIN_DIR%
exit /b 0

