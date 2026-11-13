@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-server.ps1" stop
set "result=%errorlevel%"
if /I not "%~1"=="--no-pause" pause
exit /b %result%
