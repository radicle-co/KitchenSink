---
title: 'feat: the cuisine field — a 90-entry suggested list, free text, required to publish (app and recipe-service)'
type: feat
date: 2026-10-13
status: active — staff-architect BLUEPRINT folded in (2026-10-13)
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

- `recipes.cuisine` is a nullable `text` column (`0001_initial.sql`). No migration is needed.
- The wire field is `recipeCuisineSchema` (`recipe-core/src/recipeRequestBounds.ts`), optional on create and PATCH.
  PATCH had NO clear sentinel, so a cook who emptied the field kept the old value on the server.
- The publish floor ("≥1 ingredient and ≥1 step") was stated three times: two zod refinements per body and a re-check
  in `RecipesService.update` that threw a bare `BadRequestException` (published as the unpublished `BAD_REQUEST`).
  It fired only when the body carried `status: 'published'`, so a "Save changes" PATCH (which sends no `status`) could
  empty a published recipe.
- A clone copies `sourceType` from its source. Erasure sets `cloned_from_id = NULL`, so lineage cannot key a rule.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `recipe-core/src/cuisine.ts` owns `CUISINES` (90, `Intl.Collator('en')` order), `Cuisine`, `CUISINE_ALIASES`, `foldCuisine`, `cuisineEntryOf`, `canonicalCuisine`. Exported through the package's `index.ts` (a package export).                                                                                                                                                                                           |
| D2  | Aliases ship (§1.3, eight rows).                                                                                                                                                                                                                                                                                                                                                                                           |
| D3  | Canonicalisation lives in the wire schema: `recipeCuisineSchema = z.string().overwrite(canonicalCuisine).min(1).max(100)`. `.overwrite` keeps `minLength`/`maxLength` in JSON Schema for both `io` modes (`.transform().pipe()` loses `maxLength` under `io: 'input'`, which `storageCapacity.ts` reads). The bounds run after the overwrite, so whitespace-only is refused. The typed client parses with the same schema. |
| D4  | `recipes/domain/publishPolicy.ts` — `evaluatePublication({ status, sourceType, cuisine, ingredientCount, stepCount })`, the third sibling of `evaluateProvenance`/`evaluateVisibility`. It owns the WHOLE publish floor: cuisine, ingredients, steps. `missing` lists every gap in page order. A draft is always allowed. Never a route guard.                                                                             |
| D5  | Create: resolve `status = dto.status ?? PUBLISHED` once, run the policy after provenance and visibility and before `planner.plan`, and write the resolved status to the DAL explicitly. Update: run the policy on EVERY update, against the post-write state (patch value when present, stored value otherwise). Clone: none (born `DRAFT`).                                                                               |
| D6  | Error: new domain code `PUBLISH_REQUIREMENTS_UNMET`, `400`, `details: { missing: PublishRequirement[] (min 1) }`. `PublishRequirement = 'cuisine' \| 'ingredients' \| 'steps'` lives in recipe-core. The bare `BadRequestException` is deleted. Client: `PublishRequirementsUnmetError` (a `BadRequestError`), `is*` guard, own `errorForCode` arm.                                                                        |
| D7  | One authority: the four zod floor refinements are deleted; no cuisine refine is added (the update body cannot see stored `sourceType` or content).                                                                                                                                                                                                                                                                         |
| D8  | PATCH: `cuisine: recipeCuisineSchema.nullable().optional()` (absent = unchanged, `null` = clear). `toUpdateRecipeInput` sends `null` for an empty field.                                                                                                                                                                                                                                                                   |
| D9  | Exemption: `requiresCuisine(sourceType)`, an exhaustive switch; only `imported_public` is exempt. A clone of a corpus recipe inherits it (accepted: lineage is erased with the original's owner). The app requires a cuisine on every publish regardless — stricter, never looser.                                                                                                                                         |
| D10 | No migration and no CHECK constraint: counts live in other tables, a CHECK would restate the exemption and turn a typed 400 into a 500, and nothing is live.                                                                                                                                                                                                                                                               |
| D11 | Client gate: `validate.ts` gains `cuisine?: 'cuisineRequired' \| 'cuisineTooLong'`, measured on `canonicalCuisine(...)` (the server's order). `cuisineTooLong` is also a draft-floor error. `sections.ts`, `gate.ts`, `sectionStatus.ts` follow (§3.6).                                                                                                                                                                    |
| D12 | A pure mapper `publishRefusalErrors(missing)` turns a server refusal into form error codes, so a refusal that does reach the editor is shown in the editor's own localized copy.                                                                                                                                                                                                                                           |
| D13 | Combobox P1 (`typedText`), `onBlur`, and native P2 (`listMaxRows`) in `@commise/ui`. P3 (`current` mark) is DEFERRED: §4 marks it deferrable and S6 works without it.                                                                                                                                                                                                                                                      |
| D14 | The cuisine field's shared logic is a headless hook, `form/useCuisineField.ts`, over a pure view `form/cuisineField.ts`: the groups, the Use option (`CUISINE_USE_OWN_KEY`), `editedSinceFocus`, the 500 ms count, commit through `canonicalCuisine`.                                                                                                                                                                      |
| D15 | Discover: one pure `cuisineShortcutsOf(facets)` in `discovery/noResults.ts` (≥ `CUISINE_SHORTCUT_MIN_RECIPES`), used by both containers.                                                                                                                                                                                                                                                                                   |
| D16 | Every writer that publishes without a cuisine is updated in this change: shared fixture factories first (seed, k6, e2e, smoke), then each Playwright spec and Maestro flow that presses Publish or Save changes.                                                                                                                                                                                                           |

## Pattern register

- `@pattern Specification` — `evaluatePublication`, the third sibling policy, run after provenance.
- `@pattern Visitor` — `requiresCuisine`, an exhaustive switch over `RecipeSourceType`.
- `@pattern Value Object` — `canonicalCuisine`, applied by `.overwrite()` at the schema boundary.
- `@pattern Visitor` — the client's `errorForCode` exhaustive switch gains one arm.
- `@pattern Headless Hook` — `useCuisineField`, shared by the web and native leaves.
- Already the pattern, nothing added: the three-state PATCH (the `difficulty`/`mealType` precedent).

## Tests per tier

| Tier                       | What                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| recipe-core unit           | list membership/order/aliases, `foldCuisine`, `canonicalCuisine` idempotence; `recipeCuisineSchema` canonicalises and keeps its bounds in JSON Schema                        |
| recipe-service unit        | the policy truth table (incl. an `imported_public` clone); create and update wiring; error factory and status table; schema tests rewritten for D7 and D8                    |
| recipe-service integration | the mocked app: publish without cuisine → 400 `PUBLISH_REQUIREMENTS_UNMET`; draft saves; `imported_public` exempt; PATCH `null` on published refused; canonical value stored |
| recipe-service LOCAL e2e   | written, not run here: clearing the cuisine of a published recipe is refused against a real database                                                                         |
| client unit                | `PublishRequirementsUnmetError` from the envelope                                                                                                                            |
| ui component               | P1, `onBlur`, P2 on both leaves                                                                                                                                              |
| features unit + component  | suggestions, view, hook, validate, wire, sections/gate/status, both leaves for every state (S1–S9)                                                                           |
| Playwright / Maestro       | written, not run: the happy path and the publish-blocked path                                                                                                                |

## Build order

1. recipe-core (done: `cuisine.ts`), then the schema overwrite and `publishRequirement.ts`.
2. ui combobox P1/P2 (done).
3. recipe-service policy, error contract, schema, service, integration, LOCAL e2e case, `contract:generate`.
4. Client error class.
5. features: view, hook, validate, wire, editor modules, both leaves, Discover shortcuts.
6. Writers, Playwright, Maestro.
7. Lint, typecheck, unit + integration of every touched package, `contract:verify`, `next build`.

## Residual risk

- A client other than the app can publish a clone of a corpus recipe without a cuisine. Readers already handle an
  absent cuisine, because the corpus itself has none.
- P2 and the keyboard-hide close need a device check (Android Back, font scale 2.0).
