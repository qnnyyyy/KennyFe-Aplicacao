@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Kenfeh - atualizar o servidor
rem roda de uma copia no TEMP: o git pull pode atualizar este proprio arquivo sem quebrar no meio
if /i not "%~1"=="--run" (
  copy /y "%~f0" "%TEMP%\kenfeh-atualizar.bat" >nul
  "%TEMP%\kenfeh-atualizar.bat" --run "%~dp0"
  exit /b
)
set "ROOT=%~2"
cd /d "%ROOT%"

rem ============================================================
rem  Atualiza o Kenfeh no servidor (Magalu Cloud) com 2 cliques:
rem   1. baixa a versao nova do GitHub nesta pasta
rem   2. empacota (sem node_modules, data e .env) e manda para o servidor
rem   3. no servidor: troca os arquivos e reinicia SO o Kenfeh
rem  Os dados do servidor (contas, mensagens, uploads, .env) nao sao tocados.
rem  Na primeira vez confirma IP/usuario/chave e guarda em servidor.cfg
rem  (esse arquivo fica so no seu PC, nao vai para o GitHub).
rem ============================================================

set "CFG=%ROOT%servidor.cfg"
set "SERVER_HOST="
set "SERVER_USER="
set "SERVER_KEY="
set "BRANCH="
if exist "%CFG%" for /f "usebackq tokens=1,* delims==" %%a in ("%CFG%") do set "%%a=%%b"
if not defined BRANCH set "BRANCH=claude/magical-archimedes-lt2a4o"

where ssh >nul 2>&1
if errorlevel 1 goto :nossh

if defined SERVER_HOST goto :update

rem ---------- primeira vez ----------
rem padrao: a mesma maquina da Magalu onde esta o Dokai (chave .ssh\dokai)
set "DEF_HOST=201.23.64.189"
set "DEF_USER=ubuntu"
set "DEF_KEY="
if exist "%USERPROFILE%\.ssh\dokai" set "DEF_KEY=%USERPROFILE%\.ssh\dokai"
echo.
echo  ==== Primeira vez: servidor da Magalu ====
echo  So aperte Enter para usar o valor entre colchetes.
echo.
set /p "SERVER_HOST=  IP do servidor [%DEF_HOST%]: "
if not defined SERVER_HOST set "SERVER_HOST=%DEF_HOST%"
set /p "SERVER_USER=  Usuario [%DEF_USER%]: "
if not defined SERVER_USER set "SERVER_USER=%DEF_USER%"
if defined DEF_KEY (
  set /p "SERVER_KEY=  Chave SSH [%DEF_KEY%]: "
) else (
  echo  Arraste para esta janela o arquivo da chave SSH do servidor ^(ou Enter se entra com senha^).
  set /p "SERVER_KEY=  Chave SSH: "
)
if not defined SERVER_KEY set "SERVER_KEY=%DEF_KEY%"
if defined SERVER_KEY set "SERVER_KEY=%SERVER_KEY:"=%"
rem o SSH do Windows recusa chave que outros usuarios do PC conseguem ler
if defined SERVER_KEY icacls "%SERVER_KEY%" /inheritance:r /grant:r "%USERNAME%:R" >nul 2>&1
(
  echo SERVER_HOST=%SERVER_HOST%
  echo SERVER_USER=%SERVER_USER%
  echo SERVER_KEY=%SERVER_KEY%
  echo BRANCH=%BRANCH%
) > "%CFG%"
echo.
echo  Guardei em servidor.cfg ^(para trocar depois, e so apagar esse arquivo^).

:update
rem ---------- 1. versao nova nesta pasta ----------
echo.
echo  [1/3] Baixando a versao nova do GitHub...
git pull --no-rebase --no-edit origin %BRANCH%
if errorlevel 1 (
  echo.
  echo  [ERRO] O git pull falhou ^(mensagem acima^). Se for "commit your changes or stash them",
  echo  rode "git stash" nesta pasta e tente de novo.
  goto :end_err
)

rem ---------- 2. pacote ----------
echo.
echo  [2/3] Empacotando...
set "PKG=%TEMP%\kenfeh-update.tgz"
if exist "%PKG%" del /q "%PKG%"
tar -czf "%PKG%" --exclude=./node_modules --exclude=./data --exclude=./.env --exclude=./.git --exclude=./agent/.refs --exclude=./servidor.cfg --exclude=*.log -C "%ROOT%." .
if errorlevel 1 (
  echo  [ERRO] Nao consegui criar o pacote.
  goto :end_err
)

rem ---------- 3. enviar e reiniciar ----------
set "KEYARG="
if defined SERVER_KEY set KEYARG=-i "%SERVER_KEY%"
set "SSHOPT=-o StrictHostKeyChecking=accept-new -o ConnectTimeout=20"
echo.
echo  [3/3] Enviando para %SERVER_USER%@%SERVER_HOST% e reiniciando...
scp -q %KEYARG% %SSHOPT% "%PKG%" %SERVER_USER%@%SERVER_HOST%:kenfeh-update.tgz
if errorlevel 1 goto :ssh_err
ssh %KEYARG% %SSHOPT% %SERVER_USER%@%SERVER_HOST% "tr -d '\r' > ~/.kenfeh-atualizar.sh && bash ~/.kenfeh-atualizar.sh" < "%ROOT%scripts\atualizar-servidor.sh"
set "RC=%errorlevel%"
del /q "%PKG%" >nul 2>&1
echo.
if "%RC%"=="0" (
  echo  Abrindo o site... aperte Ctrl+F5 nele para carregar a versao nova.
  start "" "https://kenfeh.shop"
  goto :end_ok
)
if "%RC%"=="255" goto :ssh_err
if "%RC%"=="3" (
  echo  O Kenfeh nao esta instalado nesse servidor ^(veja acima o que tem nele^).
  echo  Me mande print dessa janela que eu te ajudo a instalar.
)
goto :end_err

:ssh_err
echo.
echo  [ERRO] Nao consegui entrar no servidor.
echo   - Confira IP, usuario e chave em servidor.cfg ^(ou apague o arquivo para responder de novo^).
echo   - "Permission denied": chave errada, ou o usuario e "root" em vez de "ubuntu".
echo   - "timed out": a maquina esta desligada ou a porta 22 esta bloqueada no painel da Magalu.
goto :end_err

:nossh
echo.
echo  [ERRO] O SSH do Windows nao esta instalado.
echo  Configuracoes ^> Aplicativos ^> Recursos opcionais ^> Adicionar recurso ^> "Cliente OpenSSH".
goto :end_err

:end_ok
echo.
pause
exit /b 0

:end_err
echo.
pause
exit /b 1
