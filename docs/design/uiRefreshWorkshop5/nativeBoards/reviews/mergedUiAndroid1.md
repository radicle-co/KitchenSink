# Design review: merged UI on Android against the boards (fix/ingredient-matching at aafb83956)

Author: UI Designer, EVALUATE mode, 2026-11-02. Source: `~/.local/state/kitchensink/shots/mergedUi/android/`
(32 shots). Boards: the published mobile canvases, rendered from the current board source. I compared Home, Recipes
and Recipe detail at 1x and 2x. Profile is not compared yet.

## Verdict: does not match the boards. The pieces are ported; the screens are not the redesign yet

The text roles, caps and colours that were ported are right. But Home, the Recipes card and Recipe detail still use
the old layout, so most of each screen differs from its board. Matching the boards is a build of the redesign
(`buildSpec.md`), not a set of small fixes.

## Rulings on the five 2x findings

- **a. "Private" truncates.** A badge label never truncates. Fix it once in the shared `StatusBadge`
  (`@commise/ui`): no width limit that cuts the word. When the row has no room, the row wraps and the badge moves to
  the next line whole.
- **b. A badge covers the cover letter.** Match the board: a recipe card's cover carries no badge. Status badges
  (Private, Draft, Pro) sit in the card's meta row, before "Edited 2d ago". This replaces the 1x cover mark in M-1
  option A. "Pro" is a meta-row badge like the others.
- **c. Titles truncate.** A recipe title never truncates. It wraps to as many lines as it needs, as the boards show.
- **d. The floating button covers card text.** Expected while scrolling. Its label follows the 1.5x chrome cap. The
  list's end room is the button's drawn height at the current text size, plus its margin, plus 16, computed, so the
  last card clears it at every size.
- **e. "Clear search" under the floating button.** The no-match and empty states get the same computed end room.

## Differences from the boards (each one must be built to the board)

### Recipes (`RecipesAndroid384`)

1. Card meta: the board shows time · difficulty · rating on one line, then the status badge and "Edited 2d ago".
   The app shows cuisine · time · servings, a rating line with a globe or lock icon, no difficulty and no edited time.
2. Visibility: the board shows a "Private" badge, and nothing for public. The app shows a globe or lock icon.
3. Account button: the board shows the person's initials ("ER"). The app shows a generic person icon.
4. The board labels the cuisine chips "Filter". The app has no label.
5. Accepted difference: the board has a fourth tab, Meal plan. It is not built yet.
6. Board error, not the app's: the board draws 32 pt sides. The app's 16 is right (T31). The board is being fixed.

### Home (`HomeAndroid384`)

1. Header: the board puts "Good morning, Eliza" (section title) and the date on one row with the initials button on
   the right. The app shows a separate row with the button, then a 28 pt title "Still up?" with no name.
2. Section title: the board says "Your recent recipes". The app says "Recent recipes".
3. Date: the board shows "Sunday 25 October", with no year. The app shows "Sunday, November 1, 2026". Follow the
   locale's order, but drop the year for the current year.
4. Accepted difference: the board shows Today's nutrition, Pick up where you left off and meals this week. Those
   features are not built, so the "Coming soon" block stands in for them.
5. The shot shows the loading state. A populated Home shot is still owed.

### Recipe detail (`RecipeDetailAndroid384`)

The app's layout is the old one. The board's order, top to bottom: photo hero with paging dots, a rating card
("4.8 · 12 ratings", "Only other cooks can rate your recipe", "8 comments"), cuisine, title, "Public · Version
history", "Adapted from …", three tinted fact tiles (Total, Prep, Difficulty), a full-width "Start cooking" primary
button, "Add to plan" and "Edit recipe" text actions, the "Screen on" switch, the description with "Read more", tags,
the "Before you start" card, a Nutrition row, the Ingredients card with the scaler, and step cards with timers.
The app has: a cover strip, one white card of three times, a filled "Edit recipe" button, a description, and an
Ingredients / Steps / Nutrition tab strip with a round screen-on button. Rebuild the screen to the board.
