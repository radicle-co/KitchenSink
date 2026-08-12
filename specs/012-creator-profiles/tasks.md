# Tasks: Feature 012 — Public Creator Profiles

**Feature**: `012-creator-profiles`  
**Spec**: [spec.md](./spec.md)  
**Plan**: [plan.md](./plan.md)  
**Product Spec**: [product-spec/product-spec.md](./product-spec/product-spec.md)

---

## US Reference

| ID     | Persona   | Story                                         | Spec FR                                        |
| ------ | --------- | --------------------------------------------- | ---------------------------------------------- |
| US-001 | P11 Robin | Claim a unique `@handle`                      | FR-001, FR-002, FR-003, FR-005                 |
| US-002 | P11 Robin | Organize recipes into named collections       | FR-017, FR-018, FR-019                         |
| US-003 | P5 Morgan | Follow/unfollow a creator                     | FR-013, FR-014, FR-015, FR-016                 |
| US-004 | P5 Morgan | Browse a creator's profile without logging in | FR-006, FR-007, FR-008, FR-009, FR-010..FR-012 |
| US-005 | P9 Drew   | Embed widget for external website             | FR-026, FR-027                                 |
| US-006 | P11 Robin | View profile views and follower growth        | FR-023, FR-024, FR-025                         |

---

## Dependency Graph

```text
T-001 -> T-002 -> T-003 -> T-004 -> T-005
T-005 -> T-006 -> T-007 -> T-008 -> T-009 -> T-010
T-007 -> T-011
T-008 -> T-012 -> T-013 -> T-014 -> T-015
T-015 -> T-016 -> T-017
T-017 -> T-018 -> T-019 -> T-020 -> T-021
T-019 -> T-022 -> T-023 -> T-024 -> T-025
T-018 -> T-026
T-022 -> T-026
T-019 -> T-027 -> T-028 -> T-029
T-027 -> T-030 -> T-031
T-029 -> T-032
T-011 -> T-033 -> T-034 -> T-035
T-026 -> T-036 -> T-037
T-030 -> T-038
T-037 -> T-039
T-036 -> T-040

# Phase 1 contract ownership & drift gates — MUST precede the first endpoint (T-009)
T-001 -> T-056 -> T-057 -> T-058
T-002 -> T-056
T-056 -> T-059 -> T-009
T-056 -> T-060   (T-006, T-019, T-025, T-034 -> T-060)
T-056 -> T-061   (T-028, T-035, T-043 -> T-061)

# Phase 1 client half
T-056 -> T-062 -> T-063 -> T-065
                        -> T-066
              -> T-064
T-044 -> T-066
T-045 -> T-066
```

⛔ **T-056 gates T-009.** `plan.md` L94-96 forbids deferring the schema package and the three drift gates past
Phase 1, so the first endpoint must not land before the contract it serves is authored and gated.

---

## US-001 — Claim & Manage @handle

> ⛔ **Phase 1 (T-001…T-005) is incomplete as written.** `plan.md` L94-96 requires Phase 1 to create the schema
> package **and wire all three drift gates** — "not defer them; a service that ships without them is where drift
> starts." No task did that. **T-056…T-060 are those Phase-1 tasks**, and T-009 (the first endpoint) must not
> land before T-056.

