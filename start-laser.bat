@echo off
title Dekoor Laser Server
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
