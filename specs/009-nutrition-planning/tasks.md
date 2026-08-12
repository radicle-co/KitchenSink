# Tasks: Feature 009 — Nutrition Planning

**Feature**: `009-nutrition-planning`  
**Source**: [spec.md](spec.md) · [plan.md](plan.md) · [product-spec/product-spec.md](product-spec/product-spec.md)

---

## US Reference

| US     | Story                              | Priority | FR / REQ |
| ------ | ---------------------------------- | -------- | -------- |
| US-001 | Create Nutrition Plan              | Must     | FR-036   |
| US-002 | Link Meal Plan and View Compliance | Must     | FR-037   |
| US-003 | Trainer Creates Client Plan        | Must     | FR-038   |
| US-004 | Guided Recipe Swap Suggestions     | Must     | FR-039   |
| US-005 | Client Consent Gate                | Should   | REQ-008  |

---

## Dependency Graph (tasks in this file)

```
T-001
  └─► T-002
        ├─► T-003
        │     └─► T-004
        │           ├─► T-005
        │           │     ├─► T-012
        │           │     └─► T-014
        │           ├─► T-009
        │           │     └─► T-010
        │           │           ├─► T-011
        │           │           └─► T-015
        │           └─► T-007
        │                 └─► T-011
        ├─► T-006
        │     └─► T-007
        ├─► T-008 ──► T-004, T-006
        ├─► T-016 ──► T-004
        │     ├─► T-017
        │     ├─► T-018 ◄── T-005
        │     ├─► T-019 ──► T-020 ◄── T-009, T-010, T-011
        │     └─► T-021 ◄── T-012
        └─► T-013
              └─► T-003
```

⛔ **T-016 gates T-004.** The controller's `createZodDto` DTOs are derived from T-016's authored zod, so the
contract is authored before the first endpoint that serves it (GR-015 §15-a.2).

---

## US-001 — Create Nutrition Plan (FR-036)

- [ ] **T-001** [P3] [US-001] Create nutrition planning DB migration — `packages/services/recipe-service/src/database/migrations/00NN_nutrition_planning.sql`  
       **Depends on**: 006-meal-planning schema  
       **Implements**: FR-036  
       **Acceptance**: `nutrition_plans`, `meal_plan_nutrition_link`, `nutrition_compliance`, `trainer_clients` tables created with indexes; migration reversible; passes CI

- [ ] **T-002** [P3] [US-001] Define Drizzle schema and TypeScript types — `packages/services/recipe-service/src/database/schema/nutrition.ts`  
       **Depends on**: T-001  
       **Implements**: FR-036  
       **Acceptance**: All four table schemas exported; enums (`ActivityLevel`, `Goal`, `ComplianceStatus`) typed; inferred types exported; `strict: true`

- [ ] **T-003** [P3] [US-001] Implement macro calculator service — `packages/services/recipe-service/src/nutrition-plans/macro-calculator.service.ts`  
       **Depends on**: T-002  
       **Implements**: FR-036  
       **Acceptance**: Mifflin-St Jeor BMR ±1 cal; TDEE multipliers for 5 activity levels; macro splits for lose/maintain/gain; recipe/meal plan aggregation via 003/006; JSDoc; `strict: true`

- [ ] **T-004** [P3] [US-001] Nutrition plan CRUD API — `packages/services/recipe-service/src/nutrition-plans/nutrition-plans.controller.ts`  
       **Depends on**: T-002, T-003, T-008, T-016  
       **Implements**: FR-036  
       **Acceptance**: GET/POST/PUT/DELETE `/api/v1/nutrition-plans`; returns `linkedMealPlans`; 403 for non-owner; Clerk session token; request bodies, path params and query params validated by **`createZodDto`** over the T-016 zod under **`nestjs-zod`'s** `ZodValidationPipe`, with **`z.strictObject()`** on every mutating body; GDPR middleware applied  
       **⛔ NOT `class-validator`.** This task previously specified `class-validator` DTOs. `@kitchensink/recipe-service` has **exactly one** validation mechanism — ⚠️ **corrected 2026-08-12: the "19 residual `class-validator` files being removed (001 T-2xx)" this line cited are GONE**; the 19 was a **mention** count, the single real importer is converged, and `class-validator` / `class-transformer` are **removed from the service's `package.json` and `prod.package.json`**. So adding a `class-validator` DTO here would **introduce** the second mechanism rather than join a residue — a **GR-016 §16-a.2 violation** — two mechanisms in one service means two error contracts and two sets of edge cases. 009's own `plan.md` forbids it. Schemas live at `src/nutrition-plans/*.schema.ts` **beside this controller**, never in a `dto/` directory (§15.2)  
       **Tests**: unit (per-DTO accept/reject) **AND** integration (a known-bad body posted to a real route returns `400` naming the field)

