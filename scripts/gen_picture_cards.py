# -*- coding: utf-8 -*-
"""gen_picture_cards.py — 產生 🖼️ 圖解記憶卡
SVG → PNG（預覽，放 scripts/_cards_build/，不需上傳）→ WebP（images/cards/，App 用）＋ data/picture_cards.json

需求：rsvg-convert（librsvg）、Pillow、Noto Sans CJK TC 字型。
新增字：在 CARDS 區塊照格式 add(...)，id 必須是 vocab.json 已有的字 id（只用 id 對應，不碰 vocab.json 順序）。
"""
import json, os, subprocess, re
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "scripts", "_cards_build")
W, H = 1080, 1540
FONT = "Noto Sans CJK TC, sans-serif"

PALETTE = {
    1: ("#e65100", "#fff3e0"), 2: ("#2e7d32", "#e8f5e9"), 3: ("#1565c0", "#e3f2fd"),
    4: ("#c62828", "#ffebee"), 5: ("#6a1b9a", "#f3e5f5"), 6: ("#00838f", "#e0f7fa"),
    7: ("#ad1457", "#fce4ec"), 0: ("#455a64", "#eceff1"),
}

# ---------------- 小零件 ----------------
def kid(x, y, s=1.0, body="#5c6bc0", face="smile", skin="#ffd8a8"):
    """簡單小人：x,y 為頭中心"""
    r = 55 * s
    faces = {
        "smile": f'<path d="M{x-20*s} {y+15*s} Q{x} {y+35*s} {x+20*s} {y+15*s}" stroke="#333" stroke-width="{6*s}" fill="none" stroke-linecap="round"/>',
        "flat": f'<path d="M{x-18*s} {y+22*s} L{x+18*s} {y+22*s}" stroke="#333" stroke-width="{6*s}" stroke-linecap="round"/>',
        "o": f'<ellipse cx="{x}" cy="{y+22*s}" rx="{11*s}" ry="{9*s}" fill="#333"/>',
        "sad": f'<path d="M{x-18*s} {y+28*s} Q{x} {y+12*s} {x+18*s} {y+28*s}" stroke="#333" stroke-width="{6*s}" fill="none" stroke-linecap="round"/>',
        "sleep": f'<path d="M{x-14*s} {y+22*s} L{x+14*s} {y+22*s}" stroke="#333" stroke-width="{5*s}" stroke-linecap="round"/>',
    }
    eyes = (f'<path d="M{x-30*s} {y-5*s} q10 8 20 0 M{x+10*s} {y-5*s} q10 8 20 0" stroke="#333" stroke-width="{5*s}" fill="none"/>'
            if face == "sleep" else
            f'<circle cx="{x-20*s}" cy="{y-5*s}" r="{7*s}" fill="#333"/><circle cx="{x+20*s}" cy="{y-5*s}" r="{7*s}" fill="#333"/>')
    return (f'<rect x="{x-45*s}" y="{y+r-5*s}" width="{90*s}" height="{120*s}" rx="{35*s}" fill="{body}"/>'
            f'<circle cx="{x}" cy="{y}" r="{r}" fill="{skin}"/>{eyes}{faces[face]}')


def label(x, y, big, small, color, anchor="start"):
    return (f'<text x="{x}" y="{y}" font-size="44" font-weight="900" fill="{color}" text-anchor="{anchor}">{big}</text>'
            f'<text x="{x}" y="{y+48}" font-size="32" fill="#777" text-anchor="{anchor}">{small}</text>')


def bubble(x, y, w, h, text, color, size=34):
    return (f'<rect x="{x-w/2}" y="{y-h/2}" width="{w}" height="{h}" rx="{h/2}" fill="#fff" stroke="{color}" stroke-width="5"/>'
            f'<text x="{x}" y="{y+size*0.35}" font-size="{size}" text-anchor="middle" fill="{color}" font-weight="700">{text}</text>')


# ---------------- 21＋3 張卡的內容 ----------------
# 每張：id, day, phon, pos, zh, tag, lines(3), en(1-2 行), zh_sent, tip, art(fn of color)
CARDS = []

def add(**k):
    CARDS.append(k)

# ===== Day 1：個性 (1) =====
add(id="arrogant", day=1, phon="/ˈær.ə.ɡənt/", pos="adj.", zh="傲慢的、自大的", tag="趣味拆字",
    lines=["arrog + ant（螞蟻）",
           "一隻戴著皇冠、鼻孔朝天的螞蟻，",
           "什麼都要別人服侍 → 傲慢的、自大的！"],
    en=["The arrogant player never passes", "the ball to his teammates."],
    zh_sent="那個傲慢的球員從不把球傳給隊友。",
    tip="口訣：鼻孔朝天的螞蟻 ant → arrogant",
    art=lambda c: f'''
<ellipse cx="540" cy="590" rx="320" ry="26" fill="#f1e4d0"/>
<!-- ant body -->
<ellipse cx="380" cy="470" rx="110" ry="80" fill="#5d4037"/>
<ellipse cx="545" cy="455" rx="70" ry="60" fill="#6d4c41"/>
<circle cx="660" cy="330" r="85" fill="#795548"/>
<path d="M330 540 l-40 60 M400 545 l-10 65 M520 505 l10 85 M570 500 l50 80" stroke="#4e342e" stroke-width="14" stroke-linecap="round"/>
<path d="M620 250 Q590 160 540 150 M690 248 Q720 160 770 140" stroke="#4e342e" stroke-width="10" fill="none" stroke-linecap="round"/>
<circle cx="540" cy="150" r="12" fill="#4e342e"/><circle cx="770" cy="140" r="12" fill="#4e342e"/>
<!-- crown -->
<path d="M600 255 L615 205 L645 240 L665 195 L690 240 L715 205 L725 258 Z" fill="#ffd54f" stroke="#ff8f00" stroke-width="4"/>
<!-- face: nose up, closed smug eyes -->
<path d="M640 320 q12 -10 24 0 M690 312 q12 -10 24 0" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round"/>
<path d="M680 365 q25 -8 45 -30" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round"/>
<!-- small servant ants -->
<g transform="translate(150,520) scale(.45)"><ellipse cx="0" cy="0" rx="70" ry="50" fill="#a1887f"/><circle cx="90" cy="-20" r="45" fill="#a1887f"/><circle cx="100" cy="-28" r="6" fill="#333"/></g>
<g transform="translate(870,520) scale(-.45,.45)"><ellipse cx="0" cy="0" rx="70" ry="50" fill="#a1887f"/><circle cx="90" cy="-20" r="45" fill="#a1887f"/><circle cx="100" cy="-28" r="6" fill="#333"/></g>
{bubble(300, 120, 360, 80, "本王最厲害！", c)}
{label(820, 420, "ant", "螞蟻", c)}
''')

