# -*- coding: utf-8 -*-
"""
gen_senses.py — 一字多義（senses）結構遷移與合併。

每個單字 e 會有 e["senses"] = [ {pos, zh, example, example_zh}, ... ]（最多 3 個主要義項）。
- 來源：data/senses/*.json（{ wordId: [ {pos,zh,example,example_zh}, ... ] }）。H 階段就放各 Level 的義項檔。
- 向後相容：若某字沒有 curated 義項，就用既有單一 zh/example/example_zh 遷移成 senses[0]。
- 同步頂層欄位：對「有 curated 義項」的字，把頂層 zh/pos/example/example_zh 設為 senses[0]（主要義項），
  確保測驗提示、我的單字、報告等讀 e.zh/e.example 的舊程式維持正確。
- 冪等：每次重建 senses（不累加）。

執行：python scripts/gen_senses.py   （在 build_vocab/gen_examples 之後、tag_roots 之前或之後皆可；
       建議放在 tag_roots 之前，使字根聯想句用到的 e.zh 為最終主要義項。）
"""
import os, sys, io, json, glob

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
VOCAB = os.path.join(DATA, "vocab.json")
SENSES_DIR = os.path.join(DATA, "senses")


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def clean_sense(s):
    return {
        "pos": (s.get("pos") or "").strip(),
        "zh": (s.get("zh") or "").strip(),
        "example": (s.get("example") or "").strip(),
        "example_zh": (s.get("example_zh") or "").strip(),
    }


def main():
    vocab = load(VOCAB)

    # 合併所有義項來源檔
    source = {}
    files = sorted(glob.glob(os.path.join(SENSES_DIR, "*.json"))) if os.path.isdir(SENSES_DIR) else []
    for fp in files:
        try:
            data = load(fp)
        except Exception as e:
            print(f"⚠️ 略過 {os.path.basename(fp)}：{e}")
            continue
        for wid, senses in data.items():
            if isinstance(senses, list) and senses:
                source[wid] = [clean_sense(s) for s in senses][:3]

    curated = migrated = 0
    sense_total = 0
    for e in vocab:
        wid = e.get("id")
        if wid in source and source[wid]:
            senses = source[wid]
            # 同步頂層為主要義項（senses[0]），維持舊程式相容
            first = senses[0]
            e["zh"] = first["zh"] or e.get("zh", "")
            if first["pos"]:
                e["pos"] = first["pos"]
            e["example"] = first["example"]
            e["example_zh"] = first["example_zh"]
            # 頂層 pos 用各義項詞性合併（去重、保序），較完整
            poses = []
            for s in senses:
                if s["pos"] and s["pos"] not in poses:
                    poses.append(s["pos"])
            if poses:
                e["pos"] = "/".join(poses)
            e["senses"] = senses
            curated += 1
        else:
            # 遷移：用既有單一欄位作 senses[0]
            e["senses"] = [{
                "pos": e.get("pos", ""),
                "zh": e.get("zh", ""),
                "example": (e.get("example") or "").strip(),
                "example_zh": (e.get("example_zh") or "").strip(),
            }]
            migrated += 1
        sense_total += len(e["senses"])

    with open(VOCAB, "w", encoding="utf-8") as f:
        json.dump(vocab, f, ensure_ascii=False, indent=1)

    multi = sum(1 for e in vocab if len(e.get("senses", [])) >= 2)
    print("=== gen_senses.py 報告 ===")
    print(f"義項來源檔：{len(files)} 個（{', '.join(os.path.basename(x) for x in files) or '無'}）")
    print(f"curated（多義來源）字數：{curated}；遷移（單一義項）字數：{migrated}")
    print(f"總字數：{len(vocab)}；有 2+ 義項的字：{multi}；平均每字義項數：{round(sense_total/len(vocab),3)}")
    print("—— 多義範例（前 8）——")
    shown = 0
    for e in vocab:
        if len(e.get("senses", [])) >= 2 and shown < 8:
            segs = "；".join(f"{s['pos']} {s['zh']}" for s in e["senses"])
            print(f"   {e['word']}：{segs}")
            shown += 1


if __name__ == "__main__":
    main()
