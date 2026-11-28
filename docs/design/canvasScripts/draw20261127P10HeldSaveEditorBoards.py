# ruff: noqa: RUF001, E501  # Copy keeps the boards' typographic quotes; CSS rules, HTML and copy strings stay whole lines so each reads as written.
"""Draw the P10 editor boards: a held public recipe's save is blocked and the cook picks a way out (heldPublicSave, #412).

Board families, on recipeEditorWeb (web 1280, 390) and recipeEditorMobile (iPhone 390, Android 384, iPad 820):
- RecipeEditorHeldSave: the "Who can see it" card with Public kept and its reason line (plan U3), then the blocked-save
  sheet for every door and slot row of the ways-out policy (plan U5, U6): the save door with a free slot, for a free
  cook and a Pro cook; with no free slot before and after Save and hide (U6); with the rewrite way once P4b and 020
  plug it in; the draft door with a free slot (alone and after a rewrite way) and with none; and the card after
  "Make private and save". Notes cover offline, the wait for the rewrite answer, focus and Discard.
- RecipeEditorHeldSaveLargeText (iPhone 390, web 390): the save-door sheet at the largest text (2x; titles 1.5x).

The copy is the designer's DH17 to DH26 (squad record), merged with Nova's list. Keys marked new in the notes do not
exist on main. Ways carry equal weight: each way is its line and a secondary button under it, in the policy's fixed
order (rewrite, Discard, then Make private and save, or Save and hide when no slot is free). The Pro line and its
ghost "See Pro" come after the ways, for a free cook only. "Back to editor" closes, keeping the edit on the device.

Captions are builder notes in a dashed box (`.p10-note`), so none can pass for UI copy.

Each board takes its head, shell and page container from the P6 sibling RecipeEditorRefusalNotice at the same size;
this script replaces the page's children and adds its rules (`.p10`). Phones and the iPad draw the design-system
BottomSheetPanel; web 1280 draws the house dialog by hand, as RecipeEditorCreateFoodWeb1280 does. The large-text board
is drawn by hand at true size. Heights (board -> px) come from draw20261127P10HeldSaveEditorBoardsHeights.json,
measured by a render. A board with no entry there stops the run.

Run once from the repository root on its parent commit 015e7392f (pull request docs/p10HeldSaveEditorBoards):
python3 docs/design/canvasScripts/draw20261127P10HeldSaveEditorBoards.py
"""

import json
import re
from pathlib import Path

ROOT = Path("docs/design/canvases")
EWEB, EMOB = "recipeEditorWeb", "recipeEditorMobile"
HOST = "RecipeEditorRefusalNotice"

SIZES = ["Web1280", "Web390", "Iphone390", "Android384", "Ipad820"]
LARGE_SIZES = ["Web390", "Iphone390"]
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
    "titleSave": "This recipe can’t stay public",
    "titlePublish": "This recipe can’t be public",
    "why": "It was saved with a source, such as a web page or a book, so it can’t be public.",
    "changesKept": "Your changes are kept on this device. The public recipe hasn’t changed.",
    "draftKept": "Your recipe is saved as a draft.",
    "waysHeading": "To go on",
    "wayRewrite": "Change the steps in your own words to keep it public.",
    "rewrite": "Edit steps",
    "wayDiscard": "Discard your changes to keep the public recipe as it is.",
    "discard": "Discard",
    "wayPrivateSave": "Or make this recipe private. Other cooks won’t be able to see it anymore.",
    "savePrivate": "Make private and save",
    "wayHide": "Or save your changes and hide this recipe. Only you will be able to see it, and it won’t use one of your private recipes.",
    "saveHide": "Save and hide",
    "wayPublishFirst": "Publish this recipe as private instead.",
    "wayPrivatePublish": "Or publish this recipe as private.",
    "publishPrivate": "Publish as private",
    "slotsFull": "Your private recipes are full, so this recipe can’t be made private right now.",
    "upsell": "Pro gives you unlimited private recipes, plus {premiumFeatures}.",
    "seePro": "See Pro",
    "back": "Back to editor",
    "closeLabel": "Close this message",
    "cardReason": "This recipe can’t stay public because it was saved with a source.",
    "privateReason": "This recipe stays private because it was saved with a source.",
    "publicHint": "Anyone can find it in Discover",
    "privateHint": "Only you can see it",
    "saved": "Changes saved.",
}

