# ruff: noqa: RUF001, E501  # Copy keeps the boards' typographic quotes; HTML and copy strings stay whole lines so each sentence reads as the spec writes it.
"""Draw the 004 doc fix U9 boards (plan 004fix U9, paste design spec S47-S51, §6.8, FR-068).

Each new board is built from a sibling board at the same size: the sibling gives the head (tokens, styles), the shell
(side nav or device frame) and the size; this script replaces only the content area. It also makes the in-place copy
edits (F-34, FR-068 results row), retires two board families, and adds the new boards to each canvas.json as one
appended row. Heights come from `--heights <json>` (board -> px), measured from a render; without it a first guess is
used. The committed heights are draw004fixU9Heights.json, measured by the canvas render.
Run from the repository root: python3 docs/design/canvasScripts/draw004fixU9.py [--heights file.json]
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path("docs/design/canvases")
WEB, MOB = "recipeImportingWeb", "recipeImportingMobile"
DWEB, DMOB = "recipeDetailWeb", "recipeDetailMobile"
PHOTO = "assets/5024d8f60c578f87.webp"
URL = "https://www.allrecipes.com/recipe/26317/chicken-pot-pie-ix/"
EXT = '<span aria-hidden="true"> ↗</span><span class="vh">(opens in a new tab)</span>'

# Extra rules some hosts lack. Copied from the boards that define them (ImportPasteCopiesWeb1280, PickOneIphone390).
EXTRA_CSS = """
.screen .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.screen .pi-radios { display: flex; flex-direction: column; margin-top: 16px; border-radius: 12px; background: var(--paper-raised); box-shadow: inset 0 0 0 1px var(--line-divider); }
.screen .pi-copy { display: flex; align-items: flex-start; gap: 12px; min-height: 52px; padding: 12px 16px; }
.screen .pi-copy + .pi-copy { border-top: 1px solid var(--line-divider); }
.screen .pi-copy input { width: 20px; height: 20px; margin: 2px 0 0; flex: none; accent-color: var(--ink); }
.screen .pi-copy .t { display: block; font-size: 16px; line-height: 24px; font-weight: 600; overflow-wrap: anywhere; }
.screen .pi-copy .m { display: block; font-size: 14px; line-height: 20px; color: var(--ink-muted); overflow-wrap: anywhere; }
.screen .pi-copy .nr { width: 20px; flex: none; }
.screen .pi-copy .grow { flex: 1; min-width: 0; }
.screen .u9-head { display: flex; gap: 16px; align-items: center; }
.screen .u9-thumb { width: 72px; height: 72px; flex: none; border-radius: 12px; background: url(assets/5024d8f60c578f87.webp) center / cover; }
.screen .u9-note { margin-top: 8px; font-size: 14px; line-height: 20px; color: var(--ink-muted); }
.screen .u9-lock { display: flex; gap: 8px; align-items: flex-start; margin-top: 16px; font-size: 14px; line-height: 20px; color: var(--ink-muted); }
.screen .pgRadio { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 8px 16px; font: 400 16px/24px var(--font-body); }
.screen .pgRadio + .pgRadio { border-top: 1px solid var(--line-divider); }
.screen .pgRadio .rad { width: 22px; height: 22px; flex: none; }
.screen .pgList { background: var(--paper-raised); border-radius: var(--radius-md); box-shadow: inset 0 0 0 1px var(--line-divider); margin-top: 16px; }
.screen .pgRadio .m { display: block; font: 400 14px/20px var(--font-body); color: var(--ink-muted); }
.screen .pgRadio .t { display: block; font-weight: 600; }
.screen .pgRow { padding: 12px 16px; }
.screen .pgRow + .pgRow { border-top: 1px solid var(--line-divider); }
.screen .pgRow .btn { margin-top: 8px; }
"""

# A device frame is never shorter than its screen (renderRepoCanvases measures the frame).
DEVICE_FLOOR = {"Iphone390": 844, "Android384": 832, "Ipad834": 1194, "Ipad1194": 834, "Ipad820": 1180}

WEB_SIZES = {
    "Web1280": "ImportPasteErrorsWeb1280",
    "Web768": "ImportPasteRefusedWeb768",
    "Web390": "ImportPasteCopiesWeb390",
}
MOB_SIZES = {
    "Iphone390": "ImportPasteErrorsIphone390",
    "Android384": "ImportPasteEmptyAndroid384",
    "Ipad834": "ImportPasteRefusedIpad834",
    "Ipad1194": "ImportPasteEmptyIpad1194",
}
REVIEW_HOSTS = {
    "Web1280": "ImportPasteReviewWeb1280",
    "Web768": "ImportPasteReviewWeb768",
    "Web390": "ImportPasteReviewHoldsWeb390",
    "Iphone390": "ImportPasteReviewIphone390",
    "Android384": "ImportPasteReviewAndroid384",
    "Ipad834": "ImportPasteReviewIpad834",
    "Ipad1194": "ImportPasteReviewIpad1194",
}
SIZE_WORDS = {
    "Web1280": "web, 1280",
    "Web768": "web, 768",
    "Web390": "web, 390",
    "Iphone390": "mobile, iPhone 390",
    "Android384": "mobile, Android 384",
    "Ipad834": "mobile, iPad 834",
    "Ipad1194": "mobile, iPad 1194",
    "Ipad820": "mobile, iPad 820",
}


def board_path(canvas: str, name: str) -> Path:
    """Path of a board file."""
    return ROOT / canvas / "project" / f"{name}.dc.html"


def balanced_div(s: str, start: int) -> int:
    """Index just past the </div> that closes the <div ...> opened at `start`."""
    depth = 0
    for m in re.finditer(r"<div\b|</div>", s[start:]):
        depth += 1 if m.group(0) == "<div" else -1
        if depth == 0:
            return start + m.end()
    raise ValueError("unbalanced div")


def _meta_of(s: str) -> tuple[str, str]:
    """The title and screen id a board already has."""
    title = re.search(r"<title>(.*?)</title>", s).group(1)
    screen = re.search(r'data-(?:screen|board)="([^"]*)"', s).group(1)
    return title, screen


def set_meta(s: str, title: str, screen_id: str, width: int, height: int, *, extra: bool = True) -> str:
    """Retitle and resize a board, and add the extra rules."""
    s = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", s, count=1)
    s = re.sub(r'data-screen="[^"]*"', f'data-screen="{screen_id}"', s)
    s = re.sub(r'data-board="[^"]*"', f'data-board="{screen_id}"', s)
    s = re.sub(
        r'"\$preview": \{"width": \d+, "height": \d+\}', f'"$preview": {{"width": {width}, "height": {height}}}', s
    )
    s = re.sub(r'(class="screen[^"]*"[^>]*style="width: \d+px; )height: \d+px', rf"\1height: {height}px", s, count=1)
    # A `.vp` viewport keeps the host's screen height: the device frame around it sets the board height.
    s = re.sub(
        r'(class="nv-device[^"]*" style="width: \d+px; )min-height: \d+px', rf"\1min-height: {height}px", s, count=1
    )
    return s.replace("</style>", EXTRA_CSS + "</style>", 1) if extra else s


def web_board(host: str, content: str) -> str:
    """A web board: the host board with new panels."""
    s = board_path(WEB, host).read_text()
    i = s.index('<div class="pi-panels">')
    return s[:i] + f'<div class="pi-panels">{content}</div>' + s[balanced_div(s, i) :]


def mob_board(host: str, content: str) -> str:
    """A mobile board: the host board with new sections."""
    s = board_path(MOB, host).read_text()
    s = re.sub(
        r'<main class="main".*?</main>',
        lambda _: f'<main class="main" style="min-width:0">{content}</main>',
        s,
        count=1,
        flags=re.S,
    )
    # A host may pin its own action bar after <main>; the new content carries its own.
    return re.sub(r'(</main>)\s*<div class="pgBar".*?</div>', r"\1", s, count=1, flags=re.S)


def wpanel(tag: str, inner: str) -> str:
    """One web state panel."""
    return f'<div class="pi-panel"><p class="pi-tag">{tag}</p><div class="pi-col">{inner}</div></div>'


def wbtn(label: str, kind: str = "") -> str:
    """A web button."""
    return f'<button type="button" class="pi-btn {kind}">{label}</button>'


def walert(text: str, buttons: list[str]) -> str:
    """A web alert with its actions."""
    acts = f'<div class="pi-actions">{"".join(buttons)}</div>' if buttons else ""
    return (
        f'<div class="pi-alert" role="alert"><svg class="ic " aria-hidden="true"><use href="#alert" /></svg>'
        f'<div class="grow"><p>{text}</p>{acts}</div></div>'
    )


def wpage_card(n: int) -> str:
    """The web "Web page pasted" card."""
    return (
        f'<div class="pi-entry"><div class="pi-card" role="group" aria-labelledby="u9k{n}"><div class="kindrow">'
        f'<svg class="ic " aria-hidden="true"><use href="#globe" /></svg><p class="kind" id="u9k{n}" tabindex="-1">'
        f'Web page pasted</p><button type="button" class="pi-btn ghost" aria-label="Clear the pasted page">'
        f'<svg class="ic " aria-hidden="true"><use href="#x" /></svg>Clear</button></div><p class="name">Chicken pot'
        f' pie</p><p class="site">From allrecipes.com</p><p class="url">{URL}</p><p class="pi-meta">2.4 MB</p></div>'
        f"</div>"
    )


PASTE_HEAD = (
    '<h1 class="pi-h1">Paste a recipe</h1><p class="pi-hint">Paste the recipe’s text, or the whole page. We'
    " read it here and never visit the site.</p>"
)


def web_refused() -> str:
    """S47, S48 and S49 on web."""
    s47 = wpanel(
        "S47 · Too long for the AI reader",
        PASTE_HEAD
        + wpage_card(1)
        + walert(
            "This page is too long for us to read. Copy just the recipe’s text and paste that, or write it yourself.",
            [wbtn("Write it yourself", "primary"), wbtn("Paste again")],
        ),
    )
    s48 = wpanel(
        "S48 · Page asks not to be read by AI",
        PASTE_HEAD
        + wpage_card(2)
        + walert(
            "We can’t read this page automatically. Write the recipe yourself. You can paste its ingredients and its steps"
            " into it.",
            [wbtn("Write it yourself", "primary"), wbtn("Clear")],
        ),
    )
    s49 = wpanel(
        "S49 · Only a link, before link import ships",
        PASTE_HEAD
        + (
            f'<div class="pi-entry"><textarea class="pi-input" rows="3" aria-label="Paste here" readonly>{URL}</textarea>'
            "</div>"
        )
        + walert(
            "That’s a link, and we don’t open links here. Open the page, copy the whole page, and paste it here. Or write"
            " the recipe yourself.",
            [wbtn("Write it yourself", "primary"), wbtn("Paste again")],
        ),
    )
    return s47 + s48 + s49


def web_dup_public() -> str:
    """S50 and S51 on web."""
    s50 = wpanel(
        "S50 · Already saved, public copy",
        (
            '<h1 class="pi-h1">You already have this recipe</h1><p style="margin-top:16px">You saved <a class="pi-link"'
            ' href="#" aria-label="Open Chicken pot pie">Chicken pot pie</a> from allrecipes.com on 2 November 2026.</p>'
            '<p class="u9-note">Your copy is public, so an import can’t replace it.</p><div class="pi-actions">'
            + wbtn("Import as a new copy", "primary")
            + wbtn("Cancel", "ghost")
            + "</div>"
        ),
    )
    rows = [
        ("cw0", "Chicken pot pie", "Saved 2 November 2026 · allrecipes.com", False),
        ("cw1", "Chicken pot pie", "Saved 14 October 2026 · allrecipes.com · Public", True),
        ("cw2", "Chicken pot pie, Mum’s way", "Draft · last saved 9 October 2026 · allrecipes.com", False),
    ]
    items = "".join(
        f'<div class="pi-copy"><span class="nr"></span><span class="grow"><span class="t">{t}</span><span class="m">'
        f"{m}</span></span></div>"
        if pub
        else f'<label class="pi-copy" for="{i}"><input type="radio" id="{i}" name="cw"><span><span class="t">{t}</span>'
        f'<span class="m">{m}</span></span></label>'
        for i, t, m, pub in rows
    )
    s51 = wpanel(
        "S51 · Several copies, some public",
        (
            '<h1 class="pi-h1">You already have this recipe</h1><p style="margin-top:16px">You saved this page 3 times.'
            ' To replace one, choose it first.</p><div class="pi-radios" role="radiogroup" aria-label="Your copies of'
            f' this page">{items}</div><div class="pi-actions">'
            + wbtn("Import as a new copy", "primary")
            + wbtn("Replace my copy", "danger")
            + wbtn("Cancel", "ghost")
            + "</div>"
        ),
    )
    return s50 + s51


def web_link_paste() -> str:
    """The F-31 redraw on web."""
    return wpanel(
        "F-31 · A link we may not fetch: paste the page instead",
        (
            '<h1 class="pi-h1">Paste this page to import it</h1><p class="pi-meta" style="margin-top:8px">From a link ·'
            ' cooking.nytimes.com/recipes/1023456-sheet-pan-gnocchi</p><p style="margin-top:16px">We can’t open this page'
            ' for you. Open it in your browser, copy the whole page, and paste it here.</p><p class="u9-lock"><svg'
            ' class="ic sm" aria-hidden="true"><use href="#lock" /></svg><span>Your copy stays private to you.</span></p>'
            '<div class="pi-actions">'
            + wbtn("Paste the page", "primary")
            + f'<a class="pi-btn" href="#">Open cooking.nytimes.com{EXT}</a>'
            + wbtn("Write it yourself", "ghost")
            + "</div>"
        ),
    )


LIB_ITEMS = [
    ("Chicken pot pie", "allrecipes.com", "Chicken pot pie"),
    ("Lemon drizzle cake", "bbcgoodfood.com", "Lemon drizzle"),
    ("Weeknight dal", "seriouseats.com", "Weeknight dal"),
    ("Shakshuka", "nytimes.com", "Shakshuka"),
    ("Banana bread", "kingarthurbaking.com", "Banana bread, less sugar"),
    ("Pad see ew", "hot-thai-kitchen.com", "Pad see ew"),
]
LIB_INTRO = "We skipped these 6 because a recipe you have has the same web address. Import any of them as a new copy."


def web_library(*, narrow: bool = False) -> str:
    """FR-068 on web; narrow stacks each row."""
    rows = "".join(
        f'<div class="pi-copy"><span class="grow"><span class="t">{t}</span><span class="m">{site} · You have: {mine}'
        f"</span></span>" + wbtn("Import as a new copy") + "</div>"
        for t, site, mine in LIB_ITEMS
    )
    return wpanel(
        "FR-068 · Already in your library (bulk)",
        (
            f'<h1 class="pi-h1">Already in your library</h1><p style="margin-top:16px">{LIB_INTRO}</p>'
            f'<div class="pi-radios" role="list" aria-label="Skipped, already in your library">'
            + rows.replace(
                '<div class="pi-copy">',
                '<div class="pi-copy" role="listitem"'
                + (' style="flex-direction:column;align-items:stretch">' if narrow else ">"),
            )
            + "</div>"
        ),
    )


def msec(label: str, inner: str, bar_buttons: list[str], *, top: bool = True) -> str:
    """One mobile state section."""
    back = (
        (
            '<div class="top"><span class="flex"><a aria-label="Back to Recipes" class="back" href="#"><svg'
            ' aria-hidden="true" class="ic "><use href="#chevL"></use></svg></a></span></div>'
        )
        if top
        else ""
    )
    bar = f'<div class="pgBar" role="group" aria-label="{label}">{"".join(bar_buttons)}</div>' if bar_buttons else ""
    return (
        f'<section aria-label="{label}"><p class="pgSep">{label}</p><div class="pgIn"><div class="pgCol">{back}'
        f"{inner}</div></div>{bar}</section>"
    )


def mbtn(label: str, kind: str = "secondary") -> str:
    """A mobile button."""
    return f'<button class="btn {kind} block" type="button">{label}</button>'


def malert(text: str) -> str:
    """A mobile alert."""
    return (
        f'<p class="pgAlert" role="alert"><svg aria-hidden="true" class="ic "><use href="#alert"></use></svg>'
        f"<span>{text}</span></p>"
    )


def mpage_card(n: int) -> str:
    """The mobile "Web page pasted" card."""
    return (
        f'<section aria-labelledby="u9m{n}" class="pgCard"><div class="kindRow"><svg aria-hidden="true" class="ic ">'
        f'<use href="#globe"></use></svg><p class="kind" id="u9m{n}" tabindex="-1">Web page pasted</p><button'
        f' aria-label="Clear the pasted page" class="pgClear" type="button"><svg aria-hidden="true" class="ic ">'
        f'<use href="#x"></use></svg>Clear</button></div><p class="name">Chicken pot pie</p><p class="site">From'
        f' allrecipes.com</p><p class="url">{URL}</p><p class="size">2.4 MB</p></section>'
    )


MPASTE_HEAD = (
    '<h1 class="title" style="margin-top: 4px">Paste a recipe</h1><p class="pgHint">Paste the recipe’s'
    " text. We read it here and never visit the site.</p>"
)


def mob_refused() -> str:
    """S47, S48 and S49 on mobile."""
    return (
        msec(
            "S47 Too long for the AI reader",
            MPASTE_HEAD
            + mpage_card(1)
            + malert(
                "This page is too long for us to read. Copy just the recipe’s text and paste that, or write it yourself."
            ),
            [mbtn("Paste again"), mbtn("Write it yourself", "primary")],
        )
        + msec(
            "S48 Page asks not to be read by AI",
            MPASTE_HEAD
            + mpage_card(2)
            + malert(
                "We can’t read this page automatically. Write the recipe yourself. You can paste its ingredients and its"
                " steps into it."
            ),
            [mbtn("Clear"), mbtn("Write it yourself", "primary")],
        )
        + msec(
            "S49 Only a link, before link import ships",
            MPASTE_HEAD
            + (
                f'<textarea class="pgBox url" rows="3" readonly aria-label="Paste here" style="height:96px">{URL}</textarea>'
            )
            + malert(
                "That’s a link, and we don’t open links here. Open the page, copy the recipe’s text, and paste it"
                " here. Or write the recipe yourself."
            ),
            [mbtn("Paste again"), mbtn("Write it yourself", "primary")],
        )
    )


MDUP_P = (
    '<h1 class="title" style="margin-top: 4px">You already have this recipe</h1><p class="pgHint"'
    ' style="font-size:16px; line-height:24px; color:var(--ink)">'
)


def mob_dup_public() -> str:
    """S50 and S51 on mobile."""
    rows = [
        ("Chicken pot pie", "Saved 2 November 2026 · allrecipes.com", False),
        ("Chicken pot pie", "Saved 14 October 2026 · allrecipes.com · Public", True),
        ("Chicken pot pie, Mum’s way", "Draft · last saved 9 October 2026 · allrecipes.com", False),
    ]
    items = "".join(
        f'<div class="pgRadio"><span class="rad" style="visibility:hidden"></span><span><span class="t">{t}</span>'
        f'<span class="m">{m}</span></span></div>'
        if pub
        else f'<div aria-checked="false" class="pgRadio" role="radio" tabindex="0"><span class="rad"></span><span><span'
        f' class="t">{t}</span><span class="m">{m}</span></span></div>'
        for t, m, pub in rows
    )
    return msec(
        "S50 Already saved, public copy",
        MDUP_P + 'You saved <a aria-label="Open Chicken pot pie" class="pgLink"'
        ' href="#">Chicken pot pie</a> from allrecipes.com on 2 November 2026.</p><p class="pgNote">Your copy is'
        " public, so an import can’t replace it.</p>",
        [mbtn("Cancel", "ghost"), mbtn("Import as a new copy", "primary")],
    ) + msec(
        "S51 Several copies, some public",
        MDUP_P + "You saved this page 3 times. To replace one, choose it"
        f' first.</p><div aria-label="Your copies of this page" class="pgList" role="radiogroup">{items}</div>',
        [mbtn("Cancel", "ghost"), mbtn("Replace my copy", "destructive"), mbtn("Import as a new copy", "primary")],
    )


def mob_link_paste() -> str:
    """The F-31 redraw on mobile."""
    return msec(
        "F-31 A link we may not fetch: paste the page instead",
        (
            '<h1 class="title" style="margin-top: 4px">Paste this page to import it</h1><p class="pgMeta">From a link ·'
            ' cooking.nytimes.com/recipes/1023456-sheet-pan-gnocchi</p><p class="pgHint" style="font-size:16px;'
            ' line-height:24px; color:var(--ink)">We can’t open this page for you. Open it in your browser, copy the'
            ' recipe’s text, and paste it here.</p><p class="pgPriv"><svg aria-hidden="true" class="ic "><use'
            ' href="#lock"></use></svg><span>Your copy stays private to you.</span></p>'
        ),
        [
            mbtn("Write it yourself", "ghost"),
            f'<a class="btn secondary block" href="#">Open cooking.nytimes.com{EXT}</a>',
            mbtn("Paste the page", "primary"),
        ],
    )


def mob_library() -> str:
    """FR-068 on mobile."""
    rows = "".join(
        f'<div class="pgRow" role="listitem"><span class="t" style="display:block;font-weight:600">{t}</span><span'
        f' class="pgNote" style="display:block;margin:0">{site} · You have: {mine}</span>'
        + mbtn("Import as a new copy")
        + "</div>"
        for t, site, mine in LIB_ITEMS
    )
    return msec(
        "FR-068 Already in your library (bulk)",
        (
            f'<h1 class="title" style="margin-top: 4px">Already in your library</h1><p class="pgHint" style="font-size:16px;'
            f' line-height:24px; color:var(--ink)">{LIB_INTRO}</p><div aria-label="Skipped, already in your library"'
            f' class="pgList" role="list">{rows}</div>'
        ),
        [],
    )


def review_photo(canvas: str, host: str) -> str:
    """P5 with the source-photo preview, from the review board at that size."""
    s = board_path(canvas, host).read_text()
    alt = "Chicken pot pie, photo from allrecipes.com"
    if canvas == WEB:
        i = s.index('<div class="pi-panels">')
        end = balanced_div(s, i)
        panels = s[i:end]
        first = panels[len('<div class="pi-panels">') : balanced_div(panels, len('<div class="pi-panels">'))]
        first = re.sub(r'<p class="pi-tag">[^<]*</p>', '<p class="pi-tag">P5 · Source photo preview (§6.8)</p>', first)
        first = re.sub(
            r'<h1 class="pi-h1">Chicken pot pie</h1>(<p class="pi-meta"[^>]*>[^<]*</p>)',
            rf'<div class="u9-head"><div class="u9-thumb" role="img" aria-label="{alt}"></div><div><h1'
            rf' class="pi-h1">Chicken pot pie</h1>\1</div></div>',
            first,
            count=1,
        )
        s = s[:i] + f'<div class="pi-panels">{first}</div>' + s[end:]
    else:
        m = re.search(r'<main class="main".*?</main>', s, flags=re.S)
        main = m.group(0)
        secs = re.findall(
            r'<section aria-label="[^"]*">.*?(?=<section aria-label="[^"]*"><p class="pgSep">|</main>)',
            main,
            flags=re.S,
        )
        first = secs[0] if secs else main[main.index(">") + 1 : -len("</main>")]
        first = re.sub(r'(<p class="pgSep">)[^<]*', r"\1P5 Source photo preview (§6.8)", first, count=1)
        first = re.sub(r'aria-label="S[^"]*"', 'aria-label="P5 Source photo preview"', first, count=1)
        first = re.sub(
            r'(<h1 class="title"[^>]*>Chicken pot pie</h1>)(<p class="pgMeta">[^<]*</p>)',
            rf'<div class="u9-head" style="margin-top:4px"><div class="u9-thumb" role="img"'
            rf' aria-label="{alt}" style="width:64px;height:64px"></div><div>\1\2</div></div>',
            first,
            count=1,
        )
        s = s[: m.start()] + f'<main class="main" style="min-width:0">{first}</main>' + s[m.end() :]
    return s.replace(
        "The words belong to their author. Private to you.",
        "The words and photo belong to their author. Private to you.",
    )


HERO_BTNS = (
    '<a aria-label="Back to My recipes" class="btnC back" href="#"><span><svg aria-hidden="true" class="ic">'
    '<use href="#chevL"></use></svg></span></a><a aria-label="More actions" class="btnC more" href="#"><span>'
    '<svg aria-hidden="true" class="ic"><use href="#dots"></use></svg></span></a>'
)
CREDIT_OLD = "Saved from allrecipes.com. The words belong to their author. Private to you."
CREDIT_PHOTO = "Saved from allrecipes.com. The words and photo belong to their author. Private to you."
PHOTO_CREDIT = (
    f'<p class="t13 soft" style="margin:8px 0 0">Photo from <a class="metaLink" href="#">allrecipes.com{EXT}</a></p>'
)
LINK_ROW = f'<p><a class="metaLink" href="#">See the photo on allrecipes.com{EXT}</a></p>'
NOTE_STYLE = (
    "margin:8px 0 0;padding:8px 12px;border:1px dashed var(--line-control);border-radius:12px;"
    "font:400 14px/20px var(--font-body);color:var(--ink-muted)"
)
NOTES = {
    "Saved": "Design note: state 1, saved. State 3, shown from the source and not saved, looks the same; offline it"
    " falls back to the link-only state.",
    "Loading": "Design note: state 2, loading. The slot keeps its size, so nothing shifts. A failed load (state 5)"
    " falls to state 3, then state 4, with no error.",
    "LinkOnly": "Design note: state 4, link only. No image area. The row opens the source page in the browser.",
}


def detail_photo(canvas: str, host: str, state: str) -> str:
    """R-D5 photo states on a private import. Wide boards have a hero in the top columns; phone boards get one."""
    s = board_path(canvas, host).read_text()
    s = re.sub(r'<div class="menu" role="menu".*?</div>', "", s, count=1, flags=re.S)
    s = s.replace('<div aria-hidden="true" class="scrim"></div>', "").replace(
        '<div class="scrim" aria-hidden="true"></div>', ""
    )
    m = re.search(
        r'<div (?:aria-modal="true" class="bsheet" role="dialog"|class="bsheet" role="dialog" aria-modal="true")', s
    )
    if m:
        s = s[: m.start()] + s[balanced_div(s, m.start()) :]
    note = f'<p style="{NOTE_STYLE}">{NOTES[state]}</p>'
    alt = "Chicken pot pie, photo from allrecipes.com"
    wide = re.search(r'<div [^>]*class="photo p imgHero"[^>]*>', s)
    if wide:
        start, end = wide.start(), balanced_div(s, wide.start())
        if state == "Saved":
            hero = re.sub(r'aria-label="Photo 1 of 3: [^"]*"', f'aria-label="{alt}"', s[start:end])
            hero = re.sub(r'<a class="edge (prev|next)Img".*?</a\s*>|<div class="dots".*?</div>', "", hero, flags=re.S)
            s = s[:start] + hero + PHOTO_CREDIT + note + s[end:]
        elif state == "Loading":
            s = (
                s[:start] + '<div class="photo p" role="img" aria-label="Loading the photo" aria-busy="true"'
                ' style="background:var(--surface-muted)"></div>' + note + s[end:]
            )
        else:
            s = s[:start] + note + s[end:]
    else:
        anchor = '<div class="sheet" style="margin-top: 0">'
        if state == "Saved":
            hero = f'<div aria-label="{alt}" class="hero p imgHero" role="img">{HERO_BTNS}</div>'
        elif state == "Loading":
            hero = (
                f'<div aria-label="Loading the photo" aria-busy="true" class="hero p" role="img"'
                f' style="background:var(--surface-muted)">{HERO_BTNS}</div>'
            )
        else:
            hero = f'<div class="hero" style="height:96px">{HERO_BTNS}</div>'
        if anchor not in s:
            raise ValueError(f"no sheet anchor in {host}")
        # Link only has no image, so the sheet keeps its flat top under a short bar.
        s = s.replace(anchor, hero + (anchor if state == "LinkOnly" else '<div class="sheet">'), 1)
        # The sheet rises over the hero, so the phone note sits in the sheet, under the rights line.
        # The sheet also covers the image's lower edge, so the photo credit leads the credit block.
        credit = PHOTO_CREDIT.replace("margin:8px 0 0", "margin:0") if state == "Saved" else ""
        s = re.sub(
            r'<div class="credit">(.*?)</div>',
            lambda m: f'<div class="credit">{credit}{m.group(1)}</div>' + note,
            s,
            count=1,
            flags=re.S,
        )
    if state == "LinkOnly":
        s = s.replace(f"<p>{CREDIT_OLD}</p>", f"<p>{CREDIT_OLD}</p>{LINK_ROW}", 1)
    elif state == "Saved":
        s = s.replace(CREDIT_OLD, CREDIT_PHOTO, 1)
    return s


def main() -> None:
    """Draw every board, edit copy in place, retire boards, and lay out canvas.json."""
    heights_file = Path(__file__).with_name("draw004fixU9Heights.json")
    if "--heights" in sys.argv:
        heights_file = Path(sys.argv[sys.argv.index("--heights") + 1])
    heights = json.loads(heights_file.read_text())
    made = {WEB: [], MOB: [], DWEB: [], DMOB: []}

    def emit(canvas: str, name: str, html: str, width: int, title: str, guess: int) -> None:
        h = max(
            heights.get(name, guess), DEVICE_FLOOR.get(re.sub(r"^.*?((?:Iphone|Android|Ipad)\d+)$", r"\1", name), 0)
        )
        board_path(canvas, name).write_text(set_meta(html, title, name, width, h))
        made[canvas].append((name, width, h, title))

    subjects = [
        ("ImportPasteReadRefused", "paste refused, AI reader (S47 to S49)", web_refused, mob_refused),
        ("ImportPasteDuplicatePublic", "paste duplicate, public copy (S50, S51)", web_dup_public, mob_dup_public),
        ("ImportLinkPasteInstead", "link, paste the page instead", web_link_paste, mob_link_paste),
        ("ImportLibraryAlreadyInLibrary", "library, already in your library", web_library, mob_library),
    ]
    widths = {
        "Web1280": 1280,
        "Web768": 768,
        "Web390": 390,
        "Iphone390": 390,
        "Android384": 384,
        "Ipad834": 834,
        "Ipad1194": 1194,
        "Ipad820": 820,
    }
    for base, words, wfn, mfn in subjects:
        for size, host in WEB_SIZES.items():
            content = wfn(narrow=True) if wfn is web_library and size == "Web390" else wfn()
            emit(
                WEB,
                base + size,
                web_board(host, content),
                widths[size],
                f"Recipe importing, {words} ({SIZE_WORDS[size]})",
                1000,
            )
        for size, host in MOB_SIZES.items():
            emit(
                MOB,
                base + size,
                mob_board(host, mfn()),
                widths[size],
                f"Recipe importing, {words} ({SIZE_WORDS[size]})",
                1000,
            )
    for size, host in REVIEW_HOSTS.items():
        canvas = WEB if size.startswith("Web") else MOB
        emit(
            canvas,
            "ImportPasteReviewPhoto" + size,
            review_photo(canvas, host),
            widths[size],
            f"Recipe importing, paste review with the source photo (P5, {SIZE_WORDS[size]})",
            1400,
        )
    for size in ["Web1280", "Web390", "Iphone390", "Android384", "Ipad820"]:
        canvas = DWEB if size.startswith("Web") else DMOB
        for state, words in [
            ("Saved", "saved (states 1 and 3)"),
            ("Loading", "loading (state 2)"),
            ("LinkOnly", "link only (state 4)"),
        ]:
            host = f"RecipePrivateImportMenu{size}"
            host_h = json.loads((ROOT / canvas / "project/canvas.json").read_text())["boards"][f"{host}.dc.html"]["h"]
            emit(
                canvas,
                f"RecipePrivateImportPhoto{state}{size}",
                detail_photo(canvas, host, state),
                widths[size],
                f"Recipe detail, private import, photo {words} ({SIZE_WORDS[size]})",
                host_h,
            )

    # In-place copy edits and retirements.
    for canvas in (WEB, MOB):
        for f in (ROOT / canvas / "project").glob("*.dc.html"):
            s = f.read_text()
            t = s.replace(
                "Nothing is saved until you save it. The draft stays for 7 days.",
                "Nothing is saved until you save it. If you leave, it waits under To review.",
            )
            if f.name.startswith("ImportLibraryResults"):
                t = t.replace('<p class="k">Already here</p>', '<p class="k">Already in your library</p>').replace(
                    "Matched to recipes you have.", "Skipped: a recipe you have has the same web address."
                )
            if t != s:
                f.write_text(t)
    retired = [
        n
        for c in (WEB, MOB)
        for n in json.loads((ROOT / c / "project/canvas.json").read_text())["boards"]
        if n.startswith(("ImportPasteSlotsFull", "ImportPaidSiteBlocked"))
    ]
    for canvas in made:
        cj = ROOT / canvas / "project" / "canvas.json"
        d = json.loads(cj.read_text())
        for n in retired:
            if n in d["boards"]:
                del d["boards"][n]
                (ROOT / canvas / "project" / n).unlink()
                if n in d.get("order", []):
                    d["order"].remove(n)
        for key, board in d["boards"].items():
            # An existing board whose in-place copy edit made it taller (the FR-068 results row wraps on phones).
            if key[: -len(".dc.html")] in heights and not any(key == f"{m[0]}.dc.html" for m in made[canvas]):
                board["h"] = heights[key[: -len(".dc.html")]]
                f = ROOT / canvas / "project" / key
                f.write_text(set_meta(f.read_text(), *_meta_of(f.read_text()), board["w"], board["h"], extra=False))
        mine = {f"{m[0]}.dc.html" for m in made[canvas]}
        for key in mine & set(d["boards"]):
            del d["boards"][key]
        y = max(b["y"] + b["h"] for b in d["boards"].values()) + 400
        x = 0
        for name, w, h, title in made[canvas]:
            key = f"{name}.dc.html"
            d["boards"][key] = {"x": x, "y": y, "w": w, "h": h, "title": title}
            if isinstance(d.get("order"), list) and key not in d["order"]:
                d["order"].append(key)
            x += w + 80
        cj.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({c: [m[0] for m in v] for c, v in made.items()}, indent=1))


if __name__ == "__main__":
    main()
