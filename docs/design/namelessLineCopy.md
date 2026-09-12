# Nameless recipe lines: stand-ins, notices, the clone banner, restore refusal, and the interim re-pick

**Mode:** SPECIFY, scaled to the ask.
**Surfaces:** the recipe detail row (web and native), the recipe editor row, the version history list and
preview (web and native), and the clone banner.
**Status:** this is a design artefact, not production code. §1 to §5 are built on web and native, and this file
states what shipped, including the places where the build changed the design (§3c). §6 is **not built**. It waits
for the owner's approval (plan 002 V1).
**Date:** 2026-09-30. The tree is under concurrent edit. The anchors are as read today.
**Governing sources:** plan 002 (`docs/plans/2026-09-20-002-…-plan.md`) R2, R9, R26, R27, R36, R37b and
R52. ADR-0045. `docs/design/ingredientStatusExplanation.md`, which this spec amends by hand-off (§9).

**Hat and standing.** I worked as UI and content designer. For the one proposed design-system primitive,
I worked as design technologist. I did not write any of the shipped strings revised here. I rendered the
**web detail row** in Chromium as a static HTML copy of its real classes. The widths were 320 px, 390 px,
and 640 px at 200% text. That copy is not the app. I rendered nothing on native. I also evaluated the build
against this spec, by reading the code and running the detail component suites on both platforms.

---

## 0. What is already broken, and what this copy depends on

These defects were in the tree before this change. A line with no `name` caused each one. Each fix depends on §1,
and **all nine are fixed**. The anchors below are where each defect was.

| #   | Site                                                                                                                                                 | What a nameless line produces today                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `features/recipes/src/detail/RecipeDetailBody.tsx:302` and `.native.tsx:256`, the row checkbox's accessible name `` `${label} ${ingredient.name}` `` | A screen reader says **"2 tbsp undefined, checkbox"**. A template literal turns `undefined` into the word "undefined".                                                             |
| D2  | `RecipeDetailBody.tsx:324` and `.native.tsx:265`, the visible name                                                                                   | An empty span. The row shows a quantity with nothing after it.                                                                                                                     |
| D3  | `detail/model.ts:356`, the singular `removedFoodNotice`                                                                                              | `removed[0]?.name ?? ''` renders **`“” was removed`** for a food that is gone.                                                                                                     |
| D4  | `detail/model.ts:113-117`, `formatIngredientLine`, shared by the version preview, compare, and conflict merge                                        | `ingredientName` is now optional on a snapshot (`recipe.types.ts:969`). The line prints **"2 tbsp undefined"**. The restore-refused lines in §5 are exactly these lines.           |
| D5  | `form/props.ts:618`, `resolutionStatusLabel`                                                                                                         | The switch has no `FOOD_UNREACHABLE` case.                                                                                                                                         |
| D6  | `form/RecipeIngredientsFields.tsx:107` and `.native.tsx:86`, `value={line.name}`                                                                     | An empty read-only field.                                                                                                                                                          |
| D7  | `form/props.ts:738`, `reviewIngredientLabel` on the wizard Review step                                                                               | No name, and a trailing space.                                                                                                                                                     |
| D8  | `versions/merge.ts:162`, the draft projection's `ingredientName: line.name`                                                                          | A draft value of `''` against an absent snapshot name can show a conflict change that nobody made. The projection must **omit** the key.                                           |
| D9  | `messages.ts:633`, `removedFoodNoticeMany`, "They’re **marked above**"                                                                               | The tile renders **before** the list (`RecipeDetailBody.tsx:275`, then `:280`. Native `:228`, then `:233`). The marked lines are **below** it. §3 fixes this existing copy defect. |

---

## 1. ⛔ The rule: one function names a line

**Every surface gets a line's name from one pure function.** No surface reads `line.name` or
`ingredientName` directly.

```
lineDisplayName(line, labels): string   // the name, or the stand-in for its status
lineSummary(line, locale, labels): string  // "{quantity} {lineDisplayName}", trimmed; the row's accessible name
```

This function is the client-side twin of plan R10: "the name derivation MUST live in exactly one place".
The same missing name broke ten sites in six files (D1 to D7 in §0). The next surface will break the same way
without it. `formatIngredientLine` takes the stand-in as a parameter. Today it takes no messages, and
that is how D4 happened.

**The stand-in for each case (first match wins):**

| Line                                                                                                        | `lineDisplayName` returns              |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `name` present, whatever the status. This includes a **withdrawn** `FOOD_REMOVED` food that keeps its name. | the name                               |
| `RESOLVED_UNAVAILABLE`                                                                                      | `ingredientLineName.privateFood`       |
| `FOOD_REMOVED` with no name (the food is gone)                                                              | `ingredientLineName.removedFood`       |
| `FOOD_UNREACHABLE`                                                                                          | `ingredientLineName.notLoaded`         |
| a version-snapshot line with no `ingredientName`                                                            | `ingredientLineName.notSavedInVersion` |

⛔ **The function never makes up a name.** It does not use `notes`, `preparation`, or anything else (R9:
"There is no fallback"). A nameless line also shows **no kind or detail line** under it. The kind's name
comes from the food. `ingredientSpecialization.md` §S1 already rules this for `RESOLVED_UNAVAILABLE`, and
this spec extends it to the other two statuses.

**Consumers.** Each of these must use the function: D1, D2, D4, D6, and D7. D3 uses it to choose its
variant (§3). The `⋮` menu's accessible name uses it (§6). The V1 nutrition-panel heading uses it too.

**The conflict merge.** A version snapshot saves no private food's name and no line status. So the merge's
server side takes the **live** recipe's name and status for any binding the live recipe also has
(`versions/merge.ts:184-204`). ⚠️ **Residual:** a line that only the server side has, with no saved name, still
reaches the editor with an empty name field. The function has no status to choose a stand-in from.

---

## 2. The stand-in: what a nameless row shows in place of its name

### 2a. Decision: the stand-in is the name, and it replaces the trailing badge

> **✅ A nameless line renders its stand-in in the name position, as a dashed chip. It has no separate
> status badge. The stand-in already states the status.**

**Measured with a static copy of the real detail-row classes (Chromium, 2026-09-30):**

