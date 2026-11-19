# ruff: noqa: RUF001, E501  # Copy keeps the boards' typographic quotes; CSS rules, HTML and copy strings stay whole lines so each reads as written.
"""Draw the P3 boards: the "Where is this recipe from?" sheet with the paid-site answer (directCreateSourceLabels U0).

Two board families, each at web 1280 and 390, iPhone 390, Android 384 and iPad 820:
- RecipeEditorStatementPaidSite on recipeEditorWeb and recipeEditorMobile: the editor's six answers, the paid site
  chosen, the blank-citation error, and the locked Source row after Publish.
- RecipeMakePublicStatementPaidSite on recipeDetailWeb and recipeDetailMobile: the recipe page's five answers, the
  paid site chosen, the blank-citation error, and the page after Make public.

Each board is built from a sibling board at the same size: the sibling gives the head (tokens, styles), the shell
(device frame) and the size; this script replaces only the content container and adds its own rules (`.p3`). It adds
the new boards to each canvas.json as one appended row. Heights (board -> px) come from
draw20261119P3StatementBoardsHeights.json, measured by a render. The file is the one input: a board with no entry
there stops the run with an error.

The sheet is `Sheet size="content" presentation="dialog"`: a bottom sheet on a phone, a centred dialog at most 448 wide
from the tablet width. The copy is the en copy of `sourceStatement.*`, `editor.source.*`, `editor.visibility.*` and
`detailActions.*`, with the P3 keys from decisions/directCreateSourceLabels-designer.md.

Run once from the repository root on its parent commit: python3 docs/design/canvasScripts/draw20261119P3StatementBoards.py
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
# The phone sizes show a bottom sheet; the others show the centred dialog.
PHONES = {"Web390", "Iphone390", "Android384"}
# A device frame is never shorter than its screen (renderRepoCanvases measures the frame).
DEVICE_FLOOR = {"Iphone390": 844, "Android384": 832, "Ipad820": 1180}

EDITOR_HOST = "RecipeEditorVisibility"
DETAIL_HOST = "RecipeMakePublicDialog"

# Copy (en). sourceStatement.*
TITLE = "Where is this recipe from?"
BODY = "Part of this recipe was pasted in. Before it goes public, tell us where it’s from."
EFFECT = "If your answer isn’t true, we can remove the recipe and limit your account."
HINT_PRIVATE = "Stays private to you."
PAID_HINT = (
    "A recipe from a website you pay for, like a subscription. Stays private to you. "
    "Once you confirm, this answer is locked."
)
ANSWERS = [
    (
        "authored",
        "I wrote this",
        "It’s my own recipe, in my own words, and any photos are mine. "
        "It isn’t copied from a website, book or another person. Goes public.",
    ),
    ("publicWeb", "From a web page", HINT_PRIVATE),
    ("paidSite", "From a paid website", PAID_HINT),
    ("book", "From a cookbook or magazine", HINT_PRIVATE),
    ("fromPerson", "From another person", "A recipe someone gave you, like family or a friend. Stays private to you."),
    ("publishPrivately", "Publish privately", ""),
]
PAID_LABEL = "Website name or address"
PAID_ERROR = "Add the website’s name or address."
CITATION = "bakeclub.example"
SOURCE_LOCKED = "The source of this recipe can’t be changed."
PUBLIC_REFUSED = "Not for this recipe. Its source is a book or a paid site, not a public web page."

ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'
ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
ICON_LOCK = (
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/>'
    '<path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'
)

P3_CSS = """
.p3, .p3 * { box-sizing: border-box; }
.p3 { width: 100%; text-align: left; display: flex; flex-direction: column; gap: 32px; padding: 24px 16px 32px; font: 400 16px/24px var(--font-body); color: var(--ink); }
/* The recipe page's device frame draws its status bar over the top of `.rd`. */
.nv-device .rd > .p3 { padding-top: 64px; }
.p3.wide { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; padding: 28px 32px 40px; align-items: start; }
.p3 p, .p3 h2, .p3 ul { margin: 0; }
.p3 ul { padding: 0; list-style: none; }
.p3 svg { width: 20px; height: 20px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.p3 .p3-cap { font-size: 14px; line-height: 20px; color: var(--ink-muted); margin: 0 0 8px; }
.p3 .p3-stage { display: flex; justify-content: center; align-items: flex-start; border-radius: var(--radius-lg); overflow: hidden; background: var(--scrim); padding: 28px 20px; }
.p3 .p3-stage.p3-bottom { padding: 28px 0 0; align-items: flex-end; }
.p3 .p3-stage.p3-plain { background: var(--canvas); box-shadow: inset 0 0 0 1px var(--line-divider); padding: 20px; }
.p3 .p3-dlg, .p3 .p3-bs { display: flex; flex-direction: column; gap: 16px; background: var(--paper-overlay); }
.p3 .p3-dlg { width: 448px; max-width: 100%; padding: 24px; border-radius: var(--radius-xl); box-shadow: var(--shadow-xl); }
.p3 .p3-bs { width: 100%; padding: 8px 16px 24px; border-radius: 24px 24px 0 0; }
.p3 .p3-grab { width: 36px; height: 5px; border-radius: 3px; background: var(--line-divider); margin: 0 auto; }
.p3 .p3-hd { display: flex; align-items: flex-start; gap: 8px; }
.p3 .p3-hd h2 { flex: 1; min-width: 0; font: 600 18px/24px var(--font-display); padding-top: 10px; }
.p3 .p3-x { width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; color: var(--ink-muted); margin-right: -10px; }
.p3 .p3-opts { display: flex; flex-direction: column; gap: 8px; }
.p3 .p3-opt { display: flex; align-items: flex-start; gap: 12px; min-height: 48px; padding: 12px 16px; border-radius: 12px; border: 1px solid var(--line-control); background: var(--paper); }
.p3 .p3-opt[aria-checked='true'] { border-color: var(--selected-edge); background: var(--selected-fill); }
.p3 .p3-opt[aria-disabled='true'] { opacity: 0.6; }
.p3 .p3-dot { width: 20px; height: 20px; flex: none; margin-top: 2px; border-radius: 50%; border: 2px solid var(--line-control); background: var(--paper); }
.p3 .p3-opt[aria-checked='true'] .p3-dot { border: 6px solid var(--ink); }
.p3 .p3-grow { flex: 1; min-width: 0; }
.p3 .p3-t { display: block; font-weight: 600; overflow-wrap: anywhere; }
.p3 .p3-h { display: block; font-size: 14px; line-height: 20px; color: var(--ink-muted); overflow-wrap: anywhere; }
.p3 .p3-lbl { display: block; font: 600 14px/20px var(--font-body); color: var(--ink-muted); margin-bottom: 4px; }
.p3 .p3-inp { display: flex; align-items: center; min-height: 44px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line-control); background: var(--paper); color: var(--ink-muted); }
.p3 .p3-inp.p3-on { color: var(--ink); }
.p3 .p3-inp.p3-bad { border: 2px solid var(--danger); box-shadow: 0 0 0 3px var(--focus-ring); }
.p3 .p3-err { margin-top: 4px; font-size: 14px; line-height: 20px; color: var(--danger-text); }
.p3 .p3-eff { font-size: 14px; line-height: 20px; color: var(--ink-muted); }
.p3 .p3-acts { display: flex; gap: 12px; }
.p3 .p3-btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 12px; border-radius: var(--radius-md); font-weight: 600; }
.p3 .p3-btn.p3-primary { background: var(--action); color: var(--on-action); }
.p3 .p3-btn.p3-secondary { background: var(--paper); box-shadow: inset 0 0 0 1px var(--line-divider), var(--shadow-sm); }
.p3 .p3-card { display: flex; flex-direction: column; gap: 20px; width: 100%; max-width: 560px; }
.p3 .p3-src { display: flex; flex-direction: column; gap: 4px; }
.p3 .p3-lock { display: flex; gap: 8px; align-items: flex-start; font-size: 14px; line-height: 20px; color: var(--ink-muted); }
.p3 .p3-lock svg { width: 16px; height: 16px; margin-top: 2px; }
.p3 .p3-menu { width: 100%; max-width: 320px; background: var(--paper-overlay); border-radius: var(--radius-lg); box-shadow: var(--shadow-xl); padding: 8px 0; }
.p3 .p3-menu li { display: flex; align-items: center; min-height: 48px; padding: 0 16px; }
.p3 .p3-menu li.p3-del { color: var(--danger-text); border-top: 1px solid var(--line-divider); }
"""


def board_path(canvas: str, name: str) -> Path:
    """Path of a board file."""
    return ROOT / canvas / "project" / f"{name}.dc.html"


def _search(pattern: str, s: str) -> re.Match[str]:
    """The first match, or a ValueError naming the pattern: a host that changed shape stops the run."""
    m = re.search(pattern, s)
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


def fill(host: str, content: str) -> str:
    """The host board with its content container's children replaced by `content`."""
    m = _search(r'<(main|div) class="(?:page|rd)"[^>]*>', host)
    end = element_end(host, m.start(), m.group(1))
    return host[: m.end()] + content + f"</{m.group(1)}>" + host[end:]


