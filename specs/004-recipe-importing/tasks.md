# Tasks: Feature 004 — Recipe Importing

**Feature**: `004-recipe-importing`
**Regenerated**: 2026-08-02
**Source**: `spec.md`, `plan.md`, `v-model/architecture-design.md`

> **Regeneration note.** Every file path in the previous revision was wrong: it targeted
> `packages/api/recipe/` (a directory containing only `.gitkeep`) and `packages/shared/db/` (does not exist),
> and placed UI in `packages/apps/commise/web/src/features/` rather than the `@commise/features-recipes`
> package where recipe UI actually lives. It also had no mobile counterpart for attribution display, made the
> mobile import UI a P2 that _depended on_ the web UI (violating `CODING_STANDARDS §14.1` lockstep parity),
> specified no k6 or Maestro tests at all, sequenced all testing into a single trailing task, and carried no
> acceptance criteria for the Catastrophic SSRF hazard. Paths below are verified against `main`.

---

## Mandatory conventions for every task

- **Test-first (§7.1, absolute).** The failing test is written before the code. A task is not startable by
  writing implementation.
- **Test tiers by category — omitting any one makes the task INCOMPLETE:**
    - Non-UI (services, DALs, policies, parsers): **unit AND integration**.
    - The service as a deployable API: additionally **e2e AND k6**.
    - UI: **a vitest component test for EVERY state/branch**, **Playwright** (web) **AND** **Maestro** (mobile).
- **Naming (§1a/§1b, CI-enforced by `eslint-plugin-check-file`).** Backend kebab `name.type.ts`, unit tests
  `__tests__/*.test.ts`; e2e `tests/e2e/*.e2e.test.ts`. Frontend camelCase modules, PascalCase components,
  mobile leaves `*.native.tsx`.
- **Lockstep parity (§14.1).** Every user-facing task ships web **and** mobile in the same task. No waiver is
  claimed by this feature.
- **Localization.** No user-facing literal. Copy goes in
  `packages/apps/commise/features/recipes/src/messages.ts` and is shared by both platforms via `useMessages`.
- **Purity.** Policies, normalizers, and parsers are pure; impure functions carry `@sideEffect`.

---

## User story reference

| ID     | Title                                     | Priority   | Requirements                       |
| ------ | ----------------------------------------- | ---------- | ---------------------------------- |
| US-401 | Import a recipe from a public URL         | P1         | REQ-001..004, REQ-024              |
| US-402 | Import from an Instagram caption          | P1 (gated) | REQ-005, REQ-IF-001, REQ-CN-004    |
| US-403 | Attribution on imported public recipes    | P1         | REQ-016                            |
| US-404 | Provenance classification and visibility  | P1         | REQ-014, REQ-015, REQ-022          |
| US-405 | Import from a photo of a physical copy    | P1         | REQ-007, REQ-026, REQ-IF-002       |
| US-406 | Reject paywalled sources                  | P1         | REQ-017..020                       |
| US-407 | Duplicate source handling                 | P1         | REQ-003, REQ-004, REQ-CN-001       |
| US-408 | Review and complete a draft before saving | P1         | REQ-012, REQ-013, REQ-008, REQ-011 |
| US-409 | Actionable error recovery                 | P1         | REQ-024, REQ-NF-005                |
| US-410 | Paid-source attestation guardrail         | P1         | REQ-021, REQ-022, REQ-023          |
| US-411 | Import from a structured file             | P1         | REQ-006                            |

---

## Dependency graph

```
T-001 contract ──┬─► T-002 schema/migrations ──► T-003 error codes
                 └─► T-004 shared types (recipe-core)
T-004 ──► T-005 CanonicalSourceUrl ──┐
T-004 ──► T-006 ProvenancePolicy     ├─► T-011 ImportsService (facade)
T-004 ──► T-007 normalizers          │
T-004 ──► T-008 extractor chain      │
T-002 ──► T-009 blocklist            │
T-010 SourceFetcher + SSRF ──────────┘
T-011 ──► T-012 drafts ──► T-013 jobs+worker ──► T-014 URL channel
T-011 ──► T-015 file channel
T-012 ──► T-016 confirmation bridge
T-009 ──► T-017 admin blocklist endpoints
T-013 ──► T-018 OCR channel
T-013 ──► T-019 Instagram channel (gated)
T-014,T-016 ──► T-020 typed client
T-020 ──► T-021 import UI (web+mobile) ──► T-022 draft review UI (web+mobile)
T-020 ──► T-023 attribution UI (web+mobile)
T-021,T-022 ──► T-024 error-state UI (web+mobile)
ALL ──► T-025 e2e · T-026 k6 · T-027 accuracy corpus
```

---

## Phase 1 — Contract and foundations

### T-001 · OpenAPI contract additions

