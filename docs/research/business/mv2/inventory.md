# Commise feature inventory for the market analysis

Built 2026-10-27 from `specs/001-*` to `specs/020-*`, `specs/v1-launch-plan.md`, `specs/beta-exit-criteria.md` and
the code in the `fix/ingredient-matching` worktree.

## How to read this

- **Plan authority.** The plan register in `specs/010-subscriptions/spec.md` ("Plan register"), `010-FR-040`,
  `010-FR-041` and `005-FR-015` to `FR-015f`. The register wins over any plan tag written inside another spec
  (`010-FR-041b`).
- **Free** means the register or `010-FR-040` puts it on Free. `010-FR-040` lists recipe CRUD, sharing and cloning,
  basic importing, manual meal planning, grocery list generation and cooking mode.
- **[Inference]** means the register and `010-FR-040` are both silent. The reason is given in the row.
- **"?"** means the sources conflict or say nothing usable. The reason is given.
- **SHIPPED** means the code is in this branch's tree. It does not mean deployed. This branch is 379 commits ahead of
  `main`, and nothing here was checked against production.
- **PARTIAL** means some of the capability is in the tree and the rest is spec only.
- **SPECCED** means a spec only. No code was found.
- **STOPPED / BLOCKED** means an owner stop line, an open owner question, or a missing outside dependency.
- Owner ruling 2026-10-27: everything is built around launch, not necessarily beta. So every specced feature below is
  a launch offering. Status only shows what beta will lack.
- Positive evidence of what is not built: `packages/apps/commise/features/core/src/capabilities.ts` lists
  `mealPlanning`, `shopping`, `nutrition` and `cookingSession` as roadmap capabilities. Home shows them as skeleton
  widgets only (`packages/apps/commise/features/core/src/roadmapWidgets.ts`).

### Stale plan tags inside specs (the register wins)

- `005-FR-019` says "(Pro with AI)". The register says Free and Pro with AI, using credits.
- `006-FR-025` says "Pro with AI". The register says Free and Pro with AI, using credits.
- `007-FR-031` says "(Pro)". The register says no plan until a store partner exists.
- `009-FR-039` says "(Pro with AI)". The register says Free and Pro with AI, using credits, and marks it inferred.
- `010-FR-041` lists AI recipe generation, meal suggestions and instruction optimization under Pro with AI only. The
  register and `005-FR-015f` also give them to Free, inside the 3 monthly uses.
- `017-FR-038` lets any user add own keys. `005-FR-015` (amended 2026-10-27, later) says Pro and Pro with AI only.

## (a) Capability table

Plan cells: Y = included. N = not included. Credits = uses the plan's AI allowance. BYOK = only with the cook's own
AI keys.

### 001 Recipe app (core)

| Capability                                                                              | Spec + FR                          | Checklist row | Free          | Pro | Pro with AI | Status  | Path evidence or note                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------- | ---------------------------------- | ------------- | ------------- | --- | ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create, edit, delete recipes with ingredients, steps, times, servings, tags, difficulty | 001-FR-001, FR-001b, FR-002        | C10           | Y             | Y   | Y           | SHIPPED | `packages/services/recipe-service/src/recipes/recipes.controller.ts`                                                                                                                                                               |
| Recipe photos, uploaded apart from the recipe save                                      | 001-FR-001a, FR-001c               | C10           | Y             | Y   | Y           | SHIPPED | `packages/services/recipe-service/src/photos/photos.controller.ts`                                                                                                                                                                 |
| New recipes public by default, unlimited public recipes                                 | 001-FR-003, 010-FR-040             | C06, C08      | Y             | Y   | Y           | SHIPPED | `packages/services/recipe-service/src/recipes/domain/visibilityPolicy.ts`                                                                                                                                                          |
| Private recipes. Free holds up to 50, paid plans no limit                               | 001-FR-003, 010 register, ADR-0073 | C07           | Limited(50)   | Y   | Y           | PARTIAL | Slot check ships in `visibilityPolicy.ts` and `features/recipes/src/actions/useGatedPrivate.ts`. Pro is granted only by a role today (`packages/services/identity/src/users/domain/paidFeatureAccess.ts`). No purchase path exists |
| Drafts are owner-only and use no private slot                                           | 001-FR-003b                        | C07           | Y             | Y   | Y           | SHIPPED | `packages/services/recipe-service/src/recipes/domain/versionPolicy.ts`                                                                                                                                                             |
| Private `imported_public` recipe after a substantive edit                               | 001-FR-003, ADR-0073 §1            | C07           | N             | Y   | Y           | SPECCED | Register row. Gate shape exists in `visibilityPolicy.ts`                                                                                                                                                                           |
| "PRO" badge on recipes that use a Pro-only capability                                   | 001-FR-003a                        | none          | Y             | Y   | Y           | SHIPPED | `packages/apps/commise/features/recipes/src/card/model.ts`                                                                                                                                                                         |
| View public recipes                                                                     | 001-FR-004                         | C08           | Y             | Y   | Y           | SHIPPED | `packages/apps/commise/web/src/app/[locale]/discover/page.tsx`                                                                                                                                                                     |
| Clone a public recipe, with attribution and a substantive edit before publishing        | 001-FR-005 to FR-005d              | C08           | Y             | Y   | Y           | SHIPPED | `recipes.controller.ts` (`POST :id/clone`)                                                                                                                                                                                         |
| Search and filter by keyword, tag, cuisine, diet, ingredient, time                      | 001-FR-006                         | C09           | Y [Inference] | Y   | Y           | SHIPPED | `packages/services/recipe-service/src/search/search.controller.ts`. Inference: not named in FR-040, but part of using recipe CRUD and no gate exists in code                                                                       |
| Ingredients linked to real food data, plus freeform ingredients with own nutrition      | 001-FR-007, FR-007a                | C10, C20      | Y             | Y   | Y           | SHIPPED | `packages/services/food-service/src/foods/foods.controller.ts`                                                                                                                                                                     |
| Version history, view and restore                                                       | 001-FR-007b                        | C10           | Y [Inference] | Y   | Y           | SHIPPED | `packages/services/recipe-service/src/versions/versions.controller.ts`. Inference: not named in FR-040, no gate in code                                                                                                            |
| Edit-conflict detection across devices                                                  | 001-FR-007c                        | C10           | Y             | Y   | Y           | SHIPPED | `recipes.controller.ts` (version field, 409)                                                                                                                                                                                       |
| Collections: create, rename, delete, add, remove                                        | 001-FR-008, FR-009, FR-012         | C09           | Y [Inference] | Y   | Y           | SHIPPED | `packages/services/recipe-service/src/collections/collections.controller.ts`. Inference: not named in FR-040, no gate in code                                                                                                      |
| Collection visibility public or private                                                 | 001-FR-010                         | C09           | ?             | ?   | ?           | SHIPPED | `collections.controller.ts`. "?" because the FR says "subject to subscription tier rules" and the register has no collection row                                                                                                   |
| Clone a public collection                                                               | 001-FR-011                         | C08, C09      | Y             | Y   | Y           | SHIPPED | `collections.controller.ts` (`POST :id/clone`, `pull-from-source`)                                                                                                                                                                 |
| Star ratings 1 to 5 with average and count                                              | 001-FR-013 to FR-013b              | C08           | Y [Inference] | Y   | Y           | SHIPPED | `packages/services/recipe-service/src/ratings/ratings.controller.ts`. Inference: not named in FR-040, no gate in code                                                                                                              |
| Home screen as a widget surface                                                         | 001-FR-046                         | none          | Y             | Y   | Y           | PARTIAL | `packages/apps/commise/features/core/src/roadmapWidgets.ts`. Unbuilt features show as skeletons                                                                                                                                    |
| Web and mobile app with feature parity                                                  | 001-FR-044, FR-044a                | C25           | Y             | Y   | Y           | SHIPPED | `packages/apps/commise/web` (Next.js), `packages/apps/commise/mobile` (Expo, iOS and Android in `app.config.ts`)                                                                                                                   |
| Sign-in required for everything, no anonymous use                                       | 001-FR-045, FR-045a                | none          | Y             | Y   | Y           | SHIPPED | `packages/apps/commise/web/src/app/[locale]/sign-in`                                                                                                                                                                               |
| User-authored foods with macros, private until promoted                                 | ADR-0029                           | C20           | Y [Inference] | Y   | Y           | SHIPPED | `foods.controller.ts` (`POST authored`). Inference: register silent, no gate in code                                                                                                                                               |
| Per-user settings (view mode, search shortcut)                                          | ADR-0059                           | none          | Y             | Y   | Y           | SHIPPED | `packages/services/identity/src/settings/settings.controller.ts`                                                                                                                                                                   |