| Row at **320 px**                                                                                                                   | Row height                                                  | Name width                                |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| Named row, as shipped: a name plus a trailing `shrink-0` badge (`Olive oil, extra virgin` and `Needs review`). Fixed by E2 I1, §2c. | **233 px**                                                  | **21 px**, one or two letters per line    |
| Before this change, a nameless line: empty name and a `Details unavailable` badge                                                   | 68 px                                                       | 0 px. The row reads "2 tbsp" and a badge. |
| Stand-in text **plus** the trailing badge (rejected)                                                                                | **347 px**                                                  | 0 px                                      |
| **Proposed**: the stand-in chip inside one flowing text block                                                                       | **68–93 px** in English. 138 px for the +35% German string. | breaks only at spaces                     |

Observation: the trailing badge is `shrink-0` and `ml-auto`. At 320 px it takes the name's width.
Interpretation: a stand-in **plus** a badge makes the row unreadable. A chip that is the name fixes it.
**The principle:** one element answers "what is it?" in the place the eye reads. A second element with
the same message costs width and adds nothing.

### 2b. The four stand-ins

The keys go in a **new shared block**, `recipeMessages.en.ingredientLineName`. Its interface is
`IngredientLineNameMessages` in `features/recipes/src/messages.ts`. The detail, editor, wizard, and
version surfaces all render these strings.

| Status                           | Key                 | `en`                    | Tone (web tokens, then native)                                                                                                                                                               | Why this wording (**judgement**, not tested)                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESOLVED_UNAVAILABLE`           | `privateFood`       | `Private ingredient`    | Neutral. Web: `border border-dashed border-slate bg-card text-slate`. Native: `palette.slate` border and text on `palette.white`.                                                            | It says why the name is missing. It does not say whose food it is. Notion labels backlinks to owner-only pages as `Private` (prior art, §9).                                                                                                                                                                                                                                                    |
| `FOOD_REMOVED`, nameless         | `removedFood`       | `Removed food`          | Caution. Web: `border border-dashed border-warning-dark bg-warning/25 text-charcoal`. Native: `tint(palette.warning, 0.25)` fill, `palette['warning-dark']` border, `palette.charcoal` text. | It keeps the caution tone of the existing badge, because the owner can act. It keeps "removed". ⛔ It says **food**, never "ingredient": the line is still in the recipe with its amount, and only its food was removed. `statusFoodRemoved` in `form/messages.ts` records the same ruling ("Ingredient removed" was a recorded defect). It also matches the named row's badge, `Food removed`. |
| `FOOD_UNREACHABLE`               | `notLoaded`         | `Ingredient not loaded` | Neutral, as `privateFood`.                                                                                                                                                                   | ⛔ It says "not loaded", never "removed" or "missing". R2 forbids an outage that reads as a permanent fact.                                                                                                                                                                                                                                                                                     |
| snapshot line with no saved name | `notSavedInVersion` | `Name not saved`        | Neutral.                                                                                                                                                                                     | A version is history. This version did not record a name, and the product knows nothing more.                                                                                                                                                                                                                                                                                                   |

**Named lines do not change.** A withdrawn food that keeps its name shows the name and the existing
`removedFoodBadge` (`Food removed`).

### 2c. Layout and overflow

- **Web.** The name or stand-in, the preparation, and the notes render in **one** `min-w-0 flex-1` text
  block. The chip is `inline-block max-w-full rounded-sm px-2 py-0.5 text-body-sm font-medium`. The
  radius token is `sm`, 6 px (`tokens/scale.ts:52`). The chip breaks inside itself at spaces
  (`overflow-wrap: break-word`). ⛔ It is never `nowrap` and never truncated.
- **Why one block.** The first render set the chip and the preparation side by side as two flex items.
  That broke words in the middle ("Remove / d / ingredie / nt"). The flowing block fixed it.
- **Native.** React Native nested `Text` takes no padding and no border. So the chip is a `View` with
  `borderStyle: 'dashed'`, `borderRadius: nativeTokens.radius.sm`, and `paddingHorizontal:
