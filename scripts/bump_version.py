# -*- coding: utf-8 -*-
"""
bump_version.py — 同步升 App 版本號

必須同時改兩處且字串相同，否則手機拿不到新版：
  service-worker.js 的 APP_VERSION
  js/state.js       的 APP_UI_VERSION

用法：
    python scripts/bump_version.py            # 自動用 年-月-日-yp時分
    python scripts/bump_version.py 2026-07-23-abc   # 指定版本字串
"""
import os
import re
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SW = os.path.join(ROOT, "service-worker.js")
ST = os.path.join(ROOT, "js", "state.js")


def replace_version(path, pattern, newver):
    with open(path, encoding="utf-8") as f:
        s = f.read()
    new, n = re.subn(pattern, lambda m: m.group(1) + newver + m.group(3), s, count=1)
    if n != 1:
        print(f"❌ 在 {os.path.basename(path)} 找不到版本字串，沒有更動。", file=sys.stderr)
        sys.exit(1)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(new)


def main():
    ver = sys.argv[1] if len(sys.argv) > 1 else datetime.now().strftime("%Y-%m-%d-yp%H%M")
    replace_version(SW, r"(APP_VERSION = ')([^']*)(')", ver)
    replace_version(ST, r"(APP_UI_VERSION = ')([^']*)(')", ver)
    print(f"✅ 版本已升為 {ver}（service-worker.js 與 js/state.js 已同步）")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
