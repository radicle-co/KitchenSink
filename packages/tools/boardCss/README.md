# @kitchensink/board-css

Reads a screen board (`*.dc.html`) and removes the CSS rules no element of the board uses.

- `src/boardReading.ts`: `readBoard(html)`, the board's `<style>` blocks and its set of used classes.
- `src/deadClassSelectors.ts`: the classes a board's `<style>` selects that nothing uses.
- `src/pruneDeadClassRules.ts`: removes a rule that cannot match because it needs a dead class, by source offset. It keeps
  any selector that names a dead class only inside `:not()` or a list with a live item, and never removes `@layer`.
- `bin/pruneBoards.ts`: `npm run prune --workspace=packages/tools/boardCss -- [--check] <board>...`. Exit 0 clean, 1 a dead
  class is kept (or `--check` would change a board), 2 bad arguments or an unreadable file.

A board needs a doctype: without one the browser reads class names without case, and a used class can be missed.