- [ ] **T-001** [P] [US-001] Scaffold `@kitchensink/creator-profiles-service` package with tsconfig, lint, and test wiring aligned to Node 24 + NestJS 11 — `packages/services/creator-profiles-service/package.json`
- [ ] **T-002** [P] [US-001] Register workspace wiring for creator-profiles-api in root package/turbo config — `packages/services/creator-profiles-service/`
- [ ] **T-003** [P] [US-001] Add env schema and config surfaces (DB, S3, cache headers, scheduler cadence) — `packages/services/creator-profiles-service/src/config/`
- [ ] **T-004** [US-001] Wire shared type dependencies to `@kitchensink/recipe-core` and forbid local duplicate core entities — `packages/services/creator-profiles-service/src/domain/`
- [ ] **T-005** [US-001] Add route prefix guardrails enforcing `/api/v1/*` across all 012 endpoints — `packages/services/creator-profiles-service/src/common/guards/`
- [ ] **T-006** [P] [US-001] Create migration for `creator_profiles` table: handle uniqueness, profile metadata, moderation state, lifecycle timestamps — `packages/services/creator-profiles-service/src/db/migrations/`
- [ ] **T-007** [US-001] Add DB constraints/checks for handle format (3–30 chars, lowercase alphanumeric + underscore, no consecutive/leading/trailing underscore) — `packages/services/creator-profiles-service/src/db/migrations/`
- [ ] **T-008** [US-001] Add migration tests validating handle uniqueness and format constraints — `packages/services/creator-profiles-service/src/db/migrations/__tests__/`
- [ ] **T-009** [P] [US-001] Implement `POST /api/v1/creators` handle claim endpoint with auth, validation, and HTTP 409 conflict — `packages/services/creator-profiles-service/src/creators/`
- [ ] **T-010** [US-001] Implement owner profile update (`PUT /api/v1/creators/:handle`) with field bounds and avatar metadata — `packages/services/creator-profiles-service/src/creators/`
- [ ] **T-011** [US-001] Implement handle change cooldown/reservation policy (once per 30 days, previous handle reserved 14 days) — `packages/services/creator-profiles-service/src/creators/policies/`
- [ ] **T-012** [US-001] Implement profile deactivate/suspend-aware lifecycle for public visibility transitions — `packages/services/creator-profiles-service/src/creators/`

## US-004 — Public Profile Browse (SSR + SEO)

- [ ] **T-013** [P] [US-004] Implement public profile read endpoint (`GET /api/v1/creators/:handle`) with strict public payload schema — `packages/services/creator-profiles-service/src/creators/`
- [ ] **T-014** [US-004] Implement profile SEO/canonical metadata builder for SSR consumers — `packages/services/creator-profiles-service/src/creators/seo/`
- [ ] **T-015** [P] [US-004] Implement `/@handle` SSR route with profile API payloads and SEO metadata contract — `packages/apps/commise/web/src/app/[locale]/(profile)/[handle]/`
- [ ] **T-016** [US-004] Implement profile page sections: bio, avatar, follower count, public collections, paginated public recipes — `packages/apps/commise/web/src/app/[locale]/(profile)/[handle]/`
- [ ] **T-017** [US-004] Add recipe attribution link component linking public recipes back to creator profile — `packages/apps/commise/web/src/components/creator-attribution/`
- [ ] **T-018** [US-004] Implement profile route accessibility/usability smoke checks (desktop + mobile responsive) — `packages/apps/commise/web/tests/e2e/creator-profile.spec.ts`

## US-002 — Public Collections

- [ ] **T-019** [P] [US-002] Create migration for `creator_collections` with ownership, name/description constraints, and ordering position — `packages/services/creator-profiles-service/src/db/migrations/`
- [ ] **T-020** [US-002] Create migration for `creator_collection_recipes` join table with stable ordering and public-recipe-only membership — `packages/services/creator-profiles-service/src/db/migrations/`
- [ ] **T-021** [P] [US-002] Implement collections list/detail endpoints for public view with ownership/publicity enforcement — `packages/services/creator-profiles-service/src/collections/`
- [ ] **T-022** [US-002] Implement owner collection CRUD endpoints with max 20 collections and 60-char name / 200-char description limits — `packages/services/creator-profiles-service/src/collections/`
- [ ] **T-023** [US-002] Implement collection reordering persistence and deterministic response ordering — `packages/services/creator-profiles-service/src/collections/`
- [ ] **T-024** [US-002] Add collection UI components to profile page with shareable collection URLs — `packages/apps/commise/web/src/components/creator-collections/`

## US-003 — Follow / Unfollow

- [ ] **T-025** [P] [US-003] Create migration for `creator_follows` with composite PK (`follower_id`, `creator_id`) and follower/following indexes — `packages/services/creator-profiles-service/src/db/migrations/`
- [ ] **T-026** [P] [US-003] Implement follow endpoint (`POST /api/v1/creators/:handle/follow`) with idempotency guarantees — `packages/services/creator-profiles-service/src/follows/`
- [ ] **T-027** [P] [US-003] Implement unfollow endpoint (`DELETE /api/v1/creators/:handle/follow`) with idempotency and counter integrity — `packages/services/creator-profiles-service/src/follows/`
- [ ] **T-028** [P] [US-003] Implement follower/following count projection with ≤5s bounded consistency target — `packages/services/creator-profiles-service/src/follows/projector/`
- [ ] **T-029** [US-003] Implement authenticated follow/unfollow interactions on profile page with optimistic UX and rollback — `packages/apps/commise/web/src/components/follow-button/`

