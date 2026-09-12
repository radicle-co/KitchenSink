# Integration Test Plan: Recipe Importing

**Feature Branch**: `004-recipe-importing`
**Regenerated**: 2026-08-02
**Status**: Approved
**Source**: `architecture-design.md` (ARCH-001..ARCH-034)
**Level**: Integration verification — module-to-module, against **real** dependencies
**Realisation**: `src/imports/__integration__/*.integration.test.ts`, run by `vitest.integration.config.ts`
against Docker Postgres + LocalStack.

> **Regeneration note.** In the previous document set, Matrix C left **ARCH-005, ARCH-007, ARCH-008, ARCH-009,
> ARCH-011, ARCH-012, and ARCH-018 with `❌ MISSING` integration coverage** — including the paywall enforcer
> and the attribution/visibility gate. Every module below now has coverage.

## ID Schema

`ITP-{ARCH}-{letter}` — a procedure exercising a module against its real collaborators ·
`ITS-{ARCH}-{letter}{n}` — a scenario within it.

## Principle

Integration tests exercise the **real** dependency: real Postgres for persistence, LocalStack for S3/SQS, and a
**local fixture HTTP server** for third-party sources. Only two things are faked, and only because the vendor
cannot be reached from CI: `OcrProvider` (Textract) and `OEmbedProvider` (Meta). Each of those carries one
contract test pinning the real response shape, so a vendor change surfaces as a failing contract rather than a
production incident.

---

## ITP-001 — ImportsController ↔ ImportsService (ARCH-001, ARCH-002)

#### Test Case: ITP-001-A (Valid POST /import/url with an idempotency key)

#### Test Case: ITP-001-B (Malformed URL body)

#### Test Case: ITP-001-C (Domain error raised downstream)

| ID         | Scenario                                         | Expected                                                     |
| ---------- | ------------------------------------------------ | ------------------------------------------------------------ |
| ITS-001-A1 | Valid `POST /import/url` with an idempotency key | `202`; a job row exists with the key                         |
| ITS-001-A2 | Same key replayed                                | `202` with the **same** `jobId`; one job row                 |
| ITS-001-A3 | Missing `Idempotency-Key`                        | `400`                                                        |
| ITS-001-B1 | Malformed URL body                               | `400` from validation, before any service call               |
| ITS-001-B2 | Body with unexpected extra keys                  | Stripped by `whitelist`, not persisted                       |
| ITS-001-C1 | Domain error raised downstream                   | Mapped by the **shipped** filter to `{code,message,details}` |

## ITP-002 — ImportsService pipeline ordering (ARCH-002)

#### Test Case: ITP-002-A (Full pipeline with instrumented collaborators)

#### Test Case: ITP-002-B (Blocklist lookup throws [store down])

| ID         | Scenario                                      | Expected                                                                                            |
| ---------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| ITS-002-A1 | Full pipeline with instrumented collaborators | Call order is exactly blocklist → fetch → extract → normalize → classify → dedupe → draft (HAZ-026) |
| ITS-002-A2 | Blocklist raises                              | Fetch is **never** invoked                                                                          |
| ITS-002-B1 | Blocklist lookup throws (store down)          | Import aborts — fails closed (HAZ-044)                                                              |
| ITS-002-B2 | Classification throws                         | No draft persisted; nothing defaults to public (HAZ-043)                                            |

## ITP-003 — SourceFetcher ↔ SsrfGuard ↔ Blocklist (ARCH-005, ARCH-006, ARCH-023) ⚠️

#### Test Case: ITP-003-A (Fixture server serves a normal page)

#### Test Case: ITP-003-B (Fixture host resolves to a private address)

#### Test Case: ITP-003-C (Fixture streams 50 MB)

#### Test Case: ITP-003-D (Blocked domain consulted from the real table)

#### Test Case: ITP-003-E (Repeated failures from one domain)