def set_meta(s: str, title: str, name: str, width: int, height: int) -> str:
    """Retitle and resize a board, and add the `.p3` rules."""
    s = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", s, count=1)
    s = re.sub(r'data-screen="[^"]*"', f'data-screen="{name}"', s)
    s = re.sub(r'data-board="[^"]*"', f'data-board="{name}"', s)
    s = re.sub(
        r'"\$preview": \{"width": \d+, "height": \d+\}', f'"$preview": {{"width": {width}, "height": {height}}}', s
    )
    s = re.sub(r'(<div class="rd"[^>]*style="width: \d+px; )height: \d+px', rf"\1height: {height}px", s, count=1)
    s = re.sub(
        r'(class="nv-device[^"]*" style="width: \d+px; )min-height: \d+px', rf"\1min-height: {height}px", s, count=1
    )
    return s.replace("</style>", P3_CSS + "</style>", 1)


def option(label: str, hint: str, checked: bool) -> str:
    """One answer row of the radio list."""
    h = f'<span class="p3-h">{hint}</span>' if hint else ""
    return (
        f'<div class="p3-opt" role="radio" aria-checked="{"true" if checked else "false"}">'
        f'<span class="p3-dot" aria-hidden="true"></span><span class="p3-grow"><span class="p3-t">{label}</span>{h}</span></div>'
    )


