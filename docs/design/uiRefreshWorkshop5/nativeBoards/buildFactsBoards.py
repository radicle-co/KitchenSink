"""Add the facts-card boards (`factsCard/spec.md`) to the published Recipe detail canvases.

Run after the Recipe detail canvases are built, with the two published project folders:

    python3 docs/design/uiRefreshWorkshop5/nativeBoards/buildFactsBoards.py <recipeDetailMobile/project> \
        <recipeDetailWeb/project>

For each device that has a `RecipeDetailReader…` board, it derives four boards from the reader board (another cook's
recipe) and the Make public dialog (the converted bottom sheet):

- `RecipeFacts<Device>`: the facts card of a recipe copied from a web page;
- `RecipeFactsBook<Device>`: the book card, with no photo of the owner's own;
- `RecipeSourceCard<Device>`: the source card;
- `RecipeFactsSaveCopy<Device>`: the Save a copy sheet, drawn like the other dialog boards.

It places them at the end of the device's row in `canvas.json`. Heights come from `--heights <json>` when given,
otherwise from the reader board. It is idempotent: a second run replaces the four boards.
"""

import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

SITE = "Serious Eats"
BOOK = "Roast Chicken and Other Stories"
AUTHOR = "Simon Hopkinson"
STEPS = 6
UNREAD = 2
EXTERNAL = (
    '<symbol id="external" viewBox="0 0 24 24"><path d="M14 4.5h5.5V10" /><path d="M19.5 4.5 11 13" />'
    '<path d="M18 13.5v4a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></symbol>'
)
KINDS = {
    "RecipeFacts": "facts card",
    "RecipeFactsBook": "facts card, from a book",
    "RecipeSourceCard": "source card",
    "RecipeFactsSaveCopy": "facts card, Save a copy sheet",
}


def frag(html: str):
    return BeautifulSoup(html, "html.parser")


def icon(name: str) -> str:
    return f'<svg aria-hidden="true" class="ic sm" style="margin-left: 4px"><use href="#{name}"></use></svg>'


def add_symbol(soup: BeautifulSoup) -> None:
    if soup.find("symbol", id="external"):
        return
    first = soup.find("symbol")
    first.insert_before(frag(EXTERNAL))


def drop(soup: BeautifulSoup, *selectors: str) -> None:
    for sel in selectors:
        for el in soup.select(sel):
            el.decompose()


def retitle(soup: BeautifulSoup, kind: str) -> None:
    title = soup.title
    title.string = re.sub(r"another cook's recipe", kind, title.string)


def no_photo_hero(soup: BeautifulSoup) -> None:
    hero = soup.select_one(".imgHero")
    hero["class"] = [c for c in hero["class"] if c != "imgHero"]
    hero["style"] = "background-image: linear-gradient(135deg, var(--cover-sky), var(--cover-peach));"
    drop(soup, ".dots", ".edge")


def credit(soup: BeautifulSoup, text: str) -> None:
    by = soup.select_one(".byRow")
    by.replace_with(frag(f'<p class="t13 soft factsCredit">{text}</p>'))


def facts_card(soup: BeautifulSoup, book: bool) -> None:
    drop(soup, ".rowLink", ".eyebrow", ".desc", ".moreLink", ".tags", ".card.prep", ".group", ".ing .note")
    credit(soup, f"From {BOOK} by {AUTHOR}" if book else f"Saved from {SITE}")
    tiles = soup.select(".facts .fact")
    tiles[-1].select_one(".lab").string = "Cook"
    tiles[-1].select_one(".v").string = "1 h 30 min"
    start = soup.select_one(".startCook")
    if book:
        start.decompose()
    else:
        start.clear()
        start.append(frag(f"Open the full recipe on {SITE}{icon('external')}"))
        start["aria-label"] = f"Open the full recipe on {SITE}, opens in your browser"
    acts = soup.select_one(".quietActs")
    for a in acts.find_all("a"):
        if "Save a copy" not in a.get_text():
            a.decompose()
    accordion = soup.select_one(".accordion")
    accordion["style"] = "flex-wrap: wrap; row-gap: 0; padding-bottom: 12px"
    accordion.append(frag('<span class="t13 soft" style="flex-basis: 100%; margin-top: -12px">Estimated by Commise</span>'))
    where = "in the book only" if book else f"on {SITE} only"
    soup.select_one(".ingCard").append(
        frag(f'<p class="t13 soft factsUnread" style="padding: 4px 16px 16px">{UNREAD} more ingredients are {where}.</p>')
    )
    soup.select_one(".secHead h2").string = "Method"
    method = (
        f"<p class=\"t15\">This recipe has {STEPS} steps in {BOOK}.</p>"
        if book
        else f'<p class="t15">This recipe has {STEPS} steps on {SITE}.</p>'
        f'<a class="moreLink factsMethodLink" href="#" aria-label="Read the method on {SITE}, opens in your browser">'
        f"Read the method on {SITE}{icon('external')}</a>"
    )
    soup.select_one("ol.steps").replace_with(
        frag(
            f'<div class="card mx factsMethod" style="padding: 16px; display: grid; gap: 8px">{method}<p class="t13 soft">Commise shows the facts of recipes from '
            "other sources. The method stays with its author.</p></div>"
        )
    )
    if book:
        no_photo_hero(soup)


