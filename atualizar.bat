@echo off
setlocal
rem Atualiza o FoundryListener: puxa o codigo novo do GitHub e baixa o .exe que o
rem GitHub Actions compilou para esse commit. Precisa do git e do gh.
cd /d "%~dp0"
set "EXE=FoundryListener.exe"
set "ARTEFATO=FoundryListener"
set "DESTINO=dist\FoundryListener"

tasklist /fi "imagename eq %EXE%" | find /i "%EXE%" >nul && (
  echo Feche o %EXE% antes de atualizar.
  goto fim
)

echo Puxando a versao mais nova do GitHub...
git pull --ff-only || goto erro

for /f %%s in ('git rev-parse HEAD') do set "SHA=%%s"
set "RUN="
for /f %%r in ('gh run list --workflow build --commit %SHA% --limit 1 --json databaseId --jq ".[0].databaseId"') do set "RUN=%%r"
if not defined RUN (
  echo O GitHub ainda nao comecou a compilar o commit %SHA:~0,7%. Tente de novo em um minuto.
  goto erro
)

echo Esperando a compilacao do commit %SHA:~0,7% terminar no GitHub...
gh run watch %RUN% --exit-status >nul || goto erro

set "BAIXADO=%TEMP%\atualizar-%ARTEFATO%"
if exist "%BAIXADO%" rmdir /s /q "%BAIXADO%"
echo Baixando o %EXE%...
gh run download %RUN% --name %ARTEFATO% --dir "%BAIXADO%" || goto erro
robocopy "%BAIXADO%" "%DESTINO%" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto erro
rmdir /s /q "%BAIXADO%"
echo Pronto: %EXE% atualizado para o commit %SHA:~0,7%.
goto fim

:erro
echo.
echo A atualizacao falhou.
:fim
pause
