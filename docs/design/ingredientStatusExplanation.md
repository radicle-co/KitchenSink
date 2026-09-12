# The ingredient row — flows, controls, and the name field

**Modes:** DISCOVER (flows) · DESIGN · SPECIFY · EVALUATE
**Surface:** the recipe-form ingredient rows (web + native)
**Status:** design artefact. Not production code. No component, hook, test or i18n file was edited.

> **Revision 5.** Rev 4 rebuilt from the flows up after the owner's ruling that _the name field **is** the
> picker_. Rev 5 fixes what four reviews found — most consequentially that **the panel's data is not on the
> line on the edit path** (§6), that **`updateIngredientAt` was never actually narrowed** (§4a), and that
> the `16ch` floor I proposed had already been **tried and rejected in this repo** (§3c).

> **Revision 6 (2026-09-21) — three corrections, all in §3's territory.** See
> `docs/design/ingredientRowRev4.html` + `.png`, which supersede `ingredientRowOneLine.html` (rev 3)
> for the row layout and for every fit figure.
>
> 1. ⛔ **A PROTECTED class of qualifiers now exists, and it is never droppable.** Rev 3's write-up said
>    the surviving qualifiers are "raw/cooked, the cut, boneless/bone-in, canned/frozen/fresh, **none of
>    which a cook can lose**" — and its recommended block then rendered `Beef, chuck, shoulder clod` from a
>    string ending `…, cooked, grilled`. **Uniqueness cannot detect this**: the short label IS globally
>    unique and still names the wrong food to the person reading it. Recognisability is a third axis.
>    The class is frozen by a MEASURED rule — median relative |Δ kcal/100 g| ≥ 10% against SR Legacy
>    sibling foods over ≥ 8 pairs — and it **expels four segments from rev 3's own O1 DROP set** that move
>    energy by 20–25% (`separable lean and fat`, `separable lean only`, `meat only`, `meat and skin`), plus
>    `prepared` (44.5%), `solids and liquids` (25.0%), `heated`/`dry heat`/`moist heat` (22.5%) and
>    `N% lean meat` (21.2%). Grading and sampling words measured **below** the bar and stay droppable
>    (`all grades` 4.0%, `choice` 5.1%, `select` 6.0%, `enriched` 0.0%, `trimmed to N" fat` 6.0%).
> 2. ⛔ **The row's icon column carries TWO visible controls, not one and not four.** D6 moved
>    _Change food_ into the icon column beside _create my own food_; `Remove` is already a peer there
>    (`RecipeIngredientsFields.tsx:264-275`), so `NOT_FOUND` needs **four**. At this spec's own 44/48 px
>    floor that is 196 px of a 238 px row. **Actions collapse behind one `⋮` overflow menu; the status
>    glyph stays visible** because it is a signal, not an action, and it is the trigger for F2, which §1
>    ranks _frequent_. §SPECIFY.3 gains the menu-button contract.
> 3. ⛔ **Rev 3's fit figures were not reproducible and must not be quoted.** "98.8% at 390 px with ZERO
>    ambiguity" reproduces exactly (98.9%) only with the uniqueness gate **OFF** — the very qualifier the
>    caption asserts. With the gate ON the same method gives 78.1%. **One line is no longer the design:**
>    under rev 4's constraints it holds for **22.1% at 320 px, 62.4% at 390 px, 99.0% at 768 px**, and 0%
>    at 200% text. ⛔ **The row is a WRAPPING row**, which is what §3d already specified; what changes is
>    that wrapping is now the common case at phone widths, not the exception.

---

## ⚠️ What I got wrong, and the structural reason

**I met U28's read-only name field, correctly called it a collision, and routed the edit into a separate
picker's search box instead of designing "the name is wrong" as a primary flow.** That is the commonest
thing a cook does here. The structural cause: **I never did the DISCOVER step** — I designed against the
brief instead of first asking what a cook does on this row. §1 is that step.

Three more, from review, recorded because each has the same shape — _a confident claim I did not check
against the file I was citing_:

- ⛔ **"The data is already on the line, so no fetch"** was **false on the edit path**. §6.
- ⛔ I proposed a `min-width` floor while citing the very file that **records rejecting one**. §3c.
- ⛔ I "computed" 1.88:1 as a new finding; `AlertBanner.tsx:12` **already records it**. §EVALUATE W2.

---

## Governing decisions checked

| Decision                                                                       | Where                                                         | Binding here                                                                            |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **U28** — no path may _create_ an unresolved row; a resolved name is read-only | `form/props.ts:107-118`; `RecipeIngredientsFields.tsx:60-72`  | §2b reconciles both halves; §4 keeps the append invariant **and narrows the loophole**. |
| ⛔ `AMBIGUOUS` **is not** `UNRESOLVED`                                         | `recipe.types.ts:452-459`; `lineResolutionStatus.test.ts:138` | §SPECIFY.1 splits them.                                                                 |
| ADR-0029 / T150 — authored foods are **substances**                            | ADR-0029; `tasks.md` T150                                     | Substance guardrail, §5.                                                                |
| U3 — catalog-name pollution                                                    | `canonicalNameFrom`                                           | Mistyped-name hazard, §5a.                                                              |
| KTD-3 / U10 — no nutrition columns; **read live**                              | `schema/ingredients.ts:70-78`                                 | ⛔ Why §6 fetches.                                                                      |
| Offline is a **pause**; consumers never branch on connectivity                 | `offlineWriteAcceptance.md`; `offlineNotice.md` §R1           | §7.                                                                                     |
| R19 — a parse binds nothing                                                    | `parse/model.ts`                                              | Parse surface out of scope, §9.                                                         |
| ⛔ No temporary workarounds; greenfield                                        | owner directive                                               | §4's add control.                                                                       |

---

# 1. DISCOVER — the flows, ranked

⛔ **The ranking is the design brief.**

| #      | Flow                                              | Frequency                                                                                        | Evidence                                                                                                 |
| ------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **F1** | ⛔ **Name → match.**                              | ⛔ **Commonest by an order of magnitude** — once per ingredient, every ingredient, every recipe. | A line has no food until this happens, and `validateRecipeForm` blocks the wizard until every line does. |
| **F2** | **Check the nutrition** behind a resolved line.   | Frequent, read-only.                                                                             | The owner's info-popover ruling.                                                                         |
| **F3** | **Catalog doesn't have it** → create my own food. | Occasional.                                                                                      | ADR-0029's purpose.                                                                                      |
| **F4** | **Wrong match** — resolved, to the wrong food.    | Occasional, **high cost if unsupported**.                                                        | `NEEDS_REVIEW` and `AMBIGUOUS` exist because this happens.                                               |
| **F5** | **Still resolving.**                              | Transient, passive.                                                                              | `PENDING`, `PENDING_VERIFICATION`.                                                                       |
| **F6** | **Read the recipe back later.**                   | Every open.                                                                                      | ⚠️ Makes **overflow** first-order: the name is the _only_ thing identifying the food.                    |
| **F7** | **Could not be read at all.**                     | —                                                                                                | ⛔ The _parse_ surface, §9 — out of scope.                                                               |

> ⛔ **F1 is not an error path — it is the act of entering an ingredient.** So the row is **primarily a
> data-entry control** that becomes a record once resolved, and the design optimises _entry_. That is what
> the owner's ruling says: **the name field is the picker.** Every earlier revision treated resolution as a
> remedy reached from a separate control, which is why each needed an entry point and a retarget seam.

---

# 2. DESIGN — the row as one system

**Full inventory, in render order:** name · **icon slot** · no-food note · quantity (low/high) · unit ·
unit note (`:181-185`) · preparation · section · status chip · **calories chip** (`:264-268`) · Remove.

|           | **Entry mode** (unresolved)          | **Record mode** (resolved)                                  |
| --------- | ------------------------------------ | ----------------------------------------------------------- |
| Name      | ⛔ **autocomplete combobox**         | static text, **not typed over**                             |
| Element   | `<input role="combobox">` + listbox  | `<span>` / `<Text>` — §3b                                   |
| At rest   | borderless, **persistent underline** | borderless, no underline                                    |
| Icon slot | alert glyph → error popover          | info glyph → nutrition popover                              |
| Chip      | status word                          | ⛔ none — a row showing calories is self-evidently resolved |

⛔ **One icon slot, always** (B1 collapses the second). The **calories chip stays** — it is the
at-a-glance figure; the panel is the detail behind it. ⚠️ They must agree: §6a's predicate is why.

## 2a. The name field is the picker (F1)

Typing shows suggestions **inline below the field**; choosing one resolves that line. The pattern is
**ARIA APG Combobox** with list autocomplete. ⚠️ **No combobox exists in this tree** — new primitive, §8.
⛔ The list is an **overlay**, so opening it causes no reflow.

## 2b. ⛔ U28 reconciled — both halves

**Half 1 — a resolved name is read-only.** ⛔ **Intact.** Record mode is static text; it cannot be typed
over, so it cannot drift from the food supplying its calories. §2c fixes a wrong match without typing.

**Half 2 — no path may create an unresolved row.** ⛔ **Intact**, by §4 (the trailing row is a control, not
a line) **and** §4a (the `updateIngredientAt` loophole is closed by a type, not a comment). U28's premise —
_"typing here could never produce an id … dead UI wearing the costume of a working control"_ — is removed:
typing now **drives the lookup that produces the id**.

## 2c. F4 — fixing a wrong match

> ### ✅ **"Change food" returns the line to entry mode**, preserving quantity, unit, preparation and section.
>
> ⛔ **It lives in the nutrition panel for a `RESOLVED` line** — because `RESOLVED` **is** the wrong-match
> state, and without this a cook's only exit is Remove, which loses the four fields above. It also keeps
> the icon column at one slot.
>
> ⚠️ **Revocable.** This places an action in a popover, adjacent to the owner's ruling that _create custom
> food_ must **not** live in one. Different action, different state, not vetoed — but flagged, and D6 in
> the decision log records it as the first thing to move if the owner reads the ruling more broadly.

One action serves four states: `RESOLVED`, `NEEDS_REVIEW`, `NOT_FOUND`, `FOOD_REMOVED`.
⛔ **NOT `AMBIGUOUS`** — row 7 routes it to its own re-derived shortlist, where one pick binds every
matching sibling and writes ONE correction. Generic re-entry would silently drop that binding.

## 2d. ⛔ Focus targets — every two-state transition names one

Swapping a combobox `<input>` for a `<span>` destroys DOM focus; unnamed, it falls to `<body>`.

| Transition                  | ⛔ Focus lands on                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Select a food → record mode | the row's **icon trigger** (the first focusable thing in the row; static text is not a stop)                             |
| **Trailing row → append**   | ⛔ the **trailing row's combobox, re-emptied** — this is F1's loop; entering eight ingredients by keyboard depends on it |
| "Change food" → entry mode  | ⛔ **inside the new combobox, caret at the end** — otherwise the action does nothing for a keyboard user                 |
| Remove a row                | the next row's icon trigger, or the trailing combobox if it was last. Until B6, Add ingredient. See V1 sign-off item 11. |