| ID         | Scenario                                                       | Expected                                                     |
| ---------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| ITS-003-A1 | Fixture server serves a normal page                            | Body returned within budget                                  |
| ITS-003-B1 | Fixture host resolves to a private address                     | Refused; fixture server records no connection                |
| ITS-003-B2 | Fixture 302s to `http://169.254.169.254/`                      | Refused at the hop (REQ-018)                                 |
| ITS-003-B3 | DNS returns a public address, then a private one on re-resolve | Pinned connection prevents rebinding                         |
| ITS-003-C1 | Fixture streams 50 MB                                          | Aborted past 5 MB; process memory does not grow with payload |
| ITS-003-C2 | Fixture stalls after headers                                   | Aborted at the total deadline                                |
| ITS-003-D1 | Blocked domain consulted from the real table                   | Refused pre-fetch                                            |
| ITS-003-D2 | Redirect target added to the blocklist mid-chain               | Refused at that hop                                          |
| ITS-003-E1 | Repeated failures from one domain                              | Breaker opens; other domains unaffected (bulkhead)           |

## ITP-004 — Extractor chain over the corpus (ARCH-007..ARCH-011)

#### Test Case: ITP-004-A (Each corpus stratum through the real chain)

#### Test Case: ITP-004-B (Adversarial stratum)

#### Test Case: ITP-004-C (Chain with the JSON-LD strategy removed)

| ID         | Scenario                                   | Expected                                                                |
| ---------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| ITS-004-A1 | Each corpus stratum through the real chain | Expected strategy hits per stratum                                      |
| ITS-004-A2 | Whole corpus                               | Field accuracy ≥ 85% (SC-002 gate)                                      |
| ITS-004-A3 | Well-formed JSON-LD stratum                | ≥ 95% yield a draft missing at most `servings` (SC-003)                 |
| ITS-004-B1 | Adversarial stratum                        | No throw escapes the chain; each returns null or a valid payload        |
| ITS-004-C1 | Chain with the JSON-LD strategy removed    | Microdata strategy takes over — proves ordering is data, not hardcoding |

## ITP-005 — Normalizer ↔ parsers ↔ sanitizer (ARCH-018..ARCH-021)

#### Test Case: ITP-005-A (Extracted payload with mixed ingredient lines)

#### Test Case: ITP-005-B (Payload with markup in every text field)

| ID         | Scenario                                      | Expected                                                    |
| ---------- | --------------------------------------------- | ----------------------------------------------------------- |
| ITS-005-A1 | Extracted payload with mixed ingredient lines | Structured where possible; `raw` retained on every line     |
| ITS-005-A2 | Payload missing times and servings            | `missingRequired` lists them; no value fabricated (HAZ-040) |
| ITS-005-B1 | Payload with markup in every text field       | All fields inert after normalization (HAZ-029)              |
| ITS-005-B2 | A channel bypassing MOD-018 (simulated)       | Fails a guard test — proves sanitization cannot be skipped  |

## ITP-006 — Provenance ↔ shipped visibility policy (ARCH-022 + 001)

#### Test Case: ITP-006-A (Each channel classified, then a real recipe created)

#### Test Case: ITP-006-B (imported_paid recipe, premium owner attempts public)

#### Test Case: ITP-006-C (Grep/inspection assertion)

| ID         | Scenario                                                          | Expected                                                      |
| ---------- | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| ITS-006-A1 | Each channel classified, then a real recipe created               | `source_type` persisted per REQ-014                           |
| ITS-006-B1 | `imported_paid` recipe, premium owner attempts public             | Refused by the **shipped** `evaluateVisibility`               |
| ITS-006-B2 | `imported_public` recipe cloned + substantively edited by premium | Private permitted — the shipped C-004 path, unmodified        |
| ITS-006-C1 | Grep/inspection assertion                                         | 004 contains no second visibility implementation (REQ-CN-007) |

