#!/usr/bin/env python3
"""(Re)generate the scan index at the top of each corpus reference, in place.

The index lets the agent read one table, pick the entries that apply, and open only those (grep the ID) —
instead of loading ~7k words per reference. Run after editing any entry:
    python3 buildIndex.py                       # every references/*.md
    python3 buildIndex.py react nextjs          # named references only
An existing generated index is stripped before the new one is written, so the operation is idempotent.
"""
import re
import sys
from pathlib import Path

ENTRY = re.compile(r"^### ([A-Z]+-\d+[a-z]?) (.+)$")
FIELD = re.compile(r"^- \*\*(Tool coverage|Severity|Architecture):\*\*\s*(.*)$")


def short(text: str, n: int) -> str:
    text = re.sub(r"\s+", " ", text).replace("|", "/")
    return text if len(text) <= n else text[: n - 1] + "…"


START = "<!-- GENERATED INDEX"
END = "<!-- END GENERATED INDEX -->"


def strip_index(lines: list[str]) -> list[str]:
    if not any(l.startswith(START) for l in lines):
        return lines
    begin = next(i for i, l in enumerate(lines) if l.startswith(START))
    end = next((i for i, l in enumerate(lines) if l == END), None)
    if end is None:  # legacy index without an end marker: it ends at the blank line after the table
        end = begin
        while end < len(lines) and not (lines[end] == "" and end > begin + 4):
            end += 1
    return lines[:begin] + lines[end + 1 :]


def build(src: Path, dst: Path) -> int:
    lines = strip_index(src.read_text(encoding="utf-8").splitlines())
    while lines and lines[0:2] and len(lines) > 1 and lines[1] == "" and lines[0].startswith("# ") and len(lines) > 2 and lines[2] == "":
        del lines[1]
    rows, cur, section = [], None, ""
    for line in lines:
        if line.startswith("## "):
            section = line[3:].strip()
        m = ENTRY.match(line)
        if m:
            cur = {"id": m.group(1), "name": m.group(2), "section": section, "Tool coverage": "", "Severity": "", "Architecture": ""}
            rows.append(cur)
            continue
        f = FIELD.match(line)
        if f and cur is not None and not cur[f.group(1)]:
            cur[f.group(1)] = f.group(2)
    tool = lambda r: "judgement" if r["Tool coverage"].lower().startswith("none") else ("partial" if "partial" in r["Tool coverage"].lower() else "tool")
    sev = lambda r: (re.match(r"\**\s*(blocker|major|minor)", r["Severity"].lower()) or [None, "?"])[1]
    arch = lambda r: "yes" if r["Architecture"].lower().startswith("yes") else "no"
    index = [
        "<!-- GENERATED INDEX (scripts/buildIndex.py) — edit the entries below, then regenerate. -->",
        "## Index — scan this, then open only the entries that apply (`rg -n '^### <ID>' <this file>`)",
        "",
        "| ID | Smell | Section | Detected by | Default severity | Architecture |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    index += [f"| {r['id']} | {short(r['name'], 90)} | {short(r['section'], 40)} | {tool(r)} | {sev(r)} | {arch(r)} |" for r in rows]
    index.append(END)
    title_end = next((i for i, l in enumerate(lines) if l.startswith("# ")), -1) + 1
    out = lines[:title_end] + [""] + index + [""] + lines[title_end:]
    dst.write_text("\n".join(out) + "\n", encoding="utf-8")
    return len(rows)


if __name__ == "__main__":
    refs = Path(__file__).resolve().parent.parent / "references"
    names = sys.argv[1:] or sorted(p.stem for p in refs.glob("*.md"))
    for name in names:
        path = refs / f"{name}.md"
        print(name, build(path, path))
