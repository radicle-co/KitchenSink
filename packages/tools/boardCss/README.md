# @kitchensink/board-css

Reads a screen board (`*.dc.html`) and removes the CSS rules no element of the board uses.

- `src/boardReading.ts`: `readBoard(html)`, the one definition of a used class. The dead-selector guard in `repoGuards` and
  the pruner both read through it.
- `src/deadClassSelectors.ts`: the classes a board's `<style>` selects that nothing uses.
- `src/pruneDeadClassRules.ts`: removes a rule that cannot match because it needs a dead class, by source offset. It keeps
  any selector that names a dead class only inside `:not()` or a list with a live item, and never removes `@layer`.
- `bin/pruneBoards.ts`: `npm run prune --workspace=packages/tools/boardCss -- [--check] <board>...`. Exit 0 clean, 1 a dead
  class is kept (or `--check` would change a board), 2 bad arguments or an unreadable file.

The board builders call it through `docs/design/uiRefreshWorkshop5/redesignCanvas/boardPrune.py`.
