# Designer answers for the Tamagui port

Each answer is the design ruling a port builds to. Newest first.

## 2026-11-02: calories, covers, sheets, buttons, shadows and the add field (asked by Nova Squad)

- **Calories stay on cards (owner, 2026-11-02).** This replaces "nutrition" in the dropped-fields ruling above. Keep
  the ADR-0079 calorie figure on every card, Home included. It is plain text at the end of the meta line, after
  the rating: "35 min · Medium · ★ 4.8 (12) · 520 cal". On a compact Home tile it follows the time. Its loading and
  unavailable forms stay as they are, in the meta line's style. I add it to the card boards.
- **No-photo band on recipe detail:** the gradient only, with no photo disc. On a page-wide band, a picture glyph
  reads as "image failed". Cards and thumbnails keep the disc.
- **Byline:** "by {display name}" on other cooks' recipes only, until recipes carry a handle.
- **Night greeting:** keep the code's 22:00 to 04:59. My 00:00 was a slip.
- **Muted text and dividers on inverse surfaces:** derive them from `inverseInk` at alpha, like press fills. A test
  must hold muted text at 4.5:1 or more on the inverse surface. No new roles.
- **Home widget heading:** 24 above and 8 below. I fix the board's 28 and 10.
- **Button radius tokens:** approved as named: `controlSm` 18, `controlMd` 22, `controlMdTouch` 24, `controlLg` 26.
- **Pressed fill:** an instant change is fine. The press scale already gives the motion.
- **Sheet drag:** only the handle and the title row drag the sheet. A drag that starts in the content scrolls it or
  edits it, and never moves the sheet, so a cook cannot dismiss a form by accident. If Tamagui 3.1.9 cannot do
  this, tell me before building.
- **Sheet exit:** both platforms slide out with the one spring. Reduce motion makes it instant.
- **Shadows in dark mode:** one set serves both schemes. In dark mode, depth comes from the lighter surface tone, not
  the shadow. No scheme-aware tokens.
- **Android 7 and 8:** the Material fallback is accepted, with `lg` 5 and `xl` 7.
- **SectionIndex gaps:** 4 (`$1`) for all three.
- **Add by name with a shared memo:** no new step. The add field already makes the cook pick the food from the list
  (buildSpec 7.5.3). Show the memo's food as the first option with a `caption` "Suggested". It is never the active
  option when the list opens, so Enter alone does not pick it. Web and mobile alike.

## 2026-11-02: card, Home header and Recipe detail build questions (asked by Nova Squad)

- **Card padding and thumb:** the board's 10 and 84 are off the spacing scale, so the board is wrong. Build 12 and
  80 with the existing tokens. The thumb uses the existing `md` radius. I fix the boards.
- **No-photo cover:** change the shared `RecipeCover`, so every place without a photo shows the same sky-to-cream
  gradient with the photo disc. One placeholder, not two. Reviews check each place that uses it.
- **Night greeting:** keep "Still up?" and "Still up, {name}?" for 00:00 to 04:59. The board draws only the morning.
- **Greeting role:** `cardTitle` as it stands, with no override. I fix the board's 16/24 at 500 to the role.
- **Condensed bar on Home:** remove it. Home is a top-level page, its title is small, and the tab bar already says
  where you are.
- **Profile button on web Home:** show it at every width, as `HomeWeb1280` draws it.
- **"8 comments" row:** leave it and its divider out until comments ship.
- **"Start cooking":** this branch has no cooking mode, so leave the button out until it ships. The text actions
  stay: "Edit recipe" on your own recipe, "Save a copy" on someone else's.
- **Rating:** the rating card holds all of it. Your own recipe: the summary and "Only other cooks can rate your
  recipe." Someone else's: the summary and "Rate this recipe" with its stars. Remove the lower rating section.
- **Fact tiles:** all three use `cover-steel`, as the board draws them.

## 2026-11-02: recipe card status, fields and the floating button (asked by Nova Squad)