## US-005 — Embed Widget

- [ ] **T-030** [P] [US-005] Implement embed widget endpoint (`GET /api/v1/creators/:handle/widget`) returning static HTML fragment (no JS) — `packages/services/creator-profiles-service/src/widget/`
- [ ] **T-031** [P] [US-005] Enforce widget cache headers (`Cache-Control: public, max-age=300`) and CDN compatibility — `packages/services/creator-profiles-service/src/widget/`
- [ ] **T-032** [US-005] Validate widget payload includes avatar, displayName, followerCount, and 3 most-recent public recipes only — `packages/services/creator-profiles-service/src/widget/__tests__/`
- [ ] **T-033** [US-005] Add widget accessibility/usability smoke checks for desktop and mobile — `packages/apps/commise/web/tests/e2e/creator-widget.spec.ts`

## US-006 — Creator Analytics

- [ ] **T-034** [P] [US-006] Create migration for `creator_analytics_snapshots` with aggregate-only fields and creator/date query indexes — `packages/services/creator-profiles-service/src/db/migrations/`
- [ ] **T-035** [P] [US-006] Implement daily analytics snapshot Lambda job over internal event data with aggregate-only fields — `packages/services/creator-profiles-service/src/analytics/jobs/`
- [ ] **T-036** [P] [US-006] Implement owner-only analytics endpoint (`GET /api/v1/creators/:handle/analytics`) with strict authz checks — `packages/services/creator-profiles-service/src/analytics/`
- [ ] **T-037** [US-006] Enforce analytics privacy requirements (no visitor identifiers/IPs in storage or responses) — `packages/services/creator-profiles-service/src/analytics/filters/`
- [ ] **T-038** [US-006] Add analytics dashboard UI component for creator view with 7d/30d views, follower delta, top recipes — `packages/apps/commise/web/src/components/creator-analytics/`

## Cross-cutting: Moderation, Privacy, Integration

- [ ] **T-039** [US-004] Implement moderation suspension workflow hooks that hide profile and block new follows — `packages/services/creator-profiles-service/src/moderation/`
- [ ] **T-040** [US-004] Implement creator-facing suspension notification and appeal-path response contract — `packages/services/creator-profiles-service/src/moderation/notifications/`
- [ ] **T-041** [US-004] Implement DMCA takedown workflow integration and recipe unpublish SLA instrumentation — `packages/services/creator-profiles-service/src/compliance/`
- [ ] **T-042** [US-001] Implement GDPR erasure propagation for creator-profile-owned records and caches — `packages/services/creator-profiles-service/src/privacy/`
- [ ] **T-043** [US-003] Implement feed projection bridge for follow/publication events to existing feed ownership boundaries — `packages/services/creator-profiles-service/src/follows/bridge/`
- [ ] **T-044** [US-001] Implement tip delegation endpoint contract (`POST /api/v1/creators/:handle/tip`) to 010 without local billing logic — `packages/services/creator-profiles-service/src/monetization/`
- [ ] **T-045** [US-001] Implement premium/paid-follow delegation markers and boundary validations to 010 contracts — `packages/services/creator-profiles-service/src/monetization/`
- [ ] **T-046** [US-004] Add sibling audience scope checks ensuring `public-profile` (S-004) is not nested with `circle` (S-003) or `published-lesson` (S-002) semantics — `packages/services/creator-profiles-service/src/audience/`

## Verification & Release Readiness

