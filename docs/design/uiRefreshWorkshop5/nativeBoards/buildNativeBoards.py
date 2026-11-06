"""Build the native boards for one page from the assembled redesign canvas.

Run from the repo root, after `assembleRedesign.py <redesignOut> <legacyCanvasProject>`:

    python3 docs/design/uiRefreshWorkshop5/nativeBoards/buildNativeBoards.py <redesignProject> <outDir> <page>

For every state of the page (each `<State>Mobile` board in the page's sections), it writes one board per device in
`devices.json`: `<State><Platform><Width>.dc.html` (`boardNames.py`). The phone boards start from the `…Mobile` board,
which carries the owner's mobile decisions. The tablet board starts from the `…834Mobile` board where one exists, and
otherwise from the phone board with the page's tablet rules in `nativeLayouts.json`. Each body goes through
`toNative.py`, then into the device frame (`shell.py`), and every board must pass `checkNative.py`, or the build stops.

It writes `<outDir>/boards/*.dc.html`, `<outDir>/ds/commise/native.css`, `<outDir>/ds/commise/redesignNative.css`,
`<outDir>/manifest.json` (board, size, title, device, source) and `<outDir>/report.json` (what was not converted).
Board heights come from `heights.json` beside this file when it names the board, and otherwise from the device height;
measure them with the audit renderer and record them there.
"""

import copy
import json
import re
import shutil
import sys
from pathlib import Path

from bs4 import BeautifulSoup

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "redesignCanvas"))

from boardNames import BoardName  # noqa: E402
from checkNative import check_native  # noqa: E402
from nativeTokens import side_spacing, write as write_native_css  # noqa: E402
from shell import frame  # noqa: E402
from splitScreens import FEATURE_SLUGS, FEATURES, PAGES, section_of, section_rows  # noqa: E402
from toNative import convert_body, convert_css  # noqa: E402

DEVICES = json.loads((HERE / "devices.json").read_text())["devices"]
LAYOUTS = json.loads((HERE / "nativeLayouts.json").read_text())
CHROME = json.loads((HERE / "chrome.json").read_text())
HEIGHTS_FILE = HERE / "heights.json"
HELMET = re.compile(r"<helmet\s*>(.*?)</helmet\s*>", re.S)
TAB_LABELS = {tab["id"]: tab["label"] for tab in CHROME["tabs"]}
SCRIMS = ["scrim", "scrimAll"]
FEATURE_PREFIXES = {FEATURE_SLUGS[f["id"]]: f["prefix"] for f in FEATURES}
# A tablet state with no tablet board of its own and no base to lay a sheet over keeps the phone layout in one centred
# column, at `contentWidth.reading` (`@commise/ui` tokens/layout.ts), never stretched across the iPad.
CONTENT_COLUMN = 640
# The room a list leaves under a floating button: the button (56), its margin (16), and 16 more (designer ruling).
FAB_END_ROOM = 88
# A mockup screen drawn taller than the device it was drawn for (844 phone, 1194 tablet) is a scrolling page.
SCREEN_TALL = 1194
PHONE_DRAWN_HEIGHT = 844
APPLE_BUTTON = (
    '<div role="button" aria-label="Continue with Apple" class="nv-apple"><svg width="18" height="20" viewBox="0 0 17 20"'
    ' aria-hidden="true"><path fill="currentColor" d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9'
    '.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2'
    ' .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.7-1-2.7-4.1zM11.6 3c.7-.9 1.2-2 1-3.1-1 0-2.2.7-2.9'
    ' 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z"/></svg><span>Continue with Apple</span></div>'
)
PHONE = re.compile(r"^(?P<state>[A-Z][A-Za-z]*?)Mobile\.dc\.html$")


