# Design review: floating button end room (fix/im-fabroom, rulings d and e)

Author: UI Designer, EVALUATE mode, 2026-11-02. Source: `~/.local/state/kitchensink/shots/fabRoom/` (iOS 1x and
cap, Android 1.0, 1.5 and 2.0). I checked Recipes end, no match and Home foot on both platforms.

## Verdict: passes for the end room

- The last card ends clear of the button at every scale I checked, on both platforms. At Android 2.0 the label
  grows and the room grows with it.
- "Clear search" sits clear above the button on the no-match state.
- Home's foot clears both the extended pill and the collapsed disc.

Out of scope here: the iOS header text (C-1 in `mergedUiIos1.md`) and Home's condensed bar, which the Home header
lane removes.

Still owed before merge: Android first run, and the Collections-end and no-match shots that QA is rechecking.