---

# 3. ⛔ Overflow — designed

## 3a. The measurement

| Fact                         | Verified                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_INGREDIENT_NAME_LENGTH` | **120 characters** (`ingredients.schema.ts:39`)                                                                                                                         |
| Usable width at 320 px       | ⛔ **240 px, ~30 characters** — `RecipeForm.tsx:56` adds `px-4` **and** the card `p-6`: 320 − 32 − 48. _(An earlier draft said 272/~34, having counted only the card.)_ |
| Web name field               | `rowField = field + 'min-w-0 flex-1'` — shrinks first, to nothing                                                                                                       |
| Native name field            | `rowGrow = { … flexBasis: '100%' }` — ✅ already its own line                                                                                                           |
| Catalog name shape           | USDA: generic head, **distinguishing qualifiers in the tail**                                                                                                           |

⛔ A 120-character name cannot fit in ~30. "Avoid truncating" is unavailable.

## 3b. Record mode is text — and the reasons are not about wrapping

⛔ **The primary reasons are accessibility and platform behaviour. Wrapping is a consequence.** Recording it
the other way round invites someone to revert it with CSS and reintroduce the real defect:

1. ⛔ **A `readOnly` input announces as a textbox the cook cannot use** — a 4.1.2 role/behaviour mismatch,
   independent of layout.
2. ⛔ **Native `numberOfLines` clamping is unreliable on `TextInput`, reliable on `Text`.**
3. _(Consequence)_ text can wrap; an input never can.

⚠️ **What the current input provides and the replacement must keep.** `RecipeIngredientsFields.tsx:96-99`
chose it deliberately — _"keeps the 'Ingredient N name' accessible label AND announces the value"_. A bare
`<span>` loses the per-row accessible name and the `ingredientNameDescribedBy` / `aria-invalid` wiring
(`fieldErrorIds.ts`). ⛔ **Replacement:** the name renders inside a labelled group carrying
`aria-labelledby` → a visually-hidden `Ingredient {number} name` label and `aria-describedby` → the state
sentence; native uses the equivalent `accessibilityLabel` on the wrapping `View`. The row's invalid state
moves to that group.

⚠️ The swap happens on **selection** — a deliberate act with an announced outcome — not on focus.

## 3c. ⛔ No `min-width` floor — this repo already tried one

An earlier draft proposed `min-width: 16ch` **while citing the file that records rejecting it.**
`formSectionStyles.native.ts:76-86`, verbatim:

> *"Giving the name its OWN line is what fixes it, rather than a floor that merely stops the crush: at 60%
>
> - a floor the row wraps as `[name][low][–]` / `[high][unit]`, splitting a range across two lines with the
>   dash orphaned."*

⛔ **Adopt the conclusion, not the rejected alternative: the name gets its own full-width line.** Web has no
floor at any breakpoint — at wide widths the name shares a row and has room; at narrow widths it takes its
own line, as native already does. **P6** is the parity finding.

## 3d. The design, and the trade

> **Record mode** — wraps to **2 lines**, then ellipsis. **Entry mode** — single line, caret-scrolls.

⛔ **The trade: uniform row height, given up to keep the food's identity readable.** My earlier
icon-alignment argument rested on fixed height; it is paid for differently —

> ### ✅ **The icon column aligns to the TOP of the row.** With `align-items: flex-start`, every control sits at the same offset from its row's top edge. Rows vary; the column stays predictable within each.
>
> ⛔ **Rev 6 corrects the last sentence, which used to read "most names are one line".** Measured over real
> consumption, one line holds for **22.1% of occurrences at 320 px and 62.4% at 390 px** with the two-control
> column in place. Wrapping is the common case on a phone. The clamp is therefore **2 lines at 320 px is the
> median, not the exception** — and the icon column's top alignment is what keeps a list of mixed-height rows
> scannable.

### ⚠️ Owning it: the 2-line clamp is still end-truncation

§3a rejects ellipsis because it removes the distinguishing tail — **and that objection applies unchanged at
the two-line boundary.** The clamp reduces how often it bites (two lines ≈ 60 characters at 320 px, which
covers most catalog names); it does not change its nature.

⛔ **Middle-truncation considered and rejected.** `Milk, whole, 3.25% mil…added vitamin D` keeps head and
tail — squarely aimed at this failure mode. Rejected because: it is unreadable in a **wrapped** context (the
elision lands mid-line, not at a boundary); it has no CSS implementation and no RN implementation, so it
means measuring text and cutting by hand on both platforms; and it defeats copy-paste and find-in-page.
⛔ The residual is discharged by §3e, not by a cleverer truncation.

## 3e. Where the full name always lives

1. ⛔ **The nutrition panel's heading** — full, wrapped. The icon is on **every row, always**, so this is a
   guarantee, not a fallback.
2. **The accessible name** — AT reads the whole value regardless of clipping. Screen-reader users lose
   nothing.
3. **Entry mode** — caret navigation, with ⛔ **Home/End bound to the text field** (not to the listbox;
   APG permits either and this one must be specified — §3e is the third escape route and depends on it).

⛔ `white-space: nowrap` is not used and never was the issue.

---

# 4. The add control — F1's front door

> ### ✅ **A permanent empty combobox row at the end of the list**, replacing the `PlusIcon` (`:329`).
>
> Type, pick, the line appends and the row re-empties. ⛔ **U28 half 2 intact:** the trailing row is a
> **control with local state, not a `RecipeFormIngredient`.** Nothing enters `values.ingredients` until a
> food is chosen.

## 4a. ⛔ Closing the `updateIngredientAt` loophole — with a type, not a comment

An earlier draft warned against it in prose. ⛔ **That is a convention, not a constraint:**
`patch: { ingredientId: null }` still type-checks and produces exactly the row U28 exists to prevent.
**In the same commit as `rebindIngredientAt`:**

```
| { readonly kind: 'updateIngredientAt'; readonly index: number;
    readonly patch: Partial<Pick<RecipeFormIngredient, 'quantity' | 'unit' | 'preparation' | 'groupLabel'>> }