def sheet(size: str, editor: bool, chosen: bool, field: str) -> str:
    """The statement sheet. `field` is "", "empty" or "error"."""
    answers = ANSWERS if editor else ANSWERS[:-1]
    opts = "".join(option(label, hint, chosen and key == "paidSite") for key, label, hint in answers)
    fld = ""
    if field:
        bad = field == "error"
        err = f'<p class="p3-err" id="paidSiteError">{PAID_ERROR}</p>' if bad else ""
        state = ' p3-bad" aria-invalid="true" aria-describedby="paidSiteError' if bad else ""
        fld = (
            f'<div><span class="p3-lbl">{PAID_LABEL}</span>'
            f'<div class="p3-inp{state}" role="textbox" aria-label="{PAID_LABEL}"></div>{err}</div>'
        )
    dismiss, confirm = ("Keep as draft", "Publish") if editor else ("Cancel", "Make public")
    inner = (
        f'<div class="p3-hd"><h2>{TITLE}</h2><span class="p3-x" role="button" aria-label="Close">{ICON_X}</span></div>'
        f"<p>{BODY}</p>"
        f'<div class="p3-opts" role="radiogroup" aria-label="{TITLE}">{opts}</div>{fld}'
        f'<p class="p3-eff">{EFFECT}</p>'
        f'<div class="p3-acts"><span class="p3-btn p3-secondary">{dismiss}</span>'
        f'<span class="p3-btn p3-primary">{ICON_CHECK}{confirm}</span></div>'
    )
    if size in PHONES:
        return f'<div class="p3-stage p3-bottom"><div class="p3-bs" role="dialog" aria-modal="true"><div class="p3-grab"></div>{inner}</div></div>'
    return f'<div class="p3-stage"><div class="p3-dlg" role="dialog" aria-modal="true">{inner}</div></div>'