P10_CSS = """
.p10-note { margin: 0 0 8px; padding: 6px 10px; border: 1px dashed var(--line-control); border-radius: 8px; font: 500 14px/20px var(--font-body); color: var(--ink-muted); }
.p10-stage { position: relative; display: flex; flex-direction: column; justify-content: flex-end; padding-top: 48px; background: var(--canvas); overflow: hidden; }
.p10-stage.p10-dlg { justify-content: center; align-items: center; padding: 48px 24px; }
.p10-scrim { position: absolute; inset: 0; background: var(--scrim); }
.p10-sh { position: relative; display: flex; flex-direction: column; min-height: 0; }
.p10-body { display: flex; flex-direction: column; gap: 16px; }
.p10-why { font: 400 16px/24px var(--font-body); color: var(--ink); }
.p10-meta { font: 400 14px/20px var(--font-body); color: var(--ink-muted); }
.p10-h { font: 600 14px/20px var(--font-body); color: var(--ink); }
.p10-ways { display: flex; flex-direction: column; gap: 16px; margin: 0; padding: 0; list-style: none; }
.p10-way { display: flex; flex-direction: column; align-items: stretch; gap: 8px; }
.p10-way p { font: 400 16px/24px var(--font-body); color: var(--ink); }
.p10-pro { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding-top: 16px; border-top: 1px solid var(--line-divider); }
.p10-close { display: flex; flex-direction: column; align-items: stretch; padding-top: 8px; }
.p10-dialog { position: relative; display: flex; flex-direction: column; width: 100%; max-width: 448px; background: var(--paper-overlay); border-radius: 24px; box-shadow: var(--shadow-lg); }
.p10-trow { display: flex; align-items: flex-start; gap: 8px; padding: 8px 8px 0 24px; }
.p10-ttl { flex: 1; min-width: 0; padding-top: 12px; font: 600 16px/20px var(--font-display); color: var(--ink); }
.p10-x { display: flex; flex-shrink: 0; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 9999px; color: var(--ink-muted); }
.p10-sbody { padding: 16px 24px 24px; }
.p10-dialog .p10-way { align-items: flex-start; }
.p10-dialog .p10-close { align-items: flex-end; }
.p10-snack { align-self: center; margin-top: 16px; padding: 12px 16px; border-radius: 12px; background: var(--ink); color: var(--canvas); font: 500 16px/24px var(--font-body); }
.p10-lt .p10-ttl { font: 600 24px/32px var(--font-display); }
.p10-lt .p10-x { width: 64px; height: 64px; }
.p10-lt .p10-why, .p10-lt .p10-way p { font: 400 32px/40px var(--font-body); }
.p10-lt .p10-meta { font: 400 28px/36px var(--font-body); }
.p10-lt .p10-h { font: 600 28px/36px var(--font-body); }
.p10-lt .p10-body, .p10-lt .p10-ways { gap: 24px; }
.p10-btn { display: flex; align-items: center; justify-content: center; min-height: 64px; padding: 12px 24px; border-radius: 999px; background: var(--paper); box-shadow: inset 0 0 0 1px var(--line-control); font: 600 32px/40px var(--font-body); color: var(--ink); text-align: center; }
.p10-btn.p10-ghost { background: transparent; box-shadow: none; color: var(--action-text); }
.p10-panel { position: relative; display: flex; flex-direction: column; background: var(--paper-overlay); border-radius: 24px 24px 0 0; box-shadow: var(--shadow-lg); }
.p10-panel .p10-sbody { padding: 16px 16px 24px; }
"""

NOTE = "p10-note"


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


def set_meta(s: str, title: str, width: int, height: int) -> str:
    """Retitle and resize a board, and add the `.p10` rules."""
    s = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", s, count=1)
    s = re.sub(
        r'"\$preview":(\s?)\{"width":(\s?)\d+,(\s?)"height":(\s?)\d+\}',
        lambda m: f'"$preview":{m[1]}{{"width":{m[2]}{width},{m[3]}"height":{m[4]}{height}}}',
        s,
    )
    s = re.sub(
        r'(class="nv-device[^"]*" style="width: \d+px; )min-height: \d+px', rf"\1min-height: {height}px", s, count=1
    )
    return s.replace("</style>", P10_CSS + "</style>", 1)