| { readonly kind: 'rebindIngredientAt'; readonly index: number; readonly line: ResolvedRecipeFormIngredient }
```

The real patch sites are only those four fields. ⛔ `rebindIngredientAt` takes
`ResolvedRecipeFormIngredient`, so a rebind to nothing is unrepresentable; it carries the new
`ingredientId`, `name`, `resolutionStatus` and nutrition, and must not disturb the four above.

## 4b. ⛔ The trailing row must not silently discard text

Type a name, never open the list, press Save: the text is control-local, `validateRecipeForm` reads
`values.ingredients` and **structurally cannot see it**, the ingredient vanishes. ⛔ That is U28's stated
failure in a new costume.

> ### ✅ **Block submit while the trailing row holds text.** The row reports `hasPendingText` upward; the form's submit guard reads it and renders `ingredientPendingText` naming the row, with focus moved there.
>
> ⛔ **Not resolve-on-blur** — it would silently bind a food the cook never chose, which is worse than
> losing the text. ⛔ **Not warn-and-discard** — it destroys work the cook can see on screen.
> ⛔ **And not by lifting the text into `values`**, which reopens U28.

⚠️ **Entry mode exists on three surfaces** and the rule is identical on all three: **the in-progress text is
control-local and the line in `values` is untouched until a pick.**

| Surface                                | Line in `values`                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Trailing add row                       | ⛔ **none exists** until a pick                                                                     |
| Restored line, `ingredientId === null` | exists, unresolved; unchanged until a pick                                                          |
| Line returned by "Change food"         | exists, **still resolved to the old food**; unchanged until a pick — ⛔ so cancelling loses nothing |

---

# 5. F3 — creating a custom food

⛔ **The control lives in the row's icon column, not inside a popover** (owner, explicit). The error popover
**prompts** toward it: the prompt names the control by its exact accessible name, ⛔ the referenced button is
**highlighted while the popover is open**, and "fix the name" needs no button because it points at the
combobox directly above.

⚠️ ⛔ **Record-mode states need different wording.** On `NOT_FOUND` (record mode) the name is static, so
"fix the name above" points at a field the cook cannot type into. That state's prompt says **"Change food"**
instead — §SPECIFY.2's `errorPromptRecordMode`.

## 5a. ⛔ The two paths are equals — a safety rule, not politeness

A wrong name is far commoner than a missing food (F1 vs F3), and authoring a mistyped name puts a bad entry
into a catalog with a **promotion path to shared state** (U3, by a new door).

- ⛔ **Equal visual weight.** No primary/secondary styling.
- **Fixing is named first** — ordering by frequency, not emphasis.
- ⛔ **The authoring form shows the name it will create, prominently and editably.** This is the safeguard.
- ⛔ **Freeform (`isUserEntered`) gets an INFO glyph and no create button.** The cook deliberately wrote
  their own wording; an alert glyph contradicts `statusFreeform`'s own "not an error", and pairing it with
  a create button nudges toward authoring on the one state where the cook already chose otherwise. Its
  panel offers **"Find a food for this"** only.

⛔ **Substance guardrail:** a single ingredient with its own nutrition label; a cooked dish is a _recipe_,
not a food (ADR-0029 / T150).

---

# 6. F2 — the nutrition panel

## 6a. ⛔ The data is NOT on the line on the edit path — corrected

An earlier draft claimed _"no fetch, no contract change, no loading state, works offline."_ ⛔ **False.**
The only producer of the five per-100 g fields is `toIngredientLine` — **the pick moment**.
`toRecipeFormValues` maps **no macros and cannot**: the recipe-detail wire carries none. So on **every
recipe opened**, every line is `RESOLVED` with zero macros, and the panel would report "no figures
published" for foods with full USDA data — H0's defect class exactly.

> ### ✅ **Fix: lazy fetch on panel open, through the existing per-ingredient read.**
>
> `refreshStatus` _"re-reads the food service, persists the current status (and golden-record nutrition on
> `RESOLVED`)"_ and returns an `Ingredient` carrying the per-100 g fields
> (`ingredients.controller.ts:29`); `useIngredientStatus` already exposes that read. ⛔ **No contract
> change** — but the claim that survives is only _"no contract change"_, **not** "no fetch".
>
> The fetch is **on open, for one row, on demand** — so it costs the list render nothing. ⛔ But the panel
> now has **loading, error and offline states**, specified in §SPECIFY.4. This is KTD-3 working as
> designed: _nutrition is read live_ precisely so a recipe never quotes a stale figure.

## 6b. ⛔ The panel must agree with the row — delegate the predicate

The line also carries `userCalories` / `userProteinG` / `userCarbsG` / `userFatG` (`values.ts:99-102`), and
`lineCalories` (`nutrition.ts:79`) **prefers them** — its docstring records that `userCalories: 0` returns
`0` _because the user stated it_. So a line contributing calories to the row's chip and the recipe total
could open a panel saying no figures exist.

⛔ **`nutritionPanel.ts` must DELEGATE its has-nutrition predicate to `nutrition.ts`**, not stand beside it.
Two modules answering "does this line have nutrition?" is the drift DRY governs, and here it would be
visible as a chip and a panel contradicting each other on the same row.

**Sub-states:**

| Sub-state                             | Panel                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **User-stated** figures present       | ⛔ Shows them, labelled as the cook's own — they are authoritative and they are what the total used. |
| All four catalog macros present       | Full panel.                                                                                          |
| **Some** present                      | Show what exists; each absent one an **em dash** + one footnote. ⛔ Never `0`, never a hidden row.   |
| **None**, `RESOLVED`, fetch succeeded | "Matched, no figures published." ⛔ Not the unresolved copy.                                         |
| Fetch pending / failed                | §SPECIFY.4 — ⛔ distinct from "no figures", which is an answer.                                      |

## 6c. Composition

Full food name (§3e) · **calories per 100 g, large** · protein / carbs / fat as three value-over-label
columns on tabular figures · household portions when present · **a per-100 g basis line, always** — a
figure with an unstated basis is a wrong figure · **"Change food"** (§2c).
⛔ **No chart.** Four numbers do not earn one.

⚠️ **Portions are `{ unit, gramsPerUnit }`** (`recipe.types.ts:820-825`) — there is **no `label`**, and
`unit` is documented as **English-normalized**. So `{unit} = {grams} g` renders `tablespoon = 15 g` in a
German panel. ⛔ Render `unit` through the existing unit vocabulary's localized name where one exists,
falling back to the raw normalized unit. ⚠️ **A fully localized portion label needs a unit-name message map**
— small and additive, named here so it is not discovered at build time.

## 6d. ⚠️ Hover — recommending against, not blocking

⛔ Hover-revealed content invokes **SC 1.4.13** (three conditions, verbatim in the decision log).
**Activation-triggered content does not meet the trigger condition at all**, so click/tap avoids the
criterion entirely. Hover is mouse-only; "press on mobile" already concedes it does not exist there.
**Recommendation: click/tap on both platforms.** If hover is wanted it ships as an _enhancement over_ click,
never the sole route, with all three conditions implemented including a bridge corridor.

---

# 7. Offline

The **authoring** control is ⛔ **never pre-emptively disabled** — _"offline is just a delay … without
causing them to lose their context"_ (`offlineWriteAcceptance.md`). It is attempted; failure renders **on
the item** with the draft preserved. A consumer that disables itself because it believes it is offline is
branching on connectivity.

⚠️ **The combobox degrades honestly**: local catalog suggestions still answer; the remote tier reports
itself unavailable using the picker's existing `catalogUnavailable` copy, `role="status"`. It does not fail
silently and does not block typing.

⚠️ **The panel's fetch (§6a) can fail offline** — §SPECIFY.4 gives it its own state and a retry.

---

# 8. Primitives, and what the picker's deletion displaces

## 8a. ⛔ One hoisted resolver, keyed by row — decide before step 1

`useIngredientResolver` is **single-instance by construction**: one debounce
(`INGREDIENT_SEARCH_DEBOUNCE_MS`), one query subscription, and **one analytics session in a ref whose
unmount effect settles an abandoned session** (`:238-254`, the hook's only ref, `@pattern Memento`).

⛔ Per-row instances mean N timers, N query subscriptions, N sessions — **and that unmount flush firing on
every row deletion**, which is not "leaving the screen".

> ⚠️ **So the controller is hoisted and targeted by row identity — which IS the retarget seam, renamed.**
> D5 claimed it was deleted; **that was true of the UI seam and false of the controller seam.** Corrected
> here and in the decision log. What is genuinely gone is the _visible_ separate picker and the
> scroll-away hazard.
>
> ⛔ **This determines the combobox's props contract, so it is `staff-architect`'s call before step 1**, not
> a layout decision.

## 8b. ⛔ Four surfaces the picker owns and this design does not re-home

Deleting `IngredientPicker` orphans these. **None has a destination yet**, and naming that is the point:

| Surface                                                                                                 | Where it lives now                                                                      |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Disambiguation** (`useIngredientCandidates` / `pickCandidate`, `disambiguating` + `resolving` states) | drives `UNRESOLVED` — §SPECIFY.1 row 6 depends on it                                    |
| **`addFreeform`**                                                                                       | ⛔ the **only** producer of the `isUserEntered` line §SPECIFY.1 row 1 is written around |
| **`AuthoredFoodCreateForm`'s host**                                                                     | F3's whole flow                                                                         |
| **U29 on-demand USDA live search** (`IngredientPicker.tsx:324-437`, its own state machine)              | F1's remote tier                                                                        |

⛔ Step 11 is not "delete a component". It is ~1,600 lines across two leaves, **three** hosts
(`RecipeForm.tsx` only forwards the prop), two prop declarations, 10 dedicated test files, two Playwright
specs and four Maestro flows — and CLAUDE.md requires every deleted test say **where its coverage went**.

## 8c. ⛔ Two enforced guards fail

| Guard                              | Why                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| `maestroFlowSelection.test.ts:423` | names `mobile/src/components/IngredientPicker.tsx` and **asserts it exists on disk** |
| `patternRegister.test.ts:610`      | ⛔ **set equality in both directions** — four entries go stale at once               |

⛔ The new combobox needs a `@pattern` tag **and** a `REF_SITES` entry (it owns a text-input ref). Build
order carries a row for the register.

## 8d. The primitives

| Primitive    | Web                                                             | Native                           |
| ------------ | --------------------------------------------------------------- | -------------------------------- |
| **Combobox** | `@radix-ui/react-popover` + the **APG combobox keyboard model** | RN `TextInput` + positioned list |
| **Popover**  | `@radix-ui/react-popover`                                       | **bottom sheet**                 |

**Library-first gate: ✅ YES for web.** Radix is already an established vendor (`@commise/ui` →
`react-alert-dialog`; `@commise/web` → `react-dialog`). It supplies collision-aware positioning, focus
return, Escape and outside-press dismissal — each a thing hand-rolling gets subtly wrong.

⚠️ **`MoreActionsMenu` is already Radix-web + RN-sheet with a `@pattern` tag.** ⛔ It is **not reused** —
it is a _menu_ (`role="menu"`, roving focus, action items), not a popover or a combobox, and bending it to
host a nutrition panel would break the menu contract it advertises. It stays as it is; the new popover is a
sibling, not a fourth implementation of the same thing. ⚠️ Say so in both docstrings so nobody merges them.

⚠️ **The web combobox consumes the form's own `field` / `rowField` chrome**, because `@commise/ui`'s
`input` export is **native-only**.

⚠️ ⛔ **The controller cannot live in `@commise/ui`** — no react-query, no service client. It lives in
`features/recipes/src/hooks/`. That means `RecipeIngredientsFields` **becomes an orchestration component**
once it hosts it, which ⛔ **ends its purity and obligates a `@pattern` tag** under the enforced register.

## 8e. Cross-platform dispositions (`staff-ux-engineer` §3.6 — an EXTERNAL citation, not a section here)

| Element         | Web                                        | Native                                                                   | Disposition                                  |
| --------------- | ------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------- |
| Name, entry     | inline combobox                            | inline combobox                                                          | **kept**                                     |
| Suggestion list | overlay below                              | overlay below; ⚠️ **repositions above when the keyboard leaves no room** | **kept, behaviour stated**                   |
| Name, record    | text, 2-line clamp                         | `Text` + `numberOfLines={2}` + `ellipsizeMode="tail"`                    | **kept**                                     |
| Name width      | full-width line at narrow widths (**new**) | already full-width                                                       | **kept** once P6 lands                       |
| Icon trigger    | click + Enter/Space                        | **tap**                                                                  | **kept in kind.** ⛔ No hover, no long-press |
| Panel           | Radix popover                              | **bottom sheet**                                                         | ⛔ **moved** — no room to anchor at 320 px   |
| Dismiss         | Escape · outside press · Close             | swipe-down · **system back** · Close                                     | **moved** — `@commise/ui/back-intercept`     |
| Focus return    | Radix → trigger                            | `screen-reader-focus` in and back                                        | **moved** — RN has no DOM focus              |
| Add control     | trailing combobox row                      | trailing combobox row                                                    | **kept**                                     |

⚠️ **Scroll budget:** what must be reachable without scrolling after a pick is **the trailing add row**, so
F1's loop does not require a scroll per ingredient. ⛔ **Keyboard open (native):** the row is already three
full-width lines (name / quantity group / prep+section); with the keyboard up, the focused combobox **and at
least three suggestions** must remain visible, or the list is unusable one-handed.

---

# SPECIFY

## 1. State → what the row shows

First match wins.

| #   | Condition                                         | Name      | Icon glyph → panel                                                                                           | Create btn      | Chip             |
| --- | ------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------ | --------------- | ---------------- |
| 1   | `isUserEntered && resolutionStatus === undefined` | **entry** | ⛔ **info** → no-data + **Find a food**                                                                      | ⛔ **no** (§5a) | `statusFreeform` |
| 2   | `ingredientId === null`                           | **entry** | alert → two paths                                                                                            | ✅              | existing note    |
| 3   | `RESOLVED`, figures present                       | record    | info → nutrition + ✅ **Change food**                                                                        | —               | ⛔ none          |
| 4   | `RESOLVED`, no figures                            | record    | info → "no figures published" + **Change food**                                                              | —               | ⛔ none          |
| 5   | `PENDING` · `PENDING_VERIFICATION`                | record    | info → "looking it up"                                                                                       | —               | status word      |
| 6   | ⛔ **`UNRESOLVED`**                               | record    | alert → ⛔ **candidate picker** over the catalog row's own candidate set                                     | —               | status word      |
| 7   | ⛔ **`AMBIGUOUS`**                                | record    | alert → ⛔ **re-derived shortlist**; one pick binds **every matching sibling** and writes **ONE** correction | —               | status word      |
| 8   | `NEEDS_REVIEW`                                    | record    | alert → **Change food**                                                                                      | —               | status word      |
| 9   | `NOT_FOUND`                                       | record    | alert → **Change food** _or_ ✅ **create** (`errorPromptRecordMode`)                                         | ✅              | status word      |
| 10  | `FAILED`                                          | record    | alert → ⛔ **try again only**                                                                                | ⛔ —            | status word      |
| 11  | `RESOLVED_UNAVAILABLE`                            | record    | info → "someone else's private food"                                                                         | ⛔ —            | status word      |
| 12  | `FOOD_REMOVED`                                    | record    | alert → **Change food**                                                                                      | —               | status word      |
| 13  | `FOOD_UNREACHABLE`                                | record    | info → "not loaded just now; still linked, and saving keeps the link"                                        | ⛔ —            | ⛔ none          |

⛔ **Four dispositions that will be got wrong:**

1. ⛔ **`AMBIGUOUS` is NOT `UNRESOLVED`.** `recipe.types.ts:452-459`: _"⛔ NOT `UNRESOLVED`: that drives the
   CANDIDATE picker over a catalog row's own candidate set; this is the verification gate's abstention over
   a ranked shortlist"_ — and `lineResolutionStatus.test.ts:138` asserts disambiguation must never trigger
   on `AMBIGUOUS`. An earlier draft merged them. ⚠️ `AMBIGUOUS` also carries behaviour **a free-text
   combobox loses**: one pick binds every matching sibling and writes ONE correction. ⛔ **Retiring that is
   `staff-architect`'s call, not mine** — this spec preserves it and routes rows 6 and 7 to their own
   affordances rather than to the combobox.
2. **`FAILED` offers no authoring.** `NOT_FOUND` = _"no wired source has it"_; `FAILED` = _"every source
   errored past the five-attempt retry budget"_ (`foods.schema.ts:49-55`). Authoring on a transport failure
   splits one substance in two, permanently.
3. **`RESOLVED_UNAVAILABLE` offers nothing** (`props.ts:651-654`) — nothing is wrong.
4. ⛔ **Rows 3-4 carry "Change food".** `RESOLVED` **is** the wrong-match state (F4); without it the only
   exit is Remove, which loses quantity, unit, prep and section.

⚠️ **Rows 11, 12 and 13 can have no name** (plan 002 R9). Such a row shows the stand-in chip in the name's place
and no status word; the copy, the tones and the accessibility contract are in `namelessLineCopy.md` §2 and §6c,
which is the authority for them. Row 13 is new with plan 002: the line IS bound, food could not be asked on
this read, and an outage must never cause a replacement (R2), so it offers no Change food and no create.
⚠️ `namelessLineCopy.md` §6b proposes that row 11 gain Change food in the editor. That is not built and waits for
the owner's approval.

## 2. Copy and keys

In `RecipeFormMessages`. `en` required; a new locale is another key. No literals.

| Key                                                                                | `en`                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ingredientNameEditableHint`                                                       | `Type to search foods, then choose one.`                                                                                                                                                                                                                                                                    |
| `ingredientNameRecordHint`                                                         | `Matched to {food}. Use Change food to pick a different one.` ⛔ Delivered on the **name group's** `aria-describedby` (§3b), not on a non-focusable span.                                                                                                                                                   |
| `ingredientSuggestionsLabel`                                                       | `Food suggestions for ingredient {number}`                                                                                                                                                                                                                                                                  |
| `ingredientNoSuggestions`                                                          | `No foods match that yet. Keep typing, or add it as your own food.`                                                                                                                                                                                                                                         |
| `addIngredientRowLabel`                                                            | `Add an ingredient`                                                                                                                                                                                                                                                                                         |
| `ingredientPendingText`                                                            | `Finish adding "{text}" — choose a food for it, or clear the box.` (§4b)                                                                                                                                                                                                                                    |
| `statusActionChangeFood`                                                           | `Change food`                                                                                                                                                                                                                                                                                               |
| `statusActionFindFood`                                                             | `Find a food for this`                                                                                                                                                                                                                                                                                      |
| `statusActionRetry`                                                                | `Try again`                                                                                                                                                                                                                                                                                                 |
| `createCustomFoodIconLabel`                                                        | `Create my own food` — ⛔ **generic, no name interpolated**: an unbounded catalog name inside a popover is the very problem §3 is about, and the prompt quotes this string.                                                                                                                                 |
| `errorPromptEntryMode`                                                             | `Fix the name above if it's not quite right — or, if you know the name is correct, use "{createLabel}".`                                                                                                                                                                                                    |
| `errorPromptRecordMode`                                                            | `Use "Change food" if this matched the wrong thing — or, if the name is right, use "{createLabel}".`                                                                                                                                                                                                        |
| `statusAuthoredSubstanceHint`                                                      | `This is for a single ingredient — something with its own nutrition label. To save a dish you've cooked, save it as a recipe instead.`                                                                                                                                                                      |
| `nutritionBasis` · `nutritionCaloriesLabel` · `…Protein` · `…Carbs` · `…Fat`       | `Per 100 g` · `Calories` · `Protein` · `Carbs` · `Fat`                                                                                                                                                                                                                                                      |
| `nutritionUserStatedNote`                                                          | `These are the figures you entered for this line.`                                                                                                                                                                                                                                                          |
| `nutritionGramsTemplate` · `nutritionPortionsHeading` · `nutritionPortionTemplate` | `{value} g` · `Common measures` · `{unit} = {grams} g` (§6c)                                                                                                                                                                                                                                                |
| `nutritionFieldUnpublished`                                                        | `— means this figure isn't published for this food.`                                                                                                                                                                                                                                                        |
| `nutritionNoFiguresResolved`                                                       | `This food is matched, but no nutrition figures are published for it.`                                                                                                                                                                                                                                      |
| `nutritionNoneAvailable`                                                           | `No nutritional data available` — ⛔ the owner's sentence, verbatim.                                                                                                                                                                                                                                        |
| `nutritionWorking`                                                                 | `We're still looking this food up — figures will appear once it's matched.` — ⛔ the food is still RESOLVING (row 5's `PENDING`), which is NOT the fetch being in flight. Distinct from `nutritionLoading` on purpose: one is our request, the other is the food's own state, and a cook can retry neither. |
| `nutritionLoading` · `nutritionLoadFailed`                                         | `Loading nutrition…` · `We couldn't load the nutrition just now. Try again.` (§6a)                                                                                                                                                                                                                          |
| `nutritionNoneUnavailable`                                                         | `This is matched to someone else's private food, so its details aren't shown. Your recipe is fine as it is.`                                                                                                                                                                                                |
| `statusExplainUnresolved`                                                          | `We found more than one food this could be, and we need you to say which.`                                                                                                                                                                                                                                  |
| `statusExplainAmbiguous`                                                           | `Two or more foods match closely and their nutrition differs, so we'd rather you chose.`                                                                                                                                                                                                                    |
| `statusExplainNeedsReview`                                                         | `This is matched to a food, but what you wrote and what we matched don't quite agree.`                                                                                                                                                                                                                      |
| `statusExplainNotFound` · `statusExplainFailed` · `statusExplainFoodRemoved`       | `We searched the food database and there's no match for this.` · `We couldn't reach the food database. Nothing is wrong with your ingredient — try again in a moment.` · `Whoever added this food has since removed it. Your amount and name are unchanged.`                                                |
| `statusFreeform`                                                                   | `Your own wording`                                                                                                                                                                                                                                                                                          |
| `statusResolvedConfirmation`                                                       | `{food} is matched. Its nutrition now counts.` (text set by V1 sign-off)                                                                                                                                                                                                                                    |
| `statusAuthoredAndLinked` · `statusAuthoredDuplicateLinked`                        | `Saved to your foods, and this ingredient now uses it.` · `You already had a food with that name — this ingredient now uses it.` ⛔ A **success**.                                                                                                                                                          |
| `statusAuthorFailed` · `statusAuthorFailedOffline`                                 | `We couldn't save that food. Your figures are still here — try again in a moment.` · `…you may be offline …`                                                                                                                                                                                                |

⛔ **`ingredientNoFoodNote` must be REWRITTEN, not reused.** Its current text is _"Remove it and add it from
the search above"_ (`messages.ts:394`) — step 11 deletes that search, so reusing it ships a lie.
⛔ **No string mentions recording, corroboration or promotion** (§9).

## 3. Accessibility contract — WCAG 2.2 AA

| SC                           | Contract                                                                                                                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.3.1 / 1.4.1**            | Editability is carried by **role and state** plus a **persistent underline** — never the mouse cursor, never colour alone.                                                                                                                         |
| **1.4.3**                    | ≥ 4.5:1. ⛔ See **W2** — `warning` as a foreground is a shipped failure; it is a **tint behind charcoal**, never a text colour.                                                                                                                    |
| **1.4.4 Resize Text (200%)** | ⛔ The 2-line clamp must not cut mid-word at 200% and the panel must not clip. Same risk class as 1.4.12; **both need one render check.**                                                                                                          |
| **1.4.10 Reflow**            | No horizontal page scroll at 320 px. The name never causes it.                                                                                                                                                                                     |
| **1.4.11**                   | Glyphs, underline, focus ring ≥ 3:1.                                                                                                                                                                                                               |
| **1.4.12 Text Spacing**      | Panel and clamp survive line-height 1.5 / letter-spacing 0.12em / word-spacing 0.16em.                                                                                                                                                             |
| **1.4.13**                   | ⛔ **Not applicable by construction** — activation-triggered (§6d).                                                                                                                                                                                |
| **2.1.1 / 2.1.2**            | Full APG combobox: Down/Up move `aria-activedescendant`, Enter selects, **Escape closes the list without clearing**, Tab leaves. ⛔ **Home/End bound to the text field**, not the listbox (§3e). No trap.                                          |
| **2.4.3 Focus Order**        | ⛔ In record mode **static text is not a focus stop**, so the row's first stop is the **icon trigger**, then quantity → unit → prep → section → Remove. §2d names every transition's target.                                                       |
| **2.4.7**                    | Every trigger, option, dismiss and action ≥ 3:1.                                                                                                                                                                                                   |
| **2.4.11**                   | The suggestion list must not cover its own field; native repositions above when the keyboard leaves no room.                                                                                                                                       |
| **2.5.8**                    | Floor 24 × 24 CSS px. ⛔ **Spec 44 × 44 (web), 48 × 48 (native)** — HIG and Material are stricter. ⛔ **Options are targets too.**                                                                                                                 |
| **3.2.2 On Input**           | ⛔ Typing must not auto-select or change context. Selection is explicit.                                                                                                                                                                           |
| **3.3.2**                    | `ingredientNameEditableHint` / `ingredientNameRecordHint`, delivered per §3b.                                                                                                                                                                      |
| **4.1.2**                    | `role="combobox"` + ⛔ **`aria-autocomplete="list"`** + `aria-expanded` + `aria-controls`; options carry ⛔ **`aria-selected`**; `aria-activedescendant` on the input. Icon buttons carry `aria-expanded` and a name containing the **food name**. |
| **4.1.3**                    | ⛔ **Suggestion count announced** politely as the list updates. Resolution success and the duplicate arm → `role="status"`; authoring failure → `role="alert"`. A duplicate is **not** a fault.                                                    |

### 3a. ⛔ The row's overflow menu — added in rev 6

**What is in it, and what is not.** ⛔ **The status/alert glyph is NOT in the menu.** It is a signal, not an
action: a cook must see at a glance which row has a problem (§1 F6), and it is the trigger for the nutrition
panel (§1 F2, _frequent_). ⛔ **Every action is:** `Change food` · `Create my own food` · `Remove ingredient`
— only those valid for the row's state (§SPECIFY.1), and **the state's own remedy is the first item**.

**Contract, by criterion.** Source: W3C ARIA APG _Menu Button_ and _Menu and Menubar_ patterns, fetched
2026-09-21.

| SC / source       | Contract                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **4.1.2**         | Trigger is a `button` with `aria-haspopup="menu"` and `aria-expanded`; `aria-controls` → the menu's id. Panel carries `role="menu"`, items `role="menuitem"`.                                                                                                                                                                                                     |
| **4.1.2 name**    | ⛔ The trigger's accessible name **names its row** — `Actions for {food}` — never a bare "More". A list of eight identical "More" buttons is unusable by voice control and by a rotor list.                                                                                                                                                                       |
| **2.1.1**         | APG verbatim: Enter or Space "Opens the menu and places focus on the first menu item"; Down Arrow opens and focuses the first item, Up Arrow the last. Inside: Down/Up move item focus, **Home/End** jump to first/last.                                                                                                                                          |
| **2.1.2 / 2.4.3** | APG verbatim, Escape: _"Close the menu that contains focus and return focus to the element or context, e.g., menu button … from which the menu was opened."_ ⛔ Focus returns to the trigger on **every** close path — Escape, outside press, and item activation — except where the action itself names a target (`Change food` → §2d's combobox, caret at end). |
| **2.4.11**        | ⛔ The menu **must not cover the row's own status sentence**, which is the thing it is the remedy for. Rendered and caught: the first draft did. Native uses a bottom sheet, which cannot obscure the row.                                                                                                                                                        |
| **2.5.8**         | Trigger 44 × 44 (web) / 48 × 48 (native); **each menu item is a target too** — 44 px minimum height.                                                                                                                                                                                                                                                              |
| **1.4.13**        | ⛔ Not applicable — activation-triggered, same construction as §6d.                                                                                                                                                                                                                                                                                               |
| **4.1.3**         | Opening is not announced as a status; `aria-expanded` carries it. Destructive `Remove` keeps its existing confirmation path.                                                                                                                                                                                                                                      |

⚠️ **What the menu costs, stated:** one extra tap between a cook and the remedy on `NOT_FOUND`,
`NEEDS_REVIEW`, `FOOD_REMOVED` and a wrong `RESOLVED` match. Accepted because those are §1's _occasional_
flows (F3, F4) while the signal it preserves is on every row of every open (F6). ⛔ **It is not acceptable
for `AMBIGUOUS` / `UNRESOLVED`** (rows 6-7), whose affordance is a candidate list reached from the alert
glyph directly — those are not "actions on a row", they are the resolution itself.

⚠️ **Implementation note, not a new primitive.** `MoreActionsMenu` (`actions/MoreActionsMenu.tsx:1-23`,
`.native.tsx:1-14`) already solves exactly this and records why: `aria-haspopup="menu"`/`aria-expanded`, why
full roving-tabindex was declined there (its content mixes menuitems with a radiogroup), and why the DS
`Button` could not carry `expanded`. ⛔ **This row's menu is uniform `menuitem`s, so it DOES owe the full
APG keyboard model** — that is the one place it must exceed its ancestor, and §8d's "not reused" note must
say so rather than being read as "build a third menu".

**Copy keys** (§SPECIFY.2): `ingredientActionsMenuLabel` = `Actions for {food}` ·
`statusActionRemove` = `Remove ingredient`.

#### ⛔ The column is ALWAYS exactly two slots — `[state] [actions]`

A `⋮` that opens a one-item menu is a worse control than the item itself, and a column whose width changes
per state invalidates every width figure in §3. So:

> ### ✅ **Slot 1 is the state glyph, always. Slot 2 holds `⋮` when the row has ≥ 2 actions, and the single action ITSELF when it has exactly one.** The column is 100 px (web) / 108 px (native) in every state.

| §SPECIFY.1 row                       | Slot 1 — glyph opens                                      | Slot 2             | Menu items, **remedy first**                                                                                            |
| ------------------------------------ | --------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1 freeform                           | info → no-data                                            | `⋮`                | Find a food for this · Remove ingredient                                                                                |
| 2 `ingredientId === null`            | alert → two paths                                         | `⋮`                | Create my own food · Remove ⚠️ **no "Change food"** — the row is already in entry mode; the combobox above _is_ the fix |
| 3 `RESOLVED`, figures                | info → nutrition                                          | `⋮`                | Change food · Remove                                                                                                    |
| 4 `RESOLVED`, no figures             | info → "no figures"                                       | `⋮`                | Change food · Create my own food · Remove                                                                               |
| 5 `PENDING` / `PENDING_VERIFICATION` | info → "looking it up"                                    | **Remove, direct** | — (one action)                                                                                                          |
| 6 `UNRESOLVED`                       | alert → **candidate picker** + ⛔ **"None of these"**     | **Remove, direct** | ⛔ — the picker IS the resolution; generic re-entry is not a menu item                                                  |
| 7 `AMBIGUOUS`                        | alert → **re-derived shortlist** + ⛔ **"None of these"** | **Remove, direct** | ⛔ — offering "Change food" here silently drops the sibling binding and the ONE correction (§SPECIFY.1 note 1)          |
| 8 `NEEDS_REVIEW`                     | alert → explanation                                       | `⋮`                | Change food · Remove                                                                                                    |
| 9 `NOT_FOUND`                        | alert → explanation                                       | `⋮`                | Create my own food · Change food · Remove                                                                               |
| 10 `FAILED`                          | alert → try again                                         | **Remove, direct** | Superseded by V1 sign-off item 4. Try again lives in the panel only. Never Create my own food (§SPECIFY.1 note 2)       |
| 11 `RESOLVED_UNAVAILABLE`            | info → "someone else's private food"                      | **Remove, direct** | ⛔ — nothing is wrong (§SPECIFY.1 note 3)                                                                               |
| 12 `FOOD_REMOVED`                    | alert → explanation                                       | `⋮`                | Change food · Create my own food · Remove                                                                               |
| 13 `FOOD_UNREACHABLE`                | info → explanation                                        | **Remove, direct** | ⛔ — no Change food and no create: an outage is not a reason to replace a food (R2)                                     |

#### ⛔ Rows 6-7 must not be a dead end — "None of these"

The first draft of the table above left `AMBIGUOUS` and `UNRESOLVED` with no exit when the right food is
not in the list: slot 2 is `Remove`, and Remove loses quantity, unit, preparation and section — the exact
loss §2c exists to prevent. ⛔ **Fixed, and NOT by putting "Change food" in a menu**, which would let a cook
reach generic re-entry by a route that looks like the shortlist and silently drop the sibling binding.

> ### ✅ **The candidate list carries its own last option: `None of these — search for a different food`.** It returns the line to entry mode with quantity, unit, preparation and section preserved, and ⛔ **writes no correction**, because declining every candidate is not a binding.

⚠️ The distinction is the whole point and must survive into code: **a pick from the list is a binding**
(and on `AMBIGUOUS` it binds every matching sibling and writes ONE correction); **"None of these" is an
abstention** and must not be modelled as a pick with a null target. New key:
`statusActionNoneOfThese` = `None of these — search for a different food`.

#### What a screen reader hears

**Web, at rest:** _"Ingredient 3, Chicken, breast, meat only, cooked, roasted. About Chicken, breast, meat
only, cooked, roasted, button, collapsed. Actions for Chicken, breast, meat only, cooked, roasted, menu
button, collapsed."_ ⛔ The name is in **both** accessible names — a list of eight buttons all called "More"
is unusable by voice control and by a rotor list, which is why §3a forbids the bare word.
**On opening:** _"expanded"_, then focus lands on the first item — _"Create my own food, menu item, 1 of 3."_
**On Escape or outside press:** focus returns to the trigger, _"… menu button, collapsed."_
**On activating "Change food":** the menu closes, focus lands in the combobox with the caret at the end —
_"Ingredient 3 name, combobox, Chicken, breast, meat only, cooked, roasted, has auto complete, collapsed"_ —
and §SPECIFY.4's `role="status"` line is announced politely without stealing focus.
**Native:** the trigger publishes `accessibilityRole="button"` with `accessibilityState={{ expanded }}`;
the bottom sheet takes `accessibilityViewIsModal`, and `screen-reader-focus` moves focus in and back
(§8e's existing "moved" disposition — no new mechanism).

#### ⚠️ Scroll budget, now that the row wraps

Weighted-mean row height at 320 px is **64 px** with this column and **93 px** without the menu.
⚠️ **Sample and its bias, stated:** the 120 heaviest ingredient names, covering **63.1%** of total
eating-occasion weight. That head is dominated by SHORT names (`Salt`, `Water, bottled, generic`,
`Sugars, granulated`), and short names are exactly where four controls force a wrap that two do not — on
the long names the two layouts converge (the beef row renders 122 px vs 126 px). ⛔ So the bias runs
**against** the menu on long names and **for** it on short ones; since short names carry most of the
weight, 93 → 64 is the conservative reading of a real effect, not a cherry-pick. A ten-line
recipe is therefore ≈ **640 px** of list against a 568 px viewport (320 × 568), versus ≈ **930 px** — one
screenful versus one and two-thirds. ⛔ §8e's requirement stands unchanged: the **trailing add row** must be
reachable after a pick without a scroll per ingredient, and at 93 px rows it is not.

#### ⛔ The menu ships at every width — a decision, not an inheritance

At 768 px the four-control layout fits 96.2% on one line, so the menu **buys nothing on desktop**. §3.6
forbids settling that by symmetry, so it is decided: **one control model at all widths.** The reason is not
space, it is that `Remove` is destructive and its position must not move between a phone and a laptop — a
cook who learns "actions live under `⋮`" must not find Remove sitting bare beside the info glyph on the
device where a mis-click is cheapest to make and hardest to notice. ⚠️ **Flip condition:** if usage shows
desktop editing dominates and Change food is the common action, promoting _Change food only_ to an inline
control ≥ 768 px is a two-way door — Remove is not.

#### ⚠️ Against prior art — where I am departing, and from what

**Atlassian Design System — DropdownMenu, usage** (fetched 2026-09-21): _"Use the dropdown menu when you
have 5-15 items to choose from."_ ⛔ **This menu carries two or three items and therefore sits below that
threshold — I am departing from it deliberately.** Atlassian's threshold prices _list length_; the constraint
here is _column width under a 44/48 px target floor at 320 px_, which is a different reason, and the evidence
is the measured 93 px → 64 px row height. Atlassian's _"putting the most selected option at the top"_ is
adopted as the remedy-first rule above. **GitHub Primer — ActionMenu, guidelines**: documents _"the 3 dot
dialog indicator"_ as the component's anatomy, so the `⋮` affordance is standard rather than invented.
**W3C ARIA APG** supplies the whole keyboard and focus contract, quoted in the table above.
⛔ **Could NOT be loaded and are therefore NOT cited**: Material 3 _Menus_, Apple HIG _Buttons_, IBM Carbon
_Overflow menu_ (usage and accessibility), Shopify Polaris _ActionList_ (301 → API index). All four returned
SPA shells or truncated bodies. They are named here rather than described from memory.

## 4. Every state

| State                                                          | Key                                      | Behaviour                                                                                                                                |
| -------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Entry, empty                                                   | `ingredientNameEditableHint`             | Underline at rest. No list.                                                                                                              |
| Entry, typing                                                  | —                                        | Debounced. ⛔ No auto-select.                                                                                                            |
| Entry, searching                                               | existing `picker.searching`              | Skeleton **rows** — reserves height so results do not shove content.                                                                     |
| Entry, no matches                                              | `ingredientNoSuggestions`                | ⛔ Names the exit.                                                                                                                       |
| Entry, catalog unavailable                                     | existing `picker.catalogUnavailable`     | ⛔ `role="status"`. Local results still usable.                                                                                          |
| Entry, selected                                                | `statusResolvedConfirmation`             | Record mode; announced; focus per §2d.                                                                                                   |
| **Trailing row holds text at submit**                          | `ingredientPendingText`                  | ⛔ **Submit blocked**, message rendered, focus moved there (§4b).                                                                        |
| Panel, loading                                                 | `nutritionLoading`                       | Text in `role="status"`, not a spinner. Superseded by V1 sign-off item 9.                                                                |
| Panel, load failed / offline                                   | `nutritionLoadFailed`                    | ⛔ Distinct from "no figures published". Retry offered.                                                                                  |
| Panel, user-stated figures                                     | `nutritionUserStatedNote`                | ⛔ Must agree with the row's calories chip (§6b).                                                                                        |
| Panel, partial                                                 | `nutritionFieldUnpublished`              | Em dash per absent figure. ⛔ Never `0`.                                                                                                 |
| Panel, resolving                                               | `nutritionWorking`                       | No remedy.                                                                                                                               |
| Change food                                                    | `statusActionChangeFood`                 | Entry mode; ⛔ quantity/unit/prep/section preserved; the line still holds the **old** food until a pick.                                 |
| Authoring: open / in-flight / success / duplicate / validation | existing `AuthoredFoodCreateForm` states | Reused. Duplicate is a **success**.                                                                                                      |
| Authoring: failure / offline                                   | `statusAuthorFailed` / `…Offline`        | `role="alert"`. ⛔ Draft preserved; never pre-disabled.                                                                                  |
| Status advances while open                                     | —                                        | ⛔ The icon always renders, so nothing unmounts under the user; the body swaps and is announced. ⚠️ Focus must not jump to a new action. |
| Empty list                                                     | existing `noIngredients`                 | Plus the trailing row — ⛔ never actionless.                                                                                             |
| First-run                                                      | none                                     | ⛔ No coach mark.                                                                                                                        |

---

# EVALUATE

⛔ Nothing was seen rendered — the tree is under concurrent edit.

| #       | Severity                                                                                        | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W2**  | ⛔ **High — shipped 1.4.3 failure. INDEPENDENT defect, own ticket, NOT this feature's step 0.** | `warning` (`#F5B041`) as a **text foreground**: `ParseJobReview.tsx:30-35`, `.native.tsx:29-32`, `actions/RecipeVisibilityToggle.tsx:77` + `.native.tsx:92`, `collections/CollectionActions.tsx:152` + `.native.tsx:182`, `web/.../IngredientPicker.tsx:237`. ⚠️ **The tree already records the figure** — `AlertBanner.tsx:12`: _"`palette.warning` as copy is 1.88:1 on white"_ — so this is a known rule being violated in seven places, not a new computation. _(Correctly excluded: star fills; `AlertBanner`'s 4px accent, which is a FILL and correct under 1.4.11.)_ ⛔ Fix in the **tone maps**. |
| **H8**  | High                                                                                            | **"The name is wrong" was never designed as a flow** though it is the commonest thing a cook does. Closed by §2a.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **H9**  | High                                                                                            | **A long name is unreadable at a glance**: a read-only input never wraps, so it is clipped with no ellipsis and — on resolved rows — no caret to scroll with (`editable={false}`). 120 chars against ~30 of width. Closed by §3.                                                                                                                                                                                                                                                                                                                                                                          |
| **H10** | ⛔ **High — introduced by this design if §6a is skipped**                                       | **The panel would contradict the row.** On the edit path no macros reach the line, so a fully-resolved USDA food would report "no figures published"; and `userCalories` can make the chip and panel disagree. Closed by §6a/§6b — ⛔ which is why the predicate must be delegated, not duplicated.                                                                                                                                                                                                                                                                                                       |
| **H1**  | High                                                                                            | `UNRESOLVED` means _"awaiting a human disambiguation pick"_ and renders as the inert "Not resolved". Closed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **H2**  | High                                                                                            | `NOT_FOUND` and `FAILED` render as peers though they need opposite remedies. Closed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **H3**  | High                                                                                            | One generic note for every unresolved cause, whose remedy is wrong for most. Closed — ⛔ and its **text must be rewritten**, since it names a search this design deletes.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **H0**  | High — partly fixed in-flight                                                                   | A freeform row was **badged "Resolved"** (`wire.ts:169`). Narrowed; `isUserEntered` now carried by both producers — §SPECIFY.1 row 1 works **only** because of that.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **P1**  | High                                                                                            | **Warning tint diverges**: web tints `NEEDS_REVIEW \|\| FOOD_REMOVED` (`:248-249`), native only `NEEDS_REVIEW` (`.native.tsx:203`). Web's comment calls the inclusion _"an incoherence a UX audit caught"_ — it never crossed.                                                                                                                                                                                                                                                                                                                                                                            |
| **P6**  | Medium                                                                                          | **Name width diverges** — native gives it a full line, web lets it shrink to nothing. ⛔ Adopt native's (§3c). ⚠️ Mobile is ahead of web here.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **P5**  | High                                                                                            | **The parse-correction tier is read-only in practice** — no route, service method, contract export or client method; and `editLine` **cannot** be the writer (it holds only source text; the tier keys on corrected **facts**). Service lane.                                                                                                                                                                                                                                                                                                                                                             |
| **W1**  | Medium                                                                                          | **Reflow at 320 px unverified**, and ⛔ now **1.4.4 at 200% too** — the clamp and the three macro columns at +35% both want one render.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**Routing.** H8-H10, H0-H3 → closed here. ⛔ **W2, P1, P5, P6 are independent defects** with their own
owners. W1 needs a measurement I could not take.

---

# 9. Out of scope

⛔ **The parse surface.** `ParseJobReviewContainer.tsx:39-40` has two exits, **neither to a recipe**. Two
rulings survive as standing copy rules:

- ⛔ **Cross-surface copy must not blur.** "This ingredient now uses it" is true on a recipe row and false
  on a parse row (R19).
- ⛔ **Never promise recording or promotion.** P5 means the writer does not exist; promotion needs a
  _second, distinct_ cook (`corroboratedA`/`corroboratedB`) who may never arrive.

---

## Advocacy

**Situation A:** W2 — a known contrast rule violated in **seven** places, one of them on this feature's own
surface. Independent ticket.

**Situation B:** §6d — I recommend against the desktop hover trigger, with the compliant version specified
if it is wanted.

**Situation C, four times:** the flows were never designed; the panel's data source was asserted without
checking the edit path; the `16ch` floor was proposed against a recorded rejection **in the file I cited**;
and D5's "the retarget seam is deleted" was true of the UI and false of the controller.

**Escalated rather than decided:** ⛔ `AMBIGUOUS`'s sibling-binding behaviour (§SPECIFY.1 note 1) and ⛔ the
hoisted-resolver contract (§8a) are `staff-architect` calls.

**Owner decision flagged:** §2c places "Change food" in a popover, adjacent to the ruling that _create
custom food_ must not be. Marked revocable (D6).

**Deceptive-pattern check:** nothing refused. ⛔ The authoring exit is never gated behind N failed searches.

## Evidence: verified · assumed · judgement

**Verified this revision:** `toRecipeFormValues` maps **no macros** · `refreshStatus` returns an
`Ingredient` with per-100 g nutrition (`ingredients.controller.ts:29`) · `lineCalories` prefers
`userCalories` (`nutrition.ts:79`) · the native comment **rejecting a floor** (`.native.ts:76-86`) ·
`RecipeForm.tsx:56` adds `px-4` → 240 px · `AlertBanner.tsx:12` already records 1.88:1 ·
`IngredientPortion` is `{ unit, gramsPerUnit }`, unit English-normalized (`recipe.types.ts:820-825`) ·
`AMBIGUOUS ≠ UNRESOLVED` (`:452-459`) · `useIngredientResolver`'s single debounce/query/session-ref
(`:238-254`) · `maestroFlowSelection.test.ts:423` asserts the picker exists on disk.

**Assumed:** that the row reflows at 320 px and survives 200% (W1) · that `AuthoredFoodCreateForm` hosts in
a popover and a bottom sheet unchanged · that `back-intercept` / `screen-reader-focus` have the shapes their
names imply.

**Judgement:** the flow ranking · trading uniform row height for a readable name · top-aligning the icon ·
the 2-line clamp and rejecting middle-truncation · the trailing add row and **blocking submit** over
resolve-on-blur · "Change food" in the panel · the freeform info-glyph call · dropping the `RESOLVED` chip ·
no chart · all copy.

**Informed prior:** progressive disclosure reduces glance cost (Hick; `human-factors.md:44`). Proximity
binds a control to its subject (Gestalt). Falsifiers: cooks needing several panels open at once; a render
showing the icon reading as part of the name.

## References consulted

**Corpus:** `accessibility.md` · `cross-platform-translation.md` · `device-ergonomics.md` ·
`human-factors.md` · the index's target-size table and deceptive-design rules.
**Live (2026-09-20):** W3C _Understanding SC 1.4.13_ · ARIA APG _Disclosure_. ⚠️ The APG **Combobox**
keyboard table is cited by name and **must be re-read at build time** — I did not fetch it.
**In-repo:** `offlineWriteAcceptance.md` · `offlineNotice.md` §R1.
**Prior art:** Cronometer · MyFitnessPal.

---

## Build order

⛔ Nothing below was edited by me. Mobile files are under another agent's scope — coordinate.

| #     | Path                                                                               | Change                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | ⛔ `staff-architect`, before step 1                                                | **§8a** the hoisted-resolver contract · **§8b** where the four orphaned surfaces go · **§SPECIFY.1 note 1** whether `AMBIGUOUS`'s sibling-binding is retired. All three determine the combobox's props contract.                                                                                                                                                                                                            |
| 1     | `ui/src/combobox/{props,Combobox.tsx,Combobox.native.tsx,index}.ts` + `__tests__/` | ⛔ APG combobox — F1's core. Tests first, full keyboard model incl. Home/End and `aria-autocomplete`.                                                                                                                                                                                                                                                                                                                       |
| 2     | `ui/src/popover/{…}` + `__tests__/`                                                | Radix web; bottom sheet native; one contract. ⚠️ Docstring says why `MoreActionsMenu` is not reused.                                                                                                                                                                                                                                                                                                                        |
| 3     | `ui/package.json`                                                                  | Two exports + `@radix-ui/react-popover`.                                                                                                                                                                                                                                                                                                                                                                                    |
| 4     | `features/recipes/src/form/messages.ts`                                            | §SPECIFY.2 keys; ⛔ **rewrite `ingredientNoFoodNote`**.                                                                                                                                                                                                                                                                                                                                                                     |
| 5     | `features/recipes/src/form/nutritionPanel.ts` (new)                                | ⛔ **Delegates its has-nutrition predicate to `nutrition.ts`** (§6b). Exhaustive over the status union.                                                                                                                                                                                                                                                                                                                     |
| 6     | `features/recipes/src/form/props.ts`                                               | Row-state selector; ⛔ **`updateIngredientAt` narrowed** + `rebindIngredientAt` added, **same commit** (§4a).                                                                                                                                                                                                                                                                                                               |
| 7     | `formSectionStyles.native.ts` **and** the leaf's inline row classes                | ⛔ Borderless resting variants; full-width name line; 2-line clamp; ⛔ **`align-items: flex-start`**. ⚠️ **No `min-width` floor** (§3c). ⚠️ Web's row container class is **inline in the leaf**, not in `formSectionStyles.ts` — that module holds only chrome shared by more than one field group.                                                                                                                         |
| 8     | `features/recipes/src/form/icons.tsx`                                              | Info, alert, add-food — ⛔ distinct by **shape**.                                                                                                                                                                                                                                                                                                                                                                           |
| 9     | `features/recipes/src/hooks/`                                                      | The hoisted resolver + combobox controller (⛔ cannot live in `@commise/ui`).                                                                                                                                                                                                                                                                                                                                               |
| 10    | `RecipeIngredientsFields.tsx` **and** `.native.tsx`                                | ⛔ Same commit. Combobox/text modes; icon slot; trailing add row; `hasPendingText`; **P1 + P6 fixed**. ⛔ The leaf **becomes an orchestration component** — add its `@pattern` tag.                                                                                                                                                                                                                                         |
| 11    | Both `IngredientPicker.tsx` leaves + **three** hosts                               | ⛔ Removal — ~1,600 lines, 10 test files, 2 Playwright specs, 4 Maestro flows. ⛔ **Every deleted test says where its coverage went.** Gated on step A's re-homing decisions.                                                                                                                                                                                                                                               |
| 12    | `patternRegister.test.ts` + `maestroFlowSelection.test.ts`                         | ⛔ **Enforced guards — four register entries and a disk assertion go stale at once.** New combobox needs a `@pattern` tag and a `REF_SITES` entry.                                                                                                                                                                                                                                                                          |
| 13    | Tests                                                                              | Every §SPECIFY.1 row × entry/record, both platforms, ⛔ including negatives (`RESOLVED_UNAVAILABLE` offers nothing; `FAILED` no authoring; freeform no create button) · the **2-line clamp at 120 chars and at 200% zoom** · §2d's four focus targets · §4b's blocked submit · §6b's chip-vs-panel agreement · full combobox keyboard model · Playwright F1 end-to-end · Maestro the same. Per §7.1, **before** steps 5-11. |

⛔ **No contract change** — suggestions, resolution, the per-ingredient nutrition read and authoring all use
existing routes. ⚠️ But ⛔ **not "no fetch"**: §6a's panel fetches.

## Questions blocking this

1. ⛔ **Step A's three architecture decisions** — genuinely blocking, and not mine.
2. **§6d — hover on the desktop icon?** I recommend click/tap only. Confirmation, not a precondition.
3. **W1** — 320 px reflow and 200% resize. I could not render.

## Hand-off

- **`staff-architect`** → step A, before anything is built.
- **Implementation** → `fe-1`, ⛔ floor **WCAG 2.2 AA**. Step 1's combobox needs the APG table open, not
  recalled.
- **W2, P1, P6** → independent shipped defects, own tickets.
- **P5** → recipe-service / parse-pipeline lane.
- **Carry forward:** a cook mid-entry, one hand, phone, interruptible. The name field **is** the picker; one
  icon slot; record mode wraps to 2 lines with a top-aligned icon.

**Confidence: High** on everything anchored to a file, line or quoted comment. **Medium** on layout — read
but not rendered; the clamp, the top-aligned column and 200% zoom all want one look.

---

# V1 sign-off (2026-10-01)

**By `staff-ux-engineer`, EVALUATE plus decisions, on plan 002 V1 as `fe-1` built it.** I wrote this spec. I did not
write the code. I read the two row leaves, the row policy, the panel modules, the lookup, the messages, `lineKey.ts`,
`hooks/lineCommit.ts` and `ui/src/popover/`. I also read the three Playwright specs and the three Maestro flows. Native is read in code only. The web render record is at the end of this section.

These rulings bind the build. Where one changes a row above, that row now points here.

## The thirteen items

| #   | Item                                                   | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `About {food}` names the glyph                         | **Accept.** It names the row, so a list of glyphs is not a list of identical buttons. The name stays neutral on purpose. The state lives in the status word beside it. **Owed (web):** a keyboard user who tabs to the glyph skips that word, because static text is not a stop. The `Popover` trigger takes an optional description id. The row passes the status word's wrapper id (the same wrapper pattern as the no-food note). Native needs nothing in V1. The word comes before the glyph in reading order, as `namelessLineCopy.md` §2c already accepts.                                                                                                                                                         |
| 2   | `Close details for {food}`, `Close actions for {food}` | **Accept both.** They follow the house form `Close {thing}` (`@commise/ui/sheet`). `ingredientStatusPanelCloseLabel` is signed off. Its docblock note "owed a sign-off" comes out. `ingredientActionsMenuCloseLabel` = `Close actions for {food}` lands with the ⋮ menu in B7.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 3   | Try again hands focus to the row's glyph               | **Accept the target. Three things are owed with it.** (a) The glyph keeps its gate on `body !== undefined`. Without a body, its panel points at a missing control. But a retry that settles on a state with no body unmounts the control that holds focus. In that case focus moves to the row's Remove. B7 fills every body, and then the case cannot occur. (b) A busy glyph is busy to the eye, not only to assistive tech. Today `busy` sets `aria-busy` and nothing else. The trigger swaps its glyph for the `Button` spinner in the same 44 px (web) or 48 dp (native) box, and stays focusable. (c) When the retry settles, a polite message gives the outcome. Focus does not move. Copy is in the table below. |
| 4   | Try again moves out of the ⋮ menu, into the panel only | **Accept.** The failing test is the right evidence. A menu item whose own row changes state under it leaves focus nowhere. **Owed:** the policy still lists `['tryAgain', 'remove']` for `FAILED`, which makes slot 2 a menu. When B7 mounts the menu, Try again comes back inside it. Change `FAILED` to `['remove']`, so slot 2 is Remove, direct. Take `tryAgain` out of `IngredientRowAction`, because it is now a panel action and not a row action. §3a row 10 is amended to match.                                                                                                                                                                                                                                |
| 5   | Two different controls both named `Try again`          | **Change, small.** The running total's Try again and the nutrition panel's Try again both call `nutrition.retry`. They do the same thing, so one name is right (SC 3.2.4). The `FAILED` panel's Try again does a different thing: it asks food about one line again. It keeps the visible word and gets its own accessible name through `Button`'s `accessibilityLabel`, with the visible words first (SC 2.5.3).                                                                                                                                                                                                                                                                                                        |
| 6   | Disabled and saving states                             | **Designed below**, in "Busy and disabled".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 7   | A food id that is an empty string (F5)                 | **Accept how it reads.** An empty id is "no food chosen", the same as `null`. It is row 2: the caution no-food note, no status word, and Remove. In V1 it has no glyph, because the row 2 body lands in B7. **Owed.** This is a truth defect, not a copy defect. The row says the line will not be saved. But `isStoredLine` (`lineKey.ts:105`) sends a line whose id is `''`. Use one predicate. `isStoredLine` delegates to `isResolvedIngredientId`. This touches the save path, so `staff-architect` signs it off first.                                                                                                                                                                                             |
| 8   | Two wordings for "no nutrition you can see"            | **Accept both. They state different facts.** The lookup's `absent` says food answered with nothing this cook is allowed to read, and the reason is unknown. That gets the owner's neutral sentence, `nutritionNoneAvailable`. The private-food sentence names a cause. It shows only where the line's status says `RESOLVED_UNAVAILABLE`. Never show the private sentence for `absent`, because that claims a cause nobody checked.                                                                                                                                                                                                                                                                                      |
| 9   | Loading shows text, not skeleton rows                  | **Accept. I was wrong for this case.** I wrote "skeleton rows" for §6a's fetch on open. The blueprint's Decision 3 starts the read as the form opens. So the panel's loading state is a short edge. A cook sees it only in the first moment after the form opens. Text inside `role="status"` is honest and is announced. SPECIFY.4's row is amended. The combobox's search list keeps skeleton rows.                                                                                                                                                                                                                                                                                                                    |
| 10  | "Common measures" not built                            | **Later, not a V1 gap.** The data is already on the read (`nutritionLookup.ts:76`, `portions`). What is missing is a localised unit-name map (§6c). On 2026-10-01 I found none in `features/recipes/src`, in `@commise/i18n`, or in `recipe-core/src/units.ts`, which holds aliases and normalisation only. Built without that map, a German panel shows `tablespoon = 15 g`. V1's job is the per-100 g figures. Measures ship as their own unit, with the map.                                                                                                                                                                                                                                                          |
| 11  | Where focus goes after Remove                          | **Not built. Owed.** Today a keyboard Remove drops focus to the page (SC 2.4.3). `ingredientRemove.spec.ts:58` focuses Remove and checks nothing about focus after. **Target, in order:** the next row's glyph. If that row has no glyph, its Remove. If the removed row was last, the trailing control: Add ingredient until B6, then the trailing combobox. If the list is now empty, Add ingredient. **Owed tests:** a focus assertion in the Playwright spec and in the component tests on both platforms. Native moves screen-reader focus through `@commise/ui/screenReaderFocus`. On web, moving DOM focus needs a ref, so it needs a `REF_SITES` entry.                                                          |
| 12  | The US5 Maestro flow accepts three panel states        | **Too loose. Change.** It accepts the failed copy. So if the read is broken, the flow still passes. That is a test that cannot fail for the defect it exists to catch. Remove the failed alternative. If the seeded `Flour` has figures on the target, pin `Per 100 g`. If the target cannot promise figures, accept `Per 100 g` or `No nutritional data available` only, and the comment says why. The web spec and the component tests keep each state pinned.                                                                                                                                                                                                                                                         |
| 13  | `nutritionNoneUnavailable` keeps the SPECIFY.2 text    | **Accept.** `namelessLineCopy.md` §6c's rewrite tells the cook to use Change food. Change food is not on row 11 yet, and §6b waits for the owner. A sentence that points at a missing control is worse than one that is complete and true. If the owner approves §6b, swap the text in the same change that mounts Change food on row 11.                                                                                                                                                                                                                                                                                                                                                                                |

**The order conflict fe-1 found: agreed.** The trailing add row is a combobox, so it needs B6 first. Until B6 lands,
every target this spec gives as "the trailing combobox" is Add ingredient. §2d is amended to say so.

## Busy and disabled (item 6), both platforms

**Rule 1. No row control is `disabled` in V1.** A row offers only the actions its state allows (the row policy). An
action that does not apply is absent, never greyed out. A greyed control tells a cook something is possible and then
refuses it.

**Rule 2. Work in flight marks the control that was pressed, and only that control.**

| Work in flight                                            | The pressed control                                                                                                                                 | Its panel                                                                                                     | Other row controls                                                                                                                                                                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lookup retry (`FAILED` → asking)                          | The glyph shows the spinner in its own box. Web: `aria-busy`. Native: `accessibilityState={{ busy: true }}`. It stays focusable and keeps its name. | It still opens. It shows `statusLookupRetrying` and no Try again, so a second press cannot send a second ask. | Unchanged.                                                                                                                                                                                                                    |
| Nutrition read (form-wide)                                | No control. The total and an open panel show `nutritionLoading` in `role="status"` (item 9).                                                        | Text, as item 9.                                                                                              | Unchanged.                                                                                                                                                                                                                    |
| A B7 commit on this row (Change food, Create my own food) | The control that started it is busy (`busyControlProps`, `namelessLineCopy.md` §6d).                                                                | n/a                                                                                                           | This row's other actions carry `aria-disabled="true"` and do nothing on press. Never `disabled`, because a focused control that turns `disabled` throws focus to the page. Native: `accessibilityState={{ disabled: true }}`. |
| Saving the recipe (submit, publish, autosave)             | Only the Save control, as today (`RecipeForm.tsx:75`).                                                                                              | n/a                                                                                                           | Unchanged. ⛔ Autosave never locks a row.                                                                                                                                                                                     |

**Rule 3. A failure keeps the draft and says what happened.** SPECIFY.4 already says this for authoring. Web uses
`role="alert"`. Native uses `@commise/ui/liveRegion`. Its native leaf speaks on Android through a live region. On iOS it
makes an announcement, so VoiceOver users hear it too. A failed retry settles as `FAILED` again, and item 3's message
announces it.

## Copy owed, for `fe-1` (`RecipeFormMessages`, `en`)

| Key                               | Status                          | `en`                                           | Where                                                                                                                                          |
| --------------------------------- | ------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `statusActionRetryLookupLabel`    | **New**                         | `Try again for {food}`                         | The accessible name of the `FAILED` panel's Try again. Its visible text stays `statusActionRetry`. `{food}` as the glyph's.                    |
| `statusLookupRetrying`            | **New**                         | `Looking this up again…`                       | The `FAILED` panel's body while its retry runs.                                                                                                |
| `statusResolvedConfirmation`      | **Designed, text changed here** | `{food} is matched. Its nutrition now counts.` | After a retry, a polite message for a `RESOLVED` outcome. SPECIFY.2's row points here.                                                         |
| `statusLookupSettled`             | **New**                         | `{food}: {status}`                             | After a retry, a polite message for any other outcome. `{status}` is the row's status word (`resolutionStatusWordKey`), `Not loaded` included. |
| `ingredientActionsMenuCloseLabel` | **New, lands with B7**          | `Close actions for {food}`                     | The ⋮ menu's close control (native sheet).                                                                                                     |

No other string changes. `ingredientStatusPanelTriggerLabel`, `ingredientStatusPanelCloseLabel`, `statusActionRetry`,
`nutritionNoneAvailable`, `nutritionLoading` and `nutritionNoneUnavailable` stand as built.

## Code changes owed

1. `ingredientRowPolicy.ts`: `FAILED` → `['remove']`. Take `tryAgain` out of `IngredientRowAction`. Update its tests (item 4).
2. Both row leaves: when a retry settles on a state with no panel body, focus moves to the row's Remove (item 3a).
3. `@commise/ui/popover`, both leaves: a visible busy state (the `Button` spinner, in place). On web, an optional description id on the trigger (items 1 and 3b).
4. Both row leaves: after a retry the cook started, a polite message with the two keys above. Use the design system's `liveRegion` (item 3c).
5. Both row leaves: the `FAILED` panel's Try again gets `accessibilityLabel` from `statusActionRetryLookupLabel`, and while busy the panel shows `statusLookupRetrying` instead (items 5 and 6).
6. Both row leaves: focus after Remove, with the target order in item 11, plus the Playwright, component-test and Maestro assertions. A `REF_SITES` entry on web.
7. `lineKey.ts`: `isStoredLine` uses `isResolvedIngredientId`, after `staff-architect` signs it off (item 7).
8. `ingredientNutritionPanel.yaml`: drop the failed alternative (item 12).
9. `messages.ts`: the keys above, and remove "owed a sign-off" from `ingredientStatusPanelCloseLabel`'s docblock.
10. `formSectionStyles.ts`: W-1 below. A width-free base string for the six sized fields (five in the ingredient row, one in the instructions). `field` stays as it is.

## Web measurements

**Method.** I rendered the real `RecipeIngredientsFields` (web) to static HTML on the server. The CSS was compiled from
the web app's own `globals.css` with Tailwind v4. Chromium, through Playwright, then measured it at four widths: 320, 390, 768
and 1280 px. Each width ran at 100% and at 200% text. The 200% case sets the root font size, so every `rem` scales. Six rows: a 63-character catalog name
(`RESOLVED`), `FAILED`, `NEEDS_REVIEW`, `FOOD_UNREACHABLE`, an empty-string id, and a declared line. ⚠️ Limits: the
page around the section is mine (16 px side padding), not the wizard's. Closed panels only, because a static render
cannot open a Radix popover. The panel's width is from its classes: `min(20rem, 100vw - 1rem)` is 304 px at 320.
The screenshots are in the session scratchpad and are not committed.

| Check                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No sideways page scroll (SC 1.4.10)    | ✅ 0 px in 7 of 8 renders. ⚠️ At 320 px and 200% text, the **Add ingredient** button runs 8 px past the edge in my page. The row itself never does. The wizard's real padding can move this figure. B6 replaces this control with the trailing combobox, so check it again then.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Targets (SC 2.5.8, spec 44 px web)     | ✅ The glyph is 44 × 44 at 100% text and 88 × 88 at 200%. Remove is 50 × 44 below `sm` (icon only) and 231 × 43 from `sm` up. The 43 px is the `Button` primitive's own rule (`md:pointer-fine:min-h-0`): it drops the touch minimum for a fine pointer at `md` and up. It passes the SC's 24 px floor. Not a finding.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Long name (H9)                         | ⚠️ At 320 and 390 px, the read-only input is 240 and 310 px wide. The 63-character name is clipped inside it, with no ellipsis and no wrap. Known, and B6's record mode closes it (§3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **W-1. Every row field is full width** | ⛔ **High, shipped, not new in V1** (it is in `HEAD`). `field` (`formSectionStyles.ts:9-10`) carries `w-full`, and the row adds `w-24`, `w-28`, `w-40` or `w-48` after it. Tailwind emits `.w-full` after those rules, so `w-full` wins on every field at every width. Each row is a stack of seven full-width lines: **376 px tall at 1280 px**, and the six-row list is 2,315 px. §3a's scroll budget (64 px rows) is far from what ships. This is the same class of defect as the invisible difficulty chip: class order does not decide, CSS order does. It is a class, not one site: `RecipeInstructionsFields.tsx:67` (`${field} w-28`, the step timer) has the same conflict. `field` has 23 uses in 3 files, and most of them want full width. **Owed, the small version:** add a width-free base string beside `field`, and build the six sized fields from it. `field` itself does not change, so the full-width fields do not move. The name keeps a full line below `sm`, as native already does (P6). Native has no such conflict: each field has its own style. |
| Status word and note at 320 px         | ✅ They wrap at spaces inside `StatusBadge` and stay inside the row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

---

# Decision log

### D6 — "Change food" placed **in** the nutrition panel (rev 5) — ⛔ REVOKED 2026-09-20

⛔ **The owner read the popover ruling broadly, which is the condition this decision named for its own
reversal. "Change food" moves OUT of the nutrition panel and into the row's icon column**, beside
_create custom food_ and the info/error glyphs. One place for every action on a row.

⚠️ **The state table above still shows the panel placement in its `Icon glyph → panel` column** (rows 3,
4, 8, 9 and 12, each reading `→ … Change food`). Read those cells as _the panel EXPLAINS the state; the
icon column CARRIES the action_. The table is not re-cut here because the routing is unchanged — only
where the control sits — and re-cutting it would churn twelve rows to move one word.

**What survives from the original reasoning, unchanged and still load-bearing:** `RESOLVED` **is** the
wrong-match state, and without this exit a cook's only escape is Remove, which loses quantity, unit,
preparation and section. The exit itself was never the revocable part.

⚠️ **The cost this decision was avoiding is now paid:** the icon column carries a second slot. That was
the stated reason for the panel placement, and it is accepted rather than dissolved — see
`docs/plans/2026-09-20-002-…-plan.md` R26, which is the authority for the placement from here.

### D5 — Separate picker → **the name field IS the picker** (owner, rev 4) — ⚠️ corrected in rev 5

⛔ Deleted: the visible separate picker, the entry point, and the scroll-away hazard.
⚠️ **D5 originally claimed the retarget seam was deleted. That was true of the UI seam and FALSE of the
controller seam** — `useIngredientResolver` is single-instance, so one hoisted controller keyed by row
identity is required, which is that seam renamed (§8a). **Survives:** `rebindIngredientAt`.

### D4 — Status chip as disclosure trigger → **information icon + popover** (owner, rev 3)

⛔ Also retracted: the `No nutrition` badge wording.

### D3 — Session marker + `authoredFoodIds` contract change → **retracted**

`ingredients.food_id` is already the nullable FK. The surviving reasoning: _a persisted marker on the line
would assert something about the line that is not true of it_ — which is why the **FK** is the right home.

### D2 — Branch B on the parse surface → **out of scope**, not deferred

Two exits, neither to a recipe.

### D1 — "Authoring belongs on the form row only" → **overturned; my reason was also wrong**

I argued it would be inert; the actual blocker was that the route does not exist.

### Reference — WCAG 2.2 SC 1.4.13, verbatim

Level AA; applies _"where receiving and then removing pointer hover or keyboard focus triggers additional
content to become visible and then hidden"_: **Dismissible** — _"A mechanism is available to dismiss the
additional content without moving pointer hover or keyboard focus, unless the additional content
communicates an input error or does not obscure or replace other content"_ · **Hoverable** — _"If pointer
hover can trigger the additional content, then the pointer can be moved over the additional content without
the additional content disappearing"_ · **Persistent** — _"The additional content remains visible until the
hover or focus trigger is removed, the user dismisses it, or its information is no longer valid"_.
⛔ Activation-triggered content does not meet the trigger condition, so the criterion does not apply.