def page_states(project: Path, page: str) -> list[str]:
    """The states of a page, in canvas order: each `<State>Mobile` board in the page's sections. A feature (`feature…`
    slug) takes every phone board with its prefix from the feature canvas."""
    canvas = json.loads((project / "canvas.json").read_text())
    if page in FEATURE_PREFIXES:
        prefix = FEATURE_PREFIXES[page]
        states = [m["state"] for b in canvas["order"] if (m := PHONE.match(b)) and b.startswith(prefix)]
        if not states:
            sys.exit(f"{page}: no phone boards with prefix {prefix}")
        return states
    rows = section_rows(canvas)
    sections = set(PAGES[page][1])
    states = []
    for board in canvas["order"]:
        match = PHONE.match(board)
        if match and section_of(rows, canvas["boards"][board]["y"]) in sections:
            states.append(match["state"])
    if not states:
        sys.exit(f"{page}: no phone boards found in sections {sorted(sections)}")
    return states


def split_board(html: str) -> tuple[str, str, str]:
    """(board CSS, the markup between the styles and the body root, the body). Works for all three board formats:
    the redesign's static `.rd` boards, the mockup `.screen` boards (cooking mode) and the legacy boards drawn from the
    design bundle's components."""
    helmet = HELMET.search(html)
    if not helmet:
        sys.exit("A board has no <helmet> block")
    css = "\n".join(re.findall(r"<style>(.*?)</style>", helmet.group(1), re.S))
    links = "".join(l for l in re.findall(r"<link\b[^>]*>", helmet.group(1)) if "redesign.css" not in l)
    end = html.rindex("</x-dc")
    body = html[helmet.end() : end].rstrip()
    first_div = body.find("<div")
    rd = body.find('<div class="rd"')
    if rd >= 0 and rd == first_div:
        return css, links + body[:rd], body[rd:]
    # A mockup screen (cooking mode) is a `.screen` element with a size class (`phone`, `tab834`, `tab1194`); a legacy
    # board may use a `.screen` class for something else.
    screen = re.search(r'<div\s+class="screen(?: [^"]*)?"[^>]*>', body)
    if screen and not re.search(r'data-screen=|class="screen (?:phone|tab834|tab1194)\b', screen.group(0)):
        screen = None
    if screen:
        return css, links + body[: screen.start()], body[screen.start() :]
    return css, links, body


SCRIPT = re.compile(r"<script type=\"text/x-dc\" data-dc-script[^>]*>(.*?)</script>", re.S)
EMPTY_LOGIC = "class Component extends DCLogic { renderVals(){ return {}; } }"


def board_script(html: str) -> str:
    """The board's own logic: a legacy board's components read their props from it (`{{p31}}` and so on)."""
    match = SCRIPT.search(html)
    return match.group(1).strip() if match else EMPTY_LOGIC


def board_format(body: str) -> str:
    if body.startswith('<div class="rd"'):
        return "rd"
    return "screen" if re.match(r'<div\s+class="screen', body) else "legacy"


def _section(main, title: str) -> list:
    head = next((h for h in main.find_all("div", class_="secHead", recursive=False) if h.find("h2", string=title)), None)
    if head is None:
        sys.exit(f"tablet rule: no section titled {title!r}")
    block = head.find_next_sibling()
    return [head, block]


