"""Turn a web-drawn board's CSS and body into what React Native, and so Tamagui, can draw.

What it converts by itself:
- CSS grid to flexbox. A centring grid becomes a centring flex box; a grid with no columns becomes a flex column; a
  grid with columns becomes rows of cells, each cell sized by its track (`1fr` grows, `auto` hugs, `Npx` is fixed). That
  is how a React Native list of equal tiles is built, because Yoga has no grid and no `calc()`.
- Hover rules and `cursor` are dropped: there is no pointer.
- tamaguiAudit.md Part 5: backdrop blur becomes solid `paperRaised` (X1), balanced titles are dropped on iOS (X2),
  underline thickness is dropped (X3), and drawn focus rings are dropped except on a text field (X4).

What it cannot convert it names in the report and leaves for a person: `minmax()` tracks, grid placement
(`grid-column`, `grid-area`), and sticky or fixed positioning.
"""

import copy
import re

from bs4 import BeautifulSoup, NavigableString, Tag

DROP_DECLS = re.compile(r"^(?:cursor|text-decoration-thickness|-webkit-backdrop-filter|backdrop-filter)$")
FOCUS_RING = re.compile(r"inset\s+0\s+0\s+0\s+[\d.]+px\s+var\(--focus-ring\)")
TEXT_FIELD = re.compile(r"\b(?:input|textarea|field|search)\b", re.I)
PLACEMENT = re.compile(r"^(?:grid-column|grid-row|grid-area|grid-auto-flow|grid-auto-rows|grid-template-rows|justify-items|place-content)$")


def _decls(body: str) -> list[tuple[str, str]]:
    out = []
    for part in body.split(";"):
        if ":" in part:
            name, value = part.split(":", 1)
            out.append((name.strip(), value.strip()))
    return out


ZERO_MIN = re.compile(r"minmax\(\s*0(?:px)?\s*,\s*([\d.]+fr)\s*\)")
AUTO_FILL = re.compile(r"repeat\(\s*auto-(?:fill|fit)\s*,\s*minmax\(\s*(\d+)px\s*,\s*[\d.]+fr\s*\)\s*\)")


def _tracks(value: str) -> list[str]:
    """The column tracks. `minmax(0, 1fr)` is exactly `1fr` with no minimum, so it reads as `1fr`; a responsive
    `repeat(auto-fill, minmax(Npx, 1fr))` reads as one `wrap:N` track (cells wrap, each at least N wide)."""
    value = ZERO_MIN.sub(r"\1", value.strip())
    auto = AUTO_FILL.fullmatch(value)
    if auto:
        return [f"wrap:{auto.group(1)}"]
    repeat = re.fullmatch(r"repeat\(\s*(\d+)\s*,\s*([^)]+)\)", value)
    if repeat:
        return [repeat.group(2).strip()] * int(repeat.group(1))
    return re.findall(r"minmax\([^)]*\)|\S+", value)


def _column_gap(decls: dict[str, str]) -> int:
    if "column-gap" in decls:
        return int(re.match(r"\d+", decls["column-gap"]).group(0))
    if "gap" in decls:
        values = re.findall(r"(\d+)px", decls["gap"])
        return int(values[-1]) if values else 0
    return 0


