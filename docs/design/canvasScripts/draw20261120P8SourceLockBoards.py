# ruff: noqa: RUF001, E501  # Copy keeps the boards' typographic quotes; CSS rules, HTML and copy strings stay whole lines so each reads as written.
"""Draw the P8 boards: every confirmed source answer locked (everyAnswerSourceLock, designer parts D0-D7).

Three board families, each at web 1280 and 390, iPhone 390, Android 384 and iPad 820:
- RecipeEditorSourceLock on recipeEditorWeb and recipeEditorMobile: the editor's Source row in each state of D0 (open
  with no answer, open with a link and the warning, a published recipe with no answer, an imported book not yet
  confirmed, "I wrote this", every locked answer with the help link, no support address), the downgrade's success,
  the lock refusal notice, a recipe staff corrected, and the paste note on an "I wrote this" recipe.
- RecipeEditorSourceSheet on the same canvases: the statement sheet in the editor's three new modes (first answer,
  change, downgrade) and the downgrade refused for private slots, with `lockNote` only where confirming locks.
- RecipeSourceLockDetail on recipeDetailWeb and recipeDetailMobile: the Make public sheet on a private "I wrote this"
  recipe, the same sheet after a lock refusal, and the recipe page's lines after a staff correction, held and not held.

It also redraws copy P8 changes on the P3 boards RecipeEditorStatementPaidSite and RecipeMakePublicStatementPaidSite:
the locked line becomes "Only Commise can change this source." with the help link under it, and the Publish and Make
public sheets add `lockNote` under the web page, cookbook and person hints (the paid website hint already ends with it).

Each new board is built from the P3 board at the same size (its head, shell and `.p3` styles); this script replaces
only the children of the `.p3` container and adds its own rules (`.p8`). Heights (board -> px) come from
draw20261120P8SourceLockBoardsHeights.json, measured by a render; with no such file every board is drawn at its floor.

Copy and states: brainstorms/2026-11-20-everyAnswerSourceLock-parts/designer.md and
decisions/everyAnswerSourceLock-designer.md (Solar Squad), board P8.

Run once from the repository root on its parent commit fe0cc7af6 (branch docs/p8SourceLockBoards, stacked on #413):
python3 docs/design/canvasScripts/draw20261120P8SourceLockBoards.py
"""

import itertools
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
DEVICE_FLOOR = {"Iphone390": 844, "Android384": 832, "Ipad820": 1180}
DIALOG = {"Web1280", "Ipad820"}

EDITOR_HOST = "RecipeEditorStatementPaidSite"
DETAIL_HOST = "RecipeMakePublicStatementPaidSite"

# Copy (en), word for word from the parts file D1-D7 and main's messages.
M = {
    "label": "Source",
    "hint": "Copied this recipe from a web page? Paste its link.",
    "rights": "Copied from a public web page · roastandthyme.example",
    "remove": "Remove source",
    "lockWarning": "Once you publish, this source can’t be changed.",
    "lockWarningSave": "Once you save, this source can’t be changed.",
    "sayWhere": "Not from a web page? Say where it’s from",
    "changeAnswer": "Change where it’s from",
    "changeOwn": "Change where it’s from",
    "locked": "Only Commise can change this source.",
    "oldLocked": "The source of this recipe can’t be changed.",
    "askWeb": "Ask us to change it (opens in a new tab)",
    "askNative": "Ask us to change it, opens in your browser",
    "askOtherWeb": "From somewhere else? Ask us to change it (opens in a new tab)",
    "askOtherNative": "From somewhere else? Ask us to change it, opens in your browser",
    "openWeb": "roastandthyme.example (opens in a new tab)",
    "openNative": "roastandthyme.example, opens in your browser",
    "url": "https://roastandthyme.example/lemon-thyme-chicken",
    "lockedRefused": "That source change wasn’t saved. Only Commise can change this source.",
    "announceDowngrade": "Source set to From a cookbook or magazine. This recipe is private now.",
    "ownLinkLeftOut": "Left out the link, because this recipe says you wrote it. If it came from that page, use the link under Source to ask us.",
    "title": "Where is this recipe from?",
    "body": "Part of this recipe was pasted in. Before it goes public, tell us where it’s from.",
    "bodyDowngrade": "If it came from a cookbook, magazine or paid website, say so here. It will be private to you, and you can’t change it back.",
    "effect": "If your answer isn’t true, we can remove the recipe and limit your account.",
    "confirm": "Confirm",
    "cancel": "Cancel",
    "makePublic": "Make public",
    "lockNote": "Once you confirm, this answer is locked.",
    "bookLabel": "Book or magazine title",
    "webLabel": "Link to the page",
    "slotsFull": "Not available. All 50 of your private slots are in use.",
    "policyBook": "This recipe stays private because it’s from a cookbook or magazine.",
    "sourceCorrected": "This recipe stays private because its source was corrected.",
    "publicHint": "Anyone can find it in Discover",
    "privateHint": "Only you can see it",
}
ANSWER = {
    "own": (
        "I wrote this",
        "It’s my own recipe, in my own words, and any photos are mine. It isn’t copied from a website, book or another person. Goes public.",
    ),
    "web": ("From a web page", "Stays private to you."),
    "paid": ("From a paid website", "A recipe from a website you pay for, like a subscription. Stays private to you."),
    "book": ("From a cookbook or magazine", "Stays private to you."),
    "person": ("From another person", "A recipe someone gave you, like family or a friend. Stays private to you."),
}
BOOK = "The Sunday Roast Book"
PAID = "bakeclub.example"