## ITP-007 — CanonicalSourceUrl ↔ dedup ↔ unique index (ARCH-024, SYS-009)

#### Test Case: ITP-007-A (Equivalent URL variants inserted)

#### Test Case: ITP-007-B (Two concurrent inserts of one canonical URL [real Postgres])

#### Test Case: ITP-007-C (Insert with source_url_canonical = NULL [file/OCR])

| ID         | Scenario                                                    | Expected                                                                     |
| ---------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| ITS-007-A1 | Equivalent URL variants inserted                            | Second resolves to the first                                                 |
| ITS-007-B1 | Two concurrent inserts of one canonical URL (real Postgres) | Exactly one succeeds; the other catches the violation and resolves (HAZ-018) |
| ITS-007-B2 | Insert after the first row is soft-deleted                  | Succeeds — partial index excludes tombstones (REQ-CN-002)                    |
| ITS-007-C1 | Insert with `source_url_canonical = NULL` (file/OCR)        | Many permitted — the index is partial on NOT NULL                            |

## ITP-008 — Draft lifecycle against real Postgres (ARCH-025)

#### Test Case: ITP-008-A (Create → patch → confirm)

#### Test Case: ITP-008-B (Read another owner's draft)

#### Test Case: ITP-008-C (Expiry sweep with an OCR draft)

| ID         | Scenario                       | Expected                                                    |
| ---------- | ------------------------------ | ----------------------------------------------------------- |
| ITS-008-A1 | Create → patch → confirm       | Row transitions; `missingRequired` recomputed on patch      |
| ITS-008-A2 | Two concurrent confirms        | One recipe only (conditional update wins)                   |
| ITS-008-B1 | Read another owner's draft     | `404` (HAZ-046)                                             |
| ITS-008-C1 | Expiry sweep with an OCR draft | Row deleted **and** the LocalStack S3 object gone (REQ-026) |
| ITS-008-C2 | Sweep run twice                | Idempotent                                                  |

## ITP-009 — Jobs, worker, queue (ARCH-003, ARCH-004)

#### Test Case: ITP-009-A (Enqueue → worker consumes → succeeds)

#### Test Case: ITP-009-B (Two workers race for one job)

#### Test Case: ITP-009-C (Handler throws repeatedly)

| ID         | Scenario                             | Expected                                       |
| ---------- | ------------------------------------ | ---------------------------------------------- |
| ITS-009-A1 | Enqueue → worker consumes → succeeds | Job terminal with `draftId`                    |
| ITS-009-A2 | Message redelivered (at-least-once)  | Exactly one draft (idempotent handler)         |
| ITS-009-B1 | Two workers race for one job         | Only one claims it (conditional status update) |
| ITS-009-C1 | Handler throws repeatedly            | Retries to the cap, then DLQ                   |
| ITS-009-C2 | Typed domain failure                 | **Not** retried; recorded with its code        |

## ITP-010 — Confirmation ↔ shipped recipe write path ↔ food client (ARCH-026)

#### Test Case: ITP-010-A (Complete draft confirmed)

#### Test Case: ITP-010-B (Incomplete draft confirmed)

#### Test Case: ITP-010-C (Food service unreachable)

| ID         | Scenario                               | Expected                                                            |
| ---------- | -------------------------------------- | ------------------------------------------------------------------- |
| ITS-010-A1 | Complete draft confirmed               | Recipe row created with attribution and `source_type` intact        |
| ITS-010-A2 | Recipe steps and ingredients persisted | Ordered steps; quantities satisfying `CHECK (quantity > 0)`         |
| ITS-010-B1 | Incomplete draft confirmed             | `422`; **no** partial recipe row (HAZ-024)                          |
| ITS-010-C1 | Food service unreachable               | Confirmation succeeds; ingredients `PENDING`/`UNRESOLVED` (HAZ-050) |
| ITS-010-C2 | Food service returns results later     | Status transitions to `RESOLVED` via the shipped lifecycle          |