### 002 User auth

| Capability                                                      | Spec + FR                    | Checklist row | Free | Pro | Pro with AI | Status  | Path evidence or note                                                      |
| --------------------------------------------------------------- | ---------------------------- | ------------- | ---- | --- | ----------- | ------- | -------------------------------------------------------------------------- |
| Email and password sign-in, Google social login, password reset | 002-FR-001 to FR-012, FR-027 | none          | Y    | Y   | Y           | SHIPPED | Clerk. `packages/apps/commise/web/src/app/[locale]/sign-in`                |
| Profile page and account edit (name, avatar)                    | 002-FR-018 to FR-021         | none          | Y    | Y   | Y           | SHIPPED | `packages/services/identity/src/users/avatarUpload.controller.ts`          |
| Account close and GDPR erase                                    | 002-FR-022 to FR-026         | none          | Y    | Y   | Y           | SHIPPED | `packages/apps/commise/features/account/src/danger/AccountEraseDialog.tsx` |
| Link and unlink social accounts                                 | 002-FR-032 to FR-034         | none          | Y    | Y   | Y           | ?       | Not checked in code                                                        |

### 003 USDA food data (ingredient matching)

| Capability                                                              | Spec + FR                              | Checklist row | Free          | Pro | Pro with AI | Status  | Path evidence or note                                                                                                                        |
| ----------------------------------------------------------------------- | -------------------------------------- | ------------- | ------------- | --- | ----------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Ingredient catalog from USDA, searched locally, with nutrients per food | 003-FR-001 to FR-010a                  | C20, none     | Y [Inference] | Y   | Y           | SHIPPED | `packages/services/food-service/src/foods/foods.controller.ts`. Inference: shared reference data for every cook (003-FR-039)                 |
| Add a missing food by name, live remote USDA search                     | 003-FR-005, FR-011 to FR-027, ADR-0055 | none          | Y [Inference] | Y   | Y           | SHIPPED | `packages/services/remote-search`                                                                                                            |
| Pick the right food when a name is ambiguous                            | 003-FR-RES-2                           | none          | Y [Inference] | Y   | Y           | SHIPPED | `packages/apps/commise/features/recipes/src/detail/AmbiguityReview.tsx`                                                                      |
| Parse and match checks (CRF parser plus LLM review)                     | ADR-0071, ADR-0072, register           | none          | Y             | Y   | Y           | SHIPPED | `packages/services/ingredient-parser`, `packages/services/recipe-workers/src/handlers/verifyLine.ts`. Register: every plan, not a credit use |

### 004 Recipe importing