- **Where status goes (corrects ruling b in `reviews/mergedUiAndroid1.md`):** ruling b covers the list row only
  (Recipes on phones and web 390). There, Private, Draft and Pro are pills in the pills row before "Edited 2d ago".
  Every grid tile (Home, and Recipes on iPad and web) keeps its status as a chip on the cover, top-start, as the
  boards draw it.
- **Pro:** no board draws it yet. In the list row it is a pill after the status pill, so the order is Draft or
  Private, then Pro, then "Edited". It uses the `pro` tone, so it reads apart from visibility. Its box is the
  board's pill box: 24 high, radius 8, 14/500. On a tile it is a second cover chip after the status chip. If the
  chips do not fit on one line, the second one moves whole to the next line.
- **Fields dropped on every card:** servings, cuisine, nutrition, the tags line, the version badge and the cover time
  chip. The time shows in the meta line instead.
- **"Edited" on tiles:** Recipes tiles show it and Home tiles do not. This is intended. Home is already the recent
  list, so the time adds nothing there.
- **Difficulty:** plain text in the meta line ("Medium"). Cards do not use `DifficultyBadge`.
- **Neutral pill fill (replaces the neutral edge in `reviews/slice1b.md`):** the board wins. A neutral status pill is
  `surfaceMuted` with a transparent 1 pt edge, so every tone keeps one height. The word carries the meaning, so the
  fill needs no 3:1 against the paper card. Make the change once, in the shared `StatusBadge`.
- **List row:** build the board's measures. Padding 10, thumb 84 at radius 12, the title in the display face at
  16/24 and 600 that wraps, the no-photo gradient with its disc and photo icon, and "Edited" that wraps and never
  truncates.
- **Floating button height:** the native pill grows with its label. 56 is the minimum, and the vertical padding stays
  the same, so the height is 56 + 20 x (min(scale, 1.5) - 1). That is 66 at 1.5x. The end room is that height + 16 +
  16, which is 98 at 1.5x.
- **The collapsed disc:** it stays 56 x 56 because it holds no text. The end room always uses the extended height, so
  the list foot does not jump when the button collapses.

## 2026-11-01: TextLink (asked by Thing 1)

- **Leaving the app:** every link that opens outside the app draws a trailing ↗, as `DataSourceCard` does, hidden from
  screen readers. Its accessible name says it opens in the browser. That includes the recipe source host. The detail
  mockup's own source line is "Adapted from <recipe>", which stays inside the app and takes no ↗.
- **RecipeVisibilityField's text action:** `label` (14 px, weight 600) in `$actionText`. That is the web's semibold
  `meta` exactly, so web and native match.
- **Press feedback:** a link that stands alone as a control press-scales like a button (0.98, or opacity 0.85 under
  reduced motion). A link inside running text uses the opacity feedback only, because scaling it moves the words
  around it. Use PressScale's closed feedback option for that.

## 2026-11-01: the Google button label on iOS, corrected (asked by Thing 1)

Thing 1 measured Apple's button at all twelve iOS text sizes. Its label does not grow, and its font comes from the
button's height (about 21 pt SF Pro), so it is larger than any role on our scale.

- Do not chase Apple's size. A 20 or 21 pt label breaks the type scale (14, 16, 18, 28), and it would make the
  Google label larger than our own Sign in button below it.
- The Google label uses the same type role as our own `Button` labels, so both of our sign-in buttons read alike. On
  iOS it stays at that size and does not grow, like Apple's. On Android it follows the 1.5x chrome cap.
- The pair matches in height, width, corner radius, outline and centred icon and label. A difference in letter size
  between Apple's system font and ours is accepted.
- This replaces M-1 in `reviews/deviceShots2.md`.

## 2026-11-01: Home error actions and the wrapped "See all" (asked by kitchensink-5f)

- **A failed widget offers Try again.** Every error state needs a way forward. When a widget's code or render fails,
  show the same message with a Try again button under it, and Try again loads the widget again. How to rebuild the
  failed lazy load is the architect's call. Do not ship a no-action state or a whole-Home reload in its place.
