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

## 每日練習提醒（設定頁）
固定時間提醒孩子去練。純前端、免費，分兩層：
- **第二層（最可靠，建議一定要設）**：設定頁按「📅 加入到手機行事曆」會下載一個 `.ics`（每日重複 `RRULE:FREQ=DAILY` ＋ `VALARM` 鬧鈴）。孩子點開檔案匯入手機內建行事曆後，**每天到點一定會跳提醒**，跨 iPhone／Android、不靠 App 是否開著。
- **第一層（裝置通知，盡力而為）**：按「🔔 開啟裝置通知」授權後：
  - App 開著時，到提醒時間會跳本機通知（最準）。
  - Android 安裝版 PWA 另嘗試 Periodic Background Sync 背景提醒（瀏覽器自行決定時機，不保證準時）。
  - **iOS 限制**：iOS 16.4+ 對「已加入主畫面的 PWA」才支援通知，且本機背景排程限制多——iOS 上請務必使用第二層的「加入行事曆」。
- 點通知會直接開到測驗畫面。每個身分各自的提醒時間獨立。

## 已完成功能總覽（Phase 1–3）
- 核心：強迫測驗、打字作答、SM-2＋四狀態、查單字＝自動記錄、雙身分、每日報告、匯出入、離線 PWA。
- 字根字首：`data/roots.json` + `scripts/tag_roots.py` + 字根分頁（瀏覽/搜尋/衍生字/加入），單字卡字根拆解圖＋同字根家族。
- 例句：`scripts/gen_examples.py`，**全六級 6008 字 100% 例句＋中譯**（造句測驗、單字卡離線可用）。
- 學習日曆＋當日學習（先讀→拼字＋造句默寫比對）；查單字升級（片語＋本地查無自動上網查 → 自訂單字）；自訂群組（標籤）；手動出題（排字到某天）；每日提醒。
