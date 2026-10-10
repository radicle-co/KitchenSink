# UI overhaul: final EVALUATE and web/mobile parity audit

⛔ **DESIGN AUDIT. NOT PRODUCTION CODE.** This file judges the finished overhaul at HEAD `f6edeb857` against
`ownerDecisions.md` (which wins), `buildSpec.md` and `darkTheme.md`. It reports findings. It changes nothing.

- **Mode:** EVALUATE. **Date:** 2026-10-09. **Agent:** `staff-ux-engineer`. **Next actor:** `fe-1` for feature code, and
  `staff-ux-engineer` for the fixes that belong in `packages/apps/commise/ui`.
- **Standing.** I wrote most of the specs this audit checks (`buildSpec.md`, `darkTheme.md`). I did not write the
  code. Where a finding says "the spec is wrong", it is marked as such and routed back to SPECIFY.
- **Seen rendered.** Every finding below was seen in a capture, and each one names it. Captures live in
  `.local-sandbox/uiAudit2026-10-09/` (gitignored). I wrote no claim from source alone without saying so.
- **Not user evidence.** This is inspection: heuristic evaluation, a WCAG 2.2 AA check by criterion, and parity
  against the spec. Nobody observed a user. Behaviour claims cite a mechanism or are labelled judgement.

## 1. Verdict

**The overhaul is a large step up. It is not finished.** The 2026-10-08 captures are the baseline. Since then,
the shell, the navigation, the cards, the editor model, collections and the delete dialog came close to the spec.
They are pleasant to use. Most screens have no horizontal scroll at 320 px, no axe-core violation of substance, and correct
roles in both themes.

It is not yet award-level, for four reasons the owner will see in the first minute:

1. **Dark mode breaks Home on both platforms.** The three "Coming soon" cards render as light glass with light
   text, about 1.1:1.
2. **Home still leads with the placeholders.** The owner ruled that recent recipes come first. On a phone, the
   first screen of Home shows no recipe at all.
3. **The front door shows a broken image** at 1024 px and wider.
4. **Two of the owner's named complaints remain.** "Wraps when it must not": My recipes' Sort control wraps
   to three lines at every web width. The detail stat strip wraps "5 h 30 / min" at desktop widths. The native
   amount column breaks "tablespo / on" inside a word. "Misaligned": pushed screens use a 32 px phone gutter, and
   top-level screens use 16. The web editor floats as an inset card.

Severity scale (Nielsen): **4** blocks release · **3** fix before release · **2** fix soon · **1** polish.

## 2. Method and coverage

| What                      | How                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Result                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Web, signed in            | Production build (`next start` on :3107), served with dead API origins so the e2e route doubles (`tests/e2e/utils/recipeApi.ts`, `foodApi.ts`) own every call. Fixtures with real and extreme content: a 86-character title, ranges, groups, a draft, a private recipe, no-photo recipes, five line states. Clock pinned to 2026-05-31 15:30 UTC, reduced motion on. Phones and tablets ran as `isMobile` + `hasTouch`, so coarse-pointer CSS applied. | 53 states × 320/390/768/1024/1440/1920 × light/dark where relevant: **422 captures** (viewport + full page each) |
| Web, signed out           | Sign-in, sign-up, 404 against the real Clerk dev instance.                                                                                                                                                                                                                                                                                                                                                                                             | 32 captures                                                                                                      |
| Web, error and offline    | A second pass that waits 25 s, because the client retries before it shows an error.                                                                                                                                                                                                                                                                                                                                                                    | 9 captures                                                                                                       |
| Web, +35% strings         | A rebuild with `COMMISE_PSEUDO_LOCALE=1`, `en-XA` at 320 and 1440.                                                                                                                                                                                                                                                                                                                                                                                     | 12 captures                                                                                                      |
| Before / after            | The same fixtures at 1280 light, against `.local-sandbox/uiAudit2026-10-08/`.                                                                                                                                                                                                                                                                                                                                                                          | 5 pairs                                                                                                          |
| Per capture, mechanically | Horizontal overflow. Short controls with text on more than one line. Targets under 24 px (fine) or 44 px (coarse). Clipped and truncated text. axe-core 4 with the `wcag2a/2aa/21a/21aa/22aa` tags plus `target-size`. Computed body colours as proof of theme.                                                                                                                                                                                        | `web/results.jsonl`, one JSON per capture                                                                        |
| Android                   | `ci_pixel6` (API 34) on `emulator-5556` only, the debug APK with Metro, against the local sandbox, through `npm run local:maestro` and a scratch capture flow, once per system theme.                                                                                                                                                                                                                                                                  | 34 light + 32 dark captures                                                                                      |
| iOS                       | **Not available locally.** Nothing here checks iOS 26 Liquid Glass (D12, D13, D14), the iOS edge swipe or the status-bar tap.                                                                                                                                                                                                                                                                                                                          | not checked                                                                                                      |

