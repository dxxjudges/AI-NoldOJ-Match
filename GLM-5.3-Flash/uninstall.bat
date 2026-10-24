@echo off
cd /d "%~dp0"
echo ==========================================
echo   NoldOJ Uninstaller
echo ==========================================
echo This will delete: backend\node_modules, backend\data\*, logs\*
echo Database (NoldOJ.db), uploads and testdata are kept.
echo Type YES to continue:
set /p CONFIRM=
if not "%CONFIRM%"=="YES" (
  echo Aborted.
  pause
  exit /b
)
if exist backend\node_modules rmdir /s /q backend\node_modules
if exist backend\data rmdir /s /q backend\data
if exist logs rmdir /s /q logs
echo Uninstall complete.
pause