- [ ] **T-009** [P3] [US-001] Web UI: nutrition plan creation — `packages/apps/commise/web/src/app/nutrition/plan/page.tsx`  
       **Depends on**: T-004  
       **Implements**: FR-036  
       **Acceptance**: Form fields (name, calories, protein, carbs, fat, activity, goal); optional TDEE calculator; plan list shows own + shared plans; accessible labels (NFR-003); status text + icon (NFR-004)

- [ ] **T-013** [P3] [US-001] Unit tests: macro calculator — `packages/services/recipe-service/src/nutrition-plans/__tests__/macro-calculator.service.test.ts`  
       **Depends on**: T-003  
       **Implements**: SC-010  
       **Acceptance**: 3+ BMR reference cases; all 3 goal splits; edge cases (zero-weight, calorie floor); ≥90% coverage; all tests pass

---

## US-002 — Link Meal Plan and View Compliance (FR-037)

- [ ] **T-005** [P3] [US-002] Meal plan link and compliance API — `packages/services/recipe-service/src/nutrition-plans/nutrition-plans.controller.ts`  
       **Depends on**: T-004  
       **Implements**: FR-037  
       **Acceptance**: POST `/api/v1/nutrition-plans/{id}/link` idempotent; validates meal plan ownership; GET `/api/v1/nutrition-plans/{id}/compliance` returns daily[] + weekly summary; date range params; 403 auth

- [ ] **T-010** [P3] [US-002] Web UI: compliance dashboard — `packages/apps/commise/web/src/app/nutrition/compliance/page.tsx`  
       **Depends on**: T-005, T-009  
       **Implements**: FR-037  
       **Acceptance**: Daily macro breakdown (planned vs actual); weekly summary; `on_track`/`over`/`under` with icon + text (NFR-004); date picker; no-data state; table fallback (NFR-003)

- [ ] **T-014** [P3] [US-002] Integration tests: compliance API — `packages/services/recipe-service/__tests__/integration/nutrition-plans/compliance.integration.test.ts`  
       **Depends on**: T-005  
       **Implements**: FR-037, SC-010  
       **Acceptance**: Create plan → link meal plan → verify compliance shape; status computed correctly; date filtering; 403 unauthorized; accuracy within 5%

---

## US-003 — Trainer Creates Client Plan (FR-038)

- [ ] **T-006** [P3] [US-003] Trainer-client relationship service — `packages/services/recipe-service/src/nutrition-plans/trainer-clients.service.ts`  
       **Depends on**: T-002, T-008  
       **Implements**: FR-038  
       **Acceptance**: POST `/api/v1/trainer/invite` creates `pending` row; client accept → `active`; client revoke → `revoked`; trainer access gated on `active`; premium check (010)

- [ ] **T-007** [P3] [US-003] Trainer nutrition plan APIs — `packages/services/recipe-service/src/nutrition-plans/trainer.controller.ts`  
       **Depends on**: T-006, T-004  
       **Implements**: FR-038  
       **Acceptance**: POST `/api/v1/trainer/clients/{clientId}/nutrition-plan` (trainer_id set, is_public false); client POST `/api/v1/nutrition-plans/{id}/accept`; GET `/api/v1/trainer/clients/{clientId}/compliance`

