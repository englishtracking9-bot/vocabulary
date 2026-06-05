# -*- coding: utf-8 -*-
"""
build_vocab.py
讀取 學測6000字.xlsx（工作表「學測6000字(111)」），產生 data/vocab.json 與 build_report.txt。

設計依據（任務規格第二節）：
- 六級單字全部載入並全部可追蹤（共 6009 字）。
- 「輸出」欄為公式合併欄，忽略不用。
- 中文空值（1 筆：deplete）→ zh:""，並寫入 build_report.txt，不可崩潰。
- 含括號單字：
  * 單純字尾展開型 enjoy(ment) → answerKeys = ["enjoy", "enjoyment"]，word 顯示原字串。
  * 複雜相關詞型 he (him, his, himself) → answerKeys 只取主字 ["he"]，括號內相關詞放 note 當補充說明（不計分）。
- 每字產生唯一 id（word 正規化），id 衝突會記錄到 build_report.txt。

執行：python scripts/build_vocab.py
（可在 D:\\vocabulary 目錄或其上層執行，會自動定位專案根目錄）
"""

import os
import re
import sys
import json
import io

import pandas as pd

# 確保標準輸出為 UTF-8（Windows 主控台預設可能是 cp950）
try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
except Exception:
    pass

# ---- 定位專案根目錄（此檔位於 <root>/scripts/）----
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)

XLSX_PATH = os.path.join(ROOT, "學測6000字.xlsx")
SHEET_NAME = "學測6000字(111)"
DATA_DIR = os.path.join(ROOT, "data")
OUT_JSON = os.path.join(DATA_DIR, "vocab.json")
REPORT_PATH = os.path.join(ROOT, "build_report.txt")

# 括號（半形與全形皆處理）
PAREN_RE = re.compile(r"[\(（](.*?)[\)）]")


def clean_token(s: str) -> str:
    """正規化成可比對的答案字串：去前後空白、轉小寫。保留內部字元（如 - / .）。"""
    return s.strip().lower()


def make_slug(s: str) -> str:
    """產生 id 用 slug：小寫、非英數轉為 -，去頭尾 -。"""
    s = s.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = s.strip("-")
    return s or "x"


def process_word(raw: str):
    """
    回傳 (display_word, answer_keys[list], note[str|None])
    """
    w = str(raw).strip()
    display = w
    note = None

    m = PAREN_RE.search(w)
    if m:
        inside = m.group(1).strip()
        before = w[: m.start()].strip()
        after = w[m.end():].strip()

        is_complex = ("," in inside) or ("，" in inside) or (" " in inside)
        if is_complex:
            # 複雜相關詞型：只取主字當答案，括號內相關詞做補充說明（不計分）
            base = before if before else PAREN_RE.sub("", w).strip()
            keys = [clean_token(base)]
            note = inside  # 例：him, his, himself
        else:
            # 單純字尾展開型：base 與 完整展開 都算對
            without_parens = (before + inside + after).strip()
            keys = []
            if before:
                keys.append(clean_token(before))
            keys.append(clean_token(without_parens))
    else:
        keys = [clean_token(w)]

    # 去重、去空、保序
    seen = set()
    answer_keys = []
    for k in keys:
        if k and k not in seen:
            seen.add(k)
            answer_keys.append(k)

    return display, answer_keys, note