add(id="naive", day=1, phon="/nɑˈiv/", pos="adj.", zh="天真的、幼稚的", tag="字源記憶",
    lines=["naive 和 native 是親戚：nat = 出生",
           "像「剛出生」的寶寶一樣，",
           "別人說什麼都相信 → 天真的！"],
    en=["It is naive to believe everything", "you read online."],
    zh_sent="相信網路上看到的每件事是很天真的。",
    tip="口訣：剛出生 (nat) 的寶寶最天真",
    art=lambda c: f'''
<rect x="60" y="0" width="960" height="620" rx="30" fill="#1a237e"/>
<circle cx="200" cy="80" r="4" fill="#fff"/><circle cx="420" cy="50" r="3" fill="#fff"/><circle cx="900" cy="300" r="4" fill="#fff"/><circle cx="130" cy="350" r="3" fill="#fff"/>
<!-- cheese moon -->
<circle cx="760" cy="170" r="120" fill="#ffd54f"/>
<circle cx="720" cy="140" r="20" fill="#ffca28"/><circle cx="800" cy="210" r="26" fill="#ffca28"/><circle cx="790" cy="120" r="12" fill="#ffca28"/>
{bubble(760, 330, 380, 72, "月亮是起司做的！", "#ff8f00", 32)}
<!-- baby -->
<circle cx="380" cy="400" r="95" fill="#ffd8a8"/>
<path d="M370 305 q10 -30 30 -10" stroke="#8d6e63" stroke-width="6" fill="none"/>
<circle cx="345" cy="390" r="14" fill="#333"/><circle cx="415" cy="390" r="14" fill="#333"/>
<circle cx="350" cy="384" r="5" fill="#fff"/><circle cx="420" cy="384" r="5" fill="#fff"/>
<ellipse cx="380" cy="445" rx="20" ry="14" fill="#e57373"/>
<rect x="300" y="490" width="160" height="110" rx="50" fill="#f8bbd0"/>
<!-- bottle -->
<rect x="470" y="450" width="40" height="90" rx="12" fill="#e3f2fd" stroke="#90caf9" stroke-width="4"/>
<rect x="478" y="430" width="24" height="24" rx="8" fill="#ffcc80"/>
<text x="560" y="560" font-size="44" font-weight="900" fill="#fff">nat = 出生</text>
''')

add(id="eccentric", day=1, phon="/ɪkˈsɛn.trɪk/", pos="adj.", zh="古怪的、異於常人的", tag="字根拆解",
    lines=["ec- = 出去　centr = 中心（center）",
           "跑「出中心」以外，和大家都不一樣",
           "→ 古怪的、行為異常的！"],
    en=["My eccentric uncle wears", "sunglasses even at night."],
    zh_sent="我那個古怪的叔叔連晚上都戴太陽眼鏡。",
    tip="口訣：跑出 (ec) 中心 (center) → 怪怪的",
    art=lambda c: f'''
<circle cx="380" cy="330" r="250" fill="#ffccbc"/>
<circle cx="380" cy="330" r="180" fill="#fff"/>
<circle cx="380" cy="330" r="110" fill="#ffccbc"/>
<circle cx="380" cy="330" r="45" fill="{c}"/>
<!-- crowd in center: plain dots -->
<circle cx="350" cy="320" r="16" fill="#90a4ae"/><circle cx="395" cy="310" r="16" fill="#90a4ae"/><circle cx="375" cy="355" r="16" fill="#90a4ae"/><circle cx="410" cy="350" r="16" fill="#90a4ae"/>
<text x="380" y="440" font-size="30" text-anchor="middle" fill="#777">center 中心</text>
<!-- odd guy outside -->
<path d="M560 330 Q700 300 760 360" stroke="{c}" stroke-width="8" fill="none" stroke-dasharray="14 10"/>
<path d="M745 340 l25 25 l-35 8" fill="{c}"/>
{kid(860, 330, 1.0, "#ab47bc", "smile")}
<rect x="805" y="305" width="45" height="28" rx="8" fill="#212121"/><rect x="870" y="305" width="45" height="28" rx="8" fill="#212121"/>
<path d="M820 270 L860 180 L900 270 Z" fill="#43a047"/><circle cx="860" cy="178" r="14" fill="#ffeb3b"/>
<text x="860" y="140" font-size="40" font-weight="900" fill="{c}" text-anchor="middle">ec- 出去</text>
''')

# ===== Day 2：個性 (2) =====
add(id="obstinate", day=2, phon="/ˈɑb.stə.nɪt/", pos="adj.", zh="固執的、頑固的", tag="字根拆解",
    lines=["ob- = 對著、反抗　stin = 站（stand）",
           "擋在你面前「站著」怎麼拉都不動，",
           "→ 固執的、頑固的！"],
    en=["The obstinate boy refused to apologize,", "even though he was wrong."],
    zh_sent="那個固執的男孩明明錯了卻拒絕道歉。",
    tip="口訣：對著 (ob) 站 (stin) 死不動",
    art=lambda c: f'''
<rect x="60" y="560" width="960" height="40" fill="#a1887f"/>
<!-- donkey -->
<ellipse cx="640" cy="400" rx="190" ry="110" fill="#9e9e9e"/>
<path d="M500 480 l-30 90 M560 495 l-10 80 M720 495 l10 80 M790 480 l40 90" stroke="#757575" stroke-width="26" stroke-linecap="round"/>
<path d="M790 330 Q860 230 900 250 Q950 290 900 360 Q860 390 800 380 Z" fill="#9e9e9e"/>
<path d="M860 245 l-10 -70 l30 60 M890 255 l20 -70 l5 75" fill="#757575" stroke="#757575" stroke-width="8"/>
<circle cx="890" cy="290" r="9" fill="#333"/>
<path d="M870 330 l40 -5" stroke="#333" stroke-width="6" stroke-linecap="round"/>
<path d="M455 390 q-30 30 -10 70" stroke="#757575" stroke-width="12" fill="none"/>
<!-- rope & kid pulling -->
<path d="M905 330 Q980 360 1000 420" stroke="#8d6e63" stroke-width="8" fill="none"/>
<path d="M300 380 L470 395" stroke="#8d6e63" stroke-width="8"/>
{kid(230, 330, 0.95, "#42a5f5", "o")}
<path d="M260 420 L300 385" stroke="#42a5f5" stroke-width="22" stroke-linecap="round"/>
<path d="M150 320 q-15 25 0 40" stroke="#4fc3f7" stroke-width="6" fill="none"/>
{bubble(640, 170, 300, 80, "我就是不動！", c)}
{label(110, 110, "ob + stin", "對著＋站", c)}
''')

