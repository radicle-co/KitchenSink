# Codebase Analysis: Meal Planning

**Branch**: `006-meal-planning` | **Date**: 2026-08-02 (full rewrite)
**Status**: Complete | **Method**: read directly from `main` — the codebase is the source of truth
**Sources**: the monorepo at `main`, `docs/CODING_STANDARDS.md`, `docs/engineering/ENGINEERING_EXCELLENCE.md`,
`CLAUDE.md`, ADR-0003/0004/0005/0006/0008/0010

> **Rewrite note.** The 2026-05-09 version of this file analysed `plan.md` and `tasks.md` rather than the repository.
> It quoted a `workspaces` array containing `packages/ui` (removed in PR #62), described the backend location as
> "depends on existing 001 implementation layout" (001 has since shipped), and listed no ADR, no test-tier obligation
> and no cross-platform rule. Everything below is read from code.

---

## Actual monorepo layout

Root `package.json` workspace globs, as they are today:

```json
"workspaces": [
    "packages/tools/*",
    "packages/services/*",
    "packages/shared/*",
    "packages/utils/*",
    "packages/infra/*",
    "packages/apps/commise/web",
    "packages/apps/commise/mobile",
    "packages/apps/commise/ui",
    "packages/apps/commise/i18n",
    "packages/apps/commise/features/*",
    "packages/clients/*"
]
```

**Consequence for 006**: `packages/api/` — the target of every backend task in the previous `tasks.md` — is an **empty
directory and not a workspace**. So is `packages/services/nutrition/`. Neither can host code. The four packages 006
introduces all fall inside existing globs and need no glob change.

### Packages that exist and matter to 006

| Package                              | Path                                     | Relevance                                                                       |
| ------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------- |
| `@kitchensink/recipe-service`        | `packages/services/recipe-service`       | The service 006 reads recipes and nutrition from; the topology 006 copies       |
| `@kitchensink/recipe-core`           | `packages/shared/recipe-core`            | Pure domain 006 consumes: `nutrition`, `ids`, `recipeAccessPolicy`, `units`     |
| `@kitchensink/recipe-service-client` | `packages/clients/recipe-service`        | The client shape 006's own client mirrors (`ky`, TanStack, `testing/`)          |
| `@kitchensink/food-service`          | `packages/services/food-service`         | Source-agnostic food catalog — 006 does **not** call it                         |
| `@kitchensink/clerk-verify`          | `packages/shared/clerk-verify`           | Session-token verification + the app-user ULID claim                            |
| `@commise/features-core`             | `packages/apps/commise/features/core`    | Home widget contract, capabilities, and the roadmap placeholder 006 retires     |
| `@commise/features-recipes`          | `packages/apps/commise/features/recipes` | The exemplar for `@commise/features-meal-plan`'s exports and test layout        |
| `@commise/i18n`                      | `packages/apps/commise/i18n`             | `LocalizedMessages` / `resolveMessages` — the localization path FR-038 requires |
| `@commise/ui`                        | `packages/apps/commise/ui`               | Design tokens                                                                   |
| `@kitchensink/loadtest`              | `packages/tools/loadtest`                | The k6 harness (`journey.js`, `run.mjs`, auth pool) 006's load tests plug into  |

---

## What 001 already shipped that 006 must consume, not rebuild

This is the section the previous analysis lacked entirely, and it is where the old design went wrong.

### Nutrition is already solved at the recipe level

- `packages/services/recipe-service/src/database/schema/ingredients.ts` persists
  `calories_per_100g`, `protein_g_per_100g`, `carbs_g_per_100g`, `fat_g_per_100g` on ingredient rows. Nutrition is
  already resolved and stored — no live food-service call is on any recipe read path.
- `packages/shared/recipe-core/src/nutrition.ts` is a **pure** per-serving aggregator. It handles user-entered
  overrides (FR-007a), mass-unit conversion via `units.ts`, household-measure portions, and marks a total
  `isComplete: false` when any line cannot be accounted for.
- `RecipeNutrition` = `{ calories, proteinG, carbsG, fatG, isComplete }`. **There is no fibre**, which is why the old
  `meal_plan_nutrition.fiber_g_total` column was unobtainable.
- `Recipe` (list projection) carries `leadCaloriesPerServing?` and `hasPartialNutrition` — denormalized at write time
  expressly to avoid an N+1 on cards. `RecipeDetail` carries full `nutrition`.

**Implication**: 006's nutrition work is a fold over `(RecipeNutrition, servings)` pairs, nothing more. It needs one
additive batch projection on the recipe service to fetch many recipes' nutrition in one call.

### Identity and ownership

- No local `users` table anywhere in `recipe-service`. `recipes.owner_id` is `varchar(255)` holding the app-user ULID
  from the verified token, with **no FK** — documented as "D2 (no local `users` table)" in the schema header.
- Authorization grants come only from the token's signed `public_metadata`, and only as `scopes`/`permissions` —
  asserted by `packages/shared/clerk-verify/src/__tests__/clerkVerify.test.ts`.
- `subscriptionTier` (`'free' | 'premium'`) lives in the identity service's `accounts` table
  (`packages/shared/identity-db/src/dao/account.dao.ts`). **It is not a token claim**, so no service can gate on tier
  from the token today.

### Ids

- `recipes.id` is `uuid` with `defaultRandom()`. `packages/shared/recipe-core/src/ids.ts` brands ids as nominal Zod
  types (`RecipeId`, `UserId`, `IngredientId`, `FoodId`, `S3Key`) with smart constructors and `is*` guards — the pattern
  006's own ids extend.

### Access policy

- `packages/shared/recipe-core/src/recipeAccessPolicy.ts` is a pure, fail-closed Specification module and the single
  authoritative statement of recipe ownership/visibility rules on the client. Its header records defect **D7** — web and
  mobile having implemented two different clone gates — which is the reason 006 puts its own owner predicates in one
  shared module rather than in each app.

### Cross-service integration exemplar

- `packages/services/recipe-service/src/ingredients/foodCatalog.gateway.ts` is the platform's worked example of calling
  another service: bounded transport timeout via a real `AbortSignal` (with an explicit note that `Promise.race` leaks
  pending requests), a total function that never throws, boundary normalization, rate-limited failure logging, and a
  three-state `availability` discriminant. 006's `RecipeGateway` is modelled on it.

---

## Home widget surface — 006's landing contract already exists on `main`

`@commise/features-core` already ships the seam 006 plugs into:

| Artifact                                                    | Value                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `capabilities.ts` → `ROADMAP_CAPABILITIES.mealPlanning`     | `'meal-planning'`                                                                           |
| `homeNavigation.ts` → `HomeNavItemId`                       | includes `'meal-plan'`, gated on that capability                                            |
| `roadmapWidgets.ts` → `RoadmapWidgetId`                     | literal union including `'meal-plan'`                                                       |
| `roadmapWidgets.ts` → `ROADMAP_WIDGET_SPECS`                | `{ id: 'meal-plan', capability: …mealPlanning, defaultWeight: 1200 }` — "This Week's Meals" |
| `packages/apps/commise/mobile/…/MealPlanWidgetSkeleton.tsx` | the mobile skeleton placeholder rendered today                                              |

`roadmapWidgets.ts` also states the retirement procedure verbatim: _"To retire an entry: when its feature ships, delete
its line here and its skeleton in each app."_ Its own header notes there is, by construction, no
`@commise/features-meal-plan` yet — naming the package 006 must create.

Because `RoadmapWidgetId` is a **literal union** consumed by a total per-app `Record<RoadmapWidgetId, HomeWidgetLoader>`,
a half-completed retirement fails `typecheck` rather than review. This is a guardrail 006 should rely on, not work
around.

`001-FR-046` / US-000 scenario 6 already specifies the target behaviour: _"Given the meal-plan service (006) is deployed
AND a user has a meal plan with entries for today or tomorrow, When they view Home, Then the Meal Plan widget shows those
entries with recipe names and meal type."_ 006 is fulfilling a contract that was written for it.

---

## Conventions 006 is bound by

| Rule                         | Source                      | Effect on 006                                                                                     |
| ---------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| Backend file naming          | `CODING_STANDARDS §1a`      | `packages/services/*` uses kebab `name.type.ts` (`meal-plans.controller.ts`). CI-enforced.        |
| Frontend/shared file naming  | `CODING_STANDARDS §1b`      | camelCase modules, PascalCase components. Kebab is **not** allowed in shared/product packages.    |
| Organize by feature domain   | `CODING_STANDARDS §3`       | `plans/`, `entries/`, `templates/` — **not** `controllers/`, `services/`, `repositories/`.        |
| Package naming               | `CODING_STANDARDS §5.1`     | backend/shared/client = `@kitchensink/*`; product UI = `@commise/*`.                              |
| Custom errors                | `CODING_STANDARDS §6, §13`  | `*Error` extending `Error` + `Object.setPrototypeOf` + `is*` guard. Not `*Exception`.             |
| ISO 8601 dates in interfaces | `CODING_STANDARDS §6`       | Never `Date` objects on a contract.                                                               |
| No boolean flag props        | `CODING_STANDARDS §11`      | Orphaned/partial states are composed by the parent, not switched by a prop.                       |
| Cross-platform parity        | `CODING_STANDARDS §14`      | Hard rule; `§14.1` explicitly says a `tasks.md` without paired mobile tasks must be **rejected**. |
| Test mandate                 | `CODING_STANDARDS §7.1`     | Component-per-state + Playwright + Maestro + unit + integration + e2e + k6, all test-first.       |
| Test quality bar             | `ENGINEERING_EXCELLENCE.md` | Outcomes not calls; real dependencies at the integration layer; the acid test in review.          |
| Design-pattern-first         | `CLAUDE.md`                 | A pattern register in the plan; module headers name their pattern; refs near-forbidden.           |
| Library-first                | `CLAUDE.md`                 | Check for a library before hand-rolling retry/backoff/HTTP/date maths.                            |
| Localize user-facing strings | `CLAUDE.md`                 | Every planner and widget string through `@commise/i18n`.                                          |

### Actual test-file conventions (verified on disk)

- Backend unit: `__tests__/*.test.ts`
- Backend integration: `__tests__/integration/**/*.integration.test.ts` (e.g.
  `packages/services/recipe-service/__tests__/integration/search/search.integration.test.ts`)
- Backend e2e: `tests/e2e/*.e2e.test.ts`
- Frontend component: `*.test.tsx`, native variant `*.native.test.tsx`
- Playwright: `packages/apps/commise/web/tests/e2e/*.spec.ts`
- Maestro: `packages/apps/commise/mobile/.maestro/**/*.yaml`
- k6: `packages/tools/loadtest`

---

## Infrastructure facts 006 must respect

| Fact                                                                                                                                                                                                                                                                                                                          | Source                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| One shared internet-facing ALB per stage; services add host rules, never own an ALB                                                                                                                                                                                                                                           | ADR-0003, `SharedAlbStack`                   |
| Base listener priorities: identity 100, food 200, recipe 300 → **006 takes 400**                                                                                                                                                                                                                                              | `RecipeServiceStack.ts`                      |
| Per-PR priority bands are cut from a SLOT INDEX by `packages/infra/alb` — 006 registers and takes **slot 3** (20000–25999); it does not pick a band. _(Superseded 2026-08-16: this row previously read "food 10000s, recipe 30000s → 006: 50000s", from the deleted per-service resolvers; 50000s is also out of AWS range.)_ | `packages/infra/alb/src/listenerPriority.ts` |
| NAT is a single `t4g.nano` instance; Fargate egresses via IGW, not NAT                                                                                                                                                                                                                                                        | ADR-0004                                     |
| Logical DB per service on the shared RDS instance; per-PR DB derived from base                                                                                                                                                                                                                                                | ADR-0006                                     |
| DB-name derivation must be a **leaf module with no imports**, not barrel-exported                                                                                                                                                                                                                                             | `recipeDatabaseName.ts`, defect #119         |
| `Environment=global` persists; `Environment=pr-{N}` is deleted on PR close                                                                                                                                                                                                                                                    | ADR-0005                                     |
| Non-prod uses `gp3` + `FARGATE_SPOT`; a $300 account budget guardrail exists                                                                                                                                                                                                                                                  | ADR-0008                                     |
| Per-PR deploy jobs are gated **ensure-exists**, not on changed paths                                                                                                                                                                                                                                                          | ADR-0010, `.github/scripts/deploy-gate.sh`   |
| **No Redis or ElastiCache exists anywhere in the platform**                                                                                                                                                                                                                                                                   | verified by search across all infra packages |

---

## Cross-feature dependency graph (current reality)

- **Consumes 001 (shipped)** — recipe readability and per-serving nutrition, via `@kitchensink/recipe-service-client`
  and `@kitchensink/recipe-core`. **Requires one additive change**: a batch nutrition projection.
- **Consumes 002 (shipped)** — authenticated routes; app-user ULID as `owner_id`.
- **Does not consume 003 directly** — nutrition arrives already resolved through 001. The previous analysis's
  "Consumes 003: USDA-backed nutrient values" is wrong on two counts: 006 never calls it, and 003 is source-agnostic.
- **Blocked on 005 and 010** for FR-025/026/027 (Phase 2).
- **Feeds 007 and 009** — read projection only (FR-036); 006 generates no grocery lists.

---

## Risks and gaps

1. **The batch nutrition endpoint is a prerequisite in another package.** 006's latency requirement (NFR-006) cannot be
   met without it, and it lands in `packages/services/recipe-service`. It must be sequenced first and reviewed as a
   change to a shipped service.
2. **Roadmap retirement touches three packages atomically** (`features/core`, `web`, `mobile`). The typecheck guardrail
   catches an incomplete retirement, but the change must be planned as one unit.
3. **Two interaction models** (web drag, mobile tap) must be proven to drive identical outcomes. The mitigation is that
   both call one shared command surface; the risk is tests that assert the interaction rather than the outcome.
4. **Phase 2 is blocked by two unbuilt features**, one of which (010) also blocks the only entitlement mechanism. Any
   scope pressure to "just ship the AI bit" will hit an entitlement that cannot be enforced.
5. **A new service adds recurring cost** (~$8/mo per open PR, plus base stages) against the ADR-0008 budget. Costed in
   `plan.md`; worth re-checking if the number of concurrently open PRs grows.
