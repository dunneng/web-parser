@echo off
chcp 65001 >nul 2>&1
echo Stopping old processes...
taskkill /f /im electron.exe >nul 2>&1
taskkill /f /im python.exe >nul 2>&1
timeout /t 3 /nobreak >nul
echo Cleaning Qdrant lock...
if exist "python\data\qdrant_storage" rmdir /s /q "python\data\qdrant_storage" 2>nul
echo Starting...
cd /d "%~dp0"
npx electron.cmd .
