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

| ID         | Title                                                                                  | Priority   | Requirements                       |
| ---------- | -------------------------------------------------------------------------------------- | ---------- | ---------------------------------- |
| US-401     | Import a recipe from a public URL                                                      | P1         | REQ-001..004, REQ-024              |
| US-402     | Import from an Instagram caption                                                       | P1 (gated) | REQ-005, REQ-IF-001, REQ-CN-004    |
| US-403     | Attribution on imported public recipes                                                 | P1         | REQ-016                            |
| US-404     | Provenance classification and visibility                                               | P1         | REQ-014, REQ-015, REQ-022          |
| ~~US-405~~ | ~~Import from a photo of a physical copy~~ — **transferred to 011** (D-001 as amended) | —          | —                                  |
| US-412     | Paste recipe text and import it                                                        | P1         | REQ-036, REQ-021, REQ-022, REQ-023 |
| US-406     | Reject paywalled sources                                                               | P1         | REQ-017..020                       |
| US-407     | Duplicate source handling                                                              | P1         | REQ-003, REQ-004, REQ-CN-001       |
| US-408     | Review and complete a draft before saving                                              | P1         | REQ-012, REQ-013, REQ-008, REQ-011 |
| US-409     | Actionable error recovery                                                              | P1         | REQ-024, REQ-NF-005                |
| US-410     | Paid-source attestation guardrail                                                      | P1         | REQ-021, REQ-022, REQ-023          |
| US-411     | Import from a structured file                                                          | P1         | REQ-006                            |

---

## Dependency graph

```
T-001 zod contract + schema-recipe regen ──┬─► T-002 schema/migrations ──► T-003 error codes
                                           └─► T-004 shared DOMAIN types (recipe-core; wire types stay in schema-recipe)
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
T-013 ──► T-032 raw-text channel   (T-018 OCR — TRANSFERRED to 011)
T-013 ──► T-019 Instagram channel (gated)
T-014,T-016 ──► T-020 typed client
T-020 ──► T-021 import UI (web+mobile) ──► T-022 draft review UI (web+mobile)
T-020 ──► T-023 attribution UI (web+mobile)
T-021,T-022 ──► T-024 error-state UI (web+mobile)
ALL ──► T-025 e2e · T-026 k6 · T-027 accuracy corpus
```

---

## Phase 1 — Contract and foundations

### T-001 · Author the import wire contract as zod in the service, and regenerate `@kitchensink/schema-recipe`

