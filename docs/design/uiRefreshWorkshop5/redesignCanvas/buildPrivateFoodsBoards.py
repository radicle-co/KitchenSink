"""Turn the private foods mockup into redesign canvas boards.

Run from the repo root:

    python3 docs/design/uiRefreshWorkshop5/redesignCanvas/buildPrivateFoodsBoards.py

The mockup is `privateFoodsMockup.html`. Each light screen becomes one board in `boards/`, named `<State><Size>`, placed
after the board it continues from. Each state has four sizes: phone 390, phone 320, tablet 820 and web 1280. The script
rewrites these entries in `extraBoards.json` and leaves every other entry alone. The spec is `../privateFoods/spec.md`.
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import mockupBoards  # noqa: E402
from mockupBoards import board, mockup_fonts, mockup_style, screens  # noqa: E402

# The shared SIZES has no 320 phone and no 820 tablet. Longer keys go first, because `screens` matches by prefix.
SIZES = {
    "phone320": ("320Mobile", "phone 320 px", "phone"),
    "tab820": ("820Mobile", "tablet 820 px", "tablet"),
    **mockupBoards.SIZES,
}
mockupBoards.SIZES.clear()
mockupBoards.SIZES.update(SIZES)

MOCKUP = HERE / "privateFoodsMockup.html"

# State -> (title, group). A group's states are chained in this order after the group's anchor board.
STATES = {
    "FoodPagePrivate": ("Food page, private", "food"),
    "FoodPageAsked": ("Food page, asked to make public", "food"),
    "FoodPageNotApproved": ("Food page, not approved", "food"),
    "FoodPagePublicEditWaiting": ("Food page, public with an edit waiting", "food"),
    "FoodPageEditNotApproved": ("Food page, edit not approved", "food"),
    "FoodPageWithdrawn": ("Food page, withdrawn", "food"),
    "FoodPageWithdrawConfirm": ("Food page, withdraw confirmation", "food"),
    "FoodEditPublic": ("Edit a public food, before save", "food"),
    "FoodEditSentForReview": ("Edit a public food, sent for review", "food"),
    "RecipeEditorPrivateFoodPublicRecipe": ("Recipe editor, private food in a public recipe", "row"),
    "RecipeEditorPrivateFoodPrivateRecipe": ("Recipe editor, private food in a private recipe", "row"),
    "RecipeEditorPublishRefusedCanGoPrivate": ("Recipe editor, publish refused, can go private", "refusal"),
    "RecipeEditorPublishRefusedCannotGoPrivate": ("Recipe editor, publish refused, cannot go private", "refusal"),
    "AccountEraseDialogPrivateFoods": ("Erase my data, recipes with private foods", "erase"),
    "ProfileYourFoods": ("Profile, Your foods row", "profile"),
    "YourFoodsList": ("Your foods, one row per state", "profile"),
}
# Group -> (phone anchor, web anchor): the existing board each group continues from.
ANCHOR = {
    "food": ("RecipeEditorFoodDetailsStatesMobile", "RecipeEditorFoodDetailsStates"),
    "row": ("RecipeEditorIngredientRowStatesMobile", "RecipeEditorIngredientRowStates"),
    "refusal": ("RecipeEditorFixToPublishMobile", "RecipeEditorFixToPublish"),
    "erase": ("AccountEraseDialogStatesMobile", "AccountEraseDialogStates"),
    "profile": ("ProfileMobile", "Profile"),
}


def main() -> None:
    source = MOCKUP.read_text()
    style, fonts = mockup_style(source), mockup_fonts(source)
    extra_path = HERE / "extraBoards.json"
    mine = {f"{s}{suffix}" for s in STATES for suffix, _, _ in SIZES.values()}
    extra = {k: v for k, v in json.loads(extra_path.read_text()).items() if k not in mine}
    found = {(s.state, s.size): s for s in screens(source)}
    wanted = {(state, size) for state in STATES for size in ("phone", "phone320", "tab820", "web1280")}
    if set(found) != wanted:
        sys.exit(f"Mockup screens differ from the plan. Missing {sorted(wanted - set(found))}, extra {sorted(set(found) - wanted)}")
    # Where the next board of each chain goes: phone-row boards follow the previous phone-row board, web follows web.
    tail = {group: list(pair) for group, pair in ANCHOR.items()}
    for state, (title, group) in STATES.items():
        for size in ("phone", "phone320", "tab820"):
            screen = found[(state, size)]
            suffix, size_label, _ = SIZES[size]
            name = f"{state}{suffix}"
            _write(name, f"{title} ({size_label})", style, fonts, screen)
            extra[name] = {"after": tail[group][0], "w": screen.width, "h": screen.height, "title": f"{title} ({size_label})"}
            tail[group][0] = name
        screen = found[(state, "web1280")]
        name = state
        _write(name, f"{title} (web)", style, fonts, screen)
        extra[name] = {"after": tail[group][1], "w": screen.width, "h": screen.height, "title": f"{title} (web)"}
        tail[group][1] = name
    extra_path.write_text(json.dumps(extra, indent=4) + "\n")
    print(f"{len(STATES) * 4} private foods boards written")


def _write(name, title, style, fonts, screen) -> None:
    (HERE / "boards" / f"{name}.dc.html").write_text(board(title, style, fonts, screen.html, screen.width, screen.height))


if __name__ == "__main__":
    main()