def apply_tablet_ops(soup: BeautifulSoup, ops: list, project: Path) -> None:
    for op in ops:
        if op["op"] == "pair":
            main = soup.find("div", class_="rd").find("div", recursive=False)
            first, second = _section(main, op["first"]), _section(main, op["second"])
            duo = soup.new_tag("div", attrs={"class": "duo", "style": "grid-template-columns: 1fr 1fr"})
            first[0].insert_before(duo)
            for part in (first, second):
                cell = soup.new_tag("div")
                for tag in part:
                    cell.append(tag.extract())
                duo.append(cell)
        elif op["op"] == "columns":
            for tag in soup.select(op["select"]):
                tag["style"] = re.sub(r"grid-template-columns:[^;]*", "", tag.get("style", "")).strip("; ")
                tag["style"] = f"grid-template-columns: repeat({op['n']}, 1fr); " + tag["style"]
        elif op["op"] == "fillTo":
            for tag in soup.select(op["select"]):
                kids = tag.find_all(recursive=False)
                for _ in range(len(kids), op["n"]):
                    tag.append(copy.copy(kids[-1]))
        elif op["op"] == "insertHtml":
            # A control the iPad board draws that the phone board has no copy of (e.g. a component the phone floats).
            where = "after" if "after" in op else "before"
            target = soup.select_one(op[where])
            if target is None:
                sys.exit(f"tablet rule insertHtml: {op[where]} is missing")
            markup = BeautifulSoup(op["html"], "html.parser")
            target.insert_after(markup) if where == "after" else target.insert_before(markup)
        elif op["op"] == "wrapEach":
            # A component in a grid lays out as its own box only inside a plain one (the tablet board wraps each).
            for tag in soup.select(op["select"]):
                tag.wrap(soup.new_tag("div", attrs={"style": op["style"]}))
        elif op["op"] == "attr":
            # A component prop the iPad board sets differently (e.g. the grid card variant).
            for tag in soup.select(op["select"]):
                tag[op["name"]] = op["value"]
        elif op["op"] == "group":
            # Wrap siblings in one new element where the first stood, as the tablet board groups them.
            # `within` repeats the grouping inside every matching container (a board of several examples).
            scopes = soup.select(op["within"]) if "within" in op else [soup]
            if not scopes:
                sys.exit(f"tablet rule group: no {op['within']}")
            for scope in scopes:
                parts = [scope.select_one(sel) for sel in op["select"]]
                if any(p is None for p in parts):
                    sys.exit(f"tablet rule group: one of {op['select']} is missing")
                wrapper = soup.new_tag("div", attrs={"class": op["class"]})
                parts[0].insert_before(wrapper)
                for part in parts:
                    wrapper.append(part.extract())
        elif op["op"] == "remove":
            for tag in soup.select(op["select"]):
                tag.decompose()
        elif op["op"] == "insertFrom":
            # The tablet board's own control, appended where the iPad draws it (e.g. a button into the search row).
            _, _, body = split_board((project / f"{op['board']}.dc.html").read_text())
            source = BeautifulSoup(body, "html.parser").select_one(op["select"])
            targets = soup.select(op["into"])
            if source is None or not targets:
                sys.exit(f"tablet rule insertFrom: {op['select']} missing in {op['board']} or {op['into']} on the phone board")
            for target in targets:
                target.append(copy.copy(source))
        elif op["op"] == "copyFrom":
            _, _, body = split_board((project / f"{op['board']}.dc.html").read_text())
            source = BeautifulSoup(body, "html.parser").select_one(op["select"])
            # `target` names a different phone element to replace (e.g. a list of rows by the tablet's grid).
            target = soup.select_one(op.get("target", op["select"]))
            if source is None or target is None:
                sys.exit(f"tablet rule copyFrom: {op['select']} missing in {op['board']} or the phone board")
            target.replace_with(copy.copy(source))
        else:
            sys.exit(f"unknown tablet op {op['op']}")


def missing_rules(css: str, reference: str) -> str:
    """The rules of the page's tablet board whose selectors the phone board lacks (e.g. the tablet tile's meta rows)."""
    have = {selector.strip() for selector, _ in re.findall(r"([^{}]+)\{([^{}]*)\}", css)}
    return "\n".join(
        f"{selector.strip()} {{{body}}}"
        for selector, body in re.findall(r"([^{}@]+)\{([^{}]*)\}", reference)
        if selector.strip() not in have
    )


def class_gaps(css: str) -> dict[str, int]:
    gaps = {}
    for selector, body in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        gap = re.search(r"(?<![-\w])gap:\s*(?:\d+px\s+)?(\d+)px", body)
        last = re.search(r"\.([\w-]+)\s*$", selector.strip())
        if gap and last:
            gaps[last.group(1)] = int(gap.group(1))
    return gaps


def _layout_for(page: str) -> dict:
    return LAYOUTS.get(page, {})


def _tablet_base(page: str, state: str) -> str | None:
    """The page's tablet board a modal state's overlay is laid over: the longest matching prefix in `tabletBase`."""
    bases = _layout_for(page).get("tabletBase", {})
    match = max((p for p in bases if state.startswith(p)), key=len, default=None)
    return bases[match] if match else None