LOCK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'
CLOSE = '<span class="p3-x" role="button" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></span>'
CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'

P8_CSS = """
.p3 .p8-note { margin: 0 0 8px; padding: 6px 10px; border: 1px dashed var(--line-control); border-radius: 8px; font: 500 14px/20px var(--font-body); color: var(--ink-muted); }
.p3 .p8-ans { display: block; font: 500 14px/20px var(--font-body); color: var(--ink); overflow-wrap: anywhere; }
.p3 .p8-cit { display: block; font: 400 14px/20px var(--font-body); color: var(--ink-muted); overflow-wrap: anywhere; }
.p3 .p8-warn { margin: 0; font: 400 14px/20px var(--font-body); color: var(--ink-muted); }
.p3 .p8-link { display: inline-flex; align-items: center; align-self: flex-start; min-height: 44px; font: 500 14px/20px var(--font-body); color: var(--action-text); text-decoration: underline; text-underline-offset: 2px; overflow-wrap: anywhere; }
.p3 .p8-ghost { display: inline-flex; align-items: center; align-self: flex-start; min-height: 44px; padding: 0 12px; margin-left: -12px; border-radius: var(--radius-md); font: 600 16px/24px var(--font-body); color: var(--action-text); }
.p3 .p8-inp { overflow-wrap: anywhere; }
.p3 .p8-row { display: flex; flex-direction: column; gap: 4px; }
.p3 .p8-snack { display: flex; align-items: center; min-height: 48px; padding: 12px 16px; border-radius: var(--radius-md); background: var(--inverse); color: var(--inverse-ink); font: 400 14px/20px var(--font-body); box-shadow: var(--shadow-xl); }
.p3 .p8-err { margin: 0; font: 500 14px/20px var(--font-body); color: var(--danger-text); }
.p3 .p8-stand { margin: 0; font: 400 14px/20px var(--font-body); color: var(--ink-muted); }
.p3 .p8-rtitle { margin: 0; font: 600 28px/36px var(--font-display); color: var(--ink); }
.p3 .p8-meta { display: flex; align-items: center; gap: 6px; font: 500 14px/20px var(--font-body); color: var(--ink-muted); }
.p3 .p8-meta svg { width: 16px; height: 16px; }
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


def set_meta(s: str, title: str, width: int, height: int) -> str:
    """Retitle and resize a board, and add the `.p8` rules."""
    s = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", s, count=1)
    s = re.sub(r"\s*<!-- Native board.*?-->", "", s, count=1, flags=re.S)
    s = re.sub(
        r'"\$preview":(\s?)\{"width":(\s?)\d+,(\s?)"height":(\s?)\d+\}',
        lambda m: f'"$preview":{m[1]}{{"width":{m[2]}{width},{m[3]}"height":{m[4]}{height}}}',
        s,
    )
    s = re.sub(
        r'(class="nv-device[^"]*" style="width: \d+px; )min-height: \d+px', rf"\1min-height: {height}px", s, count=1
    )
    return s.replace("</style>", P8_CSS + "</style>", 1)


# Pieces.


def native(size: str) -> bool:
    """A native board (its links open the browser)."""
    return not size.startswith("Web")


def fig(caption: str, body: str) -> str:
    """One captioned state; the caption is a builder note in a dashed box, never UI copy."""
    return f'<div class="p3-fig" role="group" aria-label="{caption}"><p class="p8-note">{caption}</p>{body}</div>'


def plain(body: str) -> str:
    """A screen region on the page canvas."""
    return f'<div class="p3-stage p3-plain"><div class="p3-card">{body}</div></div>'


def link(text: str) -> str:
    """A text link."""
    return f'<span class="p8-link" role="link">{text}</span>'


def ghost(text: str) -> str:
    """A ghost text button."""
    return f'<span class="p8-ghost" role="button">{text}</span>'


def ask(size: str, other: bool = False) -> str:
    """The help link (R12)."""
    if other:
        return link(M["askOtherNative"] if native(size) else M["askOtherWeb"])
    return link(M["askNative"] if native(size) else M["askWeb"])


# Board-unique ids for aria-describedby pairs (html-validate no-dup-id).
_IDS = itertools.count(1)


def lock_line() -> str:
    """The locked line, in P3's style."""
    return f'<p class="p3-lock">{LOCK_ICON}<span>{M["locked"]}</span></p>'