**Priority** P1 · **Effort** M · **Depends on** — · **Implements** REQ-IF-006, GR-015 §15-a, GR-016 §16-a, GR-017 §17-a.1/§17-a.3/§17-a.5/§17-c

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ATP-IF-006-A`

Contract-first: the contract is authored **before** any handler.

> ⛔ **REPOINTED 2026-08-12 — the target document changed, and the old one is superseded.** This task previously
> said "All 12 import endpoints added to `specs/001-commise-recipe-app/contracts/api.openapi.yaml`", extending a
> **hand-written** document (2,810 lines of body) that is **verified by nothing**. The recipe service's **derived**
> document now exists at **`packages/schemas/recipe/openapi.yaml`** (**5,700 lines, 34 paths** — against the
> hand-written file's 32 — ⚠️ re-measured 2026-08-12, correcting the **4,945** / **2,827** figures this note carried
> from 2026-08-11; the derived document is **generated** and grew when the `versions` and `api-error` schema copies
> landed, and the hand-written file grew by header rewrites, not by body. **`wc -l` them; do not quote these back.**),
> generated from the zod the service authors.
>
> **⛔ Do NOT extend the hand-written document.** Per `docs/CODING_STANDARDS.md` §15.2(6) and GR-015 §15-a.7 there
> is **one contract document per service and it REPLACES its hand-written predecessor**; adding 12 endpoints to
> the superseded file would make the problem strictly worse, because two artifacts would then both claim to be
> normative and only one is verified. Where the two disagree, **the service's zod wins**. Marking the old file
> superseded and repointing its citations is **001's T-186/T-187**.
>
> **The "one service, one contract" instinct was right; the artifact was wrong.** 004 still does not create
> `specs/004-recipe-importing/contracts/api.openapi.yaml`, and still adds to the **existing**
> `@kitchensink/schema-recipe` rather than forking a new schema package — a schema package is per **SERVICE**, not
> per feature.

- [ ] All 12 import endpoints authored as zod at `packages/services/recipe-service/src/imports/imports.schema.ts`,
      **beside the controller they serve** (§15.2) — never in a `dto/` directory
- [ ] Request/response schemas: `ImportDraft`, `ImportJob`, `ExtractedRecipe`, `ParsedIngredient`, `PaywalledDomain`
- [ ] Every `*.schema.ts` imports **only `zod` and other `*.schema.ts` files** (§15.2's load-bearing constraint) —
      no DAL type, no drizzle schema, no Nest symbol, or the copied package breaks and drags the server graph into
      every client
- [ ] Routes consume that zod through **`createZodDto`** under **`nestjs-zod`'s** `ZodValidationPipe` — ⚠️ never
      Nest's own `ValidationPipe`, under which a `createZodDto` DTO **validates nothing while looking correctly
      wired** (this already bit identity's `PATCH /users/me`). ⛔ **No `class-validator` DTO** is added — ⚠️ **corrected
      2026-08-12: recipe-service is no longer "mid-removal of 19 such files" (001 T-188); that removal is DONE and the
      count was a mention count anyway.** The service has **zero** `class-validator` importers and has dropped the
      dependency from `package.json` and `prod.package.json`, so a DTO added here would **re-introduce** the second
      mechanism GR-016 §16-a.2 forbids and would fail repo-wide gate **G5** in
      `packages/infra/global/__tests__/serviceSecurityInvariants.test.ts`, which has no exception list
- [ ] **Every mutating body uses `z.strictObject()`** (GR-017 §17-c) — `z.object()` strips unknown keys silently,
      so a misspelled field on an import request yields a `200` and a partial write the caller was told succeeded
- [ ] `Idempotency-Key` required on `/api/v1/import/{url,instagram,text}` — modelled in the schema (a required
      header, parsed, not merely documented) so it cannot be omitted by a handler
- [ ] Every error response references the shipped `ErrorResponse` envelope, with the new codes enumerated
- [ ] Status codes match `plan.md §3` exactly (422 for policy/extraction failures, not 400)
- [ ] `npm run contract:verify` regenerates `packages/schemas/recipe` — `schemas.ts`, `types.ts` (`z.infer` only),
      `contractHash.ts`, barrel, and the **derived** `openapi.yaml` — with **no diff**; nothing in it is hand-edited
- [ ] `packages/services/recipe-service/src/__tests__/buildInputs.test.ts` covers the new schema file, so turbo's
      `$TURBO_ROOT$` **`inputs`** glob rebuilds the copy on a content change; the `CONTRACT_HASH` boot assertion
      still holds

⛔ **Three things that look wrong and are not.** The schema package is a literal file **COPY**, not a
transformation — zod schemas are runtime values, so they cannot be derived from themselves. `openapi.yaml` is
**DERIVED** output for `oasdiff`/docs/integrators and is **NEVER a codegen input** — deriving types through JSON
Schema loses `readonly`, branded and template-literal types and flattens discriminated unions, which matters here
because `ImportChannel` **is** a discriminated union (T-004). And the copy is wired with `$TURBO_ROOT$` **`inputs`**,
**never `dependsOn`** — that edge closes the cycle `client → schema → service → client`, because `recipe-service`
devDepends on its own client for the contract tier.

⛔ **Do NOT add server-side response validation.** GR-016 §16-g **defers** a producing service parsing what it
**emits** — an owner decision, not an unfinished task. Consumer-side receipt validation (T-020) is the required
half (GR-017 §17-f).

- [ ] Contract lints clean; a schema round-trip test asserts the generated package's types match the authored zod
- [ ] **Unit tests**: each schema accepts a valid fixture and rejects every malformed variant — wrong-typed field,
      missing field, unknown key, absent `Idempotency-Key`
- [ ] **Integration test**: a known-bad body posted to a **real** import route on a booted app returns `400`
      naming the offending field (modelled on `packages/services/identity/tests/appValidation.test.ts`) — this is
      the **only** thing that can observe the wrong-pipe failure; plus regenerate-and-diff clean

**Files** `packages/services/recipe-service/src/imports/imports.schema.ts`, `packages/schemas/recipe/*` (generated),
`packages/services/recipe-service/src/imports/__tests__/`

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

**Files** `packages/shared/recipe-core/src/recipe.types.ts`, `src/common/filters/apiException.filter.ts`, `src/imports/import.error.ts`, `packages/clients/recipe-service/src/errors.ts`

---

### T-004 · Shared import contracts

**Priority** P1 · **Effort** S · **Depends on** T-001 · **Implements** REQ-IF-006, REQ-NF-001, REQ-NF-002

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `UTP-034-A`

- [ ] `importTypes.ts`, `importDraft.ts` in `@kitchensink/recipe-core` (camelCase — §1b)
- [ ] `ImportChannel`, `ImportJobState` and the **domain** vocabulary live here (GR-007 axis)
- [ ] ⛔ **`ExtractedRecipe`, `ParsedIngredient`, `NormalizedDraft` and `ImportDraft` are WIRE shapes and belong to
      `@kitchensink/schema-recipe`** (T-001), not to `recipe-core`. GR-007 governs **domain** types; GR-015 governs
      **wire** types — the endpoint envelopes — and these four are request/response bodies of the import endpoints.
      Declaring them here as well would create the two-independent-representations drift GR-015 exists to prevent.
      A schema package **reuses `recipe-core` `import type`** and never re-declares its types; the reverse is
      equally true
- [ ] `ImportChannel` is a discriminated union enabling exhaustive switching (Visitor intent — no class hierarchy).
      ⚠️ This is also why `openapi.yaml` must never be a codegen input: JSON Schema flattens a discriminated union
      without explicit `oneOf`/`discriminator`, and a generated schema that silently flattens it is a contract that
      lies
- [ ] JSDoc on every export; zero `any`
- [ ] **Unit tests** assert exhaustiveness: adding a channel fails compilation at every switch
- [ ] **Unit tests** assert each `recipe-core` domain type used by a wire schema is consumed `import type` only, so
      no runtime dependency leaks into the copied schema package
- [ ] **Integration test**: a `git ls-files`-based assertion that no wire shape of the import endpoints is declared
      outside `@kitchensink/schema-recipe`

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
- [ ] `url`/`instagram` → `imported_public`; `file` → `user_created` (`FR-011`); `text` → `user_created`, or `imported_paid` when attested (`FR-014a`); attested non-public source →
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
- [ ] Expiry sweep deletes due drafts **and** any artifacts they own in one unit (REQ-026) _(OCR objects are 011's; 004 sweeps only what 004 stored)_ — an image must never outlive its draft
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
- [ ] 200 imports/day/user across channels _(the 50/day OCR sub-allowance transfers to 011 with the channel — REQ-029)_; `IMPORT_QUOTA_EXCEEDED` (`429`) carries `resetsAt`
- [ ] Quota function accepts the principal's tier and returns identical limits for all tiers today — the seam 010 needs
- [ ] Burst limits via shipped `@Throttle`: 10/min url+instagram, 10/min text _(the 5/min photo limit transfers to 011)_
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

**Files** `packages/services/recipe-service/src/recipes/recipes.service.ts`, `dto/createRecipe.dto.ts`, tests alongside

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
- [ ] **Integration test**: an unentitled attested-paid submission is rejected **before** any downstream work _(the equivalent OCR-provider assertion transfers to 011)_

**Files** `src/imports/imports.service.ts`, `src/imports/policy/provenance.policy.ts`, tests alongside

---

### T-018 · ⛔ TRANSFERRED TO 011 — do NOT build the OCR channel here _(D-001 as amended 2026-08-14; ADR-0019 §3)_

**Priority** — · **Effort** — · **Depends on** — · **Implements** — · **Mitigates** —

**Test-first:** n/a — 004 builds nothing here.

The row is kept rather than deleted so nobody rediscovers the OCR channel from a stale artifact and builds it.
`spec.md`'s channel-ownership banner and `FR-012` reassigned photo/OCR to
[011-recipe-digitization](../011-recipe-digitization/spec.md) on 2026-08-14; this file was never re-synced and
still said "P1, ships at launch". Building it would have produced **two** OCR pipelines, and 011's would have
been the one with the on-device tier.

- [x] **What it said** — `ocr-provider.port.ts` + `textract.adapter.ts`, `POST /import/photo` → `202`, S3 +
      `sharp` preprocessing, bounded polling with a breaker, `imported_physical` drafts, source-image deletion
      on every terminal path, OCR text never logged, and the §15-d boundary-validation discipline for Textract.
- [x] **Why it is superseded** — the channel moved with its service. 011 runs a **stateless** image-processing
      service (ADR-0019 §3) and submits its extracted candidates to 004's bulk import contract; a second OCR
      pipeline in the recipe service is the duplication ADR-0019 §1 exists to prevent.
- [x] **What survives, and where it went** — every _rule_ transfers to 011 and 011 MUST inherit rather than
      re-derive it: the premium gate (D-014), the tighter OCR sub-quota (REQ-029), artifact deletion on draft
      expiry (REQ-026), OCR text never logged (REQ-NF-012), and ⛔ the §15-d **opposite-case** treatment of the
      OCR vendor — boundary-validate its raw shape with zod, never converge it, never give it an OpenAPI
      document, and **reject an absent confidence rather than defaulting it to `0`**, because a sentinel
      confidence silently passes the quality gate. Deleting that boundary schema in the convergence rule's
      name is a **security regression**, not a cleanup.
- [x] **What 004 still owes the photo method** — exactly two things, both already tasked: the chooser presents
      photo as **unavailable-until-011** rather than omitting it or rendering a dead control (REQ-016 /
      `FR-046`, T-021), and the bulk import contract accepts `sourceType = imported_physical` without a
      contract change (`FR-047`, T-013/T-020).
- [x] ⛔ **`imported_physical` is NOT what 011's mobile OCR declares.** See T-032 and `spec.md` `FR-011`:
      client-declared `imported_physical` is **not representable** in the DTO (REQ-032, HAZ-057), so 011's
      submission classifies **`imported_paid`**. The premium gate keeps its enforcement point either way,
      because both classes are private-only under the shipped C-004 policy.

**Files** none in 004. The build is `specs/011-recipe-digitization/`.

---

### T-032 · Raw-text channel _(FR-052 — P1, ships at launch)_

**Priority** P1 · **Effort** M · **Depends on** T-013 · **Implements** REQ-036, REQ-021, REQ-022, REQ-023, REQ-032 · **US-412**

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ATP-036-A, ATP-036-B, ITP-013-A`

Paste is a **first-class channel**, not a fallback. It is the only channel every error path in this feature
already promises — every wireframe's failure state offers "paste manually", and the product spec's J3 journey
is entirely about it — while `spec.md`, `plan.md` and this file shipped no endpoint, no FR and no task for it.
That is a hole, not a new feature. It is also what the OCR transfer makes load-bearing: with photo owned by
011, paste is how a user gets a cookbook recipe in **today**.

- [ ] `POST /api/v1/recipes/import/text` → **`201` synchronously**, not `202`. There is no fetch and no vendor
      call, so there is nothing to poll; an async job here would be ceremony that adds a failure mode
- [ ] Body is `{ text, declaredSource, sourceCitation? }`. `text` is bounded (≤ 100 KB) and rejected empty;
      the bound is asserted, because an unbounded body is the memory-exhaustion vector this repo has already
      been bitten by
- [ ] Extracted text flows through the **same** normalize → parse → classify → draft path as every other
      channel (`FR-047` convergence) — no second pipeline, no channel-specific draft shape
- [ ] ⛔ **Provenance is DECLARED, never inferred.** `declaredSource` is whitelisted server-side (REQ-032):
      `own` → **`user_created`**; `paid-source` **plus a citation** → **`imported_paid`** (FR-014a, FR-011).
      `imported_public` and `imported_physical` are **not representable** on this endpoint — a client that
      could declare either would grant itself a private recipe C-004 reserves for premium (HAZ-057)
- [ ] The paste body itself is **user input at an untrusted boundary** — validated with the endpoint's own zod
      (GR-016), and **never logged** (REQ-NF-012). A pasted cookbook page is third-party copyrighted text
- [ ] Unparseable content **degrades, never fails**: lines that will not parse are preserved verbatim with a
      null quantity and flagged for correction (REQ-021 / `FR-020`), so a paste of prose still produces a
      reviewable draft rather than a `422`
- [ ] Counts against the shared 200/day allowance; 10/min burst via the shipped `@Throttle`
- [ ] **Unit tests**: an ingredients-and-steps paste, a prose paste, a paste with no recognisable recipe,
      empty, whitespace-only, at the size bound and one byte over, and every `declaredSource` value including
      the two that must be rejected
- [ ] **Integration tests**: `paid-source` without a citation is rejected; `paid-source` with one produces a
      draft that confirms to a **private** recipe under the shipped `evaluateVisibility`; `own` produces
      `user_created`
- [ ] **e2e** `import-text.e2e.test.ts`

**Files** `src/imports/text/*.ts`, tests alongside, `tests/e2e/import-text.e2e.test.ts`

---

### T-019 · Instagram channel _(D-002 — gated)_

**Priority** P1 (gated) · **Effort** M · **Depends on** T-013 · **Implements** REQ-005, REQ-IF-001, REQ-CN-004 · **US-402**

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ATP-005-A, ATP-005-B, ITP-012-A`

- [ ] `oembed-provider.port.ts` + Meta-hosted adapter using an app credential from SSM/Secrets
- [ ] **Capability flag defaults OFF.** With it off the endpoints return `404`, the channel is absent from
      `GET /import/sources`, and neither UI offers it — no dead affordance
- [ ] `429` classified explicitly as throttled, not a generic failure (HAZ-010); response shape validated (HAZ-012)
- [ ] No caption / no recipe text ⇒ `422 IMPORT_NO_CAPTION`
- [ ] ⛔ **Instagram/Meta oEmbed is the §15-d OPPOSITE case — boundary-validate it, and NEVER "converge" it.** It is
      an API the platform does **not** serve. The adapter **validates the raw upstream oEmbed shape at the boundary
      with its own zod** the moment a body arrives, **MAY declare its own types**, and **gets NO OpenAPI document**.
      Rules 17-b.1–17-b.5 do **not** apply to it, and Meta's shapes **must not enter `@kitchensink/schema-recipe`**.
      HAZ-012's "response shape validated" **is** this obligation — it is required by GR-016, not optional hardening,
      because the caption is untrusted third-party text that becomes a user's recipe
- [ ] ⛔ **Deleting that boundary schema in GR-015 §15-b's name is a security regression, not a cleanup.**
      `packages/clients/usda/src/schemas.ts` is the reference implementation and must **NEVER** be touched for it
- [ ] **Developed and tested against a contract fake** — CI must be green without a Meta credential
- [ ] **Unit + integration tests** via the fake; a contract test pins the expected oEmbed response shape, and the
      boundary schema is asserted to reject a renamed, missing, wrong-typed and null-valued upstream field. ⚠️ The
      fake must be **generated from the same zod** the adapter validates against, or the fake and the parser can
      agree with each other while both disagree with Meta
- [ ] **e2e** runs with the flag on against the fake, and with the flag off asserting `404`

**Files** `src/imports/instagram/*.ts`, tests alongside

---

## Phase 5 — Client and UI (web + mobile in lockstep, §14.1)

### T-020 · Typed client extension

**Priority** P1 · **Effort** M · **Depends on** T-014, T-016 · **Implements** REQ-IF-006

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `ITP-016-A`

- [ ] `importQueries.ts` / `importHooks.ts` added to `@kitchensink/recipe-service-client`
- [ ] New error codes discriminable via `is*` guards; job polling with bounded backoff
- [ ] ⛔ **The client declares NO wire shape of its own** (GR-015 §15-b.2, GR-017 §17-b.1). It imports wire **types
      and runtime zod** from `@kitchensink/schema-recipe`; `types.ts` keeps only genuinely client-side types — base
      URL and fetch config, request options, its own error shapes — **including type-only** declarations
- [ ] **Every response is parsed with that zod at the moment the body arrives** (GR-016 §16-c.3, GR-017 §17-b.3).
      ⚠️ **The `ImportJob` poll response is the load-bearing case**: a drifted `state` field read without parsing
      either polls forever or reports success on a job that failed
- [ ] **Every outbound body is validated against the schema-package zod before the call** (§16-c.2), so a malformed
      import request fails in the caller with a usable stack rather than as a remote `400`/`422`
- [ ] A parse failure is a typed client error naming the field — never a silent cast
- [ ] The existing `packages/clients/recipe-service/src/contractSkew.ts` guard covers these endpoints once the hash
      changes — **extend `src/__tests__/contractSkew.test.ts`; do NOT add a second guard**
- [ ] ⛔ **Do NOT add server-side response validation** — GR-016 §16-g defers a producing service parsing what it
      **emits**. This is the **consumer** parsing what it **received** (GR-017 §17-f); only this half is required
- [ ] **Unit tests**: each method's happy path and every mapped error status; a response with a missing, renamed and
      wrong-typed field each raise the typed parse error; an invalid outbound body is rejected **before** any fetch
- [ ] **Integration tests** (the client package already has an `__integration__` suite): a live import response
      parses clean, and a hand-skewed fixture does not

**Files** `packages/clients/recipe-service/src/{importQueries,importHooks,client,types,errors,contractSkew}.ts`,
`packages/clients/recipe-service/src/__tests__/contractSkew.test.ts`

---

### T-021 · Import entry UI — **web AND mobile**

**Priority** P1 · **Effort** L · **Depends on** T-020, T-032 · **Implements** REQ-016, REQ-NF-004..006, REQ-CN-008 · **US-401, US-402, US-411, US-412**

**Test-first:** true — these tests are written and confirmed **failing** before any implementation: `UTP-027-A, UTP-028-A`

- [ ] `ImportEntry.tsx` + `ImportEntry.native.tsx` — identical public API (§14.3)
- [ ] `ImportProgress.tsx` + `.native.tsx`; shared headless hooks hold all logic (no logic in render leaves)
- [ ] Channel list driven by `GET /import/sources` so a gated channel never renders
- [ ] ⛔ **No camera capture in this task.** Photo renders as **unavailable-until-011** with the reason shown
      (`FR-046`) — not omitted, not a control that does nothing. T-018 is transferred; wiring a capture button
      to a channel 004 does not build is the dead affordance `FR-046` exists to forbid.
- [ ] Web route `app/[locale]/recipes/import/page.tsx`; mobile `screens/ImportScreen.tsx`
- [ ] All copy localized in `messages.ts` and shared across platforms
- [ ] **Component tests for EVERY state** — idle, submitting, queued, running, succeeded, duplicate-found,
      each error class, channel-disabled — on **both** web and native leaves
- [ ] **Playwright** `importUrl.spec.ts` (`getByRole`/`getByLabel` only; no `data-testid`, no `waitForTimeout`)
- [ ] **Maestro** `import-url-flow.yaml` and `import-text-flow.yaml` _(the photo flow belongs to 011)_

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
- [ ] Blocked, unreachable, no-recipe-found, no-caption, unsupported-format, too-large, text-unparseable,
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
- [ ] I/O adapters (`instagram/`, `files/`, DALs) reported but **not** gated — unkillable mutants there are noise
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

| ID    | Title                               | Pri  | Effort | Depends      | Web+mobile paired |
| ----- | ----------------------------------- | ---- | ------ | ------------ | ----------------- |
| T-001 | Wire zod + `schema-recipe` regen    | P1   | M      | —            | n/a               |
| T-002 | Schema + migrations                 | P1   | M      | T-001        | n/a               |
| T-003 | Import error codes                  | P1   | S      | T-002        | n/a               |
| T-004 | Shared import contracts             | P1   | S      | T-001        | n/a               |
| T-005 | CanonicalSourceUrl                  | P1   | S      | T-004        | n/a               |
| T-006 | ProvenancePolicy                    | P1   | S      | T-004        | n/a               |
| T-007 | Normalizers                         | P1   | L      | T-004        | n/a               |
| T-008 | Extractor chain                     | P1   | L      | T-004        | n/a               |
| T-009 | Blocklist store                     | P1   | M      | T-002        | n/a               |
| T-010 | SourceFetcher + SSRF ⚠️             | P1   | L      | T-005        | n/a               |
| T-011 | ImportsService facade               | P1   | M      | T-005..010   | n/a               |
| T-012 | Import drafts                       | P1   | M      | T-011        | n/a               |
| T-013 | Jobs + worker                       | P1   | M      | T-012        | n/a               |
| T-014 | URL channel                         | P1   | M      | T-013        | n/a               |
| T-015 | File channel                        | P1   | M      | T-011        | n/a               |
| T-016 | Confirmation bridge                 | P1   | M      | T-012        | n/a               |
| T-017 | Admin blocklist endpoints           | P1   | S      | T-009        | n/a               |
| T-018 | ⛔ OCR channel — TRANSFERRED to 011 | —    | —      | —            | n/a               |
| T-032 | Raw-text channel                    | P1   | M      | T-013        | n/a               |
| T-019 | Instagram channel (gated)           | P1\* | M      | T-013        | n/a               |
| T-020 | Typed client                        | P1   | M      | T-014, T-016 | n/a               |
| T-021 | Import entry UI                     | P1   | L      | T-020        | ✅ yes            |
| T-022 | Draft review UI                     | P1   | L      | T-021        | ✅ yes            |
| T-023 | Attribution display                 | P1   | S      | T-020        | ✅ yes            |
| T-024 | Error-state UI                      | P1   | M      | T-021, T-022 | ✅ yes            |
| T-025 | e2e suite                           | P1   | M      | T-014..024   | ✅ both           |
| T-026 | k6 load + soak                      | P1   | M      | T-025        | n/a               |
| T-027 | SC-002 accuracy corpus              | P1   | M      | T-008        | n/a               |

`P1*` = gated on the external Meta credential (D-002); ships disabled, does not block release.

**No §14.1 single-platform waiver is claimed.** Every user-facing task (T-021..T-024) delivers web and mobile
together.