| Capability                                                                               | Spec + FR                           | Checklist row | Free                       | Pro                          | Pro with AI                  | Status  | Path evidence or note                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | ----------------------------------- | ------------- | -------------------------- | ---------------------------- | ---------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import from a recipe web page URL, with a source rights check (public, private or block) | 004-FR-008, FR-010, FR-011, FR-023  | C01           | Y                          | Y                            | Y                            | SPECCED | Register: every import channel on every plan. No URL import code found. The rights check "is not designed yet" (004-FR-008 ruling)                                                                                                                                                                                                  |
| Instagram caption import                                                                 | 004-FR-009                          | C02           | Y                          | Y                            | Y                            | BLOCKED | Gated on a Meta app approval (D-002). 017-FR-009 replaces the gate with user-initiated capture                                                                                                                                                                                                                                      |
| Paste a recipe's text as an import method                                                | 004-FR-052                          | C01, C10      | Y                          | Y                            | Y                            | PARTIAL | Only "Paste a list" of ingredient lines into the editor ships: `packages/apps/commise/features/recipes/src/form/PasteListSheet.tsx`, `packages/services/recipe-service/src/recipes/parseJobs.controller.ts`. Paste limit 200 a rolling day (004-FR-022)                                                                             |
| Import from a JSON, YAML or Markdown file                                                | 004-FR-019                          | C05           | Y                          | Y                            | Y                            | SPECCED | No file import code found                                                                                                                                                                                                                                                                                                           |
| Ingredient line parsing into quantity, unit, food                                        | 004-FR-020, FR-021                  | C10           | Y                          | Y                            | Y                            | SHIPPED | `packages/shared/recipe-import-core`, `packages/services/ingredient-parser`                                                                                                                                                                                                                                                         |
| Import-method chooser on web and mobile                                                  | 004-FR-046                          | C04           | Y                          | Y                            | Y                            | SPECCED | No chooser code found                                                                                                                                                                                                                                                                                                               |
| Bulk import of a file of up to 1,000 recipes, per-recipe outcome and statement           | 004-FR-026, FR-027, ADR-0072        | C05           | Limited(200 a rolling day) | Limited(1,000 a rolling day) | Limited(1,000 a rolling day) | PARTIAL | Schema, migrations and allowance policy are in this tree (`packages/schemas/recipe/src/schemas/import.schema.ts`, `packages/services/recipe-service/src/common/importAllowancePolicy.ts`). The controller is only on branch `fix/im-b3` (`packages/services/recipe-service/src/import/import.controller.ts`). Owner parked it there |
| Non-public import channels never need Pro, but use private slots                         | 004-FR-028                          | C07           | Y                          | Y                            | Y                            | PARTIAL | Slot rule ships. The channels themselves are not built                                                                                                                                                                                                                                                                              |
| Daily import quota with reset time, OCR sub-quota                                        | 004-FR-022                          | C06           | Y                          | Y                            | Y                            | PARTIAL | Ledger table ships (`0058_import_allowance_events.sql`). OCR sub-quota number: "?" (not stated in 004 or 011)                                                                                                                                                                                                                       |
| Attribution shown, paywalled sources refused, imported recipe kept if source deleted     | 004-FR-010, FR-014, FR-014a, FR-017 | C01           | Y                          | Y                            | Y                            | SPECCED | Depends on URL import                                                                                                                                                                                                                                                                                                               |

### 005 AI integration

| Capability                                                                            | Spec + FR                            | Checklist row | Free                | Pro       | Pro with AI                      | Status  | Path evidence or note                                                                          |
| ------------------------------------------------------------------------------------- | ------------------------------------ | ------------- | ------------------- | --------- | -------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| AI recipe generation from criteria, preview, regenerate, sanity checks, guard message | 005-FR-016, FR-017, FR-022 to FR-024 | C22           | Credits (3 a month) | BYOK only | Credits (300 a month), then BYOK | SPECCED | No generation code found. Launch plan puts 005 in 1.0, not beta                                |
| AI instruction optimization                                                           | 005-FR-019                           | C22           | Credits (3 a month) | BYOK only | Credits (300 a month), then BYOK | SPECCED | Register row                                                                                   |
| Own AI keys, several providers, cook-set order                                        | 005-FR-015, FR-015b                  | C23           | N                   | Y         | Y (after the allowance)          | SPECCED | Never Free (005-FR-015)                                                                        |
| Monthly AI allowance, reset on billing date, no rollover, 100 uses in trial           | 005-FR-015a, FR-015c to FR-015f      | C23           | 3 uses              | 0 uses    | 300 uses                         | SPECCED | Free amount reviewed at 90 days after launch, cut to 0 or raised to 5 (005-FR-015d)            |
| External AI agent API (ChatGPT, Gemini) with OAuth consent, read and write            | 005-FR-018, FR-020, FR-021           | C22           | Y [Inference]       | Y         | Y                                | SPECCED | Inference: 005 tags no plan on FR-018, and the agent uses no platform AI, so no credit applies |

### 006 Meal planning

| Capability                                                          | Spec + FR                            | Checklist row | Free                | Pro       | Pro with AI           | Status  | Path evidence or note                                                    |
| ------------------------------------------------------------------- | ------------------------------------ | ------------- | ------------------- | --------- | --------------------- | ------- | ------------------------------------------------------------------------ |
| Meal plans over a date range, assign, move, remove recipes per slot | 006-FR-022, FR-022a, FR-023, FR-023a | C13           | Y                   | Y         | Y                     | SPECCED | FR-040 manual meal planning. Roadmap capability only (`capabilities.ts`) |
| Per-day and whole-plan nutrition totals                             | 006-FR-024                           | C20, C21      | Y                   | Y         | Y                     | SPECCED | Part of manual meal planning                                             |
| Plan templates, save and apply                                      | 006-FR-028, FR-028a                  | C13           | Y                   | Y         | Y                     | SPECCED | Part of manual meal planning                                             |
| Servings and notes per entry                                        | 006-FR-030, FR-031                   | C13           | Y                   | Y         | Y                     | SPECCED | Part of manual meal planning                                             |
| AI meal suggestions for one slot                                    | 006-FR-025                           | C14, C22      | Credits (3 a month) | BYOK only | Credits (300 a month) | SPECCED | Register row. Blocked on 005 and 010                                     |
| Auto-generated full meal plan                                       | 006-FR-026                           | C14           | N                   | N         | Credits               | SPECCED | Pro with AI only (register, 005-FR-015f)                                 |
| Food-waste optimization across a plan                               | 006-FR-027                           | C15           | N                   | N         | Credits               | SPECCED | Pro with AI only (register, 005-FR-015f)                                 |

