# ruff: noqa: RUF001, E501  # Copy keeps the boards' typographic quotes; CSS rules, HTML and copy strings stay whole lines so each reads as written.
"""Draw the P10 recipe-page boards: a refused save after the cook left, and the page after Save and hide (#412).

One board family, RecipeHeldSaveDetail, on recipeDetailWeb (web 1280, 390) and recipeDetailMobile (iPhone 390, iPad
820), each showing:
- the AE7 owner line (plan U5): the cook saved, left the editor, and the server refused the save later. The page says
  the save did not happen and sends the cook to the editor, where the blocked-save sheet opens;
- the page after the cook's own Save and hide (plan U6): the owner-only "Hidden" chip in place of Public, and the
  owner line on the shipped hidden-after-a-report pattern ("… Only you can see it now.");
- notes for who sees neither, and for notifications.

RecipeHeldSaveDetailLargeText (web 390, iPhone 390) draws the same states at the largest text (ADR-0080 §8: text 2x,
titles 1.5x, glyphs scaled), so the owner line and the meta row are seen wrapping at true size.

The copy is the designer's DH20 and DH26 (squad record). Both lines are owner-only and are never in a live region.

Each board takes its head, sprite, shell and stack from RecipePublicVersionHidden at the same size (the shipped
hidden-recipe board, #526); this script replaces the stack's children and adds its rules (`.p10`). Heights (board ->
px) come from draw20261127P10HeldSaveDetailBoardsHeights.json, measured by a render. A board with no entry there stops
the run.

Run once from the repository root on its parent commit 015e7392f (pull request docs/p10HeldSaveDetailBoards):
python3 docs/design/canvasScripts/draw20261127P10HeldSaveDetailBoards.py
"""

import json
import re
from pathlib import Path

ROOT = Path("docs/design/canvases")
DWEB, DMOB = "recipeDetailWeb", "recipeDetailMobile"
HOST = "RecipePublicVersionHidden"
FAMILY = "RecipeHeldSaveDetail"

SIZES = ["Web1280", "Web390", "Iphone390", "Ipad820"]
LARGE_SIZES = ["Web390", "Iphone390"]
WIDTH = {"Web1280": 1280, "Web390": 390, "Iphone390": 390, "Ipad820": 820}
SIZE_WORDS = {
    "Web1280": "web, 1280",
    "Web390": "web, 390",
    "Iphone390": "mobile, iPhone 390",
    "Ipad820": "mobile, iPad 820",
}
# A device frame is never shorter than its screen (renderRepoCanvases measures the frame).
DEVICE_FLOOR = {"Iphone390": 844, "Ipad820": 1180}

M = {
    "notSaved": "Your changes weren’t saved because this recipe can’t stay public. Open the editor to choose what to do.",
    "hiddenOwner": "Hidden because it was saved with a source. Only you can see it now.",
    "saved": "Changes saved.",
}

P10_CSS = """
.p10-note { margin: 0 0 8px; padding: 6px 10px; border: 1px dashed var(--line-control); border-radius: 8px; font: 500 14px/20px var(--font-body); color: var(--ink-muted); }
.rd .p10-lt .rTitle { font-size: 42px; line-height: 48px; }
.rd .p10-lt .eyebrow { font-size: 28px; line-height: 36px; }
.rd .p10-lt .staticNotice p { font-size: 28px; line-height: 36px; }
.rd .p10-lt .metaRow2.t15, .rd .p10-lt .p10-snack { font-size: 32px; line-height: 40px; }
.rd .p10-lt .metaRow2 .mi { min-height: 44px; gap: 8px; }
.rd .p10-lt .ic { width: 40px; height: 40px; }
.rd .p10-lt .ic.sm { width: 32px; height: 32px; }
.p10-snack { align-self: center; margin: 16px auto 0; width: fit-content; padding: 12px 16px; border-radius: 12px; background: var(--ink); color: var(--canvas); font: 500 16px/24px var(--font-body); }
"""


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
    """Retitle and resize a board, and add the `.p10` rules."""
    s = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", s, count=1)
    s = re.sub(r'data-board="[^"]*"', f'data-board="{name}"', s)
    s = re.sub(
        r'"\$preview":(\s?)\{"width":(\s?)\d+,(\s?)"height":(\s?)\d+\}',
        lambda m: f'"$preview":{m[1]}{{"width":{m[2]}{width},{m[3]}"height":{m[4]}{height}}}',
        s,
    )
    s = re.sub(r'(<div [^>]*class="rd"[^>]*style="width: \d+px; )height: \d+px', rf"\1height: {height}px", s, count=1)
    s = re.sub(
        r'(class="nv-device[^"]*" style="width: \d+px; )min-height: \d+px', rf"\1min-height: {height}px", s, count=1
    )
    return s.replace("</style>", P10_CSS + "</style>", 1)