- [ ] **T-047** [US-001] Add API contract tests for all `/api/v1/creators/*` endpoints including authz and error envelopes — `packages/services/creator-profiles-service/src/__contracts__/`
- [ ] **T-048** [US-001] Add integration tests for profile lifecycle, follow graph, collection ordering, and moderation transitions — `packages/services/creator-profiles-service/src/__integration__/`
- [ ] **T-049** [US-001] Add unit tests for handle validator, follow projector, widget renderer, analytics aggregators, and privacy filters — `packages/services/creator-profiles-service/src/__tests__/`
- [ ] **T-050** [P] [US-001] Add E2E tests: claim handle, public browse, follow/unfollow, collection browse, widget embed render, owner analytics view — `packages/apps/commise/web/tests/e2e/creator-profiles.spec.ts`
- [ ] **T-051** [US-001] Add performance checks: profile SSR p95, follow API p95, widget cache-hit p95, analytics endpoint p95 — `packages/services/creator-profiles-service/src/__perf__/`
- [ ] **T-052** [US-001] Add security/privacy tests for blocked-user restrictions, stale-session protections, and PII non-leak in public payloads — `packages/services/creator-profiles-service/src/__security__/`
- [ ] **T-053** [US-001] Run full test suite + lint + typecheck for affected workspaces and archive evidence — `packages/services/creator-profiles-service/`
- [ ] **T-054** [US-001] Update V-Model execution status artifacts with real test-case mappings and results — `specs/012-creator-profiles/v-model/`
- [ ] **T-055** [US-001] Validate links among spec.md, product-spec, plan.md, and tasks.md remain intact — `specs/012-creator-profiles/`

## Phase 1 (cont.) — Contract ownership, drift gates & validation (GR-015, GR-016, GR-017)

> These are **Phase 1** tasks despite their numbers, which are append-only so the existing 55 keep their IDs.
> `plan.md` L94-96 forbids deferring them.

