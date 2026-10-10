# Variant details: the dotted line and the details dialog

⛔ **DESIGN SPEC. NOT PRODUCTION CODE.** This is plan unit **U12** of
[`2026-09-26-001-feat-curated-food-catalog-seed-plan.md`](../plans/2026-09-26-001-feat-curated-food-catalog-seed-plan.md).
It replaces every earlier version of this file, including the FoodOn design of 2026-09-22.

- [`ingredientStatusExplanation.md`](./ingredientStatusExplanation.md) owns the row, its two-slot icon column,
  its `⋮` menu contract and the nutrition panel.
- [`ingredientRowRev4.html`](./ingredientRowRev4.html) owns the row's fit figures.
- [`variantDetailsMockup.html`](./variantDetailsMockup.html) is the rendered mockup for this spec. Its
  screenshots sit beside it (E1).

**Mode:** SPECIFY, with the DESIGN decisions that U12 names. **Date:** 2026-09-30. **Hat:** UI design and design
technologist. §1 wears the research hat. **I wrote everything that I evaluate here.** I rendered the line, the
dialog and the panel at 320, 390 and 768 px, and at 200% text (E1). I did not see them on a device.

**Extended 2026-10-01**, after a review of the plan widened U12. §S13 to §S18 are new. They cover the picker's search
and select states, and results across sources. They give labels that name no single source, and the Data sources
page. They decide the citations that are not an exact match, and they give a web-to-mobile table per surface. Above
§S13, only rows were appended to the tables that index the whole spec (the D-table). Everything settled there stands.

> ### Two vocabularies, kept apart on purpose
>
> **The cook sees "details".** A food in a recipe can have details, for example `flat half · select · braised`
> on beef brisket. The cook adds them with **Add details**. Search and import also add them. For that, the
> cook's words must name exactly one match.
>
> **This spec says root, variant, part and attribute.** A **root** is a catalog food (`food`). A **variant** is
> an optional, more exact entry under a root (`food_variant`). A variant is a list of **parts**. Each part has
> an **attribute** (`cut`, `grade`, `cookingMethod` and others). A recipe line is **root-bound** or
> **variant-bound**. ⛔ The words kind, typical, variant, root, part and attribute never reach a string that the
> cook can see.

---

## Governing decisions

These are owner rulings and the plan text that carries them. This spec applies each one as written.

| #   | Decision                                                                                                                                                                                                                                                                                                             | Source                                                                  | Where it lands            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------- |
| D1  | **The root has its own numbers. Variants only add.** A root-bound line reads the numbers of the root's own item. The deploy elects nothing. No variant takes the place of the root.                                                                                                                                  | owner 2026-09-26 (origin Key Decisions). Plan U12, R18, R21             | §1e, §S1, §S6             |
| D2  | **A variant has no state.** Its label parts say if its numbers are for a cooked food: a `cookingMethod` part, or `homemade`. The dialog never splits variants by state. No text uses the wording that rule 20 retired.                                                                                               | owner 2026-09-30. Naming rule 20. KTD-15                                | §2e, §S8                  |
| D3  | **A variant shows as its parts on one line, with a middle dot between parts.** The parts keep contract order. No chips. No comma-joined label on screen. Screen readers hear commas.                                                                                                                                 | origin Key Decisions. R25, R27                                          | §S4                       |
| D4  | **The details dialog is one list.** It has search at 8 or more live variants. If the three R26 conditions hold, it groups. Rows go in calorie order.                                                                                                                                                                 | R26. Plan U14                                                           | §S8                       |
| D5  | **The row's `⋮` holds `Add details` and `Edit details`. The dialog footer holds `Remove details`, in `edit` mode only.** Line type T1 is retired: a root with one or more live variants offers `Add details`.                                                                                                        | plan U12                                                                | §S7, §S8                  |
| D6  | **A root-bound line shows the root name only.** It has no details line and no hint.                                                                                                                                                                                                                                  | R28. Owner 2026-09-30                                                   | §S1                       |
| D7  | **Nothing prompts the cook to pick a detail.** No string says "kind" or "typical".                                                                                                                                                                                                                                   | owner 2026-09-22, again 2026-09-30                                      | §S11                      |
| D8  | **Search returns roots.** A query that names exactly one variant carries that variant. Picking that result binds it.                                                                                                                                                                                                 | R15, R16, R23                                                           | §S2, §S3                  |
| D9  | **A line bound to a retired variant keeps its name, parts and numbers.** With no live sibling, the dialog shows `detailsNoneLeft` with Close and Remove.                                                                                                                                                             | R29. Plan statechart                                                    | §S8.7                     |
| D10 | **A root whose own item is cooked says so for a root-bound line**, because that line shows no parts. This spec decides the words.                                                                                                                                                                                    | plan U12                                                                | §S6. Blocked on data (E3) |
| D11 | **Catalog text is English only.** Root names and parts are data. They are not translated. Interface strings are localised.                                                                                                                                                                                           | plan 002 R55e (owner 2026-09-22). Origin Scope Boundaries               | §S11                      |
| D12 | **Every string is an `IngredientDetailsMessages` key, and every state has its copy.**                                                                                                                                                                                                                                | plan U12                                                                | §S11, §S12                |
| D13 | **Live search asks every source that can answer now, and reports each one as answered, busy or skipped.** Each hit names its source. The name comes from the register. Only a source whose API can search is asked, and today that is USDA. Every static download is in the seed (owner, 2026-10-01).                | R57, R58, R52. U26 (settled 2026-10-01), U29                            | §S14                      |
| D14 | **Both apps show a Data sources page.** Each source shows its licence and link, its edition, and a statement where values were converted. It reads `GET /api/v1/foods/sources`.                                                                                                                                      | R55, R54. Plan U25                                                      | §S16                      |
| D15 | **Attribution is a legal duty.** CC BY 4.0 §3(a)(1) asks us to name the creator and link the licence. It also asks us to state each change we made to the material. §3(a)(2) accepts "a URI or hyperlink to a resource that includes the required information". Etalab 2.0, OGL and NLOD set terms of the same kind. | CC BY 4.0 legal code (fetched 2026-10-01). Plan R50, ADR-0052 (planned) | §S15, §S16                |
| D16 | **No surface names a single source.** The catalog badge and the recipe note stop saying USDA. A root that cites another source shows no "USDA" text.                                                                                                                                                                 | plan U12, U15                                                           | §S15                      |
| D17 | **A food with no numbers is a normal result.** Its numbers are absent, never `0`.                                                                                                                                                                                                                                    | R18 (restated)                                                          | §S13                      |

**Other decisions that this spec builds on, read in full:**

| Decision                                                                                                                                                                                         | Where                                                                                                      | Effect here                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| The contract order of attributes: `cut`, `bone`, `skin`, `formOrVariety`, `babyFoodStage`, `pack`, `fat`, `trim`, `grade`, `cookingMethod`, `salt`, `sugar`, `addedNutrients`, `brand`, `origin` | plan KTD-7. Naming rule 24                                                                                 | Parts show in wire order and are never re-sorted (§S4). Grouping walks this order (§S8.3). |
| Both wires carry `attribute` as an open string                                                                                                                                                   | plan KTD-15                                                                                                | A part with an unknown attribute shows in its wire position (§S4).                         |
| The dialog statechart and its state names, the `add` and `edit` entry modes, and a commit port that the host chooses                                                                             | plan "Details dialog statechart"                                                                           | §S8 and §S12 use these names.                                                              |
| A root-bound line carries `hasVariants`                                                                                                                                                          | plan U9                                                                                                    | The menu shows `Add details` with no fetch per line (§S7).                                 |
| The icon column has exactly two slots. Actions sit behind `⋮`, remedy first. The trigger's name is `Actions for {food}`                                                                          | `ingredientStatusExplanation.md` §3a                                                                       | `Add details` and `Edit details` join the existing menus (§S7).                            |
| Calories live in the panel, not on the row                                                                                                                                                       | plan 002 R30. `ingredientStatusExplanation.md` §6c                                                         | The line shows no figure. The dialog rows are the one place with a figure per variant.     |
| On a saved recipe a pick is one write-layer mutation, with no branch on connectivity. The row that failed reports the failure                                                                    | plan statechart. `offlineWriteAcceptance.md` ("failure feedback, as close to the failed item as possible") | The dialog has no commit-failure state (§S8.9).                                            |
| A parked read shows the app-wide offline slot. The slot has no retry and no copy of its own                                                                                                      | `packages/apps/commise/ui/src/offlineNotice/props.ts`                                                      | The dialog's offline state uses the shared string (§S11).                                  |

---

# 1. DISCOVER: what the cook meets

## 1a. Evidence carried forward

These measurements come from the 2026-09-22 version of this file. They are about what recipe authors write, not
about the catalog, so they still apply. Source: NYT Cooking ingredient lines, 179,207 tagged lines, 85,579
distinct, Apache 2.0, measured by [`recipeLinePrecision.py`](../reports/2026-09-22/recipeLinePrecision.py) and
recorded in [`recipeLinePrecision.txt`](../reports/2026-09-22/recipeLinePrecision.txt). ⚠️ Editors wrote these
recipes. Each share is therefore an upper bound for lines that a home cook types.

- **E-1. Most lines name the food and nothing more.** 26.3% of distinct lines have a word from the script's list
  of detail words (cut, fat, pack, salt and similar), weak words included. About three lines in four have no
  detail.
- **E-2. If a detail changes the result, authors write it.** Bone or skin on chicken breast or thigh: 68.3%.
  Salt on butter: 47.9%. Fat ratio on ground beef: 35.5%. Fat level on milk: 34.5%. Form or pack on tomatoes:
  21.6%.
- **E-3. They write it in shopper's words.** Words from a food-composition table (`separable`, `all grades`)
  occur in 20 of 85,579 lines.

## 1b. What the curated seed gives the cook, measured

I measured these on 2026-09-30. The roots and parts come from the committed
`packages/services/food-service/src/foods/seed/data/curatedCatalog.jsonl`. The energy values come from the local
USDA SR Legacy (2018-04) and Foundation (2026-04-30) CSVs in `.local-sandbox/fdc/`, read in the KTD-21 order
(1008, then 2048, then 2047). The scripts are in the session scratchpad, not in the repo. A committed measurement
belongs in the U1 parser.

| Fact                                          | Figure                                                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roots                                         | **2,641**                                                                                                                                                                       |
| Roots with no variants (no `Add details`)     | **1,416**                                                                                                                                                                       |
| Roots with 1 to 7 variants (the short list)   | **1,082**                                                                                                                                                                       |
| Roots with 8 or more variants (the long list) | **143**. 6 have 50 or more. The most is `beef ribeye steak`, with **75**                                                                                                        |
| Long lists that R26 groups (the §S8.3 rule)   | **77** of 143. The others are flat. `beef ribeye steak` is flat (E2)                                                                                                            |
| A variant's parts, joined with `·`            | median **27** characters, p90 **62**, max **103** (`lamb rib roast`: `rack roast · frenched · separable lean and fat · denuded · 0-inch trim · roasted · product of Australia`) |
| Longest root name                             | **43** characters (`frozen cranberry juice cocktail concentrate`)                                                                                                               |
| Longest hyphenated word in a part             | **18** characters (`chocolate-flavored`). The longest measurement token (`1/8-inch`) is 8                                                                                       |
| Variants with no energy value                 | **0** of 5,029. §S8.4 specifies the row with no calorie value. No committed row uses it today                                                                                   |
| Roots with no numbers (`nutrition: null`)     | **87**, for example `Aleppo pepper`, `almond extract`, `cherry tomatoes`. None of them has variants                                                                             |
| Roots whose numbers cite a USDA Branded item  | **302**                                                                                                                                                                         |

## 1c. The moments

| Moment                             | What the cook does                  | Where a detail helps                           | Where a detail gets in the way                     | Basis                               |
| ---------------------------------- | ----------------------------------- | ---------------------------------------------- | -------------------------------------------------- | ----------------------------------- |
| **Typing a line** (F1)             | writes what goes in, quickly        | their words name it: "grilled chicken breasts" | a question about it. Three lines in four have none | E-1, E-2. "A question" is judgement |
| **Importing, then reviewing** (F2) | checks that the recipe came through | the source line named it, and the app kept it  | review turns into a questionnaire                  | E-2. Judgement                      |
| **Reading and cooking** (F3)       | follows the author                  | the author's detail says what to use           | extra words that the author did not write          | judgement                           |
| **Checking nutrition**             | asks "are these my numbers?"        | always. This cook came for this                | never                                              | judgement                           |

The design follows from this. Details come from the cook's own words first (search and import, D8).
`⋮ → Add details` is for the cook who adds depth later, on purpose.

## 1e. What the rulings accept

- **A root-bound line reads the numbers of the root's own item and says nothing about details** (D1, D6). Naming
  rule 28 elected that item once, during curation. It chose a `plain` item first, then the most-eaten uncooked
  item, then the uncooked item with the middle calorie value.
- ⚠️ **For some roots, that item is cooked.** The election found no uncooked sample for them. The curation log
  counts **25** (`.local-sandbox/foodNames/seedProgress.md`, "Still open": duck legs, picnic ham, venison cuts,
  chicken feet). A word scan of the USDA text of every root item finds **51**. The extra roots are store-cooked
  products such as salami and bratwurst. For those, the cooked item is the product, and nothing needs saying.
- For the 25, a cook who weighs raw duck legs gets the numbers for roasted duck legs. D10 says that the product
  must say so. §S6 gives the words. **E3 records why today's data cannot drive them.**
- **A seed change never moves a variant-bound line** (R21). A root-bound line follows its root.

---

# 2. DESIGN

## 2a. The direction is settled

The owner and the origin settled the direction, and this spec keeps it. **The cook's words are the main way in.
`⋮ → Add details` is the second way.** The dialog is one list, not a question per attribute. The origin measured
that only 0.9% to 8.5% of attribute combinations exist for the largest roots. A question per attribute therefore
offers answers that lead nowhere.

## 2b. Is `⋮ → Add details` the right entry point?

It is the right **second** entry point. The first is the cook's words, in F1 and in import (E-2). If those words
name exactly one variant, they bind it (D8).

- ⛔ **It is not a step after the cook picks a food.** That step prompts every cook (D7).
- ⛔ **It is not a button on the row.** The icon column has exactly two slots.
- ⛔ **It is not in the nutrition panel.** A row action never lives in a popover (plan 002 R26).

## 2c. The one thing that makes this better than the obvious version

> ### ✅ **The detail reads like the label on the package, in the order you scan a package.** Under `beef brisket`: `flat half · separable lean and fat · 1/8-inch trim · select · braised`. The cut comes first and the origin last. Every part is kept. Nothing is cut short.

The obvious version prints the USDA string (`Beef, brisket, flat half, separable lean and fat, trimmed to 1/8"
fat, select, cooked, braised`), which reads like a lab report. The other obvious version makes a chip for each
part. In this app a chip means "tap to filter", so each part looks like a control. The dotted line keeps every
part and costs one line in the common case. The origin measured that dropping any one part makes 44% of variants
read the same as a sibling.

