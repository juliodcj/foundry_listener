@echo off
chcp 65001 >nul
title Retratos Falantes - bot
cd /d "%~dp0"

where node >/dev/null 2>nul
if errorlevel 1 (
  echo O Node.js nao foi encontrado. Instale com: winget install OpenJS.NodeJS.LTS
  pause
  exit /b 1
)

if not exist ".env" (
  echo Arquivo .env nao encontrado. Copie .env.example para .env e preencha.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando dependencias ^(so na primeira vez^)...
  call npm install --omit=dev
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

:loop
node index.js
if errorlevel 2 (
  pause
  exit /b 1
)
echo O bot parou. Reiniciando em 5 segundos ^(feche a janela para sair^)...
timeout /t 5 >nul
goto loop
