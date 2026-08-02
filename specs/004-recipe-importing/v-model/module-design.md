# Module Design: Recipe Importing

**Feature Branch**: `004-recipe-importing`
**Created**: 2026-05-09
**Regenerated**: 2026-08-02
**Status**: Approved for implementation
**Source**: `specs/004-recipe-importing/v-model/architecture-design.md`

> **Regeneration note.** The previous revision decomposed 18 modules mirroring an architecture since found to
> duplicate shipped 001 capabilities, and it named **no real source path anywhere** across 1,525 lines — which
> is why the wrong package paths in `tasks.md` survived every review. This revision covers the 34 reconciled
> modules, names the real file for each, and states the four mandated views. Depth is spent where correctness
> is at risk; thin adapters get brief views rather than padding.

## ID Schema

`MOD-NNN` — one-to-one with `ARCH-NNN`. Each module states: **(1)** Algorithm/Logic · **(2)** Internal State &
Data Structures · **(3)** Error Handling & Return Codes · **(4)** Concurrency & Timing.

## ARCH ↔ MOD ↔ File Map

Backend paths are relative to `packages/services/recipe-service/`; frontend to `packages/apps/commise/`.

| MOD     | Module                   | ARCH     | File                                                                              |
| ------- | ------------------------ | -------- | --------------------------------------------------------------------------------- |
| MOD-001 | ImportsController        | ARCH-001 | `src/imports/imports.controller.ts`                                               |
| MOD-002 | ImportsService           | ARCH-002 | `src/imports/imports.service.ts`                                                  |
| MOD-003 | ImportJobsService        | ARCH-003 | `src/imports/jobs/import-jobs.service.ts`                                         |
| MOD-004 | ImportJobWorker          | ARCH-004 | `packages/services/recipe-workers/src/import-job.worker.ts`                       |
| MOD-005 | SourceFetcherService     | ARCH-005 | `src/imports/fetch/source-fetcher.service.ts`                                     |
| MOD-006 | SsrfGuard                | ARCH-006 | `src/imports/fetch/ssrf-guard.ts`                                                 |
| MOD-007 | RecipeExtractor (port)   | ARCH-007 | `src/imports/extractors/recipe-extractor.port.ts`                                 |
| MOD-008 | JsonLdExtractor          | ARCH-008 | `src/imports/extractors/json-ld.extractor.ts`                                     |
| MOD-009 | MicrodataExtractor       | ARCH-009 | `src/imports/extractors/microdata.extractor.ts`                                   |
| MOD-010 | HeuristicExtractor       | ARCH-010 | `src/imports/extractors/heuristic.extractor.ts`                                   |
| MOD-011 | ExtractorChainService    | ARCH-011 | `src/imports/extractors/extractor-chain.service.ts`                               |
| MOD-012 | OEmbedProvider (port)    | ARCH-012 | `src/imports/instagram/oembed-provider.port.ts`                                   |
| MOD-013 | InstagramOEmbedAdapter   | ARCH-013 | `src/imports/instagram/instagram-oembed.adapter.ts`                               |
| MOD-014 | OcrProvider (port)       | ARCH-014 | `src/imports/ocr/ocr-provider.port.ts`                                            |
| MOD-015 | TextractAdapter          | ARCH-015 | `src/imports/ocr/textract.adapter.ts`                                             |
| MOD-016 | OcrPipelineService       | ARCH-016 | `src/imports/ocr/ocr-pipeline.service.ts`                                         |
| MOD-017 | FileParserService        | ARCH-017 | `src/imports/files/file-parser.service.ts` + `{json,yaml,markdown}.parser.ts`     |
| MOD-018 | NormalizerService        | ARCH-018 | `src/imports/normalize/normalizer.service.ts`                                     |
| MOD-019 | IngredientLineParser     | ARCH-019 | `src/imports/normalize/ingredient-line.ts`                                        |
| MOD-020 | ValueNormalizers         | ARCH-020 | `src/imports/normalize/value-normalizers.ts`                                      |
| MOD-021 | ContentSanitizer         | ARCH-021 | `src/imports/normalize/content-sanitizer.ts`                                      |
| MOD-022 | ProvenancePolicy         | ARCH-022 | `src/imports/policy/provenance.policy.ts`                                         |
| MOD-023 | PaywalledDomainsService  | ARCH-023 | `src/imports/blocklist/paywalled-domains.{service,dal,controller}.ts`             |
| MOD-024 | CanonicalSourceUrl       | ARCH-024 | `src/imports/policy/canonical-source-url.ts`                                      |
| MOD-025 | ImportDraftsService      | ARCH-025 | `src/imports/drafts/import-drafts.{service,dal}.ts`, `draft-expiry.service.ts`    |
| MOD-026 | DraftConfirmationService | ARCH-026 | `src/imports/confirm/draft-confirmation.service.ts`                               |
| MOD-027 | ImportEntry              | ARCH-027 | `features/recipes/src/import/ImportEntry{,.native}.tsx`                           |
| MOD-028 | ImportProgress           | ARCH-028 | `features/recipes/src/import/ImportProgress{,.native}.tsx`                        |
| MOD-029 | ImportDraftReview        | ARCH-029 | `features/recipes/src/import/ImportDraftReview{,.native}.tsx`                     |
| MOD-030 | RecipeAttribution        | ARCH-030 | `features/recipes/src/detail/RecipeAttribution{,.native}.tsx`                     |
| MOD-031 | ImportErrorState         | ARCH-031 | `features/recipes/src/import/ImportErrorState{,.native}.tsx`                      |
| MOD-032 | Import hooks             | ARCH-032 | `features/recipes/src/import/useImportJob.ts`, `useImportDraft.ts`                |
| MOD-033 | ImportErrorCodes         | ARCH-033 | `src/imports/import.error.ts` + `packages/shared/recipe-core/src/recipe.types.ts` |
| MOD-034 | ImportContracts          | ARCH-034 | `packages/shared/recipe-core/src/{importTypes,importDraft}.ts`                    |