### 007 Grocery lists

| Capability                                                          | Spec + FR                                | Checklist row | Free | Pro | Pro with AI | Status  | Path evidence or note                                   |
| ------------------------------------------------------------------- | ---------------------------------------- | ------------- | ---- | --- | ----------- | ------- | ------------------------------------------------------- |
| Grocery list from a meal plan, duplicates merged, quantities summed | 007-FR-028                               | C17           | Y    | Y   | Y           | SPECCED | FR-040 grocery list generation. Roadmap capability only |
| Mark items "already have", remembered 7 days                        | 007-FR-029, 007 plan `user_pantry_items` | C16           | Y    | Y   | Y           | SPECCED | A light pantry flag, not inventory tracking             |
| Shopping Lists page, standalone lists, link to and from meal plans  | 007-FR-032, FR-033                       | C17           | Y    | Y   | Y           | SPECCED | Part of grocery list generation                         |
| Online grocery ordering through store adapters                      | 007-FR-030, FR-031                       | C19           | N    | N   | N           | SPECCED | No plan until a store partner exists (register)         |

### 008 Cooking mode

| Capability                                | Spec + FR          | Checklist row | Free | Pro | Pro with AI | Status  | Path evidence or note                                                                                                                               |
| ----------------------------------------- | ------------------ | ------------- | ---- | --- | ----------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step-by-step large view, forward and back | 008-FR-032, FR-033 | C12           | Y    | Y   | Y           | SPECCED | FR-040 cooking mode. `cookingSession` is a roadmap capability. The recipe detail marks the current step (`features/recipes/src/detail/StepRow.tsx`) |
| Countdown timers per step                 | 008-FR-034         | C12           | Y    | Y   | Y           | PARTIAL | Only a timer label ships (`stepTimerLabel` in `features/recipes/src/detail/model.ts`). No countdown found                                           |
| Keep the screen awake                     | 008-FR-035         | C12           | Y    | Y   | Y           | SHIPPED | `packages/apps/commise/features/recipes/src/detail/RecipeDetailView.tsx` (`useKeepAwake`)                                                           |

### 009 Nutrition planning

| Capability                                              | Spec + FR  | Checklist row | Free                | Pro       | Pro with AI           | Status  | Path evidence or note                                                            |
| ------------------------------------------------------- | ---------- | ------------- | ------------------- | --------- | --------------------- | ------- | -------------------------------------------------------------------------------- |
| Nutrition plans with daily calorie and macro targets    | 009-FR-036 | C21           | Y [Inference]       | Y         | Y                     | SPECCED | Inference: FR-040 does not list it. 009 tags only FR-038 as Pro and FR-039 as AI |
| Link meal plans to nutrition plans, compliance analysis | 009-FR-037 | C21           | Y [Inference]       | Y         | Y                     | SPECCED | Same reason as FR-036                                                            |
| Trainer creates nutrition plans for clients             | 009-FR-038 | C21           | N                   | Y         | Y                     | SPECCED | Register row                                                                     |
| AI recipe swaps toward nutrition targets                | 009-FR-039 | C21, C22      | Credits (3 a month) | BYOK only | Credits (300 a month) | SPECCED | Register row, marked inferred there                                              |

### 010 Subscriptions

| Capability                                            | Spec + FR              | Checklist row | Free | Pro                            | Pro with AI                      | Status  | Path evidence or note                                                                                |
| ----------------------------------------------------- | ---------------------- | ------------- | ---- | ------------------------------ | -------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| Three plans, monthly or yearly                        | 010-FR-041, FR-041a    | C28           | $0   | $9.99 a month or $99.99 a year | $19.99 a month or $199.99 a year | SPECCED | No billing code found. The subscription page stays hidden until 010 ships (010-FR-042j)              |
| 14-day trial, one per person ever, card required      | 010-FR-041h            | C28           | n/a  | Y                              | Y (100 uses)                     | SPECCED |                                                                                                      |
| Honest subscription page, cancel as easy as subscribe | 010-FR-042a to FR-042i | C28           | n/a  | Y                              | Y                                | SPECCED | Mobile billing route is open (O-9)                                                                   |
| Lapse keeps data and private recipes, 7-day grace     | 010-FR-043, FR-043a    | C07           | n/a  | Y                              | Y                                | SPECCED |                                                                                                      |
| Plan readable by every service as a signed claim      | 010-FR-044             | none          | n/a  | Y                              | Y                                | PARTIAL | A role-based paid gate ships (`paidFeatureAccess.ts`). Three-plan entitlement does not (010-FR-041b) |

### 011 Recipe digitization