Corpus and sources consulted: `buildSpec.md` §0–§10, `darkTheme.md` §1–§3, `ownerDecisions.md`, WCAG 2.2
success criteria 1.3.2, 1.4.1, 1.4.3, 1.4.10, 1.4.11, 1.4.12, 2.1.1, 2.4.3, 2.4.11, 2.5.3, 2.5.8 (as stated in
`buildSpec.md` §10, the spec I am auditing against). Contrast values in this file are computed from pixels sampled
in the captures with the WCAG 2.x formula.

## 3. Findings, ranked

Each finding: what I saw · where · the criterion where one applies · the fix · whether the fix belongs in the
shared primitive.

### Severity 4: blocks release

**F1. Dark mode: the Home "Coming soon" cards are unreadable.** Both platforms, every width, dark only.

- Seen: `web/home/dark-1440.png`, `native/dark/ua_home_top.png`. The cards render as light glass (`#DBDCDB` on web,
  `#F6F6F6` on Android). Their titles stay `ink` dark (`#EDE9E4`): **1.14:1** on web, about 1.0:1 on Android. The
  week tiles are mid-grey boxes on light grey.
- Criterion: SC 1.4.3 (text 4.5:1), SC 1.4.11 (the tiles). Also D12: glass "never goes on cards".
- Cause: `PlaceholderWidgetCard.tsx` (web and mobile) wraps the card in `GlassCard tier="card"`, a translucent
  white tier that has no dark value.
- Fix: delete `GlassCard` from both placeholder cards and use the level-1 card (`paper`, 1 px `lineDivider`,
  `shadow-sm`). Then delete the `card` tier from `GlassCard`, so no card can be glass again. Add the placeholder
  to the colour-scheme guard that already covers the delete dialog (`tests/e2e/colorScheme.spec.ts`).
- Primitive: yes. Removing the tier makes the class unrepresentable.

**F2. Home leads with the placeholders, against the owner's ruling.** Both platforms, every width.

- Seen: `web/home/light-390.png` (first viewport: greeting, three placeholders, no recipe), `homeFirstRun/light-390.png`
  (the first-run "Add your first recipe" button sits below the fold), `native/light/ua_home_top.png`.
- Ruling: `ownerDecisions.md`, "Home shows recent recipes first … The required placeholders come after them";
  `buildSpec.md` §4.2.
- Cause: `features/core/src/roadmapWidgets.ts` gives the placeholders weights 1200–1400, above the recipe widget's
  1000, on the old mockup's reasoning ("Recent Recipes is last"). `roadmapWidgets.test.ts` pins that order.
- Fix: weights below 1000 for all three, the test rewritten to pin the new order, and the missing `Coming soon` H2
  with its one body line (`home.comingSoonHeading`, `home.comingSoonBody`, both missing today). Each card keeps a
  neutral "Soon" badge.
- Primitive: no. It is one shared table, so one edit fixes both platforms.

**F3. The sign-in photo is a broken image at 1024 px and wider.** Web, every theme.

- Seen: `web/signIn/dark-1440.png`: the start half shows the broken-image glyph.
- Cause, verified with `curl`: `GET /images/auth/authFood.jpg` answers `307 → /en/images/auth/authFood.jpg`. The
  middleware matcher excludes `public/`, but Next serves `public/` files at the root, so every static image under
  `/images/` is locale-redirected. The image optimiser then answers "The requested resource isn't a valid image".
- Fix: exclude static files from the matcher (a file-extension negative lookahead, or `images/`). Add a unit case
  to `tests/middleware.test.ts` for `/images/…`. Every future public image has the same defect until this lands.

### Severity 3: must fix before release

**F4. The section index says "complete" while rows say "Choose a match".** Web confirmed. Native sheet has the
same statuses (`native/light/ua_editor_sections_sheet.png`), but its seed had no unmatched line.

- Seen: `web/editorSectionSheet/light-390.png` shows ✓ Ingredients and "Ready to publish". The same recipe
  (`editorIngredients`) shows four rows with ⚠ "Choose a match" (2), "No match found" and "Couldn't look up".
- Spec: §7.2 "Ingredients … every line has a food", and the index and Publish "can never disagree".
- Cause: `validateRecipeForm` asks `isResolvedIngredientId` whether the line has an ingredient id. A line can hold
  an id while its food is `UNRESOLVED`, `NOT_FOUND`, `FAILED` or removed, so the validator calls it complete.
- Fix: read the line's food resolution in `sectionStatus.ts`. `NOT_FOUND`, `FAILED`, `UNRESOLVED` and a removed
  food give `attention` ("{n} need a match"). `AMBIGUOUS` gives `attention` too but stays publishable (R23).
- What decides it: whether the service refuses Publish for a `NOT_FOUND` line. "Use as written, without nutrition"
  exists, so a line with no food can be publishable on purpose. If the service accepts it, the index is right and
  the rows over-alarm (soften the row word). If it refuses, the index is wrong (fix as above). `staff-architect`
  confirms where the rule lives.

**F5. "Sort: Recently edited" wraps to three lines at every web width.** Web, 320–1920, both themes.

