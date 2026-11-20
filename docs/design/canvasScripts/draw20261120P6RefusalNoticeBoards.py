# ruff: noqa: RUF001, E501  # Copy keeps the boards' typographic quotes; CSS rules, HTML and copy strings stay whole lines so each reads as written.
"""Draw the P6 boards: why a recipe stays private (makePublicRefusalNotice U0).

Two board families, each at web 1280 and 390, iPhone 390, Android 384 and iPad 820:
- RecipeRefusalNotice on recipeDetailWeb and recipeDetailMobile: the recipe page's header card with the standing reason
  line for each of the six reasons, the cases with no line (I wrote this, a public recipe, a reader), a failed write in
  the slot's place, and the page after the cook's answer with the ⋯ menu that no longer offers Make public.
- RecipeEditorRefusalNotice on recipeEditorWeb and recipeEditorMobile: the editor's "Who can see it" field with the
  Public card refused and the same line as its description, for each reason, and Public offered for I wrote this.

It also redraws the one line of superseded copy left on the canvases: the P3 boards RecipeEditorStatementPaidSite drew
the Public card's note as the old `publicRefused` text, which P6 deletes. They now show the paid-website line.

Each new board is built from a sibling board at the same size: RecipeVisibilityFailed for the page (its header cards
carry the slot) and RecipeEditorVisibility for the editor (its radio cards). The sibling gives the head, the shell, the
content container's own opening tag and the card styles; this script replaces only the container's children and adds
its own rules (`.p6`). Heights (board -> px) come from draw20261120P6RefusalNoticeBoardsHeights.json, measured by a
render. A board with no entry there stops the run.

The six lines and the states are decisions/makePublicRefusalNotice-designer.md (Solar Squad), signed plan
makePublicRefusalNotice U0. The standing line is the `meta` text role (14/20) in ink-muted, with no icon, and is never
in a live region. A failed write keeps today's danger line with its icon.

Run once from the repository root on its parent commit b5c4f68da (pull request docs/p6RefusalBoards):
python3 docs/design/canvasScripts/draw20261120P6RefusalNoticeBoards.py
"""

import json
import re
from pathlib import Path

ROOT = Path("docs/design/canvases")
EWEB, EMOB = "recipeEditorWeb", "recipeEditorMobile"
DWEB, DMOB = "recipeDetailWeb", "recipeDetailMobile"

SIZES = ["Web1280", "Web390", "Iphone390", "Android384", "Ipad820"]
WIDTH = {"Web1280": 1280, "Web390": 390, "Iphone390": 390, "Android384": 384, "Ipad820": 820}
SIZE_WORDS = {
    "Web1280": "web, 1280",
    "Web390": "web, 390",
    "Iphone390": "mobile, iPhone 390",
    "Android384": "mobile, Android 384",
    "Ipad820": "mobile, iPad 820",
}
# A device frame is never shorter than its screen (renderRepoCanvases measures the frame).
DEVICE_FLOOR = {"Iphone390": 844, "Android384": 832, "Ipad820": 1180}

DETAIL_HOST = "RecipeVisibilityFailed"
EDITOR_HOST = "RecipeEditorVisibility"

# The six lines (en), one per refusal reason, in P5's names.
LINES = {
    "webPage": "This recipe stays private because it’s from a web page.",
    "book": "This recipe stays private because it’s from a cookbook or magazine.",
    "paidSite": "This recipe stays private because it’s from a paid website.",
    "fromPerson": "This recipe stays private because it’s from another person.",
    "sourceConflict": "This recipe stays private because it was saved with a source.",
    "unrecognised": "This recipe stays private because of its source.",
}
# The source each sample recipe shows in its meta row ("" shows none: the source was removed).
SOURCES = {
    "webPage": "roastandthyme.example",
    "book": "The Sunday Roast Book",
    "paidSite": "bakeclub.example",
    "fromPerson": "Grandma Rose",
    "sourceConflict": "",
    "unrecognised": "kitchennotes.example",
}
WRITE_FAILED = "We couldn’t change who can see this recipe. Try again."
OLD_PUBLIC_REFUSED = "Not for this recipe. Its source is a book or a paid site, not a public web page."