def source_card(soup: BeautifulSoup) -> None:
    no_photo_hero(soup)
    hero = soup.select_one(".hero")
    if hero:
        hero["style"] = "background: none; height: 104px"
        soup.select_one(".sheet")["style"] = "margin-top: 0"
    else:
        soup.select_one(".photo").decompose()
    drop(
        soup,
        ".rateBlock",
        ".eyebrow",
        ".facts",
        ".quietActs",
        ".moreLink",
        ".tags",
        ".card.prep",
        ".accordion",
        ".ingSpace",
        ".ingCard",
        ".secHead",
        "ol.steps",
        ".bodyCols",
    )
    credit(soup, f"From {SITE}")
    start = soup.select_one(".startCook")
    start.clear()
    start.append(frag(f"Open the recipe on {SITE}{icon('external')}"))
    start["aria-label"] = f"Open the recipe on {SITE}, opens in your browser"
    desc = soup.select_one(".desc")
    desc.replace_with(frag(f'<p class="t15 soft factsExplain">This recipe is on {SITE}. Commise links to it.</p>'))


def save_copy(dialog: BeautifulSoup) -> None:
    stages = dialog.select(".stage")
    for extra in stages[1:]:
        caption = extra.find_previous_sibling("p", class_="cap")
        if caption:
            caption.decompose()
        extra.decompose()
    sheet = stages[0].select_one(".bsheet") or stages[0].select_one(".dlg")
    sheet.select_one("h2").string = "Save a copy"
    sheet.select_one("p").string = (
        f"Your copy gets the title, times, servings and ingredients, and the link to {SITE}. The method stays on "
        f"{SITE}. To keep the full recipe, import it from {SITE} yourself."
    )
    acts = sheet.select_one(".acts")
    acts.clear()
    acts.append(frag(f'<a class="btn secondary" href="#">Cancel</a><a class="btn primary" href="#">{icon("copy")}Save my copy</a>'))
    for el in dialog.find_all(string=re.compile(r"^\s*Asking:")):
        el.replace_with("Save a copy of another cook's facts card")


def device_of(name: str) -> str:
    return name.removeprefix("RecipeDetailReader").removesuffix(".dc.html")


def place(canvas: dict, name: str, base: str, kind: str, height: int) -> None:
    boards = canvas["boards"]
    ref = boards[base]
    boards.pop(name, None)
    ours = tuple(KINDS)
    right = max(b["x"] + b["w"] for k, b in boards.items() if b["y"] == ref["y"] and not k.startswith(ours))
    right = max([right] + [b["x"] + b["w"] for k, b in boards.items() if b["y"] == ref["y"] and k.startswith(ours)])
    title = re.sub(r"another cook's recipe", kind, ref["title"])
    boards[name] = {"x": right + 80, "y": ref["y"], "w": ref["w"], "h": height, "title": title}
    order = canvas.setdefault("order", [])
    if isinstance(order, list) and name not in order:
        order.append(name)


def build(project: Path, heights: dict) -> list[str]:
    canvas_path = project / "canvas.json"
    canvas = json.loads(canvas_path.read_text())
    written = []
    readers = sorted(p.name for p in project.glob("RecipeDetailReader*.dc.html") if "Menu" not in p.name)
    for reader in readers:
        device = device_of(reader)
        source = (project / reader).read_text()
        dialog_path = project / f"RecipeMakePublicDialog{device}.dc.html"
        outputs = {}
        for stem in ("RecipeFacts", "RecipeFactsBook", "RecipeSourceCard"):
            soup = BeautifulSoup(source, "html.parser")
            add_symbol(soup)
            retitle(soup, KINDS[stem])
            if stem == "RecipeSourceCard":
                source_card(soup)
            else:
                facts_card(soup, book=stem == "RecipeFactsBook")
            outputs[stem] = soup
        dialog = BeautifulSoup(dialog_path.read_text(), "html.parser")
        add_symbol(dialog)
        dialog.title.string = re.sub(r"Make public dialog|make public dialog", "Save a copy sheet", dialog.title.string)
        save_copy(dialog)
        outputs["RecipeFactsSaveCopy"] = dialog
        for stem, soup in outputs.items():
            name = f"{stem}{device}.dc.html"
            (project / name).write_text(str(soup))
            base = reader if stem != "RecipeFactsSaveCopy" else dialog_path.name
            height = heights.get(name) or canvas["boards"][base]["h"]
            place(canvas, name, base, KINDS[stem], height)
            written.append(name)
    canvas_path.write_text(json.dumps(canvas, indent=1))
    return written


def main() -> None:
    args = sys.argv[1:]
    heights = {}
    if "--heights" in args:
        i = args.index("--heights")
        heights = json.loads(Path(args[i + 1]).read_text())
        del args[i : i + 2]
    for project in args:
        for name in build(Path(project), heights):
            print(name)


if __name__ == "__main__":
    main()