- Seen: every `recipes/*.json` lists `button "Sort: Recently edited"×3`; `web/recipes/light-320.png` shows no full
  card in the first viewport (spec §4.3: two at 320 × 568).
- Note: `buildSpec.md` §4.3 said "No Sort" until the API took a sort. The API now takes `sortBy`, so the control is
  legitimate. My spec line is stale and is withdrawn. The wrap is the defect.
- Fix: one line for the result bar. Count at the start, then a group (Sort, view switch) that never shrinks a
  button below its content and moves below the count as a group when there is no room. The visible label may
  shorten to "Recently edited" with the name "Sort: Recently edited" (SC 2.5.3).
- Primitive: yes. `buttonSurfaceClass` must stop a button shrinking below its label (`min-width: max-content`
  with `flex-shrink: 0`), so a flex row wraps between controls, never inside one. Discover's Sort fits only by luck.

**F6. Discover's rail cards have no cover.** Web, every width and theme. Android is correct.

- Seen: `web/discover/light-390.full.png`, `light-1440.png`: a 6 px strip where the 4:3 cover must be, and no
  "@handle" footer.
- Probable cause (unverified): the grid card's rows use `grid-template-rows: subgrid`. A rail track is a flex
  row, not a grid, so the rows collapse.
- Fix: in a rail, render the card as a standalone grid (its own row template), or give the track a grid parent.

**F7. The detail stat strip wraps and truncates at desktop widths.** Web, 1024–1920.

- Seen: `web/detailOwn/light-1440.full.png`: "5 h 30 / min" on two lines; "Medium" cut to "Me…".
- Spec: §6.1, values are `room`. The strip turns 2 × 2 below a 360 px strip. At 1440 the strip sits in a 435 px
  title column, so four cells get about 100 px each.
- Fix: the component query must switch to 2 × 2 below about 480 px of strip, not 360. **My threshold was
  wrong** and goes back to SPECIFY.

**F8. Type roles are broken on the recipe page and in sheets.** Web and native.

- The recipe title is Inter (`detailOwn/*`). Spec §1.5: the recipe title is Playfair `largeTitle`. Cause:
  `RecipeDetailBody.tsx:180` uses `text-large-title`, a utility that sets size and weight but no face. Fix: use the
  `largeTitleClass` the header primitive uses, or make the role carry its face.
- The servings value is Playfair (`ServingScaleControl.tsx:96`, `font-display`). Spec §1.5: Playfair never sets a
  number. The spec's `Stepper` primitive does not exist. The control is hand-built twice
  (`RecipeBasicsFields.tsx`, `ServingScaleControl.tsx`, plus native twins). Fix: build `ui/src/stepper/` once.
- Sheet and menu titles are Playfair on both platforms ("Sections", "Move to group", "Step 2", "More actions",
  "What must we call you?"). Spec: `barTitle`, Inter 17/600. "Community rating" is Playfair while every sibling
  H2 is Inter. Fix in the `Sheet` primitive title and `RatingSection.tsx:76`.

**F9. The recipe page drops ingredient groups.** Web (`detailOwn/light-390.full.png`): no "FOR THE LAMB" or "FOR THE
CHICKPEAS" overlines, though the editor shows both groups. Spec §6.1. Native not checked: its seed has no groups.

**F10. A recipe with no photo shows a broken-image glyph, not the monogram band.** Both platforms.

- Seen: `web/detailNoPhoto/light-390.png` (a 4:3 tinted box with a picture glyph, about 260 px tall);
  `native/light/ua_detail_top.png` (the same, and the box runs past the right edge).
- Spec: §1.8 and §6.7, the 96 px `RecipeCover` band with the monogram. A picture glyph reads as "the image failed".
- Fix: render `RecipeCover aspect="band"` on both platforms.

**F11. Web sheets on phones are full height, with a small primary.** Web below 840.

- Seen: `newCollectionSheet/light-390.png`, `editorSectionSheet`, `editorRowEditor`, `editorMoveSheet`,
  `editorPasteSheet`, `profileNameSheet`, `discoverFilterSheet`. Content-height sheets fill the screen, the primary
  is content-width at the bottom start, and New collection shows "Cancel" below 840.
- Native gets this right (`native/light/ua_newCollection.png`: content height, full-width primary).
- Spec: §5.1, §7.5.2, §1.11 `Sheet size="content"`.
- Fix: in the web `Sheet` primitive, honour `size="content"` below 840 and make the footer primary full width.

**F12. The ingredient amount column breaks words, and the cook's words change.**

- Web: "12–14 / tbsp" wraps in the 72 px column (`editorIngredients/light-390`). At 320, the name column is about
  110 px, so names truncate after one and a half lines (see F15, the double gutter).
- Native, after a paste: "2 tablespo / on" breaks inside the word (`native/dark/ua_paste_settled.png`).
- The cook typed "2 tbsp", "1 large onion", "a handful of coriander leaves". The rows show "2 tablespoon",
  "1 onions" and "cilantro" with no amount. Spec §7.5.3: "The amount and unit the cook typed are the cook's own
  statement. Nothing later overwrites them." The owner's tolerance ruling treats "1 large" as a fine measure.