def figure(caption: str, body: str) -> str:
    """One captioned state."""
    return f'<div class="p3-fig" role="group" aria-label="{caption}"><p class="p3-cap">{caption}</p>{body}</div>'


def locked_row() -> str:
    """The editor's Source row and Public card after a paid-site Publish."""
    return (
        '<div class="p3-stage p3-plain"><div class="p3-card">'
        '<div class="p3-src"><span class="p3-lbl">Source</span>'
        f'<span class="p3-t">{CITATION}</span><span class="p3-h">From a paid website</span>'
        f'<p class="p3-lock">{ICON_LOCK}<span>{SOURCE_LOCKED}</span></p></div>'
        '<div><span class="p3-lbl">Who can see it</span><div class="p3-opts" role="radiogroup" aria-label="Who can see it">'
        + option("Public", PUBLIC_REFUSED, False).replace('role="radio"', 'role="radio" aria-disabled="true"')
        + option("Private", "Only you can see it", True)
        + "</div></div></div></div>"
    )


def menu_after() -> str:
    """The recipe page's ⋯ menu once the paid-site answer is saved."""
    return (
        '<div class="p3-stage p3-plain"><ul class="p3-menu" role="menu" aria-label="Recipe actions">'
        '<li role="menuitem">Version history</li><li role="menuitem" class="p3-del">Delete recipe</li></ul></div>'
    )


def editor_content(size: str) -> str:
    """The editor board's states."""
    return "".join(
        [
            figure(
                "Publish asks: six answers, none chosen. The paid website hint says the answer locks",
                sheet(size, True, False, ""),
            ),
            figure(
                "From a paid website chosen: the website field shows under the answers, empty",
                sheet(size, True, True, "empty"),
            ),
            figure(
                "Publish with the field blank: the error is under the field, and focus moves to it",
                sheet(size, True, True, "error"),
            ),
            figure(
                "After Publish: private, and the Source row is locked with no link. The same from the moment the cook "
                "confirms, also when the save fails or the cook is offline",
                locked_row(),
            ),
        ]
    )


def detail_content(size: str) -> str:
    """The recipe page board's states."""
    return "".join(
        [
            figure(
                "Make public asks: five answers, none chosen. The paid website hint says the answer locks",
                sheet(size, False, False, ""),
            ),
            figure(
                "From a paid website chosen: the website field shows under the answers, empty",
                sheet(size, False, True, "empty"),
            ),
            figure(
                "Make public with the field blank: the error is under the field, and focus moves to it",
                sheet(size, False, True, "error"),
            ),
            figure(
                "After Make public: one write saves it private with the answer. The sheet closes, and the ⋯ menu no "
                "longer offers Make public",
                menu_after(),
            ),
        ]
    )


def main() -> None:
    """Draw every board and lay out each canvas.json."""
    heights = json.loads(Path(__file__).with_name("draw20261119P3StatementBoardsHeights.json").read_text())
    plan = [
        (
            EWEB,
            EMOB,
            EDITOR_HOST,
            "RecipeEditorStatementPaidSite",
            "Recipe editor, where it’s from: a paid website",
            editor_content,
        ),
        (
            DWEB,
            DMOB,
            DETAIL_HOST,
            "RecipeMakePublicStatementPaidSite",
            "Recipe detail, make public: a paid website",
            detail_content,
        ),
    ]
    for web, mob, host, family, words, content in plan:
        for canvas in (web, mob):
            made: list[tuple[str, int, int, str]] = []
            for size in [s for s in SIZES if s.startswith("Web") == (canvas == web)]:
                name = f"{family}{size}"
                width = WIDTH[size]
                h = max(heights[name], DEVICE_FLOOR.get(size, 0))
                title = f"{words} ({SIZE_WORDS[size]})"
                wide = " wide" if size == "Web1280" else ""
                html = fill(
                    board_path(canvas, f"{host}{size}").read_text(), f'<div class="p3{wide}">{content(size)}</div>'
                )
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


if __name__ == "__main__":
    main()
