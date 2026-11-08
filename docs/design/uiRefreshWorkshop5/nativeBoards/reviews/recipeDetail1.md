# Design review: Recipe detail slice 1 on iOS (fix/im-recipedetail at d83445ab2)

Author: UI Designer, EVALUATE mode, 2026-11-02. Source: `~/.local/state/kitchensink/shots/recipeDetail/ios/`
(OwnScreenOff, OwnScreenOn, OtherCook; light and dark, 1x and cap). Board: `RecipeDetailIphone390`.

## Verdict: 1x passes with one fix; the cap needs two layout fixes

Passes: the no-photo band with no letter or word, the rating card for your own recipe and for another cook's, the
eyebrow, the wrapped title, the byline, "Edit recipe" or "Save a copy" with Screen on in one text-action row, and
the Screen on state (an outline sun when off, a filled sun when on).

## Findings

1. **Difficulty tile uses the badge.** It shows "●●○ Medi…" in a white chip, cut off. The board and the card
   ruling use plain text: "Medium", in the tile's value style. A value never truncates.
2. **Fact tiles at the cap break words** ("Difficu / lty", "55 / min"). Tiles stay three across only while each
   tile's width divided by the capped text scale is at least 100 pt. Below that they stack, one per row, with the
   label at the start and the value at the end. Use the same shared column function as the grids.
3. **Status row at the cap leaves a dangling separator.** "Public ·" ends one line and "Version history" starts
   the next. When the row wraps, the "·" goes with the item after it, or is dropped at a line start. It never ends
   a line.

Not shot, judged on the integrated head: Screen on ON at the cap, the photo hero, a long title, the source line and
the note and variant rows.