- Fix: show the unit as stated (or its short form), never break inside a word in the amount column, and let the
  column grow to `min-content` up to 96 px. Ask `staff-architect` whether the display reads the cook's words or
  the parsed food name.

**F13. Discover shows the viewer's own recipes, including their drafts and private ones.** Android against the real local
services (`native/light/ua_discover.png`: "Shakshuka for two", Draft, in Trending and New. A Private recipe in a rail),
and web with a double that copies the service's scope.

- Each own card offers "Save a copy" of your own recipe. A draft also shows "⏱ 0 min".
- Not a privacy defect: `search/dal/search.dal.ts:491` adds `publishedOrOwnedBy(ownerId)`, so another user never
  sees a draft. The cause is the same predicate: it admits the owner's own rows into the public rails.
- Fix: the Discover rails ask for public, published recipes the viewer does not own (a browse flag on the search
  read), while a typed search may keep "public or mine".

**F14. The detail section bar overlaps itself at 320 px.** Web.

- Seen: `detailCookMarks/light-320.png`: the Screen on toggle covers "Nutrition". axe: `target-size`, 22 × 44.
- Criterion: SC 2.5.8 (24 × 24). With +35% strings the bar overflows the page by 47 px (`xaDetail/light-320`,
  SC 1.4.10).
- Spec: §6.2 says the three labels fit at 320 with the toggle icon-only. That held for English only.
- Fix: let the link row scroll inside the bar (it must never scroll the page), with the toggle pinned at the end.

**F15. Gutters and alignment differ between screens.** The owner's "misaligned".

- Pushed screens use a 32 px gutter at 390 (`detailOwn`, `versions`) where top-level screens use 16 (`home`,
  `recipes`). Spec §1.2: 16 below 600.
- The web editor floats as an inset card: 16 px side margins and a 24 px gap above the header at 390, 24 px at 768
  (`editorNew/light-390.png`, `light-768.png`). Native is full-bleed. Spec §7.1: the header is a sticky level-2 bar
  at the top edge.
- At 1440, the eyebrow back link, "Community rating" and "Version history" start 16–24 px inside the column edge
  the title and headings share (`detailOwn/light-1440.full.png`). A ghost button's inner padding is not offset.
- Fix: one gutter token per class for every screen. The editor frame without an outer card. Ghost text buttons
  that align their label, not their box, to the column (negative inline margin equal to their padding).
- Primitive: yes (`layout` and `Button variant="ghost"`).

**F16. The week strip scrolls sideways and is not keyboard reachable.** Web and native, Home.

- Seen: 3 days at 390 web, 4 on Android, a clipped seventh tile at 768.
- Criterion: axe `scrollable-region-focusable`, SC 2.1.1. Spec §4.2: `repeat(7, 1fr)`, "never clips at 320".
- Fix: seven equal tiles with narrow day names below `@regular`. This lands with F2.

**F17. "0" appears where the spec forbids it.** Android.

- Nutrition shows "0 / 0 g / 0 g / 0 g" for a recipe whose lines count nothing (`native/light/ua_detail_bottom.png`).
  Spec §6.7: "—" in each cell and one line.
- A draft with no times shows "⏱ 0 min" on its cover (Home, Recipes, Discover). Spec §1.11 `formatDuration`: 0 or
  absent shows nothing.
- Web was not tested with a zero-time recipe. Check it when this is fixed.

**F18. One error state and both 404s are unstyled.** Web.

- The recipe page's load error is two lines of plain text at the top start, with "Try again" as text, no back
  control and no heading (`detailErrorLate/light-390.png`). Spec §6.7.
- The 404, signed out and signed in, is plain text with an unstyled "Back to Home" and no drawing
  (`notFoundSignedOut/*.png`, `notFoundSignedIn/*.png`). Spec §9.3: the branded 404.
- Errors appear only after the client's retries, about 7–25 s of skeleton (`homeError` at 1.5 s still shows a
  skeleton; `homeErrorLate` at 25 s shows the error). Judgement: past about 10 s a skeleton must give way to
  progress or the error, so the retry count is worth lowering for reads the cook is waiting on.

**F19. The retired status words are still on the recipe page.** Web (`detailOwn`: "Needs a pick"). `form/statusWord.ts`
still maps to "Needs a pick", "Not resolved", "Resolution failed" and "Resolving…". Glossary §2.1 retires all four.
Fix: map `statusWord` to the `rowState*` words, so the page and the editor say the same thing.

**F20. Sign-in fields are 36 px pills.** Web, phones and desktop (`signIn/light-390.png`). Spec §8: inputs 48 px
with a 12 px radius. "Show password" is 32 × 30 on a coarse pointer (passes SC 2.5.8's 24 px, fails the 44 px floor
in `buildSpec.md`). Fix in `ui/src/clerk.ts`. Also: the Clerk dev instance asks for a username and first and last
names (`signUp/light-320.png`) where §8 says email and password only. That is a dashboard setting, not code.

