# Board builders for the cooking mode and recipe detail boards

These scripts drew boards that are now in `docs/design/canvases/`. Board comments cite them by file name.

| Script                  | Boards it draws                               | Run                                                                         |
| ----------------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| `buildS2Boards.py`      | cooking mode ingredients, add timer           | `python3 -I buildS2Boards.py <outDir>`                                      |
| `buildDockRowBoards.py` | cooking mode dock row                         | `python3 -I buildDockRowBoards.py <outDir>`                                 |
| `buildS3bBoards.py`     | alarm go to step, recipe detail exit snackbar | `python3 -I buildS3bBoards.py <outDir>`                                     |
| `buildS4aBoards.py`     | cooking mode resume                           | run from the output folder; takes an optional measures JSON as its argument |

`themes.css`, `houseTabNative.html`, `houseTabWeb.html` and `houseTabWeb.css` are inputs the scripts read from this
folder. `doneRowCss.py` and `pruneCss.py` are modules the build scripts import. `pruneCss.py` also runs on its own to
drop CSS a board does not use.

The output is a starting point, not a byte-exact copy of what is on `main`. Only the ingredients boards of
`buildS2Boards.py` match. The others were edited after they were drawn: by two more scripts, `relabelContinueCooking.py`
(renamed the continue cooking label) and `s4aResumeCopy.py` (rewrote the resume copy, with a `--normalize` step), and by
review fixes. Those two scripts are lost: they were in a scratch folder that was wiped. Their effect is already in the
boards. Do not recreate them.

A board must carry only the CSS rules it draws. `boardDeadSelectors.test.ts` in `packages/tools/repoGuards` holds each
board's count of unused class selectors to a baseline that only falls.

The root `ruff` rules for annotations, docstrings and line length (`ANN`, `D`, `E501`) are waived for these builders,
as for the other scripts in this folder. The bug rules are not. This command passes on the files added here:

    ruff check --select F,E9,B buildS2Boards.py buildDockRowBoards.py buildS3bBoards.py buildS4aBoards.py doneRowCss.py pruneCss.py

Result: `All checks passed!`