## ITP-013 — Raw-text channel (REQ-036, `FR-052`) _(added 2026-08-16)_

#### Test Case: ITP-013-A (Paste → shared pipeline → draft, in one request)

| ID         | Scenario                                                     | Expected                                                                                                        |
| ---------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| ITS-013-A1 | Paste with `declaredSource = own`                            | `201` carrying the draft; `user_created`; **no** row in `import_jobs` — the channel is synchronous              |
| ITS-013-A2 | Paste with `declaredSource = paid-source` **and** a citation | `201`; `imported_paid`; confirming yields a recipe the shipped `evaluateVisibility` refuses to make public      |
| ITS-013-A3 | Paste with `declaredSource = paid-source`, citation omitted  | Rejected; **no** draft persisted (asserted by reading the table, not by trusting the response)                  |
| ITS-013-A4 | Paste declaring `imported_public` or `imported_physical`     | Rejected at validation as not representable (REQ-032, HAZ-057)                                                  |
| ITS-013-A5 | Paste of prose containing two parseable lines                | Draft created; unparseable lines stored **verbatim** with null quantity and a correction flag; request succeeds |
| ITS-013-A6 | Paste one byte over the documented bound                     | Rejected before any parse work; the limit is named in the error                                                 |
| ITS-013-A7 | Successful paste, log sink inspected                         | No fragment of the pasted body appears in any log line (REQ-NF-012)                                             |

## ITP-011 — OCR pipeline against LocalStack (ARCH-014..ARCH-016) — ⛔ TRANSFERRED TO 011, 2026-08-16

> **Where the coverage went.** ARCH-014…016 moved to 011 with the photo channel. ITP-011-A…D are **retained
> and NOT deleted** — 011 inherits them. ⛔ **ITP-011-D is the one that must not be lost in the move**: it is
> the contract test against the pinned Textract shape, and it is the tier that catches a vendor changing a
> field name under us. Per GR-015 §15-d the OCR provider is the **opposite** case — boundary-validate its raw
> shape with zod, never converge it — so deleting that test in a convergence cleanup is a **security
> regression**, not tidying. 011 additionally owes an integration test for the **on-device** tier that
> asserts the provider is never called at all.

#### Test Case: ITP-011-A (Upload → store → fake provider → draft)

#### Test Case: ITP-011-B (Confirm / discard / expire)

#### Test Case: ITP-011-C (Provider timeout)

#### Test Case: ITP-011-D (Contract test against the pinned Textract shape)

| ID         | Scenario                                        | Expected                                                   |
| ---------- | ----------------------------------------------- | ---------------------------------------------------------- |
| ITS-011-A1 | Upload → store → fake provider → draft          | Object exists during the draft's life; draft references it |
| ITS-011-B1 | Confirm / discard / expire                      | Object deleted on each path (HAZ-035)                      |
| ITS-011-C1 | Provider timeout                                | `503`; object still cleaned up                             |
| ITS-011-D1 | Contract test against the pinned Textract shape | Adapter parses it; a shape change fails here               |

## ITP-012 — Instagram adapter (ARCH-012, ARCH-013)

#### Test Case: ITP-012-A (Fake provider returns a recipe caption)

#### Test Case: ITP-012-B (Fake returns 429)

#### Test Case: ITP-012-C (Contract test against the pinned oEmbed shape)

#### Test Case: ITP-012-D (Flag off)

| ID         | Scenario                                      | Expected                                        |
| ---------- | --------------------------------------------- | ----------------------------------------------- |
| ITS-012-A1 | Fake provider returns a recipe caption        | Draft produced                                  |
| ITS-012-A2 | Fake returns no caption                       | `IMPORT_NO_CAPTION`                             |
| ITS-012-B1 | Fake returns 429                              | Throttled classification (HAZ-010)              |
| ITS-012-B2 | Fake returns an unexpected shape              | `IMPORT_PROVIDER_UNAVAILABLE`; no partial draft |
| ITS-012-C1 | Contract test against the pinned oEmbed shape | Adapter parses it                               |
| ITS-012-D1 | Flag off                                      | Endpoints `404`; channel absent from `/sources` |

