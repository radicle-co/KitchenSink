"""Runs the board-css `prune` command over the boards a builder just wrote, in place. Raises CalledProcessError when a
board keeps a dead class the command will not remove."""
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