- [ ] **T-011** [P3] [US-003] Web UI: trainer-client management — `packages/apps/commise/web/src/app/nutrition/trainer/page.tsx`  
       **Depends on**: T-007, T-010  
       **Implements**: FR-038  
       **Acceptance**: Trainer invites client; trainer sees client list with compliance summary; trainer creates plan for client; client sees pending invites (accept/decline); client revokes access; premium gate

---

## US-004 — Guided Recipe Swap Suggestions (FR-039)

- [ ] **T-012** [P3] [US-004] AI recipe swap suggestions service — `packages/services/recipe-service/src/nutrition-plans/swap-suggestions.service.ts`  
       **Depends on**: T-005  
       **Implements**: FR-039  
       **Acceptance**: Surfaces swaps when compliance shows gap/excess; calls 005 AI with macro delta; shows recipe name, improvement, confidence; premium-gated; non-blocking async; teaser for non-premium

---

## US-005 — Client Consent Gate (REQ-008)

- [ ] **T-008** [P3] [US-005] GDPR Article 9 consent middleware — `packages/services/recipe-service/src/nutrition-plans/gdpr-consent.middleware.ts`  
       **Depends on**: T-002  
       **Implements**: REQ-008  
       **Acceptance**: Consent record verified before any nutrition write; captured at first plan creation (T-009); captured at trainer invite acceptance (T-006); delete triggers erasure cascade; no data if consent revoked; audit trail

---

## US-001 — E2E Testing

- [ ] **T-015** [P3] [US-001] E2E tests: nutrition plan flow — `packages/apps/commise/web/tests/e2e/nutrition-planning.spec.ts`  
       **Depends on**: T-010  
       **Implements**: FR-036, FR-037  
       **Acceptance**: Scenario 1: create plan → visible on dashboard; Scenario 2: link meal plan → compliance shows planned vs actual with indicators; Scenario 3 (premium): trainer plan → client views; `getByRole`/`getByLabel` queries (NFR-003); passes in CI

---

## Cross-US — Contract ownership, validation & the client half (GR-015, GR-016, GR-017)

> ⛔ **Service ownership is CLOSED.** [ADR-0017](../../docs/architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md)
> rules 009 into **`@kitchensink/recipe-service`** sharing **`@kitchensink/schema-recipe`**. There is **no**
> `packages/services/nutrition-service` and **no** `@kitchensink/schema-nutrition` — a schema package is per
> **SERVICE**, not per feature. Every path in this file was repointed to
> `packages/services/recipe-service/src/nutrition-plans/` accordingly. 009's endpoints are added to the
> **existing** schema package; forking it is a violation.
>
> ⚠️ **Physical isolation of GDPR Article 9 health data is ADR-0017's recorded flip condition** for extracting
> `@kitchensink/nutrition-service` — a compliance trigger (a DPIA or a customer contract), not an engineering
> one. Until it fires, this data lands in the recipe database and REQ-008's consent gate plus the field-naming
> rule below are the controls that matter regardless of topology.