add(id="skeptical", day=2, phon="/ˈskɛp.tɪ.kəl/", pos="adj.", zh="懷疑的、存疑的", tag="字源記憶",
    lines=["skept 源自希臘文「仔細看」（和 scope 鏡同源）",
           "拿著放大鏡一看再看，",
           "不肯輕易相信 → 懷疑的！"],
    en=["Mom was skeptical when I said I finished", "all my homework in ten minutes."],
    zh_sent="我說十分鐘就寫完功課時，媽媽一臉懷疑。",
    tip="口訣：skept = 拿放大鏡一直看 → 懷疑",
    art=lambda c: f'''
<!-- homework sheet -->
<rect x="560" y="140" width="330" height="420" rx="16" fill="#fff" stroke="#bdbdbd" stroke-width="5" transform="rotate(6 725 350)"/>
<text x="730" y="230" font-size="40" text-anchor="middle" fill="#333" font-weight="700" transform="rotate(6 725 350)">功課 ✔</text>
<path d="M610 290 h220 M610 340 h200 M610 390 h230 M610 440 h170" stroke="#e0e0e0" stroke-width="10" transform="rotate(6 725 350)"/>
<text x="730" y="520" font-size="34" text-anchor="middle" fill="#e53935" transform="rotate(6 725 350)">10 分鐘寫完！</text>
<!-- mom -->
<circle cx="300" cy="300" r="100" fill="#ffd8a8"/>
<path d="M200 290 Q200 170 300 175 Q400 170 400 290 Q380 220 300 225 Q220 220 200 290Z" fill="#5d4037"/>
<path d="M245 285 l40 8 M355 280 l-35 10" stroke="#333" stroke-width="8" stroke-linecap="round"/>
<circle cx="265" cy="310" r="9" fill="#333"/><circle cx="335" cy="310" r="9" fill="#333"/>
<path d="M275 360 h50" stroke="#333" stroke-width="7" stroke-linecap="round"/>
<rect x="220" y="400" width="160" height="170" rx="50" fill="#ec407a"/>
<!-- magnifier -->
<circle cx="500" cy="330" r="70" fill="#e1f5fe" fill-opacity=".6" stroke="{c}" stroke-width="14"/>
<path d="M450 385 L390 450" stroke="#5d4037" stroke-width="22" stroke-linecap="round"/>
<text x="120" y="130" font-size="80" font-weight="900" fill="{c}">？？</text>
''')

add(id="versatile", day=2, phon="/ˈvɝ.sə.təl/", pos="adj.", zh="多才多藝的、用途廣的", tag="字根拆解",
    lines=["vers = 轉（reverse 反轉、universe）",
           "-ile = 能…的 → 能轉向各種方向，",
           "什麼都會 → 多才多藝的！"],
    en=["A smartphone is a versatile tool:", "it is a camera, a map, and a dictionary."],
    zh_sent="智慧型手機用途很廣：它是相機、地圖，也是字典。",
    tip="口訣：轉 (vers) 一轉就換一種本領",
    art=lambda c: f'''
<circle cx="540" cy="320" r="250" fill="none" stroke="{c}" stroke-width="8" stroke-dasharray="20 14"/>
<path d="M770 210 l30 -40 l15 50" fill="{c}"/><path d="M310 430 l-30 40 l-15 -50" fill="{c}"/>
{kid(540, 290, 1.2, "#66bb6a", "smile")}
<!-- tools around -->
<g transform="translate(300,140)"><circle r="55" fill="#fff" stroke="#ff7043" stroke-width="6"/><path d="M-30 -10 h60 M0 -40 v70" stroke="#ff7043" stroke-width="6"/><circle r="30" fill="none" stroke="#ff7043" stroke-width="6"/></g>
<text x="300" y="235" font-size="30" text-anchor="middle" fill="#777">運動</text>
<g transform="translate(780,140)"><rect x="-40" y="-30" width="80" height="60" rx="10" fill="#42a5f5"/><circle r="18" fill="#fff"/></g>
<text x="880" y="150" font-size="30" text-anchor="middle" fill="#777">拍照</text>
<g transform="translate(260,520)"><path d="M-20 30 L-20 -40 L35 -55 L35 15" stroke="#7e57c2" stroke-width="8" fill="none"/><circle cx="-32" cy="30" r="16" fill="#7e57c2"/><circle cx="23" cy="15" r="16" fill="#7e57c2"/></g>
<text x="260" y="600" font-size="30" text-anchor="middle" fill="#777">音樂</text>
<g transform="translate(820,510)"><path d="M-40 40 L30 -30" stroke="#8d6e63" stroke-width="12" stroke-linecap="round"/><path d="M30 -30 l25 -25" stroke="#e53935" stroke-width="18" stroke-linecap="round"/></g>
<text x="820" y="600" font-size="30" text-anchor="middle" fill="#777">畫畫</text>
''')

# ===== Day 3：說話與感受 =====
add(id="eloquent", day=3, phon="/ˈɛl.ə.kwənt/", pos="adj.", zh="雄辯的、有口才的", tag="字根拆解",
    lines=["e- = 出來　loqu = 說話（dialogue 也有 log）",
           "話一句句流暢地「說出來」，",
           "→ 有口才的、雄辯的！"],
    en=["Her eloquent speech won first prize", "in the English contest."],
    zh_sent="她那場有說服力的演講拿下英文比賽第一名。",
    tip="口訣：e (出) + loqu (說) → 說出好口才",
    art=lambda c: f'''
<!-- podium -->
<path d="M380 420 L700 420 L660 600 L420 600 Z" fill="#8d6e63"/>
<rect x="360" y="400" width="360" height="30" rx="10" fill="#6d4c41"/>
<circle cx="540" cy="395" r="10" fill="#333"/><path d="M540 395 l0 -40" stroke="#333" stroke-width="6"/>
{kid(540, 270, 1.1, c, "o")}
<!-- words flowing -->
<g font-weight="900" fill="{c}">
<text x="700" y="140" font-size="44">Ladies and</text>
<text x="760" y="200" font-size="40">gentlemen…</text>
<text x="80" y="160" font-size="44">e + loqu</text>
<text x="80" y="210" font-size="32" fill="#777" font-weight="400">出 ＋ 說</text>
</g>
<path d="M610 250 Q680 210 700 160" stroke="{c}" stroke-width="5" fill="none"/>
<!-- audience -->
<circle cx="160" cy="560" r="35" fill="#90a4ae"/><circle cx="240" cy="575" r="35" fill="#b0bec5"/>
<circle cx="840" cy="560" r="35" fill="#90a4ae"/><circle cx="920" cy="575" r="35" fill="#b0bec5"/>
<text x="200" y="480" font-size="40" font-weight="900" fill="#ff8f00">哇～</text>
<text x="830" y="480" font-size="40" font-weight="900" fill="#ff8f00">好棒！</text>
''')

add(id="vague", day=3, phon="/veɡ/", pos="adj.", zh="模糊的、含糊的", tag="字源記憶",
    lines=["vag = 遊蕩（vagabond 流浪漢）",
           "說話飄來飄去、到處流浪不落地，",
           "→ 含糊的、模糊的！"],
    en=["His answer was so vague that nobody", "knew whether he agreed or not."],
    zh_sent="他的回答太含糊，沒人知道他到底同不同意。",
    tip="口訣：話在霧裡流浪 (vag) → 模糊",
    art=lambda c: f'''
<!-- fog -->
<g fill="#cfd8dc" opacity=".9">
<ellipse cx="300" cy="300" rx="260" ry="120"/><ellipse cx="650" cy="260" rx="300" ry="140"/><ellipse cx="520" cy="420" rx="380" ry="120"/>
</g>
<g fill="#eceff1" opacity=".9"><ellipse cx="420" cy="340" rx="200" ry="80"/><ellipse cx="720" cy="380" rx="200" ry="70"/></g>
<!-- floating words -->
<g font-weight="700" fill="#78909c">
<text x="160" y="240" font-size="46" transform="rotate(-8 160 240)">大概吧…</text>
<text x="600" y="210" font-size="46" transform="rotate(6 600 210)">也許…</text>
<text x="330" y="380" font-size="46">好像是…</text>
<text x="700" y="420" font-size="40" transform="rotate(-5 700 420)">再說啦</text>
</g>
{kid(540, 520, 0.7, "#90a4ae", "flat")}
<text x="80" y="90" font-size="44" font-weight="900" fill="{c}">vag = 遊蕩</text>
''')

