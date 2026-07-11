# 英文單字記憶系統 — 開發鐵則

純本地 PWA（無雲端）。家長電腦：排程／出題碼QR／列印；孩子手機：作答與紀錄。
QR／出題碼只單向傳「字的編號清單＋題型」，成績不回傳（未來由「完成碼」補這一段）。

## 🔴 鐵則（違反會默默弄壞既有資料，不會報錯）

1. **`data/vocab.json` 只能在尾端加字，絕不能中間插入、刪除或重排。**
   出題碼 V1/V2 存的是「字在 vocab.json 裡的位置編號」——順序一變，
   所有已印出的紙本 QR 與家長存的出題碼都會**默默解出錯的字**。
   `scripts/build_vocab.py` 重跑前必須先 diff 確認既有字的順序完全不變。

2. **每次 push 前同步升兩處版本號**：`service-worker.js` 的 `APP_VERSION`
   與 `js/app.js` 的 `APP_UI_VERSION`（字串須相同）。忘了升＝手機拿不到新版。

3. **學習進度只存 IndexedDB**（`vocabApp` v6），禁用 localStorage 存進度。
   單字熟練度的唯一定義在 `js/srs.js`（`computeStatus`／`applyAnswer`）；
   所有作答一律經 `js/quiz.js` 的 `recordAnswer` 寫入，不得直接手改 records。

4. **重構紀律**：純重構＝不改功能、不改行為、不動資料；會改行為的事先問使用者。
   小步提交、每步可回退；重大變更前有 git tag 備份點（如 `pre-refactor-2026-07-11`）。

## 驗收慣例

每項功能改完：手機尺寸（375×812、白底）自測 → 回報驗收方式 → commit+push →
升 SW 版本 → 告知手機如何拿到新版（連網重開 App，版本標籤在「測驗」「更多」頁底部）。