def row(*parts: str) -> str:
    """The Source row."""
    return f'<div class="p8-row"><span class="p3-lbl">{M["label"]}</span>{"".join(parts)}</div>'


def field(text: str, status: str, warn: str = "", extra: str = "") -> str:
    """The open row's web-link field: status (hint or rights line), the input, the warning, then its buttons."""
    n = next(_IDS)
    inp_cls = "p3-inp p8-inp p3-on" if text else "p3-inp p8-inp"
    w = f'<p class="p8-warn" id="srcWarn{n}">{warn}</p>' if warn else ""
    rm = ghost(M["remove"]) if text else ""
    described = f' aria-describedby="srcStatus{n} srcWarn{n}"' if warn else f' aria-describedby="srcStatus{n}"'
    return (
        f'<span class="p3-h" id="srcStatus{n}">{status}</span>'
        f'<div class="{inp_cls}" role="textbox" aria-label="{M["label"]}"{described}>{text}</div>{w}{rm}{extra}'
    )


def answer(text: str, citation: str = "") -> str:
    """An answer and its citation."""
    c = f'<span class="p8-cit">{citation}</span>' if citation else ""
    return f'<span class="p8-ans">{text}</span>{c}'


def visibility(refused_line: str) -> str:
    """The "Who can see it" group, with Public refused (its line as the description) and Private chosen."""
    n = next(_IDS)
    return (
        '<div><span class="p3-lbl">Who can see it</span><div class="p3-opts" role="radiogroup" aria-label="Who can see it">'
        f'<div class="p3-opt" role="radio" aria-disabled="true" aria-checked="false" aria-describedby="whyPrivate{n}">'
        '<span class="p3-dot" aria-hidden="true"></span><span class="p3-grow"><span class="p3-t">Public</span>'
        f'<span class="p3-h" id="whyPrivate{n}">{refused_line}</span></span></div>'
        '<div class="p3-opt" role="radio" aria-checked="true"><span class="p3-dot" aria-hidden="true"></span>'
        f'<span class="p3-grow"><span class="p3-t">Private</span><span class="p3-h">{M["privateHint"]}</span></span></div>'
        "</div></div>"
    )


def snack(text: str) -> str:
    """The editor's existing snackbar."""
    return f'<div class="p8-snack" role="status">{text}</div>'