- [ ] **T-016** [P3] [US-001] Author 009's wire shapes as zod in the recipe service and regenerate the existing schema package — `packages/services/recipe-service/src/nutrition-plans/*.schema.ts` → `packages/schemas/recipe`  
       **Depends on**: T-002  
       **Implements**: FR-036, FR-037, FR-038, GR-015 §15-a, GR-017 §17-a.1/§17-a.3  
       **Acceptance**: `nutrition-plans.schema.ts`, `compliance.schema.ts` and `trainer.schema.ts` authored **beside** their controllers under `src/nutrition-plans/`, importing **only `zod` and other `*.schema.ts` files`**; `npm run contract:verify` regenerates `packages/schemas/recipe` (`schemas.ts`, `types.ts`, `contract-hash.ts`, barrel, **derived** `openapi.yaml`) with no diff. **Add to the existing `@kitchensink/schema-recipe` — never fork it**, and never hand-edit the generated package  
       **⛔ Three things that look wrong and are not**: the schema package is a literal file **COPY** (zod are runtime values and cannot be derived from themselves); `openapi.yaml` is **DERIVED** output for `oasdiff`/docs/integrators and is **NEVER a codegen input**; the copy is wired with turbo `$TURBO_ROOT$` **`inputs`**, never `dependsOn` (that edge closes the cycle `client → schema → service → client`)  
       **⚠️ Health-data field naming**: a validation error names the offending **field** and **never echoes a health value** — an error message is a disclosure surface for Article 9 data  
       **Tests**: unit (each schema accepts a valid fixture and rejects every malformed variant) **AND** integration (regenerate-and-diff runs clean; `src/__tests__/build-inputs.test.ts` still covers the new files)

- [ ] **T-017** [P3] [US-001] Add the storage-floor boundary-parity test for 009's bounded columns — `packages/services/recipe-service/src/nutrition-plans/__tests__/storage-capacity.test.ts`  
       - ⛔ **DO NOT BUILD A NEW GATE — the mechanism already EXISTS.** `@kitchensink/contract-gen` exports `auditStorageCapacity` / `collectBoundedColumns` / `formatStorageCapacityFindings` (`packages/tools/contract-gen/src/storage-capacity.ts`), and a `storage-capacity.test.ts` already wires it in **all three** shipped services (recipe `src/database/__tests__/`, food `src/db/schema/__tests__/`, identity `src/types/schema/__tests__/`). Copy that pattern; do not hand-roll a second one — a second mechanism for one invariant is the failure GR-016 §16-a.2 forbids, one layer up. It reads drizzle **structurally** via `Symbol.for('drizzle:Columns')` (so `contract-gen` needs no `drizzle-orm` dependency) and zod bounds via the **public** `z.toJSONSchema`; it is already **exhaustive over columns**, with `stale-account` / `duplicate-account` findings as the reverse-direction check. The work here is the **mapping**: every bounded column bound to the wire fields that write it, or declared not-client-writable **with a reason** (GR-017 §17-d).
      **Depends on**: T-002, T-016  
       **Implements**: GR-016 §16-d, GR-017 §17-d  
       **Acceptance**: Lives **in the service**, imports **both** the drizzle schema and the authored zod (a test is not a wire schema, so §16-d's ban on the _production_ coupling is untouched), **derives** its enumeration of bounded columns from the drizzle schema, and asserts each writing wire field **rejects** a value the column cannot hold: `calories`, `protein_g`, `carbs_g`, `fat_g` against their `numeric(p,s)` precision/scale **and** against a non-negative floor, `ActivityLevel` / `Goal` / `ComplianceStatus` enum domains, `trainer_clients` status domain, nullability. Mapping completeness asserted in **BOTH** directions — every bounded column has an entry or an explicit reasoned exemption, every entry names a column that exists  
       **⛔ Asserted, never derived** — no zod generated from drizzle, no storage type imported into a `*.schema.ts`  
       **⚠️ A macro target of `-500` or `10 ** 12`calories makes the compliance calculation meaningless**, so these are range-bounded as a product decision, not merely to the column's floor.`numeric`precision overflow is the defect class that yields a`500`where the contract owed a`400`
**Tests**: unit (the parity assertions) **AND** integration (a precision-overflowing macro value posted to a real route yields`400`, not a failed `INSERT`)

- [ ] **T-018** [P3] [US-002] Enumerate and parse 009's non-HTTP ingress, with one rejection path — `packages/services/recipe-workers/src/handlers/`  
       **Depends on**: T-005, T-016  
       **Implements**: GR-016 §16-b, GR-018 §18-a/§18-b/§18-d, GR-019  
       **009's non-HTTP ingress, enumerated**: (1) the **nightly compliance rollup** — a scheduled invocation, which ADR-0017 decision 5 places in **`@kitchensink/recipe-workers`**, not the API process; (2) the **async AI swap-suggestion** response consumed off the queue (T-012). 009 has **no third-party webhook**  
       **Acceptance**: Each parses its event against an authored zod before it becomes work — **including the scheduled one**, because "the payload is ours" is an assumption about a deploy that has already drifted once. Rejections take **one** path carrying the cause in a **`reason`** field; a shape failure and a credential failure are **equally invalid** and differ only in `reason`. An invalid payload is **NEVER retried** — record it and **complete** the message, or dead-letter it **once** with the `reason`, and alarm DLQ depth; a transient dependency failure is a **different** `reason` and MAY retry  
       **⛔ No sentinel identifiers, and no row for a rejected event**: an unresolvable `nutrition_plan_id`, `client_id` or `trainer_id` is a **rejection**, never `'unknown'`/`''`/`0` — not in storage, not on a wire, not as a map key, and **not as a metrics dimension**, where it would fuse every unattributable rollup into one fictitious subject that cannot be told apart from a real one afterwards (GR-019)  
       **Tests**: unit (each envelope zod rejects every malformed variant; the rejection shape differs only in `reason`; an unresolvable id rejects rather than defaults) **AND** integration (an invalid payload is asserted **not** redriven and the per-`reason` counter increments, **and** a valid one still succeeds — both halves)

- [ ] **T-019** [P3] [US-001] Extend the typed recipe client for 009's endpoints, validating responses on receipt and bodies before send — `packages/clients/recipe-service/src/`  
       **Depends on**: T-016  
       **Implements**: GR-015 §15-b, GR-016 §16-c.2/§16-c.3, GR-017 §17-b.1–§17-b.4, §17-f (the **required** half)  
       **Acceptance**: `@kitchensink/recipe-service-client` gains the nutrition-plan, compliance and trainer methods, importing wire **types and runtime zod** from `@kitchensink/schema-recipe` and declaring **no** wire shape of its own (its `types.ts` holds only config, options and its own error shapes — including type-only declarations). Every response is parsed **the moment it arrives**; every outbound body is validated against the **callee's** schema-package zod **before** the call, so a malformed payload fails in the caller with a usable stack rather than as a remote `400`. The existing `packages/clients/recipe-service/src/contractSkew.ts` guard covers these endpoints once the hash changes — extend its test, do not add a second guard  
       **⛔ Do NOT add server-side response validation** — GR-016 §16-g defers a **producing service** parsing what it **emits**; that is an owner decision, not an unfinished task. This task is the **consumer** parsing what it **received** (GR-017 §17-f)  
       **Tests**: unit (a response with a missing, renamed and wrong-typed field each raise the typed parse error; an invalid outbound body is rejected before any fetch; `src/__tests__/contractSkew.test.ts` extended) **AND** integration (`src/__integration__/client.integration.test.ts` against a booted recipe service)

- [ ] **T-020** [P3] [US-001] Derive every web and mobile nutrition view model from the wire types, in lockstep — `packages/apps/commise/web`, `packages/apps/commise/mobile`  
       **Depends on**: T-019, T-009, T-010, T-011  
       **Implements**: GR-015 §15-b.3/§15-b.4, GR-017 §17-b.1, CODING_STANDARDS §14.1  
       **Acceptance**: No file in `@commise/web`, `@commise/mobile` or any feature package declares a nutrition request/response body type. The plan form model, the compliance dashboard series and the trainer client list are **DERIVED** from `@kitchensink/schema-recipe` with `Pick`/`Omit`/`Partial`/mapped types. Reference implementation: `packages/apps/commise/features/recipes/src/filters/model.ts`. ⚠️ **T-009, T-010 and T-011 are web-only; mobile parity is required by §14.1** and is part of this task — every user-facing feature ships to both platforms in the **same release**, with `.native.ts(x)` for platform-specific files. All copy goes through the localization path  
       **Tests**: unit (each derived model asserted assignable from its wire parent) **AND** **vitest component tests for EVERY path/state on both platforms** — loading, empty, populated, `on_track`/`over`/`under`, no-data, consent-not-granted, consent-revoked, premium-gated teaser, trainer-pending/active/revoked, swap-suggestion loading/failed — not a representative sample **AND** **Playwright** (web, extending T-015) **AND** a **Maestro** flow per story (mobile, `.maestro/*.yaml`) matching T-015 one-for-one

- [ ] **T-021** [P3] [US-004] ⛔ Boundary-validate the 005 AI edge, and record that no third-party API is called directly — `packages/services/recipe-service/src/nutrition-plans/swap-suggestions.service.ts`  
       **Depends on**: T-012, T-016  
       **Implements**: GR-015 §15-d, GR-016 §16-c.2/§16-c.3, GR-017 §17-b.6  
       **Acceptance**: The swap-suggestion call to 005 is a **service-to-service** edge, so it is bound by §15-b: the outbound body is validated against **005's** schema-package zod before the call and 005's response is parsed **on receipt**. 009 calls **no external API directly** — the **LLM provider** sits behind 005, so its raw shapes are **005's** boundary concern and must not enter `@kitchensink/schema-recipe`  
       **⛔ If a third-party API is ever called from here it is the OPPOSITE case**: validate the raw upstream shape at the boundary with its own zod, it **MAY declare its own types**, and it gets **NO OpenAPI document**. "Converging" such a client **deletes a validation boundary — a security regression, not a cleanup**, and `packages/clients/usda/src/schemas.ts` must **NEVER** be touched in this rule's name  
       **⚠️ Model output is INPUT to us**: whatever 005 returns is boundary-parsed before it reaches a macro calculation or a user, and a swap suggestion never echoes a health value it was not asked to  
       **Tests**: unit (a malformed outbound body is rejected before send; a malformed 005 response raises the typed parse error rather than propagating) **AND** integration (against a booted 005 surface, plus the graceful-degradation path when 005 is unavailable)

---

## Summary

| Task  | Description                                               | Phase         | Effort | Depends on                 |
| ----- | --------------------------------------------------------- | ------------- | ------ | -------------------------- |
| T-001 | DB migration                                              | Database      | S      | 006 schema                 |
| T-002 | Drizzle schema                                            | Database      | S      | T-001                      |
| T-003 | Macro calculator service                                  | Backend       | M      | T-002                      |
| T-004 | Nutrition plan CRUD API                                   | Backend       | M      | T-002, T-003, T-008, T-016 |
| T-005 | Meal plan link & compliance API                           | Backend       | S      | T-004                      |
| T-006 | Trainer-client relationship                               | Backend       | M      | T-002, T-008               |
| T-007 | Trainer nutrition plan APIs                               | Backend       | M      | T-006, T-004               |
| T-008 | GDPR consent middleware                                   | Cross-cutting | S      | T-002                      |
| T-009 | Web UI: plan creation                                     | Frontend      | M      | T-004                      |
| T-010 | Web UI: compliance dashboard                              | Frontend      | M      | T-005, T-009               |
| T-011 | Web UI: trainer-client management                         | Frontend      | M      | T-007, T-010               |
| T-012 | AI recipe swap suggestions                                | Backend       | L      | T-005                      |
| T-013 | Unit tests: macro calculator                              | Testing       | S      | T-003                      |
| T-014 | Integration tests: compliance API                         | Testing       | M      | T-005                      |
| T-015 | E2E tests: nutrition plan flow                            | Testing       | M      | T-010                      |
| T-016 | Author zod + regenerate `@kitchensink/schema-recipe`      | Contract      | M      | T-002                      |
| T-017 | Storage-floor boundary-parity test                        | Contract      | S      | T-002, T-016               |
| T-018 | Non-HTTP ingress parse + one rejection path               | Backend       | S      | T-005, T-016               |
| T-019 | Recipe client: 009 methods, receipt + outbound validation | Client        | M      | T-016                      |
| T-020 | Web + mobile derived view models (lockstep)               | Frontend      | M      | T-019, T-009, T-010, T-011 |
| T-021 | 005 AI edge boundary validation                           | Backend       | S      | T-012, T-016               |

**Total tasks**: 21  
**Effort**: S×7 · M×13 · L×1

⚠️ **T-016…T-021 close GR-017 §17-e.12.** Before this revision the file had **no** task for the schema package,
the `CONTRACT_HASH`/skew surface, or response validation on receipt, while `plan.md` stated the client
obligation in prose. An obligation with no task is an obligation that does not ship.
