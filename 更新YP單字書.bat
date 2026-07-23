@echo off
REM One-click update for the YP wordbook.
REM All Chinese messages are printed by Python (scripts\update_yp.py),
REM because cmd.exe parses .bat files in the system codepage (Big5) and
REM would corrupt UTF-8 Chinese written directly in this file.
chcp 65001 >nul
cd /d "%~dp0"
python scripts\update_yp.py
echo.
pause