add(id="compassion", day=3, phon="/kəmˈpæʃ.ən/", pos="n.", zh="同情、憐憫", tag="字根拆解",
    lines=["com- = 一起　passion = 感受、受苦",
           "和別人「一起」感受他的痛，",
           "→ 同情、憐憫！"],
    en=["The nurse treated every patient", "with compassion."],
    zh_sent="那位護理師用同理心對待每一位病人。",
    tip="口訣：一起 (com) 感受 (passion) 痛",
    art=lambda c: f'''
<ellipse cx="540" cy="590" rx="320" ry="24" fill="#f8e1e7"/>
{kid(420, 330, 1.2, "#f06292", "smile")}
{kid(660, 360, 1.05, "#90a4ae", "sad")}
<path d="M600 345 q-6 20 0 30 q6 -10 0 -30z" fill="#4fc3f7"/>
<path d="M480 450 Q560 420 610 450" stroke="#f06292" stroke-width="28" fill="none" stroke-linecap="round"/>
<!-- hearts -->
<path d="M540 170 c-25 -40 -80 -10 -50 30 l50 45 l50 -45 c30 -40 -25 -70 -50 -30z" fill="#e91e63"/>
<path d="M380 120 c-12 -20 -40 -5 -25 15 l25 22 l25 -22 c15 -20 -12 -35 -25 -15z" fill="#f48fb1"/>
<path d="M720 110 c-12 -20 -40 -5 -25 15 l25 22 l25 -22 c15 -20 -12 -35 -25 -15z" fill="#f48fb1"/>
{label(110, 230, "com", "一起", c)}
{label(820, 260, "passion", "感受", c)}
''')

# ===== Day 4：危險 =====
add(id="predator", day=4, phon="/ˈprɛd.ə.tɚ/", pos="n.", zh="掠食者、捕食動物", tag="諧音記憶",
    lines=["predator 念起來像「撲來的」",
           "突然「撲」過來、把小動物抓走的，",
           "→ 掠食者！"],
    en=["The eagle is a predator that hunts", "small animals from the sky."],
    zh_sent="老鷹是從空中獵捕小動物的掠食者。",
    tip="口訣：撲來的 (predator) 就是掠食者",
    art=lambda c: f'''
<rect x="60" y="540" width="960" height="70" rx="20" fill="#c5e1a5"/>
<!-- lion pouncing -->
<g transform="translate(120,120) rotate(12 300 200)">
<ellipse cx="300" cy="230" rx="200" ry="95" fill="#ffb300"/>
<circle cx="520" cy="190" r="115" fill="#e65100"/>
<circle cx="520" cy="190" r="80" fill="#ffca28"/>
<circle cx="500" cy="175" r="10" fill="#333"/><circle cx="550" cy="175" r="10" fill="#333"/>
<path d="M495 220 q30 25 60 0" fill="#fff" stroke="#333" stroke-width="5"/>
<path d="M500 222 l6 14 l6 -12 M530 224 l6 14 l6 -12" fill="#fff" stroke="#333" stroke-width="3"/>
<path d="M420 300 l70 70 M450 290 l110 40 M180 300 l-60 80 M220 310 l-20 90" stroke="#ffa000" stroke-width="34" stroke-linecap="round"/>
<path d="M100 220 q-60 -40 -40 -110" stroke="#ffa000" stroke-width="16" fill="none"/>
</g>
<!-- rabbit -->
<ellipse cx="880" cy="520" rx="60" ry="45" fill="#fff" stroke="#bdbdbd" stroke-width="4"/>
<circle cx="920" cy="470" r="35" fill="#fff" stroke="#bdbdbd" stroke-width="4"/>
<ellipse cx="905" cy="410" rx="12" ry="40" fill="#fff" stroke="#bdbdbd" stroke-width="4"/><ellipse cx="935" cy="410" rx="12" ry="40" fill="#fff" stroke="#bdbdbd" stroke-width="4"/>
<circle cx="930" cy="468" r="6" fill="#333"/>
<text x="780" y="380" font-size="40" font-weight="900" fill="{c}">救命！</text>
{bubble(250, 70, 300, 80, "撲來的！", c, 42)}
''')

add(id="lethal", day=4, phon="/ˈli.θəl/", pos="adj.", zh="致命的、致死的", tag="諧音記憶",
    lines=["lethal 念起來像「立死喔」",
           "碰到就「立刻死掉」的東西，",
           "→ 致命的！"],
    en=["Some mushrooms in the forest are lethal,", "so never eat wild ones."],
    zh_sent="森林裡有些蘑菇是致命的，所以絕對別吃野生的。",
    tip="口訣：立死喔 (lethal) → 致命的",
    art=lambda c: f'''
<ellipse cx="540" cy="590" rx="330" ry="24" fill="#dcedc8"/>
<!-- mushrooms -->
<rect x="310" y="380" width="90" height="200" rx="30" fill="#fff8e1" stroke="#d7ccc8" stroke-width="5"/>
<path d="M170 400 Q355 120 540 400 Z" fill="#d32f2f"/>
<circle cx="290" cy="320" r="24" fill="#fff"/><circle cx="380" cy="270" r="20" fill="#fff"/><circle cx="430" cy="345" r="18" fill="#fff"/>
<rect x="650" y="440" width="70" height="140" rx="25" fill="#fff8e1" stroke="#d7ccc8" stroke-width="5"/>
<path d="M560 450 Q685 250 810 450 Z" fill="#7b1fa2"/>
<circle cx="660" cy="390" r="15" fill="#fff"/><circle cx="720" cy="360" r="13" fill="#fff"/>
<!-- skull sign -->
<rect x="820" y="140" width="10" height="200" fill="#8d6e63"/>
<rect x="740" y="80" width="170" height="130" rx="14" fill="#fff59d" stroke="#333" stroke-width="5"/>
<circle cx="825" cy="135" r="34" fill="#fff" stroke="#333" stroke-width="4"/>
<circle cx="812" cy="132" r="8" fill="#333"/><circle cx="838" cy="132" r="8" fill="#333"/>
<path d="M800 180 l50 -20 M800 160 l50 20" stroke="#333" stroke-width="6"/>
{bubble(250, 90, 300, 80, "立死喔！", c, 42)}
''')

