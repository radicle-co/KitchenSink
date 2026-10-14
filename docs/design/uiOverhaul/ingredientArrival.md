# After a food is picked, the new row stays in view

staff-ux-engineer SPECIFY, 2026-10-13. Reasoned from the code. Nothing was seen rendered or run on a device.

## The defect

When the ingredient list opens, the reveal moves the add field to the top of the visible area. Only
`REVEAL_GAP_DP` stays above it (`ui/src/fieldReveal/fieldReveal.ts`, `revealTarget`). A pick closes the list and adds the
row straight above the field (`GroupFoot`, `form/RecipeIngredientsFields.native.tsx`). The field holds its place, and
the new row ends up above the top edge. Nothing in the code asks for the new row to be shown.

## Behavior

1. Focus stays in the add field, and the field empties. This is the existing loop in `trailingEntryField.ts`.
2. The new row and the field show together, with the smallest scroll. The area runs from the new row's top to the
   field's bottom, with `REVEAL_GAP_DP` at each edge.
    - If the area is in view, nothing scrolls.
    - If the row is above the top edge, the row's top goes one gap below the top.
    - If the field is below the bottom edge, the field's bottom goes one gap above the bottom.
    - If the area is taller than the visible space, the field wins (WCAG 2.2 SC 2.4.11). Its bottom goes one gap above
      the bottom, and as much of the row as fits shows.
3. It runs on a settled commit with `target.kind === 'newLine'`, `outcome.kind === 'committed'` and
   `!rowEditor.movedPast` (`hooks/useLineCommit.ts`, `hooks/lineCommit.ts`). It is keyed on `outcome.key`, so it fires
   once per pick. It checks at the row's layout and at each change of the visible area's size, because the keyboard
   can rise after the field remounts. It never re-checks on a content resize (rule P2). It scrolls at most once.
4. The new row's background is `selectedFill` until `movedPast` turns true (the cook types, picks again, uses Change
   food or cancels). There is no timer and no motion. The tint is visual only: no `aria-selected` and no text change.
   Web clears it with `motion-safe:transition-colors duration-150`. Native snaps it off. Measured contrast on the tint
   clears 4.5:1 for every text color the row uses, in both themes (SC 1.4.3).
5. No entry animation. The scroll is the motion.

## States

| State                                        | Behavior                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Keyboard up (native)                         | The visible area is the scroller's `onLayout` height, which ends at the keyboard or bar. |
| Keyboard down                                | The same rule. Usually nothing scrolls.                                                  |
| Long list, group foot                        | The row is the last of its group, straight above the field. No change.                   |
| First ingredient (the field remounts)        | The new field instance sees the same key and reveals once the row has laid out.          |
| Landscape, or a row taller than the space    | The field wins.                                                                          |
| Reduced motion                               | The scroll is instant. The tint is unchanged.                                            |
| Pick in flight, and the cook types meanwhile | No scroll and no tint, so the field is not pulled away mid-word. The sentence is spoken. |
| `UNRESOLVED` pick                            | Reveal and tint, so the row's attention line shows.                                      |
| Failed pick or conflict                      | No row, so no scroll. The existing failure text.                                         |
| Create my own food                           | The scroll runs behind the sheet. When the sheet goes, focus moves to the row's `⋯`.     |
| Paste a list, Change food                    | Out of scope.                                                                            |
| 320 CSS px (web)                             | No new width, so no horizontal scroll (SC 1.4.10).                                       |

## Accessibility

No new string. The existing polite sentence (`settledMessage` → `rowCommittedMessage`, `form/rowCommitMessage.ts`)
already says what was added. The screen-reader cursor stays in the field. The scroll and tint announce nothing.

## Where it belongs

- New `ui/src/fieldReveal/spanReveal.ts`, pure: `spanTarget({ top, bottom, offset, viewport, keep })` returns the
  scroll offset. It returns `null` if the area already fits. The result is never below 0.
- Native: `RevealRequest` in `fieldRevealContext.ts` gains required `kind: 'list' | 'arrival'` and `above: number`.
  `useFieldRevealHost.native.ts` handles an `arrival` with `spanTarget` and never lays out the blank space.
  `Combobox.native.tsx` gains `arrival?: { key; aboveDp }`. No new ref: the field's existing ref is measured, and the
  row reports its height through `IngredientRow`'s `onLayout`.
- Web: `ScrollHost.tsx` gains `revealSpan(topId, bottomId)`. It reads both positions, takes the window height less
  the document's `scroll-padding`, runs `spanTarget` and calls `window.scrollTo` with `jumpBehavior()`. It never calls
  `focus()`. The row's `<li>` gains an id from `ingredientRowId(key)` in `form/fieldIds.ts`.
- Shared: `useIngredientsFields.ts` exposes `arrival: { key } | undefined` from rule 3. Each leaf passes it to its own
  platform's mechanism, marked `PLATFORM-FORK`, and tints the matching row.

## Tests, written first

- `spanReveal.test.ts`: fits, row above, field below, too tall (the field wins), row wins, the clamp at 0.
- `useFieldRevealHost.native.test.tsx`: an arrival scrolls once, never on a content resize, re-checks on a viewport
  resize, animates only if `reduceMotion === false`, and never lays out the blank space.
- Web `ScrollHost` test: honors `scroll-padding`, scrolls instantly under reduced motion, never focuses.
- Component tests for both leaves: the trigger fires only for a committed `newLine` pick, the tint clears on typing,
  nothing happens for a failed pick, a conflict, paste or Change food, and focus stays in the field.
- Playwright: a short viewport, two picks, then `toBeInViewport` on the new row and the field.
- Maestro: a long list with the keyboard up, a pick, then `assertVisible` on the new row's text.

## Open checks

- Web: browser scroll anchoring can already keep the field steady, and then the row hides under the sticky header.
- Device: the Combobox module doc warns that a programmatic scroll can blur the field. On Android and iOS, make sure
  that the scroll after a pick does not drop the keyboard.