# Parts.


def button(size: str, label: str, variant: str = "secondary") -> str:
    """A design-system button: the web one at 1280, the shared native one elsewhere (as the hosts do)."""
    scope = "Commise.Button" if size == "Web1280" else "Commise.Native.Button"
    return f'<x-import component-from-global-scope="{scope}" variant="{variant}" size="md">{label}</x-import>'


def way(size: str, line: str, label: str) -> str:
    """One way out: its line, then its own button. Every way has the same weight."""
    return f'<li class="p10-way"><p>{line}</p>{button(size, label)}</li>'


def sheet_body(size: str, door: str, ways: list[tuple[str, str]], slots_full: bool, pro: bool) -> str:
    """The sheet's content: why, what is kept, the ways (with their heading only when there are any), Pro, close."""
    kept = M["changesKept"] if door == "save" else M["draftKept"]
    parts = [f'<p class="p10-why">{M["why"]}</p>', f'<p class="p10-meta">{kept}</p>']
    if ways:
        parts.append(f'<h3 class="p10-h">{M["waysHeading"]}</h3>')
        parts.append('<ul class="p10-ways">' + "".join(way(size, line, label) for line, label in ways) + "</ul>")
    if slots_full:
        parts.append(f'<p class="p10-meta">{M["slotsFull"]}</p>')
    if pro:
        parts.append(
            f'<div class="p10-pro"><p class="p10-meta">{M["upsell"]}</p>{button(size, M["seePro"], "ghost")}</div>'
        )
    parts.append(f'<div class="p10-close">{button(size, M["back"])}</div>')
    return '<div class="p10-body">' + "".join(parts) + "</div>"


def sheet(size: str, door: str, ways: list[tuple[str, str]], slots_full: bool, pro: bool) -> str:
    """The blocked-save sheet on its stage: a dialog at 1280, the design-system bottom sheet elsewhere."""
    title = M["titleSave"] if door == "save" else M["titlePublish"]
    body = sheet_body(size, door, ways, slots_full, pro)
    if size.startswith("Web"):
        dialog = size == "Web1280"
        return (
            f'<div class="p10-stage{" p10-dlg" if dialog else ""}"><div class="p10-scrim"></div>'
            f'<div class="{"p10-dialog" if dialog else "p10-panel"}" role="dialog" aria-label="{title}"><div class="p10-trow"><h2 class="p10-ttl">{title}</h2>'
            f'<span class="p10-x" aria-label="{M["closeLabel"]}"><x-import component-from-global-scope="Commise.Icon" name="x" size="20"></x-import></span></div>'
            f'<div class="p10-sbody">{body}</div></div></div>'
        )
    return (
        '<div class="p10-stage"><div class="p10-scrim"></div><div class="p10-sh">'
        f'<x-import component-from-global-scope="Commise.Native.BottomSheetPanel" close-label="{M["closeLabel"]}" '
        f'focus-signal="{{{{one}}}}" on-close="{{{{noop}}}}" reduce-motion="{{{{yes}}}}" size="content" title="{title}">'
        f"{body}</x-import></div></div>"
    )


def figure(caption: str, body: str) -> str:
    """One captioned state."""
    return f'<section class="fig" aria-label="{caption}"><p class="{NOTE}">{caption}</p>{body}</section>'


def radio_styles(host: str) -> dict[str, str]:
    """The host's three radio card styles: chosen, open and refused."""
    styles: dict[str, str] = {}
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


def private_card(styles: dict[str, str]) -> str:
    """The field once the recipe is private: Public refused with P6's shipped sourceConflict line, Private chosen."""
    return (
        '<div style="display: flex; flex-direction: column; gap: 8px"><span class="vl">Who can see it</span>'
        '<div role="radiogroup" aria-label="Who can see it" style="display: flex; flex-direction: column; gap: 8px">'
        f'<div role="radio" aria-checked="false" aria-disabled="true" aria-describedby="why-afterPrivate" style="{styles["refused"]}">'
        '<div style="display: flex; flex-direction: column; min-width: 0; flex: 1"><span class="vt" style="color: var(--ink-muted)">Public</span>'
        f'<span class="vh" id="why-afterPrivate">{M["privateReason"]}</span></div></div>'
        f'<div role="radio" aria-checked="true" style="{styles["chosen"]}">'
        '<div style="display: flex; flex-direction: column; min-width: 0; flex: 1">'
        f'<span class="vt">Private</span><span class="vh">{M["privateHint"]}</span></div></div></div></div>'
    )