nativeTokens.spacing[2]`, holding a `Text`. It sits with the preparation and notes in a `View` with
  `flexShrink: 1, flexDirection: 'row', flexWrap: 'wrap'`. The disposition is **kept**: the job is the
  same and the mechanism is different.
- ⚠️ **Not verified:** dashed borders on Android. If they do not render, use a solid hairline. The words
  carry the meaning, not the border.
- **Longest strings.** English is 21 characters at most (`Ingredient not loaded`). I rendered the +35%
  case with a 28-character German string. At 320 px it is 138 px tall, breaks at spaces, and does not
  overflow.
- **Editor row.** The chip takes the read-only name field's place, and the row shows **no** status word, the
  same as the detail row. The chip's wrapper carries the id `recipe-ingredient-{index}-stand-in`
  (`ingredientStandInId`, `form/fieldErrorIds.ts:48`). The row's first quantity field lists that id **first** in
  its `aria-describedby`. The chip is not focusable. Without this link, a keyboard user who tabs to the amount
  does not hear which food the line is. On a **named** row, the native editor's `FOOD_REMOVED` status word takes
  the warning tint, the same as web.
- ✅ **Named-row badges: built (E2 I1, re-checked 2026-10-01).** The status badges of **named** rows (`Custom`,
  `Needs review`, `Needs a pick`, `Food removed`) sit in the same flowing block, after the notes. The badge is a
  primitive, `@commise/ui/status-badge` `StatusBadge` (`UI/statusBadge/`, web and native):
    - `tone: 'neutral' | 'caution'`, a display derivation. Neutral is `slate` on `pearl` (4.81:1). Caution is
      `charcoal` at weight 500 on `warning/25` (10.85:1). Text is `caption`, 12 px or pt.
    - **Filled, never dashed.** The dashed outline stays `StandIn`'s mark for words in place of a name.
    - The radius is half the one-line height. One line reads as a pill. A wrapped badge is a rounded rectangle,
      and its words stay inside the curve.
    - Plain text: no role, no `aria-label`, never `aria-hidden`. It wraps at spaces and is never truncated.
    - Measured at 320 px and 100% text: the name block is 130 to 146 px, and no word breaks mid-letter. The
      full record is in `ingredientSpecialization.md`, "E2 re-check".
- ⚠️ **Residual.** Under the text-only stress test at 320 px, the block is still 0 px. The cause is now the
  checkbox and the `shrink-0` quantity, not the badge (§7, row 1.4.4). U15 owns it. See the E2 re-check.
- **Where the same chip is not yet `StatusBadge`.** Each site is the same class of defect: a hand-rolled
  `rounded-full` chip, so a wrapped label runs past the curve, and it drifts from the primitive.

    | Site                                                  | What it is                                          | Unit                                                               | What changes                                                                                                                                                                                                                                                                                                                                                 |
    | ----------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
    | `FR/form/RecipeIngredientsFields.tsx:136`             | the no-food note, a full sentence in a caution chip | plan 002 **V1** (in progress)                                      | `tone="caution"`. `StatusBadge` takes no `id` and no role. So a wrapper `span` carries `id={ingredientNoFoodNoteId(index)}` and `role="note"`, as `StandIn`'s wrapper carries its id. This sentence wraps at 320 px, and on a full pill it runs past the curve (E2 I2)                                                                                       |
    | `FR/form/RecipeIngredientsFields.tsx:269-270`         | the editor row's status word                        | plan 002 **V1** (in progress)                                      | `caution` for `NEEDS_REVIEW` and `FOOD_REMOVED`, else `neutral`. ⛔ Drop the `aria-label` (`Ingredient {number} status`). ARIA 1.2 forbids a name on a generic `span` (§5.2.8.6, fetched 2026-10-01). Where a screen reader honours it, the cook hears "Ingredient 3 status" and not the status. Without it, the status word is read in its place in the row |
    | `FR/card/RecipeCard.tsx:274`                          | the version chip, `v{version}`                      | **none.** No unit in plan 002 or the curated plan touches the card | `neutral`. Its `aria-label` on a `span` has the same ARIA defect. The draft chip at `:280` is a third tone (full `bg-warning`, semibold). Settle it in the same pass                                                                                                                                                                                         |
    | `web/src/components/recipes/IngredientPicker.tsx:512` | the `Slow` tag inside the live-search button        | curated plan **U29**, which rebuilds the live-search components    | `neutral`. It is part of the button's name, so it stays inside the button. Place it in the label's text flow, not as a `shrink-0` flex item (the I1 rule)                                                                                                                                                                                                    |

    Native twins, with the same owners: `RecipeIngredientsFields.native.tsx:110` and `:220-224` (V1),
    `mobile/src/components/IngredientPicker.tsx:717` (U29), and `RecipeCard.native.tsx:191` (none). On native the
    wrapper for `:110` is a `View` with the id.

- ⛔ **Native: the editor's description links do nothing on a device (E2 I11).** React Native 0.86 has no
  `aria-describedby`. Only react-native-web maps it, so the tests pass while devices get nothing. This covers the
  stand-in link above and the error links (`RecipeIngredientsFields.native.tsx:98`, `:119`, `:148`). A swipe user
  meets the chip in reading order, because the chip comes before the amount fields. An explore-by-touch user does
  not.
    - **Owed: a native description adapter**, in a design-system input in `packages/apps/commise/ui`. No unit owns
      it yet.
    - It takes the description **strings**, not ids, because native cannot turn an id into text. On native it sets
      `accessibilityHint` to those strings, joined in order. On web it keeps `aria-describedby` with the ids.
    - ⚠️ Likely, not checked on a device: VoiceOver reads a hint after a pause, and a user can turn hints off.
    - **V1 gains no work from this.** V1 keeps the chip before the amount fields in reading order. That is what
      carries the link on a device today.
- **Where the fix lives.** The chip is a design-system primitive: `@commise/ui/stand-in` `StandIn`
  (`ui/src/standIn/`, web and native), with `tone: 'neutral' | 'caution'` as a display derivation. The detail row
  and the editor row use it on both platforms. The version preview does not yet (§5). Styling that each site
  decides again will drift.

---

## 3. Explanations on the detail page

### 3a. `RESOLVED_UNAVAILABLE`: no tile, by decision

The stand-in explains itself. A reader of another cook's recipe can do nothing about it. A tile
repeats the stand-in on every open. **Judgement:** this rests on "Private ingredient" being clear without
help. It flips on support contact or a test that shows readers asking why. §4's banner covers the owner case, a
clone. The editor re-pick (§6) is not built yet.

### 3b. `FOOD_REMOVED`: the tile, corrected

The keys are in `recipeMessages.en.detail`.

| Key                           | Change                                                                                                       | `en`                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `removedFoodNoticeOne`        | No change. **Named** line only.                                                                              | as shipped                                                                                                                                                                 |
| `removedFoodNoticeOneUnnamed` | **New.** Fixes D3. The chooser uses it for a single removed line with no name.                               | `Nutrition only: one ingredient was removed from our food database, so it isn’t counted below. Its amount in this recipe is unchanged.`                                    |
| `removedFoodNoticeMany`       | **Rewritten.** Fixes D9 ("above"). Drops the claim that names are unchanged, which is false for a gone food. | `Nutrition only: {count} ingredients were removed from our food database, so the nutrition figures leave them out. They’re marked below, and their amounts are unchanged.` |
| `removedFoodNoticeAll`        | **Rewritten.** Drops the false claim about names.                                                            | `Nutrition only: every ingredient here was removed from our food database, so there’s no nutrition to show. Their amounts in this recipe are unchanged.`                   |

The existing copy notes stay: "our food database", "Nutrition only:" first, and "was removed" rather than
a softer phrase. Each string now uses "below" with one meaning.

### 3c. `FOOD_UNREACHABLE`: one notice with a retry, using `RefreshNotice`

**A retry is necessary.** A cook who cannot see an ingredient's name cannot cook the recipe. The cause
is transient, and a reload can fix it (`recipe.types.ts:491-498`).

**Component.** Use `@commise/ui` `RefreshNotice` (`ui/src/refreshNotice/RefreshNotice.tsx` and
`.native.tsx`). It already has a polite status region and keeps the same busy button through the retry.
It announces a second failure again. **No new primitive.**

- **Placement.** Put it in the Ingredients section, above the list, in the removed-food tile's slot.
  Show **one notice per recipe, not one per line.** The gateway asks food-service for many foods in
  one batch (`ingredients/foodRefs.gateway.ts:94-152`). One failure usually hits several lines.
- **Wiring.** ⛔ The `RefreshNotice` stays **mounted** in the Ingredients section at all times. It is hidden
  through its `failed` value, never by unmounting. A live region that mounts with its content already inside is
  often not announced, as the removed-food tile's comment records. `failed` is `unreachableCount > 0`.
  `refreshing` is `query.isRefetching`. `labels` is `{ failed: unreachableNotice{One|Many}, retry: refreshRetry }`.
- **Its own retry state.** Each app container wires a **second** `useRefreshNotice` over the same query,
  `useRefreshNotice(query, { recovered: isUnreachableRecovery })` (`detail/model.ts:337`), and passes it as
  `unreachableRetry`. When a retry settles with **no** unreachable line, it counts a recovery. Otherwise it does
  not. So its `recoveries` only goes up, and it goes up in one case: the button the cook pressed is gone. A partial recovery and a
  background refetch never count, and that includes a later outage that clears by itself.
- ⛔ **One Try again for one cause, and the notice the cook pressed wins.** Both notices retry the same read. While
  any line is unreachable and this notice has a retry, the **page-level** refresh notice yields
  (`pageRefreshFailed`, `RecipeDetailBody.tsx:96`). So a retry pressed here that fails at transport keeps its own
  button, and focus stays on it. When no line is unreachable, the page-level notice still shows.
- ⛔ **No automatic polling.** During a food-service outage, polling from every open detail page adds
  load at the worst time. TanStack's refetch on focus stays. **Judgement:** it flips on telemetry that
  shows most retries succeed on the first press.

| State                                                                                   | What shows                                                              | Key                                               | Focus and announcement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loaded, some lines not reachable                                                        | The stand-ins, the notice, and Try again.                               | `unreachableNoticeOne` or `unreachableNoticeMany` | It arrives with the page load, so it is not a 4.1.3 status message. The polite region carries it.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Retrying                                                                                | The same message. The button is busy (`busyControlProps`).              | reused                                            | Focus stays on the button.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Retry succeeded, all names present                                                      | The notice hides. The rows show names.                                  | `unreachableResolved`                             | ⛔ The button is gone, so focus moves to the **Ingredients `h2`** (`tabIndex={-1}`, native `screen-reader-focus`). Without this, focus falls to `<body>` (2.4.3). `unreachableResolved` is the heading's accessible **description**: web `aria-describedby` to a hidden element, native `accessibilityHint`. Focus lands on the heading, and the screen reader then speaks it. It is **not** a live region, because a live region speaks again on a background refetch that the cook did not ask for. |
| Retry partly succeeded                                                                  | The notice stays with the new count.                                    | as above                                          | No recovery is counted. Focus stays on the button. The region announces the new count.                                                                                                                                                                                                                                                                                                                                                                                                                |
| Retry failed at transport                                                               | This notice stays, with its button. The page-level notice stays hidden. | reused                                            | Focus stays on the button. After the busy state ends, the region says the sentence again.                                                                                                                                                                                                                                                                                                                                                                                                             |
| A background refetch (on focus, or an invalidation) clears the notice or brings it back | The notice shows or hides.                                              | as above                                          | No recovery is counted. Focus does not move. The heading gets no description.                                                                                                                                                                                                                                                                                                                                                                                                                         |

⚠️ **Residuals, accepted:**

- After a recovery, the description stays on the heading until the next outage. A cook who returns to the heading
  later hears "Ingredient names loaded." again. It is still true.
- A VoiceOver or TalkBack user who turned hints off hears no message on native that the names loaded. Focus still lands on the
  heading, and the rows show the names.
- While lines stay unreachable, each background refetch empties the polite region and fills it again, so the
  sentence is spoken again. Every `RefreshNotice` does this. If this needs a fix, it belongs in the primitive.

| Key (`detail`)          | `en`                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `unreachableNoticeOne`  | `We couldn’t load one ingredient’s name and nutrition just now. Your recipe hasn’t changed.`            |
| `unreachableNoticeMany` | `We couldn’t load the names and nutrition of {count} ingredients just now. Your recipe hasn’t changed.` |
| `unreachableResolved`   | `Ingredient names loaded.`                                                                              |

**The copy states no cause, by design.** A request with no credential also produces `FOOD_UNREACHABLE`
(`foodRefs.gateway.ts:73`). `nutritionStale` records the same precedent (`messages.ts:274-287`). "Your
recipe hasn’t changed" answers the cook's real worry. ⚠️ **Assumed:** every app detail read carries the
cook's token. For a real cook, the condition is therefore transient.

---

## 4. The clone banner, with its new meaning

`clonePrivateFoodLineCount` now counts **lines kept bound to a food this viewer cannot see**
(`recipeResponse.dto.ts:86-91`). The shipped banner is this string (`messages.ts:636`):
`{count} ingredients need re-matching — the original used the author’s own foods.`
It is now **false in two ways**. The lines are not unbound. Nothing needs re-matching for the recipe to be valid. The banner also renders "1
ingredients" for a count of one.

| Key (`detail`)                | Change                                                   | `en`                                                                                                                            |
| ----------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `clonePrivateFoodsBannerOne`  | Replaces `cloneUnboundBanner`.                           | `One ingredient uses the original cook’s private food, so you can’t see its name or nutrition. Its amount is kept.`             |
| `clonePrivateFoodsBannerMany` | Replaces `cloneUnboundBanner`.                           | `{count} ingredients use the original cook’s private foods, so you can’t see their names or nutrition. Their amounts are kept.` |
| `clonePrivateFoodsDismiss`    | Renames `cloneUnboundDismiss`. The text does not change. | `Dismiss`                                                                                                                       |

The key rename is cheap, because each use becomes a compile error. The old name describes a behaviour
that no longer exists.

⛔ **The banner points at no remedy yet.** §6 is not built. So the editor has no control that re-picks a line's
food and keeps its amount. Copy that points at a missing control is worse than no pointer. When §6 ships, the
remedy clause comes back: `Its amount is kept: choose a food for it when you edit this recipe.` and
`Their amounts are kept: choose a food for each when you edit this recipe.` The clause does not name the Edit
control, so it cannot drift from the `editAction` string in the app catalogues.

**The banner's region.** The banner sits in the review section, which is labelled `Review ingredient matches`.
When an ambiguity review is there, that label is correct, and the section carries it (both `AmbiguityReview`
leaves). When the section holds only the banner, it has no label.

The wire field was renamed from `cloneUnboundLineCount` to `clonePrivateFoodLineCount` on `staff-architect`'s
advice, while no client of the contract has been released (ADR-0014).

---

## 5. Restore refused: `409 VERSION_LINE_UNRESTORABLE`

The server refuses a restore for a snapshot line whose binding is gone **and** whose version froze no
name (`versions/domain/restoreLinePolicy.ts`). Nothing is restored. `details.positions` gives the
0-based snapshot positions.

**What the cook can do next.** First, **preview the version**, where the refused lines are marked.
Second, edit the current recipe and copy what they need into it.

⚠️ A **partial restore** that the cook consents to ("restore everything except these") needs a server
change. The policy refuses a partial restore so that a line is never dropped _silently_. An explicit
opt-in is a different thing. It is a **follow-up** (§9), and this spec does not design it.

**Client state.** The client has a typed error and guard, `VersionLineUnrestorableError` and
`isVersionLineUnrestorableError` (`clients/recipe-service/src/errors.ts:293`). `RecipeVersionRestoreError`
(`versions/history.ts:34-35`) has a third member,
`{ kind: 'unrestorable'; versionNumber: number; positions: readonly number[] }`. One pure function,
`classifyRestoreError` (`versions/history.ts:45`), maps the error, and both app containers call it
(`web/.../RecipeVersionsContainer.tsx:185`, `mobile/src/screens/RecipeVersionsScreen.tsx:119`).

| Surface                          | What shows                                                                                                                                                                                                                                                      | Role                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Version list, web and native     | The alert, in the existing error slot (`RecipeVersionList.tsx:88`, `.native.tsx:62`).                                                                                                                                                                           | `role="alert"` and `accessibilityRole="alert"` (existing) |
| Preview modal or sheet           | ⛔ **The same refusal shows inside the modal** (`VersionPreviewModal.tsx:109`, `.native.tsx:93`). Before this change, a failed restore from the preview showed its error only in the list _behind_ the dialog. This applies to conflict and generic errors too. | `role="alert"` inside the dialog                          |
| Preview modal, each refused line | The line text (stand-in `Name not saved`), then `(can’t be restored)` as plain text after it. The brackets keep the two from reading as one phrase.                                                                                                             | none. It is part of the line text.                        |

⚠️ **Open follow-up:** in the preview, `Name not saved` is plain text, not the `StandIn` chip. The preview line is
one formatted string (`formatIngredientLine`), which the conflict merge shares. The chip needs a structured line.

| Key                                        | `en`                                                                                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `versionList.restoreUnrestorableErrorOne`  | `This version can’t be restored: one of its ingredients no longer exists, and this version didn’t save its name. Nothing was changed. Preview the version to see which one.`        |
| `versionList.restoreUnrestorableErrorMany` | `This version can’t be restored: {count} of its ingredients no longer exist, and this version didn’t save their names. Nothing was changed. Preview the version to see which ones.` |
| `preview.restoreUnrestorableErrorOne`      | `This version can’t be restored: one of its ingredients no longer exists, and this version didn’t save its name. It’s marked below. Nothing was changed.`                           |
| `preview.restoreUnrestorableErrorMany`     | `This version can’t be restored: {count} of its ingredients no longer exist, and this version didn’t save their names. They’re marked below. Nothing was changed.`                  |
| `preview.lineCannotRestore`                | `(can’t be restored)`                                                                                                                                                               |

`{count}` is `positions.length`. The Restore control stays enabled. A second press gets the same answer
and changes nothing. A pre-check of which versions can be restored needs a server field (follow-up).

---

## 6. The interim re-pick: "Change food" in the editor

⛔ **Not built.** This section is plan 002's V1 and waits for the owner's approval. The stand-in chip in the editor
row is built, and §2c records it.

### 6a. The existing re-pick flow does NOT cover this today

As read on 2026-09-30, the editor row offers only field edits and **Remove**
(`RecipeIngredientsFields.tsx:268`). "Change food" is **designed** (`ingredientStatusExplanation.md`
§2c and §3a, plan R26 and R27) but **not built**. No client code calls the rebind route. Today the only
remedy is to remove the line and add it again. That loses the amount, unit, preparation, and section.

### 6b. Decision

> **✅ The interim is the first slice of the committed design. The editor row gets its `⋮` menu with
> `Change food · Remove ingredient`, on the rows below. Change food opens the editor's existing
> add-ingredient picker. The pick REPLACES this line's food and keeps its amount, unit, preparation,
> and section (`rebindIngredientAt`, `ingredientStatusExplanation.md` §4a). The editor's normal Save
> commits it.** V1's inline combobox replaces the picker later. The menu path stays, so this is not a
> throwaway workaround.

| Editor row                                 | Slot 2               | Menu, remedy first                                                                                                                                                                                                                                                 |
| ------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RESOLVED_UNAVAILABLE` (row 11)            | `⋮`                  | Change food, Remove ingredient. ⛔ **This reverses row 11's "offers nothing".** In the editor the viewer is always the owner. A line the owner cannot name is not "fine".                                                                                          |
| `FOOD_REMOVED`, named or nameless (row 12) | `⋮`                  | Change food, Create my own food, Remove ingredient (as designed).                                                                                                                                                                                                  |
| **`FOOD_UNREACHABLE` (new row 13)**        | **Remove, directly** | ⛔ **No Change food and no Create my own food.** The line is bound to a real food. R2 forbids a replacement caused by an outage. Saving keeps the binding. The interim editor has no retry. It flips on telemetry that shows cooks open the editor during outages. |

