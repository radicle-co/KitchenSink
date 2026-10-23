"""Assemble the redesign screens canvas from the legacy canvas build.

Run from the repo root after `npm run artifact:build --workspace=@kitchensink/design-artifact`:

    python3 docs/design/uiRefreshWorkshop5/redesignCanvas/assembleRedesign.py <outDir>

The script copies `packages/tools/designArtifact/dist/canvas/project` to `<outDir>/project`. It replaces
`ds/commise/tokens.css` with the redesign tokens, and stops if they drop a legacy variable. It sets the theme objects in
`bundle.js` from `nativeTheme.json`, because the native components do not read CSS variables. It adds `redesign.css`
after each board's own styles, replaces each board that has a redesigned copy in `boards/`, retitles the canvas, places
the new boards that `extraBoards.json` lists, and applies `heights.json`.
It stops if `boards/` holds a file name that the legacy canvas does not have.
"""

import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
BASE = REPO / "packages/tools/designArtifact/dist/canvas/project"
LINK = '<link rel="stylesheet" href="ds/commise/redesign.css" />'
TITLE = "Commise Screens (redesign)"


def object_spans(source: str, name: str) -> list[tuple[int, int]]:
    """Return the (start, end) of the body of every `var NAME = {...}` in the bundle."""
    spans = []
    for match in re.finditer(r"\b" + re.escape(name) + r" = \{", source):
        depth, i = 0, match.end() - 1
        while True:
            if source[i] == "{":
                depth += 1
            elif source[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        spans.append((match.end(), i))
    return spans


def retheme_bundle(source: str, theme: dict) -> str:
    """Replace the theme values inside each named object, and stop if a named key is not found."""
    for name, values in theme["objects"].items():
        spans = object_spans(source, name)
        if not spans:
            sys.exit(f"bundle.js has no object {name}")
        for start, end in reversed(spans):
            body = source[start:end]
            for key, value in values.items():
                pattern = r"(\n\s*" + re.escape(key) + r": ).*?(,?)(?=[ \t]*(?://[^\n]*)?\n)"
                body, count = re.subn(pattern, lambda m: m.group(1) + value + m.group(2), body, count=1)
                if count == 0:
                    sys.exit(f"bundle.js object {name} has no key {key}")
            source = source[:start] + body + source[end:]
    for name, values in theme["literals"].items():
        spans = object_spans(source, name)
        if not spans:
            sys.exit(f"bundle.js has no object {name}")
        for start, end in reversed(spans):
            body = source[start:end]
            for old, new in values.items():
                body = body.replace(old, new)
            source = source[:start] + body + source[end:]
    return source


def add_extra_boards(data: dict, extra: dict) -> None:
    """Place each new board at the end of the row of the board it follows, and add it to the order after that board."""
    for name, spec in extra.items():
        after = data["boards"][spec["after"] + ".dc.html"]
        row_end = max(b["x"] + b["w"] for b in data["boards"].values() if b["y"] == after["y"])
        entry = {"x": row_end + 80, "y": after["y"], "w": spec["w"], "h": spec.get("h", after["h"]), "title": spec["title"]}
        data["boards"][name + ".dc.html"] = entry
        data["order"].insert(data["order"].index(spec["after"] + ".dc.html") + 1, name + ".dc.html")


def relayout(data: dict, heights: dict) -> None:
    """Set the new board heights and move the rows below down, so that a taller board never overlaps the next row."""
    boards = data["boards"]
    rows = sorted({b["y"] for b in boards.values()})
    old_bottom = {y: max(b["y"] + b["h"] for b in boards.values() if b["y"] == y) for y in rows}
    for name, height in heights.items():
        boards[name + ".dc.html"]["h"] = height
    shift, moved = 0, {}
    for y in rows:
        moved[y] = y + shift
        new_bottom = max(b["y"] + b["h"] for b in boards.values() if b["y"] == y)
        shift += max(0, new_bottom - old_bottom[y])
    for board in boards.values():
        board["y"] = moved[board["y"]]
    for note in data.get("notes", {}).values():
        below = [y for y in rows if y >= note["y"]]
        if below:
            note["y"] += moved[below[0]] - below[0]


def main(out_root: Path) -> None:
    project = out_root / "project"
    if project.exists():
        shutil.rmtree(project)
    shutil.copytree(BASE, project)

    legacy = sorted(p.name for p in BASE.glob("*.dc.html"))
    redesigned = sorted(p.name for p in (HERE / "boards").glob("*.dc.html"))
    extra_path = HERE / "extraBoards.json"
    extra = json.loads(extra_path.read_text()) if extra_path.exists() else {}
    unknown = sorted(set(redesigned) - set(legacy) - {name + ".dc.html" for name in extra})
    if unknown:
        sys.exit(f"Redesigned boards with no legacy board and no extraBoards.json entry: {unknown}")
    missing_extra = sorted(name for name in extra if name + ".dc.html" not in redesigned)
    if missing_extra:
        sys.exit(f"extraBoards.json names boards with no file: {missing_extra}")

    tokens = project / "ds/commise/tokens.css"
    redesign_tokens = (HERE / "tokens.css").read_text()
    missing = sorted(set(re.findall(r"(--[a-z0-9-]+):", tokens.read_text())) - set(re.findall(r"(--[a-z0-9-]+):", redesign_tokens)))
    if missing:
        sys.exit(f"Redesign tokens.css drops variables: {missing}")
    tokens.write_text(redesign_tokens)
    shutil.copyfile(HERE / "redesign.css", project / "ds/commise/redesign.css")
    bundle = project / "ds/commise/bundle.js"
    bundle.write_text(retheme_bundle(bundle.read_text(), json.loads((HERE / "nativeTheme.json").read_text())))

    for name in redesigned:
        shutil.copyfile(HERE / "boards" / name, project / name)

    for board in project.glob("*.dc.html"):
        html = board.read_text()
        if LINK in html:
            continue
        if "</helmet>" in html:
            html = html.replace("</helmet>", LINK + "</helmet>", 1)
        else:
            html = html.replace("</head>", LINK + "</head>", 1)
        board.write_text(html)

    canvas = project / "canvas.json"
    data = json.loads(canvas.read_text())
    data["title"] = TITLE
    add_extra_boards(data, extra)
    relayout(data, json.loads((HERE / "heights.json").read_text()))
    canvas.write_text(json.dumps(data, indent=2))

    print(f"{len(legacy)} boards, {len(redesigned)} redesigned copies, written to {project}")


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve())