| Capability                                                             | Spec + FR                    | Checklist row | Free | Pro | Pro with AI | Status  | Path evidence or note                                                                                                 |
| ---------------------------------------------------------------------- | ---------------------------- | ------------- | ---- | --- | ----------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| Photo capture of cookbook pages and cards, up to 20 photos, multi-page | 011-FR-001 to FR-005         | C03           | Y    | Y   | Y           | SPECCED | Register: every import channel. Each kept recipe is private, so a Free cook spends a slot (004-FR-028). No code found |
| OCR incl. handwriting, per-token confidence                            | 011-FR-006 to FR-013         | C03           | Y    | Y   | Y           | SPECCED | Textract named as default                                                                                             |
| Side-by-side correction screen, accept all                             | 011-FR-014 to FR-018         | C03           | Y    | Y   | Y           | SPECCED |                                                                                                                       |
| Digitized recipe created private with attribution                      | 011-FR-021, FR-021a, FR-021b | C07           | Y    | Y   | Y           | SPECCED |                                                                                                                       |
| Circles: share a private recipe read-only with a group by invite link  | 011-FR-031 to FR-035         | C18           | Y    | Y   | Y           | SPECCED | FR-040 covers sharing. No code found                                                                                  |

### 012 Creator profiles

| Capability                                                                         | Spec + FR                              | Checklist row | Free | Pro | Pro with AI | Status  | Path evidence or note                                                                                                                                                   |
| ---------------------------------------------------------------------------------- | -------------------------------------- | ------------- | ---- | --- | ----------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public `@handle` profile page with bio, avatar, follower count, public collections | 012-FR-001 to FR-009, FR-017 to FR-019 | C26           | ?    | ?   | ?           | SPECCED | "?" because the register and FR-040 are silent and 012 names no plan. Author handles and bylines exist (`features/recipes/src/byline/bylineOf.ts`), but no profile page |
| Follow creators, new recipes in a feed                                             | 012-FR-013 to FR-016                   | C08, C26      | ?    | ?   | ?           | SPECCED | Same reason. 010 says there are no paid follows                                                                                                                         |
| Creator analytics, embed widget                                                    | 012-FR-023 to FR-027                   | C26           | ?    | ?   | ?           | SPECCED | Same reason                                                                                                                                                             |
| Tip jar and earnings view                                                          | 012-FR-031 to FR-034                   | C26           | ?    | ?   | ?           | BLOCKED | DRAFT. Needs marketplace payments, which 010 puts out of scope                                                                                                          |

### 013 Cooking school

| Capability                                               | Spec + FR                              | Checklist row | Free | Pro | Pro with AI | Status  | Path evidence or note                                                                                                                                                   |
| -------------------------------------------------------- | -------------------------------------- | ------------- | ---- | --- | ----------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paid video courses, free first lesson, progress tracking | 013-FR-001 to FR-008, FR-011 to FR-014 | C26           | ?    | ?   | ?           | SPECCED | Bought per course, outside the three plans. "?" because the register is silent. 013-FR-010 names a "pro tier" educator split (15%/85%) that the register does not carry |
| Educator revenue share                                   | 013-FR-010                             | C26           | ?    | ?   | ?           | BLOCKED | Blocked on marketplace payments. 018 settles the split                                                                                                                  |

### 014 Notification service

| Capability                                              | Spec + FR                            | Checklist row | Free          | Pro | Pro with AI | Status  | Path evidence or note                                                      |
| ------------------------------------------------------- | ------------------------------------ | ------------- | ------------- | --- | ----------- | ------- | -------------------------------------------------------------------------- |
| In-app, push and email notifications to a user or group | 014-FR-001 to FR-012, launch plan M8 | none          | Y [Inference] | Y   | Y           | SPECCED | Inference: platform plumbing with no plan logic. No publish endpoint found |

### 015 Publishing rewards

| Capability                                                 | Spec + FR                     | Checklist row | Free | Pro | Pro with AI | Status  | Path evidence or note                                                                            |
| ---------------------------------------------------------- | ----------------------------- | ------------- | ---- | --- | ----------- | ------- | ------------------------------------------------------------------------------------------------ |
| Earn extra private slots by publishing authored recipes    | 015-FR-001 to FR-007d, FR-010 | C07           | Y    | n/a | n/a         | STOPPED | Earned slots add to the base of 50 (ADR-0073). Free accounts only (015-FR-007c). Owner stop line |
| Recognition: cook signal, milestones, contributor standing | 015-FR-007e to FR-007n        | C26           | Y    | Y   | Y           | STOPPED | Same on every plan (015-FR-007n). No cook telemetry exists yet                                   |

### 016 Legal compliance framework

| Capability                                                                                                            | Spec + FR         | Checklist row | Free          | Pro | Pro with AI | Status  | Path evidence or note                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------- | ------------- | --- | ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terms acceptance, content licence, report and takedown, appeals, data rights, AI disclosure, subscription disclosures | 016 groups A to J | none          | Y [Inference] | Y   | Y           | SPECCED | Inference: legal protections apply to every user. A data-sources page ships (`packages/apps/commise/web/src/app/[locale]/legal/sources/page.tsx`). No terms, takedown or AI-marking code found |

### 017 ReciMe parity (delta spec)