def opt(key: str, chosen: bool, note: bool, extra: str = "") -> str:
    """One answer of the statement sheet; `note` adds lockNote after its hint."""
    label, hint = ANSWER[key]
    h = f"{hint} {M['lockNote']}" if note else hint
    return (
        f'<div class="p3-opt" role="radio" aria-checked="{"true" if chosen else "false"}"><span class="p3-dot" aria-hidden="true"></span>'
        f'<span class="p3-grow"><span class="p3-t">{label}</span><span class="p3-h">{h}</span></span></div>{extra}'
    )


def book_field(value: str) -> str:
    """The title field the cookbook answer reveals."""
    return f'<div><span class="p3-lbl">{M["bookLabel"]}</span><div class="p3-inp p3-on" role="textbox" aria-label="{M["bookLabel"]}">{value}</div></div>'


def sheet(size: str, body: str, answers: str, after: str, confirm: str, cancel: str) -> str:
    """The statement sheet: a bottom sheet on phones, a dialog on iPad and web 1280."""
    intro = f"<p>{body}</p>" if body else ""
    panel = (
        f'<div class="p3-hd"><h2>{M["title"]}</h2>{CLOSE}</div>{intro}'
        f'<div class="p3-opts" role="radiogroup" aria-label="{M["title"]}">{answers}</div>{after}'
        f'<p class="p3-eff">{M["effect"]}</p><div class="p3-acts"><span class="p3-btn p3-secondary">{cancel}</span>'
        f'<span class="p3-btn p3-primary">{CHECK}{confirm}</span></div>'
    )
    if size in DIALOG:
        return f'<div class="p3-stage"><div class="p3-dlg" role="dialog" aria-modal="true">{panel}</div></div>'
    return f'<div class="p3-stage p3-bottom"><div class="p3-bs" role="dialog" aria-modal="true"><div class="p3-grab"></div>{panel}</div></div>'


# The editor's Source row.


def editor_rows(size: str) -> str:
    """Every state of the Source row (D0-D4)."""
    open_web = (native(size) and M["openNative"]) or M["openWeb"]
    locked_book = row(answer(ANSWER["book"][0], BOOK), lock_line(), ask(size))
    figures = [
        fig(
            "Never published, Source empty: the link field as today, and the way to state another answer. No warning: an empty Source leaves the recipe unstated (D1)",
            plain(row(field("", M["hint"], extra=ghost(M["sayWhere"])))),
        ),
        fig(
            "Never published, a link in Source: the rights line, then the warning under the field, both named by its description (D1)",
            plain(row(field(M["url"], M["rights"], M["lockWarning"], ghost(M["sayWhere"])))),
        ),
        fig(
            "Published with no answer (a hand-typed recipe), a link typed: its first answer locks when saved, so the warning says save (D1, AE20)",
            plain(row(field(M["url"], M["rights"], M["lockWarningSave"], ghost(M["sayWhere"])))),
        ),
        fig(
            "Never published, an import stored From a cookbook or magazine: the answer, its title, the warning and the way to change it (D1, AE23)",
            plain(
                row(
                    answer(ANSWER["book"][0], BOOK),
                    f'<p class="p8-warn">{M["lockWarning"]}</p>',
                    ghost(M["changeAnswer"]),
                )
            ),
        ),
        fig(
            "Confirmed I wrote this: no locked line; the two moves it keeps, then the help link for any other answer (D3, AE12)",
            plain(row(answer(ANSWER["own"][0]), ghost(M["changeOwn"]), ask(size, other=True))),
        ),
        fig(
            "Confirmed From a web page: the site opens the page; the locked line, then the help link (D2, AE11, AE16)",
            plain(row(link(open_web), f'<span class="p8-cit">{M["url"]}</span>', lock_line(), ask(size))),
        ),
        fig("Confirmed From a cookbook or magazine, with its title (D2, AE15)", plain(locked_book)),
        fig(
            "A confirmed book with no title (an older recipe): no empty title line (D2 partial)",
            plain(row(answer(ANSWER["book"][0]), lock_line(), ask(size))),
        ),
        fig(
            "Confirmed From a paid website, or one stated on a draft (locked from the confirm, as on main)",
            plain(row(answer(ANSWER["paid"][0], PAID), lock_line(), ask(size))),
        ),
        fig(
            "From another person (locked when stated, as on main)",
            plain(row(answer(ANSWER["person"][0]), lock_line(), ask(size))),
        ),
        fig(
            "An answer this app cannot word (a newer server): the locked line and the help link only",
            plain(row(lock_line(), ask(size))),
        ),
        fig(
            "No support address configured: the same row with no help link; the locked line still reads true (D2)",
            plain(row(answer(ANSWER["book"][0], BOOK), lock_line())),
        ),
        fig(
            f"After the downgrade to a cookbook: the row is locked, Public is refused with the cookbook line. Said once, politely: “{M['announceDowngrade']}” Focus is on the answer text (D3)",
            plain(locked_book + visibility(M["policyBook"])),
        ),
        fig(
            "A save sent from a stale screen after another device confirmed: the editor drops the source change, reads the recipe again and sends the rest; the row redraws locked (D4, AE13)",
            plain(
                row(link(open_web), f'<span class="p8-cit">{M["url"]}</span>', lock_line(), ask(size))
                + snack(M["lockedRefused"])
            ),
        ),
        fig(
            "A held correction (here From another person to I wrote this): its row, and Public refused with the corrected line (AE21)",
            plain(
                row(answer(ANSWER["own"][0]), ghost(M["changeOwn"]), ask(size, other=True))
                + visibility(M["sourceCorrected"])
            ),
        ),
        fig(
            "A paste with a link into a confirmed I wrote this recipe: the link is left out and the note points to the help link (D3)",
            plain(
                row(answer(ANSWER["own"][0]), ghost(M["changeOwn"]), ask(size, other=True)) + snack(M["ownLinkLeftOut"])
            ),
        ),
        fig(
            "Loading: the row draws only once the recipe has loaded, never open first and locked after. Offline: writes wait in the outbox; a lock refusal shows when they are sent (D5)",
            "",
        ),
    ]
    return "".join(figures)


