# Board builders for the cooking mode and recipe detail boards

These scripts drew boards that are now in `docs/design/canvases/`. Board comments cite them by file name.

| Script                  | Boards it draws                               | Run                                                                         |
| ----------------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| `buildS2Boards.py`      | cooking mode ingredients, add timer           | `python3 -I buildS2Boards.py <outDir>`                                      |
| `buildDockRowBoards.py` | cooking mode dock row                         | `python3 -I buildDockRowBoards.py <outDir>`                                 |
| `buildS3bBoards.py`     | alarm go to step, recipe detail exit snackbar | `python3 -I buildS3bBoards.py <outDir>`                                     |
| `buildS4aBoards.py`     | cooking mode resume                           | run from the output folder; takes an optional measures JSON as its argument |

`themes.css`, `houseTabNative.html`, `houseTabWeb.html` and `houseTabWeb.css` are inputs the scripts read from this
folder. `doneRowCss.py` is a module the build scripts import.

The output is a starting point, not a byte-exact copy of what is on `main`. Only the ingredients boards of
`buildS2Boards.py` match. The others were edited after they were drawn: by two more scripts, `relabelContinueCooking.py`
(renamed the continue cooking label) and `s4aResumeCopy.py` (rewrote the resume copy, with a `--normalize` step), and by
review fixes. Those two scripts are lost: they were in a scratch folder that was wiped. Their effect is already in the
boards. Do not recreate them.

A board must carry only the CSS rules it draws. `boardDeadSelectors.test.ts` in `packages/tools/repoGuards` holds each
board's count of unused class selectors to a baseline that only falls, and refuses a new board that has any. Boards
already on `main` when the guard landed were recorded once; after that nothing is admitted. These
builders copy a shared stylesheet whole, so a board they draw fails that guard until the unused rules are removed.

These scripts sit outside the repo's Python checks (which cover `packages/`). Run the bug rules by hand after an edit:

    ruff check --select F,E9,B buildS2Boards.py buildDockRowBoards.py buildS3bBoards.py buildS4aBoards.py doneRowCss.py