---

### Module: MOD-001 (ImportsController)

**Parent Architecture Modules**: ARCH-001

**Logic.** One handler per endpoint: bind DTO → validate (`ValidationPipe`, `whitelist: true`, so stray keys are
stripped rather than trusted) → read `Idempotency-Key` where required → resolve the principal via the shipped
`@CurrentPrincipal` decorator → delegate. Contains **no** policy and **no** I/O beyond delegation.
**State.** Stateless.
**Errors.** Throws nothing of its own; typed domain errors propagate to the shipped `ApiExceptionFilter`. A
missing `Idempotency-Key` on a route that requires it ⇒ `400`.
**Concurrency.** Per-request; no shared mutable state. The import `@Throttle` override is applied class-wide.

### Module: MOD-002 (ImportsService (Facade))

**Parent Architecture Modules**: ARCH-002

**Logic.** The single definition of pipeline order:

```
1 blocklist.assertNotBlocked(host)      → hard fail (fails CLOSED on lookup error)
2 <channel adapter>                     → fetch | oembed | ocr | parseFile
3 extractorChain.extract(document)      → null ⇒ IMPORT_NO_RECIPE_FOUND
4 normalizer.normalize(extracted)       → NormalizedDraft + missingRequired[]
5 provenancePolicy.classify(...)        → hard fail; NO default-to-public branch
6 dedup.findExisting(canonicalUrl)      → short-circuit to the existing recipe
7 drafts.create(...)                    → ImportDraft
```

No caller may reorder or skip a step because the sequence exists only here (HAZ-026).
**State.** Stateless; all collaborators injected as ports.
**Errors.** Every failure is a `RecipeDomainError` carrying an import code.
**Concurrency.** One invocation per job. Outbound work is bounded by the fetch bulkhead, deliberately separate
from the DB pool so a slow third-party host cannot starve database access.

### Module: MOD-003 (ImportJobsService)

**Parent Architecture Modules**: ARCH-003

