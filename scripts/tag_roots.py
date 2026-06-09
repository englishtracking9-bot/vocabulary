# -*- coding: utf-8 -*-
"""
tag_roots.py — 為 vocab.json 加上「字根拆解」與「分組標籤(group keys)」，
並輸出 data/groups_index.json（每個分組的成員與共同記憶點）。

分組依優先序（由強到弱）：
  (1) 同字根/字首/字尾   group key: root:* / prefix:* / suffix:*
  (2) 相同前綴規律        （由 prefix 標籤搭配 groups.json 的 prefixRules 顯示規律）
  (3) 字幹延伸/複合字     compound:*
  (4) 拼字相似/形近字     confuse:*
  (5) 主題群組            theme:*
  (6) 同反義對照          antonym:*

防呆原則（不硬湊）：
  - 字根(root)：只採用 roots.json 中人工策劃的 examples（與 vocab 交集），不做子字串亂猜。
  - 字首(prefix)：除 examples 外，允許「去掉字首後剩下的仍是表內真單字」的安全擴充
    （unhappy→happy ✓；uncle→cle ✗ 不誤判）。
  - 複合字：只採 groups.json 人工清單（且兩個組成都在表內），避免 carpet=car+pet 的誤拆。

執行：python scripts/tag_roots.py   （請先跑過 build_vocab.py 產生 vocab.json）
"""
import os, sys, json, io

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
VOCAB = os.path.join(DATA, "vocab.json")
ROOTS = os.path.join(DATA, "roots.json")
GROUPS = os.path.join(DATA, "groups.json")
INDEX_OUT = os.path.join(DATA, "groups_index.json")
REPORT = os.path.join(ROOT, "tag_roots_report.txt")