def card(styles: dict[str, str]) -> str:
    """The "Who can see it" field for a held public recipe: Public chosen with its reason line, and Private."""
    pub = (
        f'<div role="radio" aria-checked="true" aria-describedby="why-held" style="{styles["chosen"]}">'
        '<div style="display: flex; flex-direction: column; min-width: 0; flex: 1">'
        f'<span class="vt">Public</span><span class="vh">{M["publicHint"]}</span><span class="vh" id="why-held">{M["cardReason"]}</span></div></div>'
    )
    priv = (
        f'<div role="radio" aria-checked="false" style="{styles["open"]}">'
        '<div style="display: flex; flex-direction: column; min-width: 0; flex: 1">'
        f'<span class="vt">Private</span><span class="vh">{M["privateHint"]}</span></div></div>'
    )
    return (
        '<div style="display: flex; flex-direction: column; gap: 8px"><span class="vl">Who can see it</span>'
        f'<div role="radiogroup" aria-label="Who can see it" style="display: flex; flex-direction: column; gap: 8px">{pub}{priv}</div></div>'
    )


def editor_content(size: str, host: str) -> str:
    """Every state of the editor board."""
    styles = radio_styles(host)
    rewrite = (M["wayRewrite"], M["rewrite"])
    discard = (M["wayDiscard"], M["discard"])
    private = (M["wayPrivateSave"], M["savePrivate"])
    hide = (M["wayHide"], M["saveHide"])
    figs = [
        figure(
            "The card (U3): a published public recipe held by its source keeps Public chosen, the cook’s choice. The "
            "reason is a second description line under Public (new key) and is never spoken by itself. With the "
            "toggle off the card is today’s",
            card(styles),
        ),
        figure(
            "Save on a held public recipe, a free cook with a free private slot (the first shipped shape: no rewrite "
            "way until P4b). The sheet opens before anything is sent, or on the server’s refusal. Ways in the policy’s "
            "order, equal weight, nothing preselected. The Pro line comes after the ways, behind the subscription "
            "switch. Focus starts on the title; Back to editor returns it to Save",
            sheet(size, "save", [discard, private], False, True),
        ),
        figure(
            "The same for a Pro cook, or with the subscription switch off: no Pro line",
            sheet(size, "save", [discard, private], False, False),
        ),
        figure(
            "No free slot, from U6: Save and hide takes Private’s place, always last (new keys). It saves the edit, "
            "keeps the recipe public in the cook’s list and hides it from everyone else. No notification follows",
            sheet(size, "save", [discard, hide], False, True),
        ),
        figure(
            "No free slot, before U6 (toggle still off in production): the slots-full line instead of a way",
            sheet(size, "save", [discard], True, True),
        ),
        figure(
            "When P4b and 020 plug in the rewrite way, it comes first (new keys). Edit steps closes the sheet and "
            "moves focus to the first step field; the next Save goes to the server once. The “Adapted by you” label "
            "never shows here, only on the saved recipe",
            sheet(size, "save", [rewrite, discard, private], False, True),
        ),
        figure(
            "The draft door (publish a draft, or a new recipe), free slot: its own title (new key), the draft is "
            "kept, no Discard. With no way before it, the private way is its own line without “Or” (new key)",
            sheet(size, "publish", [(M["wayPublishFirst"], M["publishPrivate"])], False, True),
        ),
        figure(
            "The draft door after a rewrite way: the shipped “Or publish this recipe as private.”",
            sheet(size, "publish", [rewrite, (M["wayPrivatePublish"], M["publishPrivate"])], False, True),
        ),
        figure(
            "The draft door with no free slot and no rewrite way: no “To go on” heading over nothing. The draft is "
            "safe, so this is valid",
            sheet(size, "publish", [], True, True),
        ),
        figure(
            "After Make private and save: one write, and the snackbar says “Changes saved.”. The recipe is now a "
            "private held recipe, so the field is today’s (board P6): Public refused with its shipped line, Private "
            "chosen. If the hold cleared before the save reached the server, Public is offered again with no line "
            "(the plain private field). A full slot found by the server reopens the sheet after the slots are read "
            "again, so it never offers a dead Make private",
            private_card(styles) + f'<p class="p10-snack" role="status">{M["saved"]}</p>',
        ),
        figure(
            "Not drawn, same as above: offline the sheet opens the same way, and Make private and save or Save and "
            "hide waits on the device and is sent when back online (the editor’s usual status). While the rewrite "
            "answer is awaited (1 second at most), Save shows its busy state and the sheet never opens half built. "
            "Discard here is the confirmation, so no second confirm opens. A staff-corrected recipe never opens this "
            "sheet",
            "",
        ),
    ]
    return "".join(figs)