add(id="vulnerable", day=4, phon="/ˈvʌl.nɚ.ə.bəl/", pos="adj.", zh="易受傷害的、脆弱的", tag="字根拆解",
    lines=["vulner = 傷口（拉丁文 vulnus）",
           "-able = 能…的 → 「能被弄傷」的，",
           "→ 易受傷害的、脆弱的！"],
    en=["Without its shell, a turtle is", "vulnerable to attack."],
    zh_sent="沒有殼的話，烏龜很容易受到攻擊。",
    tip="口訣：能 (able) 被弄出傷口 (vulner)",
    art=lambda c: f'''
<ellipse cx="540" cy="590" rx="330" ry="24" fill="#e0f2f1"/>
<!-- empty shell -->
<path d="M620 520 Q760 280 900 520 Z" fill="#6d9c3c"/>
<path d="M660 500 L760 340 L860 500 M700 450 h120" stroke="#4e7a26" stroke-width="8" fill="none"/>
<text x="760" y="575" font-size="30" text-anchor="middle" fill="#777">殼不見了</text>
<!-- naked turtle -->
<ellipse cx="330" cy="470" rx="140" ry="90" fill="#a5d6a7"/>
<circle cx="490" cy="420" r="60" fill="#a5d6a7"/>
<circle cx="505" cy="405" r="9" fill="#333"/>
<path d="M485 450 q15 -10 30 0" stroke="#333" stroke-width="5" fill="none"/>
<path d="M520 380 q-6 18 0 26 q6 -8 0 -26z" fill="#4fc3f7"/>
<path d="M230 540 l-20 40 M300 555 v40 M380 555 v40 M440 540 l20 40" stroke="#81c784" stroke-width="22" stroke-linecap="round"/>
<!-- bandage -->
<rect x="290" y="420" width="90" height="34" rx="12" fill="#ffcc80" transform="rotate(-20 335 437)"/>
<!-- bird threat -->
<path d="M180 160 q60 -50 120 0 q60 -50 120 0" stroke="#37474f" stroke-width="12" fill="none" stroke-linecap="round"/>
<text x="120" y="110" font-size="40" font-weight="900" fill="{c}">vulner = 傷口</text>
''')

# ===== Day 5：壞事怪事 =====
add(id="kidnap", day=5, phon="/ˈkɪd.næp/", pos="v.", zh="綁架、誘拐", tag="拆字記憶",
    lines=["kid = 小孩　nap = 小睡、午覺",
           "小孩在「睡午覺」時被人抱走，",
           "→ 綁架！"],
    en=["In the movie, the bad guys kidnap", "the scientist's daughter."],
    zh_sent="電影裡，壞人綁架了科學家的女兒。",
    tip="口訣：kid 睡 nap 時被抓走 → kidnap",
    art=lambda c: f'''
<!-- bed -->
<rect x="160" y="420" width="520" height="90" rx="20" fill="#90caf9"/>
<rect x="140" y="340" width="40" height="230" rx="12" fill="#8d6e63"/><rect x="660" y="380" width="40" height="190" rx="12" fill="#8d6e63"/>
<rect x="210" y="380" width="120" height="50" rx="20" fill="#fff"/>
{kid(280, 360, 0.8, "#ffb74d", "sleep")}
<rect x="320" y="400" width="320" height="50" rx="20" fill="#ffe082"/>
<text x="300" y="290" font-size="52" font-weight="900" fill="#90a4ae">Zzz</text>
<!-- shadowy hand -->
<path d="M1000 160 Q800 180 700 280" stroke="#424242" stroke-width="60" fill="none" stroke-linecap="round"/>
<path d="M690 300 l-60 -10 M690 300 l-55 20 M690 300 l-40 45 M695 300 l-10 55" stroke="#424242" stroke-width="20" stroke-linecap="round"/>
{label(180, 110, "kid", "小孩", c)}
{label(480, 110, "nap", "午覺", c)}
<text x="760" y="460" font-size="44" font-weight="900" fill="{c}">嘿嘿…</text>
''')

add(id="notorious", day=5, phon="/noˈtor.i.əs/", pos="adj.", zh="惡名昭彰的、聲名狼藉的", tag="字根拆解",
    lines=["not = 知道（notice 注意、note 筆記）",
           "壞事做太多，大家「都知道」他，",
           "→ 惡名昭彰的！"],
    en=["This corner is notorious for", "traffic jams during rush hour."],
    zh_sent="這個路口以尖峰時段塞車出名（惡名昭彰）。",
    tip="口訣：人人都知道 (not) 的壞名聲",
    art=lambda c: f'''
<!-- wanted poster -->
<rect x="330" y="40" width="420" height="520" rx="10" fill="#fff3c4" stroke="#8d6e63" stroke-width="8"/>
<text x="540" y="120" font-size="64" font-weight="900" text-anchor="middle" fill="#5d4037">WANTED</text>
<circle cx="540" cy="270" r="100" fill="#ffd8a8"/>
<path d="M440 250 h200" stroke="#212121" stroke-width="40"/>
<circle cx="505" cy="250" r="10" fill="#fff"/><circle cx="575" cy="250" r="10" fill="#fff"/>
<path d="M500 320 q40 -15 80 0" stroke="#333" stroke-width="7" fill="none"/>
<text x="540" y="440" font-size="40" font-weight="900" text-anchor="middle" fill="#c62828">大家都知道他！</text>
<text x="540" y="510" font-size="34" text-anchor="middle" fill="#5d4037">偷吃布丁慣犯</text>
<!-- pointing people -->
{kid(150, 380, 0.8, "#4db6ac", "o")}
<path d="M200 460 L300 420" stroke="#4db6ac" stroke-width="18" stroke-linecap="round"/>
{kid(930, 380, 0.8, "#ff8a65", "o")}
<path d="M880 460 L780 420" stroke="#ff8a65" stroke-width="18" stroke-linecap="round"/>
<text x="150" y="250" font-size="36" font-weight="900" fill="{c}" text-anchor="middle">是他！</text>
<text x="930" y="250" font-size="36" font-weight="900" fill="{c}" text-anchor="middle">我知道！</text>
''')

add(id="bizarre", day=5, phon="/bɪˈzɑr/", pos="adj.", zh="奇異的、怪誕的", tag="諧音記憶",
    lines=["bizarre 念起來像「比薩」",
           "比薩上放珍珠、香蕉、巧克力…",
           "怪到不行 → 奇異的、怪誕的！"],
    en=["Putting bananas on pizza sounds bizarre,", "but some people love it."],
    zh_sent="在比薩上放香蕉聽起來很怪，但有些人很愛。",
    tip="口訣：怪怪的比薩 (bizarre)",
    art=lambda c: f'''
<!-- pizza -->
<circle cx="540" cy="330" r="250" fill="#f9a825"/>
<circle cx="540" cy="330" r="220" fill="#ffe082"/>
<circle cx="540" cy="330" r="205" fill="#ef6c00" opacity=".25"/>
<!-- pearls -->
<g fill="#3e2723"><circle cx="430" cy="230" r="18"/><circle cx="470" cy="210" r="18"/><circle cx="455" cy="250" r="18"/><circle cx="640" cy="420" r="18"/><circle cx="670" cy="400" r="18"/><circle cx="610" cy="440" r="18"/></g>
<!-- bananas -->
<path d="M560 200 q90 20 110 100 q-30 -60 -110 -70z" fill="#fff176" stroke="#f9a825" stroke-width="4"/>
<path d="M380 380 q60 90 150 70 q-80 -10 -130 -90z" fill="#fff176" stroke="#f9a825" stroke-width="4"/>
<!-- chocolate drizzle -->
<path d="M380 300 q40 -30 80 0 t80 0 t80 0 t80 0" stroke="#4e342e" stroke-width="10" fill="none" stroke-linecap="round"/>
<!-- squid -->
<g transform="translate(560,330)"><ellipse rx="34" ry="44" fill="#ffccbc"/><path d="M-25 35 l-10 40 M-8 40 l-4 42 M8 40 l4 42 M25 35 l10 40" stroke="#ffab91" stroke-width="8"/><circle cx="-10" cy="0" r="5" fill="#333"/><circle cx="10" cy="0" r="5" fill="#333"/></g>
{bubble(870, 80, 220, 76, "比薩？！", c, 40)}
''')

