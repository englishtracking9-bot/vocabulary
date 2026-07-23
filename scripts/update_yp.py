# -*- coding: utf-8 -*-
"""
update_yp.py — 一鍵更新 YP 單字書：匯入 Excel → 升版本 → 上傳 GitHub

由「更新YP單字書.bat」呼叫（批次檔只負責把主控台切成 UTF-8 再執行本檔；
中文訊息全部由 Python 輸出，避免 cmd.exe 用 Big5 解析批次檔造成亂碼）。

任何一步失敗都會停下來，不會上傳半套。
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable or "python"


def line(ch="=", n=46):
    print(ch * n)


def run(cmd, allow_fail=False):
    """執行指令並把輸出直接顯示出來。回傳是否成功。"""
    r = subprocess.run(cmd, cwd=ROOT)
    return r.returncode == 0 or allow_fail


def fail(msg):
    print()
    line("*")
    print("  失敗了，沒有上傳任何東西")
    line("*")
    print(msg)
    print()
    print("請把上面的訊息截圖傳給我。")
    return 1


def main():
    print()
    line()
    print("   一鍵更新 YP 單字書 － 匯入並上線")
    line()

    print("\n[1/4] 讀 Excel、重新產生 data/books.json ...\n")
    if not run([PY, os.path.join("scripts", "build_books.py")]):
        return fail("匯入 Excel 失敗。常見原因：Excel 檔案正開著沒關閉，\n"
                    "或檔名不是 YP_levelN_vocabulary.xlsx（N 是數字）。")

    print("\n[2/4] 升 App 版本（手機才會拿到新字）...")
    if not run([PY, os.path.join("scripts", "bump_version.py")]):
        return fail("升版本失敗（找不到版本字串）。")

    print("\n[3/4] 上傳到 GitHub ...")
    files = ["data/books.json", "service-worker.js", "js/state.js"]
    files += [f for f in os.listdir(ROOT) if f.startswith("YP_level") and f.endswith(".xlsx")]
    if not run(["git", "add"] + files):
        return fail("git add 失敗。")
    # 沒有變更時 commit 會回傳非 0，屬正常情況
    run(["git", "commit", "-m", "更新 YP 單字書內容"], allow_fail=True)
    if not run(["git", "push"]):
        return fail("上傳 GitHub 失敗。可能是沒連上網路，或 GitHub 登入過期。")

    print()
    line()
    print("   [4/4] 完成！已經上線")
    line()
    try:
        with open(os.path.join(ROOT, "scripts", ".last_import.txt"), encoding="utf-8") as f:
            print(f.read().strip())
    except OSError:
        pass
    print()
    print("手機怎麼拿到新字：")
    print("  連著網路，把 App 關掉重開兩次")
    print("  （第一次下載新版、第二次生效）。")
    print("  版本標籤在「測驗」頁最下面，變成新日期就對了。")
    print()
    print("孩子已有的學習進度不會被影響，只更新單字內容。")
    print()
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