**Priority** P1 · **Effort** M · **Depends on** — · **Implements** REQ-IF-006

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ATP-IF-006-A`

Contract-first: the contract is written **before** any handler.

> **Contract location.** The recipe service has ONE OpenAPI document, and it lives at
> `specs/001-commise-recipe-app/contracts/api.openapi.yaml` (~120 KB) because 001 created it; service code
> refers to it relatively as `contracts/api.openapi.yaml`. 004 **extends that same document** rather than
> starting a second one — one service, one contract. Do not create
> `specs/004-recipe-importing/contracts/api.openapi.yaml`.

- [ ] All 12 import endpoints added to `specs/001-commise-recipe-app/contracts/api.openapi.yaml`
- [ ] Request/response schemas: `ImportDraft`, `ImportJob`, `ExtractedRecipe`, `ParsedIngredient`, `PaywalledDomain`
- [ ] `Idempotency-Key` documented as required on `/import/{url,instagram,photo}`
- [ ] Every error response references the shipped `ErrorResponse` envelope, with the new codes enumerated
- [ ] Status codes match `plan.md §3` exactly (422 for policy/extraction failures, not 400)
- [ ] Contract lints clean; a schema round-trip test asserts the documented shapes match the DTOs

**Files** `specs/001-commise-recipe-app/contracts/api.openapi.yaml`

---

### T-002 · Database schema and migrations

**Priority** P1 · **Effort** M · **Depends on** T-001 · **Implements** REQ-004, REQ-019, REQ-026, REQ-CN-001, REQ-CN-002

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ITP-007-A, UTS-CN-002`

- [ ] `0019_import_drafts.sql`, `0020_import_jobs.sql`, `0021_paywalled_domains.sql`, `0022_recipes_import_columns.sql`
- [ ] `recipes` gains **only** `import_channel` and `source_url_canonical` — `source_url`, `source_attribution`,
      `cloned_from_id`, `source_type`, `has_substantive_edit` **already exist and MUST NOT be re-added**
- [ ] Partial unique index on `source_url_canonical WHERE source_url_canonical IS NOT NULL AND deleted_at IS NULL`
- [ ] CHECK constraints on every enumerated column (`status`, `import_channel`, `source_type`)
- [ ] Expand/contract safe: all added columns nullable or defaulted, deployable ahead of the code
- [ ] Migrations are idempotent and re-runnable
- [ ] Drizzle schema files mirror the SQL exactly, tied to recipe-core types with `as const satisfies`
- [ ] **Integration test** proves: the partial index rejects a concurrent duplicate insert; a soft-deleted row
      does **not** block re-import; every CHECK rejects an out-of-domain value

**Files** `src/database/migrations/0019..0022*.sql`, `src/database/schema/{import-drafts,import-jobs,paywalled-domains,recipes}.ts`, `src/database/__tests__/schema.test.ts`

---

### T-003 · Import error codes