def devices_for(page: str, state: str) -> list[str]:
    """The devices a state gets boards for: every one, except the tablet for a `phoneOnly` state (with its reason)."""
    phone_only = _layout_for(page).get("phoneOnly", {})
    if state not in phone_only:
        return list(DEVICES)
    if not phone_only[state].strip():
        sys.exit(f"{page}: phoneOnly {state} needs its reason")
    return [key for key, device in DEVICES.items() if device["kind"] != "tablet"]


def _tablet_ops(page: str, state: str, key: str = "tablet") -> list | None:
    """The page's tablet ops for a state: the longest matching state prefix in `key`, else its `*` entry."""
    rules = _layout_for(page).get(key, {})
    match = max((p for p in rules if p != "*" and state.startswith(p)), key=len, default=None)
    return rules[match] if match else rules.get("*")


def _tablet_css(page: str, state: str) -> str | None:
    """The page's hand-designed iPad CSS for a state: the longest matching prefix in `tabletCss`, or None."""
    rules = _layout_for(page).get("tabletCss", {})
    match = max((p for p in rules if state.startswith(p)), key=len, default=None)
    return rules[match] if match else None


def _overlay(soup: BeautifulSoup) -> list:
    """The modal layer of a phone board: its scrim and every element after it at the same level."""
    scrim = soup.find(class_=SCRIMS)
    if scrim is None:
        return []
    return [scrim] + [s for s in scrim.find_next_siblings() if s.name]


def _strip_tab_bars(soup: BeautifulSoup) -> str | None:
    active = None
    for nav in soup.find_all("nav", class_="tabbar"):
        on = nav.find(class_="on")
        active = active or (on.get_text(strip=True) if on else None)
        nav.decompose()
    for imp in soup.find_all("x-import", attrs={"component-from-global-scope": "Commise.Native.HomeTabBar"}):
        active = active or TAB_LABELS.get(imp.get("active-id", ""), "Home")
        imp.decompose()
    return active


def _fit_width(text: str) -> str:
    """Legacy boards and `redesign.css` hard-code the drawn device width (390, 834 or 1194) and height; the frame sets
    the size, so the content fills it."""
    text = re.sub(r"(?<![-\w])width:\s*(?:390|834|1194)px", "width: 100%", text)
    return re.sub(r"min-height:\s*(?:844|1194|834)px", "min-height: 100%", text)


def _fix_sheet(sheet, css: str, device: dict, typing: bool) -> None:
    sheet_pad = re.search(r"\.sheet \{[^}]*padding: [^;]*?(\d+)px;", css)
    # A `bsheet` bakes the old 34 px home-indicator gap into its padding, so it starts from the plain 24.
    base = int(sheet_pad.group(1)) if sheet_pad and "bsheet" not in sheet.get("class", []) else 24
    bottom = base if typing else base + device["insets"]["bottom"]
    side = side_spacing(device, "sheet")
    style = sheet.get("style", "").strip("; ")
    sheet["style"] = f"{style}; padding-bottom: {bottom}px; padding-left: {side}px; padding-right: {side}px".strip("; ")
    rule = CHROME["sheet"]
    if device["width"] >= rule["wideFrom"]:
        sheet["style"] += f"; max-width: {rule['maxWidth']}px; margin-left: auto; margin-right: auto"