## ITP-013 — File parsers (ARCH-017)

#### Test Case: ITP-013-A (Each supported format end-to-end to a draft)

#### Test Case: ITP-013-B (Magic bytes contradict the filename)

| ID         | Scenario                                    | Expected           |
| ---------- | ------------------------------------------- | ------------------ |
| ITS-013-A1 | Each supported format end-to-end to a draft | Draft produced     |
| ITS-013-B1 | Magic bytes contradict the filename         | `415` (HAZ-037)    |
| ITS-013-B2 | Oversize file                               | `413` before parse |

## ITP-014 — Blocklist admin surface (ARCH-023)

#### Test Case: ITP-014-A (Admin CRUD against real Postgres)

#### Test Case: ITP-014-B (Non-admin principal)

#### Test Case: ITP-014-C (Entry added, then an import attempted)

| ID         | Scenario                              | Expected                                          |
| ---------- | ------------------------------------- | ------------------------------------------------- |
| ITS-014-A1 | Admin CRUD against real Postgres      | Rows written with `added_by`, `reason`, timestamp |
| ITS-014-A2 | Duplicate domain added                | Rejected by the primary key                       |
| ITS-014-B1 | Non-admin principal                   | `403`                                             |
| ITS-014-C1 | Entry added, then an import attempted | Blocked within the cache TTL bound                |

## ITP-015 — Error codes ↔ shipped filter (ARCH-033)

#### Test Case: ITP-015-A (Each import code raised)

#### Test Case: ITP-015-B (Typed client receives each code)

| ID         | Scenario                        | Expected                                                  |
| ---------- | ------------------------------- | --------------------------------------------------------- |
| ITS-015-A1 | Each import code raised         | Documented HTTP status and `{code,message,details}` shape |
| ITS-015-A2 | Unmapped code                   | Falls through to `500` without leaking internals          |
| ITS-015-B1 | Typed client receives each code | Discriminable via its `is*` guard                         |

## ITP-016 — Typed client ↔ service (ARCH-032 + client package)

#### Test Case: ITP-016-A (Client drives a full import via HTTP)

#### Test Case: ITP-016-B (Service returns each error code)

#### Test Case: ITP-016-C (Contract round-trip against the OpenAPI document)

| ID         | Scenario                                         | Expected                                 |
| ---------- | ------------------------------------------------ | ---------------------------------------- |
| ITS-016-A1 | Client drives a full import via HTTP             | Job → draft → confirm succeeds           |
| ITS-016-A2 | Client polls a job                               | Bounded backoff; stops at terminal state |
| ITS-016-B1 | Service returns each error code                  | Client surfaces the matching typed error |
| ITS-016-C1 | Contract round-trip against the OpenAPI document | Documented shapes match actual responses |

---

## ARCH → ITP Coverage

| ARCH         | ITP              | ARCH         | ITP                       |
| ------------ | ---------------- | ------------ | ------------------------- |
| ARCH-001     | ITP-001          | ARCH-018–021 | ITP-005                   |
| ARCH-002     | ITP-001, ITP-002 | ARCH-022     | ITP-006                   |
| ARCH-003–004 | ITP-009          | ARCH-023     | ITP-003, ITP-014          |
| ARCH-005–006 | ITP-003          | ARCH-024     | ITP-007                   |
| ARCH-007–011 | ITP-004          | ARCH-025     | ITP-008                   |
| ARCH-012–013 | ITP-012          | ARCH-026     | ITP-010                   |
| ARCH-014–016 | ITP-011          | ARCH-027–032 | ITP-016 + component tests |
| ARCH-017     | ITP-013          | ARCH-033–034 | ITP-015                   |