PRIORITY = {"root": 1, "prefix": 1, "suffix": 1, "compound": 3, "confuse": 4, "theme": 5, "antonym": 6}


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def main():
    log_lines = []
    def log(m):
        print(m); log_lines.append(m)

    vocab = load(VOCAB)
    roots = load(ROOTS)
    groups = load(GROUPS)

    # ---- 建立查找表 ----
    # clean word（answerKeys[0] 或 word 小寫）→ entry
    by_word = {}
    word_set = set()
    for e in vocab:
        keys = e.get("answerKeys") or [e["word"].lower()]
        primary = keys[0].lower().strip()
        if primary not in by_word:
            by_word[primary] = e
        for k in keys:
            word_set.add(k.lower().strip())
        # 重置標籤欄（可重複執行）
        e["groupKeys"] = []
        e["root"] = None

    def entry_of(word):
        return by_word.get(word.lower().strip())

    def wid(word):
        e = entry_of(word)
        return e["id"] if e else None

    # 依 type 整理 affix
    prefixes = {r["affix"]: r for r in roots if r["type"] == "prefix"}
    suffixes = {r["affix"]: r for r in roots if r["type"] == "suffix"}
    root_affixes = {r["affix"]: r for r in roots if r["type"] == "root"}

    index = {}  # groupKey -> {type, label, memo, members:set}

    def add_member(group_key, gtype, label, memo, word):
        e = entry_of(word)
        if not e:
            return False
        if group_key not in index:
            index[group_key] = {"type": gtype, "label": label, "memo": memo, "members": []}
        if e["id"] not in index[group_key]["members"]:
            index[group_key]["members"].append(e["id"])
        if group_key not in e["groupKeys"]:
            e["groupKeys"].append(group_key)
        return True

    # ---- (1a) 字根 root：人工 examples ∩ vocab ----
    for affix, r in root_affixes.items():
        key = f"root:{affix}"
        label = f"字根 {affix}（{r['meaning']}）"
        memo = f"這組字都含字根 {affix}＝{r['meaning']}。{r.get('note','')}".strip()
        for w in r.get("examples", []):
            add_member(key, "root", label, memo, w)

    # ---- (1b) 字首 prefix：examples + 安全擴充 ----
    for affix, r in prefixes.items():
        key = f"prefix:{affix}"
        label = f"字首 {affix}-（{r['meaning']}）"
        memo = f"這組字都用字首 {affix}-＝{r['meaning']}。{r.get('note','')}".strip()
        for w in r.get("examples", []):
            add_member(key, "prefix", label, memo, w)

    # 安全擴充：去掉字首後剩下仍是真單字
    for e in vocab:
        primary = (e.get("answerKeys") or [e["word"].lower()])[0].lower().strip()
        if not primary.isalpha():
            continue
        for affix, r in prefixes.items():
            if len(primary) - len(affix) >= 3 and primary.startswith(affix):
                remainder = primary[len(affix):]
                if remainder in word_set:
                    add_member(f"prefix:{affix}", "prefix",
                               f"字首 {affix}-（{r['meaning']}）",
                               f"這組字都用字首 {affix}-＝{r['meaning']}。{r.get('note','')}".strip(),
                               primary)

    # ---- (1c) 字尾 suffix：examples ∩ vocab ----
    for affix, r in suffixes.items():
        key = f"suffix:{affix}"
        label = f"字尾 -{affix}（{r['meaning']}）"
        memo = f"這組字都用字尾 -{affix}＝{r['meaning']}。{r.get('note','')}".strip()
        for w in r.get("examples", []):
            add_member(key, "suffix", label, memo, w)

    # ---- (3) 複合字 compound：依共同組成字分組 ----
    # 蒐集每個 base part 對應的複合字
    part_members = {}
    for c in groups.get("compounds", []):
        w = c["word"]
        parts = c["parts"]
        if not entry_of(w):
            continue
        if not all(p in word_set for p in parts):
            continue
        for p in parts:
            part_members.setdefault(p, []).append((w, c.get("memo", "")))
    for part, items in part_members.items():
        if len(items) < 2:
            continue  # 只有一個複合字不成組
        key = f"compound:{part}"
        label = f"複合字：含「{part}」"
        memo = f"這組都是含「{part}」的複合字，拆開來記更快（例：{items[0][0]}＝{items[0][1]}）"
        for w, _ in items:
            add_member(key, "compound", label, memo, w)

    # ---- (4) 形近易混字 confusable ----
    for i, c in enumerate(groups.get("confusables", [])):
        present = [w for w in c["words"] if entry_of(w)]
        if len(present) < 2:
            continue
        key = f"confuse:{i}"
        label = "形近易混字（放一起對比）"
        for w in present:
            add_member(key, "confuse", label, c.get("memo", ""), w)

    # ---- (5) 主題群組 theme ----
    for name, words in groups.get("themes", {}).items():
        present = [w for w in words if entry_of(w)]
        if len(present) < 2:
            continue
        key = f"theme:{name}"
        label = f"主題：{name}"
        memo = f"這組都是「{name}」主題的字，一起記建立語意網絡"
        for w in present:
            add_member(key, "theme", label, memo, w)

    # ---- (6) 同反義對照 antonym ----
    for i, c in enumerate(groups.get("antonyms", [])):
        present = [w for w in c["words"] if entry_of(w)]
        if len(present) < 2:
            continue
        key = f"antonym:{i}"
        label = "同反義對照"
        for w in present:
            add_member(key, "antonym", label, c.get("memo", ""), w)

    # ---- 字根拆解（root 欄）：為 root 家族的字建立教學用拆解 ----
    # 取較長的優先，避免短字首誤切
    pref_sorted = sorted(prefixes.items(), key=lambda kv: -len(kv[0]))
    suf_sorted = sorted(suffixes.items(), key=lambda kv: -len(kv[0]))
    decomposed = 0
    for affix, r in root_affixes.items():
        for w in set(r.get("examples", [])):
            e = entry_of(w)
            if not e or e.get("root"):
                continue
            word = (e.get("answerKeys") or [e["word"].lower()])[0].lower().strip()
            parts = []
            # 找字首
            matched_pre = None
            for paffix, pr in pref_sorted:
                if word.startswith(paffix) and len(word) - len(paffix) >= 3:
                    matched_pre = (paffix, pr); break
            if matched_pre:
                parts.append({"part": matched_pre[0] + "-", "mean": matched_pre[1]["meaning"]})
            # 字根本體（用 canonical affix 與意義）
            parts.append({"part": affix, "mean": r["meaning"]})
            # 找字尾
            matched_suf = None
            for saffix, sr in suf_sorted:
                if word.endswith(saffix) and len(word) - len(saffix) >= 3 and saffix != affix:
                    matched_suf = (saffix, sr); break
            if matched_suf:
                parts.append({"part": "-" + matched_suf[0], "mean": matched_suf[1]["meaning"]})
            e["root"] = parts
            decomposed += 1

    # ---- 字根拆解擴充：prefix 家族（安全：去字首後仍是表內真單字）----
    # 例：unhappy = un-(不) + happy(快樂)。only 對已被歸為 prefix 家族的字補拆解。
    pref_decomposed = 0
    for e in vocab:
        if e.get("root"):
            continue
        pkeys = [k for k in e.get("groupKeys", []) if k.startswith("prefix:")]
        if not pkeys:
            continue
        word = (e.get("answerKeys") or [e["word"].lower()])[0].lower().strip()
        if not word.isalpha():
            continue
        # 取最長的字首（避免 in- 蓋過 inter-）
        affixes = sorted((k.split(":", 1)[1] for k in pkeys), key=lambda a: -len(a))
        for affix in affixes:
            if not word.startswith(affix):
                continue
            remainder = word[len(affix):]
            if len(remainder) < 3 or remainder not in word_set:
                continue
            base = entry_of(remainder)
            if not base:
                continue
            pr = prefixes.get(affix)
            if not pr:
                continue
            e["root"] = [
                {"part": affix + "-", "mean": pr["meaning"]},
                {"part": remainder, "mean": base.get("zh", "")},
            ]
            pref_decomposed += 1
            break

    # ---- F-1/F-3：記憶聯想句(mnemonic) 與 可念音節(syllable) ----
    def clean_zh(z):
        z = (z or "").strip()
        # 取第一個語意（避免太長），以常見分隔符切
        for sep in ["；", ";", "（", "(", "，"]:
            if sep in z:
                z = z.split(sep)[0].strip()
                break
        return z

    mnem_cnt = 0
    syl_cnt = 0
    for e in vocab:
        parts = e.get("root")
        if not isinstance(parts, list) or not parts:
            e["mnemonic"] = None
            e["syllable"] = None
            continue
        means = [p.get("mean", "").strip() for p in parts if p.get("mean", "").strip()]
        zh = clean_zh(e.get("zh", ""))
        # 記憶聯想
        if len(means) >= 2 and zh:
            e["mnemonic"] = "＋".join(means) + " → " + zh
            mnem_cnt += 1
        elif len(means) == 1 and zh:
            seg = parts[0].get("part", "").strip("-")
            e["mnemonic"] = f"{seg}＝{means[0]}，聯想「{zh}」"
            mnem_cnt += 1
        else:
            e["mnemonic"] = None
        # 可念音節：僅當各部位拼起來「剛好」等於拼字才顯示（不亂拆）
        word = (e.get("answerKeys") or [e["word"].lower()])[0].lower().strip()
        recon = "".join(p.get("part", "").replace("-", "") for p in parts)
        if recon == word and len(parts) >= 2:
            e["syllable"] = "-".join(p.get("part", "").strip("-") for p in parts)
            syl_cnt += 1
        else:
            e["syllable"] = None

    # ---- 寫出 ----
    # groups_index：移除成員<2 的組
    final_index = {k: v for k, v in index.items() if len(v["members"]) >= 2}
    # 同步清掉 entry 上指向已被移除組的標籤
    valid_keys = set(final_index.keys())
    for e in vocab:
        e["groupKeys"] = [k for k in e.get("groupKeys", []) if k in valid_keys]

    with open(VOCAB, "w", encoding="utf-8") as f:
        json.dump(vocab, f, ensure_ascii=False, indent=1)
    with open(INDEX_OUT, "w", encoding="utf-8") as f:
        json.dump(final_index, f, ensure_ascii=False, indent=1)

    # ---- 報告 ----
    by_type = {}
    for k, v in final_index.items():
        by_type.setdefault(v["type"], 0)
        by_type[v["type"]] += 1
    tagged_words = sum(1 for e in vocab if e.get("groupKeys"))

    log("=== tag_roots.py 報告 ===")
    log(f"roots.json affix 數：{len(roots)}（prefix {len(prefixes)} / root {len(root_affixes)} / suffix {len(suffixes)}）")
    log(f"產生分組數（成員≥2）：{len(final_index)}")
    for t in ["root", "prefix", "suffix", "compound", "confuse", "theme", "antonym"]:
        log(f"   {t}: {by_type.get(t,0)} 組")
    log(f"有分組標籤的單字數：{tagged_words} / {len(vocab)}（{round(tagged_words/len(vocab)*100)}%）")
    total_root = sum(1 for e in vocab if e.get("root"))
    log(f"完成字根拆解的單字數：{decomposed}（root家族）＋{pref_decomposed}（prefix家族）＝{total_root}")
    log(f"產生記憶聯想句：{mnem_cnt}；可念音節：{syl_cnt}")
    log("")
    log("—— 分組範例（前 8 組）——")
    shown = 0
    for k, v in final_index.items():
        if shown >= 8:
            break
        names = []
        for mid in v["members"][:8]:
            me = next((x for x in vocab if x["id"] == mid), None)
            if me:
                names.append(me["word"])
        log(f"[{k}] {v['label']}｜成員{len(v['members'])}：{', '.join(names)}")
        log(f"    共同記憶點：{v['memo']}")
        shown += 1
    log("")
    log("—— 字根拆解範例 ——")
    cnt = 0
    for e in vocab:
        if e.get("root") and cnt < 6:
            seg = " + ".join(f"{p['part']}({p['mean']})" for p in e["root"])
            log(f"   {e['word']} = {seg}")
            cnt += 1

    with open(REPORT, "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines) + "\n")
    log(f"\n已輸出：{VOCAB}、{INDEX_OUT}、{REPORT}")


if __name__ == "__main__":
    main()
