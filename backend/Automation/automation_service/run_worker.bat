@echo off
REM PCL Windows worker launcher.
REM Started automatically at logon by the "PCL Automation Worker" scheduled task.
REM Keeps the worker alive: if it ever exits, wait 15s and start it again.

cd /d "%~dp0"

:loop
python "%~dp0windows_worker.py"
echo [launcher] worker exited (code %ERRORLEVEL%) - restarting in 15s...
timeout /t 15 /nobreak >nul
goto loop