## Summary

| Metric                                 | Count                                                         |
| -------------------------------------- | ------------------------------------------------------------- |
| Integration procedures (ITP)           | 16                                                            |
| Integration scenarios (ITS)            | 75                                                            |
| ARCH modules with integration coverage | 34 / 34                                                       |
| Modules with `❌ MISSING` coverage     | 0                                                             |
| Faked dependencies                     | 2 (Textract, Meta oEmbed) — each with a pinning contract test |

---

## Per-module integration procedures (Matrix C completion)

> One procedure per architecture module that had no individually-addressable entry above. Each exercises the
> module against its **real** collaborators, per this plan's principle.

#### Test Case: ITP-017-A (magic-byte typing then format parse)

**Linked Architecture Module:** ARCH-017 (FileParserService)

| ID         | Scenario                                                   | Expected                                                                |
| ---------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| ITS-017-A1 | a ZIP renamed .json and a valid YAML file → each is parsed | the ZIP is rejected by content inspection and the YAML yields a payload |

#### Test Case: ITP-018-A (normalization across every channel)

**Linked Architecture Module:** ARCH-018 (NormalizerService)

| ID         | Scenario                                                     | Expected                                                                       |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| ITS-018-A1 | an extracted payload with gaps and markup → it is normalized | fields are sanitized, gaps listed in missingRequired, and nothing is defaulted |

#### Test Case: ITP-019-A (line parsing against the real parser library)

**Linked Architecture Module:** ARCH-019 (IngredientLineParser)

| ID         | Scenario                               | Expected                                                                     |
| ---------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| ITS-019-A1 | a mixed ingredient list → it is parsed | structured values are produced where possible and every raw line is retained |

#### Test Case: ITP-020-A (duration and yield conversion)

**Linked Architecture Module:** ARCH-020 (ValueNormalizers)

| ID         | Scenario                                                 | Expected                                                                         |
| ---------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ITS-020-A1 | ISO durations and free-text yields → they are normalized | durations become integer minutes and ambiguous yields are flagged, not defaulted |

#### Test Case: ITP-021-A (sanitization on the persistence path)

**Linked Architecture Module:** ARCH-021 (ContentSanitizer)

| ID         | Scenario                                                                        | Expected                               |
| ---------- | ------------------------------------------------------------------------------- | -------------------------------------- |
| ITS-021-A1 | fields containing script and handler markup → they are normalized and persisted | the stored values are inert plain text |

#### Test Case: ITP-022-A (classification feeding the shipped visibility policy)

**Linked Architecture Module:** ARCH-022 (ProvenancePolicy)

| ID         | Scenario                                                       | Expected                                                                |
| ---------- | -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| ITS-022-A1 | each channel and attestation combination → a recipe is created | the persisted source type matches the policy table for that combination |

#### Test Case: ITP-023-A (blocklist against the real table)

**Linked Architecture Module:** ARCH-023 (PaywalledDomainsService)

| ID         | Scenario                                                          | Expected                                                                         |
| ---------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ITS-023-A1 | a blocked domain, a look-alike, and a subdomain → each is checked | the blocked domain and its subdomain are refused and the look-alike is permitted |

#### Test Case: ITP-024-A (canonicalization feeding the unique index)

**Linked Architecture Module:** ARCH-024 (CanonicalSourceUrl)

| ID         | Scenario                                   | Expected                                    |
| ---------- | ------------------------------------------ | ------------------------------------------- |
| ITS-024-A1 | equivalent URL variants → each is imported | all variants resolve to a single recipe row |

#### Test Case: ITP-025-A (draft lifecycle against real Postgres)

**Linked Architecture Module:** ARCH-025 (ImportDraftsService)