def _convert_rule(selector: str, body: str, os_name: str, grids: list, report: list) -> str | None:
    selectors = [s.strip() for s in selector.split(",") if ":hover" not in s]
    if not selectors:
        return None
    selector = ", ".join(selectors)
    decls = _decls(body)
    names = dict(decls)
    out: list[tuple[str, str]] = []
    is_grid = re.fullmatch(r"(?:inline-)?grid", names.get("display", ""))
    text_field = bool(TEXT_FIELD.search(selector))
    for name, value in decls:
        if DROP_DECLS.match(name):
            if "backdrop" in name:
                out = [(n, v) for n, v in out if n not in ("background", "background-color")]
                out.append(("background", "var(--paper-raised)"))
            continue
        if name == "text-wrap" and os_name == "ios" and value in ("balance", "pretty"):
            continue
        if name == "box-shadow" and FOCUS_RING.search(value) and not text_field:
            value = ", ".join(p for p in re.split(r",(?![^(]*\))", value) if not FOCUS_RING.search(p)).strip()
            if not value:
                continue
        if name in ("background", "background-color") and "backdrop-filter" in names:
            continue
        if name in ("grid-auto-flow", "grid-auto-columns") and names.get("grid-auto-flow") == "column" and is_grid:
            continue
        if PLACEMENT.match(name):
            report.append(f"{selector}: {name}: {value} has no flexbox form; check it by hand")
            continue
        if is_grid and name == "display" and names.get("grid-auto-flow") == "column":
            # Children laid side by side in equal auto columns: one flex row of equal cells.
            out += [("display", "flex"), ("flex-direction", "row")]
            grids.append((selector, ["row"], _column_gap(names)))
            continue
        if is_grid and name == "display":
            if "grid-template-columns" in names and AUTO_FILL.fullmatch(ZERO_MIN.sub(r"\1", names["grid-template-columns"])):
                out += [("display", "flex"), ("flex-direction", "row"), ("flex-wrap", "wrap")]
            elif "grid-template-columns" in names:
                out += [("display", "flex"), ("flex-direction", "column")]
            elif names.get("place-items") == "center":
                out += [("display", "flex"), ("align-items", "center"), ("justify-content", "center")]
            else:
                out += [("display", "flex"), ("flex-direction", "column")]
            continue
        if is_grid and name == "place-items":
            continue
        if name == "grid-template-columns":
            tracks = _tracks(value)
            if any(t.startswith("minmax") for t in tracks):
                report.append(f"{selector}: minmax() track has no flexbox form; check it by hand")
            grids.append((selector, tracks, _column_gap(names)))
            continue
        if name == "position" and value in ("sticky", "fixed"):
            report.append(f"{selector}: position: {value}; the native frame pins bars, so check it by hand")
            continue
        out.append((name, value))
    if not out:
        return None
    return f"{selector} {{ " + "; ".join(f"{n}: {v}" for n, v in out) + "; }"


def convert_css(css: str, os_name: str, report: list | None = None) -> tuple[str, list]:
    """Return the converted CSS and the grid rules that have columns, as (selector, tracks, column gap)."""
    report = [] if report is None else report
    grids: list = []
    out, i = [], 0
    while i < len(css):
        brace = css.find("{", i)
        if brace < 0:
            out.append(css[i:])
            break
        head = css[i:brace].strip()
        if head.startswith("@"):
            depth, j = 1, brace + 1
            while depth and j < len(css):
                depth += {"{": 1, "}": -1}.get(css[j], 0)
                j += 1
            inner, _ = convert_css(css[brace + 1 : j - 1], os_name, report)
            out.append(f"{head} {{\n{inner}\n}}")
            i = j
            continue
        end = css.index("}", brace)
        converted = _convert_rule(head, css[brace + 1 : end], os_name, grids, report)
        if converted:
            out.append(converted)
        i = end + 1
    return "\n".join(out), grids


def _style(tag: Tag, extra: str, drop: tuple[str, ...] = ()) -> None:
    kept = [(n, v) for n, v in _decls(tag.get("style", "")) if n not in drop]
    tag["style"] = "; ".join(f"{n}: {v}" for n, v in kept + _decls(extra))


def _track_style(track: str) -> str:
    fr = re.fullmatch(r"([\d.]+)fr", track)
    if fr:
        return f"flex: {fr.group(1)} 1 0%; min-width: 0"
    px = re.fullmatch(r"(\d+)px", track)
    if px:
        return f"flex: none; width: {px.group(1)}px"
    return "flex: none"


