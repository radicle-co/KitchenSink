"""The native device frame: status bar, safe areas, our tab bar, the home indicator, and the fold.

The frame is the same for every board; only the body changes. A board whose body opens a modal layer (a scrim and a
sheet) is drawn at the device height, because on a phone a sheet covers the screen you are on, not the end of the
scroll. Every other board is drawn at its full scroll length, with a dashed line where the tab bar's top edge sits on
first open, so the scroll budget is visible.
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHROME = json.loads((HERE / "chrome.json").read_text())

GLYPHS = {
    "home": '<path d="M3.5 10.5 12 3.8l8.5 6.7V20a.8.8 0 0 1-.8.8H15v-6h-6v6H4.3a.8.8 0 0 1-.8-.8z"/>',
    "book": '<path d="M12 6.5C10.2 5 7.6 4.5 4 4.6v13.9c3.6-.1 6.2.4 8 1.9 1.8-1.5 4.4-2 8-1.9V4.6c-3.6-.1-6.2.4-8 1.9zM12 6.5v13.9"/>',
    "compass": '<circle cx="12" cy="12" r="8.5"/><path d="m15.2 8.8-1.9 4.5-4.5 1.9 1.9-4.5z"/>',
    "calendar": '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v3.5M15.5 3.5v3.5"/>',
}
SIGNAL = (
    '<svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx="1"/>'
    '<rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/>'
    '<rect x="15" y="0" width="3" height="12" rx="1"/></svg>'
)
WIFI = (
    '<svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true"><path d="M8 12 5.6 9.2a3.4 3.4 0 0 1 4.8 0z"/>'
    '<path d="M2.8 6.6a7.4 7.4 0 0 1 10.4 0l-1.5 1.6a5.3 5.3 0 0 0-7.4 0z"/>'
    '<path d="M0 3.8a11.4 11.4 0 0 1 16 0l-1.5 1.6a9.3 9.3 0 0 0-13 0z"/></svg>'
)
BATTERY = (
    '<svg width="26" height="12" viewBox="0 0 26 12" aria-hidden="true"><rect x="0.5" y="0.5" width="22" height="11" rx="3"'
    ' fill="none" stroke="currentColor" opacity="0.5"/><rect x="2" y="2" width="19" height="8" rx="1.8"/>'
    '<rect x="23.5" y="4" width="1.8" height="4" rx="0.9" opacity="0.5"/></svg>'
)


def status_bar(device: dict) -> str:
    top = device["insets"]["top"]
    if device["os"] == "android":
        return (
            f'<div class="nv-status" aria-hidden="true" style="height: {top}px; padding: 0 16px">'
            f'<span>9:41</span><span class="nv-icons">{WIFI}{SIGNAL}{BATTERY}</span></div>'
        )
    left = "9:41&nbsp;&nbsp;Sun 25 Oct" if device["kind"] == "tablet" else "9:41"
    pad = "0 20px" if device["kind"] == "tablet" else "0 32px 0 40px"
    return (
        f'<div class="nv-status" aria-hidden="true" style="height: {top}px; padding: {pad}">'
        f'<span>{left}</span><span class="nv-icons">{SIGNAL}{WIFI}{BATTERY}</span></div>'
    )


def tab_bar(active: str) -> str:
    tabs = []
    for tab in CHROME["tabs"]:
        on = tab["label"] == active
        current = ' aria-current="page"' if on else ""
        tabs.append(
            f'<a class="nv-tab{" on" if on else ""}" href="#"{current}>'
            f'<svg viewBox="0 0 24 24" aria-hidden="true">{GLYPHS[tab["glyph"]]}</svg>{tab["label"]}</a>'
        )
    return f'<nav class="nv-tabbar" aria-label="Tabs">{"".join(tabs)}</nav>'


KEY_ROWS = ("qwertyuiop", "asdfghjkl", "zxcvbnm")


def keyboard(device: dict) -> str:
    """A likeness of the system keyboard: the OS draws it, so it only shows how much of the screen it takes."""
    height = device["keyboard"]["height"]
    rows = "".join(
        '<div class="nv-keyrow">' + "".join(f'<span class="nv-key">{k}</span>' for k in row) + "</div>" for row in KEY_ROWS
    )
    space = '<div class="nv-keyrow"><span class="nv-key nv-wide">space</span></div>'
    return f'<div class="nv-keyboard" aria-hidden="true" style="height: {height}px">{rows}{space}</div>'


def frame(
    device: dict,
    body: str,
    active_tab: str | None,
    modal: bool,
    viewport: bool = False,
    typing: int | None = None,
) -> str:
    """Wrap a converted body in the device frame for `device`.

    `modal`: the body opens a scrim and sheet, so the board is one screen tall with the tab bar under the scrim.
    `viewport`: the body is itself one screen tall (cooking mode), so there is no fold. `typing`: the keyboard is up; the
    content above it is moved up by this many points so the field being typed in shows, and the tab bar is hidden
    behind the keyboard.
    """
    bottom = device["insets"]["bottom"]
    bar = CHROME["tabBar"]["minHeight"]
    fixed = modal or viewport or typing is not None
    classes = f"nv-device nv-{device['os']}" + (" nv-viewport" if fixed else "")
    size = f"width: {device['width']}px; min-height: {device['height']}px"
    if fixed:
        size += f"; height: {device['height']}px"
    if typing is not None:
        above = device["height"] - device["keyboard"]["height"]
        shifted = f'<div style="transform: translateY(-{typing}px)">{body}</div>' if typing and not modal else body
        content = f'<div class="nv-above-keyboard" style="height: {above}px">{shifted}</div>'
        return f'<div class="{classes}" style="{size}">{status_bar(device)}{content}{keyboard(device)}</div>'
    tabs = tab_bar(active_tab) if active_tab else ""
    if fixed and active_tab:
        tabs = tabs.replace('class="nv-tabbar"', f'class="nv-tabbar" style="bottom: {bottom}px"', 1)
    # Under a tab bar the strip below it is the bar's own surface; under a modal sheet it stays clear.
    surface = "var(--paper-raised)" if active_tab and not modal else "transparent"
    inset = (
        f'<div class="nv-inset nv-bottom" style="height: {bottom}px; background: {surface}">'
        '<span class="nv-indicator"></span></div>'
    )
    fold = ""
    if not fixed:
        line = device["height"] - bottom - (bar if active_tab else 0)
        fold = f'<div class="nv-fold" aria-hidden="true" style="top: {line}px"><span>First screen ends</span></div>'
    return f'<div class="{classes}" style="{size}">{status_bar(device)}{body}{tabs}{inset}{fold}</div>'