def native_board(project: Path, page: str, state: str, key: str, device: dict, report: list, typing=None) -> dict:
    """One native board: its css, the markup inside the device frame, its name and how its tablet layout was made."""
    layout = _layout_for(page)
    tablet = device["kind"] == "tablet"
    suffix = layout.get("tabletSource", {}).get("suffix", "834Mobile")
    # `tabletBoard` names another board as a state's iPad source (e.g. the iPad recipe board with nutrition open).
    tablet_name = layout.get("tabletBoard", {}).get(state) or f"{state}{suffix}"
    tablet_source = project / f"{tablet_name}.dc.html"
    source = tablet_source if tablet and tablet_source.exists() else project / f"{state}Mobile.dc.html"
    source_html = source.read_text()
    css, defs, body = split_board(source_html)
    script = board_script(source_html)
    strategy = "phone board"
    overlay = []
    if tablet:
        strategy = "own tablet board" if tablet_source.exists() else "centred column"
    if tablet and not tablet_source.exists():
        layer = _overlay(BeautifulSoup(body, "html.parser"))
        base = _tablet_base(page, state)
        if layer and base:
            strategy = f"overlay on {base}"
            overlay = [str(e) for e in layer]
            phone_css = css
            base_html = (project / f"{base}.dc.html").read_text()
            css, defs, body = split_board(base_html)
            script = board_script(base_html)
            css += "\n" + phone_css
        elif board_format(body) in ("rd", "legacy") and _tablet_ops(page, state) is not None:
            strategy = "tablet rules"
    # A keyboard-up board is looked up by its own name, so the page can lay it out apart from its state.
    tablet_css = _tablet_css(page, typing["name"] if typing else state) if tablet else None
    if tablet_css is not None and strategy == "centred column":
        # The page designs this state for the iPad itself, so it leaves the holding column.
        strategy = "tablet css"
    fmt = board_format(body)
    page_css = "\n".join(v for k, v in layout.get("css", {}).items() if k == "*" or state.startswith(k))
    if page_css:
        css += "\n" + page_css
    if tablet_css is not None:
        css += "\n" + tablet_css
    style_from = layout.get("tabletSource", {}).get("styleFrom")
    if strategy == "tablet rules" and style_from:
        # One tablet board or several; an earlier board's rule wins over a later one's for the same selector.
        for board in [style_from] if isinstance(style_from, str) else style_from:
            css += "\n" + missing_rules(css, split_board((project / f"{board}.dc.html").read_text())[0])
    css, body = _fit_width(css), _fit_width(body)
    gaps = class_gaps(css)
    css, grids = convert_css(css, device["os"], report)
    soup = BeautifulSoup(body, "html.parser")
    root = soup.find("div", class_="rd") if fmt == "rd" else None
    if overlay:
        host = root if root is not None else soup
        for markup in overlay:
            host.append(BeautifulSoup(markup, "html.parser"))
    if strategy == "tablet rules":
        apply_tablet_ops(soup, _tablet_ops(page, state), project)
    elif strategy == "own tablet board" or strategy.startswith("overlay on"):
        # Corrections to the page's own iPad boards (e.g. a column count), kept apart from the holding states' ops.
        apply_tablet_ops(soup, _tablet_ops(page, state, "tabletOwn") or [], project)
    for op in layout.get("ops", []):
        if state in op["states"] and device["os"] in op.get("os", ["ios", "android"]):
            apply_page_op(soup, op)
    convert_body(soup, grids, gaps)
    present_dialogs(soup, device)
    active = _strip_tab_bars(soup)
    modal = soup.find(class_=SCRIMS) is not None
    name = BoardName(typing["name"] if typing else state, re.sub(r"\d+$", "", key), device["width"])
    side = side_spacing(device, "screen")
    top = device["insets"]["top"]
    column = strategy == "centred column"
    tall_screen = False
    if fmt == "rd":
        root["data-board"] = name.stem
        root["style"] = f"width: {device['width']}px"
        main = root.find("div", recursive=False)
        if "frame" in main.get("class", []):
            # A drawn phone frame (library, Discover): its own bars and padding stay; the native frame only drops its
            # rounded corners and moves it below the status bar.
            main["style"] = f"border-radius: 0; padding-top: {top}px; min-height: 100%; flex: 1"
            if column:
                for page_body in main.select(".pg"):
                    page_body["style"] = (page_body.get("style", "") + f"; width: 100%; max-width: {CONTENT_COLUMN}px; margin: 0 auto").strip("; ")
        else:
            main["style"] = re.sub(r"padding:[^;]*;?", "", main.get("style", "")).strip("; ")
            # A redesign phone page that draws its own padding (`.pg` with the iPhone's 60 px status gap) pads once,
            # here; and a floating button drawn above the page's own tab bar sits 16 above the page's end, since the
            # frame pins its bar outside the page. The page then ends with 88 of room under it (56 + 16 + 16).
            page_body = main.find("div", class_="pg", recursive=False)
            if page_body is not None and re.match(r"\s*padding:\s*60px\b", page_body.get("style", "")):
                page_body["style"] = re.sub(r"padding:[^;]*;?", "", page_body["style"]).strip("; ")
            fabs = root.select(".fab.abs")
            for fab in fabs:
                fab["style"] = re.sub(r"bottom:\s*\d+px", "bottom: 16px", fab.get("style", ""))
            end = FAB_END_ROOM if fabs else 24
            main["style"] = f"padding: {top + 16}px {side}px {end}px; " + main["style"]
            if column:
                main["style"] += f"; width: 100%; max-width: {CONTENT_COLUMN}px; margin: 0 auto"
        if modal:
            # Every bottom sheet the board lays over the screen: on the root, or inside a drawn phone frame's shell.
            for sheet in root.select(":scope > .sheet, :scope > .bsheet, .shell > .sheet, .shell > .bsheet"):
                _fix_sheet(sheet, css, device, typing is not None)
        inner = str(soup)
    elif fmt == "screen":
        # The editor's mockup header bakes in the iPhone's 47 pt status bar gap (and a 47 + 56 minimum height); that
        # gap becomes this device's own inset instead of a second one.
        header = re.search(r"\.ehead \{[^}]*\}", css)
        baked_header = header is not None and "47px" in header.group(0)
        if baked_header:
            rule = header.group(0).replace("47px", f"{top}px", 1).replace("min-height: 103px", f"min-height: {top + 56}px")
            css = css[: header.start()] + rule + css[header.end() :]
        screen = soup.find("div", class_="screen")
        for gone in screen.find_all("div", class_=["status", "homeBar", "kStatus", "kHomeBar"], recursive=False):
            gone.decompose()
        # Feature mockups leave a 60 px status gap at the top of their first column (44 + 16); it becomes this
        # device's inset plus 16, and the frame adds no second gap.
        first_col = screen.select_one(".main > .col, :scope > .col")
        if first_col is not None and re.match(r"\s*padding:\s*60px\b", first_col.get("style", "")):
            first_col["style"] = re.sub(r"padding:\s*60px\b", f"padding: {top + 16}px", first_col["style"], count=1)
            baked_header = True
        for sheet in screen.select(":scope > .sheet, :scope > .bsheet"):
            _fix_sheet(sheet, css, device, typing is not None)
        pad = (device["width"] - CONTENT_COLUMN) // 2 if column else 0
        drawn = re.search(r"height:\s*(\d+)px", screen.get("style", ""))
        # A mockup screen drawn taller than its device scrolls; it is a full-length board, not one screen.
        drawn_for = SCREEN_TALL if source.name.endswith("834Mobile.dc.html") else PHONE_DRAWN_HEIGHT
        tall = drawn is not None and int(drawn.group(1)) > drawn_for
        height = f"min-height: {device['height']}px" if tall else f"height: {device['height']}px"
        screen_top = 0 if baked_header else top
        # One screen tall with a tab bar: the frame pins the bar over the foot, so the content stops above it.
        foot = device["insets"]["bottom"] + (CHROME["tabBar"]["minHeight"] if active and not tall else 0)
        screen["style"] = (
            f"width: {device['width']}px; {height}; padding: {screen_top}px {pad}px "
            f"{foot}px; box-sizing: border-box; box-shadow: none; border-radius: 0"
        )
        # A mockup's own annotation label sits at the top corner; keep it below the status bar.
        if screen.find(class_="label", recursive=False) is not None:
            css += f"\n.screen > .label {{ top: {top + 8}px; }}"
        tall_screen = tall
        inner = str(soup)
    else:
        limit = f"; max-width: {CONTENT_COLUMN}px; margin: 0 auto" if column else ""
        modal = False
        markup = str(soup)
        # Some legacy boards (the editor) already leave the iPhone's 47 pt status bar gap; that gap becomes this
        # device's own inset instead of a second one.
        baked = re.search(r"padding-top:\s*47px", markup)
        if baked:
            markup = markup[: baked.start()] + f"padding-top: {top}px" + markup[baked.end() :]
        pad = 0 if baked else top
        inner = f'<div class="nv-legacy" style="padding-top: {pad}px; width: 100%{limit}">{markup}</div>'
    return {
        "css": css,
        "defs": defs,
        "inner": inner,
        "name": name,
        "modal": modal and fmt == "rd",
        "viewport": fmt == "screen" and not tall_screen,
        "active": active,
        "strategy": strategy,
        "script": script,
    }


