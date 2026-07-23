@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo ==========================================
echo    一鍵更新 YP 單字書 - 匯入並上線
echo ==========================================
echo.
echo [1/4] 讀 Excel、重新產生 data\books.json ...
echo.
python scripts\build_books.py
if errorlevel 1 goto fail

echo.
echo [2/4] 升 App 版本（手機才會拿到新字）...
python scripts\bump_version.py
if errorlevel 1 goto fail

echo.
echo [3/4] 上傳到 GitHub ...
git add data/books.json service-worker.js js/state.js YP_level*_vocabulary.xlsx
git commit -m "更新 YP 單字書內容"
git push
if errorlevel 1 goto pushfail

echo.
echo ==========================================
echo    [4/4] 完成！已上線
echo ==========================================
type scripts\.last_import.txt 2>nul
echo.
echo 手機拿新字的方式：
echo   連著網路，把 App 關掉重開兩次（第一次抓新版、第二次生效）。
echo   版本標籤在「測驗」頁或各子頁最下面，變成新的日期就對了。
echo.
echo 孩子已有的學習進度不會被影響（只更新單字內容）。
echo.
pause
exit /b 0

:pushfail
echo.
echo ***** 上傳失敗 *****
echo 可能原因：沒連網、或 GitHub 登入過期。
echo 請把上面的訊息截圖傳給我。
echo.
pause
exit /b 1

:fail
echo.
echo ***** 失敗了，沒有上傳任何東西 *****
echo 請把上面的錯誤訊息截圖傳給我。
echo （常見原因：Excel 檔正開著沒關、或檔名不是 YP_levelN_vocabulary.xlsx）
echo.
pause
exit /b 1
