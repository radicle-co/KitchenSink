# Build lists: Home header and Recipe detail (native)

Author: UI Designer, 2026-11-02. For the build lanes after the Recipes card and floating-button lanes.

The boards are the design. Where `docs/design/uiOverhaul/buildSpec.md` disagrees with a board, the board wins. Board
sources (open them in a browser to measure):

- `~/.local/state/kitchensink/tablet/publish/home/homeMobile/project/HomeAndroid384.dc.html`
- `~/.local/state/kitchensink/tablet/publish/recipeDetail/recipeDetailMobile/project/RecipeDetailAndroid384.dc.html`
- The same names with `Iphone390` and `Ipad820` for the other two devices.

Send shots for review as usual: light and dark, at 1x and at the cap, with every difference and its reason.

## Home header (`HomeAndroid384`, top of page)

Use buildSpec §4.2 for states, focus order and keys, with these board changes.

1. One row: the greeting and the date stacked on the start side, the profile button on the end side, centered on the
   pair. Remove the separate button row and the 28 pt "Still up?" title.
2. Greeting: "Good {morning|afternoon|evening}, {first name}", role `cardTitle`, `ink`. With no name: "Good morning".
   It wraps. It is the page's heading (route focus target).
3. Date: role `body`, `inkMuted`. Weekday, day and month in the locale's order. No year in the current year.
4. Profile button: the person's initials in a disc, 44 pt target, name "Profile, {full name}". With no name, the
   `user` glyph (buildSpec §3.3).
5. Section heading: "Your recent recipes", role `sectionTitle`. "See all" with a chevron at the end, role `label` in
   `actionText`, name "See all recipes", 44 pt target (web ruling in `designAnswers.md`).
6. Top padding: 40 under the status bar, 16 sides. 28 above the section heading, 10 below it.
7. Compact recent cards: the status ("Private", "Draft") sits on the cover's top start, as the board draws it. This
   is the compact Home tile only. The full Recipes card keeps ruling b (status in the meta row, no cover badge).
8. Accepted difference: Today's nutrition, Pick up where you left off and meals this week are not built, so the
   "Coming soon" block stays.

Supersedes buildSpec §4.2: the greeting is `cardTitle`, not `largeTitle`. The date is `body`, not `meta`. The heading
is "Your recent recipes", not "Recent recipes".

## Recipe detail (`RecipeDetailAndroid384`)

Rebuild the screen in this order, top to bottom. Use buildSpec §6.3 to §6.7 for Screen on, tap-to-check, the current
step, delete, version history and states. Section gap 32, page end 48 (`designAnswers.md`).

1. Hero: the photo carousel, full bleed, paging chevrons at the sides, dots under it. Back and ⋯ discs on the hero,
   inside the safe area. No photo: the plain band (buildSpec §6.1 Hero).
2. Rating card: stars and "4.8" (`figures` variant) · "12 ratings" (`body`, `inkMuted`). Own recipe: "Only other cooks
   can rate your recipe." (`meta`, `inkMuted`). A hairline, then "8 comments" as a full-width row link with a chevron.
   Others' recipe: "Rate this recipe" in place of the own-recipe line.
3. Cuisine (eyebrow), then the title (`largeTitle`, wraps, never truncates).
4. "Public" or "Private" with its glyph · "Version history" link (`actionText`). A draft shows the Draft badge.
5. If the recipe has a source, show "Adapted from {source}" with the source as a link, then "by @handle" (`meta`,
   `inkMuted`).
6. Three tinted fact tiles in one row: Total, Prep, Difficulty. Label `caption` with its glyph, value under it. A
   missing time hides its tile. No Cook tile.
7. "Start cooking": primary, full width, when cooking mode (feature 008) ships. Until then, leave it out on both
   platforms (`designAnswers.md`, 2026-11-02, "Start cooking").
8. Text actions: "Add to plan" and, on an own recipe, "Edit recipe". Others' recipe: "Save a copy" in place of Edit.
   "Add to plan" is not built yet, so leave it out until meal plans ship.
9. "Screen on" switch row.
10. Description (`body`), clamped with "Read more" that expands in place. Tags as outlined, non-pressable chips.
11. "Before you start" card with Hide/Show: the time bar, hands-on / oven / rest, "About {total} from start to the
    table.", and the "Do first" list. If the recipe has no such data, leave the card out.
12. Nutrition row: "Nutrition" and "{n} cal per serving", expands in place to the four figures.
13. Ingredients card: "Ingredients" (H2) "for {n}" and the stepper at the end. Own recipe: an "Edit" chip under the
    heading. Group headings, tap-to-check rows, the amount in bold, the note in `inkMuted`.
14. Steps: H2 with "Edit" (own recipe). Each step is a card with a numbered circle. A done step shows a check and
    collapses to one line. The current step has the `actionText` outline and the label "You’re here" (board copy).
    Amounts in step text are bold. A timer is a chip under the step text.

Supersedes buildSpec §6.1 and §6.2 on phones: no `SectionSwitch` tab strip, no filled "Edit recipe" button, no
four-cell stat card, and steps are cards. The two-column body at 720 and wider follows the `RecipeDetailIpad820`
board.
