# ruff: noqa: RUF001, E501  # Copy keeps the boards' typographic quotes; CSS rules, HTML and copy strings stay whole lines so each reads as written.
"""Draw the hiddenViews boards (plan U7, PR H3).

The owner's Hidden recipe page, the reader's not-found page and the Recipes list with a Hidden card.

recipeDetailWeb (web 1280, 390) and recipeDetailMobile (iPhone 390, Android 384, iPad 820):
- RecipeDetailHidden: the owner's page of a public recipe that readers cannot see. The status row reads "Hidden" with
  the eye-off glyph in Public's place, and the owner line sits under it in RecipeVisibilityNotice's standing slot:
  plain muted text, no box, never a live region (hiddenViews U5). Drawn with the staff source-correction line.
- RecipeDetailHiddenLines (web 390, iPhone 390): the header card three times, for the lines the reason picks:
  `sourceCorrected`, `heldSource`, and `other` or an unknown reason (the chip and no line).
- They replace RecipeDetailTooCloseAfterReview* and RecipeDetailSourceHoldAfterCheck* (a held recipe is hidden, never
  made private: ADR-0105). RecipePublicVersionHiddenReader* is retired: a reader of a hidden recipe gets the page's
  not-found state, RecipeNotFound*, which now shows the one sentence the app ships and no second line.

recipesAndCollectionsWeb (web 1280, 390) and recipesAndCollectionsMobile (iPhone 390, Android 384, iPad 820):
- RecipesHidden: the Recipes list with "Weeknight pad thai" hidden: the cover chip on a grid card, the badge pill on a
  list row. RecipesHiddenDark (web 1280, iPhone 390) is the same board in the dark theme.

Copy is the shipped `recipeState/messages.ts` (VIEW_HIDDEN, VIEW_HIDDEN_REASON.*) and `detail/messages.ts`
(notFoundTitle). Hosts are boards on the parent commit. Heights (board -> px) come from
draw20261128HiddenViewsBoardsHeights.json, measured by a render; a board with no entry stops the run.

Run once from the repository root on its parent commit b9fb2319b (branch docs/hiddenViewsBoards):
python3 docs/design/canvasScripts/draw20261128HiddenViewsBoards.py
"""

import json
import re
from pathlib import Path

ROOT = Path("docs/design/canvases")
DWEB, DMOB = "recipeDetailWeb", "recipeDetailMobile"
LWEB, LMOB = "recipesAndCollectionsWeb", "recipesAndCollectionsMobile"

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

M = {
    "hidden": "Hidden",
    "sourceCorrected": "Hidden because its source was corrected. Only you can see it now.",
    "heldSource": "Hidden because it was saved with a source. Only you can see it now.",
    "notFound": "This recipe isn’t available.",
}

RETIRED = ["RecipeDetailTooCloseAfterReview", "RecipeDetailSourceHoldAfterCheck", "RecipePublicVersionHiddenReader"]

EYE_OFF = '<symbol id="eyeOff" viewBox="0 0 24 24"><path d="M3 12s3.3-6 9-6 9 6 9 6-3.3 6-9 6-9-6-9-6z" /><circle cx="12" cy="12" r="2.5" /><path d="M4 4l16 16" /></symbol>'

HV_CSS = """
.rd .hvLine { margin: 12px 0 0; font: 400 14px/20px var(--font-body); color: var(--ink-muted); }
.nv-ios .rd > .sStack { padding-top: 63px; }
.hv-note { margin: 0 0 8px; padding: 6px 10px; border: 1px dashed var(--line-control); border-radius: 8px; font: 500 14px/20px var(--font-body); color: var(--ink-muted); }
"""

STATUS_PUBLIC_OR_PRIVATE = re.compile(
    r'(<div class="metaRow2[^"]*">\s*<span\s+class="mi"\s*>?\s*<svg[^>]*><use href=")#(?:lock|globe)("\s*>?</use>|"\s*/>)(</svg\s*>\s*)(?:Private|Public)(</span)'
)


def board_path(canvas: str, name: str) -> Path:
    """Path of a board file."""
    return ROOT / canvas / "project" / f"{name}.dc.html"


def _search(pattern: str, s: str, flags: int = 0) -> re.Match[str]:
    """The first match, or a ValueError naming the pattern: a host that changed shape stops the run."""
    m = re.search(pattern, s, flags)
    if m is None:
        raise ValueError(f"no match for {pattern!r}")
    return m


def _sub1(pattern: str | re.Pattern[str], repl: str, s: str) -> str:
    """Replace exactly one match, or stop the run."""
    out, n = re.subn(pattern, repl, s, count=1)
    if n != 1:
        raise ValueError(f"no match for {pattern!r}")
    return out


def element_end(s: str, start: int, tag: str) -> int:
    """Index just past the end tag that closes the `tag` element opened at `start`."""
    depth = 0
    for m in re.finditer(rf"<{tag}\b|</{tag}>", s[start:]):
        depth += -1 if m.group(0).startswith("</") else 1
        if depth == 0:
            return start + m.end()
    raise ValueError(f"unbalanced <{tag}> at {start}")