| ID         | Scenario                                                                         | Expected                                                                                |
| ---------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| ITS-025-A1 | a draft created, patched, confirmed, and one left to expire → the lifecycle runs | transitions persist correctly and the expiry sweep removes the due draft and its object |

#### Test Case: ITP-026-A (confirmation through the shipped write path)

**Linked Architecture Module:** ARCH-026 (DraftConfirmationService)

| ID         | Scenario                                               | Expected                                                                                                        |
| ---------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| ITS-026-A1 | a complete and an incomplete draft → each is confirmed | the complete one creates a recipe with attribution intact and the incomplete one is refused with no partial row |

#### Test Case: ITP-027-A (entry surface against the typed client)

**Linked Architecture Module:** ARCH-027 (ImportEntry)

| ID         | Scenario                                           | Expected                                                             |
| ---------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| ITS-027-A1 | a server-driven channel list → the surface renders | only enabled channels are offered and submission reaches the service |

#### Test Case: ITP-028-A (progress against real job transitions)

**Linked Architecture Module:** ARCH-028 (ImportProgress)

| ID         | Scenario                                                | Expected                                                 |
| ---------- | ------------------------------------------------------- | -------------------------------------------------------- |
| ITS-028-A1 | a job moving through its states → progress is displayed | each state renders and polling stops at a terminal state |

#### Test Case: ITP-029-A (review surface against a real draft)

**Linked Architecture Module:** ARCH-029 (ImportDraftReview)

| ID         | Scenario                                                                              | Expected                                                    |
| ---------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| ITS-029-A1 | a draft with missing fields and an unparsed ingredient → it is reviewed and corrected | corrections persist and confirmation unblocks once complete |

#### Test Case: ITP-030-A (attribution against a persisted recipe)

**Linked Architecture Module:** ARCH-030 (RecipeAttribution)

| ID         | Scenario                                                         | Expected                                         |
| ---------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| ITS-030-A1 | an imported and a user-created recipe → each detail view renders | attribution appears only for the imported recipe |

#### Test Case: ITP-031-A (error rendering against real service codes)

**Linked Architecture Module:** ARCH-031 (ImportErrorState)

| ID         | Scenario                                                        | Expected                                                       |
| ---------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| ITS-031-A1 | each import error code returned by the service → it is surfaced | each code renders its own distinct message and recovery action |

#### Test Case: ITP-032-A (hooks against the live service)

**Linked Architecture Module:** ARCH-032 (Import hooks)

| ID         | Scenario                                                      | Expected                                                                            |
| ---------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| ITS-032-A1 | an import driven end to end through the hooks → the flow runs | job polling, draft fetch, and confirmation all succeed and abort cleanly on unmount |

#### Test Case: ITP-033-A (code to status mapping via the shipped filter)

**Linked Architecture Module:** ARCH-033 (ImportErrorCodes)

| ID         | Scenario                              | Expected                                                   |
| ---------- | ------------------------------------- | ---------------------------------------------------------- |
| ITS-033-A1 | each import error code → it is raised | the documented HTTP status and error envelope are returned |

#### Test Case: ITP-034-A (shared types across service and client)

**Linked Architecture Module:** ARCH-034 (ImportContracts)

| ID         | Scenario                                                             | Expected                                              |
| ---------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| ITS-034-A1 | the shared contract types → service and client are compiled together | both consume identical types with no structural drift |

#### Test Case: ITP-035-A (Auth middleware guards every import route)

**Linked Architecture Module:** ARCH-035

| ID         | Scenario                                    | Expected                                         |
| ---------- | ------------------------------------------- | ------------------------------------------------ |
| ITS-035-A1 | Each import endpoint called without a token | Every call refused with no import work performed |

#### Test Case: ITP-036-A (Published contract matches live responses)

**Linked Architecture Module:** ARCH-036

| ID         | Scenario                                                     | Expected                                             |
| ---------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| ITS-036-A1 | Every import endpoint exercised against its published schema | Each response validates against the documented shape |