P6_CSS = """
.rd .p6-stand { margin: 10px 0 0; font: 400 14px/20px var(--font-body); color: var(--ink-muted); }
.p6-tail { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
.p6-more { align-self: flex-end; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border-radius: 22px; background: var(--paper); color: var(--ink); box-shadow: 0 0 0 2px var(--canvas), 0 0 0 4px var(--focus-ring); }
.p6-more svg { width: 20px; height: 20px; }
.p6-menu { margin: 0; padding: 8px 0; list-style: none; width: 100%; max-width: 320px; align-self: flex-end; background: var(--paper-overlay); border-radius: var(--radius-lg); box-shadow: var(--shadow-xl); }
.p6-menu li { display: flex; align-items: center; min-height: 48px; padding: 0 16px; }
.p6-menu li.p6-del { color: var(--danger-text); border-top: 1px solid var(--line-divider); }
"""

DETAIL_FIGURES = [
    (
        "webPage",
        "From a web page: the reason shows under the meta row, muted, with no icon. Opened fresh, it shows and nothing is spoken",
    ),
    ("book", "From a cookbook or magazine"),
    ("paidSite", "From a paid website"),
    ("fromPerson", "From another person. This line wins over every other reason"),
    ("sourceConflict", "A source was saved and later removed. The line does not name it"),
    ("unrecognised", "An app older than the server cannot word the answer. The line names none"),
]


def board_path(canvas: str, name: str) -> Path:
    """Path of a board file."""
    return ROOT / canvas / "project" / f"{name}.dc.html"


def _search(pattern: str, s: str, flags: int = 0) -> re.Match[str]:
    """The first match, or a ValueError naming the pattern: a host that changed shape stops the run."""
    m = re.search(pattern, s, flags)
    if m is None:
        raise ValueError(f"no match for {pattern!r}")
    return m


def element_end(s: str, start: int, tag: str) -> int:
    """Index just past the end tag that closes the `tag` element opened at `start`."""
    depth = 0
    for m in re.finditer(rf"<{tag}\b|</{tag}>", s[start:]):
        depth += -1 if m.group(0).startswith("</") else 1
        if depth == 0:
            return start + m.end()
    raise ValueError(f"unbalanced <{tag}> at {start}")


def fill(host: str, container: str, content: str) -> str:
    """The host with the children of its first `container` element (an opening-tag pattern) replaced by `content`."""
    m = _search(container, host)
    tag = _search(r"<(\w+)", m.group(0)).group(1)
    end = element_end(host, m.start(), tag)
    return host[: m.end()] + content + f"</{tag}>" + host[end:]


def set_meta(s: str, title: str, name: str, width: int, height: int) -> str:
    """Retitle and resize a board, and add the `.p6` rules."""
    s = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", s, count=1)
    s = re.sub(r'data-board="[^"]*"', f'data-board="{name}"', s)
    s = re.sub(
        r'"\$preview":(\s?)\{"width":(\s?)\d+,(\s?)"height":(\s?)\d+\}',
        lambda m: f'"$preview":{m[1]}{{"width":{m[2]}{width},{m[3]}"height":{m[4]}{height}}}',
        s,
    )
    s = re.sub(r'(<div class="rd"[^>]*style="width: \d+px; )height: \d+px', rf"\1height: {height}px", s, count=1)
    s = re.sub(
        r'(class="nv-device[^"]*" style="width: \d+px; )min-height: \d+px', rf"\1min-height: {height}px", s, count=1
    )
    return s.replace("</style>", P6_CSS + "</style>", 1)


# The recipe page.


def meta_row(public: bool, source: str) -> str:
    """The header card's visibility and source line."""
    icon, word = ("globe", "Public") if public else ("lock", "Private")
    src = f'<span class="sep" aria-hidden="true">·</span><span class="mi ink">{source}</span>' if source else ""
    return (
        f'<div class="metaRow2 t15 soft"><span class="mi"><svg class="ic sm" aria-hidden="true"><use href="#{icon}" /></svg>'
        f"{word}</span>{src}</div>"
    )


def header_card(card_tag: str, public: bool, source: str, slot: str) -> str:
    """One header card: cuisine, title, the meta row and what the slot shows."""
    return (
        f'{card_tag}<p class="eyebrow">British</p><h1 class="rTitle dish titleGap">Lemon and thyme roast chicken</h1>'
        f"{meta_row(public, source)}{slot}</div>"
    )


def standing(key: str) -> str:
    """The standing reason line: plain text, no role, no live region."""
    return f'<p class="p6-stand">{LINES[key]}</p>'