def editor_sheets(size: str) -> str:
    """The statement sheet in the editor's modes (D1, D3)."""
    c, x = M["confirm"], M["cancel"]
    figures = [
        fig(
            "Not from a web page? Say where it’s from, on a never-published draft: cookbook, paid website, person. The note shows under paid website and person, which lock when stated; a cookbook locks only at publish, and the row’s warning says so",
            sheet(
                size, "", opt("book", False, False) + opt("paid", False, True) + opt("person", False, True), "", c, x
            ),
        ),
        fig(
            "The same, From a cookbook or magazine chosen: its title field",
            sheet(
                size,
                "",
                opt("book", True, False) + opt("paid", False, True) + opt("person", False, True),
                book_field(BOOK),
                c,
                x,
            ),
        ),
        fig(
            "Change where it’s from, on a never-published draft an import stored as a cookbook: five answers, the stored one chosen; I wrote this clears the answer",
            sheet(
                size,
                "",
                opt("own", False, False)
                + opt("web", False, False)
                + opt("book", True, False)
                + opt("paid", False, True)
                + opt("person", False, True),
                book_field(BOOK),
                c,
                x,
            ),
        ),
        fig(
            "Say where it’s from on a published recipe with no answer: every answer locks when confirmed, so each shows the note (AE20)",
            sheet(size, "", opt("book", False, True) + opt("paid", False, True) + opt("person", False, True), "", c, x),
        ),
        fig(
            "Change where it’s from on a confirmed I wrote this: the downgrade, cookbook or paid website only (D3)",
            sheet(size, M["bodyDowngrade"], opt("book", True, True) + opt("paid", False, True), book_field(BOOK), c, x),
        ),
        fig(
            "The downgrade on a public recipe with every private slot in use: Confirm does not close the sheet, the error shows and nothing changes (D3, AE19)",
            sheet(
                size,
                M["bodyDowngrade"],
                opt("book", True, True) + opt("paid", False, True),
                book_field(BOOK) + f'<p class="p8-err" role="alert">{M["slotsFull"]}</p>',
                c,
                x,
            ),
        ),
    ]
    return "".join(figures)


# The recipe page.