In the dialog, one more choice earns its place: **rows go in calorie order.** A cook who does not know the words
can still see which option is leaner. This is judgement, based on recognition over recall (Nielsen #6).

## 2d. The detail text is curated data

Parts are **catalog data**. People wrote and reviewed them under naming rules 17 to 26 (`namingRules.md`). The UI
shows them as the wire carries them.

- ⛔ The UI never rewrites, shortens, re-sorts or pluralises a part. It never joins parts into a sentence.
- ⛔ The UI never truncates a part or a line. Lines wrap.
- ⛔ **A measurement token never breaks at its hyphen.** A token that starts with a number and has a hyphen
  (`0-inch`, `1/8-inch`) stays on one line. The longest one in the seed has 8 characters, so it cannot
  overflow. Other hyphenated words (`chocolate-flavored`, 18 characters) can still break at the hyphen, because a
  whole 18-character word overflows at 200% text. The first render split `1/8-` from `inch trim` at 390 px (E1).
- Parts are lowercase, except proper nouns (rule 14). **The UI capitalises only the first letter of a heading**:
  a group header (`Flat half`, as in AE8) and the food name at the top of the dialog. A part in a line keeps the
  case of the data.
- The data writes `-inch`, never `"` (rule 25), so a screen reader speaks the unit. The UI adds nothing.
- Catalog text is English only (D11). In another locale, parts stay English beside translated interface text. On
  web, each part has `lang="en"`, so a screen reader in another locale says it as English (WCAG 3.1.2).

## 2e. Rejected within the design

| Rejected                                      | Why                                                                                                                                                                                                                  |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any list structure based on a variant's state | D2 and naming rule 20. A cooked variant says so in its own parts (`braised`, `roasted`), and the data carries no other axis.                                                                                         |
| Grouping by cooking method                    | No special rule excludes it. The literal R26 rule (§S8.3) never selects it on the committed seed: 0 of 143 long lists. The "first attribute that qualifies" reading selects it for 4 roots, which D2 rules out (E2). |
| Chips or badges for parts                     | D3. A chip means "tap to filter" in this app.                                                                                                                                                                        |
| A row for the root's own item in the list     | The list holds variants only (R26). `Remove details` is the way back to the root.                                                                                                                                    |
| A second line under `Add details` in the menu | The earlier caption described details as the thing you buy, and D2 retires that framing. The dialog's intro explains the action one step later. One line also keeps Label in Name (2.5.3) simple.                    |
| The food name in the pinned title             | Rendered and measured (E1). At 320 px the title took 2 lines at 100% text and up to 6 lines at 200%, and edit mode showed 2 rows. The title now repeats the menu item, and the food name scrolls.                    |
| Sticky group headers                          | Judgement. At 200% text with the keyboard open, a pinned header takes the space of the one row that remains (E1). SC 2.4.11 also forbids it covering the active row.                                                 |
| A count in each group header                  | A header shows the part of its group once (R25). A count is not a part.                                                                                                                                              |
| A question for each attribute                 | §2a.                                                                                                                                                                                                                 |

---

# SPECIFY

The surfaces below use real paths. `FR/` is `packages/apps/commise/features/recipes/src/`. `UI/` is
`packages/apps/commise/ui/src/`. On web, tokens are the Tailwind utilities from `UI/tokens/`. On native, they are
`nativeTokens` and `palette`.

## S1. Line type and what each surface shows

| Line                                                            | Visible line                                    | `⋮` gets       | Panel adds                                       |
| --------------------------------------------------------------- | ----------------------------------------------- | -------------- | ------------------------------------------------ |
| **Root-bound, root has no live variant** (`hasVariants: false`) | the root name                                   | nothing        | nothing                                          |
| **Root-bound, root has live variants** (`hasVariants: true`)    | the root name. ⛔ Nothing else (D6)             | `Add details`  | the cooked-root sentence, where it applies (§S6) |
| **Variant-bound**                                               | the root name, and the **dotted line** under it | `Edit details` | the dotted line under the heading                |
| **Variant-bound, variant retired** (R29)                        | as variant-bound, from the line's own binding   | `Edit details` | as variant-bound                                 |

- The line's parts come from **the line's own binding**, never from a new catalog read. So a retired variant
  still shows (R29).
- ⛔ The dotted line shows only on rows in `RESOLVED` and `NEEDS_REVIEW` (committed §SPECIFY.1, rows 3, 4 and 8).
  On `NEEDS_REVIEW` it sits between the name and the status sentence. A variant is never an authored food, so
  `RESOLVED_UNAVAILABLE` never has one.

**Every surface, per R24.** One primitive draws the line on all of them (§S4).

| Surface                          | File (web, then native)                                                                                                                                                               | Root-bound          | Variant-bound                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 picker results                | `packages/apps/commise/web/src/components/recipes/IngredientPicker.tsx`, `packages/apps/commise/mobile/src/components/IngredientPicker.tsx`, and the combobox that plan 002 V1 builds | root name           | a result that carries a variant: root name, dotted line under it                                                                                                          |
| Disambiguation, ambiguity review | `FR/detail/AmbiguityReview.tsx`, `.native.tsx`                                                                                                                                        | root name           | root name, dotted line under it                                                                                                                                           |
| Import review                    | `FR/parse/ParseJobReview.tsx`, `.native.tsx`                                                                                                                                          | root name           | root name only: a parse binds nothing, so parts show once the saved line binds (plan U15). ⛔ No control                                                                  |
| Recipe form row                  | `FR/form/RecipeIngredientsFields.tsx`, `.native.tsx`                                                                                                                                  | root name           | root name, dotted line under it                                                                                                                                           |
| Read view                        | `FR/detail/RecipeDetailBody.tsx`, `.native.tsx`                                                                                                                                       | root name           | root name, dotted line under it                                                                                                                                           |
| Version preview                  | `FR/versions/VersionPreviewModal.tsx`, `.native.tsx`, fed by `FR/versions/preview.ts`                                                                                                 | root name           | root name, dotted line under it                                                                                                                                           |
| Conflict view (diff and merge)   | `FR/versions/RecipeConflictView.tsx`, `.native.tsx`, fed by `FR/versions/conflictDiff.ts`                                                                                             | root name           | each side's value with its own dotted line under it; the radio and radio-group names carry the parts (R27). A rebind changes the line's identity, so it shows as two rows |
| Nutrition panel                  | the panel that plan 002 V1 builds                                                                                                                                                     | heading = root name | heading = root name, dotted line under it                                                                                                                                 |
| Filter bar                       | `FR/filters/RecipeFilterBar.tsx`, `.native.tsx`                                                                                                                                       | root name           | ⛔ **Dropped.** A filter takes a root and matches all its variants (plan U9). A filter result or chip never shows parts                                                   |

## S2. Typing a line (F1)

The name field stays the committed combobox (`ingredientStatusExplanation.md` §2a). Only its results change.

- **Search returns each root once** (R15). A synonym finds its root: "first cut brisket" gives `beef brisket`
  (AE2).
- **The words can name exactly one variant of a root.** Then the result for that root carries it (R16): the root
  name, and the dotted line on a second line. It is still one result. Picking it binds the variant. AE3:
  "fried boneless skinless chicken breasts" gives `boneless skinless chicken breasts` over `fried`.
- **The words can name several variants, or none.** Then the result is the root alone, and picking it binds the
  root.
- The result's accessible name is `ingredientDetails.suggestionWithDetails`. The pick announces
  `ingredientDetails.matchedWithDetails` in the combobox's polite status region.

## S3. Importing, then reviewing (F2)

- If a line's words name exactly one variant, the line binds it (R23). Otherwise it binds the root. A parse binds nothing
  (plan U15), so the import review shows the name only, and the recipe shows the dotted line once a saved line
  binds. There is no banner, no questionnaire and no state that only import has.
- ⚠️ A wrong variant from an import never moves in a seed change (R21). The dotted line makes it visible. The cook
  fixes it with `⋮ → Edit details` or `Remove details`.

## S4. The dotted line: `VariantPartsLine` (new primitive, plan U13)

**New in `@commise/ui`:** `UI/variantPartsLine/VariantPartsLine.tsx`, `VariantPartsLine.native.tsx`, `props.ts` and
`index.ts`, exported as `@commise/ui/variant-parts-line`. It is new because six surfaces on two platforms need the
same behaviour. Any existing text primitive lets a surface join the parts with commas.

**Why it lives in the design system, not in each surface.** The no-break rules, the screen-reader join and the
no-truncation rule each prevent a class of defect. Decided once in the primitive, they cannot regress on one
screen.

```ts
/** Props. `@commise/ui` imports no schema package, so the caller maps wire parts to their display text. */
export interface VariantPartsLineProps {
    /** Display text of each part, in WIRE order. Never empty. Never sorted here. */
    readonly parts: readonly [string, ...string[]];
    /** `secondary`: under a name (slate, body-sm). `primary`: a row in the details dialog (charcoal, body-md). */
    readonly tone: 'secondary' | 'primary';
}
```

| Rule               | Web                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Native                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Separator          | Before each part after the first: U+00A0 (no-break space), then `·` (U+00B7) in a span with `aria-hidden="true"`, then a normal space. A line can break only after a dot, and a dot never starts a line. The one exception is under Wrapping                                                                                                                                                                                                                                                     | The same characters, in one `Text`                                                                         |
| Screen reader      | A visually hidden `,` sits after each dot. The line reads `flat half, select, braised`                                                                                                                                                                                                                                                                                                                                                                                                           | The `Text` has `accessibilityLabel` = the source parts joined with `", "`                                  |
| Measurement tokens | A token that matches `^\d[\d/.]*-[a-z]+$` (case-insensitive) sits in a span with `white-space: nowrap` (§2d)                                                                                                                                                                                                                                                                                                                                                                                     | The hyphen in that token shows as U+2011 (non-breaking hyphen). `accessibilityLabel` keeps the source text |
| Language           | Each part span has `lang="en"` (D11, WCAG 3.1.2)                                                                                                                                                                                                                                                                                                                                                                                                                                                 | React Native has no per-span language. Recorded, not solved                                                |
| Wrapping           | Normal wrapping at spaces. A long part wraps inside itself. When an unbroken string overflows, `break-words` (`overflow-wrap: break-word`) breaks it. ⛔ Never `overflow-wrap: anywhere`. It lowers the line's minimum width. In a host with no `min-w-0`, the column shrank to 71 px. Then the no-break space broke, and a dot started a line (E2 I8). A primitive must survive hosts it does not know. A dot starts a line in one case only: one part and its dot are wider than the whole box | ⛔ No `numberOfLines`. No `ellipsizeMode`                                                                  |
| Truncation         | ⛔ None. No `line-clamp`, no `text-overflow`, no `max-height`                                                                                                                                                                                                                                                                                                                                                                                                                                    | ⛔ None                                                                                                    |
| Tone `secondary`   | `text-body-sm text-slate`. Slate on white is 5.24:1 (`UI/tokens/colors.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                      | `palette.slate`, `fontSize.bodySm`                                                                         |
| Tone `primary`     | `text-body-md text-charcoal` (12.68:1)                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `palette.charcoal`, `fontSize.bodyMd`                                                                      |
| Dot colour         | The text colour. ⛔ Never `mist`. The dot does the separating, and `mist` is 1.90:1                                                                                                                                                                                                                                                                                                                                                                                                              | The same                                                                                                   |
| Unknown attribute  | Shows like any other part, in its wire position (KTD-15)                                                                                                                                                                                                                                                                                                                                                                                                                                         | The same                                                                                                   |

⛔ One part shows no separator. ⛔ No surface shows a comma-joined label on screen (origin Success Criteria). The
primitive takes a `@pattern` tag under `docs/CODING_STANDARDS.md` §11.2, because it is in the design system.

## S4a. The edit row

```
 ┌──────────────────────────────────────────┬─────────┐
 │ 2 lb beef brisket                        │ (i)  ⋮  │   root-bound: the name only
 └──────────────────────────────────────────┴─────────┘
 ┌──────────────────────────────────────────┬─────────┐
 │ 2 lb beef brisket                        │ (i)  ⋮  │   variant-bound
 │ flat half · separable lean and fat ·     │         │   VariantPartsLine, tone secondary.
 │ 1/8-inch trim · select · braised         │         │   It wraps. A dot never starts a line.
 └──────────────────────────────────────────┴─────────┘
```

- The dotted line sits in the name group, so a screen reader reads it with the name. It is a separate element. It
  is never joined into the name string (the U26 rule).
- The gap between the name and the dotted line is `space-1` (4). The two read as one block (proximity).
- Height: one more line in the common case (median 27 characters). The p90 line (62 characters) takes two lines at
  320 px. The longest line (103 characters) takes 8 lines at 320 px and 200% text, with nothing clipped (E1).

## S5. The read view

- A variant-bound line shows the dotted line under the name, `tone="secondary"`. It comes **before** the cook's
  own words and notes.
- The ingredient checkbox's accessible name is `ingredientDetails.checkLabelWithDetails`.
- A root-bound line shows the name only.
- ⛔ The read view has no row action. The cook changes details in the editor.

## S6. The panel (information only)

The panel is `ingredientStatusExplanation.md` §6. This spec adds three things and changes nothing else.

1. **Variant-bound:** the dotted line under the heading (the root name, first letter capitalised),
   `tone="secondary"`.
2. **A root with no numbers** (`nutrition: null`, for example `Aleppo pepper`): the committed state "Matched, no
   figures published." (§6b). ⛔ Never `0`. No new copy.
3. **A root whose own item is cooked** (D10), on a **root-bound** line only: one sentence under the per-100 g
   basis line, `ingredientDetails.panelRootCooked` = `These numbers are for {cookingMethod} {food}.` For duck legs,
   the panel says "These numbers are for roasted duck legs." ⛔ `{cookingMethod}` comes from the root's own label
   parts (E3). It never comes from the line's `preparation` field, which holds the cook's words and never sets
   nutrition.

**Why the panel and not the line.** D6 says that a root-bound line shows the root name only. D10 says that the
line must say its numbers are for a cooked food. If the sentence sits where the line's numbers are read, both
rules hold. Calories live in the panel, not on the row (plan 002 R30). The panel is therefore the one place where a
reader meets the numbers that the sentence describes. The sentence uses the data's own word (`roasted`) and asks
nothing. ⚠️ This is my way to satisfy two rules at once. Advocacy records it as Situation B.

⛔ **E3: today's data cannot drive this sentence.** A root has no parts in the seed. KTD-15 keeps the nutrition wire
unchanged. Rule 20 forbids a state field. So nothing tells the UI that the own item of `duck legs` is roasted.
⛔ Do not get the word from the USDA text at run time. The word scan finds 51 roots, and the curation log names 25.
The extra roots (salami, bratwurst) are store products, and the sentence must not appear for them. The data
request goes to `staff-architect` and the seed owner (Hand-off).

## S7. The `⋮` menu (amends `ingredientStatusExplanation.md` §3a)

In the committed menu, the remedy for the row's state comes first. These rows have nothing wrong, so
`Change food` stays first and the new item is second.

| Row state (committed §3a) | Root-bound, `hasVariants: true`                                        | Variant-bound                                                           |
| ------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 3 `RESOLVED`, figures     | Change food · **Add details** · Remove ingredient                      | Change food · **Edit details** · Remove ingredient                      |
| 4 `RESOLVED`, no figures  | Change food · **Add details** · Create my own food · Remove ingredient | Change food · **Edit details** · Create my own food · Remove ingredient |
| 8 `NEEDS_REVIEW`          | Change food · Remove ingredient (no `Add details`, see below)          | Change food · **Edit details** · Remove ingredient                      |

- ⛔ **Row 8 (`NEEDS_REVIEW`): a root-bound line gets no `Add details`.** A variant-bound line on row 8 keeps
  `Edit details`. Decided 2026-10-02 in `docs/design/rowEditorOpenDecisions.md` item 9, which replaces this cell's
  earlier `Add details`. Two reasons:
    1. Row 8 tells the cook that the match and their words disagree (`statusExplainNeedsReview`). `Add details` assumes
       the root is right. The remedy comes first. `Change food` already reaches a variant, because a query that names
       exactly one variant binds it (§S2).
    2. Row 8's catalog figures are withheld. So the read that supplies `hasVariants` skips the line, and a read for it
       fetches figures that must not count.

    ⚠️ **Owner question O4, open.** Plan U12 says "A root with at least one live variant shows `Add details`". It names
    no exception for a row state. If the owner keeps U12 as written, `Add details` goes back on row 8. Then blueprint
    decision 4's extension applies (item 9, O4).

- Each item has one line of text and no caption (§2e).
- A root-bound line with `hasVariants: false` shows no `Add details`.
- ⛔ **While `hasVariants` is unknown** (the read is loading, parked offline, or failed), the menu has no `Add details`.
  It is never greyed, and never shown and then removed (`rowEditorOpenDecisions.md` item 9, 2026-10-02). When
  `hasVariants` arrives, nothing is announced. ⛔ **An open menu does not change.** It keeps the items it opened with.
  So `Add details` never appears above a destructive `Remove` under the cook's finger. A line picked in this session
  gets the item after the read for its ref answers. `Edit details` does not depend on the read.
- Rows 5, 6 and 7 (pending, unresolved, ambiguous) bind no root. They get nothing, and their single direct
  `Remove` slot stays (committed §3a).
- ⛔ **Focus precondition (web).** The dialog opens after the menu closes and returns focus to `⋮`. Then
  `useReturnFocusOnClose` (`UI/dialogFocus/useReturnFocusOnClose.ts`) records `⋮`, not the menu item that is about
  to unmount. Open the dialog on the next frame after the menu item's `onSelect`. The U14 test "focus returns to ⋮
  on close" holds this in place.

## S8. The details dialog

### S8.1 The sheet: `Sheet` (new primitive, plan U21)

**New in `@commise/ui`:** `UI/sheet/Sheet.tsx` (Radix Dialog), `Sheet.native.tsx` (a bottom-anchored `Modal`),
`props.ts` and `index.ts`, exported as `@commise/ui/sheet`. The recipe filter bar uses it too (§S8.1a). That
shared use is why it is a primitive and not part of this dialog.

```ts
export interface SheetProps {
    readonly open: boolean;
    /** Every close route calls this with `false`: Close, Escape, overlay, scrim, swipe, Android back, and any footer control. */
    readonly onOpenChange: (open: boolean) => void;
    /** The heading. The dialog title (h2 on web, header role on native). */
    readonly title: string;
    /** More elements that name the dialog, by id. Web `aria-labelledby` = the title's own id, then these. */
    readonly labelledBy?: readonly string[];
    /** Elements that describe the dialog, by id. Web `aria-describedby` on `Dialog.Content`. */
    readonly describedBy?: readonly string[];
    /** Localised accessible name of the icon-only close control. House form: "Close {thing}". */
    readonly closeLabel: string;
    /** `content`: as tall as its content, up to the available height. `full`: always the available height. */
    readonly size: 'content' | 'full';
    /**
     * Pinned under the title, outside the scroll region. `heading` is the label row and holds nothing focusable.
     * `controls` holds the input. While collapsed, `heading` moves into the title row. `controls` never moves.
     */
    readonly toolbar?: { readonly heading: ReactNode; readonly controls: ReactNode };
    /** The scroll region. ⛔ In a sheet with a `toolbar`, it holds no text input (the native collapse rule needs it). */
    readonly children: ReactNode;
    /** The actions, under a hairline. Pinned, unless the title row and the footer together are taller than half the sheet: then the last item of the scroll region. Hidden only while collapsed. */
    readonly footer?: ReactNode;
}
```

**Collapsed**, defined once: an on-screen keyboard is open **and** focus is in `toolbar.controls`. A sheet with no
toolbar never collapses. So the filter bar's `Done` never hides while a cook types. Past the half limit (below), it
scrolls with the facets. A cook who picks an
ingredient result can then finish with the keyboard still open. `.maestro/recipes/searchNavigation.yaml:190-198`
does exactly that.

| Rule                           | Web (Radix Dialog)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Native (`Modal`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Below 640 px (`sm`)            | Full screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | A bottom sheet, full width, top corners `radius.lg`, below the status-bar inset                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 640 px and wider               | A centred dialog, `max-w-lg`, `max-h-[85vh]`, `rounded-2xl bg-card shadow-lg`: the house dialog (`FR/collections/PullUpdatesDialog.tsx`)                                                                                                                                                                                                                                                                                                                                                                       | From 600 dp, width 560 dp at most, centred, still bottom-anchored                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Overlay                        | `bg-charcoal/40` (house)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `tint(palette.charcoal, 0.4)` (`UI/tokens/colors.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Title                          | `font-display text-heading-md font-semibold text-charcoal`. It wraps and is never clamped                                                                                                                                                                                                                                                                                                                                                                                                                      | `displayFontFace.semibold`, `fontSize.headingMd`, `accessibilityRole="header"`. No `numberOfLines`: it wraps                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Close                          | `Dialog.Close`: an icon button (×, 20 px glyph), 48 × 48, `aria-label` = `closeLabel`, `text-slate`                                                                                                                                                                                                                                                                                                                                                                                                            | `Pressable`, 48 × 48, `accessibilityLabel` = `closeLabel`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Footer                         | A decorative `border-t border-mist` hairline above it. The host supplies the controls                                                                                                                                                                                                                                                                                                                                                                                                                          | A decorative `StyleSheet.hairlineWidth` line in `palette.mist` above it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Dismiss routes                 | Close, Escape, overlay click. Each one calls `onOpenChange(false)`                                                                                                                                                                                                                                                                                                                                                                                                                                             | Close. Swipe down from the header (below). A tap on the scrim, where the scrim shows (I recommend it: web has overlay click, and neither consumer loses anything on close). Android back: `Modal.onRequestClose` calls `onOpenChange(false)`. ⛔ Not `@commise/ui/back-intercept`. An open `Modal` catches the back key and fires `onRequestClose` itself, so the press never reaches the provider (`UI/backIntercept/BackInterceptProvider.native.tsx`). `useBackIntercept` also throws with no provider mounted. `UI/confirmDialog/ConfirmDialog.native.tsx` already works this way |
| Name and role                  | Radix gives `role="dialog"`. ⛔ It does not give `aria-modal`: Radix Dialog 1.1.23 hides the rest of the page with `aria-hidden` instead. So the Sheet sets `aria-modal="true"` on `Dialog.Content` itself. The Sheet also sets `aria-labelledby` there: its own title id (a `useId` passed to `Dialog.Title`), then `labelledBy`. `aria-describedby` is `describedBy`, joined. Radix spreads these props after its defaults, so they win. With no `describedBy`, leave it unset                               | `role="dialog"`, `aria-modal` (on iOS, VoiceOver then skips the scrim), `aria-label` = `title`. The scrim is not an accessibility element. `describedBy` has no native form. The described elements follow the title in reading order, and a screen reader meets them there                                                                                                                                                                                                                                                                                                           |
| Focus on open                  | Radix `onOpenAutoFocus` moves focus to the title (`tabIndex={-1}`). If focus is already inside the content, Radix FocusScope 1.1.16 does not fire it, and child effects run first. So content that focuses its own element on mount wins (§S8.6)                                                                                                                                                                                                                                                               | On `Modal.onShow`, `moveScreenReaderFocus` to the title. Always. A mount effect runs before the modal is presented, and a parent's effect runs after its children's. So on native a child's mount focus cannot win, and content does not try (§S8.6)                                                                                                                                                                                                                                                                                                                                  |
| Focus on close                 | `useReturnFocusOnClose`, inside the Sheet                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | The host owns it. React Native cannot read where the reading cursor was, so the Sheet cannot. The host advances a close count inside its `onOpenChange(false)`, so every route counts. A pick or a removal in the details dialog closes through its commit port, not `onOpenChange`. The host advances the count there too (§S8.8). The opener carries `useScreenReaderFocusOnSignal(closeCount)`                                                                                                                                                                                     |
| Safe area                      | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `react-native-safe-area-context` on all four edges. Top: the sheet's top edge stops at the inset. Left and right: pad the whole sheet, for a camera cutout at the side. Bottom: pad the footer. With no footer, pad the end of the scroll region. It becomes a peer dependency of `@commise/ui` (plan U21)                                                                                                                                                                                                                                                                            |
| Keyboard: where the sheet sits | The sheet sits inside the visible box, not the window. The Sheet publishes `--sheet-visible-height` (`visualViewport.height`) and `--sheet-visible-top` (`visualViewport.offsetTop`). Below 640 px, the sheet's top is the box's top. That top follows iOS, which pans the page under the keyboard. From 640 px, the dialog centres on the box's centre. Its height is at most the smaller of `85vh` and the box. Measured with a modelled keyboard (E2 I5, 2026-10-01): the keyboard hides 0 px at every size | The sheet's bottom edge sits on the keyboard's top. iOS: `KeyboardAvoidingView` with `behavior="padding"`, the house form (`mobile/src/screens/RecipeEditor.tsx`). Android: the modal window resizes itself, because RN 0.86.3 sets `SOFT_INPUT_ADJUST_RESIZE` on it (`ReactModalHostView.kt:332`). ⛔ Nothing adds keyboard padding on Android, or the height counts twice. ⚠️ Not verified for an edge-to-edge window. A device check is owed                                                                                                                                       |
| Keyboard: open or not          | Open means `window.visualViewport.scale` is 1 and `window.visualViewport.height` is 150 px or more below `window.innerHeight`. The scale test stops a pinch-zoom from reading as a keyboard                                                                                                                                                                                                                                                                                                                    | `Keyboard` show and hide events, with the same floor: open means a height of 150 or more. The floor stops the small shortcut bar that an iPad with a hardware keyboard reports (likely, not verified)                                                                                                                                                                                                                                                                                                                                                                                 |
| Collapsed                      | The title row keeps its place and its Close. The title text is visually hidden and stays in the accessibility tree. `toolbar.heading` shows in its place. The footer hides. Focus in the controls comes from `focusin` and `focusout` on their wrapper                                                                                                                                                                                                                                                         | The same layout. Focus is not read. A sheet with a toolbar holds no other text input (the `children` rule), so an open keyboard there means focus is in the controls                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ⛔ Stability                   | Close and `toolbar.controls` keep the same element and the same tree position in both states. Only the title text and the heading's slot change. A remounted input loses focus, the keyboard closes, the sheet expands, and the cycle repeats. Test: the same input node keeps focus through a collapse and back                                                                                                                                                                                               | The same                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Motion                         | None                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `animationType="slide"`. If `useReduceMotion()` (`UI/motion/useReduceMotion.native.ts`) returns true or has no answer yet, `"none"`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

A hardware keyboard shows no on-screen keyboard. So for its user, nothing collapses and nothing hides.

**What a sheet shows while it closes (endorsed as built, 2026-10-03).** A sheet keeps its title and its subject until
it has gone. The host passes the last subject it had (`FR/hooks/useLastDefined.ts`), never a blank. A blank heading
for the length of the close animation reads as a fault. This is the standard close for every Sheet host, and §S8.8's
closes follow it.

**Close, focus ring (web).** `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seafoam`, the house
icon-button form (`FR/wizard/Wizard.tsx:471`). It is the ring §S9's 1.4.11 row claims. Without it, SC 2.4.7 still
passes on the browser's own outline, but the dialog has two focus styles.

**Bottom inset with a keyboard open (native).** While an on-screen keyboard is open, do not add the bottom inset.
The keyboard covers that edge, so the inset is only empty space. And the space between the title and the footer is
at its smallest then. Reasoned, not seen on a device.

**Pinned title and footer at large text (E2 I7). Owner decision: unpin past a limit.** The title row and the
footer are pinned. At large text, or on a phone held sideways with the keyboard open, they can fill the sheet.

- **Measured on web** (2026-10-01, text-only stress test, the Sheet with 12 rows): at 640×360 with no keyboard,
  the footer runs 23 px past the dialog. With a modelled keyboard on a phone held sideways (844×390 and 667×375),
  it runs 135 and 154 px past. Then `Done` is under the keyboard. The list keeps 64 px.
- **At 100% text** the footer stays inside at every size. With the same keyboard, the list keeps 42 to 58 px.
- **On native** (read in code, not measured): the title and `Done` stay pinned. On a small phone at a large font
  scale with the keyboard open, the list can drop close to 0.

**The rule.** The footer stays pinned while the title row and the footer together take at most half the sheet.
Past that limit, the footer becomes the last item of the scroll region and scrolls with the content. Close (×)
stays pinned in the title row at every size. The toolbar is not counted. One pure function decides it,
`isFooterUnpinned` (`@commise/ui/layout`), from measured heights. The sheet's height does not depend on the
decision, so the footer cannot flap. While collapsed, the footer hides, as before.

- **Web.** The footer is always the scroll region's last child. Pinned, it is `sticky bottom-0` on `bg-card`. The
  scroll region then sets `scroll-padding-bottom` to the footer's height, so no focused row hides under it (SC
  2.4.11, W3C technique C43). Unpinned, the footer is static. Only a class changes, so focus on `Done` survives a
  flip. A `ResizeObserver` measures the panel, the title row and the footer.
- **Native.** The footer renders in one of two fixed slots. Pinned, it follows the `ScrollView`. Unpinned, it is the
  `ScrollView`'s last child. `onLayout` measures the panel, the title row and the footer. A flip remounts the
  footer, so a screen-reader cursor on `Done` at that moment is lost. Flips are rare. With the keyboard open on
  Android, the rule waits on I6.
- **The cook gains** room for the list at every text size. **The cook gives up** a `Done` that is always in reach.
  Past the limit, `Done` sits at the end of the list. Close (×) is always in reach.

The build detail is in `compactHeightLayout.md` §3.

**Swipe down (native).**

- **Where it starts:** the title row, and the toolbar's heading row. Not the scroll region. Core React Native has
  no clean hand-off between a pan and a `ScrollView` at its top, and the list must keep scrolling.
- **How it starts:** the pan claims the touch on START (`onStartShouldSetPanResponder`). It cannot wait for the
  move: React Native's `Modal` takes any touch start nothing inside it took (`Libraries/Modal/Modal.js`,
  `_shouldSetResponder`), and the responder system then asks only that responder's ancestors, so a move claim inside
  the sheet is never asked (found on Android 2026-10-03; the cause is not platform-specific). A tap on Close still
  lands, because Close is deeper and is asked first.
- **During the drag:** the sheet follows the finger while the drag is downward and mostly vertical
  (`isDownwardDrag`), and only such a drag dismisses.
- **On release:** at `dy` ≥ 96 dp or `vy` ≥ 0.8 (points per millisecond), `onOpenChange(false)`. Below that, the
  sheet goes back with core `Animated`, native driver, and no overshoot: `overshootClamping: true`, or a damping
  ratio of 1. ⛔ `Animated.spring`'s defaults do overshoot. The defaults are tension 40 and friction 7. That is a
  damping ratio of about 0.73 (`react-native/Libraries/Animated/animations/SpringAnimation.js:111,154-160`,
  `SpringConfig.js:19-25`). An overshoot lifts the bottom edge of the sheet off the screen. With reduce motion on,
  it goes back at once. These are starting values. Tune them on a device.
- **No visible handle.** Apple's HIG puts a grabber on a sheet that resizes, and this sheet has no resting heights
  to resize between. Material calls its handle optional. Its screen-reader action cycles between heights, and
  this sheet has none. Close is the visible route, and the single-pointer route for SC 2.5.7. A screen reader
  takes the swipe for itself, so Close is its route too.

**Owed on a device.** The component tests run under react-native-web, and these things do not exist there:

- **Android keyboard.** Does the modal window resize, so that `Done` stays above the keyboard? This app is already
  edge to edge (`mobile/android/gradle.properties:47`), so the old filter sheet had the same window. It is not a
  new risk.
- **Android keyboard events in a `Modal`.** React Native reads the keyboard from the app's root view
  (`ReactRootView.java:950-961`), and a `Modal` is a separate window. If no event comes, a sheet with a toolbar
  never collapses on Android. The filter bar has no toolbar. The details dialog has one.
- **iOS close motion.** The Sheet renders nothing while closed, like every house `Modal`. That skips the path
  that React Native uses on iOS to keep a `Modal` on screen while it slides out (`Modal.js:278-281`). So the
  sheet can disappear at once instead of sliding. If the fix is `visible={open}` with a new panel for each open,
  focus return must then wait for `onDismiss`.
- **Screen-reader focus.** VoiceOver and TalkBack go to the title on show, and back to the opener on close.
- **TalkBack and the name.** Does TalkBack read "Filter recipes" twice: once for the sheet's label and once for
  the title?
- **The swipe thresholds.** Maestro's swipe goes to 90% of the screen height, so it proves the route, not the
  feel.
- **The title at 200% text.** It wraps and is never clamped.

### S8.1a The recipe filter bar on the Sheet (native, and web below 640 px)

`FR/filters/RecipeFilterBar.native.tsx` replaces its hand-rolled `Modal` (lines ~255-340) with
`Sheet size="content"`. The dispositions in the first table compare today's native sheet with the new one.

⛔ **Web below 640 px gets the same sheet (E2 I9).** "Web keeps its inline bar" was a port in reverse. Below
640 px, web showed all seven facet groups open above the results. That is the defect U7 fixed on native. From
640 px, web keeps its inline bar. Owed to U15. The second table gives the web dispositions.

