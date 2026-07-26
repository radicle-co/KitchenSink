---
type: fix
status: proposed
date: 2026-07-26
title: 'Mobile UI/UX remediation — RN app + mobile web (brand-forward on hero surfaces; no unflagged desktop regression)'
origin: expert audit (this session) of packages/apps/commise/mobile + packages/apps/commise/web at phone viewports, against docs/mockups/screens/* and the @commise/ui design system; hardened by a 6-persona ce-doc-review (coherence, feasibility, design-lens, scope-guardian, product-lens, adversarial) with 4 owner rulings folded in
---

# Mobile UI/UX remediation — React Native app + mobile web

> Two read-only expert audits (RN app + mobile-web/responsive) produced the findings; a 6-persona doc-review
> then corrected four load-bearing errors, and a **round-2 adversarial pass** (code-verified) corrected eight
> more — including a stale auth baseline and a wrong token-module-graph (see **Review corrections** below).
> **Governing constraint (owner):** every change improves the **mobile** surface. Desktop/tablet output is
> left intact UNLESS the same improvement clearly applies there — in which case it is **called out per-unit
> and enumerated in the desktop-impact table**, never applied silently.
>
> **Stack baseline (verified against `packages/apps/commise/mobile/package.json`):** Expo **~57.0.0**, React
> Native **0.86.0**, React **19.2** — **new architecture by default** (Expo SDK ≥54). NOT the "Expo 53 / RN
> 0.79" the repo's CLAUDE.md still records (that doc is stale and should be corrected separately). This governs
> the new-dependency choices: FlashList **v2** (auto-measured — no `estimatedItemSize`), and
> `expo-blur`/`expo-linear-gradient`/`react-native-reanimated` pinned to their `expo install`-resolved SDK-57
> versions.

## Owner rulings (this session) — these govern the plan
1. **Visual ambition = full brand language on hero surfaces.** Build the mockups' actual look — gradient
   backgrounds, frosted-glass cards, gradient CTAs, press/hover motion — on the surfaces that carry the brand
   (home, recipes list, recipe detail, discovery, **auth entry**); flatter/clean elsewhere. This is **U8**, and
   it is what makes "looks like garbage" actually go away (hygiene alone would not — see design-lens).
2. **Delivery order = lead with create + browse.** After the U0/U1/U8-token enablers, the **[HIGH] slices of
   creation (U6) and discovery (U7) ship first**, then the auth cluster (U2/U3), then polish (U4/U5). The core
   loop users live in improves first.
3. **Desktop `/account`, `/settings`, `/profile` get the nav shell too.** Wrapping the bare routes in
   `AppShell` for mobile also renders them with nav on desktop — that is a **deliberate, approved desktop
   change** (those routes are nav-less today, itself a defect), not "additive." Verified and enumerated.
4. **Curated discovery rails + per-photo cover-selection stay in-scope.** They are net-new (no wireframe
   source), so their interaction is **designed fresh in this plan**, not deferred.

## Review corrections — errors the 6-persona review caught in the first draft (all code-verified)
- **WCAG mis-citation → Button scope fixed.** SC 2.5.5 Target Size (Enhanced) 44px is **Level AAA**, not AA;
  the AA bar is **2.5.8 Target Size (Minimum) = 24px**, and the shared web `Button` (~36–40px, `px-5 py-2.5`,
  no min-height) already clears it. So nothing forces a desktop density change. The 44pt bump is now
  **native + mobile-web base only, with a `md:` reset** — desktop Button height is **unchanged** (was: an
  unjustified desktop change).
- **Token module was a THIRD copy → single-source fixed (module-graph corrected in round 2).** `tamagui.config.ts`
  already declares identical numeric `space`/`radius` tokens; a standalone `native.ts` would be a third
  hand-typed scale. U0 now derives all representations from one shared numeric array — but see **round-2 R2**:
  `tamagui.config.ts` lives in the **mobile app**, not `@commise/ui`, so the drift guard is split across two
  packages and emission must be unit-aware (not a uniform ÷16).
- **"Debounce in the shared model" wasn't buildable → per-container fix (seam corrected in round 2).** There is
  no shared discovery model and a `useDebouncedValue` hook **already exists**. U7 reuses it **per container** —
  but see **round-2 R4**: web discovery is URL-controlled via a round-trip-free `replaceState`, so the fix is an
  immediate local echo + a debounced value feeding the query, NOT "debounce the URL push."
- **U6 ingredient fix — corrected by the owner (round 3): the pipeline is rich; the bug is narrow.** The prior
  "picker-only vs custom-ingredient" framing was wrong. Commise runs a full ingredient-resolution pipeline
  (REQ-057 / data-model R5 / FR-007): a debounced typeahead over the shared catalog
  (`GET /v1/ingredients/search`), **async USDA admission** by name (`POST /v1/ingredients/by-name` → food-service
  → USDA, rate-limited), disambiguation candidates (`/{id}/candidates` → `/resolve`), terminal-state handling,
  AND first-class **freeform** create (`POST /v1/ingredients`, synchronous `201`). Picking sets `ingredientId`
  **and** name together (`toIngredientLine`). **The actual bug** is only that the recipe FORM row keeps the
  resolved line's **name as an editable free-text input**, letting the displayed name drift from its
  `ingredientId`/nutrition. **Fix = render a resolved line's name read-only** (identity changes only by
  re-picking; qty/unit stay editable). Separately, the owner wants the typeahead to autocomplete from **our DB
  AND USDA** — a real enhancement (**local-first, USDA on-demand**) that needs a new read-only rate-limited
  USDA-search path; that is **its own cross-service CR** (see Scope Boundaries), and U6 here styles the picker +
  wires the "Search USDA" affordance when it lands.

## Review corrections — ROUND 2 (adversarial, code-verified against the live tree)
- **R1 (CRITICAL) — auth cluster re-baselined.** `AccountDeleteForm` **no longer exists**: CR-002 U4b (shipped
  this session, commit `486feda5`) replaced it with `AccountCloseForm` + `AccountEraseForm`, both built on the
  shared `ConfirmDialog` (`@commise/ui/confirm-dialog`) and localized via `@commise/features-account/danger`.
  So RC-1's "broken raw Radix delete modal" and the U1/U3 "adopt ConfirmDialog to fix it" prescriptions are
  **already done** — dropped. Still valid and current: `/account`,`/settings`,`/profile` render a bare
  `<main><h1>` with no classes/nav (`account/page.tsx:29-41`); `AccountEditForm.tsx:29,40` still hardcodes
  English. U3 re-scoped accordingly.
- **R2 (CRITICAL) — U0 module graph.** `tamagui.config.ts` is in `packages/apps/commise/mobile/` (depends on
  `@commise/ui` one-way). A drift test in `@commise/ui` **cannot import** it, so the tamagui leg is guarded from
  the **mobile** package. Web tokens are **unit-heterogeneous** (`space[0]` unitless `0`, `radius.full` `'9999px'`,
  the rest `rem`) → emission must be **unit-aware**, not a uniform ÷16. Tamagui radius is **numeric-keyed 0–5**
  (+ a synthesized `0`/`true`/`size` set) vs the named web scale → an explicit name↔index map. Typography lives
  in **two `createFont` calls** (positional, non-monotonic keys), **outside `createTokens`** → the Playfair
  ramp U8 needs is single-sourced + guarded from the mobile package, or explicitly out of scope. U0 rewritten.
- **R3 (WARNING → superseded by the owner's round-3 correction).** The round-2 read of "freeform not
  persistable / escape hatch = schema change" was itself incomplete — freeform ingredients ARE persistable via
  `POST /v1/ingredients`, and USDA sync is a live pipeline. See the owner-corrected U6 bullet above: the fix is
  read-only resolved-name; the USDA-blended autocomplete is a separate CR.
- **R4 (WARNING) — U7 web debounce seam.** (see the corrected U7 bullet above.)
- **R5 (WARNING) — dependency baseline.** Corrected to Expo 57 / RN 0.86 (Stack baseline, above); FlashList v2
  (drop `estimatedItemSize`); pin blur/gradient/reanimated to SDK-57.
- **R6 (WARNING) — desktop-impact table completeness.** U1 adds a `PressScale` + a real `busy` spinner to the
  shared `Button`, changing every desktop button's behavior — now **enumerated** in the table (was: only height
  called out).
- **R7/R8 (INFO) — brand-absence over-stated on web.** The shared web `Button` primary is **already**
  `bg-gradient-to-br from-seafoam to-ocean-dark` (`Button.tsx:28`) — the gradient-CTA gap is **native-only**; U8
  threads the existing DS gradient rather than adding a parallel one. And no `ActivityIndicator` lives inside
  `Button` today (`busy` only disables) — bare indicators live in the login/signup consumer screens.

---

## Diagnosis — three tiers of work, not "one broken app" (and not "just styling")

The two surfaces share the **same split**, but the remediation is honestly **three different sizes of work** —
sizing them as one ("targeted, not a rewrite") under-budgets review/QA. The tiers:

- **Tier 1 — Targeted styling on the recipe/home chrome.** The feature-001 recipe/home surface is
  mobile-first at the infrastructure level (real bottom-nav cutover, grids that collapse to one column,
  `expo-image`, an exemplary safe-area FAB, full-width typed form fields, strong a11y semantics, real Home
  skeletons, a clean statechart/discard-guard editor). It needs **token migration, virtualized lists, target
  sizes, and contrast** — genuinely targeted (U4/U5).
- **Tier 2 — Restyle + re-chrome the auth/identity cluster.** `login`/`signup`/`account`/`profile`/`settings`
  are an older, unstyled, non-localized **second codebase** — raw controls, hardcoded hex/English, no nav chrome
  on web. This is a **rebuild** of ~4 RN screens (U2) + a **restyle-and-AppShell** of the web routes (U3). Note
  (round-2 R1): the web **delete surface is already done** — CR-002 U4b shipped `AccountCloseForm` +
  `AccountEraseForm` on the shared `ConfirmDialog`, localized; so Tier-2 web work is the *edit/profile/settings*
  styling + AppShell + residual `AccountEditForm` localization, NOT a delete-modal rebuild.
- **Tier 3 — Flow overhauls with net-new surface + the brand uplift.** Creation and discovery carry
  **flow-level design debt** beyond styling — an ingredient model that can silently desync the resolved food
  from its nutrition (a data-integrity trap), an unstyled `IngredientPicker`, a per-keystroke network search, a
  blank mobile loading screen, no browsable default — plus **net-new** surface the owner elected to build
  (curated discovery rails, per-photo cover selection) and the **brand visual language** (U6/U7/U8). This is
  new interaction + visual design, the largest tier.

**True bug-fixes vs. new-feature work are tagged per-item** ([HIGH]/[MED]/[LOW] + `bug` vs `feature`) so each
is sized and gated independently — the flagship data-integrity fix is not the same risk class as a curated
rail.

### Root causes (the handful that explain most of it)

- **RC-1 — The identity/auth surface is unstyled + not localized, on BOTH platforms.**
  - RN app: `login.tsx`/`signup.tsx` use raw Tamagui `Button`/`Input` with hardcoded hex; `AccountSettings.tsx`/
    `profile.tsx` use the **raw React Native `<Button>`** (the gray OS button) + `#c00`/`#ccc`/`#555`; all
    four hardcode English strings.
  - Mobile web: `settings/`, `account/`, `profile/` pages render a **class-less bare `<main><h1>`**
    (`account/page.tsx:29-41`) — not wrapped in `AppShell` (no nav, no padding, no max-width, default-styled
    controls); `AccountEditForm.tsx:29,40` still hardcodes English (`'Not authenticated'`, `'Update failed'`).
    _(The former broken `AccountDeleteForm` modal is **gone** — CR-002 U4b replaced it with `AccountCloseForm` +
    `AccountEraseForm` on the shared `ConfirmDialog`, already styled + localized; round-2 R1.)_
- **RC-2 — No native-consumable design-token scale, AND the numeric scale is already duplicated (in the mobile
  app).** `@commise/ui`'s `space`/`radius`/`fontSizes`/`shadows` are **web-only `rem`/px strings** — unusable in
  a RN `StyleSheet` (needs numbers). Meanwhile **`packages/apps/commise/mobile/tamagui.config.ts`** (NOT
  `@commise/ui`) **already hand-declares** a numeric `space`/`radius` scale via `createTokens`
  (`space:{1:4,2:8,…,true:16}`, `radius:{0:0,1:6,…}`) plus **two `createFont` type ramps** (`bodyFont`,
  `displayFont`, positional 1–9 keys) — reachable via `getToken()`/`getTokenValue()`, but almost no screen uses
  Tamagui components, so every `.native.tsx` hardcodes `16`/`999`/`fontSize:28` and re-types the border
  `'rgba(178,190,195,0.3)'` (~15 copies). The **palette IS shared** (colors don't drift — good). The fix is
  **one numeric source** (`scale.ts`) that the web tokens, `nativeTokens`, and the mobile `tamagui.config`
  derive from — with the tamagui/typography legs guarded from the **mobile** package (the module graph is
  one-way: mobile → `@commise/ui`, so `@commise/ui` cannot import the config back — round-2 R2). Web emission is
  **unit-aware** (unitless `0`, `px` for `radius.full`, `rem` elsewhere), not a uniform ÷16.
- **RC-3 — Sub-target touch targets, pervasive (both).** Icon buttons ~40px, `size-8` avatar 32px, ingredient
  checkbox 20px, step toggle 32px, tab-bar tabs ~24pt, pager dots 10px. Several clear the **AA minimum (24px)**
  but miss the **comfortable mobile target (44px)** we want on touch surfaces; a few (pager dots, 20px
  checkbox) are genuinely too small. Fixes are **touch-surface-scoped** (native + mobile-web base), not desktop
  density changes.
- **RC-4 — Safe-area insets applied in exactly one place (both).** RN: only the Home surface; auth/profile
  render under the notch. Web: only the FAB uses `env(safe-area-inset-bottom)`; the fixed bottom tab bar and
  the bottom-sheet nudge sit under the iOS home indicator.
- **RC-5 — Missing/blank loading states + un-virtualized lists (RN app).** The three core lists render a
  **blank `<View>`** while loading and use `ScrollView + .map` over growing remote data (should be FlashList,
  a NEW dep — `@shopify/flash-list`); no `KeyboardAvoidingView` on any form.
- **RC-6 — The brand is absent, not just inconsistent (mostly native).** Beyond tokens, the shipped surfaces
  render **flat**: no gradient backgrounds, no frosted-glass cards, and **zero intentional motion** (only a
  loading shimmer) — while the mockups define exactly those. Nuance (round-2 R7): the shared **web** `Button`
  primary is **already** `bg-gradient-to-br from-seafoam to-ocean-dark` (`Button.tsx:28`), so the gradient-CTA
  gap is **native-only** (the native `Button` primary is solid `palette.seafoam`); the gradient *backgrounds*
  and *glass cards* are absent on both. Correctly-tokenized-but-flat would still read off-brand; this is why U8
  exists (owner ruling 1).

### NOT a root cause (verified — don't "fix" these)
Grids and page widths on the recipe surface (correctly `grid-cols-1 … sm:/lg:`), horizontal overflow (flex
rows use `min-w-0 flex-1`), the mobile nav pattern (real `lg:hidden` bottom tab bar + focus-trapped hamburger
drawer), and `expo-image` usage are already correct.

---

## Pattern Register _(per CLAUDE.md — design-pattern-first)_
- **Single-source design tokens (one numeric scale, many representations).** A shared numeric array
  (`packages/apps/commise/ui/src/tokens/scale.ts`) is the sole source; the web tokens (unit-aware emission), the
  RN `nativeTokens`, and the mobile app's Tamagui `createTokens` + `createFont` ramps all **derive** from it.
  Drift tests assert agreement — the web+native legs from `@commise/ui`, the **tamagui/typography legs from the
  mobile package** (one-way module graph; round-2 R2). No per-file literals; no un-guarded copy.
- **Shared primitives over per-screen re-implementation.** The `@commise/ui` `Button` (with a real `busy`
  spinner + pressed-scale state), a new tokenized native `Input`, and the shared `ConfirmDialog` replace
  hand-rolled controls (raw RN `<Button>`, unstyled Radix dialog, the recipe-detail's hand-drawn buttons).
- **Surface-treatment adapter (brand).** A small cross-platform `Surface`/`GradientSurface` +
  `GlassCard` primitive encapsulates the gradient/frosted-glass language (web: CSS `linear-gradient` +
  `backdrop-filter`; native: `expo-linear-gradient` + `expo-blur` `BlurView`, with a solid-color fallback when
  blur is unsupported/expensive). Hero surfaces compose it; leaves stay pure `props → JSX`.
- **Motion via a declarative press primitive.** A `Pressable`-based `PressScale` (native: Reanimated/`Animated`
  scale; web: `active:scale-[0.98] transition-transform`) gives buttons/cards/FAB tactile feedback. Non-essential
  motion respects `prefers-reduced-motion` / RN reduce-motion.
- **Orchestrational/render split — preserved.** Screens stay thin containers; only the presentational leaves
  change. No data/logic changes except the ingredient-identity fix (U6) and per-container debounce (U7).
- **Virtualized list (FlashList).** Replaces `ScrollView + .map` for growing remote collections.
- **Command (TanStack mutations) + Statechart (editor) — preserved, not reworked.**

---

## Implementation Units

> **Delivery order (owner ruling 2):** enablers **U0 → U1 → U8-tokens/primitives** first (they unblock
> everything), then the value-led core loop **U6[HIGH] + U7[HIGH]**, then the auth-cluster rebuild **U2 + U3**,
> then polish **U4 + U5** and the remaining **U8** hero-brand surfaces. Unit IDs are stable anchors (they match
> the review); the number is not the sequence — this callout and Sequencing are.

### U0. Single-source token scale + native tokens _(enabler — unblocks all RN styling; module graph per round-2 R2)_
- **Goal:** One numeric token source that web, native, and the mobile Tamagui config all derive from — killing
  both the web-only-`rem` gap and the existing native duplication (RC-2).
- **Files:**
  - `packages/apps/commise/ui/src/tokens/scale.ts` (NEW — the sole numeric arrays: `spacing`
    0,4,8,12,16,24,32,48,64,96; `radius` sm 6/md 12/lg 20/xl 28/full 9999; `type` fontSize+lineHeight+weight per
    `displayXl … caption`; `elevation` shadow specs; `borderSubtle` color).
  - `src/tokens/native.ts` (NEW — `nativeTokens`, native-typed numbers/objects, **derived from `scale.ts`**),
    exported from `src/index.ts`.
  - Web tokens: derive from `scale.ts` with **unit-aware emission** — unitless `0`, `px` for `radius.full`, `rem`
    elsewhere (NOT a uniform ÷16, which would emit `0rem`/`624.9375rem`; round-2 R2).
  - **`packages/apps/commise/mobile/tamagui.config.ts`** (mobile app, NOT `@commise/ui`): refactor its
    `createTokens` `space`/`radius` **and** the two `createFont` ramps to **import `@commise/ui/scale`** — via
    an explicit **name→numeric-key map** for radius (`sm→1 … full→5`) and the synthesized `0`/`true:16`/`size`
    keys, and the positional `createFont` `size`/`lineHeight`/`weight` maps. Numeric values map exactly (12/16,
    20/16, 28/16 are exact floats — no drift); the work is the key-shape mapping, not arithmetic.
- **Cross-platform:** web tokens re-emitted from the shared source with **byte-identical output** (unit-aware +
  a snapshot proves it). Mobile Tamagui/font values unchanged. New native export. Safe.
- **Test scenarios:**
  - `@commise/ui` (local vitest): `nativeTokens.spacing[4] === 16`; radius/type/shadow shape; **web↔native↔scale**
    drift guard; a web-token **snapshot** proving unit-aware emission is byte-identical to today.
  - **mobile package** (local vitest — the tamagui config lives here): a drift test asserting the config's
    `createTokens` space/radius and both `createFont` ramps equal the values derived from `@commise/ui/scale`
    (the third+fourth legs the one-way module graph keeps out of `@commise/ui`'s own suite).
- **Verification (local vitest):** `@commise/ui` + mobile token/drift suites green; web token snapshot unchanged.

### U1. Shared primitive fixes _(BOTH platforms — but Button height is mobile-scoped; flagged)_
- **Goal:** Fix the shared controls once so every consumer benefits, without a desktop density change.
- **Files:** `@commise/ui` `Button` (`button/Button.tsx` web + `Button.native.tsx`): (a) **native** →
  `minHeight: 44` + `paddingVertical` bump; (b) **web** → `min-h-11` at **base with a `md:` reset to the
  current height** (`md:min-h-0` / restore `py-2.5`) so **desktop height is unchanged** — touch widths get 44px,
  mouse widths keep today's density (correcting the WCAG mis-citation: AA is 2.5.8/24px, already met); (c) make
  the **`busy` prop render a spinner** — verified: today `busy` only sets `disabled`+`aria-busy` (`Button.tsx:48-49`,
  `Button.native.tsx:33,39`), so **no `ActivityIndicator` lives in the primitive** (the bare, layout-shifting
  indicators are in the login/signup consumer screens; round-2 R8). Adding the spinner here lets those screens
  drop theirs; (d) add the `PressScale` pressed state (U8 primitive). A NEW tokenized native `Input` (label
  association + error slot). _(The former web `AccountDeleteForm`→`ConfirmDialog` item is **removed** — CR-002
  U4b already did it; round-2 R1.)_
- **Cross-platform / desktop impact:** **Button desktop height unchanged** (base+`md:` reset). Native Input is
  native-only. **`busy`-spinner + `PressScale` DO change every desktop button's behavior** (a spinner on busy; a
  press-scale on click) — a deliberate, reduce-motion-gated change **enumerated in the desktop-impact table**
  (round-2 R6), not "silently additive."
- **Test scenarios:** Button native `minHeight:44`; web base `min-h-11` **and** a `md:`-reset assertion proving
  desktop height is preserved; `busy` renders a spinner + disables (no layout shift); `PressScale` applies a
  pressed state and is suppressed under reduce-motion; native Input renders label+error a11y-associated.
- **Verification (local vitest):** `@commise/ui` + web + shared/native Button/Input suites green; existing
  consumers' desktop **height** unaffected (motion/spinner changes are the enumerated exception).

### U6. Recipe creation/editing — UX flow overhaul _(VALUE-LED; mixed shared/`.native`)_
- **Goal:** Turn create/edit from an unstyled data-entry form into a guided authoring flow, and **close the
  ingredient data-integrity trap** — without orphaning freeform rows.
- **Files & approach:**
  - **[HIGH · bug · SHARED] Make the resolved ingredient name read-only.** The resolution pipeline already sets
    `ingredientId` + name + macros together when a line resolves (`toIngredientLine` — via typeahead pick,
    add-by-name/USDA admission, or freeform create). The **bug**: the form row then renders that name as an
    **editable free-text `TextInput`** (`RecipeFormSections.native.tsx:243-267` + web `.tsx:265`) independent of
    `ingredientId`, so the displayed name can drift from the food supplying the calories (present on both
    platforms). **Fix:** once a line has an `ingredientId`, render its name **read-only** — the wireframe row
    (read-only name + inline qty/unit steppers + calories + remove); identity changes only by re-picking through
    the resolver. Before a line resolves, the "name" field is the picker's **search query**, not a persisted
    name. Do NOT remove freeform ingredients (they're first-class via `POST /v1/ingredients`); just stop letting
    the row edit a *resolved* line's name. Shared; rewrite the name-editing tests to the read-only model.
    (`recipe-edit.md:59-70`.)
  - **[HIGH · bug · `.native`] Style `IngredientPicker`.** It has NO `StyleSheet` — bare
    `<Text>/<TextInput>/<Pressable>` rows. Give it the form's field/card/list-row treatment: search icon + clear
    button, tappable rows with `PressScale`, inline loading, clear rendering of the resolver's view states
    (`idle`/`searching`/`results`/`terminal`/`disambiguating`), and the "USDA database" hint as a subtle badge.
    Leave a **seam for the "Search USDA for '…'" affordance** (owner decision: local-first, USDA on-demand) that
    the separate USDA-autocomplete CR fills in — style it now, wire it when the backend path lands.
  - **[MED · feature · SHARED] De-densify Basics.** Tags + dietary flags are comma-separated raw text
    (`values.tags.join(', ')` → `parseCommaList`) — replace with **chip inputs + type-ahead** (a shared control;
    the comma-text is a UX bug on web too). Cuisine radio-chip cloud → a **Select/dropdown**. Group prep/cook on
    one row; move difficulty/dietary out of the step-1 pile.
  - **[MED · `.native`+SHARED] Wizard chrome — footer primary (SHARED component).** The sticky top bar packs
    four filled buttons that **wrap to two rows** on a phone, and **Publish is live on every step**. The
    `Wizard`/`RecipeFormSections` are **shared** components, so this is a **shared** change (web parity):
    move to **one contextual footer primary** (Next → … → Publish on step 4); demote Save-Draft/Cancel to a
    header overflow menu; never wrap four filled buttons. (Resolves the draft's `.native`-vs-shared
    contradiction: it is shared.)
  - **[MED · `.native`] Create-flow photos.** Step 4 on CREATE is a bare-text "save first" dead-end
    (`RecipeCreateScreen.tsx:98`). Make create a **3-step flow** (hide/disable Photos on create) OR accept local
    picks and upload after the create resolves.
  - **[MED · feature · `.native`+SHARED] Per-photo Replace + cover selection (NET-NEW — designed fresh).** No
    wireframe defines this (the earlier `recipe-edit.md:96,102` citation was wrong). Design: in
    `RecipePhotoManager`, each photo gets a **Replace** action and a **"Set as cover"** toggle; the chosen
    cover drives `RecipeCard.Cover` in discovery/detail. Specify the interaction here since there is no mockup:
    single-select cover (radio semantics), cover defaults to the first photo, remove-cover reassigns to the
    next. Shared where the photo-manager is shared; `.native` for the RN picker glue.
  - **[MED · `.native`] Empty state.** A brand-new recipe drops into a blank Basics form — add first-step
    guidance.
- **Cross-platform / desktop impact:** the resolved-name read-only fix, chip-input, wizard-footer-primary,
  and cover-selection are **shared → land on web too** (data-integrity + UX bugs everywhere, plus the elected
  cover feature). `IngredientPicker` styling, create-photos, empty state are `.native`.
- **Test scenarios:** a **resolved** line's name is **read-only** (cannot drift from its `ingredientId`); qty/unit
  stay editable and do NOT change identity/nutrition; re-picking through the resolver changes identity; freeform
  create still works and its name is set at creation (not row-edited); tags render as chips (no comma parsing);
  cuisine is a select; wizard shows one footer primary (no 4-button wrap); create never dead-ends on photos; a
  cover can be chosen and drives the card.
- **Verification:** shared `features/recipes` + mobile `.native` suites — `features/recipes` runs **local
  vitest**; mobile-app SCREEN `.native` tests are **CI-only** (`@expo/vector-icons` ESM) so verify locally via
  `features/recipes` native tests + `tsc`; a **Maestro (emulator/CI)** create-flow pass (add ingredient → edit
  qty → publish) proves no desync.

### U7. Recipe discovery — UX flow overhaul _(VALUE-LED; per-container debounce; `.native` browse/skeleton/filters)_
- **Goal:** Turn discovery from a per-keystroke search into a **browsable, engaging, performant** surface.
- **Files & approach:**
  - **[HIGH · bug · per-container] Debounce the query — reusing the existing hook.** `searchValue` feeds
    `useInfiniteSearchRecipes` on every keystroke → a network search per character. There is **no shared
    discovery model**, and a **`useDebouncedValue` hook already exists** (`features/recipes/src/hooks/
    useDebouncedValue.ts`) — reuse it **per container**. The per-keystroke cost is the **fetch**, not the state
    write (round-2 R4): on web the input is **URL-controlled** via a round-trip-free `replaceState`
    (`RecipeDiscoveryContainer.tsx:89-104`), so the shape both platforms need is the same — **keep an immediate
    local echo for the input, debounce the value that feeds `useInfiniteSearchRecipes`** (~250–300ms).
    - **Web:** the input currently reads its value *from* `useSearchParams()`, so debouncing the URL push would
      make the field lag; instead hold an immediate local input value and debounce the value passed to the query
      (the URL push can stay immediate or also debounce — it does not gate keystrokes).
    - **Mobile:** hold the immediate value in `useState` and debounce the value passed to the query.
    The difference is only *where the immediate value lives*, not "useState vs URL push."
  - **[HIGH · bug · `.native`] Mobile loading skeleton.** `RecipeDiscoveryList.native.tsx:57` renders a **blank
    `<View>`** — web already draws skeletons. Add skeleton cards (shimmer, reduced-motion-aware). `.native`
    regression fix; web unaffected.
  - **[HIGH · feature · NET-NEW shared block + platform leaves] Browsable default (owner ruling 4).** With no
    query, discovery runs a flat relevance stream — nothing curated. Add a **default browse state**: **Trending**
    (`MOST_CLONED`), **New** (`RECENT`), **Quick** (`QUICKEST`) rails + cuisine shortcuts (the sorts already
    exist in the data layer), switching to the result list once a query/filter is active. **Net-new (no
    wireframe) → designed here:** horizontal-scroll rails with a section header + "see all"; each rail is one
    `useInfiniteSearchRecipes` call with a fixed sort and small page; the cuisine shortcuts set a filter.
  - **[HIGH · `.native`] Filters → bottom sheet.** `RecipeFilterBar.native` renders ~7 always-open facet groups
    above the results. Collapse into a **"Filters" button with an active-count badge** opening a bottom sheet;
    keep the active-count + Clear-all inside.
  - **[MED · `.native`] Compact grid.** Single-column full-bleed cards → a **2-col grid** for browse/results
    (web is already responsive 1/2/3/4).
  - **[MED · `.native`+SHARED] Demote Clone.** The filled-coral Clone competes with browsing — make it a
    ghost/outline/icon so the card reads **tap-to-open** first.
  - **[MED · feature · `.native`] Recent searches / live suggestions** on the keyword search.
- **Cross-platform / desktop impact:** debounce is **per-container** (web's URL-push debounce is a real web
  change — a perf fix, enumerated). Skeleton, filter bottom-sheet, 2-col grid are `.native` and are
  **regressions from the web baseline**, so `.native` fixes can't disturb desktop. Curated rails = a new shared
  block consumed by both (so the rails render on web too — a deliberate, owner-approved feature add).
- **Test scenarios:** typing does NOT fire a request per keystroke (debounced, both platforms); mobile shows
  skeleton cards on load; no-query renders curated rails (not a bare search); filters open in a bottom sheet
  with an active-count badge; results render 2-col on `.native`; empty ≠ no-match preserved.
- **Verification:** shared discovery pieces + `features/recipes` native → **local vitest**; mobile SCREEN
  suites **CI-only** (verify locally via `features/recipes` + `tsc`); a **Maestro (emulator/CI)** pass (type →
  debounced results; no-query → rails; open filter sheet).

### U2. RN app — rebuild the identity/auth surface _(native-only; Tier-2 rebuild)_
- **Goal:** Bring `login`/`signup`/`AccountSettings`/`profile` up to the design system + localization + device
  ergonomics.
- **Files:** `packages/apps/commise/mobile/src/screens/{login,signup,AccountSettings,profile}.tsx` — replace
  raw RN `<Button>` / raw Tamagui `Button` with the `@commise/ui` `Button` (use its now-real `busy` spinner);
  replace hardcoded hex with `palette` + `nativeTokens`; replace raw inputs with the U1 native `Input`; wrap
  forms in `KeyboardAvoidingView` (RC-5) + `SafeAreaView` (RC-4); route **all copy through `mobileMessages`**
  (add missing keys); associate input labels; add `textContentType="oneTimeCode"` to the verification-code
  field, `keyboardType`/`returnKeyType`/`autoCapitalize` to profile fields; replace the avatar-as-URL-text-field
  with the `expo-image-picker` flow (`RecipePhotoUploader` is the model). Confirm `AccountSettings` reachability
  (audit L2 — it may be unwired in `AppRoot`). The **branded auth entry/welcome** screen is **U8** (hero).
- **Cross-platform:** `.native`/mobile-app screens only — **web untouched.**
- **Test scenarios:** RNTL — login/signup render DS Button + localized labels, `busy` shows spinner + disables,
  no hardcoded English; account/profile use DS Button, labels associated, safe-area + KAV present; destructive
  delete routes through `ConfirmDialog`.
- **Verification:** mobile-app screen suites are **CI-only**; verify locally via shared/`features` native tests
  + `tsc`; strings resolve via `mobileMessages`.

### U3. Mobile web — style + chrome the identity/auth surface _(styling additive; AppShell = approved desktop change)_
- **Goal:** Give `/settings`, `/account`, `/profile` + the `auth/*` forms real styling **and nav chrome**.
- **Two distinct operations (owner ruling 3 — do not conflate):**
  - **(a) Form styling — additive, no desktop regression.** The `/account`,`/settings`,`/profile` pages + the
    residual `auth/*` forms carry **no classes today** (`account/page.tsx:29-41`), so mobile-first styling can't
    regress `md:`/`lg:` — it improves all widths. Style the container
    (`mx-auto max-w-2xl flex flex-col gap-6 px-4 py-8`), heading (`font-display text-display-md`); adopt the
    recipe-form field idiom (`w-full rounded-lg border border-border bg-white px-3 py-2`); route the raw
    `<button>`s (e.g. `AccountCloseForm.tsx:59`, the `AccountEditForm` submit) through `@commise/ui` `Button`;
    give `AccountStateNotice` a real alert surface; localize the residual hardcoded English in
    `AccountEditForm.tsx` (`'Not authenticated'`/`'Update failed'`, :29,40). _(The close/erase **danger-zone**
    forms — `AccountCloseForm`/`AccountEraseForm` — already ship on the shared `ConfirmDialog`, styled + localized
    via CR-002 U4b; they need only the DS-`Button` trigger + AppShell context, NOT a rebuild; round-2 R1.)_
  - **(b) `AppShell` wrap — a DELIBERATE, APPROVED desktop change.** `/account`, `/settings`, `/profile` render
    a **bare `<main>` with no nav today, at every width** (`account/page.tsx:29-41`). Wrapping them in
    `<AppShell>` (which renders `HomeChrome`: desktop sidebar + top bar + `lg:hidden` bottom tab/drawer) gives
    them nav on **desktop too** — fixing a real desktop defect (nav-less routes). This is **not** "additive";
    it is enumerated in the desktop-impact table and gated as an approved change.
- **Files:** `web/src/app/[locale]/{settings,account,profile}/*`; `web/src/components/auth/{AccountEditForm,
  AccountCloseForm,AccountEraseForm,AccountStateGate,AccountStateNotice,ProfileContent}.tsx` (the current set —
  `AccountDeleteForm` no longer exists).
- **Test scenarios:** web RTL — each page renders inside `AppShell` with nav; forms full-width + labeled +
  error-wired; the (already-shipped) close/erase dialogs still render centered/overlaid post-restyle; no
  hardcoded English.
- **Verification:** web component tests (**local vitest**) + a **Playwright** pass on the account routes **and a
  desktop (1280px) assertion that the new sidebar/top-bar actually renders** (exercise the AppShell change, don't
  assume "it had none").

### U4. RN app — recipe/home polish _(native-only; Tier-1 — mechanical, brand items moved to U8)_
- **Goal:** Migrate the recipe/home leaves to tokens + fix the systemic mobile gaps. _(Split per review: the
  brand items — Playfair, card shadows, detail DS-Button restyle — now live in **U8**; this unit is the
  mechanical polish so it isn't a mega-unit.)_
- **Files (all `.native.tsx` / mobile app):**
  - **[HIGH] Lists → FlashList** (`RecipeList.native`/`RecipeDiscoveryList.native`/`CollectionList.native`):
    add **`@shopify/flash-list` v2** (NEW dep — the SDK-57/new-arch pairing; round-2 R5) — **v2 auto-measures,
    so NO `estimatedItemSize`** (deprecated); use `keyExtractor` + `expo-image` `recyclingKey` (RC-5/H1); **card
    skeletons** for the blank loading state (follow Home skeletons); pull-to-refresh on Discovery + Collections.
  - **[HIGH] Token migration:** replace every hardcoded spacing/radius/fontSize/border literal in the ~15 files
    (`RecipeList`, `RecipeDiscoveryList`, `CollectionList`, `RecipeCard`, `RecipeDetailView`, `HomeTopBar`,
    `HomeTabBar`, `PlaceholderWidgetCard`, `RecipesScreen`, …) with `nativeTokens`/`borderSubtle` (U0).
  - **[HIGH] Touch targets:** 44pt hit areas (hitSlop/min-size) on the ingredient checkbox, step marker, Home
    avatar, tab-bar tabs, "see all", recipe tabs (RC-3).
  - **[MED] Contrast (WCAG AA):** darken/weight the info-bearing `mist` (1.9:1) and `coral`-as-text (2.2:1)
    usages — the disabled "coming soon" tab label, coral badges/tags, empty-star glyphs.
- **Cross-platform:** `.native.tsx` leaves have separate web `.tsx` files — **web is not affected.**
- **Test scenarios:** RNTL — lists render via FlashList with skeletons on load; targets ≥44pt; token values
  applied (no literals); contrast-fixed colors.
- **Verification:** `features/recipes` `.native` → **local vitest**; mobile SCREEN suites **CI-only**; a
  **Maestro (emulator/CI)** pass on list scroll + detail.

### U5. Mobile web — recipe/home responsive polish _(base/`sm:` only; desktop provably untouched)_
- **Goal:** Fix the remaining 360px layout + safe-area + target issues on the recipe/home surface.
- **Files (base/`sm:` classes only; touched chrome is `lg:hidden`/`md:hidden`):**
  - **[HIGH] Safe-area:** `HomeTabBar` `pb-[env(safe-area-inset-bottom)]` + `HomeChrome` main padding;
    `SubscriptionNudge` bottom sheet `pb-[calc(1.5rem+env(safe-area-inset-bottom))]` (RC-4). Mobile-only chrome
    → desktop unaffected.
  - **[MED] Targets:** `HomeTopBar` icon buttons + avatar `min-h-11 min-w-11` at base **with `md:` reset**;
    ingredient checkbox 44px hit area `size-6 sm:size-5`; filter/sort chips `py-1.5`.
  - **[MED] Layout at 360px:** `VersionCompareView` diff `grid-cols-1 md:grid-cols-2`; `Wizard` preview modal
    `max-h-[85vh] overflow-y-auto`; `RecipePhotoManager` `grid-cols-2 sm:grid-cols-3`; `RecipeFormSections`
    cramped ingredient/step rows stack/icon-only the remove control at base; dialogs
    `mx-4`/`max-w-[calc(100%-2rem)]` edge padding; responsive h1 `text-2xl sm:text-4xl`.
  - **[LOW] Loading:** replace the web `RecipeList` `LoadingBody` blank spans with real skeleton rows.
- **Cross-platform:** every change is a base/`sm:` addition with the desktop value preserved at `md:`+ (or on
  `lg:hidden` chrome) — **desktop/tablet output provably unchanged.**
- **Test scenarios:** web RTL + Playwright at 375px — no horizontal overflow; bottom nav clears the home
  indicator; targets ≥44px; version-compare single-column at base, two-column at `md:`; **desktop snapshot at
  1280px byte-identical.**
- **Verification:** web suite (**local vitest**) + a **Playwright** mobile-viewport pass; desktop visual
  snapshot unchanged.

### U8. Brand visual language on hero surfaces _(owner ruling 1 — the visual uplift; depends on U0/U1)_
- **Goal:** Make the app **look like the mockups**, not merely consistent — gradient backgrounds,
  frosted-glass cards, gradient CTAs, and tactile motion on the surfaces that carry the brand. Without this the
  felt "looks like garbage" recurs even after hygiene (design-lens).
- **Files & approach:**
  - **[HIGH] Surface primitives (`@commise/ui`, shared + `.native`).** Add `GradientSurface` + `GlassCard` +
    `PressScale` (see Pattern Register). Web: CSS `linear-gradient` + `backdrop-filter: blur()` +
    `active:scale`; native: **`expo-linear-gradient`** + **`expo-blur` `BlurView`** + **`react-native-reanimated`**
    (NEW deps — pin to the `expo install`-resolved **SDK-57** versions; round-2 R5) with a **solid-color fallback**
    where blur is unsupported/janky. Tokenized (U0); reduced-motion-aware.
  - **[HIGH] Hero surfaces adopt them (RN app + mobile-web):** **home** (gradient hero header + glass stat/
    widget cards), **recipes list** + **recipe detail** (gradient title band + card shadows + gradient primary
    CTA), **discovery** (gradient section headers on the rails). Includes the U4 brand leaves moved here:
    thread **Playfair display** onto list headings + detail titles, tokenized card **shadow/elevation** on
    recipe/collection/stat cards, and rebuild the detail `primaryAction`/`secondaryAction`/`deleteAction` as DS
    `Button`s. **The DS web `Button` primary ALREADY carries the gradient** (`Button.tsx:28`
    `from-seafoam to-ocean-dark`; round-2 R7) — so on web, **thread that existing DS gradient** (don't add a
    parallel one); the **native** `Button` primary (solid `palette.seafoam` today) gets the matching gradient so
    the two platforms converge. Carousel active-dot indicator; context labels on bare spinners;
    `SuspensionBanner`/`ImpersonationWarning` → `palette` + `mobileMessages`.
  - **[HIGH · feature] Branded auth entry/welcome screen (RN + web).** The auth cluster jumps straight to bare
    forms; the mockups define a **branded entry** — hero image/gradient + tagline + feature pills + gradient
    "Get started" CTA leading into sign-up/sign-in. Add it (net-new surface, designed to the mockup);
    localized.
  - **[MED] Motion pass:** `PressScale` on Button/cards/FAB; subtle enter transitions on the home hero and
    rail sections. Non-essential motion gated on reduce-motion.
- **Cross-platform / desktop impact:** the brand language follows the mockups and therefore renders on **web
  hero surfaces at all breakpoints** — a **deliberate, owner-approved visual change on desktop web too** (ruling
  1: "full brand language"). If a divergent **desktop** mockup exists for a given screen, it governs that screen
  (flag on encounter). RN is unconstrained. Enumerated in the desktop-impact table.
- **Test scenarios:** hero surfaces render the gradient/glass primitives (RTL/RNTL presence + fallback when
  blur unsupported); gradient CTA is the primary action; `PressScale` applies a pressed state and is suppressed
  under reduce-motion; the auth entry screen renders hero + localized CTA and routes into sign-up/sign-in.
- **Verification:** `@commise/ui` + web + `features/recipes` native → **local vitest**; mobile SCREEN suites
  **CI-only**; **Playwright** (web hero + auth entry) + **Maestro (emulator/CI)** (native hero + auth entry).

---

## Scope Boundaries
- **Do NOT rewrite the good infrastructure.** The recipe/home feature-001 nav, grids, FAB, editor statechart,
  and a11y semantics are correct — only the findings above are touched (styling, tokens, targets, lists,
  and the U8 brand layer on top).
- **In-scope now (owner rulings):** curated discovery rails (U7) + per-photo cover selection (U6) — net-new,
  designed fresh here; the full brand visual language incl. branded auth entry (U8); the `AppShell` nav on
  desktop `/account`,`/settings`,`/profile` (U3).
- **Localization is in-scope** for the auth cluster (U2/U3/U8 entry) — hardcoded English violates the repo
  mandate and is fixed in the same pass.
- **Still deferred (own feature CR):** the mockup's **assisted-creation entry points** — "Generate with AI",
  "Import from URL", "Scan Recipe" (only "Create from Scratch" is built) — a product-intent gap, not a UI fix.
  Also the **USDA-blended autocomplete** (owner decision: local-first, USDA on-demand) — a **cross-service CR**:
  a NEW read-only, rate-limited live-USDA search path (food-service exposes `UsdaSourceAdapter.searchByName`
  today only inside persisting admission + a rolling-60-min limiter) + the blended-typeahead UI (badged USDA
  rows, pick→admit via the existing `/by-name`). U6 styles the picker + leaves the affordance seam; this CR
  fills it. (Freeform ingredients already exist via `POST /v1/ingredients` — not part of this.)
- **Still deferred (follow-up):** server-side image thumbnails / `next/image` for full-size originals
  (FOLLOW-UP-CR-001-A); `next/font` swap for the render-blocking Google Fonts `@import`. (Full reduced-motion
  plumbing is now **partially in-scope** via U8's motion pass — the primitives gate on reduce-motion.)

## Sequencing & cross-platform safety summary
**Enablers first:** **U0** (single-source tokens) → **U1** (shared primitives, Button mobile-scoped) → **U8
primitives** (surface/press). **Then value-led (owner ruling 2):** **U6[HIGH]** (ingredient-integrity fix +
`IngredientPicker`) + **U7[HIGH]** (debounce + skeleton + browsable rails) — the core loop. **Then Tier-2
rebuild:** **U2** (RN auth) + **U3** (web auth + AppShell). **Then polish + hero brand:** **U4** + **U5** +
the remaining **U8** hero surfaces. U6/U7 `[MED]` items trail their `[HIGH]` slices.

**Parallelism:** U6/U7 (recipe surface) and U2/U3 (auth surface) touch disjoint files → parallel-safe;
U4 (`.native`) and U5 (web base/`sm:`) are disjoint; U8 depends on U0/U1 and layers onto the surfaces the other
units produce (sequence U8-per-surface AFTER that surface's structural unit to avoid churn).

### Net desktop/tablet impact — by design, each enumerated (corrected from the first draft)
| # | Desktop/tablet change | Why it's justified | Unit |
|---|---|---|---|
| 1 | **Ingredient row: resolved name is read-only** | Data-integrity bug present on web too — a resolved line's name could drift from its `ingredientId`/nutrition. Freeform + USDA pipeline untouched | U6 |
| 2 | **Chip-input for tags/dietary** (replaces comma text) | UX bug on web too | U6 |
| 3 | **Wizard footer-primary** (shared `Wizard`) | Shared component; 4-button wrap + always-live Publish are wrong everywhere | U6 |
| 4 | **Per-photo cover selection** | Owner-elected feature; shared photo manager | U6 |
| 5 | **Discovery: debounced query value** (web — immediate input echo + debounced fetch, round-2 R4) + **curated rails** render on web | Per-keystroke-fetch perf bug; owner-elected browse feature | U7 |
| 6 | **`AppShell` nav on desktop `/account`,`/settings`,`/profile`** | Approved (ruling 3) — fixes nav-less desktop routes | U3 |
| 7 | **Brand visual language on web hero surfaces (all breakpoints)** | Approved (ruling 1) — "full brand language"; follows the mockups | U8 |
| 8 | **Shared `Button`: `busy` spinner + `PressScale` press-motion** (all breakpoints, reduce-motion-gated) | Added to the primitive (round-2 R6); consistent with ruling 1's motion. NOT a height/density change | U1 |

**Explicitly NOT changed on desktop:** the shared `Button` **height** (base+`md:` reset — the WCAG-AA bar
2.5.8/24px is already met) and everything in U4 (`.native`) and U5 (base/`sm:` with `md:`+ preserved). **No
desktop *regressions* anywhere; every desktop *change* above is deliberate and enumerated.**