# ===== Day 6：日常生活 =====
add(id="pedestrian", day=6, phon="/pəˈdɛs.tri.ən/", pos="n.", zh="行人", tag="字根拆解",
    lines=["ped = 腳（pedal 腳踏板）　-ian = 人",
           "用「腳」走路的「人」，",
           "→ 行人！"],
    en=["Drivers must stop and let", "pedestrians cross the street."],
    zh_sent="駕駛必須停車，讓行人過馬路。",
    tip="口訣：用腳 (ped) 走路的人 (ian)",
    art=lambda c: f'''
<rect x="60" y="300" width="960" height="300" fill="#616161"/>
<g fill="#fff">{''.join(f'<rect x="{x}" y="320" width="70" height="260"/>' for x in range(120, 1000, 130))}</g>
{kid(540, 200, 1.0, c, "smile")}
<path d="M510 300 l-30 90 M570 300 l40 80" stroke="{c}" stroke-width="26" stroke-linecap="round"/>
<!-- footprints -->
<g fill="#ffd54f"><ellipse cx="200" cy="200" rx="22" ry="34"/><ellipse cx="260" cy="150" rx="22" ry="34"/><ellipse cx="800" cy="160" rx="22" ry="34"/><ellipse cx="860" cy="210" rx="22" ry="34"/></g>
<!-- car -->
<rect x="820" y="420" width="190" height="80" rx="20" fill="#e53935"/>
<circle cx="860" cy="505" r="22" fill="#212121"/><circle cx="970" cy="505" r="22" fill="#212121"/>
<text x="915" y="472" font-size="34" font-weight="900" text-anchor="middle" fill="#fff">STOP</text>
{label(110, 80, "ped = 腳", "pedal 踏板", c)}
''')

add(id="tedious", day=6, phon="/ˈti.di.əs/", pos="adj.", zh="冗長乏味的、單調的", tag="諧音記憶",
    lines=["tedious 念起來像「踢地兒死」",
           "一直踢地板踢到快無聊死，",
           "→ 冗長乏味的！"],
    en=["Copying the same word fifty times", "is really tedious."],
    zh_sent="同一個字抄五十遍真的很無聊。",
    tip="口訣：踢地兒死 (tedious) → 無聊死了",
    art=lambda c: f'''
<rect x="60" y="560" width="960" height="40" fill="#bcaaa4"/>
<!-- clock -->
<circle cx="830" cy="170" r="110" fill="#fff" stroke="{c}" stroke-width="10"/>
<path d="M830 170 L830 95 M830 170 L885 200" stroke="#333" stroke-width="10" stroke-linecap="round"/>
<text x="830" y="330" font-size="34" font-weight="700" text-anchor="middle" fill="#777">還要好久…</text>
<!-- bored kid kicking -->
{kid(420, 260, 1.15, "#78909c", "flat")}
<path d="M380 250 h30 M440 250 h30" stroke="#333" stroke-width="6"/>
<path d="M390 420 l-20 130 M450 420 l90 100" stroke="#78909c" stroke-width="30" stroke-linecap="round"/>
<g stroke="#a1887f" stroke-width="5"><path d="M560 540 l20 -15 M570 560 l30 -5 M555 520 l10 -25"/></g>
<text x="620" y="500" font-size="40" font-weight="900" fill="{c}">踢…踢…</text>
<text x="120" y="130" font-size="50" font-weight="900" fill="#90a4ae">唉～</text>
''')

add(id="coincidence", day=6, phon="/koˈɪn.sə.dəns/", pos="n.", zh="巧合", tag="字根拆解",
    lines=["co- = 一起　in = 在上　cid = 落下",
           "兩件事剛好「一起落下」、同時發生，",
           "→ 巧合！"],
    en=["What a coincidence! We are wearing", "the same T-shirt today."],
    zh_sent="真巧！我們今天穿了一樣的 T 恤。",
    tip="口訣：一起 (co) 掉下來 (cid) → 巧合",
    art=lambda c: f'''
{kid(330, 300, 1.2, "#29b6f6", "o")}
{kid(750, 300, 1.2, "#29b6f6", "o")}
<text x="330" y="470" font-size="40" font-weight="900" text-anchor="middle" fill="#fff">★</text>
<text x="750" y="470" font-size="40" font-weight="900" text-anchor="middle" fill="#fff">★</text>
<!-- falling apples -->
<g><circle cx="330" cy="100" r="34" fill="#e53935"/><path d="M330 66 l6 -20" stroke="#5d4037" stroke-width="6"/></g>
<g><circle cx="750" cy="100" r="34" fill="#e53935"/><path d="M750 66 l6 -20" stroke="#5d4037" stroke-width="6"/></g>
<path d="M330 145 v40 M750 145 v40" stroke="#bdbdbd" stroke-width="6" stroke-dasharray="8 8"/>
{bubble(540, 560, 300, 80, "這麼巧！", c, 42)}
{label(520, 130, "co + cid", "一起＋落下", c, "middle")}
''')

# ===== Day 7：努力與心態 =====
add(id="persevere", day=7, phon="/ˌpɝ.səˈvɪr/", pos="v.", zh="堅持不懈、不屈不撓", tag="拆字記憶",
    lines=["per- = 徹底、一路到底　severe = 嚴厲、艱難",
           "再「艱難」也「一路撐到底」，",
           "→ 堅持不懈！"],
    en=["If you persevere, your English", "will improve step by step."],
    zh_sent="只要你堅持下去，英文會一步一步進步。",
    tip="口訣：per (到底) + severe (艱難) 也不放棄",
    art=lambda c: f'''
<path d="M60 600 L540 60 L1020 600 Z" fill="#b0bec5"/>
<path d="M440 172 L540 60 L640 172 L600 150 L560 180 L520 150 L480 180 Z" fill="#fff"/>
<rect x="535" y="10" width="8" height="70" fill="#5d4037"/><path d="M543 12 l60 20 l-60 20z" fill="{c}"/>
<!-- path zigzag -->
<path d="M200 590 L420 470 L300 380 L520 270 L470 200" stroke="#fff" stroke-width="10" fill="none" stroke-dasharray="18 12"/>
<!-- climber -->
{kid(420, 400, 0.8, c, "flat")}
<path d="M380 360 q-6 18 0 26" stroke="#4fc3f7" stroke-width="6" fill="none"/>
<!-- wind & rocks -->
<path d="M720 260 q60 -20 120 0 M740 300 q60 -20 120 0" stroke="#78909c" stroke-width="8" fill="none" stroke-linecap="round"/>
<text x="700" y="380" font-size="36" font-weight="900" fill="#455a64">severe 艱難</text>
<text x="100" y="140" font-size="44" font-weight="900" fill="{c}">per 到底！</text>
''')

