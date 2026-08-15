# Cross-feature spec / plan / task coherence — PR #91 (branch `chore/code-quality-enforcement-phase-1-2`)

**Reviewer**: staff-architect (REVIEW mode, read-only)
**Date**: 2026-08-14
**Scope**: `specs/**` cross-feature coherence after this branch absorbed the 004 / 005 / 006 / 008 / 010 / 014
worktree specs and landed **ADR-0019** plus the **ADR-0017 amendment** (006 gets its own deployable).

## Governing decisions read before forming an opinion

- [`specs/governance-rules.md`](../../../specs/governance-rules.md) — GR-002, GR-003, GR-011, GR-014, GR-015,
  GR-016, GR-017, GR-019, GR-021 (rule text + Current-State ledgers).
- [`specs/cross-feature-FR-index.md`](../../../specs/cross-feature-FR-index.md) (whole file, 66 lines).
- [`specs/cross-feature-consistency-report.md`](../../../specs/cross-feature-consistency-report.md) (whole file, 664 lines).
- ADRs [0014](../../architecture/decisions/0014-service-owned-api-contracts.md),
  [0015](../../architecture/decisions/0015-input-validation-at-every-boundary.md),
  [0017](../../architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md) **including the
  2026-08-14 amendment (lines 225–262)**, [0018](../../architecture/decisions/0018-per-sender-webhook-dedup-tables.md),
  [0019](../../architecture/decisions/0019-recipe-import-spine.md) (whole file, 173 lines).

Three quotations bind most of what follows:

> **ADR-0019 §3** — "004 `D-001` is **superseded**: photo/OCR does not ship with 004. … The image branch routes to a
> **dedicated image-processing service that owns no database**. … **It holds no persistent state.**"

> **ADR-0017 Amendment (2026-08-14)** — "**006 gets its own deployable service and its own tables**, superseding the
> row for 006 in the Decision table above. 007, 009 and 010 are **unchanged**."

> **ADR-0003 / `packages/infra/alb`** — "Priorities come from ONE allocator … never from a per-service constant."

---

## F-S1

**Severity**: CRITICAL

**Files (both sides)**

- Says photo/OCR is **NOT** 004's: `specs/004-recipe-importing/spec.md:179-186` (`FR-012` "REASSIGNED TO 011"),
  `specs/004-recipe-importing/spec.md:578-600` (`D-001` "⛔ **SUPERSEDED 2026-08-14**"),
  `docs/architecture/decisions/0019-recipe-import-spine.md:74-76`.
