# Feature Tasks: 013-cooking-school

**Branch**: `013-cooking-school`  
**Spec**: [`spec.md`](./spec.md)  
**Plan**: [`plan.md`](./plan.md)  
**Product Spec**: [`product-spec/product-spec.md`](./product-spec/product-spec.md)

---

## US Reference

| US ID  | Title (from plan.md)                                                |
| ------ | ------------------------------------------------------------------- |
| US-001 | Educator can create/publish a course with ordered lessons           |
| US-002 | Video upload/transcode/playback works for preview/enrolled          |
| US-003 | Learner can purchase and immediately access entitled content        |
| US-004 | Progress is persisted and completion threshold is correctly applied |
| US-005 | Educator dashboard surfaces enrollment/completion/revenue metrics   |

---

## Dependency Graph (tasks written in this file)

```
T-001 → T-003 → T-004 → T-005 → T-006
                                ↘ T-007 → T-008 → T-009
                                ↘ T-014 → T-026
                        ↘ T-010 → T-011 → T-012 → T-013
                                ↘ T-015
T-001 → T-002 → T-004
T-002 → T-016 → T-017
T-002 → T-018   (T-007 ↘ T-026)
T-002 → T-019
T-002 → T-020   (T-003 ↘ T-020)
T-002 → T-021   (T-008 ↘ T-021)
T-002 → T-022 → T-023 → T-027
                      ↘ T-028
              ↘ T-024
              ↘ T-025 → T-027
                      ↘ T-028
```

**Task count: 28** — T-001…T-015 service/authoring, T-016…T-021 contract drift gates + input validation,
T-022…T-026 the client half, T-027…T-028 web/mobile in lockstep.

> ⚠️ **T-002 now depends on T-001.** Zod is authored **inside** the service, so the service workspace must exist
> first. The previous graph had T-002 as a root because it created a standalone hand-maintained contracts package
> — the location `plan.md` L100-106 superseded.

---

## US-001 — Educator can create/publish a course with ordered lessons

