@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Iniciando a Plataforma de Prospeccao Starlink...
python run.py
echo.
echo A plataforma foi encerrada.
pause