| Capability                                                                                                                                | Spec + FR                   | Checklist row | Free                       | Pro                          | Pro with AI                  | Status  | Path evidence or note                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------- | -------------------------- | ---------------------------- | ---------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import from TikTok, Instagram Reels, YouTube, Facebook video (5-tier waterfall: caption, transcript, on-screen text, visual, source page) | 017-FR-001 to FR-011b       | C02           | Y                          | Y                            | Y                            | SPECCED | Register: every import channel. Whether a video import uses AI credits: "?" (FR-041d exempts only parse and match). Needs platform-managed inference (017-FR-037) and costing |
| Share-sheet capture on iOS and Android                                                                                                    | 017-FR-012, FR-013, FR-013a | C04           | Y                          | Y                            | Y                            | SPECCED | Needs 014 to say the draft is ready                                                                                                                                           |
| Desktop browser extension, `activeTab` only                                                                                               | 017-FR-014, FR-015          | C04           | Y                          | Y                            | Y                            | SPECCED |                                                                                                                                                                               |
| Import libraries from Paprika, AnyList, Copy Me That, ReciMe                                                                              | 017-FR-016, FR-017          | C05           | Limited(200 a rolling day) | Limited(1,000 a rolling day) | Limited(1,000 a rolling day) | SPECCED | Runs on the bulk import allowance. Route is open question OQ-P1                                                                                                               |
| Export the whole library as a lossless file, from a product screen                                                                        | 017-FR-018, FR-020          | C05           | Y                          | Y                            | Y                            | PARTIAL | API only: `GET /api/v1/account/export` in `packages/services/recipe-service/src/account/account.controller.ts`. No app screen calls it                                        |
| Export a recipe, collection or library as a readable document (PDF)                                                                       | 017-FR-019                  | C05           | Y                          | Y                            | Y                            | SPECCED |                                                                                                                                                                               |
| Multiple labelled timers, ingredients per step, dim without sleep, voice hands-free                                                       | 017-FR-021 to FR-024        | C12           | Y                          | Y                            | Y                            | SPECCED | FR-040 cooking mode                                                                                                                                                           |
| Recipe detail and cooking mode usable offline after first open                                                                            | 017-FR-025                  | C24           | Y                          | Y                            | Y                            | SPECCED | Superseded in practice by 019                                                                                                                                                 |
| Metric and imperial view toggle                                                                                                           | 017-FR-026                  | C11           | Y [Inference]              | Y                            | Y                            | SPECCED | Inference: display-only, no plan named. No unit setting in `settings.schema.ts`                                                                                               |
| Dark theme, OS default plus manual override                                                                                               | 017-FR-027                  | none          | Y                          | Y                            | Y                            | PARTIAL | Follows the OS setting (`packages/apps/commise/ui/src/tokens/themeCss.ts`). No manual override found                                                                          |
| Grocery list grouped by aisle, custom aisles and order                                                                                    | 017-FR-028, FR-029          | C17           | Y                          | Y                            | Y                            | SPECCED | Part of grocery list generation                                                                                                                                               |
| Household: members share meal plans and grocery lists, live check-off                                                                     | 017-FR-030 to FR-033        | C18           | ?                          | ?                            | ?                            | SPECCED | "?" because 017-FR-034 bounds members by a paid seat count, while 010 Assumptions say a family plan is out of scope for v1, and the register has no seat row                  |
| Seat count on a subscription                                                                                                              | 017-FR-034                  | C18, C28      | ?                          | ?                            | ?                            | SPECCED | Same conflict                                                                                                                                                                 |
| Scale servings                                                                                                                            | 017-FR-035                  | C11           | Y [Inference]              | Y                            | Y                            | SHIPPED | `packages/apps/commise/features/recipes/src/detail/servingScale.ts`. Inference: no gate in code                                                                               |
| Check off ingredients while cooking                                                                                                       | 017-FR-036                  | C12           | Y                          | Y                            | Y                            | SHIPPED | `packages/apps/commise/features/recipes/src/detail/IngredientCheckRow.tsx`                                                                                                    |
| Platform-managed AI by default                                                                                                            | 017-FR-037, FR-039          | C23           | Y                          | Y                            | Y                            | SPECCED | Matches the allowance model in 005-FR-015a                                                                                                                                    |

### 018 Chef program and marketplace

| Capability                                                                            | Spec + FR           | Checklist row | Free | Pro | Pro with AI | Status  | Path evidence or note                                           |
| ------------------------------------------------------------------------------------- | ------------------- | ------------- | ---- | --- | ----------- | ------- | --------------------------------------------------------------- |
| Apply to the Chef Program, chef page and discovery                                    | 018 groups A and B  | C26           | ?    | ?   | ?           | SPECCED | "?" because the register is silent. 3 owner clarifications open |
| Purchase a chef's recipe (the sold version, with a file to keep), subscribe to a chef for updates, or buy a course, with platform commission | 018-FR-029, FR-029h, group E | C26 | ? | ? | ? | SPECCED | Bought per item or by subscription, outside the plans. Model amended 2026-11-03, ADR-0082 §9 |
| No display ads at v1                                                                  | 018 C-018-003       | C27           | N    | N   | N           | SPECCED | Free-visitor revenue mechanism still open (C-018-003)           |

### 019 Offline mode

| Capability                                                                     | Spec + FR            | Checklist row | Free          | Pro | Pro with AI | Status  | Path evidence or note                                                                                                                                                              |
| ------------------------------------------------------------------------------ | -------------------- | ------------- | ------------- | --- | ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A running app keeps working offline, changes wait in an outbox, offline notice | 019-FR-008 to FR-021 | C24           | Y [Inference] | Y   | Y           | PARTIAL | `packages/shared/sync/src/outboxStore.ts`, `packages/apps/commise/mobile/src/storage/outboxStore.ts`. Inference from 019-FR-026 (every cook, no paid tier). The register is silent |
| Open the app with no network (offline start), web and mobile                   | 019-FR-001 to FR-007 | C24           | Y [Inference] | Y   | Y           | BLOCKED | Turned off per ADR-0069 (reconnect stuck 2 of 3 runs). Open owner question OQ-1 on how the app opens offline                                                                       |

### 020 Content source check

| Capability                                                                           | Spec + FR         | Checklist row | Free | Pro | Pro with AI | Status  | Path evidence or note                                      |
| ------------------------------------------------------------------------------------ | ----------------- | ------------- | ---- | --- | ----------- | ------- | ---------------------------------------------------------- |
| Automated check before a recipe goes public, staff review when not all green, appeal | 020 FRs, ADR-0074 | C08           | Y    | Y   | Y           | SPECCED | Register: every plan, not a credit use. No hold code found |

## (b) Per-row summary for Commise (launch offering)

Values use the checklist tokens. "Beta" says whether the current tree has it.