⚠️ **ONE-WAY-DOOR ADJACENT: the interim does not call `POST …/ingredients/{position}/rebind`.** This
departs from the brief's framing. The command's own code (`recipes/ingredientRebind.service.ts`) gives
three reasons:

1. **Position drift.** The command finds the line by its **stored** `sortOrder`. After the cook removes
   or adds a line above it in the draft, the draft index no longer matches. The command then rebinds
   **the wrong line**.
2. **Cancel.** The command commits at once and makes a version (`changeSummary: 'Changed ingredient'`).
   The editor's Cancel then leaves a write that the cook thinks they discarded. That breaks R27
   ("Cancelling loses nothing").
3. **Stored rows.** The command rebuilds each line from the **stored** row (`toLineRequest(row)`). Draft
   edits to that line are not in the new version. The draft's `expectedVersion` is then stale, and the
   next Save gets a 409.

**What this costs.** Only the command records R17's correction (`recordCorrection` runs before the
repoint). For these statuses, `correctionPhraseOf` returns a phrase only for **imported** lines
(`domain/ingredientRebind.ts`). So the lost learning is limited to those lines. **A question for
`staff-architect`:** does the update path record the same correction for a line whose binding changes?

**Flip condition.** V1's per-row commit ("When I commit, we record the correction", US2) calls the
command from Change food. §6d holds the command's states for that change.