- [ ] **T-001** [P1] [US-001] Bootstrap `cooking-school-api` NestJS workspace with Drizzle ORM and database config — `packages/services/cooking-school-service`
    - **Depends on**: —
    - **Implements**: [`spec.md` §In-Scope (course/lesson entities)](./spec.md#in-scope-v1), [`plan.md` §Proposed Workspaces](./plan.md#architecture-and-package-strategy)
    - **Acceptance**: `npm run build` passes; Drizzle config connects to PostgreSQL; health check endpoint alive.

- [ ] **T-002** [P1] [US-001] Author the wire contract as zod in the service, and generate the committed schema package — `packages/services/cooking-school-service/src/**/*.schema.ts` → `packages/schemas/cooking-school`
    - **Depends on**: T-001
    - **Implements**: [`spec.md` §API Surface](./spec.md#api-surface), [`spec.md` §Contract ownership (GR-015)](./spec.md#contract-ownership-gr-015), [`plan.md` §Proposed Workspaces](./plan.md#architecture-and-package-strategy), GR-015 §15-a, GR-017 §17-a.1/§17-a.3
    - **⛔ Supersedes the rejected location.** This task previously created `packages/shared/cooking-school-contracts` — a hand-maintained shared DTO package that `plan.md` L100-106 **superseded** because it is a **second author** of the wire contract. Zod is authored **in the service** beside the controller it serves; `packages/schemas/cooking-school` (`@kitchensink/schema-cooking-school`) is a **generated, committed COPY** of it. Do **not** re-create `packages/shared/cooking-school-contracts`, and do **not** hand-edit the schema package.
    - **Acceptance**: Course, lesson, enrollment, progress, playback-manifest and analytics shapes authored as zod at `src/courses/courses.schema.ts`, `src/lessons/lessons.schema.ts`, `src/enrollments/enrollments.schema.ts`, `src/progress/progress.schema.ts`, `src/playback/playback.schema.ts`, `src/analytics/analytics.schema.ts`, each beside its controller; every `*.schema.ts` imports **only `zod` and other `*.schema.ts` files**; `packages/schemas/cooking-school` exports `src/schemas.ts`, `src/types.ts` (`z.infer` only), `src/contract-hash.ts`, `src/index.ts` (named exports) and a **derived** `openapi.yaml`; the package carries **no** runtime dependency on NestJS, drizzle or aws-sdk. Reference shape: `packages/schemas/recipe`.
    - **⛔ Three things that look wrong and are not**: the copy is a literal **file copy** (zod are runtime values and cannot be derived from themselves); the `openapi.yaml` is **DERIVED output** for `oasdiff`/docs/integrators and is **NEVER a codegen input**; turbo wires the copy with `$TURBO_ROOT$` **`inputs`**, never `dependsOn` (T-016).
    - **Tests**: unit (every schema accepts a valid fixture and rejects a malformed one, per branch) **AND** integration (the generated package's exports resolve and its `CONTRACT_HASH` matches the service's authored sources).

- [ ] **T-003** [P1] [US-001] Define database schema and migrations for courses, lessons, enrollments, progress, video assets — `packages/services/cooking-school-service/src/db`
    - **Depends on**: T-001
    - **Implements**: [`spec.md` §In-Scope (lesson/course entities)](./spec.md#in-scope-v1), [`plan.md` §Data Model Plan](./plan.md#data-model-plan-drizzlepostgresql)
    - **Acceptance**: Migrations run successfully; invariants enforced (`course_enrollments` unique on `(course_id, learner_user_id)`; `lesson_progress.watch_percent` constrained `0..100`).

- [ ] **T-004** [P1] [US-001] Implement educator course CRUD endpoints (`POST /api/v1/courses`, `GET /api/v1/courses/:id`) — `packages/services/cooking-school-service/src/courses`
    - **Depends on**: T-002, T-003
    - **Implements**: [`spec.md` §API Surface POST/GET `/api/v1/courses`](./spec.md#api-surface), FR-001
    - **Acceptance**: Educator can create course with title, description, thumbnail, price; GET returns course detail with lesson list.

- [ ] **T-005** [P1] [US-001] Implement lesson management within course (`POST /api/v1/courses/:id/lessons`, ordering) — `packages/services/cooking-school-service/src/lessons`
    - **Depends on**: T-004
    - **Implements**: [`spec.md` §API Surface POST `/api/v1/courses/:id/lessons`](./spec.md#api-surface), FR-001, FR-002
    - **Acceptance**: Educator can add ordered lessons; `GET /api/v1/courses/:id` reflects sequence; publish/unpublish lifecycle works.

- [ ] **T-006** [P1] [US-001] Integrate `CreatorProfile` (012) for educator identity in course metadata — `packages/services/cooking-school-service/src/courses`
    - **Depends on**: T-004
    - **Implements**: [`spec.md` §Cross-Feature Touches 012](./spec.md#cross-feature-touches), FR-009
    - **Acceptance**: Course creator resolved from 012 `CreatorProfile`; no separate educator profile table in 013 schema.

## US-002 — Video upload/transcode/playback works for preview and enrolled states

- [ ] **T-007** [P1] [US-002] Build video upload intent and presigned URL flow — `packages/services/cooking-school-service/src/media`
    - **Depends on**: T-003
    - **Implements**: [`spec.md` §In-Scope (video upload)](./spec.md#in-scope-v1), FR-002
    - **Acceptance**: Educator requests upload URL; API returns presigned PUT for S3 object storage; `lesson_video_assets` row created with `status=pending`.

- [ ] **T-008** [P1] [US-002] Implement `cooking-school-video-worker` for transcode callback and status projection — `packages/services/cooking-school-workers`
    - **Depends on**: T-007
    - **Implements**: [`spec.md` §In-Scope (transcode pipeline)](./spec.md#in-scope-v1), [`plan.md` §Core Runtime Components (Media Pipeline)](./plan.md#core-runtime-components)
    - **Acceptance**: Worker ingests MediaConvert completion event; updates `lesson_video_assets` with HLS manifest URL and `status=ready`.

- [ ] **T-009** [P1] [US-002] Implement lesson playback endpoint with preview vs enrolled gating — `packages/services/cooking-school-service/src/playback`
    - **Depends on**: T-008
    - **Implements**: [`spec.md` §API Surface GET `/api/v1/lessons/:id`](./spec.md#api-surface), FR-002, FR-004, FR-008
    - **Acceptance**: First lesson accessible without enrollment; subsequent lessons require active enrollment entitlement; returns CloudFront-signed HLS manifest.

## US-003 — Learner can purchase and immediately access entitled content

- [ ] **T-010** [P1] [US-003] Build enrollment adapter integrating 010 purchase lifecycle — `packages/services/cooking-school-service/src/enrollments`
    - **Depends on**: T-003, T-004
    - **Implements**: [`spec.md` §API Surface POST `/api/v1/courses/:id/enroll`](./spec.md#api-surface), FR-003, FR-008
    - **Acceptance**: Payment confirmation from 010 creates idempotent `course_enrollments` row; learner can access non-preview lessons immediately.

- [ ] **T-015** [P2] [US-003] Emit publish/enroll events for 014-notification-service integration — `packages/services/cooking-school-service/src/events`
    - **Depends on**: T-005, T-010
    - **Implements**: [`plan.md` §Cross-Feature Dependency Plan 014](./plan.md#cross-feature-dependency-plan)
    - **Acceptance**: Typed events emitted on course publish and learner enrollment; the event envelopes are authored as zod at `packages/services/cooking-school-service/src/events/events.schema.ts` and reach consumers through **`@kitchensink/schema-cooking-school`** (⛔ **not** `cooking-school-contracts` — that location was superseded by `plan.md` L100-106; see T-002); 014 can consume via SQS/EventBridge.
    - **Tests**: unit (envelope zod rejects a missing/renamed/extra field) **AND** integration (a published event round-trips through the real queue and parses against the schema package's zod on receipt).

## US-004 — Progress is persisted and completion threshold is correctly applied

- [ ] **T-011** [P1] [US-004] Implement learner progress tracking (`watch_percent`, completion threshold ≥80%) — `packages/services/cooking-school-service/src/progress`
    - **Depends on**: T-010
    - **Implements**: [`spec.md` §API Surface PATCH `/api/v1/lessons/:id/progress`](./spec.md#api-surface), FR-005
    - **Acceptance**: `PATCH` updates `watch_percent`; `completed_at` set automatically when `≥80%`; `GET /api/v1/learners/me/progress` returns aggregate progress across courses.

## US-005 — Educator dashboard surfaces enrollment/completion/revenue metrics

- [ ] **T-012** [P1] [US-005] Build educator analytics dashboard endpoint — `packages/services/cooking-school-service/src/analytics`
    - **Depends on**: T-010, T-011
    - **Implements**: [`spec.md` §API Surface GET `/api/v1/educators/me/dashboard`](./spec.md#api-surface), FR-006
    - **Acceptance**: Dashboard returns enrollment count, lesson completion rate, and revenue per course; aggregates computed from `course_enrollments`, `lesson_progress`, `educator_revenue_ledger`.

- [ ] **T-013** [P1] [US-005] Implement revenue ledger and revenue-share calculation (20/80, pro 15/85) — `packages/services/cooking-school-service/src/revenue`
    - **Depends on**: T-012
    - **Implements**: [`spec.md` §Cross-Feature Touches 010 (revenue share)](./spec.md#cross-feature-touches), FR-010
    - **Acceptance**: Revenue entry created on each enrollment; tiered split calculated from educator 010 subscription tier; ledger compatible with 010 payout schedule.

## Cross-US — AI-assisted authoring (Should Have)

- [ ] **T-014** [P2] [US-001] Implement AI draft script adapter calling 005 with recipe context and circuit breaker — `packages/services/cooking-school-service/src/ai-draft`
    - **Depends on**: T-005
    - **Implements**: [`spec.md` §API Surface POST `/api/v1/lessons/:id/draft-script`](./spec.md#api-surface), FR-007
    - **Acceptance**: Endpoint returns structured draft from 005; fails gracefully on AI outage (fallback returns empty draft + message); linked `recipe_id` context included in request payload.

## Cross-US — Contract drift gates & input validation (GR-015 §15-c, GR-016, GR-017 §17-a)

- [ ] **T-016** [P1] [US-001] Declare the `contract:generate` script and wire the turbo `$TURBO_ROOT$` `inputs` for the copy — `packages/services/cooking-school-service/package.json`, `turbo.json`
    - **Depends on**: T-002
    - **Implements**: GR-015 §15-c (rebuild + correctness layers), GR-017 §17-a.2, [`plan.md` §Contract ownership and drift (GR-015)](./plan.md#contract-ownership-and-drift-gr-015)
    - **Acceptance**: `contract:generate` is declared so `scripts/contractOwners.mjs` `discoverContractOwners` finds the service without a list edit, and `npm run contract:verify` regenerates and fails on any diff against the committed artifacts; `turbo.json` gives `@kitchensink/schema-cooking-school#build` `$TURBO_ROOT$`-anchored **`inputs`** covering the service's `src/**/*.schema.ts`.
    - **⛔ NOT `dependsOn`.** `schema-<service>#build` `dependsOn` `<service>#build` is unavailable and must not be re-proposed — the service devDepends on its own client for the contract test tier, so that edge closes the cycle `client → schema → service → client` and turbo rejects the graph. The generated files are committed, so ordering was never the requirement; content-hashed `inputs` are.
    - **Tests**: unit (a `src/__tests__/build-inputs.test.ts` asserting every authored `*.schema.ts` is covered by the declared `inputs` glob, modelled on `packages/services/recipe-service/src/__tests__/build-inputs.test.ts`) **AND** integration (the regenerate-and-diff gate `scripts/contractDriftGate.mjs` runs clean on a fresh checkout and fails on a hand-edited schema package).

- [ ] **T-017** [P1] [US-001] Assert `CONTRACT_HASH` equality at boot and fail to boot on mismatch — `packages/services/cooking-school-service/src/main.ts`
    - **Depends on**: T-002, T-016
    - **Implements**: GR-015 §15-c (skew layer), GR-017 §17-a.4, [`plan.md` §Contract ownership and drift (GR-015)](./plan.md#contract-ownership-and-drift-gr-015)
    - **Acceptance**: The service compares its own `CONTRACT_HASH` against `@kitchensink/schema-cooking-school`'s at boot and **refuses to start** on mismatch, before the HTTP listener binds. This is the only layer that catches a **deployed** service running ahead of a released mobile player's pinned schema — the case that fails open on gated video.
    - **Tests**: unit (a `src/__tests__/main-boot-order.test.ts` asserting the assertion runs **before** `listen()` and that a mismatched hash throws, modelled on `packages/services/recipe-service/src/__tests__/main-boot-order.test.ts`) **AND** integration (boot the app with a deliberately skewed hash and assert no port is bound).

- [ ] **T-018** [P1] [US-001] Register **`nestjs-zod`'s** `ZodValidationPipe` as the single validation mechanism, and prove it with a known-bad-body route test — `packages/services/cooking-school-service/src/app.module.ts`
    - **Depends on**: T-002
    - **Implements**: [`spec.md` §Input validation (GR-016)](./spec.md#input-validation-gr-016), GR-016 §16-a/§16-e.1, GR-017 §17-a.5
    - **⚠️ The failure this exists to catch is invisible by construction.** Under Nest's **own** `ValidationPipe`, a `createZodDto` DTO **validates nothing while looking correctly wired** — schema present, DTO referenced, route reads as validated, no input checked. This already bit identity's `PATCH /users/me`, a route that writes user data. Bind **`nestjs-zod`'s** pipe through `APP_PIPE`, never Nest's own, and never to the bare class token.
    - **Acceptance**: Every course, lesson, enrollment, progress, playback, AI-assist and analytics route takes a `createZodDto` DTO derived from the T-002 zod for its body, path params and query params; there is **exactly one** validation mechanism in the service and **no `class-validator` decorator set** anywhere in it; validation failure takes **one** path producing a `400` that names the offending field(s) and never echoes a value.
    - **⚠️ Parse before you authorise.** A lesson id, preview flag or enrollment token that reaches the entitlement decision unparsed can **fail open** and serve gated video. Parse, then authorise, then serve.
    - **Tests**: unit (per-DTO accept/reject) **AND** integration (post a known-bad body to a **real** route through a booted app and assert the `400` and its field name — this is the **only** thing that can observe the wrong-pipe failure; modelled on `packages/services/identity/tests/app-validation.test.ts`) **AND** e2e (`tests/e2e/*.e2e.test.ts` drives the gated playback route over HTTP against real Postgres + LocalStack) **AND** k6 (`packages/tools/loadtest/` asserts the validation path does not regress the service's latency SLO).

- [ ] **T-019** [P1] [US-001] Use `z.strictObject()` for every mutating request body — `packages/services/cooking-school-service/src/**/*.schema.ts`
    - **Depends on**: T-002
    - **Implements**: GR-016 §16-e.2, GR-017 §17-c, [`plan.md` §Input validation (GR-016)](./plan.md#input-validation-gr-016)
    - **Acceptance**: Every `POST`/`PUT`/`PATCH`/`DELETE`-with-body schema (course create/update, lesson create/reorder, enroll, progress update, draft-script request) uses `z.strictObject()`. Plain `z.object()` appears only on a **read** surface and only with a forward-compatibility reason documented at the schema.
    - **⚠️ Why the default is strict**: `z.object()` **strips unknown keys silently**, so a client that misspells `watchPercent` gets a `200` and a partial write it was told succeeded. On a mutating body, silence is the worse failure.
    - **Tests**: unit (each mutating schema rejects an unknown key with a `400`-mapped issue) **AND** integration (an unknown key posted to a real mutating route yields `400`, not `200`-with-silent-strip).

- [ ] **T-020** [P1] [US-004] Add the storage-floor boundary-parity test — `packages/services/cooking-school-service/src/__tests__/storage-capacity.test.ts`
    - ⛔ **DO NOT BUILD A NEW GATE — the mechanism already EXISTS.** `@kitchensink/contract-gen` exports `auditStorageCapacity` / `collectBoundedColumns` / `formatStorageCapacityFindings` (`packages/tools/contract-gen/src/storage-capacity.ts`), and a `storage-capacity.test.ts` already wires it in **all three** shipped services (recipe `src/database/__tests__/`, food `src/db/schema/__tests__/`, identity `src/types/schema/__tests__/`). Copy that pattern; do not hand-roll a second one — a second mechanism for one invariant is the failure GR-016 §16-a.2 forbids, one layer up. It reads drizzle **structurally** via `Symbol.for('drizzle:Columns')` (so `contract-gen` needs no `drizzle-orm` dependency) and zod bounds via the **public** `z.toJSONSchema`; it is already **exhaustive over columns**, with `stale-account` / `duplicate-account` findings as the reverse-direction check. The work here is the **mapping**: every bounded column bound to the wire fields that write it, or declared not-client-writable **with a reason** (GR-017 §17-d).
    - **Depends on**: T-003, T-002
    - **Implements**: GR-016 §16-d, GR-017 §17-d, [`spec.md` §Input validation (GR-016)](./spec.md#input-validation-gr-016)
    - **Acceptance**: The test lives **in the service** (never in the schema package, never in a wire schema), imports **both** the drizzle schema and the authored zod — a test is not a wire schema, so §16-d's ban on the _production_ coupling is not weakened — **derives** the enumeration of bounded columns from the drizzle schema rather than typing it out, and asserts for each writing wire field that the zod **rejects** a value the column cannot hold: lesson `order`/duration integers against the `int4` ceiling **2,147,483,647**, `lesson_progress.watch_percent` against its `0..100` constraint, `price_cents`, status enum domains, `varchar(N)` lengths, nullability. The field→column mapping is authored and its completeness is asserted in **BOTH** directions — every bounded column has an entry or an explicit reasoned exemption, and every entry names a column that exists.
    - **⛔ Asserted, never derived**: no zod generated from drizzle, and no storage type imported into a `*.schema.ts`. Satisfying the floor by deriving zod from drizzle is a violation of GR-016 §16-d **and** GR-015 §15-a.5.
    - **⚠️ Stated limitation**: this proves the floor for the columns it maps. Only the "every bounded column has an entry" direction can catch a **new** column, and only if the enumeration is derived. Derive it.
    - **Tests**: unit (the parity assertions themselves) **AND** integration (a value at the column ceiling +1 posted to a real route yields `400`, not a failed `INSERT` surfacing as `500` — the defect class recipe shipped on five int-backed fields).

- [ ] **T-021** [P1] [US-002] Parse every non-HTTP ingress against an authored zod, and take one rejection path — `packages/services/cooking-school-service/src/media`, `packages/services/cooking-school-workers/src/handlers`
    - **Depends on**: T-008, T-002
    - **Implements**: GR-016 §16-b, GR-018 §18-a/§18-b/§18-d, [`plan.md` §Input validation (GR-016)](./plan.md#input-validation-gr-016)
    - **013's non-HTTP ingress, enumerated**: (1) the **transcode provider's status callback** — an inbound external request; (2) the **transcode/status event envelope** consumed by `cooking-school-workers`; (3) the publish/enroll events emitted for 014 (T-015). There is no scheduled invocation in 013 today; if one is added it parses its event too.
    - **Acceptance**: The transcode callback **authenticates first and validates its schema second** — ⚠️ a signature proves **origin, not shape**, and this payload decides whether a lesson becomes playable, so both controls are required, in that order, never one instead of the other. The worker parses the envelope **on receipt** (the two deployables version independently). Rejections take **one** path per ingress carrying the cause in a **`reason`** field; a shape failure and a signature failure are **equally invalid** and differ only in `reason`.
    - **⚠️ An invalid payload is NEVER retried.** The worker records the rejection and **completes** the message (or dead-letters it **once**, with the `reason`) rather than redriving it — an invalid payload cannot become valid by being sent again. The transcode provider is a signature-verifying third-party sender, so an invalid body is answered **`2xx`** with the rejection in the response body, in structured logs, in a per-`reason` counter, and **alarmed** (GR-018 §18-c). The rejected event is **NOT recorded as a row** — an invalid payload has no trustworthy identifier, and inventing one is the sentinel GR-019 forbids.
    - **Tests**: unit (envelope zod rejects each malformed variant; the rejection shape differs only in `reason`) **AND** integration (an invalid callback body yields `2xx` + an incremented per-`reason` counter, **and** a valid body still yields its normal success — both halves, or the test passes on a handler that always returns `200`; an invalid queue payload is asserted **not** redriven).

## Cross-US — Client half: the typed client, receipt validation and skew (GR-015 §15-b, GR-017 §17-b, §17-e.12)

> ⚠️ **This half was entirely absent from this task list.** 013's tasks were 100% service-side while its
> `spec.md` L134-138 makes the client half **separately mandatory** and singles out the **playback manifest** and
> the **entitlement decision** as the shapes whose drift **fails open on gated video**. An obligation with no task
> is an obligation that does not ship (GR-017 §17-e.12).

- [ ] **T-022** [P1] [US-002] Create the typed client that declares no wire shape of its own — `packages/clients/cooking-school`
    - **Depends on**: T-002
    - **Implements**: [`spec.md` §Contract ownership (GR-015)](./spec.md#contract-ownership-gr-015), GR-015 §15-b.1/§15-b.2, GR-017 §17-b.1/§17-b.2
    - **Acceptance**: The client imports its wire **types and runtime zod** from `@kitchensink/schema-cooking-school` and depends on that **leaf**, never on `@kitchensink/cooking-school-service` (the boundary `packages/infra/global/__tests__/app-service-dependency.test.ts` already enforces). Its own `types.ts` holds **only** genuinely client-side types — config, options, its own error shapes — and **no** request or response body type, including type-only declarations. Reference: `packages/clients/recipe-service`.
    - **Tests**: unit (every method's happy path and every mapped error status) **AND** integration (`src/__integration__/*.integration.test.ts` against a booted service, modelled on `packages/clients/recipe-service/src/__integration__/client.integration.test.ts`).

- [ ] **T-023** [P1] [US-002] Validate every response on receipt and every outbound body before the call — `packages/clients/cooking-school/src/client.ts`
    - **Depends on**: T-022
    - **Implements**: GR-016 §16-c.2/§16-c.3, GR-017 §17-b.3/§17-b.4, §17-f (the **required** half)
    - **Acceptance**: Every response body is parsed with the schema package's zod **at the moment it arrives** — the playback manifest and the entitlement decision first, since a drifted field there fails open on gated video. Every outbound body is validated against the **callee's** schema-package zod **before** the call, so a malformed payload fails in the caller with a usable stack rather than as a remote `400`. A parse failure is a typed client error naming the field, never a silent cast.
    - **⛔ Do NOT add server-side response validation.** GR-016 §16-g defers a **producing service** parsing what it **emits**; that is an owner decision, not an unfinished task. This task is the **consumer** parsing what it **received** (GR-017 §17-f) — the two are different things and only this one is required.
    - **Tests**: unit (a response missing a field, with a renamed field, and with a wrong-typed field each raise the typed parse error; an invalid outbound body is rejected before any fetch is attempted) **AND** integration (a live service response parses clean, and a hand-skewed fixture does not).

- [ ] **T-024** [P1] [US-002] Add the contract-skew guard — `packages/clients/cooking-school/src/contractSkew.ts`
    - **Depends on**: T-022
    - **Implements**: GR-015 §15-c (skew layer), GR-017 §17-b.5
    - **Acceptance**: The client detects a pinned-stale `@kitchensink/schema-cooking-school` rather than leaving it to be inferred from a runtime parse failure, modelled on `packages/clients/food-service/src/contractSkew.ts` and `packages/clients/recipe-service/src/contractSkew.ts`. The guard must not **overclaim**: it reports what it actually compared.
    - **Tests**: unit (`src/__tests__/contractSkew.test.ts`, modelled on the two existing ones — a matching hash passes, a skewed hash is reported, and the report names the two hashes) **AND** integration (the guard run against the live service's advertised hash).

- [ ] **T-025** [P1] [US-002] Make every consumer import the schema/client leaf and declare no cooking-school wire type — `packages/clients/cooking-school`, `packages/services/cooking-school-workers`, `@commise/web`, `@commise/mobile`
    - **Depends on**: T-022
    - **Implements**: GR-015 §15-b.3/§15-b.4, GR-017 §17-b.1
    - **Acceptance**: No file in any client, app or feature package declares a cooking-school request/response body type. Where a consumer's shape **genuinely differs** — the player's lesson view model, the educator dashboard's series model — it is **DERIVED** from the wire type with `Pick`/`Omit`/`Partial`/mapped types, never independently declared. Reference implementation: `packages/apps/commise/features/recipes/src/filters/model.ts`. The transcode/status envelope is authored **once** and imported by both deployables, never declared per deployable.
    - **Tests**: unit (each derived view model is asserted to be assignable from its wire parent, so a wire change breaks the derivation rather than drifting past it) **AND** integration (a parser-based guard over `git ls-files` asserting no client/app file declares a wire shape, modelled on `packages/infra/global/__tests__/app-service-dependency.test.ts` — ⚠️ this repo-wide guard **does not exist yet**, see GR-017's enforcement table).

- [ ] **T-026** [P1] [US-002] ⛔ Boundary-validate the third-party APIs — and do **not** converge them — `packages/services/cooking-school-service/src/media`, `src/ai-draft`
    - **Depends on**: T-007, T-014
    - **Implements**: GR-015 §15-d, GR-017 §17-b.6, `plan.md` → _⚠️ Third-party APIs — the opposite case, do NOT converge them (GR-015 §15-d)_
    - **⛔ This is the OPPOSITE case, and "converging" it deletes a validation boundary — a security regression, not a cleanup.** The **transcode provider** (including its inbound status/callback payloads) and the **LLM provider** behind `draft-script` are APIs the platform does **not** serve. There is no service of ours to own their types and their contracts cannot be trusted.
    - **Acceptance**: Each adapter **validates the raw upstream wire shape at the boundary with its own zod**, the moment a body arrives; each **MAY declare its own types**, and the normalized type it returns **deliberately differs** from the raw upstream shape (our playback-manifest shape is ours, not the provider's); **no OpenAPI document is written** for either. Rules 17-b.1–17-b.5 do **not** apply to these adapters. The LLM's draft-script output is **INPUT to us** and its boundary parse is **required** by GR-016, not merely permitted by §15-d. Payments stay behind 010, so **Stripe's shapes never enter `@kitchensink/schema-cooking-school`**.
    - **⛔ `packages/clients/usda/src/schemas.ts` is the reference implementation and must NEVER be touched in this rule's name.**
    - **Tests**: unit (each boundary schema rejects a renamed, missing, wrong-typed and extra-membered upstream field, and the normalized output is asserted independent of the raw shape) **AND** integration (recorded real upstream payloads parse clean; a mutated one is rejected at the boundary rather than downstream).

## Cross-US — Web and mobile clients, in lockstep (CODING_STANDARDS §14.1)

> ⚠️ 013 had **no** web, mobile or player task at all. Every user-facing surface ships to **both** platforms in
> the same release; the two tasks below are a matched pair and neither may land alone.

- [ ] **T-027** [P1] [US-002] Build the web learner player and educator surfaces on derived types — `packages/apps/commise/web`
    - **Depends on**: T-022, T-023, T-025
    - **Implements**: [`spec.md` §Contract ownership (GR-015)](./spec.md#contract-ownership-gr-015) (client half), FR-002, FR-004, FR-005, FR-006, CODING_STANDARDS §14.1
    - **Acceptance**: Course catalog/detail, the HLS lesson player with preview-vs-enrolled gating, progress reporting and the educator dashboard consume `@kitchensink/cooking-school-client` and **derive** every view model from `@kitchensink/schema-cooking-school` with `Pick`/`Omit`/`Partial`. The player renders the **entitlement decision the service returned** and never re-derives it client-side — a locally recomputed gate is the fail-open path. All user-facing copy goes through the localization path; no hard-coded literals.
    - **Tests**: **vitest component tests for EVERY path/state** — loading, empty catalog, preview-only, entitled, gated/locked, transcode-pending, transcode-failed, playback error, progress-saving, progress-save-failed, completed, educator-empty-dashboard, educator-populated — not a representative sample **AND** **Playwright** (`tests/e2e/*.spec.ts`, `getByRole`/`getByLabel` only, no `data-testid`, no `waitForTimeout`) for each happy-path story: purchase→immediate access, preview lesson without enrollment, gated lesson blocked, progress persists across reload, educator dashboard metrics.

- [ ] **T-028** [P1] [US-002] Build the mobile learner player and educator surfaces in lockstep — `packages/apps/commise/mobile`
    - **Depends on**: T-022, T-023, T-025
    - **Implements**: same as T-027, CODING_STANDARDS §14.1 (lockstep parity), §14.3 (`.native.tsx` suffix)
    - **Acceptance**: Mobile ships the same surfaces in the **same release** as T-027, sharing business logic, derived view models and the client package; platform-specific implementations use the `.native.ts(x)` suffix (never `.mobile.*`). The **playback manifest and entitlement decision are consumed from the shared derived types**, never re-typed per platform — a hand-written parallel type on either platform can drift by one field and fail open on gated video with `typecheck` green. Offline download stays out of scope (FR-017, Future).
    - **Tests**: **vitest component tests (`.native`) for every path/state listed in T-027** **AND** a **Maestro** flow (`.maestro/*.yaml`) per happy-path story matching T-027's Playwright specs one-for-one.