| Row                                     | Free                                                  | Pro                                           | Pro with AI                                                | Note (spec, beta state)                                                                                                                                                                                                 |
| --------------------------------------- | ----------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 URL import                          | Y                                                     | Y                                             | Y                                                          | 004-FR-008. Not built. Beta lacks it                                                                                                                                                                                    |
| C02 Social video import                 | Y                                                     | Y                                             | Y                                                          | 017-FR-001 to FR-011b. Instagram caption path gated (004-FR-009). Not built                                                                                                                                             |
| C03 Photo or scan, OCR                  | Y                                                     | Y                                             | Y                                                          | 011. Handwriting included. Recipe is private, so Free spends one of 50 slots. Not built                                                                                                                                 |
| C04 Extension, share sheet              | Y                                                     | Y                                             | Y                                                          | 017-FR-012 to FR-015. Not built                                                                                                                                                                                         |
| C05 Bulk import and export              | Limited(200 a day)                                    | Limited(1,000 a day)                          | Limited(1,000 a day)                                       | Bulk file up to 1,000 recipes (004-FR-026). Migration from Paprika, AnyList, Copy Me That, ReciMe (017-FR-016). Export Y on all plans (017-FR-018 to FR-020). Bulk backend is on branch `fix/im-b3`. Export is API only |
| C06 Free-plan cap                       | No library cap                                        | No cap                                        | No cap                                                     | Public unlimited. Private Limited(50) on Free. Paste 200 a rolling day. Bulk 200 a rolling day on Free, 1,000 on paid                                                                                                   |
| C07 Private storage                     | Limited(50)                                           | Y                                             | Y                                                          | 001-FR-003, ADR-0073. Shipped. 015 would add earned slots for Free (stopped)                                                                                                                                            |
| C08 Public catalog, discovery           | Y                                                     | Y                                             | Y                                                          | Discover, public read, clone, ratings shipped. Creator follow feed (012) not built                                                                                                                                      |
| C09 Collections, tags, search           | Y                                                     | Y                                             | Y                                                          | Shipped. Collection visibility by plan is "?" (001-FR-010)                                                                                                                                                              |
| C10 Manual entry and editing            | Y                                                     | Y                                             | Y                                                          | Shipped, with version history and conflict detection                                                                                                                                                                    |
| C11 Scaling and unit conversion         | Y                                                     | Y                                             | Y                                                          | Scaling shipped. Metric and imperial toggle not built (017-FR-026)                                                                                                                                                      |
| C12 Cooking mode                        | Y                                                     | Y                                             | Y                                                          | Shipped on recipe detail: keep-awake, ingredient check-off, current-step mark, timer label. Not built: step-by-step mode, countdown and multiple timers, ingredients per step, voice                                    |
| C13 Manual meal planner                 | Y                                                     | Y                                             | Y                                                          | 006. Not built                                                                                                                                                                                                          |
| C14 Auto or AI meal plans               | Limited(3 uses a month, single-slot suggestions only) | N (single-slot suggestions with own key only) | Paid (300 uses a month)                                    | Full auto plans are Pro with AI only (006-FR-026). Not built                                                                                                                                                            |
| C15 Food-waste or pantry-aware planning | N                                                     | N                                             | Paid                                                       | Food-waste optimization is Pro with AI only (006-FR-027). Not built                                                                                                                                                     |
| C16 Pantry tracking                     | Limited                                               | Limited                                       | Limited                                                    | Only an "already have" flag kept 7 days (007-FR-029). No inventory. Not built                                                                                                                                           |
| C17 Grocery list from recipes           | Y                                                     | Y                                             | Y                                                          | Merge duplicates (007-FR-028), aisle grouping and custom aisles (017-FR-028, FR-029). Not built                                                                                                                         |
| C18 Shared list, household sync         | ?                                                     | ?                                             | ?                                                          | Household and live shared lists (017 D18, FR-030 to FR-033). Plan "?" (seat count vs no family plan in v1). Circles recipe sharing is Y on all plans (011). Not built                                                   |
| C19 Online grocery ordering             | N                                                     | N                                             | N                                                          | No plan until a store partner exists (007-FR-030, FR-031, register)                                                                                                                                                     |
| C20 Nutrition per recipe                | Y                                                     | Y                                             | Y                                                          | Shipped on recipe detail (`NutritionFigure.tsx`), from USDA data. Plan inferred, no gate in code                                                                                                                        |
| C21 Nutrition goals, diet plans         | Y                                                     | Y                                             | Y                                                          | Own targets and compliance on all plans [Inference] (009-FR-036, FR-037). Trainer plans for clients are Pro and Pro with AI only (009-FR-038). Not built                                                                |
| C22 AI assistant and AI recipe changes  | Limited(3 uses a month)                               | BYOK only                                     | Limited(300 uses a month), then BYOK                       | Generation, instruction optimization, meal suggestions, swaps (005, 006, 009). Not built                                                                                                                                |
| C23 How AI is priced                    | Small free allowance                                  | Bring your own key                            | Separate AI tier with usage allowance, then own key        | 005-FR-015 to FR-015f. Parse, match and source checks are never a use                                                                                                                                                   |
| C24 Offline                             | Y                                                     | Y                                             | Y                                                          | 019-FR-026 (every cook). Partial: running app works offline with an outbox. Offline start off (ADR-0069, OQ-1)                                                                                                          |
| C25 Platforms                           | Web, iOS, Android                                     | Web, iOS, Android                             | Web, iOS, Android                                          | 001-FR-044. Mac and Windows only through the web app. Store availability "?" (not checked)                                                                                                                              |
| C26 Creators, tipping, courses          | ?                                                     | ?                                             | ?                                                          | 012 profiles, 013 paid courses, 018 chef sales, 015 recognition. All specced or stopped. Tips blocked on marketplace payments                                                                                           |
| C27 Ads on Free                         | N                                                     | N                                             | N                                                          | No spec puts ads on Free. 018 excludes display ads at v1                                                                                                                                                                |
| C28 Price and trial                     | $0                                                    | $9.99 a month, $99.99 a year, 14-day trial    | $19.99 a month, $199.99 a year, 14-day trial with 100 uses | One trial per person ever, card required (010-FR-041h). No one-time or lifetime plan (017 D23 deferred). Billing not built. Mobile billing route open (O-9)                                                             |