### 6c. Interim states, both platforms

| State                                            | What shows                                                                                   | Key                                                                                                                                      | Focus and announcement                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Idle                                             | `⋮` in slot 2.                                                                               | `ingredientActionsMenuLabel` = `Actions for {food}`. **`{food}` is `lineSummary`**, for example "Actions for 2 tbsp Private ingredient". | APG menu button (`ingredientStatusExplanation.md` §3a)                     |
| Menu open                                        | The items in the table above.                                                                | `statusActionChangeFood` = `Change food`. `statusActionRemove` = `Remove ingredient`. Both are designed keys.                            | Focus on the first item.                                                   |
| Picker open                                      | The existing add picker. The search field is **empty**, because there is no name to seed it. | **New** `changeFoodPickerTitle` = `Choose a food for ingredient {number}`                                                                | Focus in the search field. The keyboard opens (existing picker behaviour). |
| Searching, no matches, or catalog not available  | The existing picker states.                                                                  | existing picker keys                                                                                                                     | existing                                                                   |
| Adding the picked food (busy), or the add failed | The existing picker's in-flight and failure states (the by-food admission, R51).             | existing                                                                                                                                 | existing                                                                   |
| Picked                                           | The line shows the food's name. The amount, unit, preparation, and section do not change.    | `statusResolvedConfirmation` (designed)                                                                                                  | The picker closes. Focus goes to the row's `⋮`. `role="status"`.           |
| Picker cancelled                                 | Nothing changes.                                                                             | none                                                                                                                                     | Focus goes to the row's `⋮`.                                               |
| Save gets `409 VERSION_CONFLICT`                 | The **existing** conflict view (T070). The changed food shows as an ingredient change.       | existing `conflict.*`                                                                                                                    | existing                                                                   |
| Editor cancelled or discarded                    | Nothing was written.                                                                         | none                                                                                                                                     | The existing discard guard.                                                |

