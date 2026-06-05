# 英文單字記憶系統（PWA）

給兩個孩子（升高一、升國三）在**手機**上背英文單字的免費離線 App。
核心：一打開就強迫測驗、打字作答、答錯練到會、間隔重複自動安排複習、查單字自動記錄、每日報告一鍵貼 LINE。

> 目前進度：**Phase 1（可用版）**。字根分頁與每日提醒為 Phase 2。

---

## 功能（Phase 1）
- 📝 **首頁＝測驗**：一次一題，看中文＋詞性、打字輸入英文。答錯顯示完整單字卡並**反覆出現直到答對**（精熟迴圈）。
- 🧠 **間隔重複 SM-2**：答對後依易度自動排下次複習；三狀態：🆕未測驗／📖需加強／✅已熟記。
- 🔎 **查單字＝自動記錄**：查詢成功即自動加入待學清單（免按鈕）；線上時自動補音標／例句（dictionaryapi.dev），離線用本機資料。
- 🔊 **發音**：瀏覽器內建語音（免金鑰、可離線）。
- 📋 **我的單字總表**：依狀態／級別篩選、關鍵字搜尋、排序（最近新增／最常錯／即將到期），點字看卡、可立即測該字。
- 👧👦 **雙身分**：升高一、升國三-Sonya 各自獨立進度與設定。
- 📊 **每日報告**：一鍵複製純文字，貼到 LINE 給家長（含今日新學、複習數、答對率、已熟記比例、未學習比例、連續天數）。
- 💾 **匯出／匯入**：JSON 備份，換手機不怕進度不見。
- 📲 **離線優先 PWA**：可「加入主畫面」，飛航模式仍可測驗、看卡、發音。

---

## 一、產生單字資料（build）
需求：Python 3 + `pandas`、`openpyxl`。

```bash
pip install pandas openpyxl
python scripts/build_vocab.py
```

會讀取 `學測6000字.xlsx`（工作表 `學測6000字(111)`）產生：
- `data/vocab.json`：6008 字（六級全載入；同字同級別重複列已合併）。
- `build_report.txt`：清理報告（中文空值、括號特例、id 衝突等）。

> 出題預設優先 Level 4–6，但六級全部可被測驗與統計。

## 二、本機測試（上線前）
```bash
python -m http.server 8000
```
- 電腦瀏覽器開 `http://localhost:8000`。
- 手機同一 WiFi：先用 `ipconfig` 找電腦 IPv4（如 192.168.1.20），手機開 `http://192.168.1.20:8000`。

## 三、部署到 GitHub Pages（正式、免費、隨時可用）
```bash
# 1) 確認工具
git --version
gh --version            # 沒有就裝 GitHub CLI: https://cli.github.com/

# 2) 登入
gh auth login

# 3) 初始化並提交（在 D:\vocabulary）
git init
git add .
git commit -m "phase1"

# 4) 建立 repo 並推送
gh repo create vocabulary --public --source=. --remote=origin --push

# 5) 開啟 Pages（main 分支、根目錄）
gh api -X POST repos/{owner}/vocabulary/pages -f "source[branch]=main" -f "source[path]=/" 2>$null
#   若上述指令失敗，改用網頁手動：
#   GitHub repo → Settings → Pages → Source 選 Deploy from a branch
#   → 分支 main、資料夾 / (root) → Save
```
完成後網址：`https://<你的帳號>.github.io/vocabulary/`（首次生效約需 1–3 分鐘）。

> `.gitignore` 已排除原始 `學測6000字.xlsx`，但**保留 `data/vocab.json`** 讓網站可用。

備援：不想用指令可用 **GitHub Desktop** 拖拉發佈，或 GitHub 網頁「Add file → Upload files」上傳整個資料夾。

## 四、孩子手機安裝
- **iPhone**：用 **Safari** 開網址 → 下方分享鈕 → 「加入主畫面」。
- **Android**：用 **Chrome** 開網址 → 右上選單 → 「安裝應用程式／加到主畫面」。
- 進度存在各自手機本機；正式使用後**固定用同一個 GitHub 網址**，不要再換來源，以免進度對不起來。

---

## 路徑注意（重要）
所有資源皆使用**相對路徑**（`./`），`manifest.json` 的 `start_url`/`scope` 與 `service-worker.js` 註冊皆相對，確保在 GitHub Pages 子路徑 `/vocabulary/` 下正常運作、可離線。

## 檔案結構
```
index.html, manifest.json, service-worker.js
css/styles.css
js/  app.js db.js srs.js quiz.js lookup.js report.js stats.js vocab.js util.js
data/ vocab.json
icons/ icon-192.png icon-512.png
scripts/ build_vocab.py
學測6000字.xlsx           （原始來源，不上傳）
build_report.txt
```

## Phase 2（後續）
- 字根字首：`data/roots.json` + `scripts/tag_roots.py` + 字根分頁與成組練習。
- 例句批次生成：`scripts/gen_examples.py`（Level 4–6，可續跑）。
- 每日提醒：裝置通知（盡力而為）＋「加入行事曆 .ics」備援（最穩定，建議一定要設）。