- Says photo/OCR **IS** 004's, and ships at launch:
  `specs/004-recipe-importing/tasks.md:551` — "**T-018 · OCR channel** _(D-001 — P1, **ships at launch**; premium-only per D-014)_",
  `specs/004-recipe-importing/tasks.md:558` (`POST /import/photo` → 202, S3, Textract), `:44` (US-405 "Import from a
  photo of a physical copy"), `:69` (dependency graph `T-013 ──► T-018 OCR channel`), `:660` (mobile camera capture
  wired to T-018), `:666` (`import-photo-flow.yaml` Maestro), `:820` (T-018 P1/L in the estimate table);
  `specs/004-recipe-importing/plan.md:19` (`OcrProvider` → Textract port), `:216`
  (`POST /api/v1/recipes/import/photo`), `:350` (`@aws-sdk/client-textract` dependency), `:495` ("9. **OCR channel**
  (D-001): S3 upload, Textract adapter, image lifecycle deletion");
  `specs/004-recipe-importing/v-model/requirements.md:39` (**REQ-007**, rationale "Owner decision D-001 —
  physical-copy import ships at launch") and `:92` (**REQ-IF-002** "SHALL integrate with AWS Textract");
  `specs/004-recipe-importing/v-model/traceability-matrix.md:21` (REQ-007 → ATP-007-A → SCN-007-A1).

**What contradicts what**: 004's `spec.md` executed the channel-ownership transfer; its `plan.md`, `tasks.md` and the
entire V-Model layer did not. 004 still budgets, sequences, estimates and traces a Textract OCR channel that ADR-0019
moved to 011, and its V-Model still cites the _superseded clause of D-001_ as the requirement's own rationale.

**Why it matters**: `tasks.md` and `v-model/requirements.md` are what an implementer executes. Following them
rebuilds the exact duplicate ADR-0019 exists to prevent — a second `sourceType`/draft-confirm/recipe-creation path,
a second Textract dependency, and a second owner of `imported_physical`. It also re-creates the pre-ADR state in
which "whichever shipped second would have found the other already owning" the channel.

**Smallest fix**: Delete T-018 and its graph/estimate rows; strike `OcrProvider`/Textract from `plan.md`'s ports,
route table, dependency table and phase list; mark `REQ-007` and `REQ-IF-002` **SUPERSEDED → 011** in
`v-model/requirements.md` and in the traceability matrix row, exactly as `FR-012` already is in `spec.md:179`.
Keep `REQ-014`/`REQ-035` (they are the provenance/entitlement rules `spec.md:154-161` deliberately retains).

**Verified**: read all four 004 artifacts; `grep -n "Textract\|OCR\|photo"` across `tasks.md`/`plan.md`;
`grep -rln "FR-046\|FR-047\|FR-048" specs/004-recipe-importing/` returns **only** `spec.md`.

---

## F-S2

**Severity**: CRITICAL

**Files (both sides)**

- Stateless, no second recipe path: `specs/011-recipe-digitization/spec.md:65-73` ("A dedicated image-processing
  service that owns **NO database**… Images in flight live in object storage"), `:75-79` ("011 does **not** create its
  own path to a saved recipe — it submits extracted candidates to 004's **bulk import processor**… 011 MUST NOT build
  a second one"), `docs/architecture/decisions/0019-recipe-import-spine.md:84-90`.
- Stateful, with its own recipe-creation path: `specs/011-recipe-digitization/plan.md:171-172` (`digitization_jobs`
  table: `s3_key, state, raw_ocr_json, parsed_json, recipe_id, …`), `:197` (daily purge of
  `digitization_jobs.raw_ocr_json`), `:202-203` (two `digitization_jobs` indexes), `:413` ("Create `circles`,
  `circle_members`, `circle_invites`, **`digitization_jobs`**"), `:222` (`POST /api/v1/recipes/digitize/jobs/:id/save`
  → "Persist recipe + link `recipe_id`"), `:333` ("`…/save` persists a recipe");
  `specs/011-recipe-digitization/tasks.md:119` (**T-042** "endpoint **creating recipe** + linking `recipe_id` +
  version row append … `save-job.controller.ts`, recipe integration service");
  `specs/011-recipe-digitization/spec.md:221` (`FR-021` "`POST /…/save` **creates a `Recipe`**"), `:203` (`FR-013`
  client polls job status), `:220` (`FR-020` job stores `raw_ocr_json`/`parsed_json`), `:284` (`FR-036` purge),
  `:340` (`digitization-service` = "`DigitizationJob` CRUD … correction save"), `:346` (new tables include
  `digitization_jobs`).

**What contradicts what**: 011's new §"Ownership of the photo channel" says the image service holds no state and
creates no recipes; 011's FR table, data model, plan and task list build a job-persisting service that creates
recipes itself and exposes a polling API. `plan.md` and `tasks.md` contain **zero** occurrences of `ADR-0019`,
`bulk import`, `004-FR-047` or `supersed*`.

**Why it matters**: This is the durable-record duplication ADR-0019 explicitly rejected ("two places to reconcile,
for no gain") plus the second recipe-creation path it forbids — so provenance, quota, per-recipe outcome reporting
and partial-failure semantics get a second implementation. `digitization_jobs.recipe_id` also makes the image
service a writer of recipe linkage, which the one-writer discipline forbids.

**Smallest fix**: Repoint `FR-013`/`FR-020`/`FR-021`/`FR-029`/`FR-036` and plan §Data-Model item 4 so job state is
either (a) the ephemeral object-storage record ADR-0019 allows, or (b) owned by the recipe service's import spine;
replace T-042's "creating recipe" with "submit candidates to 004's bulk import processor with
`sourceType = imported_physical`"; delete `digitization_jobs` from `plan.md:413`'s migration list or move it to the
Circles deployable's migration set with an explicit ruling. `circles`/`circle_members`/`circle_invites` are
untouched — `spec.md:96-100` correctly ring-fences them.

**Verified**: read `spec.md:44-100`, `:186-290`, `:323-346`; `plan.md:160-230`, `:410-416`; `tasks.md:115-120`;
`grep -n "ADR-0019\|bulk import\|004-FR-047\|supersed" specs/011-recipe-digitization/{plan,tasks}.md` → no matches.

---

## F-S3

**Severity**: CRITICAL

**Files (both sides)**

- 006 is its own deployable: `docs/architecture/decisions/0017-…md:225-234` (amendment table:
  `@kitchensink/meal-plan-service` / `@kitchensink/schema-meal-plan`); `specs/006-meal-planning/spec.md:38`
  (**C-006-001** "Meal planning is its own platform service, `@kitchensink/meal-plan-service`. It is **not** a module
  inside `recipe-service`"); `specs/006-meal-planning/plan.md:11`, `:135`, `:164`, `:720`, `:737`.
- 006 is a module in the recipe service: `specs/006-meal-planning/spec.md:538-540` (contract-ownership table:
  owning service `@kitchensink/recipe-service`, schema package `@kitchensink/schema-recipe`, client
  `@kitchensink/recipe-service-client`), `:546` ("**Adopting the recipe service** also means adopting its prefix"),
  `:552`, `:573`, `:578`; `specs/006-meal-planning/tasks.md:52,57,62,73,78,83,97,102,107,118,123,139,155,171`
  (every T-001…T-017 path is `packages/services/recipe-service/src/…`), `:332-334`, `:344`, `:516`
  ("**`@kitchensink/recipe-service`**, the same database as `recipes`, so `meal_plan_entries.recipe_id` is a real
  [FK]"), `:943-952` (the ADR-0017 repointing block that _moved_ 006 into recipe-service), `:959-977`
  (**TASK-039** "Regenerate `@kitchensink/schema-recipe` from 006's authored zod").

**What contradicts what**: Within one feature, `spec.md` line 38 and line 538 give opposite answers to "which service
owns 006", and `tasks.md` is wholly on the superseded side — including a task whose deliverable is regenerating the
**wrong** schema package. `tasks.md:516` additionally asserts a foreign key (`meal_plan_entries.recipe_id`) that
`spec.md:44-49` (**C-006-002**) forbids: "`recipe_id` is stored as a `uuid` value with **no** foreign key, because
recipes live in a different logical database".

**Why it matters**: GR-015 §15-b's whole premise is that the lowest-authority document is where an unowned question
gets answered incompatibly. Executing `tasks.md` puts meal-plan zod into `packages/services/recipe-service/**`, adds
meal-plan types to `@kitchensink/schema-recipe`, and changes that package's `CONTRACT_HASH` — a one-way door for
every recipe-service client, and precisely the migration cost the amendment says it is paying _now_ to avoid.

**Smallest fix**: Rewrite `spec.md:538-546` to `@kitchensink/meal-plan-service` / `@kitchensink/schema-meal-plan` /
`@kitchensink/meal-plan-service-client`; regenerate `tasks.md` against the current `plan.md` (it is the 2026-06-02
file — see `tasks.md:4` — and predates the whole reconciliation); delete or invert the `:943-952` repointing block,
which now records a superseded move; retarget TASK-039.

**Verified**: read `spec.md:30-60`, `:520-580`; `plan.md:1-120`, `:640-745`; `tasks.md:1-60`, `:330-350`, `:940-980`;
`grep -rn "recipe-service\|schema-recipe" specs/006-meal-planning/` (40+ hits, listed above);
`ls packages/services/` confirms `meal-plan-service` does not yet exist.

---

## F-S4

**Severity**: CRITICAL

**Files (both sides)**

- `specs/005-ai-integration/plan.md:56` — "`@kitchensink/ai-service` (**ALB priority 400**)" and `:526` —
  "| ALB priority | **400** (identity 100, food 200, recipe 300) |", `:527` — "Per-PR band … disjoint from food
  (10000) and recipe (30000)".
- `specs/006-meal-planning/plan.md:648` — "**Listener priority**: base stages **400** (identity 100, food 200,
  recipe 300). Per-PR band **50000–59999**, named ephemeral band **60000–69999** … mirroring
  `recipeListenerPriorityForStage`", and `:743` ("listener rule at priority 400").
- The single allocator: `packages/infra/alb/src/listener-priority.ts:49` (`ALB_MAX_LISTENER_PRIORITY = 50_000`,
  "exceeding this is a DEPLOY-time failure unless we catch it"), `:74` (`EPHEMERAL_SERVICE_SLOTS = 8`), `:78`
  (`PER_PR_BAND_WIDTH = 6_000`), `:102` (`EPHEMERAL_SLOT_ORDER = ['identity','food','recipe']`), `:108-113`
  (`BASE_LISTENER_PRIORITY` — a typed `Record` over that union, so an unregistered service is a **compile** error).

**What contradicts what**: Three separate defects in one place. (1) **005 and 006 both claim base priority 400** on
the same shared listener — the `Priority '400' is currently in use` failure ADR-0003 names, and the same class of
defect that produced `recipe-pr-{N}` on `food-pr-{N}`'s priority. (2) 006's per-PR band **50000–59999** and named
band **60000–69999** are entirely **above the ALB ceiling of 50000**; the allocator's per-PR span ends at 49999 and
`assertWithinAlbRange` throws at synth. (3) Both plans cite the retired per-service constants ("food 10000, recipe
30000") — under the current allocator the bands are 2000–7999 / 8000–13999 / 14000–19999, and
`recipeListenerPriorityForStage`, which `006/plan.md:648` says it mirrors, no longer exists as the authority.

**Why it matters**: A listener priority is a namespace shared across independently deployed CloudFormation stacks
that nothing in AWS arbitrates. Two plans in the same repository already agree on the same number. It is a one-way
door in the sense that matters operationally: the collision surfaces only at deploy, as an error that does not name
the other claimant.

**Smallest fix**: Delete the priority arithmetic from both plans. Replace each with "append the service to
`EPHEMERAL_SLOT_ORDER` and add its `BASE_LISTENER_PRIORITY` entry in `packages/infra/alb/src/listener-priority.ts`;
the band follows from the slot index" — the base numbers are then allocated once, in the file whose `Record` type
makes a missing registration a compile error. Also drop `specs/006-meal-planning/research/codebase-analysis.md:170-171`,
which prescribes the same hand-derived scheme.

**Verified**: read `packages/infra/alb/src/listener-priority.ts:1-120` in full; `grep -n "priority" ` in both plans;
cross-checked against ADR-0003's summary in `CLAUDE.md`.

---

## F-S5

**Severity**: HIGH

**Files (both sides)**

- `specs/007-grocery-lists/plan.md:48` — `user_id UUID REFERENCES users(id)`; `:49` —
  `meal_plan_id UUID REFERENCES meal_plans(id)`; `:61` — `usda_fdc_id INT REFERENCES foods(fdc_id)`; `:73-75`
  (`user_pantry_items` keyed on `usda_fdc_id`).
- The owning service's actual schema: `packages/services/recipe-service/src/database/schema/recipes.ts:7`
  ("D2 (no local `users` table): `owner_id` stores the app-user ULID") and `:75`
  (`ownerId: varchar('owner_id', { length: 255 })`); the identity `users` table is `text` not `uuid`
  (`packages/shared/identity-db/src/schema/users.ts:21` — `id: text('id').primaryKey()`), in a **different
  database**; the food table is `packages/services/food-service/src/db/schema/food.ts:84-86` — named **`food`**
  (singular), PK `id: text('id')` (ULID), and `:7` records that `fdc_id` was **removed** in the 2026-06-21
  re-baseline; `meal_plans` lives in `@kitchensink/meal-plan-service` / `kitchensink_meal_plans`
  (`specs/006-meal-planning/plan.md:11`, ADR-0017 amendment `:234`).
- 007's own ownership section says it lands in the recipe service: `specs/007-grocery-lists/plan.md:105-113`,
  `specs/007-grocery-lists/tasks.md:412-427`.

**What contradicts what**: Every foreign key in 007's data model points at a table that is not in 007's database, or
does not exist under that name/type. `users(id)` — no such table in the recipe service, and identity's is `text` in
another database. `foods(fdc_id)` — the table is `food`, the column was deleted, the type is `text` not `INT`, and
it is in `kitchensink_food`. `meal_plans(id)` — now in a third database entirely. 007's `tasks.md:427` still
justifies the repointing with "one database, so `meal_plan_entries → recipes` stays a foreign key" — a rationale the
006 amendment falsified four days after it was written.

**Why it matters**: These migrations cannot be written as specified — each `REFERENCES` is a deploy-time error. More
subtly, an FK is a _design claim about consistency_: 007's generation flow currently assumes referential integrity it
will not have, so nothing in the spec says what a grocery list does when its meal plan is deleted in another service.

**Smallest fix**: In `plan.md:44-75`, replace `user_id UUID REFERENCES users(id)` with
`owner_id VARCHAR(255) NOT NULL` (no FK, mirroring `recipes.owner_id` and 006's C-006-002); `meal_plan_id UUID
REFERENCES meal_plans(id)` with a bare `meal_plan_id UUID NULL` plus a read-time resolution rule; and
`usda_fdc_id INT REFERENCES foods(fdc_id)` with `food_id TEXT NULL` (the food service's ULID), citing
`food-service/src/db/schema/food.ts`. Correct `tasks.md:427`'s justification.

**Verified**: read both SQL blocks; opened all four shipped schema files;
`grep -rn "pgTable('users'" packages/services/*/src/database/schema/*.ts` → no matches.

---

## F-S6

**Severity**: HIGH

**Files (both sides)**

- `specs/009-nutrition-planning/plan.md:45-46` — `user_id UUID REFERENCES users(id)`,
  `trainer_id UUID REFERENCES users(id)`; `:67` — `meal_plan_id UUID REFERENCES meal_plans(id)`; `:91-92` —
  `trainer_id`/`client_id UUID REFERENCES users(id)`.
- Same shipped-schema evidence as F-S5 (`recipes.ts:7,75`; `identity-db/src/schema/users.ts:21`).
- And an **ADR-internal** contradiction: `docs/architecture/decisions/0017-…md:93-95` justifies keeping 009 in the
  recipe service because "**006 ↔ 009 are two halves of one question.** 009's `meal_plan_nutrition_link` is a join
  table between a 006 table and a 009 table, and its compliance query reads both. Splitting them puts a transaction
  boundary through the middle of a single user-visible calculation" — while `:229-234` moves 006 out and states
  "007, 009 and 010 are **unchanged**". `:158` repeats the same claim ("`meal_plan_nutrition_link → meal_plans`")
  as a reason to reject separate services.
- 009's tasks still create that join table in the recipe service:
  `specs/009-nutrition-planning/tasks.md:55-58` (`00NN_nutrition_planning.sql` creating `nutrition_plans`,
  `meal_plan_nutrition_link`, `nutrition_compliance`, `trainer_clients`).

**What contradicts what**: The amendment performed exactly the split its own §"Why the recipe service" said must not
happen, and did not revisit the paragraph. `meal_plan_nutrition_link` is now a join table across two databases; it
cannot be a join table at all. The FKs to `users(id)` are broken for the same three reasons as F-S5.

**Why it matters**: This is the sharpest _architectural_ consequence of the amendment and it is currently unrecorded.
009's compliance calculation was designed as one transactional read; it is now a cross-service read with no stated
consistency story, no timeout/degradation rule, and no gateway (contrast 006, which specifies `RecipeGateway` with a
three-state `availability` discriminant for exactly this).

**Smallest fix**: Add one paragraph to ADR-0017's amendment stating what the 006 extraction costs 009 — that
`meal_plan_nutrition_link` becomes a local table holding an opaque `meal_plan_id` with **no** FK, and that 009 reads
plans through a `MealPlanGateway` modelled on 006's `RecipeGateway`. Then repoint `009/plan.md:45-92` FKs the same
way as F-S5, and restate `tasks.md:58`'s acceptance without the cross-database FK.

**Verified**: read ADR-0017 in full (262 lines); read `009/plan.md:38-100` and `009/tasks.md:55-120`.

---

## F-S7

**Severity**: HIGH

**Files (both sides)**

- Defined: `specs/004-recipe-importing/spec.md:196-243` — **FR-046** (import-method chooser), **FR-047** (one bulk
  import processor), **FR-048** (superseding per-recipe status, monotonic sequence), **FR-049** (per-food-item
  status), **FR-050** (placeholder reference + food shell entry), **FR-051** (idempotent status ingestion). Required
  by `docs/architecture/decisions/0019-…md:43-134` and by its Consequences (`:166-173`).
- Traced nowhere: `grep -rln "FR-046\|FR-047\|FR-048" specs/004-recipe-importing/` returns **`spec.md` only** — not
  `plan.md`, not `tasks.md`, not `v-model/requirements.md`, not `v-model/traceability-matrix.md`,
  not `v-model/acceptance-plan.md`. `specs/004-recipe-importing/plan.md:216` still lists three per-channel
  endpoints (`/import/url`, `/import/instagram`, `/import/photo`) and no bulk-import endpoint;
  `specs/011-recipe-digitization/spec.md:88-94` binds 011 to `004-FR-048`/`004-FR-050`, which therefore point at
  requirements with no implementation obligation anywhere.

**What contradicts what**: The entire import spine — the ADR's whole subject — exists only as prose in one file. The
plan still describes the four-independent-pipelines shape ADR-0019 replaced, and no REQ, task, test tier or
traceability row covers the chooser, the shared processor, the status envelope or the placeholder model.

**Why it matters**: FR-050 (placeholder + shell) is the ADR's stated _fallback_ for a status message that is never
emitted — "which is precisely why §5 is not optional" (ADR-0019:163-164). An untraced fallback is an absent one.
FR-048's supersession key is also a **wire contract** (ADR-0019:167-170, GR-015): if it is invented at implementation
time in two services independently, that is exactly the drift the rule exists to prevent.

**Smallest fix**: Add REQs for FR-046…FR-051 to `004/v-model/requirements.md` with matrix rows, and one task block to
`004/tasks.md`: the chooser (web + mobile, with the unavailable-state rendering FR-046 mandates), the bulk import
endpoint replacing the three per-channel creates in `plan.md:216`, the status envelope authored as zod in the owning
service per ADR-0014, and the placeholder/shell read path. Note explicitly that the food half of FR-050 is already
satisfied (see "Coherent areas", below) so nobody builds a second one.

**Verified**: the `grep -rln` above; read `004/plan.md:200-230`, `:280-300`; read
`004/v-model/{requirements,traceability-matrix}.md`.

---

## F-S8

**Severity**: HIGH

**Files (both sides)**

- `specs/011-recipe-digitization/spec.md:53` — Prerequisites row for 010: "**complements** … Optional entitlement
  check before enqueuing OCR (Q-002 deferred to implementation). **011 ships ungated if 010 is not yet live.**"
- `specs/011-recipe-digitization/spec.md:83-87` — "**What 011 inherits rather than re-derives** … the premium
  entitlement gate on `imported_physical` (`004-FR-028`, D-014)".
- `specs/004-recipe-importing/spec.md:286-290` — **FR-028**: "Any import channel whose result is non-public by policy
  **MUST** require an active premium entitlement: photo/OCR import (`imported_physical`) … The channel MUST also be
  absent from the advertised channel list for such a caller."
- `specs/004-recipe-importing/spec.md:30` — "Until 010 ships, premium is derived from the signed token's
  `permissions` (the shipped `PREMIUM_PERMISSION`)."
- `specs/004-recipe-importing/spec.md:672-675` (D-014: "photo/OCR import … become premium-only … it confines
  Textract spend to paying users, which retires the cost concern D-001 opened").

**What contradicts what**: Two sections of 011's own spec, seven lines apart in effect: one says the gate is optional
and 011 may ship ungated, the other says the gate is inherited and binding. 004 says it is a MUST and names the
mechanism available _before_ 010 ships, so the "010 is not yet live" escape hatch does not exist.

**Why it matters**: This is the one requirement whose omission has a direct, unbounded cost: D-014's stated purpose
is to confine Textract spend to paying users, on an account running a $300/month budget (ADR-0008). Shipping the OCR
channel ungated is an open-ended per-photo vendor bill from free-tier traffic.

**Smallest fix**: Rewrite `011/spec.md:53` to "**Required** — `imported_physical` is premium-only (`004-FR-028`,
D-014). Before 010 ships, the gate reads the shipped `PREMIUM_PERMISSION` claim (`004/spec.md:30`)", and close Q-002
against that. The gate is enforced via the shared entitlement mechanism, never by importing the identity service
(ADR-0017 decision 3).

**Verified**: read `011/spec.md:44-100`; read `004/spec.md:24-31`, `:286-290`, `:666-680`.

---

## F-S9

**Severity**: MEDIUM

**Files (both sides)**

- `specs/governance-rules.md:811-816` (GR-015 Current State) — "ADR-0017 rules **006** / 007 / 009 into
  `@kitchensink/recipe-service` (`@kitchensink/schema-recipe`) … **No new deployable service is created.**"
- `specs/governance-rules.md:1063-1066` (GR-016 Current State) — "GR-016 binds `@kitchensink/recipe-service`
  (**006**, 007, 009)".
- `docs/architecture/decisions/0017-…md:225-234` (the amendment that made both false), and
  `specs/006-meal-planning/spec.md:38`.
- Also stale in the same ledger: `specs/governance-rules.md:817-819` — "Feature 013 … its `tasks.md` **still creates
  the rejected location** (T-002, and T-015 …)" — but `specs/013-cooking-school/tasks.md:62` and `:114` now carry
  explicit ⛔ notes forbidding `packages/shared/cooking-school-contracts` and pointing at
  `packages/schemas/cooking-school`. And `specs/governance-rules.md:118-121` (GR-002) — "⚠️ **Feature 006 is the last
  holdout.** Its branch still carries bare `/v1/*`" — 006 now has **zero** bare `/v1/meal-plans` references in
  `spec.md` and `tasks.md` (`plan.md:459` mentions the migration in the past tense).

**What contradicts what**: The governance ledger — the document whose stated purpose is to be the honest record, and
which was itself re-measured on 2026-08-12 for exactly this failure mode (commit `83dbf714`) — has gone stale again
in three places within two days.

**Why it matters**: `83dbf714`'s own commit message documents the damage: "a stale number laundered into a plan is
worse than one in a ledger". GR-015's ledger is what a contributor reads to learn which schema package to extend;
right now it directs 006's author into `@kitchensink/schema-recipe`.

**Smallest fix**: Three edits — GR-015 §Current State and GR-016 §Current State to read "007 / 009 → recipe-service;
**006 → `@kitchensink/meal-plan-service` (`@kitchensink/schema-meal-plan`), ADR-0017 amendment 2026-08-14**"; mark
the 013 bullet ✅ resolved with the two task line numbers; retarget the GR-002 holdout bullet at **003** (F-S12).

**Verified**: read all four ledger passages; `grep -n "cooking-school-contracts" specs/013-cooking-school/tasks.md`;
counted bare-prefix occurrences in 006 (0 / 0 / 1-in-prose).

---

## F-S10

**Severity**: MEDIUM

**Files (both sides)**

- `specs/governance-rules.md:505` (GR-011 rule) — "Features that need to send notifications must publish events to
  the notification system — they must not implement their own delivery mechanism"; `:509` (AC-011-b) — "Features 001,
  003, 005, 008, 009 update their `spec.md` dependency tables to list 014 as a dependency".
- Only one feature does: `grep -n "014-notification\|notification-service"` across the six spec files returns exactly
  one hit — `specs/003-usda-food-data/spec.md:260`. `specs/001-…/spec.md`, `005/spec.md`, `008/spec.md`,
  `009/spec.md`, `004/spec.md`, `011/spec.md` have none.
- And ADR-0019 adds two more producers: `docs/architecture/decisions/0019-…md:112-114` — "Feature 014 owns the
  service that consumes these messages and pushes them to clients. **004 and 011 own emitting them and the
  destination's existence**". `specs/004-recipe-importing/spec.md:24-31` (Dependencies table) has no 014 row despite
  FR-048/049/051; `specs/011-recipe-digitization/spec.md:47-54` (Prerequisites table) has none despite `:88-94`.

**What contradicts what**: GR-011's acceptance criteria have never been met, and the two features the newest ADR
turns into first-class producers do not declare the dependency either — while their FRs mandate emission.

**Why it matters**: "The destination's existence" is an ordering constraint: 004 cannot ship FR-048 before 014's
publish surface exists, and nothing in either dependency table records that. This is the same class as the
006 → 007 chain the consistency report flagged as WA-002.

**Smallest fix**: Add a 014 row to the dependency/prerequisite tables of 001, 004, 005, 008, 009 and 011 (003
already has one), each naming the FR that needs it. For 004/011 mark it **Required — blocks FR-048/FR-049**.

**Verified**: the greps above; read GR-011 in full (`:495-518`); read 004's and 011's dependency tables.

---

## F-S11

**Severity**: MEDIUM

**Files (both sides)**

- `specs/cross-feature-FR-index.md:6` — "**Status**: Active registry; update **whenever** a cross-feature FR
  reference is added"; `:63-66` (Review Rules 1 and 4); `specs/governance-rules.md:154` (AC-003-b) — "This index is
  updated whenever a cross-feature FR reference is added or removed".
- The registry's only 004-targeting rows are `:31` (`004-FR-011`), `:34` (`004-FR-008`), `:40` (`004-FR-014a`).
- Unregistered citations added 2026-08-14: `specs/011-recipe-digitization/spec.md:52` (`004-FR-047`), `:76`
  (`004-FR-047`), `:84-87` (`004-FR-028`, `004-FR-022`, `004-FR-018`), `:92` (`004-FR-048`, `004-FR-050`);
  `specs/004-recipe-importing/spec.md:179-186` (points at 011 by capability).
- Also still outstanding from the previous sweep: `specs/governance-rules.md:189-193` — "⚠️ **Registry not updated by
  this sweep — deliberate hand-off** … must be registered **once 005's and 006's changes land**." Those changes have
  now landed on this branch (commit `4a979422`), so the hand-off is due.

**What contradicts what**: The registry claims to be the validation mechanism for cross-feature FR references and is
missing every reference introduced by the ADR this branch landed, plus the batch its own governance ledger deferred
to "when 005/006 land".

**Why it matters**: The registry exists precisely so that renumbering an FR in one spec is detectable in another.
`004-FR-047` and `004-FR-050` are the load-bearing ones — 011's build depends on them, and F-S7 shows they are
untraced on the owner's side, which is exactly the condition Review Rule 2 exists to catch.

**Smallest fix**: Add six rows (011 → `004-FR-018/022/028/047/048/050`) and the deferred 005/006 batch named at
`governance-rules.md:190-193`, then delete that deferral note.

**Verified**: read the registry in full; `grep -n "004-FR-0" specs/cross-feature-FR-index.md`; read GR-003 in full.

---

## F-S12

**Severity**: MEDIUM

**Files (both sides)**

- `specs/governance-rules.md:97` (AC-002-a) — "**Every** `spec.md`, `plan.md`, and OpenAPI contract in **every**
  feature uses `/api/v1/*` … No endpoint uses bare `/api/*` or bare `/v1/*`"; `:108` — "**Current State (2026-08-02)
  — SATISFIED**"; `:118-121` — "⚠️ **Feature 006 is the last holdout.**"
- `specs/003-usda-food-data/spec.md` — **58** bare `/v1/foods*` references against 3 canonical ones (e.g. `:23`
  "URL prefix versioning — `/v1/foods/{id}`", `:79`, `:80`, `:89`, `:104`, `:117`, `:121`, `:361`);
  `specs/003-usda-food-data/plan.md` — **33** bare against 2 canonical.
- The shipped service: `packages/services/food-service/src/foods/foods.controller.ts:81` —
  `@Controller(['api/v1/foods', 'v1/foods'])`, with `:2` and `:89-113` documenting `/api/v1/foods/*` as the surface
  and ADR-0011 making the bare form a **deprecated alias** only.

**What contradicts what**: GR-002 declares itself SATISFIED and names 006 as the sole holdout; 006 is now clean and
**003** — never mentioned in the ledger — carries 91 bare-prefix references across its spec and plan, documenting the
deprecated alias as if it were the canonical path.

**Why it matters**: 003 is shipped, so this is documentation drifting from code rather than a build hazard — but it
is the reference document six other features cite for food endpoints, and ADR-0011's alias has an ordered retirement
plan that this wording would make look like a breaking change.

**Smallest fix**: Normalize 003's `spec.md`/`plan.md` to `/api/v1/foods/*`, add one sentence citing ADR-0011 that the
bare form persists as a deprecated alias, and correct GR-002's Current State to name 003 (not 006) as the remaining
spec-level holdout.

**Verified**: counted with `grep -o '/v1/foods' … minus '/api/v1/foods'` on both files (58 and 33); read the shipped
controller; read GR-002 in full.

---

## F-S13

**Severity**: MEDIUM

**Files (both sides)**

- `specs/006-meal-planning/spec.md:8` — "Phase 1 (**FR-022/023/024 + FR-028..FR-041**) is implementable";
  `specs/006-meal-planning/tasks.md:11-19` (US reference table) covers only **FR-022…FR-027**. Untraced: FR-022a,
  FR-023a, FR-028, FR-028a, FR-029…FR-041 (18 requirements) — including `FR-041` which `spec.md:10` calls "the
  Phase-1 obligation that deferral depends on", and `FR-034` (the cross-platform drag/keyboard parity requirement).
- `specs/011-recipe-digitization/spec.md:222-223` — **FR-021a** (photo-digitized recipes MUST be created private)
  and **FR-021b** (attribution required before publish), both owner rulings of 2026-08-02; neither appears in
  `specs/011-recipe-digitization/tasks.md`.
- `specs/012-creator-profiles/tasks.md` traces 25 of 39 FRs (untraced: FR-004, FR-011, FR-021, FR-028, FR-029,
  FR-031…FR-039); `specs/013-cooking-school/tasks.md` traces 11 of 20 (untraced: FR-011…FR-016, FR-018…FR-020).

**What contradicts what**: Each spec's own requirement set versus its own task list. 006's is the severe one — its
`tasks.md` predates the reconciliation (`tasks.md:4`, "Generated: 2026-06-02") and cannot cover requirements written
in August. 011's two untraced FRs are the ones that keep a cookbook photo from being published without rights.

**Why it matters**: An untraced FR is not merely unscheduled — under the repository's testing policy it also has no
owed test tier, so nothing would fail if it were never built.

**Smallest fix**: 006 — regenerate `tasks.md` from the current `plan.md` (also required by F-S3). 011 — add
FR-021a/FR-021b to the save-path task's acceptance. 012/013 — add the missing FR tags to existing tasks, or new
tasks where no task covers them.

**Verified**: scripted comparison of bolded/table-leading FR definitions in each `spec.md` against all FR mentions in
the matching `tasks.md`, per feature; spot-read 006 `tasks.md:11-19` and 011 `tasks.md` for FR-021a/b.

---

## F-S14

**Severity**: MEDIUM

**Files (both sides)**

- `packages/infra/alb/src/listener-priority.ts:74` — `EPHEMERAL_SERVICE_SLOTS = 8`, `:100-102` — three slots already
  taken (`identity`, `food`, `recipe`), leaving **five**; `:33-36` — "8 services, a 9th needing the geometry re-cut".
- Six new ALB-attached deployables are named across the specs: `@kitchensink/ai-service`
  (`specs/005-ai-integration/plan.md:56`), `@kitchensink/meal-plan-service`
  (`specs/006-meal-planning/plan.md:11`), the stateless image-processing service
  (`docs/architecture/decisions/0019-…md:77-82`), `@kitchensink/circles-service`
  (`specs/011-recipe-digitization/spec.md:341` and `:96-100`, ring-fenced as a **separate** deployable),
  `@kitchensink/creator-profiles-service` (`specs/012-creator-profiles/spec.md:215`), and
  `cooking-school-service` (`specs/013-cooking-school/plan.md:93`).

**What contradicts what**: Six declared services against five reserved slots. None of 011/012/013 mentions a listener
priority at all (`grep -n "listener\|priority"` → no matches in their plans), so the shortfall is invisible in every
document that creates it.

**Why it matters**: The ninth service is not a small change — `listener-priority.ts:22-31` explains that the band
geometry lands exactly on 49999 and that a re-cut renumbers every ephemeral band. It is much cheaper to decide the
roster now than to re-cut with open PRs deployed. It is also the concrete form of the question ADR-0017 explicitly
left open at `:217-221`: "does this need its own deployable, given what a deployable costs here?"

**Smallest fix**: Not a spec edit — a decision. Either (a) rule on 005/011/012/013's deployables the way ADR-0017
ruled on 006–010, or (b) record in ADR-0003 that the roster is projected to exceed 8 and that the geometry re-cut is
scheduled before the 9th service. Until then, each of the six plans should cite the allocator rather than a number.

**Verified**: read the allocator header and constants; grepped all six plans for service names and for any listener
priority statement.

---

## F-S15

**Severity**: LOW

**Files (both sides)**

- `specs/cross-feature-consistency-report.md:5` — "**Status**: Bootstrap-state — **no implementation code exists
  yet**"; `:29` — "Photo storage is owned by 001; **004** (recipe importing) is the only other feature that
  references it (**for OCR imports**)"; `:13-23` (shared-concerns matrix covers 001–010 only); `:147-205` (dependency
  graph omits 011–014); `:217` — "**006 → 007** is the only hard inter-feature dependency chain".
- Contradicted by: 001/002/003 shipped (`packages/services/{recipe-service,identity,food-service}` exist);
  `docs/architecture/decisions/0019-…md:74-76` (photo/OCR is 011's); `specs/011-recipe-digitization/spec.md:52`
  (011 **blocks** on 004 — a second hard chain); features 011–014 exist as full spec trees.

**What contradicts what**: A document named in this review's required reading, and cited as normative by GR-002/003/
011/014's `Source:` lines, still describes a pre-implementation portfolio of ten features with photo import owned by 004.

**Why it matters**: Low blast radius — the report's findings have all been promoted into GR rules, which are the live
authority — but a reader following the required-reading list reaches it before the ADRs and gets the superseded
picture of exactly the two areas this branch changed.

**Smallest fix**: A dated header banner: "Superseded in part — §1, §3 and §11 predate features 011–014, ADR-0017 and
ADR-0019; the live authority is `governance-rules.md` plus the ADRs. Retained for the CR/WA findings that GR rules
cite." No content rewrite needed.

**Verified**: read the report in full (664 lines); cross-checked §1/§3/§11 against the current spec tree and ADRs.

---

## Coherent areas — examined and found sound (recorded so nobody "fixes" them)

- **ADR-0019 §5's food half is already satisfied by 003 — add nothing.** The shell entry with a status is the
  shipped model: `packages/services/food-service/src/db/schema/food.ts:86` (`id: text('id').primaryKey()`, a ULID
  generated up front) and `:95` (`status: foodStatusEnum('status').notNull().default('PENDING')`), specified at
  `specs/003-usda-food-data/spec.md:52` (`PENDING | UNRESOLVED | RESOLVED | NOT_FOUND | FAILED`) and `:121`
  (`POST` creates the canonical row + `id`, returns `202`). This is **intent already satisfied**; 004's FR-050 should
  cite it rather than specifying a new mechanism. It also does **not** conflict with `003/spec.md:757-759`
  ("An unresolvable id is a **rejection**, never a placeholder row") / GR-019 — that rule governs a _caller-supplied_
  id, whereas a shell row carries a real generated ULID.
- **014's supersession contract matches ADR-0019 §4 exactly**, including the part that is easy to get wrong:
  `specs/014-notification-service/spec.md:393-397` and `:637-660` make `supersedes = { key, sequence }` optional,
  producer-assigned and monotonic, explicitly **not** arrival-ordered, and `:660` states that absence is not a
  default. `:679` correctly resolves the per-delivering-user vs per-recipient counter question. No drift found.
- **010 is coherent end-to-end.** `specs/010-subscriptions/plan.md:127-134` (identity service authors the zod),
  `:32` (webhook in `identity-webhooks`), `:82-102` and `:176-182` (`stripe_webhook_events`, **not** the shipped
  `webhook_events`) all match ADR-0017 `:100-122` as amended by ADR-0018, and `:190` correctly forbids importing
  `@kitchensink/identity-service` to gate a route.
- **007's and 009's contract-ownership sections** (`007/plan.md:105-113`, `007/tasks.md:412-427`,
  `009/plan.md:127-149`, `009/tasks.md:156-206`) are correctly repointed to `@kitchensink/recipe-service` /
  `@kitchensink/schema-recipe` with the `class-validator` prohibition stated. Only their **§2 Data Model** blocks were
  missed (F-S5, F-S6).
- **012 and 013 contract ownership** (`012/spec.md:240-241`, `013/plan.md:93-96`, `013/tasks.md:62,114`) conform to
  ADR-0014/GR-015: service authors the zod, generated `packages/schemas/{creator-profiles,cooking-school}`, no
  hand-maintained contracts package. 013's previously-flagged `cooking-school-contracts` task is fixed.
- **`004-FR-011` cross-feature citations are consistent, not drifted.** `specs/cross-feature-FR-index.md:31` and
  `specs/010-subscriptions/v-model/requirements.md:34,41,73,87` cite it as the premium/clone-to-private hook, which
  matches 004's own framing at `specs/004-recipe-importing/spec.md:30`. Not a finding.
- **GR-003 already rules on FR-number overlap** (`governance-rules.md:171-177`): 006 defining `FR-040`/`FR-041`
  while 010 owns `FR-040…044` is expected and accepted; the qualifier carries the meaning. Not a finding.
- **The table-collision gate is real and passing on these specs.**
  `packages/infra/global/__tests__/spec-table-collisions.test.ts` parses rather than greps and pins exemption owner
  sets exactly; 007's `REFERENCES` clauses (F-S5) are outside its remit by design, which is why they survived.

---

## Not examined

- **`v-model/` trees other than 004's and 006's.** I read 004's `requirements.md` and `traceability-matrix.md` and
  006's `requirements.md`/`system-design.md`/`trace.md` headers. 001, 002, 003, 005, 007–014's V-Model artifacts
  (acceptance/system/integration/unit test plans, hazard analyses, peer reviews, release audits) were **not** read.
  Given F-S1's finding that 004's V-Model was missed by the ADR-0019 sweep, the other twelve are unmeasured.
- **`product-spec/`, `research/`, `checklists/`, `sync-report.*`, `.forge-status.yml`, `verify-report.md`** for all
  fourteen features, except the three `research/codebase-analysis.md` and `research/tech-stack.md` passages cited
  above. `.forge-status.yml` files changed substantially in this branch and were not opened.
- **`specs/executive/`, `specs/ux-handoff/`, `specs/beta-exit-criteria.md`, `specs/v-model-closure-checklist.md`,
  `specs/verify-snapshot.md`, `specs/cross-feature-burndown.md`** — only `v1-launch-plan.md` and
  `spec-sweep-2026-08-02.md` were grepped, not read.
- **002 and 008 in depth.** 008's plan was scanned for service ownership only; its stated OPEN (which service owns
  cross-device cooking-session sync, `008/plan.md:132-136`) is a recorded open question, not drift, and I did not
  evaluate it. 002 was checked only for its `010-FR-040…043` citations.
- **I did not run the test suites.** `spec-table-collisions.test.ts`, `spec-task-ids.test.ts` and
  `listener-priority.test.ts` were read, not executed; claims about what they do or do not catch come from reading
  their source, and the "6 of 14 features declare tables in prose only" blind spot is quoted from GR-021's own
  changelog rather than re-measured.
- **Non-spec consumers of these decisions** — CI workflows, CDK stacks, `docs/api-conventions.md` — beyond the four
  shipped schema/controller files and `packages/infra/alb/src/listener-priority.ts` cited above.