def large_content(size: str) -> str:
    """The longest save-door sheet (every way and the Pro line) at the largest text, drawn by hand at true size."""
    ways = [(M["wayRewrite"], M["rewrite"]), (M["wayDiscard"], M["discard"]), (M["wayPrivateSave"], M["savePrivate"])]
    items = "".join(
        f'<li class="p10-way"><p>{line}</p><span class="p10-btn">{label}</span></li>' for line, label in ways
    )
    body = (
        f'<div class="p10-body"><p class="p10-why">{M["why"]}</p><p class="p10-meta">{M["changesKept"]}</p>'
        f'<h3 class="p10-h">{M["waysHeading"]}</h3><ul class="p10-ways">{items}</ul>'
        f'<div class="p10-pro"><p class="p10-meta">{M["upsell"]}</p><span class="p10-btn p10-ghost">{M["seePro"]}</span></div>'
        f'<div class="p10-close"><span class="p10-btn">{M["back"]}</span></div></div>'
    )
    words = "Largest text: 2x, titles 1.5x (ADR-0080 §8)" if size != "Web390" else "200 percent browser text"
    icon = "Commise.Icon" if size.startswith("Web") else "Commise.Native.Icon"
    caption = (
        f"{words}, the longest sheet (rewrite way, Discard, Make private and save, the Pro line), drawn whole as one "
        "strip at true size. On a device it scrolls under its title row and close button. Every button is full "
        "width and stacked, each at least 44 pt, in the same order; nothing is cut or truncated"
    )
    panel = (
        '<div class="p10-stage p10-lt"><div class="p10-scrim"></div><div class="p10-panel" role="dialog" '
        f'aria-label="{M["titleSave"]}"><div class="p10-trow"><h2 class="p10-ttl">{M["titleSave"]}</h2>'
        f'<span class="p10-x" aria-label="{M["closeLabel"]}"><x-import component-from-global-scope="{icon}" name="x" size="40"></x-import></span></div>'
        f'<div class="p10-sbody">{body}</div></div></div>'
    )
    return figure(caption, panel)


# The run.


def build(size: str, large: bool) -> str:
    """The host at `size` with its page's figures replaced."""
    canvas = EWEB if size.startswith("Web") else EMOB
    host = board_path(canvas, f"{HOST}{size}").read_text()
    content = large_content(size) if large else editor_content(size, host)
    return fill(host, r'<(?:main|div) class="page"[^>]*>', content)


def main() -> None:
    """Draw every board and lay out each canvas.json."""
    heights = json.loads(Path(__file__).with_name("draw20261127P10HeldSaveEditorBoardsHeights.json").read_text())
    plan = [
        ("RecipeEditorHeldSave", "Recipe editor, a held public recipe’s save is blocked", SIZES, False),
        ("RecipeEditorHeldSaveLargeText", "Recipe editor, blocked save at the largest text", LARGE_SIZES, True),
    ]
    made: dict[str, list[tuple[str, int, int, str]]] = {EWEB: [], EMOB: []}
    for family, words, sizes, large in plan:
        for size in sizes:
            canvas = EWEB if size.startswith("Web") else EMOB
            name = f"{family}{size}"
            width = WIDTH[size]
            h = max(heights[name], DEVICE_FLOOR.get(size, 0))
            title = f"{words} ({SIZE_WORDS[size]})"
            board_path(canvas, name).write_text(set_meta(build(size, large), title, width, h))
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