def icon(name: str, small: bool = False) -> str:
    """A glyph from the board's own sprite."""
    return f'<svg class="ic{" sm" if small else ""}" aria-hidden="true"><use href="#{name}" /></svg>'


def panel(notice: str, chip: tuple[str, str]) -> str:
    """The page's header card: cuisine, title, the owner line, then the meta row with the visibility chip."""
    glyph, word = chip
    return (
        '<div class="sPanel"><p class="eyebrow">British</p><h1 class="rTitle dish titleGap">Lemon and thyme roast chicken</h1>'
        f"{notice}"
        f'<div class="metaRow2 t15 soft"><span class="mi">{icon(glyph, True)}{word}</span><span class="sep" aria-hidden="true">·</span>'
        f'<a class="mi metaLink" href="#">{icon("history", True)}Version history</a></div></div>'
    )


def notice(glyph: str, line: str) -> str:
    """The owner line, on the shipped hidden-recipe notice."""
    return f'<div class="staticNotice hiddenNote">{icon(glyph)}<p>{line}</p></div>'


def figure(caption: str, body: str) -> str:
    """One captioned state."""
    return f'<div role="group" aria-label="{caption}"><p class="p10-note">{caption}</p>{body}</div>'


def content(large: bool) -> str:
    """Every state of the board; at the largest text, inside a `.p10-lt` scope."""
    states = "".join(
        [
            figure(
                "Owner, a save refused after the cook left the editor (AE7): the recipe is still public and unchanged. "
                "The line shows only while that refused save is parked on this device (new key). Edit opens the "
                "editor, which opens the blocked-save sheet at once, with the changes still there",
                panel(notice("alert", M["notSaved"]), ("globe", "Public")),
            ),
            figure(
                "Owner, after Save and hide (U6): the owner-only chip “Hidden” takes Public’s place, and the owner "
                "line follows the shipped hidden-after-a-report pattern (new key). The editor already said “Changes "
                "saved.”. No notification is sent, because the cook chose this",
                panel(notice("eyeOff", M["hiddenOwner"]), ("eyeOff", "Hidden"))
                + f'<p class="p10-snack" role="status">{M["saved"]}</p>',
            ),
            figure(
                "Not drawn: anyone else, signed in or not, gets the page’s existing not-found state for a hidden "
                "recipe; no chip and no line. Neither line shows for an unsent change that was never refused, or "
                "while the page is loading. A hide the cook did not choose (a check, a report, a staff correction) "
                "sends one notification whose text is its owner line",
                "",
            ),
        ]
    )
    if not large:
        return states
    lead = figure(
        "Largest text: 2x, titles 1.5x (ADR-0080 §8). The owner line and the meta row wrap; nothing is cut or "
        "truncated, and each link and chip stays at least 44 pt tall",
        "",
    )
    return f'{lead}<div class="p10-lt">{states}</div>'


def build(size: str, large: bool) -> str:
    """The host at `size` with its stack's states replaced."""
    canvas = DWEB if size.startswith("Web") else DMOB
    host = board_path(canvas, f"{HOST}{size}").read_text()
    return fill(host, r'<div class="sStack[^"]*">', content(large))


def main() -> None:
    """Draw every board and lay out each canvas.json."""
    heights = json.loads(Path(__file__).with_name("draw20261127P10HeldSaveDetailBoardsHeights.json").read_text())
    made: dict[str, list[tuple[str, int, int, str]]] = {DWEB: [], DMOB: []}
    families = [
        (FAMILY, "Recipe detail, a held public recipe’s refused save and Save and hide", SIZES, False),
        (f"{FAMILY}LargeText", "Recipe detail, refused save and Save and hide at the largest text", LARGE_SIZES, True),
    ]
    for family, words, sizes, large in families:
        for size in sizes:
            canvas = DWEB if size.startswith("Web") else DMOB
            name = f"{family}{size}"
            width = WIDTH[size]
            h = max(heights[name], DEVICE_FLOOR.get(size, 0))
            title = f"{words} ({SIZE_WORDS[size]})"
            board_path(canvas, name).write_text(set_meta(build(size, large), title, name, width, h))
            made[canvas].append((name, width, h, title))
    for canvas, boards in made.items():
        cj = ROOT / canvas / "project" / "canvas.json"
        d = json.loads(cj.read_text())
        y = max(b["y"] + b["h"] for b in d["boards"].values()) + 400
        x = 0
        for name, w, h, title in boards:
            key = f"{name}.dc.html"
            d["boards"][key] = {"x": x, "y": y, "w": w, "h": h, "title": title}
            if isinstance(d.get("order"), list) and key not in d["order"]:
                d["order"].append(key)
            x += w + 80
        cj.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