add(id="spontaneous", day=7, phon="/spɑnˈte.ni.əs/", pos="adj.", zh="自發的、自然而然的", tag="字源記憶",
    lines=["spont 源自拉丁文 sponte「自己願意」",
           "沒有人叫，自己就主動做了，",
           "→ 自發的、自然而然的！"],
    en=["When the singer finished, the crowd", "broke into spontaneous applause."],
    zh_sent="歌手一唱完，觀眾自然而然地響起掌聲。",
    tip="口訣：spont = 自己願意 → 自發的",
    art=lambda c: f'''
<!-- stage -->
<rect x="340" y="40" width="400" height="260" rx="20" fill="#311b92"/>
<path d="M340 40 L420 300 M740 40 L660 300" stroke="#ffd54f" stroke-width="6" opacity=".5"/>
{kid(540, 150, 0.9, "#ffd54f", "smile")}
<g transform="translate(600,120)"><path d="M0 0 v60" stroke="#fff" stroke-width="6"/><circle cy="0" r="14" fill="#fff"/></g>
<!-- crowd clapping -->
{''.join(kid(x, 450, 0.75, col, "smile") for x, col in [(150,"#ef5350"),(330,"#66bb6a"),(540,"#42a5f5"),(750,"#ffa726"),(930,"#ab47bc")])}
<g font-size="36" font-weight="900" fill="{c}">
<text x="190" y="370">拍拍!</text><text x="580" y="370">拍拍!</text><text x="870" y="370">拍拍!</text>
</g>
{bubble(540, 590, 420, 60, "沒人叫，大家自己拍手", c, 30)}
''')

add(id="abundant", day=7, phon="/əˈbʌn.dənt/", pos="adj.", zh="豐富的、大量的", tag="趣味拆字",
    lines=["a + bun（小圓麵包）+ dant",
           "一籃滿到「溢出來」的小圓麵包，",
           "→ 豐富的、大量的！"],
    en=["Taiwan has abundant fruit,", "especially in summer."],
    zh_sent="台灣水果很豐富，尤其是在夏天。",
    tip="口訣：滿滿的 bun 麵包 → abundant",
    art=lambda c: f'''
<!-- basket -->
<path d="M240 340 L840 340 L770 590 L310 590 Z" fill="#a1887f"/>
<path d="M260 400 h560 M280 460 h520 M300 520 h480" stroke="#8d6e63" stroke-width="8"/>
<path d="M270 340 Q540 120 810 340" stroke="#8d6e63" stroke-width="18" fill="none"/>
<!-- buns overflowing -->
{''.join(f'<ellipse cx="{x}" cy="{y}" rx="62" ry="44" fill="#ffb74d" stroke="#e65100" stroke-width="4"/><path d="M{x-25} {y-10} q25 -15 50 0" stroke="#fff3e0" stroke-width="6" fill="none"/>' for x, y in [(330,320),(450,300),(570,290),(690,305),(800,330),(390,250),(510,230),(630,240),(750,260),(570,175)])}
<ellipse cx="180" cy="560" rx="62" ry="44" fill="#ffb74d" stroke="#e65100" stroke-width="4"/>
<ellipse cx="900" cy="560" rx="62" ry="44" fill="#ffb74d" stroke="#e65100" stroke-width="4"/>
{label(120, 120, "bun", "小圓麵包", c)}
<text x="760" y="110" font-size="40" font-weight="900" fill="{c}">滿出來了！</text>
''')

# ===== 範例（第一次做的 3 張） =====
add(id="ponder", day=0, phon="/ˈpɑn.dɚ/", pos="v.", zh="仔細考慮、沉思", tag="諧音記憶",
    lines=["ponder 念起來像「胖的」",
           "胖的人坐在椅子上一動也不動，",
           "托著下巴「沉思」：要不要吃宵夜？"],
    en=["She sat by the window to ponder whether", "she should study abroad."],
    zh_sent="她坐在窗邊，仔細考慮要不要出國唸書。",
    tip="口訣：胖的 (ponder) 人最愛沉思",
    art=lambda c: f'''
<ellipse cx="540" cy="600" rx="330" ry="30" fill="#f1e4d0"/>
<rect x="330" y="470" width="420" height="40" rx="14" fill="#a9744f"/>
<rect x="350" y="505" width="26" height="100" fill="#8a5a3a"/><rect x="704" y="505" width="26" height="100" fill="#8a5a3a"/>
<ellipse cx="540" cy="390" rx="185" ry="150" fill="#ffb74d"/>
<ellipse cx="540" cy="420" rx="110" ry="95" fill="#ffe0b2"/>
<circle cx="540" cy="185" r="105" fill="#ffd8a8"/>
<circle cx="490" cy="175" r="11" fill="#333"/><circle cx="590" cy="175" r="11" fill="#333"/>
<path d="M505 230 Q540 220 575 230" stroke="#333" stroke-width="7" fill="none" stroke-linecap="round"/>
<path d="M650 360 Q640 290 590 262" stroke="#ffd8a8" stroke-width="44" fill="none" stroke-linecap="round"/>
<circle cx="585" cy="262" r="30" fill="#ffd8a8"/>
<circle cx="700" cy="120" r="14" fill="#fff" stroke="{c}" stroke-width="4"/>
<circle cx="740" cy="80" r="22" fill="#fff" stroke="{c}" stroke-width="4"/>
<ellipse cx="870" cy="60" rx="140" ry="85" fill="#fff" stroke="{c}" stroke-width="5"/>
<text x="870" y="45" font-size="34" text-anchor="middle" fill="{c}" font-weight="700">要吃宵夜嗎…？</text>
<path d="M800 115 L860 115 L860 80 Z" fill="#ffcc80" stroke="#e65100" stroke-width="3"/><circle cx="852" cy="76" r="8" fill="#e53935"/>
<ellipse cx="910" cy="95" rx="26" ry="20" fill="#a1662f"/>
{label(200, 120, "胖的", "ponder", c)}
''')

add(id="dilemma", day=0, phon="/dəˈlɛm.ə/", pos="n.", zh="困境、進退兩難", tag="拆解＋諧音",
    lines=["di- = 二（two，像 dioxide 二氧化物）",
           "dilemma 念起來像「地雷嘛」",
           "兩條路都可能踩「地雷嘛」→ 兩難！"],
    en=["Choosing between the two universities", "put Amy in a real dilemma."],
    zh_sent="要在兩所大學中做選擇，讓 Amy 陷入兩難。",
    tip="口訣：二條路都是地雷嘛 → dilemma",
    art=lambda c: f'''
<path d="M540 600 L540 380 L230 120" stroke="#cfd8dc" stroke-width="90" fill="none" stroke-linejoin="round"/>
<path d="M540 380 L850 120" stroke="#cfd8dc" stroke-width="90" fill="none"/>
<g transform="translate(250,135)"><circle r="42" fill="#37474f"/><rect x="-6" y="-62" width="12" height="24" fill="#37474f"/><circle cx="0" cy="-66" r="9" fill="#ff5252"/><text y="14" font-size="36" text-anchor="middle" fill="#fff" font-weight="900">A</text></g>
<g transform="translate(830,135)"><circle r="42" fill="#37474f"/><rect x="-6" y="-62" width="12" height="24" fill="#37474f"/><circle cx="0" cy="-66" r="9" fill="#ff5252"/><text y="14" font-size="36" text-anchor="middle" fill="#fff" font-weight="900">B</text></g>
<text x="250" y="40" font-size="36" text-anchor="middle" fill="#c62828" font-weight="900">地雷？</text>
<text x="830" y="40" font-size="36" text-anchor="middle" fill="#c62828" font-weight="900">地雷？</text>
{kid(540, 430, 1.0, "#5c6bc0", "o")}
{label(140, 560, "di = 二", "兩條路", c)}
{label(780, 560, "lemma", "≈ 雷嘛", "#c62828")}
''')