### Commise capabilities that fit no row

- Ingredient matching to the USDA catalog, with live remote search and an ambiguity picker (003, ADR-0055). Shipped.
- Two-engine ingredient parsing (CRF plus LLM) on every plan, not a credit use (ADR-0026, ADR-0071). Shipped.
- User-authored foods with their own macros (ADR-0029). Shipped.
- Recipe version history and restore (001-FR-007b). Shipped.
- Star ratings (001-FR-013). Shipped. Could also count toward C08.
- Account close and GDPR erase, data export API (002, 017-FR-018). Shipped.
- Dark theme (017-FR-027). Partial.
- External AI agent access through OAuth consent (005-FR-018). Specced.
- Notifications (014). Specced.
- Nutrition planning for trainers and clients (009-FR-038). Specced. Partly C21.
- Recipe digitization pipeline and Circles group sharing (011). Specced. Partly C03 and C18.
- Creator profiles (012), cooking school (013), chef marketplace (018). Specced. Partly C26.
- Publishing rewards (015). Stopped at the owner stop line.
- Legal framework: terms, content licence, takedown, data rights, AI disclosure (016). Specced.
- Content source check before a recipe goes public (020). Specced.

### Specific checks

- **Social video import (017 D1).** Specced for TikTok, Instagram Reels, YouTube and Facebook. Not shipped. No code
  found for any platform. It needs platform-managed inference and a cost model first (017 Dependencies).
- **Browser extension.** Specced (017-FR-014), desktop, `activeTab` only. Not shipped.
- **Cookbook photo and OCR (011).** Specced, handwriting included. Not shipped. 004 shows it as "unavailable until
  011" (004-FR-012).
- **Household sharing (017 D18).** Specced. Not shipped. Plan "?" because of the seat-count conflict with 010.
- **Offline (019).** Partial. A running app works offline. Offline start is off and blocked on OQ-1.
- **Pantry.** Only a 7-day "already have" flag in 007. No pantry inventory anywhere. Not shipped.
- **Nutrition per recipe (003, 009).** Shipped on recipe detail. Meal-plan totals (006-FR-024) and goals (009) are
  specced only.
- **Export (017 D14 and D15 in the spec's own table).** The task names D15. In 017, D14 is export and D15 is
  migration importers. Export ships as an API only. PDF export and importers are specced only.
- **Platforms.** Web (Next.js) plus iOS and Android (one Expo app). No native Mac or Windows app.

## (c) What beta lacks vs launch

Beta is the end of M4 in `specs/v1-launch-plan.md`. 1.0 is the end of M6.

**1. Scoped for beta in the launch plan, but not built in this tree**

- 004 importing: URL import, file import, import chooser, Instagram caption, full recipe-text paste. Only "Paste a
  list" of ingredients ships. Bulk import is parked on branch `fix/im-b3`.
- 006 meal planning: the whole planner, templates and plan nutrition totals.
- 007 grocery lists: lists, merged quantities, "already have", Shopping Lists page.
- 008 cooking mode: the step-by-step mode and countdown timers. Keep-awake, check-off and a timer label do ship.
- 011 recipe digitization: photo capture, OCR, correction screen, Circles.

**2. Kept out of beta by the launch plan**

- 005 AI integration (1.0). So beta has no AI generation, no allowance and no own keys.
- 009 nutrition planning (1.0).
- 010 subscriptions (1.0). So beta has no paid plans and no prices. Pro can only be granted by a role today.
- 012 creator profiles, 013 cooking school (post-1.0, still v1).
- 014 notifications (post-1.0, still v1).

**3. Not in the launch plan at all (written after it)**

- 015 publishing rewards (stopped), 016 legal framework, 017 ReciMe parity (video import, share sheet, extension,
  importers, export screen, aisles, household, voice, unit toggle), 018 chef marketplace, 019 offline start, 020
  content source check.
- These are launch offerings under the 2026-10-27 ruling. Their beta placement is "?". The launch plan lists only
  001 to 014.

## (d) What Pro adds over Free, exactly

**Pro ($9.99 a month or $99.99 a year, 14-day trial):**

1. More than 50 private recipes, with no limit (001-FR-003, 010-FR-041, register).
2. A private `imported_public` recipe after a substantive edit (001-FR-003, ADR-0073 §1, register).
3. Trainer nutrition planning, making plans for other users (009-FR-038, register).
4. Own AI keys, several providers, in an order the cook sets (005-FR-015, register).
5. Bulk import of 1,000 recipes a rolling day instead of 200 (ADR-0072 §8, 004-FR-022, register).

**What Pro does not add.** Pro has fewer platform AI uses than Free. Free gets 3 uses a month. Pro gets 0, and its
AI runs only through the cook's own keys (005-FR-015c, FR-015f, register). Auto meal plans and food-waste
optimization are not on Pro, even with own keys (register, 005-FR-015f). Online grocery ordering is on no plan.
Every import channel, parse and match checks, offline and the content source check are the same on every plan.

**Pro with AI ($19.99 a month or $199.99 a year, 14-day trial) adds over Pro:**

1. 300 AI uses a month, reset on the billing date, 100 during the trial (005-FR-015a, FR-015c, 010-FR-041h).
2. Auto-generated meal plans (006-FR-026), only here.
3. Food-waste optimization (006-FR-027), only here.
4. Own keys used automatically after the allowance runs out, if the cook turns that on (005-FR-015b).