def present_dialogs(soup: BeautifulSoup, device: dict) -> None:
    """A web dialog (a centred card) becomes our native sheet in its 'dialog' presentation (`sheetPresentation.ts`):
    anchored to the bottom with a grab handle on a phone, and a centred card no wider than 448 on a window 600 or
    wider. Bottom sheets the board already draws (`sheet`, `bsheet`) are left as they are."""
    rule = CHROME["sheet"]
    side = side_spacing(device, "sheet")
    for dialog in soup.find_all(attrs={"role": re.compile(r"^(?:alert)?dialog$")}):
        classes = dialog.get("class", [])
        if not ({"dlg", "card"} & set(classes)):
            continue
        style = dialog.get("style", "").strip("; ")
        if device["width"] >= rule["wideFrom"]:
            dialog["style"] = f"{style}; max-width: {rule['dialogMaxWidth']}px; border-radius: 24px".strip("; ")
            continue
        dialog["style"] = (
            f"{style}; position: absolute; left: 0; right: 0; bottom: 0; width: auto; max-width: none; margin: 0; "
            f"border-radius: 24px 24px 0 0; border-bottom-width: 0; padding: 0 {side}px 24px"
        ).strip("; ")
        handle = soup.new_tag("span", attrs={"class": "nv-handle", "aria-hidden": "true"})
        dialog.insert(0, handle)
        parent = dialog.parent
        if parent is not None and "position" not in parent.get("style", ""):
            parent["style"] = (parent.get("style", "").strip("; ") + "; position: relative").strip("; ")


