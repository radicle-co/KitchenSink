"""Prunes the boards a builder just wrote: the CSS rules no element of a board uses are removed, through the board-css
CLI (packages/tools/boardCss). The CLI exits non-zero when a board keeps a dead class it cannot remove, and so does this."""
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]


def prune(paths) -> None:
    """Prune the boards at `paths` in place; raises CalledProcessError when a board keeps a dead class."""
    boards = [str(Path(path).resolve()) for path in paths]
    subprocess.run(
        ["npm", "run", "--silent", "prune", "--workspace=packages/tools/boardCss", "--", *boards],
        cwd=REPO,
        check=True,
    )
