# Design review: iOS batch 1 (recipesCard, recipesScroll, collScroll)

Author: UI Designer, EVALUATE mode, 2026-11-02. Source: `~/.local/state/kitchensink/shots/<lane>/ios/`. Boards:
`RecipesIphone390`, `HomeIphone390`. Lanes 4 to 9 of the batch are not reviewed here yet.

## How the cap is judged (corrected 2026-11-02)

C-1 has no single fix: each lane moves its own plain `Text` leaves to the design-system `Text`. So each lane is
judged at the cap on its own text only. The whole screen at the cap is judged once, on the integrated head, before
the PR. Text from other lanes that still grows in a lane's shots is not that lane's finding.

## recipesCard: 1x passes with two fixes

Passes: the list row (gradient thumb with the photo disc, wrapped title, "time · difficulty · rating" meta,
"Created 2h ago"), the Home heading "Your recent recipes", and no cover time chip.

1. **No calorie figure.** The owner kept calories on cards (`designAnswers.md`). The meta line has none. If the seed
   recipes have no nutrition, show the ADR-0079 unavailable form, or seed one recipe that has nutrition, so the
   shot proves the figure.
2. **Phone grid is one column.** A 343 pt grid with one full-width tile repeats the list with a large empty cover.
   Below a 600 pt container the grid uses two columns of the compact tile, as Home does (buildSpec §4.2).
3. The cap shots show no card at all. After the rebase, retake them scrolled to the cards.

## recipesScroll: fix needed

1. **The search does not pin.** In `RecipesScrolledIphone390_light_1x` the header is gone and no search field sits
   at the top. The search must slide up and stop at the top while the list scrolls.
2. **`SearchPinned_*_kbOpen` is not pinned.** It shows the list at its top, so it proves nothing. Retake it scrolled
   down, with the keyboard open and closed.

## collScroll: fix needed

**The title and the segments stay fixed.** At the cap, "Recipes" and My recipes / Collections hold their place
while the empty state scrolls under them. (Corrected 2026-11-02: Collections does have a search field, so it pins on the band like Recipes.) The whole header
scrolls away with the content (`designAnswers.md`, the Recipes tab ruling). At 1x the empty state passes.

## Lanes 4 to 9

### recipeDetail (slice 1): fix needed

1. **No-photo hero shows the monogram and the cuisine.** The ruling is the gradient only, with no letter, no word
   and no disc.
2. **Screen on is a separate outlined button with a caption.** The board puts it in the text-action row, after Save
   a copy or Edit recipe: a quiet action with the sun glyph and the switch role, and no caption.
3. Passes: the rating card with "Not yet rated" and "Rate this recipe", the eyebrow, the wrapped title, the byline,
   the fact tiles and "Save a copy".
4. Not this slice: the steps and the nutrition block are still the old layout (slices 3 and 4).

### profileLane: one fix

1. **Long values wrap inside the word.** "@test_local_erasure01_clerk_tes / t" breaks off one letter. When a row's
   value does not fit on one line beside its label, the row stacks: the label on top, the value under it, start
   aligned. This adds to the 280 pt rule in `designAnswers.md`.
2. Passes: the header with the disc and @username (T8), and the Display name, Username and Email rows (S2).

### sheet: one retake

1. The New collection sheet passes at 1x: handle, title, close, fields and the full-width primary.
2. **`SheetDiscardDialog` shows no dialog.** It is the Collections empty state. Retake it with the dialog open.

### textCap2 and textcap3: findings in their own files

1. **Sort sheet title truncates ("Sort recip…").** A sheet title wraps and never truncates.
2. **Editor at the cap:** the bar title "New recipe", the section index "Details", the H2 "Details" and the
   subhead "About the recipe" all grow past their caps. If these are this lane's files, cap them. If not, name the
   lane that owns them.

## recipesScroll retake (SearchPinnedScrolled, Android PinPinned)

The pin works on both platforms, with the keyboard open and closed. One fix: the pinned field floats on the cards,
so card text and edges show above and beside it. Put it on the canvas band in `designAnswers.md`. Also blocking:
the `RecipesMaxUpdateDepthCrash` shots show "Maximum update depth exceeded" on the Recipes tab. The lane cannot merge
until that crash is gone.

## recipesScroll band retake

- The band passes: flat canvas from the top of the screen, the hairline only while pinned, nothing showing around
  the field.
- **List gap:** in `SearchPinnedScrolled_kbClosed_light_1x` a blank area of about one card and a half sits between
  Oaxacan Chickpea Stew and Sicilian Chickpea Stew. A list must never show an empty slot while it scrolls. Find the
  cause (a recycled cell or a layout jump) and show a clean scroll.
- **Grid at the cap:** two columns break titles inside words ("Sicil / ia…"). Use the column rule in
  `designAnswers.md`: one column below 320 pt of width per unit of capped scale.
- The grid at 1x passes, with two columns and "Edited". The version badge, the cover time chip and the truncated
  titles in these shots are the old card, which the card lane replaces.