**F21. Desktop Home is a centred narrow column.** Web, 1024–1920 (`home/light-1440.png`). The content sits in about
900 px with 144 px of empty gutter at the start. Spec §1.3: left-aligned, `content-wide`. At `@wide`, nutrition and
resume must sit side by side 1 : 2.

**F22. Native recipe page layout.** Android (`native/light/ua_detail_top.png`, `ua_detail_steps.png`).

- The "Edit" links sit centred on their own line under "Ingredients" and "Steps". Spec §6.1: a ghost link at the end
  of the heading row.
- There is no `SectionSwitch` on native (the primitive exists, unused), so Screen on sits in the action row at
  phone width. The disposition is not stated anywhere.
- Back is the word "Back" with no chevron and no parent. Spec §3.5: `chevron-left`, named "Back to {parent}".

### Severity 2: fix soon

- **Guided progress rarely shows.** `useRecipeEditorSession.ts:127` decides "first recipe" from the cached library
  read, so a direct load of `/recipes/new` (a reload, a deep link, Home's first-run button after a reload) shows no
  hints, no "Start here" and no "{done} of 4 done" (`editorNewFirstRecipe/light-1440.png`). It also uses "library
  empty", not "never published". D1.
- **The current section does not follow a hash load.** `/recipes/{id}/edit#ingredients` scrolls to Ingredients
  but the bar still says "Details" (`editorIngredients/light-320.png`, `editorPasteReading`).
- **"Save changes" wraps to two lines at 320** in the editor's action bar (`editorIngredients/light-320.png`). With
  +35% strings, Preview and Publish wrap too (`xaEditorNew/light-320`).
- **My recipes' segments wrap at +35%** at 320 (`xaRecipes/light-320`). The spec said German fits. Pseudo-locale
  shows it does not.
- **Profile email wraps inside the row value**, breaking at "examp / le" (`profile/light-390.png`). Spec: row values
  truncate:1, the header email uses `overflow-wrap: anywhere`.
- **The display-name sheet repeats its title as the field label** ("What must we call you?" twice), on both
  platforms. The field label must be "Display name".
- **Native Profile shows the email twice** and two avatar placeholders (header and "Profile photo").
- **Web save status stays "Saving…"** in every mocked editor capture, offline included (`editorOfflineSave`,
  `editorAutosaved`). Spec §7.3: offline reads "Saved on this device". Android reaches "Saved" and "Saved on this
  device" against the real services. The doubles may never settle the write, so verify against a real service
  before fixing.
- **The row editor mixes field styles.** "Unit" is an underlined field beside two boxed fields, and its label sits
  9 px lower than "Amount" (`editorRowEditor/light-390.png`).
- **The attention panel's last action wraps** ("None of these — search for a different food", two lines,
  `editorAttentionPanel/light-390`). Spec key: "Search for another food", one line. "Loading options..." uses three
  dots, not an ellipsis.
- **The filter sheet hides chips sideways.** Dietary, Cuisine and Tags scroll horizontally below 600, and the
  footer has no "Clear all" (`discoverFilterSheet/light-390.png`). Spec §4.4: wrap to 3 lines, then "Show all".
- **"Review ingredient matches" squeezes its sentence** into a 110 px column at 390, and the whole card is one
  button named only by the pill (`detailOwn/light-390.full.png`. Axe `label-content-name-mismatch`).
- **Collection detail's view switch spans the full width** (1,120 px for two icons at 1440). Spec: icon-only
  segments at the end of the result bar.
- **Collection cards show no count and no photo mosaic.** The list contract omits `recipeCount` on list reads, so
  §5.1's "12 recipes" and mosaic cannot be built as specified. This is a spec-versus-contract gap for SPECIFY and
  `staff-architect`.
- **Recipe-page hero at 1280** is stacked above the title, though the body is 960 px (spec §6.1: side by side from
  a 960 body). At 1440 it is side by side.
- **Reading rows show no spinner** on either platform ("Reading…" text only). Spec §7.5.1.

### Severity 1: polish

- The avatar's initials make its name fail axe `label-content-name-mismatch` ("EM" is not in "Profile, Eliza
  Moreno"). Hide the initials from the accessibility tree.
- Discover's no-result state says "No recipes for “zzzzzz”" twice (result line and H2).
- Facet chips keep "0" counts after a no-match search, and mix "Under 30 min" with lower-case "dairy-free".
- The rail's previous and next buttons show on touch at 390. Spec §4.4: fine pointer only.
- The search results skeleton is one full-width card at 390, while results render two compact cards per row.
- Native "Add Tags" is title case. Spec §2.2: sentence case.
- "Version 12 · Edited 9 days ago" leaves "ago" alone on a second line beside the "Current version" badge.
- Empty states have no drawings (spec §1.8 lists four). Not a blocker.

### Checked and passing, with the sweep behind it

One pass over all 477 capture records in `web/results.jsonl`:

