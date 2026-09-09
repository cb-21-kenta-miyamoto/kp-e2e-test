"""ブロック文書から ケースID / ケース名 / 確認観点（ケース単位）を機械的に抽出する。

実施記録ブックの「ケース一覧・実施記録」タブへ流し込む値の出どころ（e2e-prepare 準2）。
**ケース文書が更新されたら、これで取り直してシートと突き合わせる。**
目で見ると、増減していないケースの中身のずれ（ケース名の改稿・確認観点の割り当て直し）を取りこぼす。

使い方:

    python3 scripts/extract-cases.py --doc <ケース文書のディレクトリ>          # 件数と抜けの確認
    python3 scripts/extract-cases.py --doc <同> --json > cases.json          # 流し込む値
    python3 scripts/extract-cases.py --doc <同> --tsv                        # 貼り付け用

`対応する確認観点` は**ケース単位**で書かれている前提で読む。

    - **対応する確認観点**: 2 の #1「コメントの投稿」（A-1〜A-3・A-6〜A-20） / #7「メンションの入力」（A-4・A-5）

範囲の指定が無い観点は、その群の全ケースへ割り当てる。
"""
import re, os, glob, json, sys, argparse

ORDER = ["SPEC", "NFR", "SCN", "MB"]

def expand(spec: str, group: str):
    """（A-1〜A-3・A-6）のような指定を ID の集合へ展開する。"""
    ids = set()
    for part in re.split(r"[・,、]", spec):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"^([A-Z])-(\d+)\s*[〜~-]\s*(?:([A-Z])-)?(\d+)$", part)
        if m:
            g1, a, g2, b = m.group(1), int(m.group(2)), m.group(3) or m.group(1), int(m.group(4))
            if g1 == g2:
                ids |= {f"{g1}-{i}" for i in range(a, b + 1)}
            continue
        m = re.match(r"^([A-Z])-(\d+)$", part)
        if m:
            ids.add(part)
    return ids

def parse(path):
    text = open(path).read()
    block = re.match(r"((?:SPEC|NFR|SCN|MB)-\d+)_", os.path.basename(path)).group(1)
    # ケース群ごとの「対応する確認観点」→ ケースIDごとの観点名
    view_by_case = {}
    groups = re.split(r"^### ([A-Z])\. ", text, flags=re.M)[1:]
    for i in range(0, len(groups), 2):
        g, body = groups[i], groups[i + 1]
        line = re.search(r"^- \*\*対応する確認観点\*\*: (.+)$", body, re.M)
        if not line:
            continue
        for num, name, rng in re.findall(r"#(\d+)「([^」]+)」(?:（([^）]*)）)?", line.group(1)):
            targets = expand(rng, g) if rng else None
            if targets is None:  # 範囲指定が無い群は全ケースへ
                targets = set(re.findall(rf"^#### ({g}-\d+) ", body, re.M))
            for cid in targets:
                view_by_case.setdefault(cid, []).append(name)
    cases = []
    for cid, title in re.findall(r"^#### ([A-Z]-\d+) (.+)$", text, re.M):
        cases.append({
            "layer": block.split("-")[0],
            "block": block,
            "id": cid,
            "name": title.strip(),
            "views": " / ".join(view_by_case.get(cid, [])),
        })
    return cases

def all_cases(doc_dir):
    out = []
    for path in glob.glob(os.path.join(doc_dir, "*.md")):
        if not re.match(r"(SPEC|NFR|SCN|MB)-\d+_", os.path.basename(path)):
            continue
        out += parse(path)
    out.sort(key=lambda c: (ORDER.index(c["layer"]), int(c["block"].split("-")[1]),
                            c["id"].split("-")[0], int(c["id"].split("-")[1])))
    return out

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--doc", required=True, help="ケース文書（ブロックの md）が置かれたディレクトリ")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--tsv", action="store_true")
    args = ap.parse_args()

    cases = all_cases(os.path.expanduser(args.doc))
    if args.json:
        print(json.dumps(cases, ensure_ascii=False, indent=1))
    elif args.tsv:
        for c in cases:
            print("\t".join([c["layer"], c["block"], c["id"], c["name"], c["views"]]))
    else:
        print(f"{len(cases)} 件")
        import collections
        for block, n in collections.Counter(c["block"] for c in cases).items():
            print(f"  {block}\t{n}")
        no_view = [c for c in cases if not c["views"]]
        # 確認観点が引けないケースは、群見出しや「対応する確認観点」行の抜けを疑う
        print("確認観点が引けないケース:", len(no_view),
              [c["block"] + " " + c["id"] for c in no_view][:15])
