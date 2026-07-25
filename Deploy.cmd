@echo off
REM ============================================================
REM  One-click deploy for the Registration Portal
REM  Usage:  Deploy.cmd                (auto commit message)
REM          Deploy.cmd fixed pdf bug  (your own message)
REM  Steps:  commit -> push to GitHub -> update the Linode server
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "SERVER=root@172.105.49.152"
set "MSG=%*"
if "%MSG%"=="" set "MSG=Update %date% %time%"

echo.
echo ============================================================
echo   [1/3] Committing local changes...
echo ============================================================
git add -A
git commit -m "%MSG%"
REM (no error check here - "nothing to commit" is fine)

echo.
echo ============================================================
echo   [2/3] Pushing to GitHub...
echo ============================================================
git push
if errorlevel 1 goto :err

echo.
echo ============================================================
echo   [3/3] Updating the server (type server password if asked)
echo ============================================================
ssh %SERVER% "cd /opt/registration && git pull && bash deploy/linode-setup.sh"
if errorlevel 1 goto :err

echo.
echo ============================================================
echo   DONE!  Site: https://form.techvein.org
echo          Admin: https://form.techvein.org/admin
echo ============================================================
echo.
pause
exit /b 0

:err
echo.
echo !! DEPLOYMENT FAILED - read the messages above.
echo    (If "ssh is not recognized": install OpenSSH Client from
echo     Windows Settings - Apps - Optional Features.)
echo.
pause
exit /b 1
