@echo off
title Dekoor Laser Server

:: Matar procesos anteriores
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM meerk40t.exe >nul 2>&1
taskkill /F /IM python.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Iniciando MeerK40t...
start /B meerk40t -z -c -e "consoleserver -p 2323"
timeout /t 5 /nobreak >nul

:loop
echo.
echo ========================================
echo   Iniciando servidor CRM + Laser...
echo ========================================
echo.
cd /d "%~dp0"
node server/index.js
echo.
echo Servidor detenido. Reiniciando en 2s...
timeout /t 2 /nobreak >nul
goto loop