- **Horizontal page scroll (SC 1.4.10):** none in English at any width, signed in or out. The only overflow is
  `xaDetail` at 320 with +35% strings (47 px, F14). `profileNoName` showed 8 px at 320, but that capture came from
  a broken test double (§6), so it is not reported.
- **axe violations, by id (count of captures):** `label-content-name-mismatch` 253 (the avatar initials and the
  "Review ingredient matches" card, sev-1 and sev-2) · `scrollable-region-focusable` 24 (the week strip, F16) ·
  `aria-hidden-focus` 22 (Radix menus set `aria-hidden` on the page while a modal menu holds focus, a known false
  positive) · `target-size` 10 (the detail section bar at 320, F14, and the tags field behind the sticky bar at
  320 while pasting) · `color-contrast` 2 (the delete dialog at 320 and 390 light). **That last one is a false
  positive:** axe read `#C6634C`, but the rendered pixels of the button are `#C05238`, which is 4.66:1 with white
  (`darkTheme.md` §3.2). axe sampled the dialog during its entry.
- **axe could not decide colour contrast for much of the page.** `color-contrast` came back "incomplete" on most
  captures (up to 169 nodes on Discover), because text sits on the canvas wash gradient and on blurred bars. So
  contrast over the wash is **not** machine-verified by this audit. It rests on `darkTheme.md` §3.3's worst-case
  table and on my pixel samples for F1. Dark mode passes by eye on every screen except F1. The body colour check
  (`rgb(20, 18, 16)` in every dark capture) proves only that the theme switched.

Also checked and passing: tab bar labels never wrap · sidebar at 840+ with "New recipe" first, collapse control,
active bar · FAB labelled on Home, My recipes and Collections, icon on scroll, hidden in first-run states ·
segments as routes · My recipes first-run, no-match and loading states · the delete dialog (verb buttons, Keep
focused, stacked below 400 px, destructive on top) · collection menu, picker (whole-row toggles, "Done") · cook
marks (whole-row checkbox, fill, dim, no strike-through) and current step (bar and filled numeral) on both
platforms · Screen on toggles on both platforms · paste sheet copy and count · publish refused on both platforms
(section statuses, field errors, "Fix 2 things to publish") · title soft limit ("125/120", the message, nothing
cut) · offline notice on web, recipe still readable offline · legal sources page · brand webfonts load in the
production build (the 10-08 font defect is gone).

## 4. Copy the builders invented

