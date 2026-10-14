---
title: 'feat: the cuisine field — a 90-entry suggested list, free text, required to publish (app and recipe-service)'
type: feat
date: 2026-10-13
status: DRAFT — awaiting staff-architect BLUEPRINT
---

# The cuisine field, end to end

## Owner rulings (2026-10-13)

- Approve the 90-entry alphabetical list (no `Other`) and the copy in `docs/design/uiOverhaul/cuisineField.md`.
- Cuisine is free text, with suggestions shown like the food input: a list under the input that shows every entry and
  filters to what the cook typed.
- Cuisine is REQUIRED TO PUBLISH, enforced in BOTH the app and recipe-service. A draft saves without one.
- The public-domain cookbook import (`imported_public`, the curator path, ADR-0023) is EXEMPT.

`cuisineField.md` is the UX authority for the field (it amends `buildSpec.md` §7.4 and §4.4). This plan is the
engineering authority for where each rule lives. `ownerDecisions.md` wins over both.

## Facts read from source

- `recipes.cuisine` is a nullable `text` column (`0001_initial.sql`). No migration is needed to hold the value.
- The wire field is `recipeCuisineSchema = z.string().min(1).max(100)` (`recipe-core/src/recipeRequestBounds.ts`),
  optional on create and on PATCH. ⚠️ PATCH has NO clear sentinel: `toCreateRecipeInput` omits an empty cuisine, so a
  cook who empties the field on an existing recipe keeps the old value on the server. That is a live bug today and it
  becomes visible under this feature (the editor would say "Cuisine needed" over a recipe the server still holds a
  cuisine for).
- The server's publish floor today is "≥1 ingredient and ≥1 step": two zod refinements per body
  (`recipes.schema.ts`) plus a re-check in `RecipesService.update` that throws a bare `BadRequestException` (which the
  filter publishes as the UNPUBLISHED generic `BAD_REQUEST` code).
- Provenance on create is resolved by `evaluateProvenance` BEFORE visibility (ADR-0023). A clone copies
  `sourceType` from its source, so a clone of an `imported_public` recipe is itself `imported_public`.
- `CUISINES` (15 entries, display order, with `Other`) lives in `recipe-core/src/recipe.types.ts`; its consumers are the
  editor's `cuisineSuggestions`, the e2e seed and the k6 search script.
- The editor's cuisine field already uses the shared `Combobox` (`@commise/ui/combobox`) on both platforms, with
  `openOnFocus` and an empty `countAnnouncement`.

## Decisions (draft — the server/contract rows are for the architect to confirm or overturn)

| #   | Decision                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `recipe-core/src/cuisine.ts` owns `CUISINES` (90, `Intl.Collator('en')` order), `Cuisine`, `CUISINE_ALIASES`, `foldCuisine`, `canonicalCuisine`. `recipe.types.ts` stops declaring the list. Exported through the package's existing `index.ts` (a package export, so a barrel is allowed).   |
| D2  | Aliases ship (§1.3: seven rows). Cheap, and without them "Szechuan" and "Sichuan" are two facets.                                                                                                                                                                                             |
| D3  | The server canonicalises every written cuisine with `canonicalCuisine` (cuisineField §5 Q1: yes).                                                                                                                                                                                             |
| D4  | "Required to publish" is a pure policy, `recipes/domain/publishPolicy.ts` (`evaluatePublication`), the sibling of `evaluateVisibility`/`evaluateProvenance`. Never a route guard: `POST/PATCH /recipes` stay open; what is gated is a field value at a status transition.                     |
| D5  | The exemption is keyed on the RESOLVED provenance `sourceType === imported_public` (create: the provenance policy's output; update: the stored row). A clone of an imported recipe inherits it, server-side. The app requires a cuisine on every publish regardless (stricter, never looser). |
| D6  | PATCH gains the three-state `cuisine: string \| null` (absent = unchanged, value = set, `null` = clear), the `difficulty`/`mealType` precedent. `toUpdateRecipeInput` sends `null` for an empty field.                                                                                        |
| D7  | No migration and no CHECK constraint: the column exists, and the rule has an exemption a CHECK would restate as a second authority. Nothing is live.                                                                                                                                          |
| D8  | Error: OPEN for the architect (see questions).                                                                                                                                                                                                                                                |
| D9  | Client gate: `validate.ts` gains `cuisine?: 'cuisineRequired' \| 'cuisineTooLong'`; `cuisineTooLong` is also a draft-floor error. `sections.ts`, `gate.ts`, `sectionStatus.ts` follow (§3.6).                                                                                                 |
| D10 | Combobox P1 (`typedText: 'needsChoice' \| 'isValue'`) and P2 (native `listMaxRows`) land in `@commise/ui`. P3 (`current` mark) is DEFERRED: cuisineField §4 marks it deferrable, and S6 works without it.                                                                                     |
| D11 | The cuisine logic shared by both leaves is a headless hook, `form/useCuisineField.ts`: groups, the Use option, `editedSinceFocus`, the debounced count, commit through `canonicalCuisine`.                                                                                                    |
| D12 | Discover: one pure `cuisineShortcutsOf(facets)` in `discovery/noResults.ts` (≥ `CUISINE_SHORTCUT_MIN_RECIPES`), used by both containers.                                                                                                                                                      |
| D13 | Every writer that PUBLISHES without a cuisine is updated in the same change (seed, k6, e2e fixtures, smoke): the server now refuses them.                                                                                                                                                     |

## Questions for the architect (BLUEPRINT)

1. Policy scope: does `evaluatePublication` absorb the existing ingredients/steps floor (one authority for "may this
   publish"), or only cuisine? If it absorbs them, do the zod refinements stay as the fast local half?
2. Error code/shape: a new published domain code (e.g. `PUBLISH_REQUIREMENTS_UNMET`, 400, `details.missing:
('cuisine' | 'ingredients' | 'steps')[]`) or `VALIDATION_FAILED` with `details.fields`? Clients map either to the
   localized `errors.cuisineRequired`.
3. Canonicalisation layer: a zod `.overwrite(canonicalCuisine)` on `recipeCuisineSchema` (every route inherits it,
   parse-don't-validate) or an explicit call in the service before the DAL write?
4. Create without `status`: it defaults to `published`, so a create that says nothing about status must carry a
   cuisine. Confirm (it matches the ingredients/steps floor).
5. Should the rule ALSO be a zod refine on create (the body carries `status` and `source`), or is the service policy
   the only statement?

## Build order (test-first in each step)

1. recipe-core: `cuisine.ts` + tests (membership 90, order, aliases, fold, canonical idempotence).
2. recipe-service: publish policy + tests; schema change (+ `recipes.schema.test.ts`); service wiring + unit tests;
   integration test over the mocked app; `contract:generate`; LOCAL e2e case written (not run here).
3. Clients: recipe-service client exhaustive switch if a code is added.
4. `@commise/ui` combobox P1/P2 + tests (web and native).
5. features/recipes: `cuisineSuggestions` word-start, `useCuisineField`, messages, `validate.ts`, wire PATCH null,
   sections/gate/sectionStatus, both leaves, component tests for every state, `cuisineShortcutsOf`.
6. Writers: seed, k6, e2e fixtures, Playwright spec, Maestro flow.
7. Lint, typecheck, unit + integration of every touched package, `contract:verify`, `next build`.