def apply_page_op(soup: BeautifulSoup, op: dict) -> None:
    """Hand-pass edits a page names in `nativeLayouts.json` `ops`."""
    if op["op"] == "appleButton":
        # iOS offers Sign in with Apple beside Google (SocialSignInButtons.tsx; App Review Guideline 4.8). The button is
        # Apple's own: white with a black outline in light, white in dark (AppleAuthenticationButtonStyle in the code).
        google = soup.find(attrs={"aria-label": "Continue with Google"})
        if google is None:
            sys.exit("appleButton: no Continue with Google button on this board")
        apple = BeautifulSoup(APPLE_BUTTON, "html.parser")
        google.insert_before(apple)
    elif op["op"] == "remove":
        for tag in soup.select(op["select"]):
            tag.decompose()
    else:
        sys.exit(f"unknown page op {op['op']}")


def board_html(
    name: BoardName, title: str, css: str, defs: str, device_html: str, width: int, height: int, script: str = EMPTY_LOGIC
) -> str:
    props = json.dumps({"$preview": {"width": width, "height": height}})
    bundle = ""
    if "Commise." in device_html or "Commise." in script:
        # A legacy board draws the app's own React Native components through react-native-web from the design bundle.
        bundle = (
            '\n        <link rel="stylesheet" href="ds/commise/bundle.css" />'
            '\n        <script src="ds/commise/bundle.js"></script>'
        )
    return f"""<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <title>{title}</title>
        <script src="./support.js"></script>
        <link rel="stylesheet" href="ds/commise/tokens.css" />{bundle}
        <link rel="stylesheet" href="ds/commise/redesignNative.css" />
        <link rel="stylesheet" href="ds/commise/native.css" />
    </head>
    <body>
        <!-- Native board ({name.stem}), generated by nativeBoards/buildNativeBoards.py from the redesign board. Design
        artifact, not app code: it shows what the Tamagui app should render, drawn with flexbox only. -->
        <x-dc><helmet><style>
{css}
</style></helmet>{defs}{device_html}</x-dc>
        <script type="text/x-dc" data-dc-script data-props='{props}'>
            {script}
        </script>
    </body>
</html>
"""


