@echo off
setlocal
set ELECTRON_RUN_AS_NODE=
set TEMP=%~dp0.tmp
set TMP=%~dp0.tmp
if not exist "%TEMP%" mkdir "%TEMP%"
cd /d "%~dp0"
if exist "%~dp0dist\automato\win-unpacked\AuTomato.exe" (
  start "AuTomato" "%~dp0dist\automato\win-unpacked\AuTomato.exe"
) else (
  start "AuTomato" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0desktop\main.cjs"
)