def with_sprite_and_rules(s: str) -> str:
    """Add the eye-off glyph to the board's sprite (if missing) and the `.hv` rules."""
    if 'id="eyeOff"' not in s:
        s = s.replace("</defs>", EYE_OFF + "</defs>", 1)
    return s.replace("</style>", HV_CSS + "</style>", 1)


def set_meta(s: str, title: str, name: str, width: int, height: int) -> str:
    """Retitle and resize a board."""
    s = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", s, count=1)
    s = re.sub(r'data-board="[^"]*"', f'data-board="{name}"', s)
    s = re.sub(
        r'"\$preview":(\s?)\{"width":(\s?)\d+,(\s?)"height":(\s?)\d+\}',
        lambda m: f'"$preview":{m[1]}{{"width":{m[2]}{width},{m[3]}"height":{m[4]}{height}}}',
        s,
    )
    s = re.sub(r'(<div [^>]*class="rd"[^>]*style="width: \d+px; )height: \d+px', rf"\1height: {height}px", s, count=1)
    return re.sub(
        r'(class="nv-device[^"]*" style="width: \d+px; )min-height: \d+px', rf"\1min-height: {height}px", s, count=1
    )


def hidden_status(s: str, line: str | None) -> str:
    """The first status row reads Hidden with the eye-off glyph; the owner line, if any, follows it."""
    m = _search(STATUS_PUBLIC_OR_PRIVATE.pattern, s)
    s = s[: m.start()] + f"{m[1]}#eyeOff{m[2]}{m[3]}{M['hidden']}{m[4]}" + s[m.end() :]
    if line is None:
        return s
    row = _search(r'<div class="metaRow2[^"]*">', s)
    end = element_end(s, row.start(), "div")
    return s[:end] + f'<p class="hvLine">{line}</p>' + s[end:]


def drop_state_box(s: str) -> str:
    """Remove the old "Made private after a check" box (the first region section)."""
    m = _search(r'<section role="region"', s)
    return s[: m.start()] + s[element_end(s, m.start(), "section") :]


def detail_page(size: str) -> str:
    """The owner's Hidden page: the source-hold board without its box, or (iPad) the detail page with its credit."""
    if size == "Ipad820":
        s = board_path(DMOB, "RecipeDetailIpad820").read_text()
        s = _sub1(
            r'<p class="adapted">\s*Copied from <a href="#">Ana Lima</a>\s*</p>',
            '<p class="adapted">From allrecipes.com</p>',
            s,
        )
    else:
        canvas = DWEB if size.startswith("Web") else DMOB
        s = drop_state_box(board_path(canvas, f"RecipeDetailSourceHoldAfterCheck{size}").read_text())
    return hidden_status(with_sprite_and_rules(s), M["sourceCorrected"])


def figure(caption: str, body: str) -> str:
    """One captioned state."""
    return f'<div role="group" aria-label="{caption}"><p class="hv-note">{caption}</p>{body}</div>'


def panel(line: str | None) -> str:
    """The page's header card: cuisine, title, the status row with Hidden, then the owner line."""
    eye = '<svg class="ic sm" aria-hidden="true"><use href="#eyeOff" /></svg>'
    hist = '<svg class="ic sm" aria-hidden="true"><use href="#history" /></svg>'
    owner = "" if line is None else f'<p class="hvLine">{line}</p>'
    return (
        '<div class="sPanel"><p class="eyebrow">British</p><h1 class="rTitle dish titleGap">Lemon and thyme roast chicken</h1>'
        f'<div class="metaRow2 t15 soft"><span class="mi">{eye}{M["hidden"]}</span><span class="sep" aria-hidden="true">·</span>'
        f'<a class="mi metaLink" href="#">{hist}Version history</a></div>{owner}<p class="adapted">From allrecipes.com</p></div>'
    )


def lines_board(size: str) -> str:
    """The header card once per line the reason picks, on the hidden public-version board's stack."""
    canvas = DWEB if size.startswith("Web") else DMOB
    host = with_sprite_and_rules(board_path(canvas, f"RecipePublicVersionHidden{size}").read_text())
    states = "".join(
        [
            figure(
                "Owner, hidden after a staff source correction (sourceCorrected)",
                panel(M["sourceCorrected"]),
            ),
            figure(
                "Owner, hidden because it was saved with a source (heldSource). No notification when the cook chose Save and hide",
                panel(M["heldSource"]),
            ),
            figure(
                "Owner, any other reason, or one this app version does not know (other): the chip alone, no line",
                panel(None),
            ),
            figure(
                "Not drawn: anyone else gets RecipeNotFound, with no chip and no line. Make private shows Private and no Hidden line. Cards show the chip and never the line",
                "",
            ),
        ]
    )
    m = _search(r'<div class="sStack[^"]*">', host)
    end = element_end(host, m.start(), "div")
    return host[: m.end()] + states + "</div>" + host[end:]


