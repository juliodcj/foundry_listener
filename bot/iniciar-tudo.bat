@echo off
chcp 65001 >nul
rem Abre o bot numa janela e o Foundry desktop em seguida.
rem Ajuste FOUNDRY_EXE se o Foundry estiver instalado em outro lugar.
set "FOUNDRY_EXE=%LOCALAPPDATA%\Programs\Foundry Virtual Tabletop\Foundry Virtual Tabletop.exe"
if not exist "%FOUNDRY_EXE%" set "FOUNDRY_EXE=%ProgramFiles%\Foundry Virtual Tabletop\Foundry Virtual Tabletop.exe"

start "Retratos Falantes - bot" "%~dp0iniciar.bat"

if exist "%FOUNDRY_EXE%" (
  start "" "%FOUNDRY_EXE%"
) else (
  echo Foundry nao encontrado em "%FOUNDRY_EXE%". Edite este arquivo.
  pause
)