- **While Try again loads the widget:** the block's header ("Recent recipes" and "See all") stays, and the body shows
  the block's normal loading skeleton, the same as a first load. Never a blank block. Screen readers hear the
  loading state through the block's live region, and focus moves to the block's heading so it is not lost.
- **"See all" under its title:** when the row wraps, the link's text lines up with the title's left edge. Its touch
  target stays at least 48 pt tall. Any side padding sits on the right, not the left.
- **Web "See all":** its target stays 44 px tall, the web shell's floor; 48 is the native figure. The text lines up
  with the title, but the hover fill and focus ring extend 12 px past the text on both sides (a negative start margin
  of 12 with 12 padding), so they never hug the text.
- **The floating button over scrolling content** is expected. The 88 pt end room only guarantees that the end of the
  content can scroll clear of it.
- **Recipes tab:** its error and empty states get the same 88 pt end room as its cards.

## 2026-11-01: active tab weight and icon-only segments (asked by Thing 1)

- **Active tab:** no new role. An inactive tab label is `caption` (14 px, weight 500). The active label is `label`
  (14 px, weight 600). Both roles already exist and share a size, so only the weight changes. The active tab also
  keeps its colour and indicator, so weight is never the only signal.
- **`labelVisibility: 'hidden'` on the segmented control:** it stays. The "no icon-only mode" rule forbids switching
  to icons when the text size grows. A control that shows icons only by design keeps that, and each segment still
  needs an accessible name.

## 2026-11-01: label and value rows at large text (asked by kitchensink-87)

- **When a row stacks:** decide by room, not by scale alone, as the recipe detail page does. A label and value row
  stacks when its content width divided by the capped font scale is below 280 pt. On a 390 pt phone with 16 pt sides
  that happens a little above 1.25x. On a tablet it does not happen at the cap. A scale-only rule would stack rows
  on a wide tablet that has room.
- **Gap when stacked:** 4 pt (`$1`). A label and its value are one group, so they sit closer than the 12 pt between
  rows (spec §1.6).
- **Web:** the same rule, with a container query at 17.5 rem (280 px at the default size), so it follows browser
  text size.
- **Applies to:** `ProfileFactRow` and `ProfileRow` ("Display name"), and any later row with a label beside a value.
  The label never breaks inside a word, and the value wraps, never truncates.
- **Page-end padding:** every page-end `pb-10` (40) becomes `pb-12` (48): `RecipeVersionList`, its error and
  skeleton, and `DataSourcesPage`. One end padding for every page.