**Logic.** State machine `queued → running → succeeded | failed`; terminal states immutable. `enqueue` first
resolves the idempotency key: an existing `(key, endpoint, principal)` returns the original job instead of
creating a second (HAZ-047).
**State.** `import_jobs` row — `status`, `channel`, `idempotency_key`, `draft_id?`, `error_code?`, `attempts`.
**Errors.** An illegal transition is a programmer error: thrown, logged, alerted. `IMPORT_JOB_NOT_FOUND`
(`404`) covers both absent and not-owned (HAZ-046).
**Concurrency.** Transitions use a conditional update on the current status, so two workers cannot both claim a
job. `(idempotency_key, principal, endpoint)` carries a unique constraint — the key's guarantee is the
constraint, not a prior read.

### Module: MOD-004 (ImportJobWorker)

**Parent Architecture Modules**: ARCH-004

**Logic.** Consume → claim (conditional update) → `ImportsService.run` → record outcome. A redelivered message
for an already-terminal job is acknowledged without re-running.
**State.** None beyond the job row. The correlation ID is propagated from the enqueueing request through the
queue hop.
**Errors.** Typed failures are recorded on the job and are **not** retried (a blocked domain will still be
blocked). Unexpected errors retry to the cap, then DLQ; DLQ depth is alerted.
**Concurrency.** At-least-once delivery assumed, so the handler is idempotent. Separate bulkheads mean a long
OCR poll cannot block URL imports.

### Module: MOD-005 (SourceFetcherService ⚠️ security-critical)

**Parent Architecture Modules**: ARCH-005

**Logic.**

```
1 url already validated + canonicalized by MOD-024 (scheme checked at construction)
2 blocklist.assertNotBlocked(url.host)
3 addresses = resolve(url.host);  ssrfGuard.assertPublicAddress(addresses)
4 GET via an undici dispatcher PINNED to the validated address
    headers: User-Agent only — no cookies, no Authorization (HAZ-032)
    connect deadline 3s · TOTAL deadline 10s, independent of connect (HAZ-031)
5 assert content-type ∈ { text/html, application/xhtml+xml }
6 stream the body, aborting past 5 MB — streamed, never buffer-then-check (HAZ-004)
7 on 3xx: hops+1 ≤ 5 → GOTO 2 with the redirect target
    ── steps 2 AND 3 re-run on EVERY hop (REQ-018, HAZ-002/003)
8 normalize charset → string (HAZ-005)
```

**State.** Stateless per call. Per-registrable-domain `cockatiel` breaker policies live in a **bounded LRU** —
an unbounded map keyed by attacker-supplied domains is itself a memory-exhaustion vector.
**Errors.** `SourceBlocked`, `SourceUnreachable`, `PayloadTooLarge`, `ProviderUnavailable` (breaker open).
Response bodies are **never** logged (REQ-NF-012).
**Concurrency.** Bulkhead-bounded. Retry only on idempotent GET and transient classes, ≤2 attempts,
exponential backoff **with full jitter** (synchronized retries would DDoS the source).

### Module: MOD-006 (SsrfGuard ⚠️ security-critical)

**Parent Architecture Modules**: ARCH-006