**Editor explanation copy** (`recipeFormMessages.en`), in the row's status panel:

| Key                                                    | Change                          | `en`                                                                                                                                          |
| ------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `statusFoodUnreachable`                                | **New.** Fixes D5.              | `Not loaded`                                                                                                                                  |
| `statusExplainFoodUnreachable`                         | **New.**                        | `We couldn’t load this ingredient’s name and nutrition just now. It’s still linked to its food, and saving keeps that link.`                  |
| `nutritionNoneUnavailable` (designed, not yet in code) | **Rewritten.**                  | `This is linked to another cook’s private food, so you can’t see its name or nutrition. Use “{changeFoodLabel}” to pick one you can see.`     |
| `statusExplainFoodRemovedUnnamed`                      | **New**, for a nameless row 12. | `This food was removed from our food database, and its name went with it. Your amount is unchanged. Use “{changeFoodLabel}” to pick another.` |

`statusActionChangeFood` fills `{changeFoodLabel}`. This follows the designed `errorPromptRecordMode`
pattern, so the sentence and the control cannot drift apart. On a nameless row the editor shows the
stand-in chip in the name slot and **no** status word, the same as the detail row.

### 6d. The command's states, for V1 or an override

These states apply only to a UI that calls the rebind command. **The interim does not need them.**

| Outcome                                        | Key (`detail`, reserved)  | `en`                                                                             | Behaviour                                                             |
| ---------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| busy                                           | none                      | none                                                                             | The trigger is busy (`busyControlProps`). The row keeps its stand-in. |
| success                                        | `rebindDone`              | `Changed to {food}.`                                                             | The response replaces the query data. `role="status"`.                |
| `409 VERSION_CONFLICT`                         | `rebindConflict`          | `This recipe changed since you opened it. We’ve reloaded it, so try again.`      | Refetch. Focus stays on the trigger.                                  |
| `502 SOURCE_UNAVAILABLE`                       | `rebindSourceUnavailable` | `We couldn’t reach our food database to check that food. Try again in a moment.` | Nothing is written. The server refuses the bind before any write.     |
| `400 VALIDATION_FAILED` (the position is gone) | `rebindLineGone`          | `That ingredient changed while you were choosing. We’ve reloaded the recipe.`    | Refetch.                                                              |

---

## 7. Accessibility contract: WCAG 2.2 AA

⚠️ The `frontend-ux-engineer` skill states **WCAG 2.1 AA**. This contract is **2.2 AA**. It touches two
criteria that are new in 2.2: 2.5.8, and 2.4.11 for the menu. Tell the implementer before the hand-off.