add(id="hypocrite", day=0, phon="/ˈhɪp.ə.krɪt/", pos="n.", zh="偽君子、偽善者", tag="字根拆解",
    lines=["hypo- = 在…下面（hypodermic 皮下的）",
           "-crite ← 希臘文 hypokritēs「舞台演員」",
           "躲在「面具下面」演戲的人 → 偽君子！"],
    en=["He tells us not to use phones in class,", "but he is always on his own—what a hypocrite!"],
    zh_sent="他叫我們上課別滑手機，自己卻一直滑——真是偽君子！",
    tip="口訣：面具下 (hypo) 在演戲 (crite)",
    art=lambda c: f'''
<path d="M60 0 Q160 300 90 640 L60 640z" fill="#c62828"/>
<path d="M1020 0 Q920 300 990 640 L1020 640z" fill="#c62828"/>
<rect x="60" y="0" width="960" height="40" fill="#b71c1c"/>
<rect x="90" y="600" width="900" height="30" fill="#8d6e63"/>
<circle cx="610" cy="300" r="150" fill="#a5d6a7"/>
<path d="M650 230 l60 20 M760 230 l-50 20" stroke="#2e7d32" stroke-width="10" stroke-linecap="round"/>
<circle cx="690" cy="275" r="12" fill="#1b5e20"/><circle cx="735" cy="275" r="12" fill="#1b5e20"/>
<path d="M670 370 Q710 340 750 370" stroke="#1b5e20" stroke-width="9" fill="none" stroke-linecap="round"/>
<text x="800" y="170" font-size="34" fill="#2e7d32" font-weight="700">真面目</text>
<rect x="400" y="410" width="20" height="170" rx="10" fill="#8d6e63"/>
<ellipse cx="470" cy="300" rx="135" ry="150" fill="#fff8e1" stroke="#ffb300" stroke-width="8"/>
<path d="M410 270 Q430 245 450 270 M490 270 Q510 245 530 270" stroke="#333" stroke-width="9" fill="none" stroke-linecap="round"/>
<path d="M405 330 Q470 400 535 330" stroke="#333" stroke-width="9" fill="#ff8a80" stroke-linecap="round"/>
<text x="150" y="150" font-size="34" fill="#ff8f00" font-weight="700">假笑面具</text>
{label(160, 520, "hypo", "在…下面", c)}
{label(800, 520, "crite", "演戲的人", c)}
''')


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def card_svg(k):
    c, light = PALETTE[k["day"]]
    day_txt = f"第 {k['day']} 天" if k["day"] else "範例"
    method = "".join(f'<text x="90" y="{1005 + 56*i}" font-size="38" fill="#333">{esc(t)}</text>'
                     for i, t in enumerate(k["lines"]))
    en = "".join(f'<text x="90" y="{1230 + 50*i}" font-size="36" fill="#222" font-style="italic">{esc(t)}</text>'
                 for i, t in enumerate(k["en"]))
    zh_y = 1230 + 50 * len(k["en"]) + 10
    tw = 32 * (len(k["tag"]) + 1) + 40
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{FONT}">
<rect width="{W}" height="{H}" fill="{light}"/>
<rect x="40" y="40" width="{W-80}" height="{H-80}" rx="48" fill="#fff" stroke="{c}" stroke-width="8"/>
<rect x="40" y="40" width="{W-80}" height="210" rx="48" fill="{c}"/>
<rect x="40" y="200" width="{W-80}" height="50" fill="{c}"/>
<text x="90" y="145" font-size="88" font-weight="900" fill="#fff">{k["id"]}</text>
<text x="90" y="215" font-size="34" fill="#fff">{esc(k["phon"])}　<tspan font-weight="700">{k["pos"]} {esc(k["zh"])}</tspan></text>
<rect x="{W-90-150}" y="78" width="150" height="50" rx="25" fill="#fff" fill-opacity=".25"/>
<text x="{W-90-75}" y="113" font-size="28" fill="#fff" text-anchor="middle" font-weight="700">{day_txt}</text>
<g transform="translate(0,270)">{k["art"](c)}</g>
<rect x="70" y="905" width="{tw}" height="56" rx="28" fill="{c}"/>
<text x="{70+tw/2}" y="945" font-size="32" font-weight="700" fill="#fff" text-anchor="middle">{k["tag"]}</text>
{method}
<line x1="90" y1="1150" x2="{W-90}" y2="1150" stroke="#ddd" stroke-width="3" stroke-dasharray="12 10"/>
<text x="90" y="1185" font-size="30" font-weight="700" fill="{c}">▍例句</text>
{en}
<text x="90" y="{zh_y}" font-size="34" fill="#666">{esc(k["zh_sent"])}</text>
<rect x="70" y="1380" width="{W-140}" height="84" rx="20" fill="{light}"/>
<text x="{W/2}" y="1435" font-size="34" font-weight="700" fill="{c}" text-anchor="middle">{esc(k["tip"])}</text>
</svg>'''


def main():
    os.makedirs(f"{OUT}/png", exist_ok=True)
    os.makedirs(f"{ROOT}/images/cards", exist_ok=True)
    os.makedirs(f"{OUT}/svg", exist_ok=True)
    for k in CARDS:
        svg = card_svg(k)
        sp, pp = f"{OUT}/svg/{k['id']}.svg", f"{OUT}/png/{k['id']}.png"
        open(sp, "w", encoding="utf-8").write(svg)
        subprocess.run(["rsvg-convert", "-o", pp, sp], check=True)
        im = Image.open(pp).convert("RGB")
        im.resize((720, int(720 * H / W)), Image.LANCZOS).save(f"{ROOT}/images/cards/{k['id']}.webp", "WEBP", quality=82, method=6)
    # App 資料
    days = {}
    for k in CARDS:
        days.setdefault(k["day"], []).append(k["id"])
    data = {
        "version": 1,
        "title": "圖解記憶卡",
        "days": [{"day": d, "label": (f"第{d}天" if d else "範例"), "wordIds": ids}
                 for d, ids in sorted(days.items(), key=lambda x: (x[0] == 0, x[0]))],
        "cards": {k["id"]: {
            "img": f"./images/cards/{k['id']}.webp",
            "method": k["tag"],
            "mnemonic": "".join(k["lines"]),
            "lines": k["lines"],
            "tip": k["tip"],
            "example": " ".join(k["en"]),
            "example_zh": k["zh_sent"],
        } for k in CARDS},
    }
    json.dump(data, open(f"{ROOT}/data/picture_cards.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(len(CARDS), "cards")


if __name__ == "__main__":
    main()