def failed() -> str:
    """The moment line of a failed write: today's danger line."""
    return (
        '<p class="errLine"><svg class="ic sm" aria-hidden="true"><use href="#alert" /></svg>'
        f"<span>{WRITE_FAILED}</span></p>"
    )


def detail_figure(caption: str, body: str) -> str:
    """One captioned state on the recipe page board."""
    return f'<div role="group" aria-label="{caption}"><p class="cap">{caption}</p>{body}</div>'


def after_answer(card_tag: str) -> str:
    """The page after the cook answers From a web page: line, focused ⋯ button and the menu without Make public."""
    return (
        header_card(card_tag, False, SOURCES["webPage"], standing("webPage"))
        + '<div class="p6-tail"><p class="cap">Focus is on the ⋯ button in the page header. Opened again, its menu:</p>'
        '<span class="p6-more" role="button" aria-label="More actions">'
        '<svg aria-hidden="true"><use href="#dots" /></svg></span>'
        '<ul class="p6-menu" role="menu" aria-label="Recipe actions"><li role="menuitem">Version history</li>'
        '<li role="menuitem" class="p6-del">Delete recipe</li></ul></div>'
    )


def detail_content(card_tag: str) -> str:
    """Every state of the recipe page board."""
    figures = [
        detail_figure(caption, header_card(card_tag, False, SOURCES[key], standing(key)))
        for key, caption in DETAIL_FIGURES
    ]
    figures += [
        detail_figure(
            "After the answer (From a web page here): one write saves it private, the sheet closes and focus is on ⋯. "
            "The line is said once, politely. The menu no longer offers Make public",
            after_answer(card_tag),
        ),
        detail_figure(
            "The save failed: the error takes the slot, in the danger style. Once it clears, the reason line returns "
            "and is not said again",
            header_card(card_tag, False, SOURCES["paidSite"], failed()),
        ),
        detail_figure(
            "I wrote this, kept private: no line. Make public is offered",
            header_card(card_tag, False, "", ""),
        ),
        detail_figure(
            "Public, seen by its owner: no line, whatever its source",
            header_card(card_tag, True, "", ""),
        ),
        detail_figure(
            "Another cook reading it: no line. Only the owner is told why",
            header_card(card_tag, True, "", ""),
        ),
    ]
    return "".join(figures)


# The editor.


def radio_styles(host: str) -> dict[str, str]:
    """The host's three radio card styles: chosen, open and refused."""
    styles: dict[str, str] = {}
    # Attribute order and line breaks differ between the web and native hosts, so each opening tag is read as a whole.
    for tag in re.findall(r'<div\b[^>]*\brole="radio"[^>]*>', host):
        attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', tag))
        if "style" not in attrs:
            continue
        kind = (
            "refused"
            if attrs.get("aria-disabled") == "true"
            else ("chosen" if attrs["aria-checked"] == "true" else "open")
        )
        styles.setdefault(kind, re.sub(r"\s+", " ", attrs["style"]).strip())
    if set(styles) != {"chosen", "open", "refused"}:
        raise ValueError(f"host radio styles changed: {sorted(styles)}")
    return styles


def editor_card(styles: dict[str, str], label: str, kind: str, notes: list[str], note_id: str = "") -> str:
    """One radio card of "Who can see it"."""
    refused = kind == "refused"
    attrs = f'role="radio" aria-checked="{"true" if kind == "chosen" else "false"}"'
    if refused:
        attrs += f' aria-disabled="true" aria-describedby="{note_id}"'
    title_style = ' style="color: var(--ink-muted)"' if refused else ""
    first_id = f' id="{note_id}"' if refused else ""
    lines = "".join(f'<span class="vh"{first_id if i == 0 else ""}>{note}</span>' for i, note in enumerate(notes))
    return (
        f'<div {attrs} style="{styles[kind]}"><div style="display: flex; flex-direction: column; min-width: 0; flex: 1">'
        f'<span class="vt"{title_style}>{label}</span>{lines}</div></div>'
    )


def editor_figure(caption: str, cards: str) -> str:
    """One captioned state on the editor board."""
    return (
        f'<section class="fig" aria-label="{caption}"><p class="cap">{caption}</p>'
        '<div style="display: flex; flex-direction: column; gap: 8px"><span class="vl">Who can see it</span>'
        f'<div role="radiogroup" aria-label="Who can see it" style="display: flex; flex-direction: column; gap: 8px">{cards}</div>'
        "</div></section>"
    )


