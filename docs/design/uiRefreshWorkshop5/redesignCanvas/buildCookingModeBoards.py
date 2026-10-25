"""Turn the final cooking mode workshop mockup into redesign canvas boards.

Run from the repo root:

    python3 docs/design/uiRefreshWorkshop5/redesignCanvas/buildCookingModeBoards.py

The mockup is `cookingMode/workshop/round3/designerC/mockup.html`. Each light screen with a `data-screen` name becomes
one board in `boards/`, named `CookingMode<Screen><Size>`. The board drops the screen's own `data-theme`, so it takes the
canvas theme, light or dark. The script also rewrites the cooking mode entries in `extraBoards.json` and deletes the
cooking mode boards from an earlier run.
"""

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
MOCKUP = HERE.parent / "cookingMode/workshop/round3/designerC/mockup.html"
SIZES = {
    "phone": ("Mobile", "phone", "Cooking mode: phone"),
    "tab834": ("834Mobile", "tablet 834 px", "Cooking mode: tablet"),
    "tab1194": ("1194Mobile", "tablet 1194 px", "Cooking mode: tablet"),
    "web1280": ("", "web", "Cooking mode: web"),
    "web768": ("768", "web 768 px", "Cooking mode: web"),
}
# web 768 is a breakpoint: only the screens that change most at that width.
WEB768 = {"Step", "Wait", "Ingredients"}


def screen_html(source: str, start: int) -> str:
    """Return the element that opens at `start`, by counting nested div tags."""
    depth, i = 0, start
    for match in re.finditer(r"<div\b|</div>", source[start:]):
        depth += 1 if match.group(0) == "<div" else -1
        if depth == 0:
            i = start + match.end()
            break
    return source[start:i]


def board(title: str, style: str, fonts: str, body: str, width: int, height: int) -> str:
    props = json.dumps({"$preview": {"width": width, "height": height}})
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
{fonts}
<style>
body{{margin:0}}
{style}
</style>
</helmet>
{body}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{props}'>
class Component extends DCLogic {{
renderVals() {{
return {{}};
}}
}}
</script>
</body>
</html>
"""


screen_tag_check = r'<div\s+class="screen[^"]*"\s+data-theme="light"\s+data-screen="'


def main() -> None:
    source = MOCKUP.read_text()
    style = re.search(r"<style>(.*?)</style>", source, re.S).group(1)
    # The mockup's body rule pads and greys its gallery page; a board is the screen alone.
    style = re.sub(r"body\s*\{[^}]*\}", "body { font-family: Inter, system-ui, sans-serif; }", style, count=1)
    fonts = "\n".join(
        re.sub(r"\s+", " ", tag) for tag in re.findall(r"<link\s[^>]*fonts\.googleapis\.com[^>]*>", source)
    )
    if not re.search(screen_tag_check, source):
        raise SystemExit("No light screens found in the mockup; nothing was changed.")
    extra_path = HERE / "extraBoards.json"
    extra = {k: v for k, v in json.loads(extra_path.read_text()).items() if not k.startswith("CookingMode")}
    for old in (HERE / "boards").glob("CookingMode*.dc.html"):
        old.unlink()

    seen = set()
    screen_tag = r'<div\s+class="screen[^"]*"\s+data-theme="light"\s+data-screen="([a-zA-Z0-9]+)"[^>]*>'
    for match in re.finditer(screen_tag, source):
        screen = match.group(1)
        size = next(key for key in SIZES if screen.startswith(key))
        state = screen[len(size):]
        if screen in seen or (size == "web768" and state not in WEB768):
            continue
        seen.add(screen)
        suffix, size_label, row = SIZES[size]
        name = f"CookingMode{state}{suffix}"
        html = re.sub(r'\s+data-theme="light"', "", screen_html(source, match.start()), count=1)
        dims = re.search(r"width:\s*(\d+)px;\s*height:\s*(\d+)px", match.group(0))
        width, height = int(dims.group(1)), int(dims.group(2))
        words = re.sub(r"(?<!^)([A-Z])", r" \1", state).lower()
        title = f"Cooking mode, {words} ({size_label})"
        (HERE / "boards" / f"{name}.dc.html").write_text(board(title, style, fonts, html, width, height))
        extra[name] = {"row": row, "w": width, "h": height, "title": title}

    extra_path.write_text(json.dumps(extra, indent=1) + "\n")
    print(f"{len(seen)} cooking mode boards written")


if __name__ == "__main__":
    main()