| Element                        | Today                                                                       | On the Sheet                                                    | Disposition              | Why                                                                                                                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title                          | none. A `role="group"` wrapper speaks the name, and nothing shows it        | `title` = `barLabel`, "Filter recipes". The key exists          | added                    | SC 2.4.6. "Filters" is the trigger's own text. Maestro matches the whole string, so with that title `assertVisible: 'Filters'` passes on either node. That is the class of the `Back` collision with the system nav bar |
| Group wrapper named `barLabel` | present                                                                     | removed. The dialog carries the name                            | dropped                  | A group with the dialog's own name is read twice                                                                                                                                                                        |
| × Close                        | none                                                                        | 48 × 48. `closeLabel` = new key `filtersClose`, "Close filters" | added                    | `Done` comes after every facet chip in reading order. × comes right after the title, so a screen-reader user can leave without walking the sheet. Also: one sheet anatomy in the product                                |
| `Done`                         | footer, full width                                                          | footer, unchanged. It calls the same `onOpenChange(false)`      | kept                     | Thumb zone. The sheet has no toolbar, so it never collapses and `Done` never hides. Past the half limit (§S8.1), it scrolls as the last item, after Clear all                                                           |
| Top corners                    | `radius.xl` (28)                                                            | `radius.lg` (20)                                                | changed                  | Native cards and sheet edges use `lg` (17 files, among them `RecipeSourceTab.native.tsx`'s top corners). No other native component uses `xl`                                                                            |
| Height cap                     | 85%                                                                         | the available height (§S8.1)                                    | changed                  | The geometry that E1 measured. At 200% text, the lost 15% is rows                                                                                                                                                       |
| Hairline above the footer      | none                                                                        | the Sheet's                                                     | added                    | Pinned, content scrolls under the footer, and the line says that the list goes on. Unpinned, the line separates the end of the list from `Done`                                                                         |
| Motion                         | none                                                                        | slide. None with reduce motion                                  | added                    | The sheet shows where it came from                                                                                                                                                                                      |
| Insets                         | composed in the leaf                                                        | the Sheet's                                                     | moved into the primitive | The inset tests move with it (Hand-off)                                                                                                                                                                                 |
| Keyboard                       | on iOS, nothing avoids it. The keyboard covers `Done` and the lower results | the Sheet's                                                     | fixed in the primitive   | ⚠️ Reasoned from the platform. Not seen on iOS                                                                                                                                                                          |
| Scrim tap, swipe down          | none                                                                        | the Sheet's routes                                              | added                    | Platform convention. Each facet applies at once, so a close loses nothing                                                                                                                                               |

- **Copy.** The title reuses `barLabel`. One new key in `FR/filters/messages.ts`: `filtersClose` = `Close filters`,
  the house form (`Close compare`, `Close photo`). No other visible string changes.
- **Focus.** The trigger carries `useScreenReaderFocusOnSignal(closeCount)`. `closeCount` advances in the bar's
  `onOpenChange(false)`.
- **Longest string.** "Filter recipes" has 14 characters, about 19 at +35%. My estimate, not rendered: one line
  at 320 px and 100% text, two lines at 200%. The title wraps and is never clamped.
- **320 px:** no sideways scroll. The chip rows already wrap. **Scroll budget:** the title row is pinned. `Done` is
  pinned while the title row and `Done` together take at most half the sheet, and the facets scroll between them.
  Past that limit, `Done` scrolls as the last item. That happens on a phone held sideways with the keyboard open,
  and at very large text. A keyboard leaves a small region on a 568 pt device, so the existing flow already uses
  `scrollUntilVisible`.

**Sheet layout on web: below 640 px wide OR below 480 px tall** (built 2026-10-02, `FR/filters/useFilterBarLayout.ts`,
one media query). The height half is A0's compact-height class (`docs/design/compactHeightLayout.md`): at 844 × 390 the
inline bar put the first result at y = 921, below the fold. `staff-ux-engineer` chose the 480 px threshold.

**Web below 640 px (`sm`, the Sheet's own breakpoint).** `FR/filters/RecipeFilterBar.tsx` and its placement in
`FR/discovery/RecipeDiscoveryFrame.tsx:133`. Read in code, not rendered.

| Element                                        | Web today, below 640 px         | Web below 640 px                                                                                                                                                                                                                                                                                        | Disposition | Why                                                                                                                                         |
| ---------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Seven facet groups                             | open, inline, above the results | in the Sheet's scroll region, in the same order                                                                                                                                                                                                                                                         | moved       | The results are the job. The open groups push them down the page                                                                            |
| Trigger                                        | none                            | The native trigger's look: white, `border-border`, at least 44 px tall, its radius half that height (§S13's rule). The text is `filtersButton`, then the count badge. Its accessible name is `filtersButtonActive` while a filter applies. `Button` takes no badge, so this is the one composed trigger | added       | One way in, as on native. While the sheet is closed, the count says that filters apply                                                      |
| Count badge                                    | none                            | `bg-seafoam` with a white digit (4.67:1, `UI/tokens/colors.ts`). A 22 px floor in rem, with padding, so it grows with the text (the I10 rule)                                                                                                                                                           | added       | The same badge as native                                                                                                                    |
| Title, × Close, `Done`                         | none                            | the Sheet's title `barLabel`, Close `filtersClose`, and `Done` in the footer, full width                                                                                                                                                                                                                | added       | The native anatomy. The Sheet is full screen below 640 px (§S8.1), so the geometry differs from native's bottom sheet. The job does not     |
| Group named `barLabel`                         | present                         | removed inside the sheet. The dialog carries the name. From 640 px the inline group keeps it                                                                                                                                                                                                            | dropped     | A group with the dialog's own name is read twice                                                                                            |
| Clear all                                      | after the facets                | after the facets, in the scroll region                                                                                                                                                                                                                                                                  | kept        | It acts on the facets, so it stays with them                                                                                                |
| Focus on close                                 | none                            | back to the trigger, through the Sheet's `useReturnFocusOnClose`                                                                                                                                                                                                                                        | added       | SC 2.4.3                                                                                                                                    |
| The window leaves the Sheet layout, sheet open | none                            | the sheet closes, and focus goes to the inline bar's first control (built 2026-10-02)                                                                                                                                                                                                                   | added       | From 640 px the trigger does not exist, so focus has nowhere else to return. Each facet applies at once, so nothing is lost. A two-way door |
| The window enters the Sheet layout             | none                            | focus moves to the `Filters` trigger, so it is never left on a control that unmounted (built 2026-10-02)                                                                                                                                                                                                | added       | the inline bar's control that held focus is gone                                                                                            |

- **Copy.** No new key. `filtersButton`, `filtersButtonActive`, `barLabel` and `filtersClose` exist in
  `FR/filters/messages.ts`.
- **Keyboard.** This sheet has no toolbar, so it never collapses, and `Done` never hides. Past the half limit
  (§S8.1), it scrolls as the last item. With a keyboard open, the sheet sits in the visible box (§S8.1, I5).
- **Tests owed (U15).** A component test for each row above. A Playwright test at 320×640 that opens the sheet,
  applies a facet, closes it and finds focus on the trigger.
- ⚠️ **Open check for U15, not rendered.** A phone turned sideways is about 844×390. There the inline bar shows
  seven groups on a screen 390 px tall, and turning the phone closes an open sheet. Render 844×390 first. If the
  first result sits below the fold, the sheet rule keys on height as well as width.

**The ingredient filter at its cap (curated U9, EVALUATE 2026-10-01).** The server refuses more than
`MAX_SEARCH_FOOD_FILTERS` (6) food filters. At 6, a note takes the search box's place, and the chips stay. The place
is right: the cook looks there to add. The copy stays: `FR/filters/messages.ts` `ingredientFilterFull`, "You can
filter by up to {max} ingredients. Remove one to add another." It names the limit and the way out.

- **Native style (fixed 2026-10-02).** The note, and the `tooShort`, `searching` and no-matches lines, use
  `styles.helperText`: `nativeTokens.fontSize.bodySm`, `palette.slate` (5.24:1 on white, computed), sentence case.
  Before, they used the 11 pt upper-case `groupLabel`, so each sentence read as a second heading. Web uses
  `text-body-sm text-slate`.
- **The chips are now the only way forward.** Two changes, both platforms (built 2026-10-02):
    1. A trailing `×` glyph in each ingredient chip, hidden from screen readers. The accessible name stays
       `removeIngredientFilter`, "Remove {name}". Today an ingredient chip looks like a selected facet chip, so
       "Remove one" names an action the chip does not show.
    2. I15's 48 dp floor on native chips. I15 was severity 1. At the cap the chip is the only path, so it is now 2.
       On web the chip is about 35 px tall (14 px × 1.5, `py-1.5`, a 1 px border; read in code). That passes SC 2.5.8.
       Give it 44 CSS px, §S13's rule for the picker's controls, because a phone uses this bar by touch.
- **Long names.** A chip holds the food's name, and a name can be long. A wrapped chip with a full pill radius cuts
  its text, which is E13's defect. The chip radius is half its minimum height, as for `Button`. ⛔ This belongs in a
  design-system chip, not in this bar.
- **Native keyboard.** The input unmounts at the cap, so the on-screen keyboard closes. Nothing raises it again.
- **320 px.** The note is a paragraph and wraps. At +35% (about 89 characters) it takes about three lines in the
  Sheet at 320 px. Read in code, not rendered. No sideways scroll: the chip row already wraps.
- **Reach.** The note and the chips are in the Sheet's scroll region, and `Done` is pinned (above). Nothing moves to
  the top of the sheet.
- **Hover.** The only hover is `hover:bg-pearl` on a web option. It is decoration, and nothing depends on it.

**Focus at the cap (SC 2.4.3).** Built 2026-10-02 (web `useFocusOnSignal`, native `useScreenReaderFocusOnSignal`). Before, the picked option and the input unmounted together, so web focus dropped to
`<body>`. The next Tab starts at the top of the page, and a screen reader says nothing. The same loss happens on every
add (`visibleResults` drops the picked option) and on every chip removal (the chip unmounts). One rule covers all
three:

| Outcome                   | Web: DOM focus goes to | Native: the screen-reader cursor goes to |
| ------------------------- | ---------------------- | ---------------------------------------- |
| An add that fills the cap | the note               | the note                                 |
| Any other add             | the search input       | the search input                         |
| A chip removal            | the search input       | the search input                         |

- **Web.** The note is `<p tabIndex={-1}>` and shows the house `focus-visible` ring. It is not a live region: content
  that arrives by taking focus is already announced, so SC 4.1.3 does not apply (W3C Understanding 4.1.3: "Changes
  of context, by their nature, interrupt the user by taking focus").
  Mechanism: `useFocusOnSignal` (`UI/dialogFocus`), which moves focus only when it was lost.
- **Native.** `useScreenReaderFocusOnSignal`, as the trigger already uses. It moves the reading cursor only, so no
  keyboard rises. No `accessibilityLiveRegion`, for the reason above.
- **One ref, one counter.** The input and the note fill the same slot, and only one is mounted. So the ref goes on
  whichever node holds the slot, and the table follows: a fill mounts the note, and any other add or a removal leaves
  the input. The counter advances on each add or removal the cook makes. ⛔ Never on mount, and never when a URL
  fills the filter.
- ⚠️ **Check inside the web Sheet.** Below 640 px the bar sits in the Sheet. Radix's focus trap
  (`@radix-ui/react-focus-scope`, `handleMutations`) moves focus from `<body>` to the dialog container when the
  focused node is removed. Then `focusIfLost` may see the container, not `<body>`, and do nothing. Test it there. If it
  fails, pass the Sheet's content as `within`.
- **Tests owed (U15).** Component tests on both platforms for each row of the table, inline and in the Sheet. A
  Playwright test at 320×640 that adds six ingredients by keyboard and finds focus on the note. A Maestro flow that
  adds six and sees the note.
- **Pattern register.** The web bar gains a ref, so `@pattern` applies (`patternRegister.test.ts`). Its docblock says
  it owns no state. The counter makes that false, so the docblock changes too.

### S8.2 Layout of the dialog

```
┌ Add details ─────────────────────────────────  ✕ ┐  title (h2) + Close. Pinned.
│ Search 40 options              Calories per 100 g │  toolbar, long list only. Pinned. The caption
│ ┌────────────────────────────────────────────┐    │  heads the calorie column while the list scrolls.
│ └────────────────────────────────────────────┘    │
├───────────────────────────────────────────────────┤  ↓ scroll region starts
│ Beef brisket                                      │  the food name (heading, first letter capitalised)
│ Nutrition uses the one you pick.                  │  intro (aria-describedby)
│ Current: flat half · lean only · …                │  edit mode only
│ Flat half                                         │  group header (grouped lists only)
│   lean only · 0-inch trim · select       124 cal  │  a row: the parts, then the calories
│   lean only · 1/8-inch trim · select     124 cal  │
│   …                                               │
│ Navel end                                         │
│   lean only · product of New Zealand     194 cal  │
├───────────────────────────────────────────────────┤  ↑ scroll region ends
│ [ − Remove details ]                              │  footer, edit mode only. Pinned.
└───────────────────────────────────────────────────┘
```

| Element           | Spec                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Size              | `longList`, `searching` and `noMatches` use `size="full"`. Every other state uses `size="content"`. The sheet grows once as a long list loads, on native and on web at 640 px and wider (E8)                                                                                                                                                                                                                                                                                                                                                |
| Title             | `ingredientDetails.actionAdd` (`add`) or `ingredientDetails.actionEdit` (`edit`), the same words as the menu item. The dialog's accessible name is the title plus the food name (`labelledBy`)                                                                                                                                                                                                                                                                                                                                              |
| Toolbar           | Long list only. `toolbar.heading` is the label row, and `toolbar.controls` is the input and Clear. The label row: the visible label `ingredientDetails.searchLabelOther` (`text-body-sm font-medium text-charcoal`) at the start, and `ingredientDetails.caloriesBasis` (`text-caption text-slate`) at the end. The row wraps when both do not fit. Under it: the input, 48 px tall, `border border-slate rounded-md`, focus ring `ring-2 ring-seafoam`. A `Clear search` icon button (48 × 48) sits at the input's end while it holds text |
| Collapsed toolbar | The label row shows in the title row, before Close. Close and the input do not move (§S8.1, stability). The title stays in the accessibility tree                                                                                                                                                                                                                                                                                                                                                                                           |
| Food name         | The first item of the scroll region. `text-body-md font-semibold text-charcoal`, first letter capitalised                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Intro             | `ingredientDetails.intro`, `text-body-sm text-slate`. In a short list, `caloriesBasis` shares its row, at the end, and wraps under it when both do not fit                                                                                                                                                                                                                                                                                                                                                                                  |
| Current line      | `edit` only. `ingredientDetails.currentLine`, or `ingredientDetails.currentRetired` for a retired variant. "Current:" is `font-semibold text-charcoal`. The parts use `VariantPartsLine`, `tone="secondary"`                                                                                                                                                                                                                                                                                                                                |
| Group header      | `text-body-sm font-semibold text-charcoal`, first letter capitalised. `padding-block-start: space-5` (24), or `space-3` (12) for the first header. `padding-block-end: space-2` (8). Headers scroll with their rows (§2e)                                                                                                                                                                                                                                                                                                                   |
| Row               | Minimum height 48 on both platforms. This is Material's 48 dp, the stricter of it and Apple's 44 pt, and one value serves both platforms. Padding: `space-3` (12) block, `space-4` (16) inline. Parts: `VariantPartsLine tone="primary"`, flex basis 12rem. Calories: `text-body-sm text-slate tabular-nums`, end-aligned, sized to their content, gap `space-3`. Below 12rem of room, the calories wrap under the parts, end-aligned. The basis is in rem, so it follows text size with no breakpoint                                      |
| Check column      | 16 px at the row's start. It exists only when a **listed** row is current. A retired current variant is not listed, so the column is absent then                                                                                                                                                                                                                                                                                                                                                                                            |
| Current row       | A check glyph in `ocean-dark` (6.20:1), and the word `Current` (`ingredientDetails.tagCurrent`) under the parts in `text-caption font-semibold text-ocean-dark`. ⛔ Not a chip                                                                                                                                                                                                                                                                                                                                                              |
| Row states (web)  | Hover and keyboard-active: `bg-pearl`. Keyboard-active also has a 2 px inset `ring-seafoam` (4.67:1 on white, SC 1.4.11). Pressed (native): `bg-pearl`                                                                                                                                                                                                                                                                                                                                                                                      |
| Footer            | `edit` only. `Button variant="secondary"` from `@commise/ui/button`, label `ingredientDetails.remove`, with a decorative minus icon (the primitive requires an icon). Full width below 640 px. At 640 px and wider, end-aligned at content width. The Sheet draws the hairline above it (§S8.1)                                                                                                                                                                                                                                             |

### S8.3 Which list, and how it groups

| Live variants | List                                                                                | State                               |
| ------------- | ----------------------------------------------------------------------------------- | ----------------------------------- |
| 0             | none                                                                                | `noVariants`                        |
| 1 to 7        | the **short list**: flat, every row, no search                                      | `combined` (the plan's name for it) |
| 8 or more     | the **long list**: search pinned above. Rows grouped when R26 holds, flat otherwise | `longList`                          |

**The grouping rule.** Each clause gets its own test in `FR/details/groupVariants.ts` (plan U14).

1. **Walk the attributes in contract order** (KTD-7). For each attribute, give every row a **key**. The key is the
   text of the row's **first** part with that attribute, or _none_ if the row has no such part. The key uses the
   first part because R25 says a header shows "its part", singular.
2. **The candidate is the first attribute whose key differs between rows.** _None_ counts as a value. So a sparse
   attribute is the candidate when some rows have it and some do not.
3. **Group by the candidate only if all three R26 conditions hold.** There are at least 2 different keys that are
   not _none_. There are no more keys than half the rows. At least half the rows have a key. ⛔ **If one condition
   fails, the list is flat. Do not try the next attribute.** This is the literal reading of R26. E2 records the
   other reading and why this spec does not use it.
4. **Order.** Rows with _none_ come first, with no header. Then the groups, with headers sorted by
   `Intl.Collator(locale, { sensitivity: 'base', numeric: true })`. In the headerless block, in each group and in
   a flat list, rows go by calories, lowest first. A row with no calorie value goes after every row that has one.
   Rows with the same value go by their visible text, with the same collator.
5. **A grouped row shows its parts without the group's part.** If the group's part is the row's only part, the
   row shows its full parts, so no row is blank.

**Fixtures from the committed seed.** U14 tests each one at its boundary.

| Root                                | Rows | Candidate       | Keys and rows with a key | Result                                                                 |
| ----------------------------------- | ---- | --------------- | ------------------------ | ---------------------------------------------------------------------- |
| `boneless skinless chicken thighs`  | 7    | none            | none                     | short list, no search                                                  |
| `boneless skinless chicken breasts` | 8    | `pack`          | 1 key, 3 rows            | long list, **flat** (fails "at least 2 keys")                          |
| `beef brisket` (AE8)                | 40   | `cut`           | 5 keys, 40 rows          | grouped: Flat half 23, Navel end 4, Point end 4, Point half 4, Whole 5 |
| `ground beef`                       | 42   | `formOrVariety` | 4 keys, 34 rows          | 8 rows with no header, then Crumbles 8, Grass-fed 2, Loaf 8, Patty 16  |
| `beef chuck roast`                  | 73   | `cut`           | 11 keys, 72 rows         | grouped, with 1 row that has no header                                 |
| `beef ribeye steak`                 | 75   | `cut`           | 2 keys, 16 rows          | **flat** (fails "at least half the rows"). E2                          |

AE8's row check: the brisket group Flat half opens with `lean only · 0-inch trim · select`, **124 cal**.

### S8.4 A row

- Visible: the parts (`VariantPartsLine tone="primary"`), then the calories, end-aligned. The calories use
  `nutritionMessages.calories` (`FR/nutrition/messages.ts`, `{calories} cal`), with the value from
  `Intl.NumberFormat(locale, { maximumFractionDigits: 0 })`. ⛔ The product has one template for "N cal", and the
  dialog uses it.
- **No calorie value:** the calorie column shows `ingredientDetails.caloriesAbsent` (`no figure`). ⛔ Never `0`. The
  row sorts last (§S8.3).
- The accessible name starts with the visible text (R27, SC 2.5.3). It is `ingredientDetails.optionName`, or
  `optionNameInGroup` in a group, or the `Current` form of either. `{parts}` is the comma join. `{calories}` is the
  visible calorie text or `ingredientDetails.caloriesAbsentSpoken`. `{group}` is the group's part.

### S8.5 Search (long list)

- Every typed word must match the start of a word in **one** of the row's parts, the group's part included. Case
  and accents do not matter (`Intl.Collator` with base sensitivity). Word order does not matter.
- The grouping comes from the full list, once. Search **hides** rows and never regroups. A group with no match
  disappears with its header, and the order stays the same. A list that regroups moves under the cook's eyes on
  each key press.
- 500 ms after the last key press, a polite announcement gives `ingredientDetails.searchCount`.
- At zero results, the state goes from `searching` to `noMatches`. The scroll region shows
  `ingredientDetails.noMatches`, and the `Clear search` control is the way out. Clearing returns to `longList`.
- ⛔ Typing never commits. Escape closes the dialog. Escape does not clear the search. The Clear control does.

### S8.6 Opening in `add` or `edit` mode

|                           | `add` (from `Add details`, root-bound) | `edit` (from `Edit details`, variant-bound)              |
| ------------------------- | -------------------------------------- | -------------------------------------------------------- |
| Title                     | `actionAdd`                            | `actionEdit`                                             |
| Current line              | none                                   | `currentLine`, or `currentRetired` for a retired variant |
| `Current` on a row        | none                                   | on the line's variant, if it is listed                   |
| Footer                    | none                                   | `Remove details`                                         |
| Focus on load, short list | the first row                          | the current row. The first row if it is not listed       |
| Focus on load, long list  | the search input, no active row        | the search input, with the current row active            |

⛔ `Remove details` exists only in `edit`. The state `detailsNoneLeft` exists only in `edit` (plan statechart).

⛔ **The two "focus on load" rows are web only.** On web, the dialog focuses its row or its input on mount. The
Sheet leaves that focus alone (§S8.1). On native, the Sheet puts the reading cursor on the title at
`Modal.onShow`, in every mode. The dialog does not move it at mount. Later, the native dialog moves the cursor
only on a signal, with `useScreenReaderFocusOnSignal`. Example: the `loadFailed` text in `error` (§S12, row 18).

### S8.7 A retired current variant

- **Live siblings remain.** The list shows the live variants. The retired one is not listed (R26). The current line
  is `ingredientDetails.currentRetired`. It says that the cook cannot pick it again after a change. That
  consequence is true, material and neutral, so it passes the deceptive-pattern test: it informs the decision and
  does not distort it.
- **No live sibling remains.** The state is `detailsNoneLeft`. The scroll region shows `currentLine` and
  `ingredientDetails.noneLeft`. The footer shows `Close` (`ingredientDetails.dismiss`, `secondary`) and then
  `Remove details`. Focus goes to the title.

### S8.8 Commit, close and remove

| Action                              | Result                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pick the current row                | `picked`, then `dismissed`. The dialog closes. Nothing is written or announced                                                                                                                                                                                                         |
| Pick another row                    | `picked`, then `committed`. The dialog closes. The line shows the new dotted line at once. A `role="status"` region announces `statusAdded` (`add`) or `statusChanged` (`edit`)                                                                                                        |
| `Remove details`                    | `removed`. The dialog closes. The line goes back to the root and shows the name only. The region announces `statusRemoved`. No confirmation: adding again is one step, and the retired case states its cost in the copy                                                                |
| Close, Escape, overlay, swipe, back | `dismissed`. Nothing is written                                                                                                                                                                                                                                                        |
| Focus after every close             | the row's `⋮` trigger. The menu item that opened the dialog no longer exists (APG's named exception). On native, the host's close count does it. The host advances it for every outcome, because a pick or a removal closes through the commit port, not `onOpenChange(false)` (§S8.1) |

### S8.9 Where a pick is written

The host gives the dialog its commit port. The dialog never branches on it (plan statechart).

- **A saved recipe:** one line mutation through the horizontal write layer. It applies at once, with no branch on
  connectivity. ⛔ The dialog has no in-flight state and no failure state. The server can reject the mutation.
  Then the **ingredient row** shows it, as `offlineWriteAcceptance.md` requires: `role="alert"` with
  `ingredientDetails.saveRejected`, and no Retry. A refused write offers a way to change it, and
  `⋮ → Edit details` is that way.
- **The create and edit form, for a new line:** the host's local form value. The recipe save carries it.
  Nothing is sent here, so nothing can fail here. Import review hosts no dialog: a parse binds nothing (plan U15).

## S9. Accessibility contract: WCAG 2.2 AA

The claim is **WCAG 2.2 AA**, this repo's floor. `CLAUDE.md` and `docs/CODING_STANDARDS.md` state no stricter level.

**Patterns (W3C APG).** The dialog is a **Dialog (Modal)**. The short list is a single-select **Listbox**, and
selection does **not** follow focus. The arrow keys move focus. Enter or Space commits. Only the current row has
`aria-selected="true"`. The long list is a **Combobox** (the search input) that controls a listbox that is always
open, through `aria-activedescendant`. In it, `aria-selected` follows the active row, so "Current" goes in the
accessible name. Each group is `role="group"`, with `aria-labelledby` set to its header.

| SC                      | Contract                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.3.1 / 1.3.2           | DOM order is visual order: title, Close, search label, caption, input, food name, intro, current line, groups and rows, footer. In a row: parts, `Current`, calories. Groups are real groups (web `role="group"`, native a header-role title over its rows)                                                                                                                               |
| 1.4.1                   | Current is a check glyph **and** the word `Current`. Never colour alone                                                                                                                                                                                                                                                                                                                   |
| 1.4.3                   | Text on white: charcoal 12.68:1, slate 5.24:1, ocean-dark 6.20:1 (`UI/tokens/colors.ts`). Slate on `pearl` (hover) is 4.81:1                                                                                                                                                                                                                                                              |
| 1.4.11                  | The input border is `slate`. The focus ring and the active-row ring are `seafoam`, 4.67:1. The check glyph is `ocean-dark`. The `mist` hairlines are decorative                                                                                                                                                                                                                           |
| 1.4.4 / 1.4.10 / 1.4.12 | At 200% text and 320 px, nothing is clipped and nothing scrolls sideways. Only the list scrolls. Measured in E1                                                                                                                                                                                                                                                                           |
| 2.1.1                   | Short list: Up, Down, Home and End move focus. Enter or Space commits. Long list: Up and Down move the active row. Enter commits. ⛔ Space types into the search. Tab reaches Close, the input, Clear, the list and the footer                                                                                                                                                            |
| 2.1.2 / 2.4.3           | No trap. Focus on load follows §S8.6. On close, focus returns to `⋮` (§S7 precondition). On native, the host's close count does it (§S8.1). While the list loads, focus stays on the title. When the list arrives, web moves focus only if it is still on the title (`focusIfLost`, `UI/dialogFocus/focusIfLost.ts`). Native does not move it, because it cannot read where the cursor is |
| 2.4.6                   | The title names the task. The dialog's name adds the food                                                                                                                                                                                                                                                                                                                                 |
| 2.4.11                  | The active row scrolls into view with `block: 'nearest'`. The toolbar, the footer and the keyboard never hide all of it. Headers do not stick (§2e). Measured in E1                                                                                                                                                                                                                       |
| 2.5.3                   | Every accessible name starts with the visible text. Each menu item has one visible line. The icon-only Close and Clear controls have no visible text, so 2.5.3 does not apply to them                                                                                                                                                                                                     |
| 2.5.7 / 1.4.13          | Not applicable. Nothing needs dragging and nothing shows on hover. On native, the Close button is the single-pointer way to do what swipe-to-dismiss does                                                                                                                                                                                                                                 |
| 2.5.8                   | Rows, Close, Clear and the footer buttons are 48 px or more on both platforms. Measured in E1                                                                                                                                                                                                                                                                                             |
| 3.1.2                   | Parts have `lang="en"` on web (§S4). ⚠️ A control with its own explicit name (a dialog option, a picker result, a checkbox label) is named by a flat string, so there the parts lose the marking. Recorded, not solved                                                                                                                                                                    |
| 3.2.2                   | Typing filters and never commits. The arrow keys never commit                                                                                                                                                                                                                                                                                                                             |
| 3.3.2                   | The search has a visible label, in the pinned label row, in both header forms                                                                                                                                                                                                                                                                                                             |
| 4.1.2                   | The dialog has `aria-modal`. `aria-labelledby` points to the title and the food name (`labelledBy`). `aria-describedby` points to the intro and the current line (`describedBy`, §S8.1)                                                                                                                                                                                                   |
| 4.1.3                   | Polite: `searchCount`, `noMatches`. `role="status"`: `statusAdded`, `statusChanged`, `statusRemoved`, `matchedWithDetails`. `role="alert"`: `saveRejected`, `loadFailed`. Native uses `LiveRegion` from `@commise/ui/live-region` (`politeness="polite"`, `visuallyHidden` for the count)                                                                                                 |

**What a screen-reader user hears** (brisket, `add` mode): "Add details, Beef brisket, dialog. Nutrition uses the
one you pick. Search 40 options, combo box, expanded." Down arrow: "lean only, 0-inch trim, select, 124 cal, flat
half, 1 of 40." Enter: the dialog closes, and the user hears "Details added: flat half, lean only, 0-inch trim,
select." Focus is on "Actions for beef brisket, menu button".

## S10. Cross-platform dispositions (translate the job)

| Element                                | Web                                                   | Native                                                                                                                                      | Disposition                    | Why                                                                                                                                                                                                                                       |
| -------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dialog container                       | Radix Dialog. Full screen below 640 px, centred above | a bottom sheet, content or full height, 560 dp wide at most from 600 dp                                                                     | **moved**                      | Reach: a bottom sheet puts the list and the footer in the thumb zone                                                                                                                                                                      |
| `Remove details`                       | footer, full width below 640 px                       | footer above the home indicator, full width                                                                                                 | **moved** to the bottom edge   | Thumb zone. It is also far from `Remove ingredient`, which is in the row menu                                                                                                                                                             |
| Close                                  | icon button in the header                             | icon button in the header. Also swipe down from the header, a tap on the scrim, and Android back through `Modal.onRequestClose`             | kept, **plus** platform routes | Platform convention. The visible button does what each gesture does                                                                                                                                                                       |
| Search                                 | combobox with `aria-activedescendant`                 | `TextInput`. Rows have `accessibilityRole="button"` and `accessibilityState={{ selected: isCurrent }}`. The count goes through `LiveRegion` | **moved**                      | React Native has no `aria-activedescendant`                                                                                                                                                                                               |
| Header collapse with the keyboard open | `visualViewport` detection                            | `Keyboard` events, the same 150 floor. Focus is known from the no-input-in-`children` rule (§S8.1)                                          | kept                           | Same rule, platform detection                                                                                                                                                                                                             |
| Group header                           | the label of a `role="group"`                         | a `Text` with `accessibilityRole="header"` over its rows, inside the Sheet's `ScrollView`. Not a `SectionList`                              | kept                           | The Sheet's scroll region is a `ScrollView`, and React Native reports a virtualized list inside one as an error, because windowing then breaks. The longest list has 75 rows, which need no virtualizing. A plain view never sticks (§2e) |
| Arrow keys, Home, End, Enter commit    | yes                                                   | none. A tap commits                                                                                                                         | **dropped** on touch           | A phone has no keyboard unless one is connected. A connected keyboard gets the platform's own focus moves                                                                                                                                 |
| Hover row highlight                    | `bg-pearl`                                            | pressed state `bg-pearl`                                                                                                                    | **collapsed** into press       | Touch has no hover. Nothing depends on it                                                                                                                                                                                                 |
| Right-click, drag                      | none                                                  | none                                                                                                                                        | stated absent                  | not applicable                                                                                                                                                                                                                            |
| `lang="en"` on parts                   | yes                                                   | not available                                                                                                                               | **dropped**, recorded          | React Native has no language per span. Parts stay English in every locale (D11)                                                                                                                                                           |
| Measurement-token hyphen               | a `nowrap` span                                       | U+2011 in the visible text only                                                                                                             | kept, per-platform mechanism   | Same rule (§2d)                                                                                                                                                                                                                           |

**Primary action per platform.** The dialog has no primary button, because the rows are the action. On a phone,
the list fills the sheet from the search down. The lower rows are in the thumb zone, and the footer is at the
bottom edge on both platforms.

**Longest strings.** The longest parts line has 103 characters. The longest root name has 43. The longest fixed
string is `currentRetired`: about 100 characters in English, about 135 at +35%. All of them wrap, and none is
clamped. Only the title and the toolbar are pinned. The title is now 12 characters (`Add details`,
`Edit details`) and takes one line at every width and text size in E1. ⛔ The footer label has 14 characters
(`Remove details`). At +35% and 200% text it wraps inside a full-width button, and the button grows. It is never
cut short.

**320 CSS px:** no horizontal page scroll. The list is the only scroller (E1). **Scroll budget:** at 100% text,
without scrolling, the title, the search and three rows or more (E1). The one exception is the retired state at
320 px, which shows one row. There the `currentRetired` sentence comes first on purpose, because it states the
cost of a change before the cook makes one. **Keyboard open:** the search, and the
active row (fully at 100% text, at least partly at 200%, E1). **RTL:** the layout mirrors, with logical properties
throughout, so the calorie column moves to the inline start. The check glyph, the close glyph and the `·` do not
mirror.

## S11. Copy and keys: `FR/messages.ts`, `IngredientDetailsMessages`

The keys go into `RecipeMessages` as `ingredientDetails`, with `en` in `recipeMessages` and the other locales in
`packages/apps/commise/i18n` (plan U14). `{food}` is the root name. `{parts}` is the parts joined with `", "`.
Plurals follow the `…One` and `…Other` convention of this file (E9).

| Key                                               | `en`                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actionAdd` · `actionEdit`                        | `Add details` · `Edit details`. The menu item and the dialog title use the same key, so the two cannot drift                                            |
| `close`                                           | `Close details` (the accessible name of the icon button, in the house form "Close {thing}")                                                             |
| `dismiss`                                         | `Close` (the visible footer button in `detailsNoneLeft`). It differs from `close`, so the two controls do not share a name                              |
| `intro`                                           | `Nutrition uses the one you pick.`                                                                                                                      |
| `caloriesBasis`                                   | `Calories per 100 g`                                                                                                                                    |
| `searchLabelOther`                                | `Search {count} options`. A long list always has 8 or more                                                                                              |
| `searchClear`                                     | `Clear search` (the accessible name of the icon button)                                                                                                 |
| `searchCountOne` · `searchCountOther`             | `1 of {count} options` · `{shown} of {count} options`                                                                                                   |
| `noMatches`                                       | `Nothing matches “{query}”. Clear the search to see all {count}.`                                                                                       |
| `currentLine`                                     | `Current: {parts}`                                                                                                                                      |
| `currentRetired`                                  | `Current: {parts}. It's no longer listed, so if you change it, you can't pick it again.`                                                                |
| `tagCurrent`                                      | `Current`                                                                                                                                               |
| `caloriesAbsent` · `caloriesAbsentSpoken`         | `no figure` · `no calorie figure`                                                                                                                       |
| `optionName` · `optionNameInGroup`                | `{parts}, {calories}` · `{parts}, {calories}, {group}`                                                                                                  |
| `optionNameCurrent` · `optionNameCurrentInGroup`  | `{parts}, Current, {calories}` · `{parts}, Current, {calories}, {group}`                                                                                |
| `remove`                                          | `Remove details`                                                                                                                                        |
| `loading`                                         | `Loading details…`                                                                                                                                      |
| `loadFailed` · `retry`                            | `We couldn't load the details. Your ingredient hasn't changed.` · `Try again`                                                                           |
| `noVariants`                                      | `There are no details to pick for {food} right now. Your ingredient hasn't changed.`. `{food}` never starts the sentence: most root names are lowercase |
| `noneLeft`                                        | `There are no other details for {food} now. Your recipe keeps these numbers. If you remove the details, you can't add them back.`                       |
| `statusAdded` · `statusChanged` · `statusRemoved` | `Details added: {parts}.` · `Details changed: {parts}.` · `Details removed.`                                                                            |
| `saveRejected`                                    | `The details didn't save, so this ingredient is unchanged.`                                                                                             |
| `suggestionWithDetails`                           | `{food}, {parts}`                                                                                                                                       |
| `matchedWithDetails`                              | `Matched: {food}, {parts}. Nutrition is counted now.`                                                                                                   |
| `checkLabelWithDetails`                           | `{quantity} {food}, {parts}`                                                                                                                            |
| `panelRootCooked`                                 | `These numbers are for {cookingMethod} {food}.`                                                                                                         |

**Used again, not copied:**

- **Offline:** `offlineNoticeMessages.readOffline`
  (`packages/apps/commise/features/core/src/offline/messages.ts`: `Waiting for a connection. This loads on its
own.`), shown by `OfflineReadSlot` (`@commise/ui/offline-notice`). The slot's contract says that the caller
  passes this shared string. A copy in this key set makes a second representation of one sentence.
- **Calories:** `nutritionMessages.calories` (`FR/nutrition/messages.ts`, `{calories} cal`).
- **Panel with no numbers:** the committed "Matched, no figures published." (`ingredientStatusExplanation.md` §6b).
- **Menu trigger name:** `ingredientActionsMenuLabel`, `Actions for {food}` (committed §3a).

⛔ No string that the cook sees says kind, typical, variant, root, part, attribute or FoodOn. No string uses the
wording that rule 20 retired. ⛔ No string is built from fragments at run time. Each sentence is one template.

## S12. Every state

| #   | Where  | State                                                               | What happens, and the copy                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | F1     | plain query                                                         | roots only                                                                                                                                                                                                                                                                                                                                                                  |
| 2   | F1     | the words name exactly one variant                                  | one result: the root name, the dotted line under it (§S2)                                                                                                                                                                                                                                                                                                                   |
| 3   | F1     | the words name several variants, or none                            | the root alone                                                                                                                                                                                                                                                                                                                                                              |
| 4   | F1     | search loading, failed or offline                                   | the committed F1 states, unchanged                                                                                                                                                                                                                                                                                                                                          |
| 5   | Import | one variant named                                                   | variant-bound once the recipe is saved (U9). The recipe shows the dotted line; the import review shows the name only                                                                                                                                                                                                                                                        |
| 6   | Import | several or none                                                     | root-bound once saved. The name only                                                                                                                                                                                                                                                                                                                                        |
| 7   | Row    | root-bound, `hasVariants: false`                                    | the name. No `Add details`                                                                                                                                                                                                                                                                                                                                                  |
| 8   | Row    | root-bound, `hasVariants: true`                                     | the name only. `Add details` in `⋮`. ⛔ Not on the row spec's row 8 (`NEEDS_REVIEW`). That row has no `Add details` (§S7, and `rowEditorOpenDecisions.md` item 9, 2026-10-02). Owner question O4 is open                                                                                                                                                                    |
| 8a  | Row    | root-bound, `hasVariants` unknown (loading, parked offline, failed) | the name only. No `Add details` until `hasVariants` arrives, and nothing is announced then. An open menu keeps the items it opened with (§S7, `rowEditorOpenDecisions.md` item 9)                                                                                                                                                                                           |
| 9   | Row    | variant-bound                                                       | the name and the dotted line. `Edit details` in `⋮`                                                                                                                                                                                                                                                                                                                         |
| 10  | Row    | variant-bound, variant retired                                      | as row 9, from the line's own binding (R29)                                                                                                                                                                                                                                                                                                                                 |
| 11  | Row    | the server rejected a pick                                          | `role="alert"` with `saveRejected`, on the row. No Retry                                                                                                                                                                                                                                                                                                                    |
| 12  | Row    | first run                                                           | ⛔ no coach mark, hint or badge                                                                                                                                                                                                                                                                                                                                             |
| 13  | Row    | 200% text, 320 px                                                   | the dotted line wraps. It is never clamped (E1)                                                                                                                                                                                                                                                                                                                             |
| 14  | Panel  | variant-bound                                                       | heading, dotted line, numbers                                                                                                                                                                                                                                                                                                                                               |
| 15  | Panel  | root with no numbers                                                | the committed "Matched, no figures published." Never 0                                                                                                                                                                                                                                                                                                                      |
| 16  | Panel  | root-bound, the root's own item is cooked                           | `panelRootCooked` under the basis line. ⛔ Blocked on data (E3)                                                                                                                                                                                                                                                                                                             |
| 17  | Dialog | `loading`                                                           | Title and Close show at once. `loading` in a `role="status"` region. Three skeleton rows keep the height. No search yet                                                                                                                                                                                                                                                     |
| 18  | Dialog | `error`                                                             | `loadFailed` in `role="alert"`, and `retry` (secondary Button). Retry goes back to `loading`. Web: focus goes to Retry, and the alert speaks the message. Native: the reading cursor goes to the `loadFailed` text, and Retry is next. iOS does not speak an alert role by itself (`UI/liveRegion/LiveRegion.native.tsx`), so a cursor on Retry leaves the failure unspoken |
| 19  | Dialog | offline (a parked read)                                             | `OfflineReadSlot` with `readOffline` in place of the list. ⛔ No retry, no spinner. It resumes on its own                                                                                                                                                                                                                                                                   |
| 20  | Dialog | `noVariants`                                                        | `noVariants`. Close only. Focus goes to the title                                                                                                                                                                                                                                                                                                                           |
| 21  | Dialog | `combined`, `add`                                                   | short list. No row marked. No footer                                                                                                                                                                                                                                                                                                                                        |
| 22  | Dialog | `combined`, `edit`                                                  | short list. Current line, `Current` row, footer                                                                                                                                                                                                                                                                                                                             |
| 23  | Dialog | `longList`, flat                                                    | search. Rows by calories                                                                                                                                                                                                                                                                                                                                                    |
| 24  | Dialog | `longList`, grouped                                                 | search. Rows with no header, then the groups (§S8.3)                                                                                                                                                                                                                                                                                                                        |
| 25  | Dialog | `searching`                                                         | rows hidden, never regrouped. The count is announced                                                                                                                                                                                                                                                                                                                        |
| 26  | Dialog | `noMatches`                                                         | `noMatches`, and `Clear search`                                                                                                                                                                                                                                                                                                                                             |
| 27  | Dialog | `edit`, current variant retired, siblings remain                    | `currentRetired`. The retired row is not listed. No check column                                                                                                                                                                                                                                                                                                            |
| 28  | Dialog | `detailsNoneLeft`                                                   | `currentLine` and `noneLeft`. Footer: `Close` (`dismiss`), then `Remove details`                                                                                                                                                                                                                                                                                            |
| 29  | Dialog | a row with no calorie value                                         | `no figure`, sorted last in its group or list                                                                                                                                                                                                                                                                                                                               |
| 30  | Dialog | `picked`, then `dismissed` (the current row)                        | the dialog closes. Nothing is written or announced                                                                                                                                                                                                                                                                                                                          |
| 31  | Dialog | `picked`, then `committed`                                          | the dialog closes. The line updates. `statusAdded` or `statusChanged`                                                                                                                                                                                                                                                                                                       |
| 32  | Dialog | `removed`                                                           | the dialog closes. The name only. `statusRemoved`                                                                                                                                                                                                                                                                                                                           |
| 33  | Dialog | on-screen keyboard open                                             | the label row moves into the title row. Close and the input do not move. The footer is hidden. The active row scrolls into view (E1)                                                                                                                                                                                                                                        |
| 34  | Dialog | 200% text, 320 px                                                   | nothing clipped, no sideways scroll. Only the list scrolls (E1)                                                                                                                                                                                                                                                                                                             |

## S13. The picker: search and select (both platforms)

Two hosts do the F1 job. Today the hosts are the picker components,
`packages/apps/commise/web/src/components/recipes/IngredientPicker.tsx` and
`packages/apps/commise/mobile/src/components/IngredientPicker.tsx`. After plan 002 V1, the host is the combobox in the
name field (`ingredientStatusExplanation.md` §2a). That spec plans to delete the picker components (its §8b). So the
rules below are for the job, and they bind the host that ships. The row spec's §4 already owns some combobox states.
For those, this section names the row spec's key and adds only what is new.

**What the picker components did before V32** (read 2026-10-01). The native fixes in this table are built (V32, the
landscape and picker-state work of 2026-10-01): the native picker now has P3, P6, P8 and P9, and its clear, correction
and action controls are 48 dp. One gap remained, the live panel's place. `rowEditorOpenDecisions.md` items 1 and 2
(2026-10-02) close it, and items 1 to 3 replace the two last rows below. In this section, "item N" is
`rowEditorOpenDecisions.md` item N.

| Gap                                        | Web                                                                                                          | Native (before the fix)                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Main search loading                        | `IngredientRowsSkeleton`                                                                                     | Nothing rendered. The `searching` kind had no branch                                                                   |
| Main search failed                         | `picker.errorTitle`, `role="alert"`                                                                          | Nothing rendered. `results.isError` was never read                                                                     |
| Catalog unavailable, own ingredients shown | `role="status"`                                                                                              | A plain `Text`, so a screen reader was not told                                                                        |
| Offline: the read is parked                | The skeleton stayed up for the whole outage                                                                  | Nothing rendered                                                                                                       |
| The clear control                          | the browser's own                                                                                            | An 18 dp glyph with `hitSlop={8}`: 34 dp, under Material's 48 dp                                                       |
| The correction control                     | ⛔ No longer inside a result: an option cannot hold a control (item 3). ⚠️ Its survival is owner question O1 | the same. If it survives, it is a post-pick offer in the row's status line (item 3)                                    |
| The live-search panel's place              | ⛔ Closed: the option's group, `From USDA`, directly after the live-search option (items 1 and 2)            | the same. The authored-food form is a Sheet, never inline, so nothing sits between the option and its results (item 1) |

**Every state.**

| #   | State                                                       | Web                                                                                                                                                                                                                                                                                                                                      | Native                                                                                                                                                                                                                                                                            | Copy                                                                                                       | Announced                            |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| P1  | Empty field                                                 | No list                                                                                                                                                                                                                                                                                                                                  | No list                                                                                                                                                                                                                                                                           | combobox: the row spec's `ingredientNameEditableHint`                                                      | nothing                              |
| P2  | Below the search minimum                                    | The existing guidance. No actions                                                                                                                                                                                                                                                                                                        | The same                                                                                                                                                                                                                                                                          | `ingredientSearch.tooShort` (shared, existing)                                                             | nothing (its existing rule)          |
| P3  | Searching                                                   | `IngredientRowsSkeleton`, 3 rows (existing)                                                                                                                                                                                                                                                                                              | ⛔ New: `mobile/src/components/IngredientRowsSkeleton.tsx`, the web one's twin. 3 rows of 48 dp in `palette.pearl`, hidden from screen readers. The caption is the content of a polite `LiveRegion`. When `useReduceMotion()` is true or has no answer yet, the rows do not pulse | `ingredientPickerSearch.searching` (new, shared)                                                           | polite                               |
| P4  | Results                                                     | Two groups: "Your foods" (the cook's authored foods), then "Food catalog" (`rowEditorOpenDecisions.md`, S5 list contract). ⛔ No badge on any row. An authored option's accessible name is `ownFoodName` (§S15)                                                                                                                          | The same                                                                                                                                                                                                                                                                          | the existing section titles. The count: the row spec's `ingredientSuggestionCountOne` or `…Other` (item 5) | polite, once results settle (item 5) |
| P5  | A result that carries a variant, beside results that do not | §S2: the root name, then the dotted line. Names stay at the start edge. Nothing indents                                                                                                                                                                                                                                                  | The same                                                                                                                                                                                                                                                                          | `ingredientDetails.suggestionWithDetails`                                                                  | nothing                              |
| P6  | Partial: one group is unavailable, the other shows          | The existing `role="status"`                                                                                                                                                                                                                                                                                                             | ⛔ Fix: a polite `LiveRegion`, mounted empty                                                                                                                                                                                                                                      | `ingredientCatalogUnavailable` or `ingredientAuthoredUnavailable` (S5 list contract)                       | polite, after the count (item 5)     |
| P7  | No match                                                    | The no-match message, then the `Not listed?` group (item 1)                                                                                                                                                                                                                                                                              | The same                                                                                                                                                                                                                                                                          | the row spec's `ingredientNoSuggestions` (item 5)                                                          | polite (item 5)                      |
| P8  | The search failed                                           | `role="alert"`. The `Not listed?` group stays: Find nutrition, Use as written and Search USDA still work (items 1 and 2)                                                                                                                                                                                                                 | ⛔ Fix: an assertive `LiveRegion`, mounted empty. The `Not listed?` group stays                                                                                                                                                                                                   | `ingredientPickerSearch.failed` (new, shared). It replaces web's `picker.errorTitle`                       | assertive                            |
| P9  | Offline: the read is parked                                 | a plain status line with `readOffline`, in the skeleton's place, spoken once on the polite channel (`rowEditorOpenDecisions.md`, ruling 2 after B6a; never `OfflineReadSlot` inside the list). ⛔ No retry. The `Not listed?` group stays enabled, because a write is never disabled ahead of time (`offlineWriteAcceptance.md`, item 2) | The same                                                                                                                                                                                                                                                                          | `offlineNoticeMessages.readOffline` (shared, existing)                                                     | polite, once                         |
| P10 | A result whose food has no numbers                          | No mark before the pick (below). After the pick: `addedNoFigures`                                                                                                                                                                                                                                                                        | The same                                                                                                                                                                                                                                                                          | `ingredientPickerStatus.addedNoFigures` (new)                                                              | polite                               |
| P11 | A catalog pick is in flight                                 | The existing `addingFromCatalog`                                                                                                                                                                                                                                                                                                         | The same                                                                                                                                                                                                                                                                          | existing                                                                                                   | polite                               |
| P12 | Selected (picker component)                                 | The always-mounted `added` region. Focus goes back to the field through `focusIfLost` (existing)                                                                                                                                                                                                                                         | The same region. Screen-reader focus goes back to the field through `moveScreenReaderFocus` (existing)                                                                                                                                                                            | `added`, or `addedWithDetails` for a variant pick, or `addedNoFigures`                                     | polite                               |
| P13 | Selected (combobox)                                         | The row spec's §4 "Entry, selected", with `ingredientDetails.matchedWithDetails` for a variant (§S2)                                                                                                                                                                                                                                     | The same                                                                                                                                                                                                                                                                          | for no numbers: the row spec's new `statusResolvedNoFigures` (Hand-off)                                    | `role="status"`                      |
| P14 | Live search of the sources that can search                  | §S14                                                                                                                                                                                                                                                                                                                                     | §S14                                                                                                                                                                                                                                                                              | §S14                                                                                                       | §S14                                 |

**The model gains one kind.** `IngredientResolverViewState` (`FR/hooks/ingredientResolver.model.ts`) gains
`{ kind: 'offline' }`. It is a suggest read that is parked (`isPending`, and `fetchStatus === 'paused'`) while the
app has focus. TanStack parks a read for want of a connection or of focus. A parked read in an app without focus is
not offline: it stays `searching`. ⛔ The leaves never read connectivity or focus themselves.

**Which "no numbers" counts.** It is the one has-nutrition predicate in `recipe-core`'s `nutrition.ts`, the one the
panel delegates to (row spec §6b). ⛔ Not a second predicate. A variant pick with no numbers reads `addedNoFigures`.
Its parts still show on the line. No variant in the seed lacks energy (§1b), so this is a guard, not a common case.

**Why no mark before the pick.** The suggestion wire carries no nutrition: the catalog arm of
`ingredientSuggestionSchema` is `foodId`, `name` and `score` (`packages/schemas/recipe/src/schemas/ingredients.schema.ts`).
Search returns each root once (R15), so the cook has no second result to prefer. The working-tree seed has 15 roots
with no numbers (`absinthe`, `star anise`, `white tea` and 12 more). That count is U24's output, uncommitted, measured
2026-10-01. §1b's 87 is the committed seed. A mark needs a wire field, for 0.6% of roots. The cook learns it at the
pick, and the panel says it again.

**The correction control on a result that carries a variant.** "Always use this for “{query}”" must teach what the pick
binds. The mapping table maps a phrase to a `food_id` today. ⛔ If a mapping cannot carry the variant, the control does
not show after a pick that carries one. It never teaches the root while the pick binds a variant. The control is no
longer on a result. If owner question O1 keeps it, it is a post-pick offer in the row's status line, and item 3
applies this rule there. `staff-architect`
decides whether a mapping carries `foodVariantId` (Hand-off).

**Target sizes, both hosts.** These controls are 44 × 44 CSS px on web and 48 × 48 dp on native: a result row and the
clear control. If O1 keeps the correction control, it is one too. So are the `Not listed?` options (the live-search
option among them), the `Create my own food` button and each hit (item 1). That is §S8.2's rule: Material's 48 dp is
the stricter of the two native figures (`device-ergonomics.md`). WCAG 2.2 SC 2.5.8 asks only 24 × 24 CSS px.

**The longest text.** The query is the cook's own text and has no limit. It appears in "Find nutrition for “{query}”",
"Use “{query}” as written, without nutrition" and "Search USDA for “{query}”" (item 1). `Create my own food` names no
query. Below 640 px, each of these is full width and wraps its label to as many lines as it needs. The control grows.
⛔ It never clips or truncates. `overflow-wrap: break-word` covers a long word with no spaces. ⛔ Not `anywhere`
inside a flex row: it lowers the item's smallest width, so flex shrinks the label and splits words that fit (E1b
found this on the live trigger).

**A wrapped button keeps its shape.** `Button` used to draw a full pill: with a wrapped label, a full pill becomes an
ellipse, and its curve cut the ends of the first and last lines. On the primary button that was white text on a white
page. The E1b render at 320 px and 200% text showed it. ⛔ The fix is in the primitive, and it is built: the radius is
half the minimum height, 22 px for web's 44 px (`UI/button/surfaceClass.ts`) and 22 dp for native's 44 dp
(`UI/button/Button.native.tsx`). A one-line button is still a pill, and a wrapped one becomes a rounded rectangle. This
passes the owner's test for wrapping in a control: the label holds the cook's own text, so it must wrap, and the button
still reads as one control. The primitive's floor is 44 dp on native, so the picker sizes its own controls to 48 dp.

## S14. Results across sources: the "search more" panel (U29)

**Who answers.** This is the state on 2026-10-01 (U26, R52, R57). Live search calls only a source whose API can
search, and every static download belongs in the seed (owner, 2026-10-01).

| Source (register id)                                                                                       | Asked by live search | How                                            | Can it be busy or skipped? |
| ---------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------- | -------------------------- |
| `usda`                                                                                                     | yes                  | the remote API, under its declared limit (R56) | yes                        |
| the file sources (`ciqual`, `cofid`, `bls`, `stfcj`, `matvaretabellen`, `livsmedelsverket`, `fsvo`, `cnf`) | no                   | the seed only                                  | never reported             |

**The three outcomes, defined for the UI.** **Eligible** means that live search can ask the source now. **Answered**: an
eligible source searched and returned 0 or more hits. **Busy**: an eligible source was not called, because our own
declared limit was full. **Skipped**: an eligible source was not called, because a recorded back-off blocked it until
a stated time (a 429, a `Retry-After`, a 502 to 504). ⛔ A source that is not eligible is not busy and not skipped. It is
not reported. Otherwise every search shows the partial notice for ever.

**Panel states.** They are a discriminated union in `FR/hooks/liveIngredientSearch.model.ts`, as today.

_The Channel column names the announcement channel (polite or assertive). The visible line is never itself live (`rowEditorOpenDecisions.md` system change 2, ruling 3 after B6a)._

| #   | State          | Condition                                           | What shows                                                                                                                                                                   | Channel                                                           | Try again |
| --- | -------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------- |
| L1  | `searching`    | the request is in flight                            | `searching`, then `searchingDetail`                                                                                                                                          | polite, visible                                                   | no        |
| L2  | `results`      | every asked source answered, 1 hit or more          | the `From USDA` group, directly after the option: its label, then the hits. No Close                                                                                         | polite, visually hidden: `resultsCountOne` or `resultsCountOther` | no        |
| L4  | `empty`        | every asked source answered, 0 hits                 | `noResults`. ⛔ No retry. The answer is final                                                                                                                                | polite, visible                                                   | no        |
| L6  | `busy`         | every asked source is busy or skipped (today's 503) | `busy`. A second press on the option is the retry                                                                                                                            | assertive, visible                                                | yes       |
| L7  | `failed`       | no response: today's 502, or a network error        | `failed`. A second press on the option is the retry                                                                                                                          | assertive, visible                                                | yes       |
| L8  | `offline`      | the request is parked                               | a plain status line with `readOffline`, after the listbox (ruling 2 after B6a; never `OfflineReadSlot` inside the list). ⛔ No retry and no spinner. It resumes on reconnect | polite, once                                                      | no        |
| L9  | `limitReached` | the cook hit food's per-cook cap (its `429`)        | `sourceLimitReached`, or `sourceLimitReachedLater` with no `Retry-After`. The option is unavailable (`aria-disabled`) up to `{time}`                                         | assertive, visible                                                | no        |

Status text goes in a status line after the listbox, never inside it, because a listbox owns only `group` and
`option` elements. The rows above follow `docs/design/rowEditorOpenDecisions.md` items 1, 2 and 10 (2026-10-02). L9 is
item 10's state, and its rules are under the copy table below.

**Try again.** It is offered in L6 and L7. It is not a separate control: a second press on the option is the retry, so
no control disappears under focus (`rowEditorOpenDecisions.md` item 1, 2026-10-02). Only USDA can be busy or skipped
(the table above). So a retry spends one USDA call on the one source that did not answer. ⛔ The rule depends on that
fact. Suppose a second source that can search reports busy or skipped. Then a retry spends USDA quota to reach that
source, and this rule must change. The existing three-sentence rule of `IngredientLiveSearchMessages` stands:
`noResults` means stop, `busy` means try later, and `failed` means try again now. ⛔ `failed` does not say "check your
connection": L7 also covers a 502, where USDA failed and the cook's connection is fine, and a parked read is already
L8. The new `failed` is true for a 502 and for a network error alike.

**Placement, both platforms** (`rowEditorOpenDecisions.md` items 1 and 2, 2026-10-02).

- ⛔ **The live panel is the option's group.** The trigger is the last option of the list's last group, `Not listed?`,
  with the `Slow` tag. Its hits arrive as a group, `From USDA`, directly after it. So the hits append below the option,
  and nothing moves under a pointer.
- The panel adds below the cook's results and never replaces them (the existing rule).
- Inside the group: its label `From USDA`, then the hits in wire order. There is no Close. A settled result already
  goes away after a text change, and Escape or a blur closes the whole list.
- Web: `From USDA` is a labelled `role="group"`. Native: header-role text over its rows, which are buttons in the same
  order.
- ⛔ The UI never sorts the hits again and never groups them by source. The hits keep the wire's order. The cook is
  choosing a food, not a database.

**A hit.**

- The pick control holds the food name and the source tag. A hit that maps to a seed variant (R19) also holds the
  dotted line, as §S2 specifies.
- **The source tag** is the register's short name, as plain text: `text-caption text-slate` on web, `palette.slate`
  and `fontSize.caption` on native. ⛔ It is not a pill, because a chip means "tap to filter" in this app (§2c).
- The tag sits at the inline end, sized to its content, level with the first line of the name. Below 12rem of room
  for the name, the tag wraps under it, end-aligned. That is the rule §S8.2 uses for the calories.
- With no short name in the register, the tag shows the full name, and the wrap rule puts it on its own line. While
  the register read is pending, or after it fails, the tag is left out, and the hit still works. ⛔ Never the raw id.
- Accessible name: `hitName` (`{name}, {source}`), or `hitNameWithDetails` (`{name}, {parts}, {source}`). Both start
  with the visible name (SC 2.5.3).
- Source names are proper nouns and are not translated, the same as catalog text (D11).

**Keyboard and focus.** On native, a press on the trigger closes the on-screen keyboard, as the create-food trigger
already does (`Keyboard.dismiss()`, `IngredientPicker.tsx:685`). The cook is done typing, and the results need the
room. Nothing scrolls by itself, on either platform. DOM focus stays on the combobox while it searches. The popup and
its options are outside the page Tab sequence (the APG combobox pattern, `rowEditorOpenDecisions.md` item 2). The
count is announced (L2). No Try again control appears or disappears: a second press on the option is the retry
(`rowEditorOpenDecisions.md` item 1).

**Scroll budget** (E1b, keyboard closed). The panel starts 8 px under the trigger, so its heading or its message shows
next to the control that the cook pressed. At 320 px and 100% text, the first hit ends 221 px below the top of the
trigger. On a 568 px screen, it shows without a scroll while the trigger's top is in the upper 347 px. At 200% text it
ends 511 px below, so the cook scrolls to reach it. ⛔ Nothing scrolls by itself. A cook who moved elsewhere keeps their
place. ⚠️ E1b measured this on the pre-combobox layout, so it is owed a re-measure at B8.

**Until plan 002 S5 lands, the source tag is absent.** The tag reads the register from food-service. The apps call
food-service directly only after S5 (U25's dependency). Until then, every hit shows without a tag. That is the
specified fallback, not a defect.

**What U29's wire carries for this** (U29, 2026-10-02). USDA is the only source asked, so the route's status is its
outcome: `200` answered, `503` busy or skipped, `502` unavailable. The wire has no outcome for each source and no
`source` on each hit. The heading `From USDA` names the source of every hit, as the absent-tag fallback above does.
For a hit that maps to a seed variant, the wire carries the root name and the parts. D13 says "reports each one" and
"each hit names its source". Its wording is the owner's to amend (Hand-off).

**Copy.** `ingredientLiveSearch` is shared by both apps. Its own doc comment names its USDA wording as "what
changes" for a second source. USDA is the only source live search asks (the table above), so the copy keeps naming
it. A copy that said "more food databases" would promise sources the search never asks. ⛔ When a second source that
can search joins the register, this copy changes in the same change, together with the Try again rule above. The
tripwire already exists: `FS/src/sources/__tests__/sourceRegister.test.ts:183-186` pins `CALLABLE_API_SOURCES` to
`['usda']`, and the register admits an API source only with `remoteSearch: true` (`sourceRegister.ts`,
`accessSchema`), so "callable" and "can search" are one set. That test fails in the change that adds a second source.
Owed (U29): add this table's path to that test's name, so its failure points here.

**D16 does not cover this copy.** D16 says "No surface names a single source", and its reason (§S15) is that a label
about where catalog numbers come from named "the one database" after that stopped being true. Live search is an
action that asks exactly one source, so naming it is the true statement. I recommend that D16 read "No label of
catalog data names a single source" (Hand-off).

| Key                                           | Today                                                                                       | New                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `action`                                      | `Search USDA for “{query}”`                                                                 | unchanged                                                                                                                        |
| `actionName` (new)                            |                                                                                             | `Search USDA for “{query}”, slow`. The option's accessible name. The visible text stays `action` plus the `slowTag` tag (item 1) |
| `searching`                                   | `Searching the USDA database…`                                                              | unchanged                                                                                                                        |
| `resultsTitle`                                | `From USDA`                                                                                 | unchanged                                                                                                                        |
| `noResults`                                   | `USDA has nothing for “{query}”. Add it as a custom ingredient instead.`                    | `USDA has nothing for “{query}”. You can still use it as written.` (item 1)                                                      |
| `busy`                                        | `USDA searches are rate-limited and the limit is used up right now. Try again in a minute.` | `USDA can’t take lookups right now. Try again later.` (item 10)                                                                  |
| `failed`                                      | `USDA didn’t answer. Check your connection and try again.`                                  | `The USDA search didn’t finish. Try again.`                                                                                      |
| `dismiss`                                     | `Close USDA results`                                                                        | **dropped**, with the panel's Close (item 1)                                                                                     |
| `regionLabel`                                 | `USDA search results`                                                                       | unchanged                                                                                                                        |
| `resultsCountOne` · `resultsCountOther` (new) |                                                                                             | `1 result from USDA` · `{count} results from USDA`                                                                               |
| `hitName` · `hitNameWithDetails` (new)        |                                                                                             | `{name}, {source}` · `{name}, {parts}, {source}`                                                                                 |
| `sourceLimitReached` (new)                    |                                                                                             | `You’ve reached your limit for USDA lookups. You can try again at {time}.` (item 10)                                             |
| `sourceLimitReachedLater` (new)               |                                                                                             | `You’ve reached your limit for USDA lookups. Try again later.` (item 10)                                                         |

The item numbers in this table are `docs/design/rowEditorOpenDecisions.md`'s (2026-10-02).

There are no partial states. A busy or skipped USDA is L6, and with one source asked, no answer is partial (U29,
2026-10-02). A second source that can search brings the partial states, their copy and their tests. They land in the
same change as the copy and the Try again rule above.

`slowTag`, `searchingDetail` and `retry` do not change. "Try again later" replaces "in a minute". The new `busy` names
no cause: a 503 also covers a back-off after a 502 to 504, and there "the limit is used up" is false. The client cannot know
the end of a USDA block: the declared window is per hour (R56), and a 429 blocks for the source's own stated time.
`busy` says "lookups", not "searches", because it serves the live search and row 6's candidate pick alike
(`rowEditorOpenDecisions.md` item 10, 2026-10-02). Its answer is still a press again.

**The cook's own limit (L9, item 10, 2026-10-02).** The two causes get two messages and two signals on the wire.
Food's per-cook cap is the cook's own limit. Food's `503` means the source is busy, which is `busy` above.

**L9's wire change is built** (`rowEditorOpenDecisions.md` system change 7). The apps call food directly and read its
own `429 REQUESTER_LIMIT_REACHED` with `retryAfterSeconds`. Recipe's relay, which turned it into `503 SOURCE_BUSY`, is
deleted (plan 002 S7, 2026-10-03).

- For food's `429` with a `Retry-After`, the message is `sourceLimitReached`. Food always sends one.
  `sourceLimitReachedLater` is the guard for a `429` with none.
- `{time}` is a clock time, not a countdown: the receipt time plus `Retry-After`, rounded up to the next minute, in the
  locale's hours and minutes (`Intl.DateTimeFormat`, `useLocale`).
- **Where it shows:** the status line after the list, and inside row 6's candidates panel, with the same keys on web
  and native. A candidate pick spends the same budget.
- The limit holds across text changes and across both surfaces, up to `{time}`. Until then, the live option and a
  candidate pick are unavailable. A press makes no request and repeats the message. Then they come back.
- Both messages are assertive. Neither states the hourly figure. Neither blames USDA for the cook's own limit.
- ⚠️ **Owner question O2, open:** the hourly figure. The copy never states it, so the copy stays the same for any
  figure.

## S15. Labels that name no single source

| Element                                                                         | Today                                                                                                                    | New                                                                                                                                                                                                                                                                              | Why                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The badge beside the search field, `usdaBadge` (both apps)                      | "USDA database" (`web/.../IngredientPicker.tsx:555`, `mobile/.../IngredientPicker.tsx:567`)                              | **Dropped.** Both keys are deleted                                                                                                                                                                                                                                               | It named the one database (wireframe `recipe-edit.md:56`), and that premise is no longer true. It also takes width from the field. On native, one row holds an icon, the input, Clear and this badge         |
| The catalog row badge, `catalogBadge` (both apps, typeahead rows and live hits) | "USDA" in a pill (`web:260`, `web:374`, `mobile:388`, `mobile:605`), on every catalog row, the cook's own foods included | **Collapsed** into the section heading `catalogSectionTitle`, "Food catalog". The cook's own foods are their own group, "Your foods", so no row needs a tag and `ownFoodTag` is not built (S5 list contract). Live hits get their source tag (§S14). Both badge keys are deleted | One label for each group says what one label for each row said (common region). Before S3, food search returned the cook's own private foods in the same list, so they wore a false "USDA". ⛔ No pill (§2c) |
| The recipe nutrition note, `detail.nutritionSourceNote`                         | one sentence that names USDA. It shows only for a recipe with a user-entered line                                        | two sentences, each with its own condition (below)                                                                                                                                                                                                                               | The link to the sources must show wherever catalog numbers show                                                                                                                                              |
| The panel (§S6)                                                                 | no source                                                                                                                | a source line, plain text (below)                                                                                                                                                                                                                                                | The cook in the panel asks "are these my numbers?" (§1c)                                                                                                                                                     |

**The cook's own foods.** After plan 002 S3 and S5, food answers the catalog and the cook's authored foods as two
separate reads, and the combobox shows them as two groups (`rowEditorOpenDecisions.md`, S5 list contract). So no row
carries an own-food tag. An authored option's accessible name is `ownFoodName` (`{name}, your food`), because mobile
group headings are plain text and two rows named "Butter" would otherwise sound the same.

**The recipe nutrition note.** It is in the read view: `FR/detail/RecipeDetailBody.tsx:549-551` and
`RecipeDetailBody.native.tsx:421-423`.

1. `detail.nutritionSourceNote` gets new words: `Nutrition comes from public food databases.` The link
   `detail.nutritionSourcesLink`, `Data sources`, follows it. When one line or more takes its numbers from the catalog, it
   shows. A new pure predicate decides that: `hasCatalogNutrition`, in `recipe-core/src/nutrition.ts`, beside
   `hasUserEnteredIngredients`, and built on the same has-nutrition predicate. ⛔ One predicate serves both platforms.
2. `detail.nutritionCustomNote` is new: `Custom ingredients count only the nutrition you entered for them.` It keeps the
   existing condition, `hasUserEnteredIngredients`. So 001 FR-007a's disclosure keeps its words' meaning and its
   condition: "Recipes containing user-entered ingredients MUST indicate partial/user-supplied nutrition data."

- **Web.** One paragraph, `text-caption text-slate`. The link follows sentence 1 in the same line, in the house link
  form: `text-ocean-dark underline underline-offset-2` (`FR/detail/RecipeSourceLine.tsx`). It is a route in this app,
  so it opens in the same tab. SC 2.5.8 exempts a link inside a sentence. The link still gets `py-1`. Sentence 2 starts
  its own line.
- **Native.** Sentence 1 as `Text`. Then the link as its own `Pressable`, `accessibilityRole="link"`, 48 dp tall or
  more. It opens the Data sources sheet (§S16). Then sentence 2.
- ⛔ **The link is in the read view only.** The editor's panel names its source as plain text, with no link. A link
  there leaves the draft, and a row action never lives in the panel (plan 002 R26).

**The panel's source line.** This amends §S6. The panel stays information only.

- `ingredientDetails.panelSource` = `Values from {source}.` `{source}` is the register's full name.
- A label citation (`manufacturer_label`) reads `ingredientDetails.panelSourceLabel` = `Values from the product’s
nutrition label.`
- An authored food cites nothing (ADR-0029), so it shows no source line.
- It goes after the per-100 g basis line, and after `panelRootCooked` where that shows. `text-caption text-slate`.
- While the register read is pending, or after it fails, the line is left out. ⛔ Never the raw id.
- Until plan 002 S5 lands, the apps cannot read the register, so the line is absent on first ship. That is the
  fallback above, not a defect.

## S16. The Data sources page (U25, R55)

**Purpose.** A cook can see which databases supply the numbers, under which licence, and from which edition. Anyone who
checks our licence duties can see the same. The page is also how the app meets its attribution terms. The numbers link
to a page that holds the information, as CC BY 4.0 §3(a)(2) allows (D15).

**Route and ways in.**

|                | Web                                                                                                                                                                             | Native                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Where it lives | `/{locale}/legal/sources`: `web/src/app/[locale]/legal/sources/page.tsx`, with its content in `SourcesContent.tsx` beside it (the `SettingsContent.tsx` pattern), in `AppShell` | A full-screen sheet, `ui/src/sheet/FullScreenSheet.native.tsx`. The app has no router (`mobile/src/screens/AppRoot.tsx` is a `useState` switch) |
| Way in 1       | Settings (`web/src/app/[locale]/settings/SettingsContent.tsx`): a new card. Heading `settingsHeading`, one line `settingsSummary`, then the link `title`                        | Account settings (`mobile/src/screens/AccountSettings.tsx`): the same section, before the danger zone. The danger zone stays last               |
| Way in 2       | the link in the recipe nutrition note (§S15)                                                                                                                                    | the same link                                                                                                                                   |
| Way out        | the browser's back                                                                                                                                                              | Close, an icon button at the top end, 48 × 48 dp, named `close`. Android back. Both go through `onRequestClose`, the sheet's one way out        |

⚠️ **ONE-WAY DOOR: the route.** The attribution depends on this address, and people bookmark it and send it to others.
`legal/` matches the tree that 016 plans (`specs/016-legal-compliance-framework/plan.md`: `[locale]/legal/`, "terms,
privacy, community rules, licence"). So 016's legal index can list this page without a move. `/legal` itself has no
page until 016 builds one. To undo the route costs a redirect. **Flip:** 016 puts licence information somewhere else
before this ships.

**Why a sheet on native.** The recipe-detail way in is inside `RecipesScreen`'s own stack. A full-screen sheet returns
the cook to the same place in the recipe. It also needs no new root destination. The settings way in uses the same
sheet, so the page has one form on native. `FullScreenSheet` gains an optional `onShow`, passed to `Modal.onShow`. Then the
host can move the reading cursor after the sheet is presented (the §S8.1 reason).

**Focus.** Web: no code moves focus on a route change; Next's route announcer reads the new page's title. Whether
the web app should move focus to the `h1` is open for V3's review, with a browser check of where focus lands. Native: on show, `moveScreenReaderFocus` goes to
the title. On close, the control that opened it takes focus back through `useScreenReaderFocusOnSignal(closeCount)`.
That is the §S8.1 host rule.

**Layout.** One column at every width. On web, the content is at most 40rem wide and centred.

```
┌ Data sources ───────────────────────── ✕ ┐  h1. On native: the sheet title, and Close
│ The nutrition figures in this app come    │  intro
│ from these public food databases.         │
│ When no database lists a food exactly,    │  closeMatchNote (§S17)
│ we use the figures for a similar or more  │
│ general food.                             │
│ ┌───────────────────────────────────────┐ │
│ │ USDA                                  │ │  h2: the short name, or the name
│ │ FoodData Central                      │ │  the name, when the short name was the heading
│ │ U.S. Department of Agriculture, …     │ │  the publisher
│ │ Edition   SR Legacy 2018-04, …        │ │  a description list: term, then value
│ │ Licence   CC0 1.0 Universal ↗         │ │  a link
│ │ Credit    U.S. Department of …        │ │  the attribution, word for word, in its own language
│ │ We converted some of its values …     │ │  only for a source with converted values
│ │ Source website ↗                      │ │  a link
│ └───────────────────────────────────────┘ │
│ … one card for each source                │
└───────────────────────────────────────────┘
```

| Part                     | Content                                                                                  | Web                                                                                                                                                                    | Native                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Card                     | one for each source                                                                      | `section` with `aria-labelledby` = its `h2`. `rounded-2xl bg-card`, `p-4`, `space-3` between cards                                                                     | `View`, `palette.white`, `radius.lg`, `spacing[4]`                                                                                     |
| Heading                  | the short name. Without one, the name                                                    | `h2`, `font-display text-heading-sm font-semibold text-charcoal`                                                                                                       | `accessibilityRole="header"`, `displayFontFace.semibold`, `fontSize.headingSm`                                                         |
| Name                     | shown only after a short-name heading                                                    | `text-body-md text-charcoal`                                                                                                                                           | `fontSize.bodyMd`, `palette.charcoal`                                                                                                  |
| Publisher                | `publisher`                                                                              | `text-body-sm text-slate`                                                                                                                                              | `fontSize.bodySm`, `palette.slate`                                                                                                     |
| Edition, Licence, Credit | `editionLabel`, `licenceLabel`, `creditLabel`, each followed by its value                | a `dl`. Term `text-caption font-semibold text-slate`, value `text-body-sm text-charcoal`. The term sits above its value below 24rem of width, and beside it from 24rem | term `Text`, then value `Text`, stacked                                                                                                |
| Licence value            | a link to `licenceUrl`. Its text is the endpoint's licence name, which the wire requires | `a target="_blank" rel="noopener noreferrer"`, the house link form, then a ↗ glyph with `aria-hidden="true"`. Accessible name `licenceLinkName`                        | `Pressable accessibilityRole="link"`, 48 dp tall or more, `safeHttpUrl` then `openExternalUrl` (`FR/detail/openExternalUrl.native.ts`) |
| Credit value             | `attribution`, word for word. ⛔ Never translated, never re-cased, never cut short       | a `p` with `lang` = the endpoint's attribution language, and `overflow-wrap: anywhere`, because two of them hold a bare web address                                    | `Text`. React Native has no language per span: recorded, as in §S4                                                                     |
| Converted                | `convertedNote`. It shows only for a source that the endpoint marks as converted (R54)   | `text-body-sm text-slate`                                                                                                                                              | the same tokens                                                                                                                        |
| Website                  | `homepageLink`, a link to `homepage`. Accessible name `homepageLinkName`                 | as the licence link                                                                                                                                                    | as the licence link                                                                                                                    |

**Order.** The endpoint's order, which is the register's dataset order. USDA comes first, because most numbers come from
it. ⛔ The UI never sorts the list again.

⚠️ **Which sources show: only the sources in use.** A source in use is one that a stored number cites, or one
that live search asks. A registered source that nothing uses does not show. Today that is BLS and the Swiss table, until their files arrive
(U24). Listing one says that our numbers come from a database that
supplies none of them. This narrows U25's verification line, "the page lists every register entry". I recommend it.
The owner or the plan decides (Questions blocking this).

**States.**

| State      | What shows                                                                                                                                                                                                                                                                                                                                                    | Copy                   | Announced                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------- |
| Loading    | The heading and the two intro sentences at once. Three placeholder cards, each as tall as a 5-line card, hidden from screen readers                                                                                                                                                                                                                           | `loading`              | polite. The caption is the region's content |
| Error      | `loadFailed`, then `retry` (secondary `Button`). Try again stays on screen and shows busy while it retries, so focus and the reading cursor stay on it; each failure is announced again; a retry that succeeds focuses the heading (web) or the title (native); reopening the page after a failure shows Loading (`docs/design/readSurfacesEvaluation.md` D3) | `loadFailed` · `retry` | assertive                                   |
| Offline    | `OfflineReadSlot` with `readOffline`. ⛔ No retry                                                                                                                                                                                                                                                                                                             | shared                 | polite, once                                |
| Empty      | `empty`. A deployed stage cannot reach it, because every deploy applies the seed (R31). The copy exists so the state is never blank                                                                                                                                                                                                                           | `empty`                | nothing                                     |
| Populated  | the cards                                                                                                                                                                                                                                                                                                                                                     |                        | nothing                                     |
| Signed out | The app's route protection handles it (web middleware, native `AuthGate`). The endpoint answers 401 without a session (U25)                                                                                                                                                                                                                                   | none here              |                                             |

**The longest content.** These figures come from the working-tree register, `FS/src/sources/sourceRegister.ts`
(untracked, read 2026-10-01). The longest name has 62 characters (CoFID). The longest edition has 80 (USDA). The longest
attribution has 151 (CoFID). One attribution is Japanese (STFCJ, 22 characters). Two attributions hold a bare web address
(Matvaretabellen, the Swiss table). Everything wraps, and nothing is cut short. No web address shows as link text. E1b measured it.
At 320 px and 100% text, the title, both intro sentences and the top of the first card show without a scroll. At 200%
text, the title and the two sentences fill the first screen, and the first card's heading starts at its bottom edge.
This is a page for reading, so a scroll is fine (`cross-platform-translation.md`: scrolling is fine for browsing).

**What the endpoint must carry (U22, U25).** Each field has a fallback where one exists.

| Field             | Why                                                                                                                                                                                     | Without it                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `shortName`       | the hit tags (§S14) and the card headings                                                                                                                                               | the full name, on its own line (the wrap rule)                                                                 |
| `licenceName`     | the licence link's text. The register holds only an id, such as `etalab-2.0`                                                                                                            | none: the wire requires it                                                                                     |
| `attributionLang` | a BCP 47 tag. SC 3.1.2, Language of Parts, is **AA** (W3C, fetched 2026-10-01). The Ciqual credit is French, STFCJ's is Japanese, Livsmedelsverket's is Swedish. All stay word for word | ⛔ **None.** Without it, the web page cannot claim AA. It blocks the page's AA claim (Questions blocking this) |
| `inUse`           | the listing rule above                                                                                                                                                                  | list every entry, as U25 now says                                                                              |
| `converted`       | already in U25                                                                                                                                                                          | none needed                                                                                                    |

⛔ The UI never maps an id to a name, a licence or a language itself. That makes a second copy of the register, kept by
hand.

## S17. A root-bound line whose citation is not an exact match

**Decision: no disclosure on the line or in the panel.** The Data sources page says it once (`closeMatchNote`). The
panel names the source (`panelSource`, §S15).

**Measured** on the working-tree seed (U24's output, uncommitted, 2026-10-01). 2,252 roots have their own USDA item.
374 cite a source: 246 exact, 42 same substance, 71 close and 15 generic. 15 have no numbers. Examples: same substance,
`frozen Atlantic salmon` (a USDA salmon item). Close, `Aleppo pepper` (Ciqual 11088) and `Dijon mustard` (Ciqual 11013).
Generic, `Campari`, `Cointreau` and `triple sec` (FNDDS "Liqueur"), `tarragon vinegar` (FNDDS "Vinegar") and
`frozen meals` (FNDDS "Frozen dinner, NFS").

**Why.**

1. **The cause is different from D10.** A cooked root's numbers are for another state of the food that the cook weighs.
   So that error has a known direction, and it repeats on every use. A close or generic citation is for a similar food.
   Its error has no known direction. The tier is a curator's grade of the name, not a measured error.
2. **The cook has nothing to act on.** Search returns one root for each name (R15), so no better choice exists in the
   list. The cook who holds a label can already create their own food.
3. **The wire does not carry the tier.** KTD-15 keeps the nutrition wire as it is. A disclosure needs a field on every
   nutrition read, a string and its tests, for 86 roots (3.3% of 2,641).
4. **A related owner ruling prefers tolerance:** "Cooking is an art just as much as it is chemistry" (2026-08-26, about
   parse precision). It is related, not governing.
5. **Same substance needs nothing.** The food is the same food.

**The case against, at its strongest.** A cook counts macros for their health. They read Cointreau's numbers from the
generic "Liqueur" row and trust them as exact. The product knew the match was generic. **Answer:** the panel names the
source, and the Data sources page states the rule. Most of the 15 generic roots are drinks, vinegars and spices, used in
small amounts. If the owner judges that not enough, the flip below applies.

**Flip.** The smallest version covers `generic` only. It adds an optional `match` to the root's nutrition read, which is
a change against KTD-15. It adds one panel sentence in D10's position: `ingredientDetails.panelRootGeneric` =
`These numbers are for a more general food, not this exact one.` This is a two-way door.

## S18. Web to mobile, for each surface (§3.6)

The details dialog's table is §S10. It holds the dialog's primary action, its 320 px check and its scroll budget, and
this extension changes none of them.

**The picker (both hosts).**

| Element                                             | Web                                                                                                                                                                                                                                        | Native                                                                                                                                        | Disposition                                                        | Why                                                                                                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The badge beside the field                          | gone                                                                                                                                                                                                                                       | gone                                                                                                                                          | **dropped**                                                        | §S15                                                                                                                                                                                                                   |
| Clear                                               | no visible clear button. Escape with the list closed clears (`rowEditorOpenDecisions.md` item 4)                                                                                                                                           | × at the field's end, ⛔ 48 × 48 dp (today 34)                                                                                                | kept, a mechanism per platform                                     | Touch has no Escape, so native keeps a visible clear (item 4)                                                                                                                                                          |
| Hover on a result                                   | `bg-pearl`                                                                                                                                                                                                                                 | `PressScale` press feedback                                                                                                                   | **collapsed** into press                                           | Touch has no hover. Nothing depends on it                                                                                                                                                                              |
| Section headings                                    | caption heading                                                                                                                                                                                                                            | `accessibilityRole="header"`                                                                                                                  | kept                                                               |                                                                                                                                                                                                                        |
| Catalog row badge                                   | gone                                                                                                                                                                                                                                       | gone                                                                                                                                          | **collapsed** into the heading                                     | §S15                                                                                                                                                                                                                   |
| Correction control                                  | ⚠️ owner question O1 (survival). If it survives: a post-pick offer in the row's status line, beside "Added {name}". It is no longer inside a result                                                                                        | the same                                                                                                                                      | O1 says no: **dropped**. O1 says yes: **moved** to the status line | An option cannot hold a control, so it cannot move into the list. Item 3 gives it its one home                                                                                                                         |
| The `Not listed?` options, and `Create my own food` | the list's last group, `Not listed?`: Find nutrition, then Use as written, then Search USDA. `Create my own food` (trailing row): a tertiary text button after the suggestions, while the field holds text at the search minimum or longer | the same options, as buttons in the same order. `Create my own food` after the suggestions, reached by scrolling or after the keyboard closes | **kept**, the same on both                                         | A keyboard user never reaches a button inside the list, so the ways to fill the name are options (items 1 and 2). ⚠️ Owner question O3: if R26 governs a line's actions only, `Create my own food` moves into the list |
| The live trigger and its SLOW tag                   | full width, tag at the end                                                                                                                                                                                                                 | full width, tag at the end. A press closes the keyboard                                                                                       | kept, plus the keyboard rule                                       | §S14                                                                                                                                                                                                                   |
| The live panel                                      | the option's group, `From USDA`, directly after the live-search option                                                                                                                                                                     | the same                                                                                                                                      | **kept**                                                           | The results follow the control that asked for them. The panel is the option's group (§S14, item 2)                                                                                                                     |
| A hit's source tag                                  | end-aligned text. Under the name below 12rem                                                                                                                                                                                               | the same                                                                                                                                      | kept                                                               | §S14                                                                                                                                                                                                                   |
| Right-click, drag                                   | none                                                                                                                                                                                                                                       | none                                                                                                                                          | stated absent                                                      | not applicable                                                                                                                                                                                                         |

The item numbers in this table are `docs/design/rowEditorOpenDecisions.md`'s, decided 2026-10-02.

**Primary action, by reach.** The primary action is a result. The first result sits right under the field on both
platforms. On a phone with the keyboard up, that is the reachable band just above the keyboard. The `Not listed?`
options and `Create my own food` are the fallback for "no result fits". They follow the results, and the cook reaches
them by scrolling. That is on purpose.

**Scroll budget.** Keyboard up, native: the field and the first result show above the keyboard. The editor already
scrolls the focused field into view (`KeyboardAvoidingView`, `mobile/src/screens/RecipeEditor.tsx`). This is reasoned
from the code, and a device check is owed. Keyboard closed: the live panel's budget is in §S14 (measured in E1b).

**The row line and the panel.**

| Element                             | Web                              | Native                                                      | Disposition            | Why                                                                |
| ----------------------------------- | -------------------------------- | ----------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------ |
| The dotted line                     | §S4                              | §S4                                                         | kept                   | one primitive                                                      |
| `Add details` and `Edit details`    | in the row's `⋮` menu            | in the row's `⋮`, which opens a bottom sheet (row spec §3a) | **moved** into a sheet | A menu on touch is an action sheet                                 |
| The panel's trigger, the info glyph | a click                          | a tap                                                       | kept                   | Row spec §6d: activation, never hover                              |
| The panel's source line             | text                             | text                                                        | kept                   | §S15                                                               |
| The nutrition note's link           | a link in the sentence, same tab | its own link row, 48 dp. It opens a full-screen sheet       | **moved**              | A link inside a sentence is too small to tap. Native has no router |

**The Data sources page.**

| Element                   | Web                                     | Native                                        | Disposition                    | Why                                                                   |
| ------------------------- | --------------------------------------- | --------------------------------------------- | ------------------------------ | --------------------------------------------------------------------- |
| Container                 | a page in `AppShell`                    | a full-screen sheet                           | **moved**                      | No router. It returns the cook to the same place                      |
| Way out                   | the browser's back                      | × in the header, and Android back             | added on native                | A modal needs an exit that shows                                      |
| Licence and website links | a new tab                               | the system browser, through `openExternalUrl` | kept, a mechanism per platform | The house adapter. Every link that leaves the app leaves the same way |
| The term beside its value | from 24rem of width                     | always stacked                                | **collapsed** on a phone       | A phone is narrower than 24rem at 200% text                           |
| `lang` on the credit      | yes                                     | not available                                 | **dropped**, recorded          | React Native has no language per span                                 |
| Hover on a link           | none needed, the underline always shows | press                                         | collapsed                      | Never hover alone                                                     |

**320 CSS px:** no sideways page scroll on any of these surfaces. E1b measures the new frames.

## S19. Keys added or changed by §S13 to §S18

`en` is the source locale. The app's `en` copy mixes spellings: "Food catalog" and "organize"
(`FR/collections/messages.ts:276`) beside "Unrecognised" (`FR/form/messages.ts:399`). So this is a decision, not a
match: the new keys use US English ("License"), like "Food catalog" in the same picker. A licence's own name keeps its
own spelling. The other locales go to `packages/apps/commise/i18n`.

| Key set (file)                                               | Key                                                                                | `en`                                                                                                                                                                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ingredientPickerSearch` (new set, `FR/messages.ts`, shared) | `searching` · `failed`                                                             | `Searching ingredients` · `We couldn’t search ingredients. Edit your search to try again.`                                                                                                                           |
|                                                              | `ownFoodTag` · `ownFoodName`                                                       | `Your food` · `{name}, your food`                                                                                                                                                                                    |
| `ingredientPickerStatus` (`FR/messages.ts`, shared)          | `addedWithDetails` · `addedNoFigures`                                              | `Added {name}: {parts}` · `Added {name}. It has no nutrition figures, so it adds nothing to the totals.`                                                                                                             |
| `ingredientLiveSearch` (`FR/messages.ts`, shared)            | the §S14 table                                                                     | the §S14 table                                                                                                                                                                                                       |
| `detail` (`FR/messages.ts`)                                  | `nutritionSourceNote` (new words) · `nutritionSourcesLink` · `nutritionCustomNote` | `Nutrition comes from public food databases.` · `Data sources` · `Custom ingredients count only the nutrition you entered for them.`                                                                                 |
| `ingredientDetails` (`FR/messages.ts`)                       | `panelSource` · `panelSourceLabel`                                                 | `Values from {source}.` · `Values from the product’s nutrition label.`                                                                                                                                               |
| `dataSources` (new set, `FR/messages.ts`, shared)            | `title` · `close` · `intro` · `closeMatchNote`                                     | `Data sources` · `Close data sources` · `The nutrition figures in this app come from these public food databases.` · `When no database lists a food exactly, we use the figures for a similar or more general food.` |
|                                                              | `editionLabel` · `licenceLabel` · `licenceLinkName` · `creditLabel`                | `Edition` · `License` · `{licence}, license for {source}` · `Credit`                                                                                                                                                 |
|                                                              | `convertedNote` · `homepageLink` · `homepageLinkName`                              | `We converted some of its values to the units this app uses.` · `Source website` · `Source website, {source}`                                                                                                        |
|                                                              | `loading` · `loadFailed` · `retry` · `empty`                                       | `Loading data sources…` · `We couldn’t load the data sources.` · `Try again` · `No data sources to show yet.`                                                                                                        |
|                                                              | `settingsHeading` · `settingsSummary`                                              | `Food data` · `Where the nutrition figures come from, and the licenses they’re used under.`                                                                                                                          |
| `RecipeFormMessages` (the row spec's, Hand-off)              | `statusResolvedNoFigures`                                                          | `Matched — {food}. It has no nutrition figures, so it adds nothing to the totals.`                                                                                                                                   |

**Deleted:** web `recipes.picker.usdaBadge`, `catalogBadge`, `searching` and `errorTitle`. Mobile
`ingredientPicker.usdaBadge` and `catalogBadge`. `searching` and `errorTitle` move to `ingredientPickerSearch`, so both
platforms read one string.

**Why `dataSources` lives in `FR/messages.ts`.** The recipe feature already owns the nutrition copy and the note that
links to the page. It also owns the external-link adapter. `features/account` is the identity package. So the page's keys
and its pure model go in `FR/dataSources/`, and both settings screens import its `settingsHeading`, `settingsSummary`
and `title`. When 016 builds its legal section, its index links here, and the page does not move.

⛔ No new string says kind, typical, variant, root, part or attribute, and none names a single source.

---

# EVALUATE: adversarial, on my own design

⛔ **I wrote this spec.** So the criteria below come from outside it where they can: R24 to R30, WCAG 2.2 AA by
number, the committed row contract, and the render checks.

| #       | Sev                          | Who                                   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | ---------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E1**  | ✅ Run                       | all                                   | **Render checks.** Results in the table below. Two cases at 320 px and 200% text stay below my own target and meet the AA floor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **E2**  | ⚠️ Med, owner's call         | a cook with a big root                | **The literal R26 rule leaves the longest list flat.** `beef ribeye steak` has 75 rows. `cut` differs first, but only 16 rows have it, so "at least half" fails. Under this rule, 66 of 143 long lists are flat. The other reading, "the first attribute that meets all three conditions", groups 119 of 143 and groups ribeye by `formOrVariety`. It also groups 4 roots by `cookingMethod` (`bone-in, skin-on chicken thighs`, `chicken drumsticks`, `chicken skin`, `malted milk powder`), which D2 rules out. **I recommend** the literal rule, as specified. If the owner wants ribeye grouped, test the other reading with `cookingMethod` excluded from grouping. This is a two-way door: one pure function.                                           |
| **E3**  | ⛔ High, blocked on data     | a cook who weighs raw duck legs       | **Today's data cannot drive D10** (§S6). The words and the key exist. The data does not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **E4**  | ⚠️ Med, owner's call         | a cook who scans a grouped list       | **R26 allows lists that are mostly one-row groups.** Under §S8.3, 88 of 316 groups have one row. `candy bars` has 18 groups, and 16 of them have one row. "No more groups than half the rows" does not stop that. **I recommend** a fourth condition: at least half the groups have 2 rows or more. The owner decides. This spec does not add it.                                                                                                                                                                                                                                                                                                                                                                                                             |
| **E5**  | ⚠️ Med                       | a cook who imports                    | **A wrong variant from an import never moves** (R21). ✅ Only an exact match binds, the dotted line shows it, and `Edit details` or `Remove details` fixes it. Residual: nothing flags it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **E6**  | ⚠️ Med                       | a cook who meets `Add details`        | **"Add details" can look like a place to type notes.** ✅ The title repeats the words, and the intro says what a pick does, one step later. Residual, judgement: not tested. The E10 study covers it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **E7**  | ⚠️ Low                       | a cook who changes a retired variant  | **The cook cannot undo a change or removal of a retired variant**, because it is not listed. ✅ `currentRetired` and `noneLeft` say so plainly before the action. The copy is the confirmation. No modal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **E8**  | ⚠️ Low                       | a native user, and web at 640 px+     | **A long list makes the sheet grow once.** The count is not known while the list loads. Accepted, as a jump with no animation, on both paths. The other choice is a full-height sheet for a one-row list. ⚠️ Core React Native _can_ animate the next layout: RN 0.86.3 ships `LayoutAnimation.configureNext`, which "Configures the next commit to be animated". It is still the wrong tool here. It animates everything in that commit. Its own source calls its iOS support under Fabric conditional. And the commit belongs to the host's state change, not to the Sheet. **Flip:** a line that carries its variant count, not `hasVariants`, lets the Sheet open at its final size, with no jump. That is a wire change, so it is not proposed for this. |
| **E9**  | ⚠️ Low                       | a translator                          | **`…One` and `…Other` cannot express every plural category** (Polish, Arabic). This is the file's convention. ICU plurals are a change for the whole repo, not for this unit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **E10** | ⚠️ Low                       | all                                   | **No user evidence exists.** The cheapest study: 5 participants think aloud while they edit a brisket recipe. Tasks: "make this the braised flat", "use the one with less fat", "undo that". It tests whether they find `⋮ → Add details` (question 2 of the cognitive walkthrough), whether they scan or search the grouped list, and E6.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **E11** | ⛔ High, blocks the AA claim | a screen-reader user in any locale    | **The credit lines need a language tag.** Ciqual's credit is French, STFCJ's is Japanese, and Livsmedelsverket's is Swedish. SC 3.1.2 is AA. The register carries no language, and no fallback is compliant. §S16 asks for `attributionLang`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **E12** | ⚠️ Med, existing defects     | a native picker user                  | **The native picker showed no loading, no failure and no offline state. Its catalog notice was silent, and two of its controls were under 48 dp** (§S13). The existence check of `docs/CODING_STANDARDS.md` §14 passed with all of these missing, which is the §3.6 class. Fixed on 2026-10-01 (V32); the live-search panel's place is still open.                                                                                                                                                                                                                                                                                                                                                                                                            |
| **E13** | ⚠️ Med, a primitive          | everyone at large text                | **A full-pill `Button` cuts its own wrapped label** (§S13, E1b). At 320 px and 200% text, the primary button's first line ran past the fill: white text on a white page. The fix is in `UI/button`, once, not per screen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **E14** | ⚠️ Med, owner's call         | anyone who reads the sources          | **U25 says that the page lists every register entry. §S16 lists only the sources in use.** A source that supplies nothing does not belong on a page that says where the numbers come from.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **E15** | ⚠️ Low                       | a cook at 200% text on a 320 px phone | **After "Search more", the first hit is below the fold** (511 px under the trigger's top, E1b). Accepted: the heading or message shows under the trigger, and the count is announced. Flip: a study that shows cooks miss the results makes the panel scroll itself into view.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **E16** | ⚠️ Low                       | a cook at 200% text on a 320 px phone | **A word longer than the line breaks inside itself** (`LINGONBERRY` in a Branded name, E1b). That is §S4's last resort, and nothing clips. The screen, the card, the panel and the row together leave 222 px of line.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **E17** | ⚠️ Low, my own call          | a cook who counts macros              | **Non-exact citations are disclosed only on the Data sources page** (§S17). The flip is specified and costs one wire field.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### E1 render checks

The mockup [`variantDetailsMockup.html`](./variantDetailsMockup.html) was rendered in Chromium through Playwright on
2026-09-30. The PNGs are `variantDetailsMockup320.png`, `…390.png`, `…768.png`, and `…320Text200.png`,
`…390Text200.png`, `…768Text200.png`. 200% text is a text-only resize: the root font size is 200% and spacing
stays fixed. Native font scale behaves this way, and it is stricter than browser zoom. Device heights: 568
(iPhone SE, 1st generation), 844 (iPhone 12 to 15), 1024 (iPad, portrait). The keyboard heights (253, 336 and 313
px) and the safe-area insets are stand-ins, not device measurements. At 768 px the frames draw the web dialog.

| Check | Rule                                                                                               | Result                                                                                                                                                                                                                                                                                       |
| ----- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RC1   | No horizontal page scroll, at every width and text size (SC 1.4.10)                                | ✅ 0 px in all 6 renders                                                                                                                                                                                                                                                                     |
| RC2   | No clipped text: lines, titles, rows, buttons, messages                                            | ✅ none                                                                                                                                                                                                                                                                                      |
| RC3   | The dotted line shows no comma, and a no-break space comes before every dot                        | ✅ 0 defects                                                                                                                                                                                                                                                                                 |
| RC4   | A measurement token never splits at its hyphen                                                     | ✅ 0 splits. The first render split `1/8-` from `inch trim` (§2d)                                                                                                                                                                                                                            |
| RC5   | Search appears at 8 rows or more, and never below                                                  | ✅ chicken thighs (7): no search. Chicken breasts (8): search                                                                                                                                                                                                                                |
| RC6   | 100% text, keyboard closed: the title, the search and 3 rows or more fully visible                 | ✅ Rows fully visible at 320 / 390 / 768: brisket 4 / 9 / 12, chicken breasts in edit mode 3 / 8 / 8, ribeye 4 / 7 / 11, chicken thighs 6 / 7 / 7. ⚠️ The retired state at 320 px shows 1 row, because `currentRetired` takes 4 lines                                                        |
| RC7   | 100% text, keyboard open: the active row fully visible                                             | ✅ fully visible at 320, 390 and 768                                                                                                                                                                                                                                                         |
| RC8   | 200% text: the list region is at least as tall as the tallest row, so a focused row can show whole | ✅ at 390 and 768 in every state. At 320: brisket 330 px for a 258 px row, ribeye 330 for 306, chicken breasts 219 for 192. ⚠️ Retired: 219 for 258. ⚠️ Keyboard open: 121 for 192, so the active row shows in part. Both meet SC 2.4.11 (AA: never entirely hidden) and not SC 2.4.12 (AAA) |
| RC9   | Rows, Close, Clear and footer buttons are 48 px or more                                            | ✅ none below 48                                                                                                                                                                                                                                                                             |
| RC10  | The footer is visible with the keyboard closed, and every sheet fits its device                    | ✅                                                                                                                                                                                                                                                                                           |
| RC11  | The title takes one line                                                                           | ✅ one line at every width and text size                                                                                                                                                                                                                                                     |
| Line  | The longest parts line (103 characters) at 320 px and 200% text                                    | ✅ 8 lines, nothing clipped                                                                                                                                                                                                                                                                  |

**What the first render found, and what changed.** The first layout failed RC6, RC7, RC8 and RC11. At 320 px, edit
mode showed 2 rows. With the keyboard open, it showed 0 rows. At 200% text it showed 0 rows everywhere, and the
title took up to 6 lines. I changed the design, not the checks:

1. The title now repeats the menu item (`Add details`, `Edit details`). The food name moved to the top of the
   scroll region, and the dialog's accessible name still has it.
2. The intro is now one sentence.
3. The per-100 g caption moved into the pinned label row. There it also heads the calorie column while the list
   scrolls.
4. Close became a 48 × 48 icon button, which gave the title its width back.
5. With an on-screen keyboard open, the title row collapses into the label row, and the footer is hidden.
6. The calorie value wraps under the parts when fewer than 12rem remain.
7. The check column is reserved only when a listed row is current.
8. A measurement token stays whole (RC4).

**Checked and found no fault:** the icon column still has two slots · the panel has no action · the line shows no
figure · a root-bound line shows the name only · no string says kind or typical, and nothing prompts · each state
has a key or a named shared string.

### E1b render checks for §S13 to §S16 (2026-10-01)

Frames 17 to 21 of the mockup were rendered in Chromium through Playwright. The widths were 320, 390 and 768 px, at
100% and 200% text, with E1's device heights. The checks ran as a script over the rendered page. ⚠️ The screenshots are in the
session scratchpad and are not committed. This unit was allowed to edit only the spec and the mockup (Questions blocking this).
⚠️ The hit names in frame 17 are illustrations. The register strings in frame 20 are real, from the untracked
`sourceRegister.ts`. ⚠️ These checks ran on the earlier frames 17 to 19, which showed several databases. After the
owner's ruling that live search asks only a source whose API can search, those frames show USDA alone and its own
copy (§S14). The layout rules did not change, but the render checks have not been run again on the new copy.

| Check | Rule                                                                       | Result                                                                                                                                                                                    |
| ----- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RCb1  | No sideways page scroll (SC 1.4.10), and no element outside its frame      | ✅ 0 px of page overflow and 0 elements outside, in all 6 renders                                                                                                                         |
| RCb2  | No clipped text                                                            | ✅ none. ⚠️ At 320 px and 200% text, a word wider than the line breaks inside itself (E16)                                                                                                |
| RCb3  | Targets: 48 px or more in phone frames, 44 px or more in web frames        | ✅ smallest 48 at 320 and 390. Smallest 44 at 768 (the web links)                                                                                                                         |
| RCb4  | The source tag sits beside the name from 12rem of room, and under it below | At 320: under, on all 3 hits. At 390: under on 2, beside on 1. At 768: beside on all 3                                                                                                    |
| RCb5  | The live trigger's label never splits a word that fits                     | ✅ after a fix. The first render split `databases` and `lingonberry` at 200% text, from `overflow-wrap: anywhere` in a flex row. Now `break-word`, and the SLOW tag wraps under the label |
| RCb6  | A wrapped button keeps its first and last lines inside its fill            | ✅ after a fix. The first render's full pill cut "Find nutrition" at 320 px and 200% text (E13). Now the radius is half the minimum height                                                |
| RCb7  | Scroll budget, the live panel: first hit's bottom below the trigger's top  | 221, 177 and 143 px at 320, 390 and 768 (100% text). 511, 393 and 235 px at 200% text                                                                                                     |
| RCb8  | Scroll budget, the Data sources sheet                                      | At 320 px and 100% text, the first card starts 211 px down a 568 px sheet. At 200% text, the title and the two intro sentences fill the first screen                                      |
| RCb9  | The credit list puts each term beside its value from 24rem                 | Beside at 768 px and 100% text. Stacked in every other render                                                                                                                             |

The radius change does reach frames 1 to 16. Measured after it, at 320 px and 200% text, "Remove details" wraps to two
lines in frames 5, 9, 10 and 11. Every other button there stays on one line, at every width and text size. So E1's
`variantDetailsMockup320Text200.png` is stale for those four frames: it shows the old full pill, the shape E13 names.
The other five E1 PNGs stand.

### E2 Implementation EVALUATE (2026-10-01): U13, U21, plan 002's nameless-line UI, and the two shared defects

**Standing.** I wrote this spec and `namelessLineCopy.md`. I did not write the code. So this parity check measures
the code against my own documents. **Seen rendered:** esbuild bundled the real web primitives: `VariantPartsLine`,
`Button`, `StandIn` and `Sheet`. The real `@commise/ui` theme styled them, through `@tailwindcss/postcss`. The detail
row is a static copy of its real classes (`RecipeDetailBody.tsx:331-445`). So is the picker's action row
(`IngredientPicker.tsx:458-490`). Chromium ran it all through Playwright. The sizes were 320×568, 390×844, 768×1024,
1024×768, 1280×800, 844×390, 667×375 and 640×360 (a desktop at 200% zoom).
Each size ran at 100% and at root 200% text. ⚠️ That is not E1's method. This theme's spacing is in rem, so root 200%
grows the controls with the text: the 44 px checkbox became 88 px. Root 200% is therefore a text-only stress test.
It matches native font scale, not a web reader. The WCAG frames on web are 320 px at 100% (SC 1.4.10) and 640×360 at
100% (SC 1.4.4, through zoom). Every figure below was measured by a script, not judged by eye. The keyboard case is **modelled**: `--sheet-visible-height` was set to the window height minus the keyboard.
⚠️ The test page is in the session scratchpad and is not committed. **Native is read in code only**, because
react-native-web cannot simulate a font scale.

| #   | Sev                      | Where                                                                                                      | Criterion                                                                 | Observed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Fix                                                                                                                                                                                                                                                                                           | When                                                                                                                    |
| --- | ------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| I1  | 3 web, 4 native (likely) | `FR/detail/RecipeDetailBody.tsx:401-444`. Native: `.native.tsx:316-339`, styles `:590-606`                 | Web: `namelessLineCopy.md` §2c, "breaks only at spaces". Native: SC 1.4.4 | **Web, measured.** On a **named** row, the trailing `ml-auto shrink-0` status badges leave the name 37 px at 320 px and 100% text. Words break mid-letter, and the row is 288 px tall. There is no sideways scroll, so SC 1.4.10 holds. At 640 px the name is 377 px. Under the text-only stress test the name is **0 px**, and the badge reaches x = 511. **Native, read in code.** The same `flexShrink: 0` badge sits beside a fixed 44 dp checkbox. Native font scale is text-only, so expect the 0 px case there | Move the badges into the flowing name block. That is `namelessLineCopy.md` §2c's open follow-up, measured there at 233 → 102 px. Make the badge chip a primitive, `@commise/ui` `StatusBadge` (`tone: neutral \| caution`): its class string is repeated 4 times on web                       | Fix now. ⛔ It blocks U15: the dotted line cannot ship into a 0 to 37 px column                                         |
| I2  | 3                        | `UI/button/surfaceClass.ts:54`, `UI/button/Button.native.tsx:105`                                          | Native: SC 1.4.4. Web: judgement                                          | E13 is still open. With a wrapped label, the text runs past the pill's curve, and that text is white on a white page. On web it runs 2.5 px past at 320 px and 100% text, and 0 px at 640 px. Under the text-only stress test it runs 35 px past at 320 px and **48 px** at 390 px. Native font scale is text-only, so native gets the large case (read in code)                                                                                                                                                      | §S13's rule: the radius is half the minimum height. Web `rounded-[1.375rem]`, in rem so that it scales with text. Native `22`, half of today's 44. ⚠️ Raising native `minHeight` to 48 is a separate design-system decision: every native button grows                                        | The radius: fix now. No unit owns it                                                                                    |
| I3  | 3                        | Web `IngredientPicker.tsx:459-489`. Mobile `IngredientPicker.tsx:832-841`                                  | §S13, §S18. SC 1.4.4                                                      | The picker's action buttons are hand-rolled `rounded-full` and `borderRadius: 999` pills, so the I2 fix cannot reach them. They clip by 20 to 30 px at 200% text. One line is 33 px tall at every web width (§S13 asks for 44) and about 37 dp on native. Native lays them in a wrapping row, not full width                                                                                                                                                                                                          | Adopt `Button` or `buttonSurfaceClass`. Full width below 640 px and on native                                                                                                                                                                                                                 | Owed to U15                                                                                                             |
| I4  | 3                        | Mobile `IngredientPicker.tsx:494-622`, `:555-561`                                                          | Nielsen #1. SC 4.1.3, 2.5.8 (HIG and Material are stricter)               | As §S13 recorded on 2026-10-01: there was no `searching` branch, `results.isError` is never read, and offline shows nothing. The catalog-unavailable line is a plain `Text` at `:622`, and Clear is 34 dp                                                                                                                                                                                                                                                                                                             | §S13 P3, P6, P8 and P9                                                                                                                                                                                                                                                                        | Fixed on native: P3, P6, P8, P9 and both 48 dp controls. Web reads the same P8 and P9 keys. The owner pulled it forward |
| I5  | 3                        | `UI/sheet/Sheet.tsx:28-31`                                                                                 | §S8.1. SC 2.4.11                                                          | From 640 px, the height follows the visible viewport, but the dialog stays centred on the whole window. Modelled on a sheet with no toolbar, the keyboard hides 157 px of it on an upright iPad. It hides 199 px on a landscape iPad and 100 px on a landscape phone. U14's long list has a toolbar, so its footer hides by design. There, the hidden band is the lower list, and it can hold the active row. §S9's 2.4.11 row promises that never happens. Latent until U14                                          | Also publish `--sheet-visible-top` (`visualViewport.offsetTop`), and centre inside the visible box. Below 640 px, `top` uses the same value, which follows iOS panning                                                                                                                        | In U21 now while it is cheap, or in U14 at the latest. Spec fix owed: §S8.1 "Keyboard: where the sheet sits"            |
| I6  | 3                        | `UI/sheet/Sheet.native.tsx:51-59`                                                                          | §S8.1                                                                     | **Likely, from React Native's source.** The Sheet sets `navigationBarTranslucent`, and `edgeToEdgeEnabled=true` forces it anyway. It calls `setDecorFitsSystemWindows(false)` on the Modal's window (`ReactModalHostView.kt:394-395`, `WindowUtil.kt:165`). Then `SOFT_INPUT_ADJUST_RESIZE` (`:332`) probably resizes nothing, and the avoider is iOS-only. Expect `Done` and the typeahead under the keyboard on Android                                                                                             | First the device check that U21's Verification already asks for. If keyboard events reach the Modal, use `KeyboardAvoidingView` on Android too. If they do not, evaluate `react-native-keyboard-controller` (library first)                                                                   | Before U14                                                                                                              |
| I7  | 2                        | `UI/sheet/SheetPanel.tsx:139-175`, `BottomSheetPanel.native.tsx:147-190`                                   | SC 1.4.4, 1.4.10                                                          | At 640×360 under the text-only stress test, the footer runs 23 px past the dialog. A keyboard with no toolbar is today only the native filter bar. There, on a small phone at a large font scale, the pinned title and `Done` can leave the list close to 0. That is reasoned, not measured                                                                                                                                                                                                                           | **Decided by the owner: B, unpin past a limit.** The footer stays pinned while the title row and the footer together take at most half the sheet. Past that, it scrolls as the last item. Close (×) stays pinned. The toolbar is not counted. Spec: §S8.1. Build: `compactHeightLayout.md` §3 | Now, before U14. The §S8.1 spec fix is made. On Android, the keyboard half waits on I6                                  |
| I8  | 1                        | `UI/variantPartsLine/VariantPartsLine.tsx:100`                                                             | §S4 "a dot never starts a line"                                           | I built a flex row with no `min-w-0`. The spec does not allow that layout at this width: §S18 puts the control under the name below 12rem. In it, `wrap-anywhere` let the column shrink to 71 px. Then the no-break space broke, and at 320 and 390 px a dot started a line (`boneless` / `·`)                                                                                                                                                                                                                        | `break-words`, and change `__tests__/VariantPartsLine.test.tsx:128`, which pins `wrap-anywhere`. A primitive must survive hosts it does not know. With it, a dot starts a line in one case only: one part and its dot are wider than the whole box                                            | Fix now. Spec fix owed: §S4 "Wrapping" contradicted §S13's own lesson                                                   |
| I9  | 2                        | `FR/filters/RecipeFilterBar.tsx:249`, placed by `FR/discovery/RecipeDiscoveryFrame.tsx:133`                | §3.6                                                                      | Below 640 px, web still shows all seven facet groups open above the results. That is the defect U7 fixed on native with a sheet. §S8.1a's "Web keeps its inline bar" was a port in reverse. Read in code, not rendered                                                                                                                                                                                                                                                                                                | Below 640 px: the `Filters` trigger and the web `Sheet`, the same anatomy as native                                                                                                                                                                                                           | Owed to U15. Spec fix owed: §S8.1a                                                                                      |
| I10 | 2                        | `FR/filters/RecipeFilterBar.native.tsx:349-358`                                                            | SC 1.4.4                                                                  | The trigger's count badge has a fixed `height: 22` around an 11 pt digit. At large font scale the digit outgrows the circle, and outside it the digit is white on white. Read in code                                                                                                                                                                                                                                                                                                                                 | `minHeight: 22` and vertical padding                                                                                                                                                                                                                                                          | Fix now                                                                                                                 |
| I11 | 2                        | `FR/form/RecipeIngredientsFields.native.tsx:98`, `:119`, `:148`                                            | SC 1.3.1                                                                  | React Native 0.86 has no `aria-describedby` (its `Libraries` hold no reference to it). Only react-native-web maps it, so the tests pass while devices get nothing: no stand-in link and no error link. Reading order covers swipe users. Explore by touch does not                                                                                                                                                                                                                                                    | A native description adapter that sets `accessibilityHint`, in a design-system input                                                                                                                                                                                                          | Owed to a form accessibility unit. Spec fix owed: `namelessLineCopy.md` §2c                                             |
| I12 | 2                        | `UI/button/surfaceClass.ts:56` (`md:min-h-0`, 39 sites), `RecipeDetailBody.tsx:350` (`sm:size-6`, 9 sites) | HIG 44 pt. Passes SC 2.5.8                                                | Width stands in for the pointer. On a touch iPad (768 and 1024) a button is 41 px and a checkbox 24 px                                                                                                                                                                                                                                                                                                                                                                                                                | `md:pointer-fine:min-h-0`. Tailwind 4.3.3 has the variant. Blast radius: every web Button on a touch screen 768 px or wider grows by about 3 px                                                                                                                                               | The Button: fix now. The other sites: a later sweep                                                                     |
| I13 | 2                        | `mobile/app.json:6`, `AndroidManifest.xml:22`                                                              | SC 1.3.4                                                                  | The app is locked to portrait. `targetSdk` is 36, and the manifest has no opt-out property. Android 16 ignores the lock on screens 600 dp and wider (developer.android.com, "Behavior changes: apps targeting Android 16", checked 2026-10-01). Tablet landscape is real there, and nothing tests it                                                                                                                                                                                                                  | Unlock, then check every screen in landscape                                                                                                                                                                                                                                                  | Owner decision. Outside this PR                                                                                         |
| I14 | 1                        | `UI/variantPartsLine/VariantPartsLine.native.tsx:167-170`                                                  | judgement (§S4 gave no line height)                                       | No `lineHeight`, so React Native's default of about 1.2 applies. Web inherits the body's 1.5. A dotted line of up to 8 lines reads tight                                                                                                                                                                                                                                                                                                                                                                              | `lineHeight` = size × `nativeTokens.lineHeight.body`                                                                                                                                                                                                                                          | Fix now                                                                                                                 |
| I15 | 1                        | `FR/filters/RecipeFilterBar.native.tsx:359-401`                                                            | Material 48 dp. Probably SC 1.4.11                                        | Chips and Clear are about 33 dp, the input is about 36 dp and Done is 44. The input's only boundary is `rgba(178,190,195,0.3)`                                                                                                                                                                                                                                                                                                                                                                                        | 48 dp. A `slate` input border, as in §S9                                                                                                                                                                                                                                                      | Owed to U15                                                                                                             |
| I16 | 1                        | `UI/sheet/useKeyboardShown.native.ts:89-90`                                                                | judgement                                                                 | `keyboardDidShow` fires after the iOS keyboard animation, so the collapse lands as a second jump                                                                                                                                                                                                                                                                                                                                                                                                                      | `keyboardWillShow` on iOS                                                                                                                                                                                                                                                                     | With U14, the first sheet with a toolbar                                                                                |

**Belongs in `packages/apps/commise/ui`:** I1's badge chip, I2, I3, I5 to I8, I11, I12, I14 and I16. These are
classes, not incidents.

**Run, none found:**

- **Swipe.** It matches §S8.1: it claims the touch on start, and follows and dismisses only a downward, mostly
  vertical drag. It closes at 96 dp or 0.8. It snaps back with `overshootClamping`, or at once with reduce
  motion.
- **Sheet.** Focus goes to the title on open and on show. The host's close count returns focus. Close is 48 × 48 on
  both platforms. Every dismiss route calls `onOpenChange(false)`. Web sets `aria-modal`. The title wraps.
- **Nameless lines.** `StandIn` is built on both platforms. The unreachable `RefreshNotice` stays mounted, and
  recovery moves focus to the heading. The restore-refused alert shows inside the preview on both platforms. The
  German +35% stand-in wraps at spaces at 320 px.
- **Reflow.** At 320 px and 100% text, the Sheet, `VariantPartsLine` and `StandIn` cause no sideways scroll. The
  only sideways scroll on the test page came from I1.
- **Deceptive patterns.** None.

**SCs checked:** 1.3.1, 1.3.2, 1.3.4, 1.4.1, 1.4.3, 1.4.4, 1.4.10 and 1.4.11. Also 2.1.1, 2.1.2, 2.4.3, 2.4.7,
2.4.11, 2.5.7, 2.5.8, 3.1.2, 4.1.2 and 4.1.3. **Not checked:** a device, VoiceOver and TalkBack (still owed, §S8.1),
`forced-colors` and RTL.

**E2 fix status (2026-10-01).** These rows are fixed in code. Each fix has a test that failed first.

- **I1.** On both platforms the status badges now sit inside the name's text block. The badge is a new primitive,
  `@commise/ui/status-badge` `StatusBadge`, with `tone: neutral | caution`. It is not built on `StandIn`, because a
  dashed outline means "these words stand in for a name". On native the `Custom` badge is now a pearl chip, and the
  badge text is 12 pt. Both now match web. A badge that wraps is a rounded rectangle, because its radius is half its
  one-line height. The name width at 320 px was not measured again.
- **I2.** The Button radius is half the minimum height on both platforms. The native height did not change.
- **I5.** The web Sheet also publishes `--sheet-visible-top`. Below 640 px its top is the top of the visible box.
  From 640 px it is centred in the visible box.
- **I8.** `VariantPartsLine` now uses `break-words`.
- **I10.** The filter count badge has a 22 dp minimum height and vertical padding, so it grows with the text.
- **I12.** The Button touch size now follows the pointer, not the width (`md:pointer-fine:min-h-0`). The other
  `md:min-h-0` and `sm:size-6` sites are left for a later sweep.
- **I14.** The native dotted line uses the body line height, 1.5 times its font size.

Still owed: the spec fixes for §S4 and §S8.1, a device check, and a `staff-ux-engineer` check of the new badge. Rows
I3, I4, I6, I7, I9, I11, I13, I15 and I16 are not fixed here.

**E2 re-check by `staff-ux-engineer` (2026-10-01).** I wrote the spec, not this code. **Seen rendered:** E2's
method, with the real `StatusBadge`, `StandIn`, `Button`, `VariantPartsLine` and `Sheet`. The detail rows are a
static copy of `RecipeDetailBody.tsx:333-444` as it is now. ⚠️ This copy also has the card's `bg-card p-2`, which
E2's copy left out. So each row has 16 px less room than in E2, and the gains below are understated. **Native is
read in code only.** The spec fixes for §S4, §S8.1 and §S8.1a are now made.

| #   | Verdict  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Accepted | Web at 320 px and 100%: the name block is 130 to 146 px (E2: 37), and no word breaks mid-letter. Every badge sits inside its block and inside its own curve. A German badge twice the English length wraps to two lines as a rounded rectangle (146 × 40 px, radius 11). At 640×360 and 200%: 300 to 331 px. No sideways scroll at 320 px. Computed contrast: `slate` on `pearl` 4.81:1, `charcoal` on `warning/25` 10.85:1. Native, in code: the badges sit in the wrapping block, so they no longer take the name's width |
| I2  | Accepted | Web: the text stays inside the curve at every size and both text scales. The worst case is 10.7 px inside (E2: 48 px outside at 390 px). Native, in code: the radius is 22. At font scale 2, the curve's inset at the first line is about 2 dp, against 20 dp of padding                                                                                                                                                                                                                                                    |
| I5  | Accepted | Modelled keyboard: the keyboard hides 0 px at every size (E2: 100 to 199 px). From 640 px the sheet centres on the visible box (768×1024: centre 356 px, box centre 356 px). A panned box moves the sheet with it                                                                                                                                                                                                                                                                                                           |
| I8  | Accepted | In the host with no `min-w-0` (71 px), no dot starts a line at 320 or 390 px (E2: dots did). Under the text-only stress test, in a box 84 px wide, one dot starts a line where `separable` alone is wider than the box. That is the stated exception (§S4)                                                                                                                                                                                                                                                                  |
| I10 | Accepted | In code: a 22 dp floor and 2 dp of vertical padding, so the digit stays on its fill. One digit at a large scale makes a tall oval. That is cosmetic                                                                                                                                                                                                                                                                                                                                                                         |
| I12 | Accepted | Touch emulated (`pointer: coarse`) at 768 and 1024 px: a Button is 44 px (E2: 41). A mouse keeps 41 px. On touch the checkbox stays 24 px, as recorded: `sm:size-6` waits for the sweep                                                                                                                                                                                                                                                                                                                                     |
| I14 | Accepted | In code: `lineHeight` is the size × 1.5, as specified                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**fe-1's stated choices.**

- **`StatusBadge` is not built on `StandIn`.** Accepted. A dashed outline means words in place of a name. A filled
  chip means a status. The two tones change for different reasons (`UI/statusBadge/props.ts`).
- **Native `Custom` is now a pearl chip, and badge text went from 11 to 12 pt.** Accepted. Both match web
  (`text-caption`, 12 px).
- **Native caution weight went from 600 to 500.** Accepted. It matches web's `font-medium`. The tint carries the
  caution, and the words carry the meaning (SC 1.4.1). The fix-status note above omits this change. It is recorded
  here.
- **At a large native font scale, a one-line Button is a rounded rectangle.** Accepted. That is §S13's rule on a
  platform that does not scale a radius with text. The rule keeps the words inside the curve, and they stay inside.
  A pill at every scale needs the font scale read in the leaf, and it buys shape only. Web stays a pill at 200%,
  because its radius is in rem.
- **On wide screens, the badges no longer form a column at the right edge.** Judgement: accepted. The caution fill
  is found by colour, not by position. The reading order did not change.

⛔ **Residual: it blocks U15's own test.** Take the text-only stress test at 320 px. The name block is still 0 px.
The page scrolls 51 px sideways. At 390 px the block is 10 to 41 px. The stand-in row, which did not change,
does the same. The cause is now the checkbox (`size-11`, 88 px at root 200%) and the `shrink-0` quantity, not the
badge. Both WCAG frames pass: 320 px at 100% (SC 1.4.10), and 640×360 at 200% (SC 1.4.4). But U15's Playwright
project asks for "320 x 640 and at 200% text" with no overflow. As written, it fails on every ingredient row.

1. **Owed, in U15's plan text:** split that project into the two WCAG frames, 320×640 at 100% and 640×360 at
   200%. Root 200% at 320 px stays a measurement, not a gate.
2. **I recommend, in U15 (size S):** the quantity joins the flowing text block on both platforms. On native the
   checkbox does not scale. But the quantity is `flexShrink: 0`, so at a large font scale it still takes the
   name's width.

The places where this chip is not yet `StatusBadge`, and the unit that owns each: `namelessLineCopy.md` §2c.

---

### E3 V3 check (2026-10-03): the curated surfaces at the end of the plan

**By `staff-ux-engineer`, from the V3 review** (`docs/design/v3Evaluation.md`). Source only for these surfaces.

- The read-surfaces pass's D1 to D9 and D11 are fixed in source (`v3Evaluation.md`, Passes run, lists each anchor).
- D10 is still open: `ui/src/sheet/FullScreenSheet.native.tsx` (`@commise/ui/full-screen-sheet`) slides with reduce motion on. The fix is in the
  primitive, which has three other consumers. SC 2.3.3 is AAA, so this is minor.
- The dotted line on the row editor holds: a record row shows it under the name, and Change food hides it (item 4).
  The name above it is too narrow on web. `ingredientStatusExplanation.md`'s V3 amendment rules on that.
- §S14 is superseded where S7 reverses it (`rowEditorOpenDecisions.md`, S7 list contract). V36's "never grouped by
  source" reverses (P1: one group per source). V37's visible source tag goes (P5: the heading names the source, and the
  accessible name says `{name}, from {source}`). V49 goes with live search (S7.9). The decision log below records the
  three as V51 to V53.

## Advocacy

| Where                                                                       | Situation           | What happened                                                                                                                                                                                                        |
| --------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A cooked root must say so (D10). A root-bound line shows the name only (D6) | **B**               | The sentence is in the line's panel, where the line's numbers are read. Both rules hold. ⚠️ The owner can read D10 as "on the visible line". Then D6 needs an exception for these roots, and the owner decides that. |
| D10 has no data behind it                                                   | **A, raised**       | Raised in E3 and Hand-off. The fix is a seed field. That is an owner decision, because it regenerates the seed.                                                                                                      |
| The literal R26 rule leaves ribeye flat                                     | **B, recommended**  | Specified literally, because the other reading groups 4 roots by cooking method, which D2 rules out. E2 gives the numbers.                                                                                           |
| Groups of one row                                                           | **B, recommended**  | E4 proposes a fourth condition. This spec does not add it.                                                                                                                                                           |
| No state (D2, naming rule 20)                                               | **C, kept exactly** | My earlier design is withdrawn where it conflicts with D2, and so is its menu caption. Cooked variants say so in their own parts. Calorie order keeps the list usable.                                               |
| The earlier "the one you buy" framing                                       | **C**               | Withdrawn everywhere: the menu caption, the dialog intro, and the old argument about the weight a recipe line states.                                                                                                |
| U25 lists every register entry                                              | **B, recommended**  | §S16 lists only the sources in use, so the page does not credit a database that supplies nothing. Flagged as E14 for the owner.                                                                                      |
| A citation that is not an exact match (U12 asked for a decision)            | **B, decided**      | §S17: no disclosure on the line. The page states the rule and the panel names the source. The `generic`-only flip is specified.                                                                                      |
| The credit line has no language on the wire                                 | **A, raised**       | E11. The web page cannot claim AA without `attributionLang`. The fix is one register field.                                                                                                                          |
| U12 asked for a source-neutral catalog label                                | **B**               | The per-row badge collapses into the section heading, and live hits name their source. A label on every row only repeated the heading.                                                                               |

## Evidence: verified · assumed · judgement

- **Verified by measurement** (2026-09-30, on the committed seed and the local USDA CSVs): every figure in §1b, the
  grouping results in §S8.3 and E2, the one-row groups in E4, and the 51-root word scan in §1e.
- **Verified by reading:** the plan's Summary, KTD-7, KTD-15, KTD-21, the statechart, U9 and U12 to U15. The
  origin's R22 to R30, AE1 to AE8 and Key Decisions. `namingRules.md` rules 10, 14 and 17 to 28.
  `ingredientStatusExplanation.md` §3a, §6b, §6c and §8d. `offlineWriteAcceptance.md`. `UI/offlineNotice/props.ts`,
  `UI/dialogFocus/*`, `UI/button/props.ts`, `UI/button/surfaceClass.ts`, `UI/tokens/colors.ts`, `UI/tokens/scale.ts`.
  `FR/collections/PullUpdatesDialog.tsx`, `FR/nutrition/messages.ts`, `features/core/src/offline/messages.ts`,
  `recipeLinePrecision.txt`. The generated `packages/apps/commise/ui/dist/theme.css` emits every utility this spec
  names: `--radius-md` is 0.75rem (12 px), and `--text-heading-md`, `--text-caption`, `--color-ocean-dark`,
  `--color-slate` and `--color-seafoam` exist.
- **Verified by render:** E1.
- **Verified by reading, for the §S8.1 amendments:** every repo path that §S8.1 and §S8.1a cite. Radix
  `react-focus-scope` 1.1.16: no mount autofocus when focus is already inside. Radix `react-dialog` 1.1.23: no
  `aria-modal`, and props spread after its defaults. React Native 0.86.3: `Modal.d.ts` (`onShow`),
  `ReactModalHostView.kt:332`, `LayoutAnimation.js`, and `PanResponder.js` (`vy` is points per millisecond).
- **Assumed:** the keyboard heights and safe-area insets in E1. That the plan 002 V1 panel keeps the committed §6
  composition. That `hasVariants` comes on every root-bound line of the stored read (U9); the editor's batch read leaves it absent when food did not state it, for an authored food and for a withheld line. That an iPad's shortcut bar reports a
  height under 150. That Android's modal resize still works on an edge-to-edge window. The swipe thresholds. The
  filter-sheet title's wrap at 200% text (estimated, not rendered).
- **Judgement, not evidence:** calorie order makes the list usable. Headers do not stick. The intro's words. The
  panel as the place for the D10 sentence.
- **For §S13 to §S19, verified by measurement** (2026-10-01): §S17's tier counts and §S13's 15 roots with no numbers,
  from the working-tree `curatedCatalog.jsonl` (U24's output, uncommitted). The longest register strings in §S16, from
  the untracked `sourceRegister.ts`. E1b.
- **For §S13 to §S19, verified by reading** (2026-10-01): both picker components and their app dictionaries.
  `FR/hooks/ingredientResolver.model.ts`, `FR/hooks/liveIngredientSearch.model.ts`, `FR/messages.ts`. The recipe
  `ingredients.schema.ts` and the food `foods.schema.ts`. `FR/detail/RecipeDetailBody(.native).tsx`,
  `FR/detail/RecipeSourceLine(.native).tsx`, `FR/detail/openExternalUrl.native.ts`, `ui/src/sheet/FullScreenSheet.native.tsx`.
  `mobile/src/screens/AppRoot.tsx`, `AccountSettings.tsx`, `web/src/app/[locale]/settings/SettingsContent.tsx`.
  `UI/button/surfaceClass.ts`, `UI/button/Button.native.tsx`, `mobile/src/components/LoadingState.tsx`,
  `web/src/components/recipes/IngredientRowsSkeleton.tsx`. `recipe-core/src/nutrition.ts`. The plan's R50 to R60,
  KTD-15, KTD-22, KTD-25, KTD-26, U12, U15 and U22 to U29. 016's spec (User Story 3) and its plan's file tree. 001
  FR-007a.
- **For §S13 to §S19, verified live** (2026-10-01): the CC BY 4.0 legal code, §3(a)(1) to (3). W3C, Understanding SC
  3.1.2: Level AA.
- **For §S13 to §S19, assumed:** that the endpoint can compute `inUse` and `converted`. That the native editor scrolls the focused field above the keyboard. That the suggest
  query parks, and does not fail, while offline. The hit names in frame 17.
- **For §S13 to §S19, judgement:** "Try again later". No auto-scroll. The
  panel's source line. §S17's decision.

**Confidence.** _High_ for the grouping rule and its fixtures (measured on the real seed). _High_ for the line
and dialog layout (rendered and measured at every required width and text size). _Informed prior_ for the dotted
line reading as one label (proximity, recognition over recall). _Low_ for whether cooks find `⋮ → Add details`
without help, because no study exists (E10). For §S13 to §S19: _High_ for the outcome table and the labels (derived from the plan's settled facts and
the code). _High_ for the frames' layout at every width and text size (E1b). _Medium_ for the native keyboard and focus
behaviour (reasoned, not seen). _Informed prior_ for leaving the scroll to the cook (Nielsen #3, user control).

## References consulted

`ux-mode-playbooks` (SPECIFY). `ux-design-corpus`: `critique-handoff.md`, `accessibility.md`,
`cross-platform-translation.md`, `content-design.md`, `internationalisation.md`, `device-ergonomics.md` and
`design-system-architecture.md` (component API). Also the files under "Verified by reading". The target sizes
(WCAG 2.5.8, Apple 44 pt, Material 48 dp) come from `device-ergonomics.md`. The contrast ratios are the token
file's own measured values. For the §S8.1 amendments: `interaction-motion.md` (motion, reduce motion, gesture),
`accessibility.md` (SC 2.5.7), `cross-platform-translation.md` (the sheet rows). Live, 2026-09-30: Apple HIG
"Sheets", read through search results and not the page. It puts a grabber on a resizable sheet. Android
`BottomSheetDragHandleView`: its screen-reader action cycles heights. Compose `BottomSheetDefaults.DragHandle`:
"an optional visual marker".

For §S13 to §S19 (2026-10-01): `ux-mode-playbooks` (SPECIFY). From `ux-design-corpus`: `critique-handoff.md`,
`accessibility.md` and `cross-platform-translation.md`. Also `content-design.md` and `internationalisation.md`. Also
`interface-patterns.md` (live regions for messages) and `information-architecture.md` (search). Also
`device-ergonomics.md` (target sizes, thumb reach) and `interaction-motion.md` (the state list). Live: the CC BY 4.0 legal code, and W3C
Understanding SC 3.1.2.

## Artefacts written

| Path                                                                             | Class                                                                                                                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/design/ingredientSpecialization.md`                                        | design spec (this file, rewritten in full. §S8.1, §S8.1a and dependants amended after U21's blueprint and EVALUATE)                                     |
| `docs/design/variantDetailsMockup.html`                                          | rendered mockup, not production code. Its × is now named `Close details` (V29). No visible change, so E1 stands                                         |
| `docs/design/variantDetailsMockup{320,390,768}.png`, `…{320,390,768}Text200.png` | screenshots of the mockup (E1)                                                                                                                          |
| `docs/design/ingredientSpecialization.md` (2026-10-01)                           | design spec, extended: D13 to D17, §S13 to §S19, E11 to E17, E1b, and the rows appended below                                                           |
| `docs/design/variantDetailsMockup.html` (2026-10-01)                             | rendered mockup, not production code: frames 17 to 21 added, and the `.btn` radius is now half its minimum height                                       |
| session scratchpad, `e1b_{320,390,768}_{100,200}.png`                            | E1b screenshots. ⚠️ Not committed: this unit was allowed to edit only the two files above                                                               |
| `docs/design/ingredientSpecialization.md` (2026-10-01, E2 re-check)              | design spec, amended: §S4 Wrapping, §S8.1 keyboard and I7, §S8.1a web below 640 px, and the E2 re-check                                                 |
| session scratchpad, `uxh2/`                                                      | the E2 re-check's test page and screenshots. ⚠️ Not committed                                                                                           |
| `docs/design/ingredientSpecialization.md` (2026-10-01, live copy and filter cap) | design spec, amended: §S14 (D16 scope, tripwire, `failed`, L3 and L5 tests) and §S8.1a (the cap and its focus)                                          |
| `docs/design/ingredientSpecialization.md` (2026-10-02, U14 EVALUATE)             | design spec, amended for the U14 EVALUATE. Sections: §S8.1, §S8.6, §S8.8, §S9, §S10, §S11, §S12 and §S14. Also the Hand-off, V25, V34 and V47 to V50    |
| `docs/design/variantDetailsMockup.html` (2026-10-02, U14 EVALUATE)               | rendered mockup, not production code: the copy in frames 11, 15 and 18, frame 13's focus note, and frames 17 to 19 rewritten for USDA alone (§S14, U29) |
| `docs/design/variantDetailsMockup.html` (2026-10-01, live copy and filter cap)   | rendered mockup, not production code: frame 19's L7 text                                                                                                |

⛔ No feature code, test, token or other design doc was edited.

## Questions blocking this

1. **E3 (data):** does the seed give a root whose own item is cooked its own `cookingMethod` part, or `homemade`?
   Without it, the §S6 sentence cannot ship. The owner decides first, then `staff-architect`.
2. **E2 and E4 (owner, optional):** keep R26 literal, or group ribeye and add a group-size condition? The spec
   builds the literal rule until the owner says otherwise.
3. **The route (one-way door, §S16):** `/{locale}/legal/sources`, in 016's planned `legal/` tree. Confirm it before U25.
4. **U25's listing (E14):** closed. The page lists only the sources in use, and the wire contract says so
   (`food-service/src/foods/dataSources.schema.ts`).
5. **`attributionLang` (E11):** closed. The wire requires `attributionLanguage` (`dataSources.schema.ts`).
6. **§S17:** no disclosure for a citation that is not an exact match. Confirm, or take the `generic`-only flip.
7. **Screenshots:** frames 17 to 21 were rendered to the scratchpad only. Allow new PNGs beside the mockup, or accept
   E1b's measurements as the record.

## Hand-off

| Next actor                                 | Artefact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**                                  | The E3 data question. Optionally, E2 and E4. D13's wording: live search now reports its one source's outcome by status code, and the heading names that source (§S14, U29 2026-10-02).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **`staff-architect`**                      | E3: an optional root label, carried from the seed to the root read and to the root-bound line, as open-string parts like a variant's. Only §S6 uses it. It is not a flag and not a state field. Also: §S7 reads `hasVariants` on every root-bound line (U9).                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **U21 (Sheet)**                            | §S8.1 and §S8.1a. It is a design-system primitive, so the `@pattern` tag applies. ⚠️ Three things for the plan. (1) U21's file list still says "back intercept". It is `Modal.onRequestClose` (§S8.1). (2) "The filter bar keeps every existing test green" cannot hold as written. `RecipeFilterBar.native.test.tsx:161` asserts a `group` named "Filter recipes", which becomes the dialog's name: rewrite it to the dialog. The three inset tests (`:630-656`) test geometry that moves into the Sheet: move them to `Sheet.native.test.tsx`, and say in the commit where the coverage went. (3) Device checks owed: the seven items under "Owed on a device" in §S8.1, after the swipe rules. |
| **`FullScreenSheet.native.tsx` owner**     | `ui/src/sheet/FullScreenSheet.native.tsx` is a second sheet, with three consumers. It stays in U21 (plan U21: it is a full-screen page, not a dialog). Whether to fold it in as `size="full"` later is its own change, decided with those three surfaces.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **U13 (VariantPartsLine)**                 | §S4, including the measurement-token rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **U14**                                    | §S8.3's rule and fixtures, §S8.6's focus table, §S9 and §S11. The plan's state name `combined` now means "the short list". Renaming it to `shortList` is cheap and clearer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **U15 / `fe-1`**                           | §S1's surface table and §S12. Build to WCAG 2.2 AA, and check that the implementer's stated floor matches.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **`ingredientStatusExplanation.md` owner** | §S7 amends its §3a menu table. That file is outside this unit's file list, so it is not edited here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **A human**                                | The E10 study.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **U22 / U25 (food-service and the page)**  | §S16: the endpoint fields (`shortName`, `licenceName`, `attributionLang`, `inUse`, `converted`), the route, the native sheet and the two ways in. `FullScreenSheet` gains `onShow`. The keys in §S19.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **D16's owner, and U29 (2026-10-01)**      | §S14: D16 reads "No label of catalog data names a single source". `failed` becomes `The USDA search didn’t finish. Try again.` The name of `sourceRegister.test.ts:183-186` cites §S14's copy table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **U15 / `fe-1` (2026-10-01)**              | §S8.1a "The ingredient filter at its cap" and "Focus at the cap": done 2026-10-02 (the native note style, the chip `×` and touch heights, the focus table and its tests). Still owed: the design-system chip whose radius is half its minimum height.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **U29**                                    | §S14: USDA's outcome by status code, and a variant hit's root name and parts. The model states L1, L2, L4 and L6 to L8, and the copy table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **U15 / `fe-1`**                           | §S13's fixes on both pickers, §S15's labels and note (with the new `hasCatalogNutrition` in `recipe-core`), and §S18's tables. Build to WCAG 2.2 AA. The cook's own foods are their own group after S5 (§S15), so no row needs an own-food flag.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Design system (`UI/button`)**            | E13: the `Button` radius is half its minimum height, on web (`surfaceClass.ts:54`) and native (`Button.native.tsx:105`). One change fixes every wrapped button in the product.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **`ingredientStatusExplanation.md` owner** | §S13 P13: add `statusResolvedNoFigures`, because "Nutrition is counted now" is false for a food with no numbers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **`staff-architect`**                      | §S13: whether a correction mapping can carry `foodVariantId`. Until it can, a result that carries a variant shows no correction control. §S19: `dataSources` in the recipe feature, not `features/account`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Facts that the next mode must carry:** the root has its own numbers (D1). No state (D2). The dotted line comes
from `VariantPartsLine` (D3). R26 is read literally, with first-part keys (§S8.3). The cooked-root sentence is
blocked on data (E3). The dialog title is the action alone, and the food name scrolls (E1). From §S13 to §S18: only
USDA can be busy or skipped, and a source that is not eligible is not reported (§S14). The source tag is plain text
(§S14). The page is `/{locale}/legal/sources` and lists the sources in use (§S16). Non-exact citations get no line
disclosure (§S17).

---

# Decision log

| #       | Decision                                                                                                                                                                                   | Why                                                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V1**  | The cook's words are the main way details arrive. `⋮ → Add details` is the second way                                                                                                      | E-2, E-3. Kept from the earlier version.                                                                                                                   |
| **V2**  | A root-bound line shows the root name only                                                                                                                                                 | D6, R28.                                                                                                                                                   |
| **V3**  | One primitive, `VariantPartsLine`, draws the dotted line on every surface                                                                                                                  | D3. Six surfaces on two platforms need one behaviour.                                                                                                      |
| **V4**  | A no-break space before each dot. Hidden commas for screen readers. No truncation                                                                                                          | A dot never starts a line. R27. R25.                                                                                                                       |
| **V5**  | A measurement token never breaks at its hyphen                                                                                                                                             | The render split `1/8-` from `inch` (E1). The longest token has 8 characters, so it cannot overflow.                                                       |
| **V6**  | One list. Search at 8 or more. R26 read literally, with first-part keys                                                                                                                    | R26. The literal reading never groups by cooking method on the committed seed (E2).                                                                        |
| **V7**  | Rows in calorie order. A row with no value comes last and is never 0                                                                                                                       | R26. Recognition over recall.                                                                                                                              |
| **V8**  | Search hides rows and never regroups                                                                                                                                                       | A list that regroups on each key press loses the cook's place.                                                                                             |
| **V9**  | `Add details` and `Edit details` in `⋮`, one line each, second in the menu                                                                                                                 | D5. The committed menu contract. The earlier caption described a retired framing.                                                                          |
| **V10** | The dialog title repeats the menu item. The food name scrolls                                                                                                                              | Measured (E1): the food name in the title cost up to 6 lines at 200% text.                                                                                 |
| **V11** | `Remove details` in a pinned footer, `edit` only, no confirmation                                                                                                                          | D5. Adding again is one step. The retired case states its cost in copy.                                                                                    |
| **V12** | With an on-screen keyboard open, the title row collapses and the footer hides                                                                                                              | Measured (E1): without it, 0 rows showed at 320 px with the keyboard open.                                                                                 |
| **V13** | A retired current variant reads from the line's own binding. `detailsNoneLeft` offers Close and Remove                                                                                     | R29. Plan statechart.                                                                                                                                      |
| **V14** | A pick commits and closes at once. A rejected write reports on the row                                                                                                                     | Plan statechart. `offlineWriteAcceptance.md`.                                                                                                              |
| **V15** | The cooked-root sentence is in the panel, not on the line                                                                                                                                  | D6 and D10 both hold (Advocacy, B). Blocked on data (E3).                                                                                                  |
| **V16** | Offline uses `readOffline` and `OfflineReadSlot`                                                                                                                                           | One copy of one sentence. The slot's contract.                                                                                                             |
| **V17** | Group headers do not stick                                                                                                                                                                 | At 200% text with the keyboard open, one row remains. SC 2.4.11.                                                                                           |
| **V18** | The tag says `Current`, not `Selected`                                                                                                                                                     | A screen reader already says "selected" for the active row in the combobox.                                                                                |
| **V19** | Catalog text stays English, with `lang="en"` on web                                                                                                                                        | D11. WCAG 3.1.2.                                                                                                                                           |
| **V20** | Retired: everything in the 2026-09-22 design that D1, D2 or naming rule 20 overrules, its FoodOn-derived label clean-up and its menu caption                                               | The owner rulings of 2026-09-26 (the root has its own numbers) and 2026-09-30 (no state), and the curated seed (KTD-16).                                   |
| **V21** | Native back closes through `Modal.onRequestClose` → `onOpenChange(false)`, never through `back-intercept`                                                                                  | An open `Modal` answers back itself. `useBackIntercept` throws with no provider. U21 blueprint, verified here.                                             |
| **V22** | One `toolbar: { heading, controls }`. While collapsed, the heading moves into the title row. Close and the controls never move                                                             | Two copies of the label row put two labels on one input. A remounted input makes the collapse oscillate.                                                   |
| **V23** | The footer hides only while collapsed                                                                                                                                                      | A cook who picks a filter result can press `Done` with the keyboard still open.                                                                            |
| **V24** | `describedBy` on the Sheet                                                                                                                                                                 | Only the Sheet owns `Dialog.Content`. §S9 4.1.2 needs the description wired.                                                                               |
| **V25** | Native opens on the title at `onShow`. The host owns focus return, through a close count advanced on every close: in `onOpenChange(false)`, and in the commit port for a pick or a removal | Effects run child-first, before the modal is presented. React Native cannot read where the cursor was. A pick never passes through `onOpenChange` (§S8.8). |
| **V26** | Safe-area insets on four edges, and keyboard avoidance, live in the Sheet                                                                                                                  | The filter bar's tested inset behaviour moves with it. On iOS, the keyboard covers the filter bar's `Done` today.                                          |
| **V27** | No visible grab handle. Swipe starts on the header only                                                                                                                                    | HIG puts a grabber on a resizable sheet. This sheet does not resize. The list must keep scrolling.                                                         |
| **V28** | The filter bar on the Sheet: title `barLabel`, × `Close filters`, `radius.lg`, the available height, a hairline, a slide                                                                   | §S8.1a. "Filters" as a title matches the trigger's text in whole-string selectors.                                                                         |
| **V29** | The dialog's × is `Close details`. The `detailsNoneLeft` footer button gets its own key, `dismiss`                                                                                         | Two controls named `Close` in one dialog. The footer button had no key.                                                                                    |
| **V30** | A long list still makes the sheet jump once, with no animation                                                                                                                             | E8. `LayoutAnimation` exists, but it animates the whole commit and the commit is the host's.                                                               |
| **V31** | The picker's rules are written for the job, and bind whichever host ships                                                                                                                  | The row spec deletes the picker components (its §8b). §S13.                                                                                                |
| **V32** | The native picker gains loading, failure and offline states, and a live catalog notice                                                                                                     | Built 2026-10-01 (§S13, E12).                                                                                                                              |
| **V33** | No mark before picking a food with no numbers. The selection message says it                                                                                                               | The suggestion wire carries no nutrition, and 0.6% of roots have none (§S13).                                                                              |
| **V34** | Busy and skipped mean "eligible and not called". A source that is not eligible is not reported                                                                                             | Otherwise every search reads as incomplete (§S14).                                                                                                         |
| **V35** | Try again shows only where a source did not answer                                                                                                                                         | Only USDA can be busy or skipped, so each retry spends one call on the missing source (§S14).                                                              |
| **V36** | Hits stay in wire order, never grouped by source                                                                                                                                           | The cook chooses a food, not a database. Only USDA is asked today (U29).                                                                                   |
| **V37** | The source tag is plain text at the row's end, and it wraps under the name below 12rem                                                                                                     | §2c: a chip means "tap to filter". §S8.2's wrap rule.                                                                                                      |
| **V38** | The badge beside the field is dropped. The row badge collapses into the section heading. The cook's own food gets "Your food"                                                              | Its one-database premise is gone. One label per group, and a tag for the exception (§S15).                                                                 |
| **V39** | The nutrition note becomes two sentences, each with its own condition. The first links to Data sources                                                                                     | The credit link must show wherever catalog numbers show. FR-007a keeps its condition (§S15).                                                               |
| **V40** | The panel names its source as plain text, with no link                                                                                                                                     | A link leaves the editor's draft. Plan 002 R26 (§S15).                                                                                                     |
| **V41** | Data sources is `/{locale}/legal/sources` on web and a full-screen sheet on native                                                                                                         | 016's planned `legal/` tree. Native has no router, and a sheet returns the cook to the same place (§S16).                                                  |
| **V42** | The page lists only the sources in use (recommended, E14)                                                                                                                                  | Listing a source that supplies nothing misstates where the numbers come from.                                                                              |
| **V43** | No disclosure on the line for a citation that is not an exact match                                                                                                                        | §S17: a different cause from D10, nothing to act on, and no field on the wire.                                                                             |
| **V44** | A `Button`'s radius is half its minimum height                                                                                                                                             | E1b: a full pill cut its own wrapped label (E13).                                                                                                          |
| **V45** | `overflow-wrap: break-word`, not `anywhere`, inside a flex row                                                                                                                             | E1b: `anywhere` let flex shrink a label and split words that fit.                                                                                          |
| **V46** | "Try again later", with no time promised                                                                                                                                                   | The client cannot know the end of a block (§S14).                                                                                                          |
| **V47** | Native groups are header-role views over their rows, not a `SectionList`                                                                                                                   | The Sheet's scroll region is a `ScrollView`, and React Native reports a virtualized list inside one as an error. 75 rows at most (§S10).                   |
| **V48** | In `error`, web focuses Try again. Native moves the reading cursor to the `loadFailed` text                                                                                                | iOS does not speak an alert role by itself, so a cursor on Try again leaves the failure unspoken (§S12 row 18).                                            |
| **V49** | Live search has no partial states. `busy` names no cause                                                                                                                                   | U29 reports one source by status code (2026-10-02). A 503 also covers a back-off after a 502 to 504 (§S14).                                                |
| **V50** | `{food}` never starts a sentence (`noVariants`, `noneLeft`)                                                                                                                                | Most root names are lowercase, so the sentence usually opened with a lowercase word (§S11).                                                                |
| **V51** | V36 reversed: remote hits are grouped by source, under `From {source}`, after `Not listed?`                                                                                                | S7 P1 (2026-10-02): frames arrive at different times, and a group per source appends without moving a row.                                                 |
| **V52** | V37 reversed: a hit shows no visible source tag. Its heading and its accessible name name the source                                                                                       | S7 P5.                                                                                                                                                     |
| **V53** | V49 retired with live search                                                                                                                                                               | S7.9 deleted live search. The progressive answer's notes (P6) replace it.                                                                                  |