**Priority** P1 · **Effort** S · **Depends on** T-002 · **Implements** REQ-024

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ITP-015-A`

- [ ] The 10 codes from `plan.md §3` added to `RecipeErrorCode` in `@kitchensink/recipe-core`
- [ ] Status mapping added to the **shipped** `ApiExceptionFilter` — no second filter, no error normalizer
- [ ] Typed factory functions in `imports/import.error.ts` following the shipped `recipe.error.ts` pattern
      (`Object.setPrototypeOf`, `is*` guard)
- [ ] **Unit tests**: every code maps to its documented status; unknown code falls through to 500
- [ ] Client `errors.ts` extended so each code is discriminable downstream

**Files** `packages/shared/recipe-core/src/recipe.types.ts`, `src/common/filters/api-exception.filter.ts`, `src/imports/import.error.ts`, `packages/clients/recipe-service/src/errors.ts`

---

### T-004 · Shared import contracts

**Priority** P1 · **Effort** S · **Depends on** T-001 · **Implements** REQ-IF-006, REQ-NF-001, REQ-NF-002

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `UTP-034-A`

- [ ] `importTypes.ts`, `importDraft.ts` in `@kitchensink/recipe-core` (camelCase — §1b)
- [ ] `ImportChannel`, `ExtractedRecipe`, `ParsedIngredient`, `NormalizedDraft`, `ImportDraft`, `ImportJobState`
- [ ] `ImportChannel` is a discriminated union enabling exhaustive switching (Visitor intent — no class hierarchy)
- [ ] JSDoc on every export; zero `any`
- [ ] **Unit tests** assert exhaustiveness: adding a channel fails compilation at every switch

**Files** `packages/shared/recipe-core/src/{importTypes,importDraft}.ts`, `src/__tests__/`

---

## Phase 2 — Pure core (no I/O)

### T-005 · CanonicalSourceUrl value object

**Priority** P1 · **Effort** S · **Depends on** T-004 · **Implements** REQ-003, REQ-CN-001 · **Mitigates** HAZ-019

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `UTP-024-A, UTP-024-B`

- [ ] Construction canonicalizes via `normalize-url`; an unnormalized instance is unrepresentable
- [ ] Lowercases scheme+host, strips fragment, default port, and tracking params; normalizes trailing slash
- [ ] Rejects non-`http(s)` schemes at construction
- [ ] Pure; JSDoc'd
- [ ] **Unit tests** — table-driven over: case variants, `www.`, trailing slash, `utm_*`, fragments, default vs
      explicit port, percent-encoding, IDN/punycode, `javascript:`/`file:`/`data:` rejection
- [ ] **Mutation check**: each assertion fails if canonicalization is weakened

**Files** `src/imports/policy/canonical-source-url.ts`, `src/imports/__tests__/canonical-source-url.test.ts`

---

### T-006 · ProvenancePolicy

**Priority** P1 · **Effort** S · **Depends on** T-004 · **Implements** REQ-014, REQ-021, REQ-022, REQ-023, REQ-CN-003

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `UTP-022-A, UTP-022-B`

- [ ] Pure total function `(channel, attestation, citationReachable) → RecipeSourceType`
- [ ] `url`/`instagram` → `imported_public`; `file`/`ocr` → `imported_physical`; attested non-public source →
      `imported_paid` (D-003)
- [ ] Detection heuristics return a **review flag only** — they never change the returned classification
- [ ] **Does not** decide visibility; that is the shipped `evaluateVisibility` (REQ-015)
- [ ] **Unit tests** cover the full cartesian product of inputs, including every path that must NOT yield
      `imported_public`
- [ ] **Integration test** asserts a recipe created from an `imported_paid` draft is refused public visibility
      by the **shipped** policy — proving the delegation actually holds

**Files** `src/imports/policy/provenance.policy.ts`, `src/imports/__tests__/provenance.policy.test.ts`

---

### T-007 · Normalizers

**Priority** P1 · **Effort** L · **Depends on** T-004 · **Implements** REQ-008, REQ-009, REQ-011, REQ-NF-010

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `UTP-018-A, UTP-019-A, UTP-020-A, UTP-021-A`

- [ ] `ingredient-line.ts` — `parse-ingredient`; **always** retains `raw`; unparseable ⇒ `quantity: null` +
      flag, never a throw
- [ ] `value-normalizers.ts` — ISO-8601 → integer minutes (`iso8601-duration`); free-text yield → positive
      integer where unambiguous; **absent/ambiguous ⇒ empty + flagged, NEVER a default**
- [ ] `content-sanitizer.ts` — zero-tag allowlist over every extracted text field
- [ ] `normalizer.service.ts` computes `missingRequired` against the shipped `CreateRecipeRequest` requirements
- [ ] All pure; JSDoc'd
- [ ] **Unit tests**: quantities incl. unicode fractions (`½`), ranges (`2-3`), "to taste", empty; durations
      `PT1H30M`/`PT45M`/malformed/absent; yields `"4 servings"`/`"serves 4-6"`/`"a crowd"`/absent; sanitizer
      against `<script>`, `<img onerror>`, entity-encoded and nested payloads
- [ ] **Explicit test**: a recipe with no stated servings produces `missingRequired: ['servings']` and never a
      fabricated value

**Files** `src/imports/normalize/*.ts`, `src/imports/__tests__/normalize/*.test.ts`

---

### T-008 · Extractor chain

**Priority** P1 · **Effort** L · **Depends on** T-004 · **Implements** REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `UTP-008-A, UTP-009-A, UTP-010-A, UTP-011-A`

- [ ] `recipe-extractor.port.ts` — Strategy interface; implementations return `null`, **never throw**
- [ ] `json-ld.extractor.ts` — walks `@graph`, Zod-validates `@type === 'Recipe'` before accepting (HAZ-028)
- [ ] `microdata.extractor.ts` (`microdata-node`), `heuristic.extractor.ts` (`cheerio`, emits confidence)
- [ ] **RDFa is out of scope** (REQ-CN-005) — do not add a fourth extractor
- [ ] `extractor-chain.service.ts` — first non-null wins; "fetched but nothing found" is an explicit outcome,
      never an empty success (HAZ-009, REQ-CN-006)
- [ ] **Unit tests per extractor** with fixture HTML: valid, malformed JSON, `@graph` arrays, multiple recipes,
      non-Recipe JSON-LD, charset/BOM variants (HAZ-005), absent markup
- [ ] **Integration test** over the SC-002 fixture corpus asserting chain ordering and hit rates

**Files** `src/imports/extractors/*.ts`, `src/imports/__tests__/extractors/*.test.ts`, `src/imports/__fixtures__/html/`

---

## Phase 3 — Egress and policy edge

### T-009 · Paywalled-domain blocklist

**Priority** P1 · **Effort** M · **Depends on** T-002 · **Implements** REQ-017, REQ-019, REQ-020 · **Mitigates** HAZ-020, HAZ-022

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `UTP-023-A, ITP-014-A`

- [ ] DAL + service over `paywalled_domains` with audit fields (`added_by`, `created_at`, `reason`)
- [ ] Matching is **exact host or registrable suffix — never substring** (`notnytimes.com` must not match `nytimes.com`)
- [ ] Host normalized (lowercase, strip `www.`) before lookup
- [ ] Bounded-TTL cache; a cache miss fails **closed** (blocked) rather than open
- [ ] **Unit tests**: exact, subdomain, suffix, near-miss, case, `www.`, punycode
- [ ] **Integration test** against real Postgres: CRUD, audit trail, uniqueness

**Files** `src/imports/blocklist/paywalled-domains.{service,dal}.ts`, `src/imports/__tests__/blocklist/`, `src/imports/__integration__/`

---

### T-010 · SourceFetcher and SSRF guard ⚠️ SECURITY-CRITICAL

**Priority** P1 · **Effort** L · **Depends on** T-005 · **Implements** REQ-018, REQ-NF-007, REQ-NF-008, REQ-NF-009, REQ-NF-012 · **Mitigates** HAZ-001..004 (incl. **HAZ-003, Catastrophic**)

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `UTP-006-A, UTP-005-A, ITP-003-A`

The previous task list specified **none** of this. Security tests are written first.

- [ ] `ssrf-guard.ts`: rejects loopback, RFC-1918 private, link-local (incl. `169.254.169.254`), CGNAT,
      unique-local, unspecified, and multicast addresses via `ipaddr.js`
- [ ] Connection **pinned** to the validated address with a custom `undici` dispatcher, closing the
      DNS-rebinding window between check and connect
- [ ] Guard **and** blocklist re-evaluated on **every** redirect hop (REQ-018)
- [ ] Budget enforced: 3s connect, 10s total, ≤5 redirects, ≤5 MB **streamed with early abort** (not buffered),
      html content types only
- [ ] Per-registrable-domain circuit breaker + bounded-concurrency bulkhead (`cockatiel`)
- [ ] Retry: idempotent GET only, transient only, ≤2 attempts, exponential backoff **with full jitter**
- [ ] `robots.txt` per D-007: agent-named group honoured in full; path-specific wildcard `Disallow` honoured;
      bare wildcard `Disallow: /` does **not** block; unreachable/unparseable robots is permissive; blocks counted
- [ ] No credentials, cookies, or `Authorization` on any outbound request
- [ ] Response bodies are **never logged** (REQ-NF-012)
- [ ] **Unit tests** (adversarial, written first): `127.0.0.1`, `[::1]`, `10.x`, `192.168.x`, `169.254.169.254`,
      `0.0.0.0`, decimal/octal/hex IP encodings, DNS name resolving to a private address, redirect chains ending
      at a private address, redirect loops, oversized response, slow-loris, non-html content type, scheme downgrade
- [ ] **Integration test** against a local malicious-server harness covering redirect-to-private and oversize
- [ ] **A test asserting that removing the guard fails the suite** — the mutation lens applied to the one
      Catastrophic hazard

**Files** `src/imports/fetch/{source-fetcher.service,ssrf-guard,fetch-budget.config}.ts`, `src/imports/__tests__/fetch/`, `src/imports/__integration__/source-fetcher.integration.test.ts`

---

## Phase 4 — Pipeline and lifecycle

### T-011 · ImportsService facade

**Priority** P1 · **Effort** M · **Depends on** T-005..T-010 · **Implements** REQ-024 · **Mitigates** HAZ-026

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `UTP-002-A, ITP-002-A`

- [ ] Fixed pipeline order in ONE place: blocklist → fetch → extract → normalize → classify → dedupe → draft
- [ ] Blocklist and classification are **hard-fail** gates; neither may be skipped or reordered
- [ ] Every failure is a typed `RecipeDomainError`; no untyped throw escapes
- [ ] **Unit tests** with faked ports assert the call **order**, not merely the outcome — an ordering regression
      must fail the suite
- [ ] **Integration test** exercises the full pipeline against real Postgres + a local fixture server

**Files** `src/imports/imports.service.ts`, `src/imports/__tests__/imports.service.test.ts`

---

### T-012 · Import drafts

**Priority** P1 · **Effort** M · **Depends on** T-011 · **Implements** REQ-012, REQ-026, REQ-027

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `UTP-025-A, ITP-008-A`

- [ ] DAL + service; state machine `open → confirmed | expired` with illegal transitions unrepresentable
- [ ] `loadForOwner` returns **404 for another user's draft** — indistinguishable from absent (REQ-027)
- [ ] `PATCH` applies user corrections and recomputes `missingRequired`
- [ ] `expires_at = created_at + 7 days` (D-005); the retention window is stage-configurable and **capped at 7 days in production**
- [ ] Expiry sweep deletes due drafts **and** their OCR objects in one unit (REQ-026) — an image must never outlive its draft
- [ ] **Unit tests**: every transition, every illegal transition, expiry boundary
- [ ] **Integration tests**: owner isolation (IDOR), expiry sweep removes the S3 object, correction round-trip

**Files** `src/imports/drafts/*.ts`, `src/imports/__tests__/drafts/`, `src/imports/__integration__/import-drafts.integration.test.ts`

---

### T-013 · Import jobs and worker

**Priority** P1 · **Effort** M · **Depends on** T-012 · **Implements** REQ-024, REQ-028, REQ-NF-012

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `UTP-003-A, ITP-009-A`

- [ ] Job state machine; typed failure code recorded on failure
- [ ] `Idempotency-Key` resolution cached per `(key, endpoint, principal)`; a repeated key returns the original
      outcome and does **not** import twice
- [ ] Worker is idempotent (at-least-once delivery assumed), DLQ-routed with a retry cap, correlation-ID propagating
- [ ] **Unit tests**: transitions, idempotent replay, terminal-state immutability
- [ ] **Integration tests**: duplicate delivery produces one effect; poison message reaches the DLQ
- [ ] **Daily allowance (D-006)** enforced in `ImportsService` as domain policy — **not** a second registered
      throttler (`throttle.config.ts` documents that v6 ANDs every throttler across every route)
- [ ] 200 imports/day/user across channels; 50/day OCR sub-allowance; `IMPORT_QUOTA_EXCEEDED` (`429`) carries `resetsAt`
- [ ] Quota function accepts the principal's tier and returns identical limits for all tiers today — the seam 010 needs
- [ ] Burst limits via shipped `@Throttle`: 10/min url+instagram, 5/min photo
- [ ] **Explicit idempotency test**: same key twice ⇒ exactly one draft (`ENGINEERING_EXCELLENCE §9`)

**Files** `src/imports/jobs/*.ts`, `packages/services/recipe-workers/src/import-job.worker.ts`, tests alongside

---

### T-014 · URL import channel

**Priority** P1 · **Effort** M · **Depends on** T-013 · **Implements** REQ-001, REQ-003, REQ-004 · **US-401, US-407**

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ATP-001-A, ATP-003-A, ATP-004-A`

- [ ] `POST /api/v1/recipes/import/url` → `202 { jobId }`; `GET /import/jobs/{id}` → status
- [ ] Duplicate canonical URL resolves to the existing recipe with `cloneAvailable: true` — **200, not an error**
- [ ] Constraint violation on insert is caught and resolved to the winning recipe (HAZ-018)
- [ ] **Integration test** for the concurrent-duplicate race: two simultaneous imports ⇒ exactly one recipe
- [ ] **e2e** `import-url.e2e.test.ts` against real Postgres + LocalStack + a local fixture server

**Files** `src/imports/imports.controller.ts`, `src/imports/dedup/deduplication.service.ts`, `tests/e2e/import-url.e2e.test.ts`

---

### T-015 · File import channel

**Priority** P1 · **Effort** M · **Depends on** T-011 · **Implements** REQ-006 · **US-411**

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ATP-006-A, ATP-006-B`

- [ ] `POST /api/v1/recipes/import/file` → `201 { draftId }` (sync — no outbound call)
- [ ] Type determined by **magic bytes** (`file-type`, already a dependency), never the client MIME/filename
- [ ] JSON / YAML (`yaml`) / Markdown-frontmatter (`gray-matter`) parsers; ≤1 MB
- [ ] Classified `user_created` (FR-011) — file import stays available to free tier
- [ ] `415` for unsupported format, `413` for oversize, with field-level errors on schema failure
- [ ] **Unit tests**: each format valid/invalid; a `.json`-named file whose bytes are a ZIP is rejected
- [ ] **Integration + e2e** coverage of the upload path

**Files** `src/imports/files/*.ts`, tests alongside, `tests/e2e/import-file.e2e.test.ts`

---

### T-029 · Provenance-aware creation in 001's recipes vertical ⚠️ CROSS-FEATURE

**Priority** P1 · **Effort** M · **Depends on** T-004 · **Implements** REQ-031, REQ-032 · _(D-011)_

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ATP-031-A, ATP-031-B, ATP-032-A`

Touches **001's shipped code**, not 004's. Additive: `POST /api/v1/recipes` behaviour must be unchanged.

- [ ] `RecipesService.create` accepts provenance; `evaluateVisibility` receives the **actual** `sourceType`
      rather than the hardcoded `USER_CREATED`
- [ ] Omitted provenance ⇒ `user_created` — existing callers and the shipped contract are unaffected
- [ ] `RecipesService.createMany` added: **per-recipe** transaction and outcome, never all-or-nothing (HAZ-058)
- [ ] Ingredient resolution in bulk stays asynchronous and batched — no synchronous fan-out to 003 (HAZ-059)
- [ ] `POST /api/v1/recipes` DTO admits only `declaredSource: own | paid-source + citation`;
      `imported_public` / `imported_physical` are **not representable** in the DTO (REQ-032, HAZ-057)
- [ ] **Regression tests proving `POST /api/v1/recipes` is unchanged** for every existing case
- [ ] **Unit tests**: each provenance value reaches `evaluateVisibility`; a free-tier caller cannot obtain a
      private recipe by declaring a physical/imported source; false `imported_public` is unrepresentable
- [ ] **Integration tests** against real Postgres for both `create` and `createMany`

**Files** `packages/services/recipe-service/src/recipes/recipes.service.ts`, `dto/create-recipe.dto.ts`, tests alongside

---

### T-030 · Multi-recipe file import + bulk confirm

**Priority** P1 · **Effort** L · **Depends on** T-015, T-016, T-029 · **Implements** REQ-033, REQ-034 · _(D-012)_ · **US-415**

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ATP-033-A, ATP-034-A`

- [ ] File parser detects a collection and yields **one draft per recipe**, sharing one import job
- [ ] Bounded: **max 1,000 recipes per file** (D-013) and max file size; streamed parse, chunked persistence (HAZ-060)
- [ ] A bulk file import counts as **one** import against the D-006 daily allowance, not one per recipe
- [ ] `POST /import/drafts/confirm-bulk` → `207` with a per-draft outcome (`created` / `already_existed` / `failed` + reason)
- [ ] Deduplication applies **per recipe**; an already-present recipe is `already_existed`, **not** a failure
- [ ] One recipe's failure does not discard the others (HAZ-058)
- [ ] **Integration test**: a fixture export where some recipes are complete, some incomplete, and some already
      exist — assert the split and that no successful recipe is lost when one row fails
- [ ] **e2e** `import-bulk-file.e2e.test.ts`

**Files** `src/imports/files/*`, `src/imports/confirm/draft-confirmation.service.ts`, `tests/e2e/import-bulk-file.e2e.test.ts`

---

### T-016 · Draft confirmation bridge

**Priority** P1 · **Effort** M · **Depends on** T-012 · **Implements** REQ-010, REQ-013, REQ-015, REQ-IF-003, REQ-IF-005, REQ-CN-007 · **US-408**

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ATP-013-A, ATP-013-B, ITP-010-A`

- [ ] `POST /import/drafts/{id}/confirm` → `201` via the **shipped** `RecipesService.create`
- [ ] Incomplete draft ⇒ `422 IMPORT_DRAFT_INCOMPLETE` with the field list; no recipe created
- [ ] Ingredient names submitted to the food client asynchronously; resolution **never blocks** confirmation
- [ ] **Contains no visibility logic** — `evaluateVisibility` is invoked through the shipped write path
- [ ] **Unit tests**: complete, incomplete, expired, wrong owner
- [ ] **Integration tests**: created recipe carries the correct `sourceType`/attribution; food resolution
      degrades gracefully when the food service is down (`ENGINEERING_EXCELLENCE §4`)
- [ ] **e2e** `import-draft-confirm.e2e.test.ts`

**Files** `src/imports/confirm/draft-confirmation.service.ts`, tests alongside, `tests/e2e/import-draft-confirm.e2e.test.ts`

---

### T-017 · Admin blocklist endpoints

**Priority** P1 · **Effort** S · **Depends on** T-009 · **Implements** REQ-019 · **US-406** · _(D-004)_

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ATP-019-A, ATP-019-B`

- [ ] `GET/POST/DELETE /api/v1/admin/import/paywalled-domains`, guarded by the admin scope from the signed token
- [ ] `403` without the scope; audit trail records the acting admin ULID
- [ ] **Unit + integration tests** incl. a non-admin principal being refused
- [ ] **e2e** `import-blocklist.e2e.test.ts` proves a blocked domain is refused **without any outbound request**

**Files** `src/imports/blocklist/paywalled-domains.controller.ts`, tests alongside

---

### T-031 · Premium entitlement gate on non-public channels

**Priority** P1 · **Effort** S · **Depends on** T-006, T-011 · **Implements** REQ-035 · _(D-014)_ · **Mitigates** HAZ-061

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ATP-035-A, ATP-035-B`

- [ ] `ProvenancePolicy` reports whether a classification is non-public by policy (`imported_physical` / `imported_paid`)
- [ ] `ImportsService` requires premium **before** the channel runs — no Textract call, no fetch, for an unentitled caller
- [ ] Entitlement read from the signed token's `permissions` (shipped `PREMIUM_PERMISSION`); fails **closed** when unknown
- [ ] `IMPORT_REQUIRES_PREMIUM` (`403`) — distinct from a generic authorization failure, so the client can show the upgrade path
- [ ] `GET /import/sources` omits gated channels for an unentitled caller (no dead affordance)
- [ ] **Unit tests**: entitled/unentitled × each channel; unknown entitlement treated as unentitled
- [ ] **Integration test**: an unentitled photo import makes **no** call to the OCR provider

**Files** `src/imports/imports.service.ts`, `src/imports/policy/provenance.policy.ts`, tests alongside

---

### T-018 · OCR channel _(D-001 — P1, ships at launch; premium-only per D-014)_

**Priority** P1 · **Effort** L · **Depends on** T-013 · **Implements** REQ-007, REQ-026, REQ-IF-002 · **US-405**

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ATP-007-A, ATP-007-B, ITP-011-A`

- [ ] `ocr-provider.port.ts` + `textract.adapter.ts`; pipeline testable with a faked provider
- [ ] `POST /import/photo` → `202`; image stored to S3 under the import prefix; JPEG/PNG/HEIC, ≤10 MB, type by
      magic bytes; `sharp` preprocessing
- [ ] Bounded polling with backoff and a hard timeout; `503` when the breaker is open
- [ ] Extracted text flows through the **same** normalize → classify → draft pipeline (`imported_physical`, private)
- [ ] Source image deleted on confirm, discard, or expiry — whichever is first (REQ-026); S3 lifecycle rule as backstop
- [ ] OCR text is **never logged** (REQ-NF-012)
- [ ] **Unit tests** with a faked provider: clear print, handwriting, low confidence, empty result, timeout
- [ ] **Integration tests** against LocalStack S3 asserting the object is deleted on every terminal path
- [ ] **e2e** `import-ocr.e2e.test.ts`

**Files** `src/imports/ocr/*.ts`, tests alongside, `tests/e2e/import-ocr.e2e.test.ts`

---

### T-019 · Instagram channel _(D-002 — gated)_

**Priority** P1 (gated) · **Effort** M · **Depends on** T-013 · **Implements** REQ-005, REQ-IF-001, REQ-CN-004 · **US-402**

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ATP-005-A, ATP-005-B, ITP-012-A`

- [ ] `oembed-provider.port.ts` + Meta-hosted adapter using an app credential from SSM/Secrets
- [ ] **Capability flag defaults OFF.** With it off the endpoints return `404`, the channel is absent from
      `GET /import/sources`, and neither UI offers it — no dead affordance
- [ ] `429` classified explicitly as throttled, not a generic failure (HAZ-010); response shape validated (HAZ-012)
- [ ] No caption / no recipe text ⇒ `422 IMPORT_NO_CAPTION`
- [ ] **Developed and tested against a contract fake** — CI must be green without a Meta credential
- [ ] **Unit + integration tests** via the fake; a contract test pins the expected oEmbed response shape
- [ ] **e2e** runs with the flag on against the fake, and with the flag off asserting `404`

**Files** `src/imports/instagram/*.ts`, tests alongside

---

## Phase 5 — Client and UI (web + mobile in lockstep, §14.1)

### T-020 · Typed client extension

**Priority** P1 · **Effort** M · **Depends on** T-014, T-016 · **Implements** REQ-IF-006

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ITP-016-A`

- [ ] `importQueries.ts` / `importHooks.ts` added to `@kitchensink/recipe-service-client`
- [ ] New error codes discriminable via `is*` guards; job polling with bounded backoff
- [ ] **Unit + integration tests** (the client package already has an `__integration__` suite)

**Files** `packages/clients/recipe-service/src/{importQueries,importHooks,client,types,errors}.ts`

---

### T-021 · Import entry UI — **web AND mobile**

**Priority** P1 · **Effort** L · **Depends on** T-020 · **Implements** REQ-016, REQ-NF-004..006, REQ-CN-008 · **US-401, US-402, US-405, US-411**

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `UTP-027-A, UTP-028-A`

- [ ] `ImportEntry.tsx` + `ImportEntry.native.tsx` — identical public API (§14.3)
- [ ] `ImportProgress.tsx` + `.native.tsx`; shared headless hooks hold all logic (no logic in render leaves)
- [ ] Channel list driven by `GET /import/sources` so a gated channel never renders
- [ ] Mobile camera capture wired to the OCR channel (T-018) — mobile-primary, shipping in this task
- [ ] Web route `app/[locale]/recipes/import/page.tsx`; mobile `screens/ImportScreen.tsx`
- [ ] All copy localized in `messages.ts` and shared across platforms
- [ ] **Component tests for EVERY state** — idle, submitting, queued, running, succeeded, duplicate-found,
      each error class, channel-disabled — on **both** web and native leaves
- [ ] **Playwright** `importUrl.spec.ts` (`getByRole`/`getByLabel` only; no `data-testid`, no `waitForTimeout`)
- [ ] **Maestro** `import-url-flow.yaml` and `import-photo-flow.yaml`

**Files** `packages/apps/commise/features/recipes/src/import/*`, `web/src/app/[locale]/recipes/import/page.tsx`, `web/tests/e2e/importUrl.spec.ts`, `mobile/src/screens/ImportScreen.tsx`, `mobile/.maestro/recipes/*.yaml`

---

### T-022 · Draft review UI — **web AND mobile**

**Priority** P1 · **Effort** L · **Depends on** T-021 · **Implements** REQ-012, REQ-013, REQ-008, REQ-011, REQ-021 · **US-408, US-410**

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `UTP-029-A, ATP-012-A`

This is where the user completes what extraction could not determine — the pivot of the whole feature.

- [ ] `ImportDraftReview.tsx` + `.native.tsx`: editable title, ingredients, steps, times, servings
- [ ] Missing required fields are **visibly flagged and block confirmation** until completed
- [ ] Each ingredient row shows the parsed values **and the raw line**, and is correctable
- [ ] Low-confidence fields indicated by icon **and** text, never colour alone (REQ-NF-005)
- [ ] Paid-source attestation + citation control (D-003), with the consequence stated before saving
- [ ] **Component tests for EVERY state**: complete, each missing-field permutation, unparsed ingredient,
      low confidence, expired draft, save-in-flight, save-rejected — web **and** native
- [ ] **Playwright** `importDraft.spec.ts`; **Maestro** `import-draft-flow.yaml`

**Files** `packages/apps/commise/features/recipes/src/import/ImportDraftReview*.tsx`, tests, `web/tests/e2e/importDraft.spec.ts`, `mobile/.maestro/recipes/import-draft-flow.yaml`

---

### T-023 · Attribution display — **web AND mobile**

**Priority** P1 · **Effort** S · **Depends on** T-020 · **Implements** REQ-016, REQ-025 · **US-403**

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `UTP-030-A, ATP-016-A`

The previous task list had a web component here with **no mobile counterpart** — a §14.1 violation.

- [ ] `RecipeAttribution.tsx` + `RecipeAttribution.native.tsx`, identical public API
- [ ] Renders when `sourceUrl` or `sourceAttribution` is present; shows platform, author, and source link
- [ ] Web link opens in a new tab with `rel="noopener noreferrer"`; mobile opens the system browser
- [ ] Descriptive link text (never "click here"); accessible name present (REQ-NF-004)
- [ ] Unverifiable source rendered as such rather than hidden (REQ-025)
- [ ] **Component tests for EVERY state**: web source, Instagram source, cloned-with-attribution, unverifiable,
      absent (renders nothing) — both platforms
- [ ] Covered by the Playwright and Maestro flows in T-021/T-022

**Files** `packages/apps/commise/features/recipes/src/detail/RecipeAttribution{,.native}.tsx` + `__tests__/`

---

### T-024 · Error-state UI — **web AND mobile**

**Priority** P1 · **Effort** M · **Depends on** T-021, T-022 · **Implements** REQ-024, REQ-NF-005, REQ-NF-006 · **US-409**

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `UTP-031-A, ATP-024-A`

- [ ] `ImportErrorState.tsx` + `.native.tsx` mapping each error code to a distinct, actionable recovery
- [ ] Blocked, unreachable, no-recipe-found, no-caption, unsupported-format, too-large, OCR-failed,
      provider-unavailable, draft-expired each render a **distinct** message and next step
- [ ] Icon + text pairing throughout (REQ-NF-005); all copy localized
- [ ] **Component test per error code**, both platforms — an exhaustive switch over the code union so a new
      code cannot be added without a rendering branch

**Files** `packages/apps/commise/features/recipes/src/import/ImportErrorState{,.native}.tsx` + `__tests__/`

---

## Phase 6 — Verification gates

### T-025 · End-to-end suite

**Priority** P1 · **Effort** M · **Depends on** T-014..T-024 · **Implements** all

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ATP-CN-008-A`

- [ ] Service e2e boots against real Postgres + LocalStack (per the shipped harness) covering every channel,
      duplicate handling, blocked source, incomplete draft, and expiry
- [ ] Web Playwright and mobile Maestro flows green for every user story
- [ ] `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:e2e` all pass

---

### T-028 · Mutation-score gates on the pure core

**Priority** P1 · **Effort** S · **Depends on** T-005..T-008 · **Implements** REQ-NF-013 · _(D-010)_

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ATP-NF-013-A`

- [ ] `stryker` config scoped for `src/imports/`, extending the service's existing setup
- [ ] Thresholds that **break the build**: `policy/` 90% · `normalize/` 90% · `fetch/ssrf-guard.ts` 95% · `extractors/` 80%
- [ ] I/O adapters (`instagram/`, `ocr/`, `files/`, DALs) reported but **not** gated — unkillable mutants there are noise
- [ ] Wired into the same CI path as the existing mutation job
- [ ] A surviving mutant in a gated module is a test defect, fixed by strengthening the assertion — **never** by
      excluding the mutant or lowering the threshold

**Files** `packages/services/recipe-service/stryker.config.*`

---

### T-026 · k6 load and soak _(the previous task list had no performance tier at all)_

**Priority** P1 · **Effort** M · **Depends on** T-025 · **Implements** REQ-NF-011 · **SC-004**

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ATP-NF-011-A`

- [ ] `packages/tools/loadtest/import.js` following the shipped `journey.js` conventions (per-VU token refresh,
      success-only latency trends, script-relative `open()`)
- [ ] Asserts SC-004: URL import job p95 ≤ 15s / p99 ≤ 30s; draft confirm p95 ≤ 400ms
- [ ] Outbound fetches target a **local fixture server**, never third-party sites
- [ ] **Soak to failure**, not merely to target — establishes the capacity limit and the next bottleneck
- [ ] Verifies backpressure: over-capacity sheds `429`, it does not queue unboundedly or OOM
- [ ] Wired into the `heavy-e2e` labelled CI path alongside the existing k6 job

**Files** `packages/tools/loadtest/import.js`

---

### T-027 · SC-002 accuracy corpus and measurement

**Priority** P1 · **Effort** M · **Depends on** T-008 · **Implements** REQ-NF-003 · **SC-002, SC-003**

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ATP-NF-003-A`

SC-002 is unverifiable without this; the number is meaningless until the corpus exists.

- [ ] ≥50 hand-verified fixture pages spanning JSON-LD, microdata, and markup-free sources, with expected values
- [ ] Captured as static fixtures — the measurement must be deterministic and offline, never live-fetching
- [ ] Automated field-level accuracy report for title, ingredient lines, and steps
- [ ] **CI gate fails below 85%** (SC-002) and below 95% zero-missing-required for JSON-LD sources (SC-003)
- [ ] Corpus composition and licensing recorded in `v-model/acceptance-plan.md`

**Files** `src/imports/__fixtures__/corpus/`, `src/imports/__tests__/extraction-accuracy.test.ts`

---

## Task summary

| ID    | Title                     | Pri  | Effort | Depends      | Web+mobile paired |
| ----- | ------------------------- | ---- | ------ | ------------ | ----------------- |
| T-001 | OpenAPI contract          | P1   | M      | —            | n/a               |
| T-002 | Schema + migrations       | P1   | M      | T-001        | n/a               |
| T-003 | Import error codes        | P1   | S      | T-002        | n/a               |
| T-004 | Shared import contracts   | P1   | S      | T-001        | n/a               |
| T-005 | CanonicalSourceUrl        | P1   | S      | T-004        | n/a               |
| T-006 | ProvenancePolicy          | P1   | S      | T-004        | n/a               |
| T-007 | Normalizers               | P1   | L      | T-004        | n/a               |
| T-008 | Extractor chain           | P1   | L      | T-004        | n/a               |
| T-009 | Blocklist store           | P1   | M      | T-002        | n/a               |
| T-010 | SourceFetcher + SSRF ⚠️   | P1   | L      | T-005        | n/a               |
| T-011 | ImportsService facade     | P1   | M      | T-005..010   | n/a               |
| T-012 | Import drafts             | P1   | M      | T-011        | n/a               |
| T-013 | Jobs + worker             | P1   | M      | T-012        | n/a               |
| T-014 | URL channel               | P1   | M      | T-013        | n/a               |
| T-015 | File channel              | P1   | M      | T-011        | n/a               |
| T-016 | Confirmation bridge       | P1   | M      | T-012        | n/a               |
| T-017 | Admin blocklist endpoints | P1   | S      | T-009        | n/a               |
| T-018 | OCR channel               | P1   | L      | T-013        | n/a               |
| T-019 | Instagram channel (gated) | P1\* | M      | T-013        | n/a               |
| T-020 | Typed client              | P1   | M      | T-014, T-016 | n/a               |
| T-021 | Import entry UI           | P1   | L      | T-020        | ✅ yes            |
| T-022 | Draft review UI           | P1   | L      | T-021        | ✅ yes            |
| T-023 | Attribution display       | P1   | S      | T-020        | ✅ yes            |
| T-024 | Error-state UI            | P1   | M      | T-021, T-022 | ✅ yes            |
| T-025 | e2e suite                 | P1   | M      | T-014..024   | ✅ both           |
| T-026 | k6 load + soak            | P1   | M      | T-025        | n/a               |
| T-027 | SC-002 accuracy corpus    | P1   | M      | T-008        | n/a               |

`P1*` = gated on the external Meta credential (D-002); ships disabled, does not block release.

**No §14.1 single-platform waiver is claimed.** Every user-facing task (T-021..T-024) delivers web and mobile
together.