EDITOR_FIGURES = [
    (
        "webPage",
        "From a web page, or a link pasted into Source: Public is refused and its card says why. The line is the card’s "
        "description and is never spoken by itself (a pasted link is already announced by the Source row)",
    ),
    ("book", "From a cookbook or magazine"),
    ("paidSite", "From a paid website"),
    ("fromPerson", "From another person, even with a link pasted in: Public is refused, and Publish saves it private"),
    ("sourceConflict", "A source was saved and later removed"),
    ("unrecognised", "An app older than the server cannot word the answer"),
]


def editor_content(host: str) -> str:
    """Every state of the editor board."""
    styles = radio_styles(host)
    private = editor_card(styles, "Private", "chosen", ["Only you can see it"])
    figures = [
        editor_figure(caption, editor_card(styles, "Public", "refused", [LINES[key]], f"why-{key}") + private)
        for key, caption in EDITOR_FIGURES
    ]
    figures.append(
        editor_figure(
            "I wrote this: Public is offered, with no line",
            editor_card(styles, "Public", "chosen", ["Anyone can find it in Discover"])
            + editor_card(styles, "Private", "open", ["Only you can see it"]),
        )
    )
    return "".join(figures)


# The run.


def detail_board(size: str) -> tuple[str, str]:
    """The recipe page host at `size`, and its content built inside the host's own container."""
    canvas = DWEB if size.startswith("Web") else DMOB
    host = board_path(canvas, f"{DETAIL_HOST}{size}").read_text()
    rd = _search(r'<div class="rd"[^>]*>', host)
    container = _search(r'<div\s+style="[^"]*"\s*>', host[rd.end() :]).group(0)
    card_tag = _search(r'<div class="card" style="[^"]*">', host).group(0)
    body = container + detail_content(card_tag) + "</div>"
    return host, fill(host, r'<div class="rd"[^>]*>', body)


def editor_board(size: str) -> tuple[str, str]:
    """The editor host at `size`, with its page's figures replaced."""
    canvas = EWEB if size.startswith("Web") else EMOB
    host = board_path(canvas, f"{EDITOR_HOST}{size}").read_text()
    return host, fill(host, r'<(?:main|div) class="page"[^>]*>', editor_content(host))


def redraw_old_copy() -> None:
    """The P3 editor boards' Public note is the deleted `publicRefused` text; it becomes the paid-website line."""
    for size in SIZES:
        path = board_path(EWEB if size.startswith("Web") else EMOB, f"RecipeEditorStatementPaidSite{size}")
        s = path.read_text()
        if s.count(OLD_PUBLIC_REFUSED) != 1:
            raise ValueError(f"{path}: expected the old line once")
        path.write_text(s.replace(OLD_PUBLIC_REFUSED, LINES["paidSite"]))


def main() -> None:
    """Draw every board and lay out each canvas.json."""
    heights = json.loads(Path(__file__).with_name("draw20261120P6RefusalNoticeBoardsHeights.json").read_text())
    plan = [
        (DWEB, DMOB, "RecipeRefusalNotice", "Recipe detail, why it stays private", detail_board),
        (EWEB, EMOB, "RecipeEditorRefusalNotice", "Recipe editor, why Public is refused", editor_board),
    ]
    for web, mob, family, words, build in plan:
        for canvas in (web, mob):
            made: list[tuple[str, int, int, str]] = []
            for size in [s for s in SIZES if s.startswith("Web") == (canvas == web)]:
                name = f"{family}{size}"
                width = WIDTH[size]
                h = max(heights[name], DEVICE_FLOOR.get(size, 0))
                title = f"{words} ({SIZE_WORDS[size]})"
                _, html = build(size)
                board_path(canvas, name).write_text(set_meta(html, title, name, width, h))
                made.append((name, width, h, title))
            cj = ROOT / canvas / "project" / "canvas.json"
            d = json.loads(cj.read_text())
            for name, *_ in made:
                d["boards"].pop(f"{name}.dc.html", None)
            y = max(b["y"] + b["h"] for b in d["boards"].values()) + 400
            x = 0
            for name, w, h, title in made:
                key = f"{name}.dc.html"
                d["boards"][key] = {"x": x, "y": y, "w": w, "h": h, "title": title}
                if isinstance(d.get("order"), list) and key not in d["order"]:
                    d["order"].append(key)
                x += w + 80
            cj.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
    redraw_old_copy()


if __name__ == "__main__":
    main()