| String (key)                                                                                                                              | Where                  | Verdict                                                                                                                | Change                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| "Not set" (`profile.displayNameUnset`)                                                                                                    | Profile › Display name | It states a fact and offers nothing. The row opens a sheet, so the value can invite the action.                        | **"Add your name"**                                                                        |
| "Back to Profile" (`profile.backToProfile`)                                                                                               | Data sources           | Matches `shell.backTo` "Back to {parent}".                                                                             | Keep. Better: build it from `shell.backTo`, so the pattern lives in one key.               |
| "We couldn’t save your name. Please try again." (`profile.saveFailed`)                                                                    | Name sheet             | The house pattern is "… Try again." with no "Please" (§3.4 picker, §7.8 publish).                                      | **"We couldn’t save your name. Try again."** Same for `signOutFailed`.                     |
| "What must we call you?" as the field label                                                                                               | Name sheet             | Repeats the sheet title.                                                                                               | Label **"Display name"**, hint "Shown on recipes you publish."                             |
| "Finishes when you’re back online" (`rowStateWaitingForConnection`)                                                                       | A pasted row offline   | No subject: what finishes? It also breaks the row-state pattern, which names the state ("Reading…", "Looking it up…"). | **"Reads when you’re back online"**                                                        |
| "Reading…", "Looking it up…", "Choose a match", "No match found", "Couldn’t look up", "Food no longer listed"                             | Row states             | Match glossary §2.1.                                                                                                   | Keep.                                                                                      |
| "No food chosen — this line won’t be saved. Remove it and add it from the search above." (`ingredientNoFoodNote`)                         | Unmatched row          | "above" is false when the add field sits below a group. The dash joins two sentences.                                  | **"No food chosen, so this line won’t be saved. Remove it, then add it from the search."** |
| "That’s more than {max} lines. Paste them in smaller batches." / "Line {line} is longer than {max} characters. Shorten it and try again." | Paste refusals         | Clear and say what to do.                                                                                              | Keep.                                                                                      |
| "No ingredients yet. Add your first ingredient."                                                                                          | Empty Ingredients      | Fine.                                                                                                                  | Keep.                                                                                      |
| "Actions for {group}", "Rename group", "Add ingredient to this group", "Remove group (keep its ingredients)"                              | Group ⋯                | Match §7.5.5.                                                                                                          | Keep.                                                                                      |
| "Move to group", "No group", "Close move to group"                                                                                        | Move sheet             | "Close move to group" is clumsy as a spoken name.                                                                      | Close name **"Close"** (the dialog's name already says what it is).                        |
| "Remove ingredient"                                                                                                                       | Row ⋯                  | §7.5.1 says "Remove". The longer word is clearer out of context.                                                       | Keep, and update the spec.                                                                 |
| "None of these — search for a different food"                                                                                             | Attention panel        | Long, wraps, and the spec key is "Search for another food".                                                            | **"Search for another food"**                                                              |
| "Custom" badge (Android ingredient rows)                                                                                                  | Recipe page            | §6.1 says "Your own food".                                                                                             | **"Your own food"**                                                                        |
| "Needs a pick", "Not resolved", "Resolution failed", "Resolving…" (`statusWord`)                                                          | Recipe page            | Retired by §2.1.                                                                                                       | Use the `rowState*` words (F19).                                                           |
| "Today's Nutrition", "This Week's Meals"                                                                                                  | Home placeholders      | Title case. §2.2 is sentence case.                                                                                     | **"Today’s nutrition"**, **"This week’s meals"**                                           |

## 5. Web / mobile parity audit

Disposition words follow `buildSpec.md` §3.6: kept · collapsed · moved · deferred · dropped. "Test" names the
existing Playwright spec and Maestro flow for the behaviour. The judgement column is this audit's, from the captures.

| Behaviour                            | Web                                                        | Android                           | Disposition              | Playwright                              | Maestro                        | Judgement                                                     |
| ------------------------------------ | ---------------------------------------------------------- | --------------------------------- | ------------------------ | --------------------------------------- | ------------------------------ | ------------------------------------------------------------- |
| Navigation                           | sidebar ≥ 840, tab bar below                               | tab bar always                    | translated (D5, D6)      | `shellNavigation`, `homeNavCutover`     | `shell/tabBar`, `shell/goHome` | parity of job: yes                                            |
| Create entry                         | sidebar button ≥ 840, FAB below                            | FAB, icon on scroll               | translated (D4)          | `createEntry`                           | `recipes/createEntry`          | yes                                                           |
| Home order and placeholders          | placeholders first                                         | placeholders first                | none                     | `home`, `homeRecentRecipes`             | `home`                         | **both wrong (F2). Both unreadable in dark (F1)**             |
| Week strip                           | scroller, 3 days at 390                                    | scroller, 4 days                  | none                     | none                                    | none                           | both wrong (F16). No test pins 7 days                         |
| My recipes result bar                | Sort wraps 3 lines                                         | Sort on one line                  | kept                     | `recipeListSegments`, `recipeListChips` | `recipes/listDetail`           | **web only defect (F5)**                                      |
| Discover rails                       | no covers                                                  | covers                            | kept                     | `discoverReflow`, `search`              | `recipes/discoverBrowse`       | **web only defect (F6)**. Both list own drafts (F13)          |
| Recipe title face                    | Inter                                                      | Playfair                          | kept                     | `recipeDetailHero`                      | `recipes/listDetail`           | **web wrong (F8)**                                            |
| No-photo hero                        | 4:3 glyph box                                              | 4:3 glyph box, overflows          | none                     | `recipeDetailHero`                      | none                           | both wrong (F10)                                              |
| Section switch                       | sticky bar < 720                                           | absent                            | **undeclared**           | `recipeDetailCooking`                   | `recipes/detailCooking`        | native gap (F22)                                              |
| Screen on                            | in section bar < 720, action row ≥ 720                     | action row                        | moved (undeclared)       | `recipeDetailCooking`                   | `recipes/detailCooking`        | works on both                                                 |
| Cook marks and current step          | yes                                                        | yes                               | kept                     | `recipeDetailCooking`                   | `recipes/detailCooking`        | yes                                                           |
| Ingredient groups on the recipe page | dropped                                                    | not checked                       | none                     | none found                              | none                           | web wrong (F9)                                                |
| Nutrition with nothing counted       | not tested                                                 | "0 / 0 g"                         | none                     | `recipeDetailNutrition`                 | `recipes/deferredCalories`     | native wrong (F17)                                            |
| Editor frame                         | inset card                                                 | full-bleed                        | none                     | `recipeEditor`, `layoutContainers`      | `recipes/editorSections`       | web wrong (F15)                                               |
| Section index                        | rail / strip / bar                                         | bar + sheet                       | collapsed by width       | `recipeEditor`                          | `recipes/editorSections`       | both report complete with unmatched rows (F4)                 |
| Row editor                           | full-height sheet < 600, inline ≥ 600                      | not captured                      | translated               | `ingredientRowEditor`                   | `recipes/ingredientRowEditor`  | web sheet wrong (F11)                                         |
| Paste a list                         | full-height sheet                                          | content sheet                     | kept                     | `ingredientPasteList`                   | `recipes/pasteList`            | web sheet wrong (F11). Native rewrites the cook's words (F12) |
| Groups and move sheet                | menu + full-height sheet                                   | not captured                      | kept                     | `ingredientGroups`                      | `recipes/ingredientGroups`     | web sheet wrong (F11)                                         |
| Publish refused                      | "Ingredients ⚠ 2", field errors, "Fix 2 things to publish" | the same                          | kept                     | `recipeEditor`                          | `recipes/create`               | both pass                                                     |
| New collection                       | full-height sheet, Cancel shown                            | content sheet, full-width primary | translated               | `collections`                           | `recipes/newCollectionSheet`   | **web wrong (F11)**                                           |
| Profile                              | one page                                                   | one page + photo                  | kept (photo native-only) | `profile`                               | `shell/tabBar` route           | copy fixes both (§4). Native shows email twice                |
| Sign-in                              | split ≥ 1024                                               | form                              | translated               | `signIn`, `authPages`                   | `auth/loginFlow`               | **web photo broken (F3)**                                     |
| Offline                              | strip. Screens unchanged                                   | not checked                       | kept                     | `recipeLive`, `sessionHandoff`          | `offline/offlineSave`          | web passes                                                    |

**Where the fix belongs.** Seven of the sev-3 findings are classes, and each has one home:
`Sheet` (F11, sheet titles in F8), `Button` (F5's no-shrink rule, F15's ghost alignment), a `Stepper` primitive
(F8), `RecipeCover` band (F10), the layout gutter tokens (F15), `GlassCard` (F1) and the middleware matcher (F3).
Fixed there, each is decided once instead of again per screen.

## 6. What this audit could not check

- **iOS**: no simulator here. Liquid Glass (D12–D14), the iOS edge swipe, the status-bar tap and Dynamic Type are
  unchecked. CI's Maestro tier runs on an iOS simulator against the deployed sandbox. Its artifacts are the
  nearest evidence.
- **The on-screen keyboard on Android**: the emulator showed no soft keyboard, so "the section bar hides and the
  action bar unpins while typing" (§7.1) is unchecked.
- **Native states I did not reach**: the row editor sheet, the group menu, the move sheet, native offline, native
  error states, and a native recipe with groups or unmatched lines (the seed has neither).
- **The offline row copy on screen**: "Finishes when you’re back online" did not appear in my offline paste capture
  (the rows still read "Reading…" after 3 s). The copy verdict in §4 is from the message file.
- **The web no-name state**: my identity double sent an invalid profile, so `profileNoName` and the avatar in
  `homeFirstRun` show a loading state, not a no-name state. Not reported. Android shows "Not set" and the `user`
  glyph against the real service.
- **Paste results on web**: the doubles kept rows in "Reading…" past 6 s. Android shows the settled rows (F12).
- **Data the doubles shape**: My recipes listed others' public recipes because the double returns everything
  visible; I did not report that. Collection counts and mosaics depend on a list contract that omits them.
- **Screen readers**: no VoiceOver or TalkBack pass. Names and roles were read from the accessibility tree and axe
  only.
- **Reduced motion and 200% zoom**: captures ran with reduced motion, but I did not time the section jumps, and I
  did not run the 200% text pass (the repo's `text200` project covers one surface).
- **Sampling**: 53 web states and 34 native screens are a sample of a larger state space. Every state listed in the
  brief has at least one capture except the native ones named above.

## 7. Hand-off

1. `fe-1`: F1–F3 first (all small), then F4–F22. Each finding names its file and its test.
2. `staff-ux-engineer`: the primitive fixes in `packages/apps/commise/ui` (`Sheet`, `Button`, `Stepper`,
   `RecipeCover` band, gutters, `GlassCard`), on request.
3. Back to SPECIFY (my own spec's errors): the stat-strip threshold (F7), "No Sort" (F5), the section-bar fit at
   320 (F14), "German fits" in the segments, and the collection-card count against the list contract.
4. `staff-architect`: where the "line has a food" rule lives (F4), whether a row shows the cook's words or the
   parsed food (F12), and the Discover scope for drafts (F13).
5. Re-run this audit's harness after the fixes: `.local-sandbox/uiAudit2026-10-09/harness/` (Playwright config,
   capture specs, fixtures, and the Maestro capture flow `uiAuditFinal.maestro.yaml`, which must be copied under
   `.maestro/visual/` to run and removed afterwards).

## 8. Artefacts and side effects of this audit

- Written: this file (`docs/design/uiOverhaul/evaluateFinal.md`), the only tracked change.
- Scratch, gitignored: `.local-sandbox/uiAudit2026-10-09/` (captures, `web/results.jsonl`, the harness, and axe-core
  installed in the harness folder with no lockfile change).
- A scratch Maestro flow was created at `packages/apps/commise/mobile/.maestro/visual/uiAuditFinal.yaml` for the
  two device runs, then moved into the harness folder. The tree no longer holds it.
- `packages/apps/commise/web/.next` now holds a **pseudo-locale build with dead API origins** (`localhost:3999`).
  Rebuild before any `next start`. An unrelated `next start -p 3062`, not started by this audit, was running from
  the same `.next` while it was rebuilt.
- `next build` rewrote `web/next-env.d.ts`. I restored it with `git checkout` both times.
- `ownerDecisions.md` changed during the audit (D7 now covers the editor's outbox journal). Another actor made that
  change. It does not affect any finding here.
