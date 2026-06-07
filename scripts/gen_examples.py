# -*- coding: utf-8 -*-
"""
gen_examples.py — 把 data/examples/*.json 內由 Claude 分批撰寫的標準例句，
合併寫回 vocab.json 的 example（英文例句）與 example_zh（中文翻譯）欄位。

- 可續跑：重跑只會補上新例句、覆蓋同 id 的舊例句，不影響其他資料。
- examples 來源檔格式（每檔一批）：
    { "wordId": {"en": "英文例句", "zh": "中文翻譯"}, ... }

執行：python scripts/gen_examples.py
回報：已覆蓋 X/總數、各 Level 覆蓋率、仍缺例句的字數。
"""
import os, sys, json, io, glob

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
VOCAB = os.path.join(DATA, "vocab.json")
EX_DIR = os.path.join(DATA, "examples")
REPORT = os.path.join(ROOT, "gen_examples_report.txt")


def main():
    vocab = json.load(open(VOCAB, encoding="utf-8"))
    by_id = {e["id"]: e for e in vocab}

    merged = 0
    files = sorted(glob.glob(os.path.join(EX_DIR, "*.json")))
    unknown = []
    for fp in files:
        batch = json.load(open(fp, encoding="utf-8"))
        for wid, data in batch.items():
            e = by_id.get(wid)
            if not e:
                unknown.append((os.path.basename(fp), wid))
                continue
            en = (data.get("en") or "").strip()
            zh = (data.get("zh") or "").strip()
            if en:
                e["example"] = en
                e["example_zh"] = zh
                merged += 1

    json.dump(vocab, open(VOCAB, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # 統計
    total = len(vocab)
    have = sum(1 for e in vocab if e.get("example"))
    lines = []
    def log(m):
        print(m); lines.append(m)

    log("=== gen_examples.py 報告 ===")
    log(f"來源批次檔：{len(files)} 個")
    log(f"本次合併例句：{merged} 筆")
    log(f"已有例句：{have}/{total}（{round(have/total*100,1)}%）")
    for lv in range(1, 7):
        words = [e for e in vocab if e["level"] == lv]
        n = sum(1 for e in words if e.get("example"))
        log(f"   Level {lv}: {n}/{len(words)}（{round(n/max(1,len(words))*100)}%）")
    if unknown:
        log(f"⚠️ 找不到對應 id 的例句：{len(unknown)} 筆")
        for f, w in unknown[:20]:
            log(f"     {f} -> {w}")

    open(REPORT, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    log(f"\n已輸出：{VOCAB}、{REPORT}")


if __name__ == "__main__":
    main()