def main():
    report_lines = []

    def log(msg):
        print(msg)
        report_lines.append(msg)

    log("=== build_vocab.py 執行報告 ===")
    log(f"專案根目錄：{ROOT}")

    if not os.path.exists(XLSX_PATH):
        log(f"[錯誤] 找不到來源檔：{XLSX_PATH}")
        _write_report(report_lines)
        sys.exit(1)

    df = pd.read_excel(XLSX_PATH, sheet_name=SHEET_NAME)
    log(f"讀取工作表：{SHEET_NAME}，原始筆數：{len(df)}")

    required_cols = ["級別", "單字", "屬性", "中文"]
    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        log(f"[錯誤] 缺少必要欄位：{missing}；實際欄位：{list(df.columns)}")
        _write_report(report_lines)
        sys.exit(1)

    os.makedirs(DATA_DIR, exist_ok=True)

    items = []
    id_map = {}            # id -> 第一次使用該 id 的單字
    entry_by_id = {}       # id -> entry（供重複字合併詞性）
    id_collisions = []     # (slug, 原字, 既有字)
    dup_words = []         # 同字同級別重複列（已合併略過）
    empty_zh = []          # 中文空值的單字
    complex_paren = []     # 複雜括號（相關詞）單字
    simple_paren = []      # 單純字尾展開單字
    level_count = {i: 0 for i in range(1, 7)}

    for _, row in df.iterrows():
        # 級別 → 整數
        try:
            level = int(float(row["級別"]))
        except Exception:
            level = 0
        if level in level_count:
            level_count[level] += 1

        display, answer_keys, note = process_word(row["單字"])

        # 詞性原樣保留
        pos = "" if pd.isna(row["屬性"]) else str(row["屬性"]).strip()

        # 中文：空值 → ""
        if pd.isna(row["中文"]):
            zh = ""
            empty_zh.append(display)
        else:
            zh = str(row["中文"]).strip()

        if note is not None:
            complex_paren.append(display)
        elif PAREN_RE.search(display):
            simple_paren.append(display)

        # 產生唯一 id
        base_slug = make_slug(answer_keys[0] if answer_keys else display)

        # 同字同級別重複列：合併詞性後略過，不產生重複 id
        if base_slug in id_map and id_map[base_slug] == display:
            existing = entry_by_id[base_slug]
            if existing.get("level") == level:
                dup_words.append(display)
                # 合併不同詞性（保留較完整資訊）
                if pos and pos not in existing.get("pos", ""):
                    parts = [p for p in (existing.get("pos", ""), pos) if p]
                    existing["pos"] = " / ".join(parts)
                continue

        slug = base_slug
        n = 2
        while slug in id_map and id_map[slug] != display:
            id_collisions.append((base_slug, display, id_map[slug]))
            slug = f"{base_slug}-{n}"
            n += 1
        id_map.setdefault(slug, display)

        entry = {
            "id": slug,
            "word": display,
            "pos": pos,
            "zh": zh,
            "level": level,
            "answerKeys": answer_keys,
            "example": "",        # Phase 1 留空，查單字時即時補
            "root": None,         # Phase 2 由 tag_roots.py 填入
        }
        if note is not None:
            entry["note"] = note  # 補充說明（相關詞），不計分

        items.append(entry)
        entry_by_id[slug] = entry

    # 寫出 vocab.json
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=1)

    log("")
    log("=== 統計 ===")
    log(f"總輸出筆數：{len(items)}")
    for lv in range(1, 7):
        log(f"  Level {lv}: {level_count[lv]} 筆")
    log(f"  Level 1-3 小計：{sum(level_count[i] for i in (1,2,3))}")
    log(f"  Level 4-6 小計：{sum(level_count[i] for i in (4,5,6))}")
    log("")
    log(f"中文空值（已標記 zh:\"\"）：{len(empty_zh)} 筆 -> {empty_zh}")
    log(f"單純字尾展開括號字：{len(simple_paren)} 筆")
    log(f"複雜相關詞括號字（相關詞存入 note，不計分）：{len(complex_paren)} 筆 -> {complex_paren}")
    log(f"同字同級別重複列（已合併詞性略過）：{len(dup_words)} 筆 -> {dup_words}")
    log(f"id 衝突（已自動加序號避開）：{len(id_collisions)} 筆")
    for slug, a, b in id_collisions[:50]:
        log(f"    slug '{slug}'：'{a}' 與既有 '{b}' 衝突")
    log("")
    log(f"已輸出：{OUT_JSON}")

    _write_report(report_lines)
    log(f"已輸出報告：{REPORT_PATH}")


def _write_report(lines):
    try:
        with open(REPORT_PATH, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    except Exception as e:
        print(f"[警告] 無法寫入報告檔：{e}")


if __name__ == "__main__":
    main()