**Logic.** Pure predicate over resolved addresses, via `ipaddr.js`. Rejects loopback (`127.0.0.0/8`, `::1`),
private (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`), link-local (`169.254.0.0/16` — including the cloud
metadata address — and `fe80::/10`), CGNAT (`100.64/10`), unspecified (`0.0.0.0`, `::`), multicast, and
reserved ranges. **Every** resolved address must pass: a host resolving to one public and one private address
is rejected outright. Supplies the pinning dispatcher so the connection cannot be re-pointed after validation.
**State.** Stateless. DNS resolution is injected as a port, making tests deterministic.
**Errors.** Throws `SourceBlocked` **without** disclosing what was resolved — a detailed message turns the
endpoint into a network-probing oracle.
**Concurrency.** None. Validation and connection are atomic with respect to each other **by construction** —
that is precisely what pinning buys, and why a check-then-connect design would still be vulnerable.

### Module: MOD-007 (RecipeExtractor (port))

**Parent Architecture Modules**: ARCH-007

**Logic.** `extract(doc: FetchedDocument): ExtractedRecipe | null`. **Total; never throws.** `null` means "not
my format", which lets the chain control flow with values rather than exceptions.
**State.** None. **Errors.** None by contract. **Concurrency.** Pure; concurrency-safe.

### Module: MOD-008 (JsonLdExtractor)

**Parent Architecture Modules**: ARCH-008

**Logic.** Select `script[type="application/ld+json"]` → `JSON.parse` each block (a parse failure skips **that
block**, never the page) → flatten `@graph` and arrays → find the first node whose `@type` is `Recipe` or an
array containing it → Zod-validate → map. A node failing validation is **skipped, not coerced** (HAZ-028).
**State.** Stateless. **Errors.** None thrown; unparseable or non-Recipe ⇒ `null`.
**Concurrency.** Pure; input bounded by the 5 MB response cap.

### Module: MOD-009 (MicrodataExtractor)

**Parent Architecture Modules**: ARCH-009

**Logic.** `microdata-node` over the document; select items whose `itemtype` matches schema.org Recipe; map the
same field set as MOD-008 so downstream code is format-agnostic.
**State/Errors/Concurrency.** As MOD-008.

### Module: MOD-010 (HeuristicExtractor)

**Parent Architecture Modules**: ARCH-010

**Logic.** `cheerio` structural heuristics — title from `h1`/`og:title`; ingredients from the list whose items
best match a quantity-leading shape; steps from the ordered list or heading-delimited paragraphs following an
"instructions"-like heading. Emits `confidence ∈ [0,1]` derived from how many signals agreed, so a weak parse
is **visible to the user** rather than silently equal to a strong one.
**State.** Stateless; patterns bounded to avoid catastrophic backtracking (HAZ-033).
**Errors.** None thrown; nothing recognisable ⇒ `null`.
**Concurrency.** Pure; a per-job CPU/time budget bounds a hostile page.

### Module: MOD-011 (ExtractorChainService)

**Parent Architecture Modules**: ARCH-011

**Logic.** Run MOD-008 → MOD-009 → MOD-010; first non-null wins; record which strategy hit (an SLI that tells
us when the web's markup landscape shifts). All-null ⇒ an explicit `NoRecipeFound` outcome, **never** an empty
success (HAZ-009, REQ-CN-006).
**State.** Ordered injected strategy list — adding a strategy is additive, satisfying REQ-CN-005's "additive if
ever justified" escape hatch.
**Errors.** Returns an outcome value; the caller maps it to `IMPORT_NO_RECIPE_FOUND`.
**Concurrency.** Deliberately sequential — later strategies are lower quality, so short-circuiting is the point.

## MOD-012 / MOD-013 — OEmbedProvider port · InstagramOEmbedAdapter

**Logic.** Port: `fetchCaption(url) → ExtractedRecipe`. The adapter calls the Meta-hosted oEmbed endpoint with
an app credential from SSM/Secrets, Zod-validates the response shape (HAZ-012), extracts caption text, and runs
it through MOD-010. Empty or recipe-free caption ⇒ `NoCaption`.
**State.** Credential cached with a TTL; the capability flag is read at construction and defaults **off**.
**Errors.** `NoCaption` (`422`), `ProviderUnavailable` (`503`). **429 is classified explicitly** as throttled
rather than folded into a generic failure (HAZ-010). A timeout is a typed failure, never an empty success
(HAZ-030).
**Concurrency.** Its own breaker and bulkhead, so Instagram degradation cannot starve URL imports.

## MOD-014 / MOD-015 / MOD-016 — OcrProvider port · TextractAdapter · OcrPipelineService

**Logic.** Validate magic bytes (JPEG/PNG/HEIC) and size (≤10 MB) → `sharp` preprocessing → store to S3 under
the import prefix → `provider.extractText(objectKey)` → raw text → the **shared** normalize path (so OCR
inherits sanitization and ingredient parsing rather than duplicating them). The adapter polls Textract with
bounded attempts, backoff, and a hard deadline.
**State.** The S3 object key is recorded on the draft. **Deletion occurs on confirm, discard, or expiry —
whichever comes first** (HAZ-035); the S3 lifecycle rule is a backstop, not the mechanism.
**Errors.** `OcrFailed` (`422`) when no usable text is produced; `ProviderUnavailable` (`503`) on breaker-open
or deadline. Extracted text is **never logged** (HAZ-036) — photographs of physical recipes can capture
handwriting, faces, and surroundings.
**Concurrency.** OCR is the slowest channel and holds its own bulkhead. Polling is bounded so a stuck job
cannot occupy a worker indefinitely.

### Module: MOD-017 (FileParserService)

**Parent Architecture Modules**: ARCH-017

**Logic.** `file-type` magic-byte sniff **first** — the client-declared filename and MIME are ignored entirely
(HAZ-037) → dispatch to JSON / YAML (`yaml`, safe parse only, no custom tag resolution — HAZ-038) / Markdown
(`gray-matter`) → Zod-validate the recipe shape → map to `ExtractedRecipe`.
**State.** Stateless. The 1 MB cap is enforced **before** parsing, not after (HAZ-039).
**Errors.** `IMPORT_UNSUPPORTED_FORMAT` (`415`), `IMPORT_PAYLOAD_TOO_LARGE` (`413`); Zod failures surface as
field-level `422` details.
**Concurrency.** Synchronous and fast — no queue, hence the `201` rather than `202`.

### Module: MOD-018 (NormalizerService)

**Parent Architecture Modules**: ARCH-018

**Logic.** Apply MOD-021 (sanitize) to every text field, MOD-019 to each ingredient line, MOD-020 to durations
and yield; then compute `missingRequired` against the shipped `CreateRecipeRequest` obligations (`servings`,
the three times, ≥1 ingredient, ≥1 step).
**State.** Pure.
**Errors.** **None** — incompleteness is _data_ (`missingRequired`), not an error. That distinction is the
hinge the entire draft model turns on.
**Concurrency.** Pure; parallelisable across fields.

### Module: MOD-019 (IngredientLineParser)

**Parent Architecture Modules**: ARCH-019

**Logic.** `parse-ingredient` on the raw line → `{ quantity, unit, name, raw }`. **`raw` is retained
unconditionally** (HAZ-041). Unparseable, or a non-positive quantity, ⇒ `quantity: null` + `needsReview`:
never a throw, and never a fabricated `1` (which the `CHECK (quantity > 0)` constraint would happily accept).
**State.** Pure, total. **Errors.** None by contract. **Concurrency.** Pure.

### Module: MOD-020 (ValueNormalizers)

**Parent Architecture Modules**: ARCH-020

**Logic.** ISO-8601 duration → integer minutes via `iso8601-duration`, rounded, negatives rejected. Free-text
yield → positive integer for unambiguous forms (`"4"`, `"4 servings"`, `"serves 4"`); a range (`"4-6"`) takes
the lower bound and flags for review; anything else ⇒ empty + flagged. **No branch returns a default for an
absent input** (HAZ-040) — the shipped NOT NULL columns would accept a fabricated `0`, which is exactly why
the prohibition must live here.
**State.** Pure, total. **Errors.** None; unparseable ⇒ `undefined` + flag. **Concurrency.** Pure.

### Module: MOD-021 (ContentSanitizer)

**Parent Architecture Modules**: ARCH-021

**Logic.** `sanitize-html` with `allowedTags: []` and `allowedAttributes: {}` across every extracted text
field, then entity-decode to plain text. Invoked **inside MOD-018**, which every channel traverses — so no path
can skip it (HAZ-029). Placement is the control; a per-channel call would eventually miss one.
**State.** Pure; frozen config. **Errors.** None. **Concurrency.** Pure.

### Module: MOD-022 (ProvenancePolicy)

**Parent Architecture Modules**: ARCH-022

**Logic.** Pure total function:

```
url | instagram                                          → imported_public
ocr                                                      → imported_physical  (premium only — D-014)
file                                                     → user_created       (the user's own export)
manual + attested external + citation publicly reachable → imported_public
manual + attested external + citation NOT public         → imported_paid
manual + not attested                                    → user_created
```

Heuristic signals return `needsReview` **only**; they never alter the returned class (HAZ-042, D-003). There is
**no** default-to-public branch (HAZ-043).

The policy also reports whether the resulting class is **non-public by policy** (`imported_physical` /
`imported_paid`). ARCH-002 uses that to require a premium entitlement before the channel runs (D-014, FR-028) —
the entitlement check reads the shipped `PREMIUM_PERMISSION`, and the visibility rule itself stays 001's.
**State.** Pure.
**Errors.** Total function — no error path. Visibility is **not** decided here; that remains the shipped
`evaluateVisibility` (REQ-015).
**Concurrency.** Pure.

### Module: MOD-023 (PaywalledDomainsService)

**Parent Architecture Modules**: ARCH-023

**Logic.** Normalize host (lowercase, strip `www.`) → look up exact host, then registrable-suffix ancestors.
**Never substring** — `notnytimes.com` must not match `nytimes.com` (HAZ-022). Admin CRUD records `added_by`
and `reason`.
**State.** Bounded-TTL cache; refresh is single-flight to avoid a stampede. A DB error **fails closed**
(HAZ-044) — during a blocklist outage every source is treated as blocked, which is the safe direction.
**Errors.** `IMPORT_SOURCE_BLOCKED` (`422`); admin routes `403` without the scope.
**Concurrency.** Read-mostly.

### Module: MOD-024 (CanonicalSourceUrl)

**Parent Architecture Modules**: ARCH-024

**Logic.** Value object. The constructor rejects non-`http(s)`, then applies `normalize-url`: lowercase
scheme+host, remove fragment, remove default port, strip tracking parameters, normalize trailing slash. Stores
both the canonical form and the original (the original is what the user sees; the canonical is the dedup key).
**State.** Immutable — an unnormalized instance is **unrepresentable**, so no caller can forget to canonicalize
(HAZ-019). This is the "make illegal states unrepresentable" rule applied to a bug class.
**Errors.** Throws at construction on an unusable URL — the earliest possible point.
**Concurrency.** Immutable; freely shareable.

### Module: MOD-025 (ImportDraftsService)

**Parent Architecture Modules**: ARCH-025

**Logic.** Create / read / patch / confirm / discard / expire. `loadForOwner(id, ownerId)` returns `404` when
absent **or** not owned (HAZ-046) — the two are indistinguishable to a caller by design. `patch` recomputes
`missingRequired`. The expiry sweep deletes due drafts and their OCR objects as one unit.
**State.** `import_drafts` rows; state machine `open → confirmed | expired`, terminal states immutable.
**Errors.** `IMPORT_DRAFT_EXPIRED` (`410`), not-found (`404`), `422` for an invalid correction.
**Concurrency.** Confirm uses a conditional update on `status = 'open'`, so two concurrent confirms cannot both
create a recipe. The sweep is idempotent and safe alongside live user activity.

### Module: MOD-026 (DraftConfirmationService)

**Parent Architecture Modules**: ARCH-026

**Logic.** Load (owner-scoped) → assert `open` and unexpired → assert `missingRequired` is empty → map to the
shipped `CreateRecipeRequest` → `RecipesService.create(principal, request)` → mark confirmed → submit
ingredient names for asynchronous food resolution.
**State.** Stateless.
**Errors.** `IMPORT_DRAFT_INCOMPLETE` (`422`) with the offending field list; shipped recipe-domain errors
propagate unchanged. A food-service outage does **not** fail confirmation (HAZ-050) — resolution is a
non-critical enrichment and degrades rather than blocking the user's save.
**Concurrency.** The draft's conditional status update is the idempotency guard. A dedup unique-constraint
violation at insert is caught and resolved to the winning recipe rather than surfacing a `500` (HAZ-018).
**Constraint.** Contains **no** visibility logic and constitutes **no** second write path (REQ-CN-007,
HAZ-051). This module is deliberately thin; every temptation to add a rule here belongs in 001 instead.

## MOD-027 – MOD-032 — Frontend modules

All follow the shipped orchestration/render split: hooks hold data and state; render leaves are pure
`props → JSX` with one responsibility each. Every `.tsx` has a `.native.tsx` sibling exporting an **identical
public API** (§14.3). Refs are used only to wrap a genuinely external, non-declarative system. All copy comes
from the shared `messages.ts` via `useMessages` (REQ-NF-006).

| MOD     | Logic                                                                                                                                | State                                | Errors                        | Concurrency                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | ----------------------------- | ---------------------------------------------------------- |
| MOD-027 | Channel picker + submit. The channel list is **server-driven** by `GET /import/sources`, so a gated channel never renders (HAZ-054)  | Form state only; submits via MOD-032 | Delegates to MOD-031          | Submit disabled while in flight — double-submit impossible |
| MOD-028 | Renders job state; polls via MOD-032 with bounded backoff                                                                            | None (props)                         | Terminal failure → MOD-031    | Polling stops on terminal state or unmount                 |
| MOD-029 | Draft review: editable fields, per-field confidence, the **raw** ingredient line shown beside the parsed values, attestation control | Local edit buffer, patched on save   | Field-level errors from `422` | Save disabled while `missingRequired` is non-empty         |
| MOD-030 | Attribution block; renders only when a source is present; an unverifiable source is shown as such, not hidden (REQ-025)              | None (pure)                          | None                          | None                                                       |
| MOD-031 | Exhaustive switch over the error-code union → message + recovery action; icon **and** text (REQ-NF-005)                              | None (pure)                          | Is the error surface          | None                                                       |
| MOD-032 | `useImportJob` / `useImportDraft` over the typed client                                                                              | Query cache                          | Surfaces typed client errors  | Aborts in-flight requests on unmount                       |

**Exhaustiveness.** MOD-031 switches over the discriminated error-code union with a `never` default, so adding
a code without a rendering branch **fails compilation** rather than shipping an unhandled state at runtime.

### Module: MOD-033 (ImportErrorCodes)

**Parent Architecture Modules**: ARCH-033

**Logic.** New `RecipeErrorCode` members; factory functions following the shipped `recipe.error.ts` pattern
(extend `Error`, `Object.setPrototypeOf`, matching `is*` guard); status mapping added to the **shipped**
`ApiExceptionFilter`.
**State.** Frozen maps. **Errors.** N/A — this _is_ the error vocabulary. **Concurrency.** N/A.

### Module: MOD-034 (ImportContracts)

**Parent Architecture Modules**: ARCH-034

**Logic.** Shared types in `@kitchensink/recipe-core`, consumed identically by service, typed client, web, and
mobile — one contract, four consumers, no per-platform redefinition.
**State.** Types only. **Errors.** N/A. **Concurrency.** N/A.

---

## Coverage Summary

| Metric                                       | Count                |
| -------------------------------------------- | -------------------- |
| Total modules (MOD)                          | 34                   |
| ARCH modules covered                         | 34 / 34              |
| Modules with all four views stated           | 34                   |
| Modules naming a real source path            | 34                   |
| Pure modules (no I/O)                        | 9                    |
| Security-critical modules                    | 2 (MOD-005, MOD-006) |
| Modules duplicating a shipped 001 capability | 0                    |

---

## Per-module traceability sections

> These sections exist so each `MOD-NNN` is individually addressable by `build-matrix.sh` (Matrix D). The
> normative four-view text for these modules is the consolidated description above; these entries carry the
> parent-ARCH linkage rather than restating it.

### Module: MOD-012 (OEmbedProvider port)

**Parent Architecture Modules**: ARCH-012

**Logic.** See the consolidated description for this module earlier in this document; that text is the normative one and is not duplicated here.
**State.** As stated in the consolidated description.
**Errors.** As stated in the consolidated description.
**Concurrency.** As stated in the consolidated description.

### Module: MOD-013 (InstagramOEmbedAdapter)

**Parent Architecture Modules**: ARCH-013

**Logic.** See the consolidated description for this module earlier in this document; that text is the normative one and is not duplicated here.
**State.** As stated in the consolidated description.
**Errors.** As stated in the consolidated description.
**Concurrency.** As stated in the consolidated description.

### Module: MOD-014 (OcrProvider port)

**Parent Architecture Modules**: ARCH-014

**Logic.** See the consolidated description for this module earlier in this document; that text is the normative one and is not duplicated here.
**State.** As stated in the consolidated description.
**Errors.** As stated in the consolidated description.
**Concurrency.** As stated in the consolidated description.

### Module: MOD-015 (TextractAdapter)

**Parent Architecture Modules**: ARCH-015

**Logic.** See the consolidated description for this module earlier in this document; that text is the normative one and is not duplicated here.
**State.** As stated in the consolidated description.
**Errors.** As stated in the consolidated description.
**Concurrency.** As stated in the consolidated description.

### Module: MOD-016 (OcrPipelineService)

**Parent Architecture Modules**: ARCH-016

**Logic.** See the consolidated description for this module earlier in this document; that text is the normative one and is not duplicated here.
**State.** As stated in the consolidated description.
**Errors.** As stated in the consolidated description.
**Concurrency.** As stated in the consolidated description.

### Module: MOD-027 (ImportEntry)

**Parent Architecture Modules**: ARCH-027

**Logic.** See the consolidated description for this module earlier in this document; that text is the normative one and is not duplicated here.
**State.** As stated in the consolidated description.
**Errors.** As stated in the consolidated description.
**Concurrency.** As stated in the consolidated description.

### Module: MOD-028 (ImportProgress)

**Parent Architecture Modules**: ARCH-028

**Logic.** See the consolidated description for this module earlier in this document; that text is the normative one and is not duplicated here.
**State.** As stated in the consolidated description.
**Errors.** As stated in the consolidated description.
**Concurrency.** As stated in the consolidated description.

### Module: MOD-029 (ImportDraftReview)

**Parent Architecture Modules**: ARCH-029

**Logic.** See the consolidated description for this module earlier in this document; that text is the normative one and is not duplicated here.
**State.** As stated in the consolidated description.
**Errors.** As stated in the consolidated description.
**Concurrency.** As stated in the consolidated description.

### Module: MOD-030 (RecipeAttribution)

**Parent Architecture Modules**: ARCH-030

**Logic.** See the consolidated description for this module earlier in this document; that text is the normative one and is not duplicated here.
**State.** As stated in the consolidated description.
**Errors.** As stated in the consolidated description.
**Concurrency.** As stated in the consolidated description.

### Module: MOD-031 (ImportErrorState)

**Parent Architecture Modules**: ARCH-031

**Logic.** See the consolidated description for this module earlier in this document; that text is the normative one and is not duplicated here.
**State.** As stated in the consolidated description.
**Errors.** As stated in the consolidated description.
**Concurrency.** As stated in the consolidated description.

### Module: MOD-032 (Import hooks)

**Parent Architecture Modules**: ARCH-032

**Logic.** See the consolidated description for this module earlier in this document; that text is the normative one and is not duplicated here.
**State.** As stated in the consolidated description.
**Errors.** As stated in the consolidated description.
**Concurrency.** As stated in the consolidated description.

### Module: MOD-035 (AuthMiddleware (shipped))

**Parent Architecture Modules**: ARCH-035

**Logic.** Consumed/enforced outside the import feature's runtime code; documented here for traceability.
**State.** None owned by this feature.
**Errors.** Surfaced by the mechanism that owns it.
**Concurrency.** Not applicable.

### Module: MOD-036 (CiQualityGates)

**Parent Architecture Modules**: ARCH-036

**Logic.** Consumed/enforced outside the import feature's runtime code; documented here for traceability.
**State.** None owned by this feature.
**Errors.** Surfaced by the mechanism that owns it.
**Concurrency.** Not applicable.
