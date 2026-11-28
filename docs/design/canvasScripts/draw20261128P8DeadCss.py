"""Remove the dead CSS from the P8 source-lock boards (board P8, PR #488).

boardDeadSelectors.test.ts (on main since the hiddenViews boards) admits a new board only at zero unused class
selectors, and lets an old board only fall. The P8 boards copy their P3 host's whole stylesheet and add `.p8` rules,
so each carries rules it does not draw. This script removes them, board by board, with the same reader the hiddenViews
script uses (`prune_dead_css`), so a rule goes only when no element and no script token on that board names its class.
It changes no element, no copy, no height and no canvas.json entry, so every board keeps its place and its render.

Boards: RecipeEditorSourceLock and RecipeEditorSourceSheet (recipeEditorWeb at web 1280 and 390, recipeEditorMobile
at iPhone 390, Android 384 and iPad 820), RecipeSourceLockDetail (recipeDetailWeb and recipeDetailMobile, same sizes),
and RecipeEditorStatementPaidSite, which P8 redrew with the `.p8` rules.

Run once from the repository root on its parent commit 94878b99f (branch docs/p8DeadSelectors):
python3 docs/design/canvasScripts/draw20261128P8DeadCss.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from draw20261128HiddenViewsBoards import prune_dead_css  # noqa: E402  # the one copy of the board CSS reader

ROOT = Path("docs/design/canvases")
WEB_SIZES = ["Web1280", "Web390"]
MOBILE_SIZES = ["Iphone390", "Android384", "Ipad820"]
FAMILIES = [
    ("recipeEditorWeb", "recipeEditorMobile", "RecipeEditorSourceLock"),
    ("recipeEditorWeb", "recipeEditorMobile", "RecipeEditorSourceSheet"),
    ("recipeEditorWeb", "recipeEditorMobile", "RecipeEditorStatementPaidSite"),
    ("recipeDetailWeb", "recipeDetailMobile", "RecipeSourceLockDetail"),
]


def main() -> None:
    """Prune every P8 board in place; stop if a board is missing or already has no dead CSS."""
    for web, mobile, family in FAMILIES:
        for canvas, sizes in ((web, WEB_SIZES), (mobile, MOBILE_SIZES)):
            for size in sizes:
                path = ROOT / canvas / "project" / f"{family}{size}.dc.html"
                before = path.read_text()
                after = prune_dead_css(before)
                if after == before:
                    raise ValueError(f"{path}: nothing to remove")
                path.write_text(after)


if __name__ == "__main__":
    main()
