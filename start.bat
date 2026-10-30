@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   日记本 · 正在开门...
echo.
start "" http://127.0.0.1:5173
node server/index.mjs
pause