| SC                       | Contract                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.1.1 and 4.1.2 name** | The row checkbox's name is **`lineSummary`**, for example "2 tbsp Private ingredient", "1 cup Removed food", "3 cloves Ingredient not loaded". This fixes D1. Native uses the same string as `accessibilityLabel`.                                                                                                                                                                                                        |
| **1.3.1**                | The stand-in is **plain text in the list item**. It has no role and no `aria-label`. ⛔ It is **never `aria-hidden`**, because it _is_ the name. The needs-review badge sets this precedent. In the **editor**, the chip's wrapper id `recipe-ingredient-{index}-stand-in` is listed first in the first quantity field's `aria-describedby` (§2c).                                                                        |
| **1.4.1**                | The words carry the meaning. The dashed border and the tint are extras, never the only signal.                                                                                                                                                                                                                                                                                                                            |
| **1.4.3**                | Computed: `slate` on `card` (white) is **5.24:1**. `charcoal` on `warning/25` over white (`#FCEBD0`) is **10.83:1**. Both pass 4.5:1. ⛔ `warning` is never a text colour (`colors.ts:48-51`).                                                                                                                                                                                                                            |
| **1.4.11**               | Not required, because the chip is not interactive. The dashed `slate` border is 5.24:1 anyway.                                                                                                                                                                                                                                                                                                                            |
| **1.4.10**               | Rendered at 320 px: no page scroll, and the stand-in breaks at spaces. ⚠️ Web detail row only. The **editor row** was not rendered. There the chip sits in the name slot beside the two-slot icon column, and rev 6 makes that row wrap.                                                                                                                                                                                  |
| **1.4.4**                | Rendered at 640 px with 200% text: every row fits. ⚠️ At 320 px with 200% root text, **every** row variant overflows, the shipped one too. The checkbox and the quantity are `shrink-0`. That is outside the 1.4.4 test condition. It is recorded here and not claimed as a pass.                                                                                                                                         |
| **1.4.12**               | **Not tested.**                                                                                                                                                                                                                                                                                                                                                                                                           |
| **2.4.3**                | A retry that loads every name removes the button, and focus goes to the Ingredients `h2` (§3c). A retry that fails at transport keeps its own button, because the page-level notice yields, so focus does not drop to `<body>`. §6, not built: when the picker closes, focus goes to the row's `⋮`.                                                                                                                       |
| **2.5.3**                | §6, not built. The `⋮` has no visible text, so its accessible name can be `Actions for {lineSummary}`. The quantity keeps several private rows distinct.                                                                                                                                                                                                                                                                  |
| **2.5.8**                | §6, not built. The `⋮` is 44 × 44 on web and 48 × 48 on native. These are the house figures in `ingredientStatusExplanation.md` §3a. HIG and Material are stricter than the 24 × 24 floor.                                                                                                                                                                                                                                |
| **4.1.3**                | Unreachable: the `RefreshNotice` polite region carries the notice. The recovery, `unreachableResolved`, is **not** a live region. It is the Ingredients heading's description (web `aria-describedby`, native `accessibilityHint`). Focus lands on the heading, and the screen reader then speaks it (§3c). Restore refused: `role="alert"`, in the list and in the preview. §6, not built: picked food, `role="status"`. |

**What a screen reader says on the detail page:** "Ingredients, heading level 2. We couldn’t load the
names and nutrition of 2 ingredients just now. Your recipe hasn’t changed. Try again, button. … 3 cloves
Ingredient not loaded, checkbox, not checked. … 2 tbsp Private ingredient, checkbox, not checked."

---

## 8. Every key in this spec

| Dictionary                                             | Key                                                                                                                                                                | Status                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `recipeMessages.en.ingredientLineName` (**new block**) | `privateFood`, `removedFood`, `notLoaded`, `notSavedInVersion`                                                                                                     | new                              |
| `recipeMessages.en.detail`                             | `removedFoodNoticeOneUnnamed`, `unreachableNoticeOne`, `unreachableNoticeMany`, `unreachableResolved`, `clonePrivateFoodsBannerOne`, `clonePrivateFoodsBannerMany` | new                              |
| `recipeMessages.en.detail`                             | `removedFoodNoticeMany`, `removedFoodNoticeAll`                                                                                                                    | rewritten                        |
| `recipeMessages.en.detail`                             | `cloneUnboundDismiss` becomes `clonePrivateFoodsDismiss`                                                                                                           | renamed                          |
| `recipeMessages.en.detail`                             | `cloneUnboundBanner`, and ⛔ **`unavailableBadge`**. `RESOLVED_UNAVAILABLE` is always nameless now. The stand-in replaced the badge, so its key was dead.          | deleted                          |
| `recipeMessages.en.detail`                             | `rebindDone`, `rebindConflict`, `rebindSourceUnavailable`, `rebindLineGone`                                                                                        | reserved for §6d. **Not built.** |
| `recipeFormMessages.en`                                | `statusFoodUnreachable` (`Not loaded`, fixes D5)                                                                                                                   | new                              |
| `recipeFormMessages.en`                                | `statusExplainFoodUnreachable`, `statusExplainFoodRemovedUnnamed`, `changeFoodPickerTitle`                                                                         | new in §6. **Not built.**        |
| `recipeFormMessages.en`                                | `nutritionNoneUnavailable` (designed)                                                                                                                              | rewritten in §6. **Not built.**  |
| `recipeVersionMessages.en`                             | `versionList.restoreUnrestorableErrorOne/Many`, `preview.restoreUnrestorableErrorOne/Many`, `preview.lineCannotRestore`                                            | new                              |

Singular and plural are separate strings. That is this package's convention (`detail/model.ts:330`).
⚠️ The convention is `if (n === 1)` by another name. It is wrong for locales with more plural categories
(CLDR). The pattern is existing and package-wide, and this spec does not change it. It becomes a real
cost with a second locale.

---

## 9. Advocacy, evidence, validation, and hand-off

### Advocacy

- **I recommend (Situation B).** R9 is ruled, and I concede it: another viewer never sees a private
  food's name. The cost falls on **readers of a public recipe**. They cannot cook a line they cannot
  identify. A third option keeps R9: **warn the author at publish time or at a change of visibility**.
  For example: "2 ingredients use your private foods. Readers will see them as Private ingredient."
  This does not block the work, and this spec does not design it.
- **Conceded (Situation C).** The clone now keeps the private bindings. The banner states that honestly.
- **Conceded (Situation C).** I specified `Removed ingredient`. That was wrong: the line is still there with its
  amount, and only its food was removed. The recorded `statusFoodRemoved` ruling says the same. It is
  `Removed food`.
- **Preference, non-binding.** The three stand-ins now mix two words: `Private ingredient`, `Removed food`,
  `Ingredient not loaded`. `Private food` matches `Removed food` and the banner's "private food". This is
  judgement, not tested.
- **Departed from the brief (Situation B).** The interim re-pick commits on Save, not through the rebind
  command (§6b). The goal, a way to re-pick today, is fully met. Only the mechanism is different.

### Evidence