def hide_pad_thai(s: str) -> str:
    """Hide "Weeknight pad thai": a cover chip on a grid card, or the first pill on a list row."""
    eye = '<svg class="ic xs" aria-hidden="true"><use href="#eyeOff" /></svg>'
    if '<div class="ph imgPadThai"></div>' in s:
        return s.replace(
            '<div class="ph imgPadThai"></div>',
            f'<div class="ph imgPadThai"><span class="chip l">{eye}{M["hidden"]}</span></div>',
            1,
        )
    i = s.index("Weeknight pad thai")
    j = s.index('<div class="pills">', i)
    k = j + len('<div class="pills">')
    return s[:k] + f'<span class="pill">{eye}{M["hidden"]}</span>' + s[k:]


def recipes_board(size: str, dark: bool) -> str:
    """The Recipes list with one Hidden card, in the light or the dark theme."""
    canvas = LWEB if size.startswith("Web") else LMOB
    s = hide_pad_thai(with_sprite_and_rules(board_path(canvas, f"Recipes{size}").read_text()))
    if dark:
        s = _sub1(r'<div ([^>]*)class="rd"', r'<div \1data-theme="dark" class="rd"', s)
    return s


def not_found(s: str) -> str:
    """The reader's page: the one shipped sentence and no second line; the note says why."""
    s = _sub1(r'\s*<p class="soft">It may have been deleted, or its cook made it private\.</p>', "", s)
    return _sub1(
        r"No retry: the recipe is gone\.",
        "No retry. The same sentence shows for a recipe that was deleted, made private or hidden from readers, so nobody can tell which.",
        s,
    )


def place(canvas: str, boards: list[tuple[str, int, int, str]], note: str) -> None:
    """Lay new boards out in a row under a titled note at the bottom of the canvas, and drop retired boards."""
    cj = ROOT / canvas / "project" / "canvas.json"
    d = json.loads(cj.read_text())
    for key in [k for k in d["boards"] if any(k.startswith(r) for r in RETIRED)]:
        del d["boards"][key]
        d["order"] = [o for o in d["order"] if o != key]
    y = max(b["y"] + b["h"] for b in d["boards"].values()) + 400
    d["notes"][f"rowHidden{canvas}"] = {"x": 0, "y": y, "text": note, "kind": "title1", "maxW": 2400}
    x, y = 0, y + 260
    for name, w, h, title in boards:
        key = f"{name}.dc.html"
        d["boards"][key] = {"x": x, "y": y, "w": w, "h": h, "title": title}
        if key not in d["order"]:
            d["order"].append(key)
        x += w + 80
    cj.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")


def main() -> None:
    """Draw every board, delete the retired ones and lay out each canvas.json."""
    heights = json.loads(Path(__file__).with_name("draw20261128HiddenViewsBoardsHeights.json").read_text())
    made: dict[str, list[tuple[str, int, int, str]]] = {DWEB: [], DMOB: [], LWEB: [], LMOB: []}

    def write(canvas: str, name: str, size: str, words: str, s: str) -> None:
        h = max(heights[name], DEVICE_FLOOR.get(size, 0))
        title = f"{words} ({SIZE_WORDS[size]})"
        board_path(canvas, name).write_text(set_meta(s, title, name, WIDTH[size], h))
        made[canvas].append((name, WIDTH[size], h, title))

    for size in SIZES:
        dc = DWEB if size.startswith("Web") else DMOB
        lc = LWEB if size.startswith("Web") else LMOB
        write(dc, f"RecipeDetailHidden{size}", size, "Recipe detail, hidden from readers (owner)", detail_page(size))
        if size in ("Web390", "Iphone390"):
            write(
                dc,
                f"RecipeDetailHiddenLines{size}",
                size,
                "Recipe detail, hidden: the owner line per reason",
                lines_board(size),
            )
        write(lc, f"RecipesHidden{size}", size, "My recipes, a hidden recipe", recipes_board(size, dark=False))
        if size in ("Web1280", "Iphone390"):
            write(
                lc,
                f"RecipesHiddenDark{size}",
                size,
                "My recipes, a hidden recipe, dark theme",
                recipes_board(size, dark=True),
            )
        nf = board_path(dc, f"RecipeNotFound{size}")
        nf.write_text(not_found(nf.read_text()))

    for canvas in (DWEB, DMOB):
        for f in (ROOT / canvas / "project").glob("*.dc.html"):
            if any(f.name.startswith(r) for r in RETIRED):
                f.unlink()
    place(DWEB, made[DWEB], "Recipe detail, hidden from readers (hiddenViews): web")
    place(DMOB, made[DMOB], "Recipe detail, hidden from readers (hiddenViews): mobile")
    place(LWEB, made[LWEB], "My recipes, a hidden recipe (hiddenViews): web")
    place(LMOB, made[LMOB], "My recipes, a hidden recipe (hiddenViews): mobile")


if __name__ == "__main__":
    main()