def detail_content(size: str) -> str:
    """The Make public sheet on a private I wrote this recipe, its lock refusal, and the lines after a correction."""
    answers = opt("own", True, False) + opt("book", False, True) + opt("paid", False, True)

    def page(line: str) -> str:
        return (
            '<p class="p8-rtitle">Lemon and thyme roast chicken</p>'
            f'<p class="p8-meta">{LOCK_ICON}<span>Private</span></p><p class="p8-stand">{line}</p>'
        )

    figures = [
        fig(
            "Make public on a private, confirmed I wrote this recipe: only answers it can still take (D3)",
            sheet(size, M["body"], answers, "", M["makePublic"], M["cancel"]),
        ),
        fig(
            "The same sheet when the server refuses a change as locked (a stale screen): the sheet stays open with the error, and the answers redraw (D4)",
            sheet(
                size,
                M["body"],
                answers,
                f'<p class="p8-err" role="alert">{M["lockedRefused"]}</p>',
                M["makePublic"],
                M["cancel"],
            ),
        ),
        fig(
            "A held correction (to I wrote this or From another person, or off a paid website), seen by its owner: the standing line under the meta row, as the P6 lines (AE9, AE21). The ⋯ menu offers no Make public",
            plain(page(M["sourceCorrected"])),
        ),
        fig(
            "A correction that sets no hold (here I wrote this to From a cookbook or magazine): the ordinary line for its answer, never the corrected line (R8)",
            plain(page(M["policyBook"])),
        ),
    ]
    return "".join(figures)


# The run.


def build(canvas: str, host_name: str, size: str, content: str) -> str:
    """The host at `size` with its `.p3` container's children replaced."""
    host = board_path(canvas, f"{host_name}{size}").read_text()
    return fill(host, r'<div class="p3(?: wide)?">', content)


def redraw_p3() -> None:
    """P8's copy on the P3 boards: the new locked line with the help link, and lockNote under web, book and person."""
    for size in SIZES:
        for canvas, name in (
            (EWEB if size.startswith("Web") else EMOB, f"{EDITOR_HOST}{size}"),
            (DWEB if size.startswith("Web") else DMOB, f"{DETAIL_HOST}{size}"),
        ):
            path = board_path(canvas, name)
            s = path.read_text()
            old_lock = f"<span>{M['oldLocked']}</span></p>"
            n = s.count(old_lock)
            if canvas in (EWEB, EMOB) and n != 1:
                raise ValueError(f"{path}: expected the old locked line once, found {n}")
            s = s.replace(old_lock, f"<span>{M['locked']}</span></p>{ask(size)}")
            hint = "Stays private to you.</span>"
            if s.count(hint) == 0:
                raise ValueError(f"{path}: no sheet hint to redraw")
            s = s.replace(hint, f"Stays private to you. {M['lockNote']}</span>")
            if n:
                s = s.replace("</style>", P8_CSS + "</style>", 1)
            path.write_text(s)


def main() -> None:
    """Draw every board, lay out each canvas.json, then redraw the P3 boards."""
    hpath = Path(__file__).with_name("draw20261120P8SourceLockBoardsHeights.json")
    heights = json.loads(hpath.read_text()) if hpath.exists() else {}
    plan = [
        (EWEB, EMOB, EDITOR_HOST, "RecipeEditorSourceLock", "Recipe editor, the Source row locked", editor_rows),
        (
            EWEB,
            EMOB,
            EDITOR_HOST,
            "RecipeEditorSourceSheet",
            "Recipe editor, where it’s from: first answer, change and downgrade",
            editor_sheets,
        ),
        (
            DWEB,
            DMOB,
            DETAIL_HOST,
            "RecipeSourceLockDetail",
            "Recipe detail, a locked or corrected source",
            detail_content,
        ),
    ]
    for web, mob, host_name, family, words, content in plan:
        for canvas in (web, mob):
            made: list[tuple[str, int, int, str]] = []
            for size in [s for s in SIZES if s.startswith("Web") == (canvas == web)]:
                name = f"{family}{size}"
                width = WIDTH[size]
                h = max(heights.get(name, 0), DEVICE_FLOOR.get(size, 0))
                title = f"{words} ({SIZE_WORDS[size]})"
                html = build(canvas, host_name, size, content(size))
                board_path(canvas, name).write_text(set_meta(html, title, width, h))
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
    redraw_p3()


if __name__ == "__main__":
    main()