def _lay_out(soup: BeautifulSoup, tag: Tag, tracks: list[str], gap: int) -> None:
    kids = [k for k in tag.find_all(recursive=False) if "position: absolute" not in k.get("style", "")]
    n = len(tracks)
    drop = ("display", "grid-template-columns", "flex-direction")
    if len(kids) <= n:
        _style(tag, f"display: flex; flex-direction: row; gap: {gap}px", drop)
        for index, kid in enumerate(kids):
            _style(kid, _track_style(tracks[index]))
        _pad(soup, tag, tracks, len(kids))
        return
    _style(tag, "display: flex; flex-direction: column", drop)
    for start in range(0, len(kids), n):
        row = soup.new_tag("div", attrs={"class": "nv-row", "style": f"display: flex; flex-direction: row; gap: {gap}px"})
        kids[start].insert_before(row)
        chunk = kids[start : start + n]
        for index, kid in enumerate(chunk):
            row.append(kid.extract())
            _style(kid, _track_style(tracks[index]))
        _pad(soup, row, tracks, len(chunk))


def _pad(soup: BeautifulSoup, row: Tag, tracks: list[str], filled: int) -> None:
    """Keep a short row's cells at their column width: an empty `fr` column becomes an invisible copy of a cell.

    A copy, not a bare box: a cell's padding and border sit on top of its 0 flex basis, so a bare spacer would leave
    the short row's cells wider than a full row's. With the same box in every slot, every row shares one track."""
    cells = row.find_all(recursive=False)
    for index in range(filled, len(tracks)):
        if tracks[index].endswith("fr"):
            if cells:
                spacer = copy.copy(cells[-1])
                for tag in [spacer, *spacer.find_all(id=True)]:
                    tag.attrs.pop("id", None)
                spacer["class"] = [*spacer.get("class", []), "nv-spacer"]
                spacer["aria-hidden"] = "true"
                _style(spacer, "visibility: hidden")
            else:
                spacer = soup.new_tag("div", attrs={"class": "nv-spacer", "aria-hidden": "true"})
            _style(spacer, _track_style(tracks[index]))
            row.append(spacer)


def _lay_out_special(tag: Tag, track: str) -> None:
    """`row`: every child an equal cell in one row. `wrap:N`: cells wrap, each growing from N wide."""
    basis = "0%" if track == "row" else f"{track.split(':')[1]}px"
    for kid in tag.find_all(recursive=False):
        _style(kid, f"flex: 1 1 {basis}; min-width: 0")


def _keep_ratings_whole(soup: BeautifulSoup) -> None:
    """A rating star and its number are one unit: it wraps to the next line as a whole, never star then number."""
    for star in soup.find_all("svg", class_="star"):
        number = star.next_sibling
        if isinstance(number, NavigableString) and number.strip():
            unit = soup.new_tag("span", attrs={"class": "nv-rating", "style": "display: inline-flex; align-items: center; gap: inherit"})
            star.insert_before(unit)
            unit.append(star.extract())
            unit.append(number.extract())


def convert_body(soup: BeautifulSoup, grids: list, class_gaps: dict[str, int]) -> None:
    """Lay out every grid with columns as flex rows. `class_gaps` gives the column gap for an inline template."""
    _keep_ratings_whole(soup)
    for selector, tracks, gap in grids:
        if len(tracks) == 1 and (tracks[0] == "row" or tracks[0].startswith("wrap:")):
            for tag in soup.select(selector):
                _lay_out_special(tag, tracks[0])
            continue
        for tag in soup.select(selector):
            if "grid-template-columns" not in tag.get("style", ""):
                _lay_out(soup, tag, tracks, gap)
    for tag in soup.find_all(style=re.compile(r"grid-template-columns|display:\s*grid")):
        decls = dict(_decls(tag["style"]))
        if "grid-template-columns" not in decls:
            _style(tag, "display: flex; flex-direction: column", ("display",))
            continue
        gap = _column_gap(decls)
        if not gap:
            gap = next((class_gaps[c] for c in tag.get("class", []) if c in class_gaps), 0)
        _lay_out(soup, tag, _tracks(decls["grid-template-columns"]), gap)