- **Verified.** Each `file:line` anchor, read on 2026-09-30. Defects D1 to D9. The renders in §2a, from a
  static web copy of the real classes in Chromium. The contrast ratios in §7, computed from the hex
  values in `colors.ts`, and `error-dark` on `pearl` for the preview marker (5.16:1). `editAction` is
  `Edit recipe` on both platforms. No client calls the rebind route. The build of §1 to §5, by reading its code
  on both platforms and running the detail component suites (web and native, all passing).
- **Assumed.** App detail reads always carry a token, so `FOOD_UNREACHABLE` is transient for cooks.
  Android renders dashed borders. The existing add picker can open in a replace mode. The stand-in chip
  fits the editor row at 320 px (not rendered). On a native **device**, `aria-describedby` has no effect
  (React Native passes it to its web build only). So there, the editor's link from the amount to the chip does
  nothing, and a screen-reader user reaches the chip by swiping through the row.
- **Not checked.** Native in a real render. Real screen-reader output on either platform. The Playwright specs
  were not run.
- **Judgement, with no user evidence.** All copy wording. The stand-in that replaces the badge. No tile
  for `RESOLVED_UNAVAILABLE`. No automatic polling. The editor path instead of the command. A
  five-person think-aloud on "what is Private ingredient?" tests the riskiest of these.

### Validation run

1. **Against publication.** The WCAG criteria come from the corpus (`accessibility.md`). I did not fetch
   them live today.
2. **Against prior art.** Notion's help page (fetched 2026-09-30) says backlinks to pages that only their
   owner can see "will be labelled as `Private`". That supports the word. I fetched a Slack help page
   too. It did not contain the wording, so it is **not** cited. Product prior art reused:
   `RefreshNotice`, the removed-food tile, and the pick states of AmbiguityReview.
3. **Against myself.** The counter-case: _"A chip in the name slot reads as a food called 'Private
   ingredient'. Moving the status off the right edge breaks scanning. Keep the badge and put a dash in
   the name slot."_ The answer: a screen reader says "dash", and a sighted cook learns nothing from it. A
   dashed chip with generic words cannot pass for a food name. At 320 px the right-edge scan is already
   broken, because the badge crushes the name (233 px row, measured). **What changed:** the first render
   broke words in the middle. That moved the design to one flowing text block.

### References consulted

`ux-design-corpus`: `accessibility.md`, `content-design.md`, `internationalisation.md`,
`cross-platform-translation.md`, and `critique-handoff.md` (the handoff checklist). Live source: the Notion
help page "Links & backlinks" (notion.com/en-gb/help/create-links-and-backlinks), 2026-09-30. I did
**not** load `ux-mode-playbooks`, because the ask was scaled.

### Cost, and the cheaper path (rough relative size, judgement)

- **S:** §1 to §4. The function, the stand-ins, the notices, and the banner, on both platforms, with
  tests.
- **S to M:** §5. The error class, the union member, the modal alert, and the markers.
- **M:** §6. The menu, the replace-at-index action, the picker's replace mode, both platforms, every
  test tier.
- **The 70% version, which is what shipped:** §1 to §5 now, §6 deferred. The cost: clone owners and
  removed-food lines cannot re-pick without typing the amount, unit, preparation, and section again.

### How we will know it worked

- **Unreachable:** the rate of retry presses, and the rate of retries that succeed on the first press.
  The guardrail is the count of food-service requests that retries cause.
- **Clone:** the share of cloned private lines that the owner changes within 14 days.
- **Restore:** refusals per week. A count above zero after R52 snapshots dominate justifies the cost of
  the partial-restore follow-up.

The operator or the owner reads these. None of them is instrumented today.

### Questions blocking this

None blocks §1 to §5, which are built. One decision needs the owner's approval before §6 is built: the editor
path instead of the command for the interim (§6b). Deleting `unavailableBadge` is no longer a question. §2a
made the key dead, and it is deleted (§8).

### Open follow-ups

- **Maestro, owed.** A native flow for the private-food stand-in and the clone banner:
  `.maestro/recipes/privateFoodStandIn.yaml`, with an `e2e-seed` fixture. As `coAuthor`, the fixture authors a
  private food and publishes a public recipe with one line bound to it. The flow opens the recipe from Discover,
  checks the stand-in and the checkbox label, clones the recipe, and checks the banner. It is being written. The
  unreachable and restore-refused states have no flow, because a shared sandbox cannot stage them reliably.
  Component tests cover them on both platforms, and Playwright covers the web paths with a mocked API.
- **Named-row badges** into the flowing block (§2c): built as `StatusBadge`. Four other sites wait (§2c table).
- **A native description adapter** for the editor's description links (§2c, E2 I11). No unit owns it yet.
- **The `Name not saved` chip** in the version preview (§5).
- **Conflict merge residual:** a server-only line with no saved name reaches the editor with an empty name
  field (§1).
- **Copy preference, non-binding:** `Private food` (Advocacy).

### Hand-off

- **`fe-1`:** built §1 to §5. §6 waits for the owner's approval. Check the accessibility floor first (§7).
- **`staff-architect`:** answered. An ordinary save records no correction; R17 is met through the rebind command
  only (ADR-0045). The wire field is renamed. A partial restore with consent stays a follow-up server capability.
- **Amendments owed to `docs/design/ingredientStatusExplanation.md`.** I did not edit it, because this
  brief names one output file.
    - §SPECIFY.1 and §3a, row 11: Change food and Remove.
    - Row 12: the nameless variant (the §2b stand-in and `statusExplainFoodRemovedUnnamed`).
    - New row 13, `FOOD_UNREACHABLE`: Remove only, with `statusExplainFoodUnreachable`.
    - §SPECIFY.2: the rewritten `nutritionNoneUnavailable`.
- **Adjacent, not in scope.** `nutritionPartial` says items "aren’t counted **yet**". For private and
  removed lines that is false, because they never count.

### Artefacts written

- `docs/design/namelessLineCopy.md`: this spec, a design artefact.
- `docs/design/namelessLineCopy.md` (2026-10-01): §2c amended for `StatusBadge`, its sweep sites, and the native
  description adapter.
- The render copies (`rows.html` and the PNGs) are in the session scratchpad, not in the repository.