def _write(out: Path, built: dict, device: dict, title: str, height: int, html_frame: str, manifest: list, state: str):
    name = built["name"]
    html = board_html(name, title, built["css"], built["defs"], html_frame, device["width"], height, built["script"])
    findings = check_native(html, device["os"])
    if findings:
        sys.exit(f"{name.file} fails the native check: {findings}")
    (out / "boards" / name.file).write_text(html)
    manifest.append(
        {
            "file": name.file,
            "w": device["width"],
            "h": height,
            "title": title,
            "device": next(k for k, d in DEVICES.items() if d is device),
            "row": f"{device['label']} ({device['width']} x {device['height']})",
            "state": state,
            "tablet": built["strategy"] if device["kind"] == "tablet" else None,
            "bundle": "Commise." in html_frame or "Commise." in built["script"],
        }
    )


def main(project: Path, out: Path, page: str, ds_project: Path | None = None) -> None:
    """`ds_project` holds the design-system files (`ds/commise`): the redesign canvas. A feature canvas has none."""
    ds_project = ds_project or project
    if out.exists():
        shutil.rmtree(out)
    (out / "boards").mkdir(parents=True)
    (out / "ds/commise").mkdir(parents=True)
    heights = json.loads(HEIGHTS_FILE.read_text()) if HEIGHTS_FILE.exists() else {}
    report: list[str] = []
    redesign_css, extra = convert_css((ds_project / "ds/commise/redesign.css").read_text(), "ios", report)
    if extra:
        sys.exit("redesign.css has a grid with columns; the native copy cannot lay it out without a body")
    (out / "ds/commise/redesignNative.css").write_text(_fit_width(redesign_css))
    write_native_css(ds_project / "ds/commise/tokens.json", out)
    manifest: list = []
    titles = json.loads((project / "canvas.json").read_text())["boards"]
    typing_boards = _layout_for(page).get("keyboard", [])
    skipped = _layout_for(page).get("webOnly", {})
    for state in page_states(project, page):
        if state in skipped:
            continue
        base_title = re.sub(r"\s*\((?:mobile|web|phone|tablet)[^)]*\)\s*$", "", titles[f"{state}Mobile.dc.html"]["title"])
        for key in devices_for(page, state):
            device = DEVICES[key]
            built = native_board(project, page, state, key, device, report)
            fixed = built["modal"] or built["viewport"]
            height = device["height"] if fixed else heights.get(built["name"].stem, device["height"])
            framed = frame(device, built["inner"], built["active"], built["modal"], built["viewport"])
            _write(out, built, device, f"{base_title} (mobile, {device['label']})", height, framed, manifest, state)
            for typing in (t for t in typing_boards if t["state"] == state):
                built = native_board(project, page, state, key, device, report, typing)
                offset = typing.get("offset", {}).get(device["kind"], 0)
                framed = frame(device, built["inner"], None, built["modal"], built["viewport"], offset)
                title = f"{base_title}, {typing['title']} (mobile, {device['label']})"
                _write(out, built, device, title, device["height"], framed, manifest, typing["name"])
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    (out / "report.json").write_text(json.dumps(sorted(set(report)), indent=2))
    print(f"{page}: {len(manifest)} native boards, {len(set(report))} items left for a person")


if __name__ == "__main__":
    # buildNativeBoards.py <boardsProject> <outDir> <page> [<designSystemProject>]
    main(
        Path(sys.argv[1]).resolve(),
        Path(sys.argv[2]).resolve(),
        sys.argv[3],
        Path(sys.argv[4]).resolve() if len(sys.argv) > 4 else None,
    )
