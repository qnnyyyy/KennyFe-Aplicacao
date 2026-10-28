@echo off
title Kenfeh - servidor
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
:loop
echo.
echo  Iniciando o Kenfeh em http://localhost:3000  (feche esta janela para desligar)
call npm start
echo.
echo  O servidor parou. Reiniciando em 3 segundos... (Ctrl+C para sair)
timeout /t 3 /nobreak >nul
goto loop