- [ ] **T-056** [US-001] Author every wire shape as zod in the service and generate the committed schema package — `packages/services/creator-profiles-service/src/**/*.schema.ts` → `packages/schemas/creator-profiles`
    - **Depends on**: T-001, T-002
    - **Implements**: [`plan.md` §GR-015](./plan.md#gr-015--api-contract-ownership), [`spec.md` §Contract ownership (GR-015)](./spec.md#contract-ownership-gr-015), GR-015 §15-a, GR-017 §17-a.1/§17-a.3
    - **Acceptance**: Profile, handle-claim, collection, follow, widget and analytics shapes authored as zod at `src/creators/creators.schema.ts`, `src/collections/collections.schema.ts`, `src/follows/follows.schema.ts`, `src/widget/widget.schema.ts`, `src/analytics/analytics.schema.ts`, each **beside the controller it serves**; every `*.schema.ts` imports **only `zod` and other `*.schema.ts` files**; `packages/schemas/creator-profiles` (`@kitchensink/schema-creator-profiles`) exports `src/schemas.ts`, `src/types.ts` (`z.infer` only), `src/contract-hash.ts`, `src/index.ts` and a **derived** `openapi.yaml`, with **no** runtime dependency on NestJS/drizzle/aws-sdk. Reference shape: `packages/schemas/recipe`. Domain types come from `@kitchensink/recipe-core` **type-only** and are never re-declared (GR-007, T-004).
    - **⚠️ The widget is an HTML fragment, not JSON.** `GET /api/v1/creators/:handle/widget` (T-030) returns a static HTML fragment, so its **request** (path + query params) is zod-validated like any other, while its response is a rendered document rather than a wire object — the schema package types the inputs and the projection the renderer consumes, not an HTML string pretending to be a body.
    - **⛔ Three things that look wrong and are not**: the schema package is a literal **file COPY** (zod are runtime values and cannot be derived from themselves); `openapi.yaml` is **DERIVED** output for `oasdiff`/docs/integrators and is **NEVER a codegen input**; turbo wires the copy with `$TURBO_ROOT$` **`inputs`**, never `dependsOn`.
    - **Tests**: unit (each schema accepts a valid fixture and rejects each malformed variant) **AND** integration (the generated package's exports resolve and its `CONTRACT_HASH` equals the service's).

- [ ] **T-057** [US-001] Declare `contract:generate` and wire the turbo `$TURBO_ROOT$` `inputs` (drift gate 1 + 2) — `packages/services/creator-profiles-service/package.json`, `turbo.json`
    - **Depends on**: T-056
    - **Implements**: GR-015 §15-c (rebuild + correctness layers), GR-017 §17-a.2, [`plan.md` §GR-015](./plan.md#gr-015--api-contract-ownership)
    - **Acceptance**: `contract:generate` is declared so `scripts/contractOwners.mjs` `discoverContractOwners` finds the service with **no list edit** (a hardcoded list is itself the defect — GR-017), and `npm run contract:verify` regenerates and fails on any diff; `turbo.json` gives `@kitchensink/schema-creator-profiles#build` `$TURBO_ROOT$`-anchored **`inputs`** covering `src/**/*.schema.ts`.
    - **⛔ NOT `dependsOn`** — `schema-<service>#build` `dependsOn` `<service>#build` closes the cycle `client → schema → service → client` (the service devDepends on its own client for the contract tier) and turbo rejects the graph. The generated files are committed, so ordering was never the requirement.
    - **Tests**: unit (`src/__tests__/build-inputs.test.ts` asserting every authored `*.schema.ts` is covered by the declared glob, modelled on `packages/services/recipe-service/src/__tests__/build-inputs.test.ts`) **AND** integration (`scripts/contractDriftGate.mjs` clean on a fresh checkout, red on a hand-edited schema package).

- [ ] **T-058** [US-001] Assert `CONTRACT_HASH` equality at boot, and fail to boot on mismatch (drift gate 3) — `packages/services/creator-profiles-service/src/main.ts`
    - **Depends on**: T-056
    - **Implements**: GR-015 §15-c (skew layer), GR-017 §17-a.4, [`plan.md` §GR-015](./plan.md#gr-015--api-contract-ownership)
    - **Acceptance**: The service compares its own `CONTRACT_HASH` against `@kitchensink/schema-creator-profiles`'s at boot and **refuses to start** on mismatch, **before** the HTTP listener binds. This is the only gate that catches a **deployed** service running ahead of a consumer's pinned schema — the released-mobile-binary case.
    - **Tests**: unit (`src/__tests__/main-boot-order.test.ts` asserting the check precedes `listen()` and a skewed hash throws, modelled on `packages/services/recipe-service/src/__tests__/main-boot-order.test.ts`) **AND** integration (boot with a skewed hash; assert no port bound).

- [ ] **T-059** [US-001] Register **`nestjs-zod`'s** `ZodValidationPipe` as the single mechanism, with `z.strictObject()` on mutating bodies — `packages/services/creator-profiles-service/src/app.module.ts`
    - **Depends on**: T-056
    - **Implements**: [`plan.md` §GR-016](./plan.md#gr-016--input-validation-at-every-boundary), GR-016 §16-a/§16-e, GR-017 §17-a.5/§17-c
    - **⚠️ Invisible-by-construction failure**: under Nest's **own** `ValidationPipe` a `createZodDto` DTO **validates nothing while looking correctly wired**. Bind **`nestjs-zod`'s** pipe via `APP_PIPE`. This already bit identity's `PATCH /users/me`.
    - **Acceptance**: Every route — including the public `/@handle` path segment and every query param — takes a `createZodDto` DTO derived from T-056's zod. **Exactly one** validation mechanism in the service and **no `class-validator` DTO** alongside it (a new service starts with one mechanism; recipe-service's surviving `class-validator` importer — **one** file, `src/search/dto/search-recipes.query.dto.ts`, not the "19" that older docs quote, which is a **mention** count — is the state this avoids). One `400` path naming the offending field. Every mutating body (`POST /api/v1/creators`, `PUT /api/v1/creators/:handle`, collection CRUD, follow/unfollow, tip delegation) uses **`z.strictObject()`**; plain `z.object()` appears only on a **read** surface with a documented forward-compatibility reason.
    - **⚠️ Why strict**: `z.object()` strips unknown keys silently, so a misspelled field yields a `200` and a partial write the caller was told succeeded.
    - **Tests**: unit (per-DTO accept/reject, unknown-key rejection) **AND** integration (post a known-bad body to a **real** route on a booted app and assert the `400` + field name — the **only** observation of the wrong-pipe failure; modelled on `packages/services/identity/tests/app-validation.test.ts`) **AND** e2e (`tests/e2e/*.e2e.test.ts` over HTTP against real Postgres) **AND** k6 (`packages/tools/loadtest/`, the p95 targets T-051 already names).

- [ ] **T-060** [US-001] Add the storage-floor boundary-parity test — `packages/services/creator-profiles-service/src/__tests__/storage-capacity.test.ts`
    - ⛔ **DO NOT BUILD A NEW GATE — the mechanism already EXISTS.** `@kitchensink/contract-gen` exports `auditStorageCapacity` / `collectBoundedColumns` / `formatStorageCapacityFindings` (`packages/tools/contract-gen/src/storage-capacity.ts`), and a `storage-capacity.test.ts` already wires it in **all three** shipped services (recipe `src/database/__tests__/`, food `src/db/schema/__tests__/`, identity `src/types/schema/__tests__/`). Copy that pattern; do not hand-roll a second one — a second mechanism for one invariant is the failure GR-016 §16-a.2 forbids, one layer up. It reads drizzle **structurally** via `Symbol.for('drizzle:Columns')` (so `contract-gen` needs no `drizzle-orm` dependency) and zod bounds via the **public** `z.toJSONSchema`; it is already **exhaustive over columns**, with `stale-account` / `duplicate-account` findings as the reverse-direction check. The work here is the **mapping**: every bounded column bound to the wire fields that write it, or declared not-client-writable **with a reason** (GR-017 §17-d).
    - **Depends on**: T-056, T-006, T-019, T-025, T-034
    - **Implements**: GR-016 §16-d, GR-017 §17-d
    - **Acceptance**: Lives **in the service**, imports **both** the drizzle schema and the authored zod (a test is not a wire schema, so §16-d's ban on the _production_ coupling is untouched), **derives** its enumeration of bounded columns from the drizzle schema, and asserts each writing wire field **rejects** a value the column cannot hold: handle `3–30` chars, collection name `60` / description `200` chars (T-022), collection `position` and analytics counters against the `int4` ceiling **2,147,483,647**, moderation/lifecycle enum domains, nullability. The field→column mapping is authored and its completeness asserted in **BOTH** directions — every bounded column has an entry or an explicit reasoned exemption, and every entry names a column that exists.
    - **⛔ Asserted, never derived** — no zod generated from drizzle, no storage type imported into a `*.schema.ts`.
    - **⚠️ Limitation**: only the "every bounded column has an entry" direction can catch a **new** column, and only if the enumeration is derived. Derive it.
    - **Tests**: unit (the parity assertions) **AND** integration (a ceiling+1 value posted to a real route yields `400`, not a failed `INSERT` surfacing as `500`).

- [ ] **T-061** [US-001] Parse every non-HTTP ingress against an authored zod, with one rejection path — `packages/services/creator-profiles-service/src/analytics/jobs/`, `src/follows/projector/`, `src/follows/bridge/`
    - **Depends on**: T-056, T-028, T-035, T-043
    - **Implements**: GR-016 §16-b, GR-018 §18-a/§18-b/§18-d, GR-019
    - **012's non-HTTP ingress, enumerated**: (1) the **daily analytics snapshot** scheduled invocation (T-035); (2) the **follower/following count projector** (T-028); (3) the **feed-projection bridge** consuming follow/publication events (T-043); (4) GDPR erasure propagation input (T-042). 012 has **no third-party webhook** — monetization is delegated to 010, so no Stripe callback lands here.
    - **Acceptance**: Each parses its event/message against an authored zod before it becomes work — including the **scheduled** invocation, because "the payload is ours" is an assumption about a deploy that has already drifted once. Rejections take **one** path per ingress with the cause in a **`reason`** field. An invalid payload is **NEVER retried**: the consumer records the rejection and **completes** the message, or dead-letters it **once** with the `reason`, and DLQ depth is alarmed. A transient dependency failure (DB timeout, callee `5xx`) is a **different** `reason` and MAY retry.
    - **⛔ The rejected event is NOT recorded as a row**, and no identifier is ever a sentinel — not `'unknown'`, `'none'`, `''` or `0` — in storage, on a wire, as a map/cache key, or as a **metrics dimension**. An unresolvable `creator_id` or `follower_id` is a **rejection**, never a placeholder; a sentinel would fuse every unattributable follow into one fictitious creator's counters and could not be undone later (GR-019).
    - **Tests**: unit (each envelope zod rejects every malformed variant; the rejection shape differs only in `reason`; an unresolvable id rejects rather than defaults) **AND** integration (an invalid queue payload is asserted **not** redriven and the per-`reason` counter increments; a valid one still succeeds — both halves).

## Phase 1 (cont.) — Client half: typed client, receipt validation & skew (GR-015 §15-b, GR-017 §17-b, §17-e.12)

> ⚠️ **No client task existed.** `plan.md` L91-93 makes the client half mandatory and names
> `packages/clients/creator-profiles`, `@commise/web` and `@commise/mobile`. An obligation with no task is an
> obligation that does not ship (GR-017 §17-e.12).

- [ ] **T-062** [US-004] Create the typed client that declares no wire shape of its own — `packages/clients/creator-profiles`
    - **Depends on**: T-056
    - **Implements**: GR-015 §15-b.1/§15-b.2, GR-017 §17-b.1/§17-b.2, [`plan.md` §GR-015](./plan.md#gr-015--api-contract-ownership)
    - **Acceptance**: Imports wire **types and runtime zod** from `@kitchensink/schema-creator-profiles`; depends on that **leaf**, never on `@kitchensink/creator-profiles-service` (`packages/infra/global/__tests__/app-service-dependency.test.ts` enforces the boundary). Its own `types.ts` holds only config, options and its own error shapes — **no** wire shape, including type-only. Reference: `packages/clients/recipe-service`.
    - **Tests**: unit (each method's happy path + every mapped error status, including the `409` handle conflict of T-009) **AND** integration (`src/__integration__/*.integration.test.ts` against a booted service, modelled on `packages/clients/recipe-service/src/__integration__/client.integration.test.ts`).

- [ ] **T-063** [US-004] Validate every response on receipt and every outbound body before the call — `packages/clients/creator-profiles/src/client.ts`
    - **Depends on**: T-062
    - **Implements**: GR-016 §16-c.2/§16-c.3, GR-017 §17-b.3/§17-b.4, §17-f (the **required** half)
    - **Acceptance**: Every response body is parsed with the schema package's zod **the moment it arrives**; every outbound body is validated against the **callee's** schema-package zod **before** the call, so a malformed payload fails in the caller with a usable stack rather than as a remote `400`. A parse failure is a typed client error naming the field, never a silent cast. The **public profile payload** is the load-bearing case — it is the one shape an unauthenticated SSR render depends on, and a drifted field there is a blank public page.
    - **⛔ Do NOT add server-side response validation.** GR-016 §16-g defers a **producing service** parsing what it **emits**; that is an owner decision, not an unfinished task. This task is the **consumer** parsing what it **received** (GR-017 §17-f).
    - **Tests**: unit (a response with a missing, renamed and wrong-typed field each raise the typed parse error; an invalid outbound body is rejected before any fetch) **AND** integration (a live response parses clean; a hand-skewed fixture does not).

- [ ] **T-064** [US-004] Add the contract-skew guard — `packages/clients/creator-profiles/src/contractSkew.ts`
    - **Depends on**: T-062
    - **Implements**: GR-015 §15-c (skew layer), GR-017 §17-b.5
    - **Acceptance**: Detects a pinned-stale `@kitchensink/schema-creator-profiles` rather than leaving it inferred from a runtime parse failure, modelled on `packages/clients/food-service/src/contractSkew.ts` and `packages/clients/recipe-service/src/contractSkew.ts`. The guard reports only what it actually compared — it must not overclaim.
    - **Tests**: unit (`src/__tests__/contractSkew.test.ts`, modelled on the two existing ones: matching hash passes, skewed hash is reported, the report names both hashes) **AND** integration (run against the live service's advertised hash).

- [ ] **T-065** [US-004] Make web and mobile consume the client and derive every divergent shape — `packages/apps/commise/web`, `packages/apps/commise/mobile`
    - **Depends on**: T-062, T-063
    - **Implements**: GR-015 §15-b.3/§15-b.4, GR-017 §17-b.1, CODING_STANDARDS §14.1 (lockstep parity)
    - **Acceptance**: No file in `@commise/web`, `@commise/mobile` or any feature package declares a creator-profiles request/response body type. Divergent consumer shapes — the `/@handle` SSR page model, the analytics series model, the follow-button optimistic state — are **DERIVED** with `Pick`/`Omit`/`Partial`/mapped types. Reference implementation: `packages/apps/commise/features/recipes/src/filters/model.ts`. **Web and mobile ship in the same release**; platform-specific files use the `.native.ts(x)` suffix (never `.mobile.*`). ⚠️ **Mobile has no 012 surface in this task list at all** — T-015…T-018, T-024, T-029 and T-038 are web-only; mobile parity for public profile browse, collections, follow and creator analytics is required by §14.1 and is part of this task.
    - **Tests**: unit (each derived model asserted assignable from its wire parent, so a wire change breaks the derivation instead of drifting past it) **AND** **vitest component tests for EVERY path/state** on both platforms — loading, empty profile, populated, suspended/hidden, deactivated, not-found, follow-pending, follow-failed-rollback, empty/populated collections, empty/populated analytics **AND** **Playwright** (web, extending T-050) **AND** a **Maestro** flow per story (mobile, `.maestro/*.yaml`) matching T-050 one-for-one **AND** integration (a parser-based guard over `git ls-files` asserting no client/app file declares a wire shape, modelled on `packages/infra/global/__tests__/app-service-dependency.test.ts` — ⚠️ this repo-wide guard **does not exist yet**; see GR-017's enforcement table).

- [ ] **T-066** [US-001] ⛔ Record the third-party posture — there is no external API here today, and 010's shapes stay behind 010 — `specs/012-creator-profiles/`, `packages/services/creator-profiles-service/src/monetization/`
    - **Depends on**: T-044, T-045, T-056
    - **Implements**: GR-015 §15-d, GR-017 §17-b.6, [`plan.md` §GR-015](./plan.md#gr-015--api-contract-ownership)
    - **Acceptance**: 012 calls **no** third-party API directly today: monetization is **delegated to 010**, so **Stripe's shapes never enter `@kitchensink/schema-creator-profiles`** and the tip/paid-follow delegation (T-044, T-045) validates its outbound body against **010's** schema-package zod and parses 010's response on receipt. If 012 later calls an external API directly, that client **validates the raw upstream shape at the boundary with its own zod**, **MAY declare its own types**, and **gets NO OpenAPI document** — rules 17-b.1–17-b.5 do not apply to it.
    - **⛔ "Converging" a third-party client deletes a validation boundary — a security regression, not a cleanup. `packages/clients/usda/src/schemas.ts` is the reference implementation and must NEVER be touched in this rule's name.**
    - **Tests**: unit (the delegation's outbound body is rejected before send when malformed; 010's response is parsed on receipt) **AND** integration (delegation against a booted identity/billing surface).

---

## Traceability

| Task         | Implements                                                                                                       | Spec FR                                                     | Plan Phase  |
| ------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------- |
| T-001..T-012 | Profile lifecycle                                                                                                | FR-001..FR-005                                              | Phase 1–2   |
| T-013..T-018 | Public read surface                                                                                              | FR-006..FR-012                                              | Phase 3–4   |
| T-019..T-024 | Collections curation                                                                                             | FR-017..FR-019                                              | Phase 2–3   |
| T-025..T-029 | Follow graph                                                                                                     | FR-013..FR-016                                              | Phase 2–3   |
| T-030..T-033 | Embed widget                                                                                                     | FR-026..FR-027                                              | Phase 4     |
| T-034..T-038 | Analytics pipeline                                                                                               | FR-023..FR-025                                              | Phase 5     |
| T-039..T-042 | Moderation / privacy                                                                                             | FR-020..FR-022                                              | Phase 5     |
| T-043..T-046 | Integration boundaries                                                                                           | FR-014, FR-030                                              | Phase 6     |
| T-047..T-055 | Verification / readiness                                                                                         | All                                                         | Phase 7     |
| T-056..T-061 | Contract ownership, drift gates, input validation, storage floor, non-HTTP ingress                               | All (GR-015, GR-016, GR-017, GR-018, GR-019)                | **Phase 1** |
| T-062..T-066 | Client half: typed client, receipt + outbound validation, skew guard, web/mobile derivation, third-party posture | FR-006..FR-012, FR-023..FR-025 (GR-015 §15-b, GR-017 §17-b) | **Phase 1** |

**Task count: 66** (was 55). T-056…T-066 close GR-017 §17-e.12 — the schema package, the `CONTRACT_HASH` gate
and receipt validation had **no task** in this file, while `plan.md` L85-96 stated all three in prose.