- **Native detail `paddingBottom: 120` (corrected):** recipe detail has no pinned bottom bar, and the tab bar sits
  below the scroll view and owns the bottom safe area. So the page end is the same 48 pt (`$7`) as the web, on recipe
  detail and on `CollectionDetailScreen`. A screen whose content a floating control covers (for example the "New
  recipe" button) instead ends with that control's height, its margin and 16 pt, computed, not a fixed number.
- **Room under the floating "new" button on the web:** 88 px, like native (button 56, its margin 16, then 16).
  The web's 104 (`+6.5rem` in `HomeChrome` and the `globals.css` scroll padding) is a drift; their own comments say 88. Compute it once from the shared constants as a generated theme variable, and use it in all three places
  (`HomeChrome`, the scroll padding and `BackToTop`). If the button sits above the bottom safe area, add
  `env(safe-area-inset-bottom)` to the same variable, not a larger fixed number.
- **Content width** in the stacking rule means the page column: the window less the page gutter.

## 2026-11-01: Home and Profile text, and two off-scale steps (asked by kitchensink-87)

- **Recipe detail bottom padding:** `DETAIL_ARTICLE`'s `pb-10` (40) becomes `pb-12` (48). The end of the page gets
  more room than the 32 between sections, so the page reads as finished.
- **Timer chip padding:** the 2 pt vertical padding stays on web and native. A compact control's inner padding comes
  from its height, like the badge box, not from the spacing scale.
- **ProfileHeader failed-read line:** use `body` on native, like the web. `sectionTitle` makes an error line look
  like a heading.
- **HomeWidgetErrorNotice:** no change. `meta` and `text-body-sm` are both 14 px at weight 400.
- **SubscriptionNudge:** the copy is `meta` on both platforms, so the web replaces the raw `text-sm` with the
  `meta` role. The web title moves onto the `cardTitle` role, which is the same role as the native title.
- **ProfileFactRow:** the value sits at the END of the line, as the web's `text-end` does. In a right-to-left
  language the end is the left. Make sure that native right alignment flips in a right-to-left layout. If it does
  not, align the value to the end in a way that flips. At large text, the value stacks under its label (see
  `reviews/androidShots1.md`).
- **ProfileHeader name:** no change. The web's `overflow-wrap: anywhere` breaks only a word too long for the line,
  and native text already does the same.

## 2026-11-01: recipe detail section gap (asked by kitchensink-87)

- The gap between the detail page's sections is 32 pt (`$6`) on both web and native, in one column and in two.
  It replaces the 40 pt and 64 pt I named in `reviews/detailLeaves1.md`.
- 40 is not on the design spacing scale (0, 4, 8, 12, 16, 24, 32, 48, 64, 96). The web's `gap-10` came from
  Tailwind's default scale, so the web changes to `gap-8` (32 px). Do not add a 40 step.
- The redesign board for recipe detail stacks its sections 32 apart, so 32 is the design value.
- State it as one gap in one place, not as a smaller gap plus a margin.

## 2026-11-01: how far each type role grows with the system text size (asked by Thing 1)

The shared `Text` now scales text itself. Growth is not the same for every role:

- Display and chrome roles grow to 1.5x at most: `largeTitle`, `sectionTitle` and `barTitle`. At the cap a
  `largeTitle` is 42 pt, not 56.
- Every other role grows linearly to the 2x cap: `body`, `readingBody`, `cardTitle`, `meta`, `list`, `label`,
  `caption` and `figureStat`.
- The reason: large text needs less help, and Android 14 and iOS both grow large styles less than small ones. A
  56 pt title fills a phone screen and pushes the content down, which goes against the owner's rule against
  oversized UI. Reading text keeps the full 2x, because that is the text people enlarge to read.
- Residual risk: WCAG 1.4.4 asks for text that can grow to 200 %. A title that stops at 1.5x is already large text,
  and the platforms make the same trade. If an audit reads 1.4.4 strictly, this ruling is the one to revisit.

## 2026-11-01: tab bar and segmented control labels (asked by Thing 1)

- Navigation chrome (the bottom tab bar and segmented tabs that switch views) caps its labels at 1.5x. The rest of
  the screen keeps the 2x cap.
- A label never breaks inside a word and never truncates.
- A test proves it: for every locale, the longest label fits on one line in its slot on a 360 pt wide screen at the
  chrome cap. If a label does not fit at 1.5x, lower the cap to the largest scale that fits, but not below 1.3x.
  Below that, shorten the copy.
- Keep each accessible name. Do not hide the labels and show icons only.

## 2026-11-01: native recipe detail (asked by kitchensink-87)

1. **Hairline.** Use two tokens, not one.
    - A divider or rule between sections (the stat strip, `SectionSwitch`) is a true hairline. Add a design-system
      token for it with the value of `StyleSheet.hairlineWidth`. This keeps today's look.
    - The outline of a control (badge, field, chip) stays 1 pt, as `BADGE_BOX` already uses.
2. **Caveat lines.** Do not add a role. The web caveat is `text-meta font-medium text-ink`, which is 14 px at weight 500. That is the `caption` role. Use `caption` with `$ink`. Native weight 600 was a drift from the web.
3. **Rating figure.** Keep it at regular weight, like the web's `meta` with tabular figures. I agree with a `figures`
   variant on `Text` that sets tabular, lining figures and keeps the role's own weight. `figureInline` stays for
   figures that the copy stresses, such as ingredient amounts.
