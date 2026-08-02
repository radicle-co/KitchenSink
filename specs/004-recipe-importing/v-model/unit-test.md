# Unit Test Plan: Recipe Importing

**Feature Branch**: `004-recipe-importing`
**Regenerated**: 2026-08-02
**Status**: Approved
**Source**: `module-design.md` (MOD-001..MOD-034)
**Level**: Implementation verification — the pure core and each module in isolation
**Realisation**: `src/imports/__tests__/**/*.test.ts` (backend), `__tests__/*.test.tsx` +
`*.native.test.tsx` (frontend). Mutation-checked via the shipped `stryker` config.

> **Regeneration note.** In the previous document set, **Matrix D (implementation verification) was entirely
> empty** — there was no module-to-unit-test mapping at all. This plan supplies it for all 36 modules.

## ID Schema

`UTP-{MOD}-{letter}` — a procedure per module concern · `UTS-{MOD}-{letter}{n}` — a case within it.

## Standard applied to every case

A test that would still pass with the logic subtly broken is **coverage theatre** and does not count toward the
mandate (`ENGINEERING_EXCELLENCE` → QSE). Every procedure below is written to fail under mutation of the
behaviour it names. Pure modules are table-driven; impure modules receive faked ports, never live dependencies.

---

## Pure core — the highest-value unit tests

### UTP-024 — CanonicalSourceUrl (MOD-024)

#### Test Case: UTP-024-A (HTTP://Example.COM/Recipe/ vs http://example.com/Recipe)

#### Test Case: UTP-024-B (javascript:, file:, data:, relative)

| ID         | Case                                                        | Assert                                        |
| ---------- | ----------------------------------------------------------- | --------------------------------------------- |
| UTS-024-A1 | `HTTP://Example.COM/Recipe/` vs `http://example.com/Recipe` | Equal canonical form                          |
| UTS-024-A2 | Trailing slash present vs absent                            | Equal                                         |
| UTS-024-A3 | `?utm_source=x&id=5` vs `?id=5`                             | Equal — tracking stripped, meaningful kept    |
| UTS-024-A4 | `#section` fragment                                         | Removed                                       |
| UTS-024-A5 | `:80` on http, `:443` on https                              | Default port removed                          |
| UTS-024-A6 | `:8080`                                                     | **Retained** — non-default port is meaningful |
| UTS-024-A7 | Percent-encoding and IDN/punycode variants                  | Consistent canonical form                     |
| UTS-024-B1 | `javascript:`, `file:`, `data:`, relative                   | Throws at construction                        |
| UTS-024-B2 | Path case (`/Recipe` vs `/recipe`)                          | **Distinct** — paths are case-sensitive       |

### UTP-022 — ProvenancePolicy (MOD-022)

#### Test Case: UTP-022-A (Full cartesian product of [channel × attested × citationReachable])

#### Test Case: UTP-022-B (Manual + attested + unreachable citation)

#### Test Case: UTP-022-C (Every input combination)

| ID         | Case                                                               | Assert                                                                   |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| UTS-022-A1 | Full cartesian product of (channel × attested × citationReachable) | Matches the REQ-014/D-003 table exactly                                  |
| UTS-022-B1 | Manual + attested + unreachable citation                           | `imported_paid` — never public                                           |
| UTS-022-B2 | Heuristic flag set, attestation says public                        | Classification unchanged; only `needsReview` set (HAZ-042)               |
| UTS-022-C1 | Every input combination                                            | Never returns a public class where the citation is unreachable (HAZ-043) |
| UTS-022-C2 | Function totality                                                  | No input yields `undefined` or throws                                    |

### UTP-019 — IngredientLineParser (MOD-019)

#### Test Case: UTP-019-A ("2 cups flour")

#### Test Case: UTP-019-B (Every case above)

| ID         | Case                               | Assert                                         |
| ---------- | ---------------------------------- | ---------------------------------------------- |
| UTS-019-A1 | `"2 cups flour"`                   | `{2, cup, flour}`; `raw` preserved             |
| UTS-019-A2 | `"1½ tsp salt"` (unicode fraction) | `1.5`                                          |
| UTS-019-A3 | `"2-3 cloves garlic"` (range)      | Lower bound, flagged for review                |
| UTS-019-A4 | `"salt to taste"`                  | `quantity: null`, flagged, raw preserved       |
| UTS-019-A5 | `""` / whitespace                  | Flagged; no throw                              |
| UTS-019-A6 | `"0 cups sugar"`                   | `quantity: null` — `0` violates `CHECK (> 0)`  |
| UTS-019-B1 | Every case above                   | `raw` is byte-identical to the input (HAZ-041) |
| UTS-019-B2 | Any input at all                   | Never throws (total function)                  |

### UTP-020 — ValueNormalizers (MOD-020)

#### Test Case: UTP-020-A ("PT1H30M" / "PT45M" / "PT2H")

#### Test Case: UTP-020-B ("4" / "4 servings" / "Serves 4")

#### Test Case: UTP-020-C (Absent input on every normalizer)

| ID         | Case                                  | Assert                                     |
| ---------- | ------------------------------------- | ------------------------------------------ |
| UTS-020-A1 | `"PT1H30M"` / `"PT45M"` / `"PT2H"`    | 90 / 45 / 120                              |
| UTS-020-A2 | `"P1DT2H"`                            | 1560                                       |
| UTS-020-A3 | Malformed / empty / negative duration | `undefined` + flag — **never 0** (HAZ-040) |
| UTS-020-B1 | `"4"` / `"4 servings"` / `"Serves 4"` | 4                                          |
| UTS-020-B2 | `"4-6 servings"`                      | 4, flagged                                 |
| UTS-020-B3 | `"a crowd"` / `""` / `"0"`            | `undefined` + flag                         |
| UTS-020-C1 | Absent input on every normalizer      | Returns empty, never a default (HAZ-040)   |

### UTP-021 — ContentSanitizer (MOD-021)

#### Test Case: UTP-021-A (<script>alert[1]</script>)

#### Test Case: UTP-021-B (Plain text with < and &)

| ID         | Case                                       | Assert                 |
| ---------- | ------------------------------------------ | ---------------------- |
| UTS-021-A1 | `<script>alert(1)</script>`                | Removed entirely       |
| UTS-021-A2 | `<img src=x onerror=alert(1)>`             | Removed                |
| UTS-021-A3 | `<b>bold</b>` (benign markup)              | Tag removed, text kept |
| UTS-021-A4 | Entity-encoded and double-encoded payloads | Inert after decode     |
| UTS-021-A5 | Nested/malformed markup                    | Inert                  |
| UTS-021-B1 | Plain text with `<` and `&`                | Readable, not mangled  |

### UTP-018 — NormalizerService (MOD-018)

#### Test Case: UTP-018-A (Payload complete in every required field)

#### Test Case: UTP-018-B (Any payload)

#### Test Case: UTP-018-C (Any payload)

| ID         | Case                                     | Assert                                                           |
| ---------- | ---------------------------------------- | ---------------------------------------------------------------- |
| UTS-018-A1 | Payload complete in every required field | `missingRequired` empty                                          |
| UTS-018-A2 | Each required field absent in turn       | That field, and only it, appears in `missingRequired`            |
| UTS-018-A3 | Zero ingredients / zero steps            | Both flagged — the shipped contract requires ≥1 of each          |
| UTS-018-B1 | Any payload                              | Every text field passed through the sanitizer (no path skips it) |
| UTS-018-C1 | Any payload                              | Pure — same input, same output; no I/O                           |

---

## Extraction

### UTP-008 — JsonLdExtractor (MOD-008)

#### Test Case: UTP-008-A (Single well-formed Recipe block)

#### Test Case: UTP-008-B (@type: "Article" only)

#### Test Case: UTP-008-C (Every case)

| ID         | Case                                | Assert                       |
| ---------- | ----------------------------------- | ---------------------------- |
| UTS-008-A1 | Single well-formed `Recipe` block   | All mapped fields extracted  |
| UTS-008-A2 | Recipe nested in `@graph`           | Located                      |
| UTS-008-A3 | `@type: ["Recipe","NewsArticle"]`   | Accepted                     |
| UTS-008-B1 | `@type: "Article"` only             | `null` (HAZ-028)             |
| UTS-008-B2 | Malformed JSON in one of two blocks | Valid block used; no throw   |
| UTS-008-B3 | No JSON-LD at all                   | `null`                       |
| UTS-008-B4 | Deeply nested / very large JSON-LD  | Bounded; no stack overflow   |
| UTS-008-C1 | Every case                          | Never throws (port contract) |

### UTP-009 / UTP-010 — Microdata and Heuristic extractors

| ID         | Case                              | Assert                                    |
| ---------- | --------------------------------- | ----------------------------------------- |
| UTS-009-A1 | Well-formed microdata Recipe      | Extracted; same shape as JSON-LD output   |
| UTS-009-B1 | Microdata of another type         | `null`                                    |
| UTS-010-A1 | Heading + list structure          | Title, ingredients, steps extracted       |
| UTS-010-A2 | Strong vs weak structural signals | Confidence ordered accordingly            |
| UTS-010-B1 | Prose with no list structure      | `null`                                    |
| UTS-010-B2 | Pathological nesting / repetition | Completes within the CPU budget (HAZ-033) |

### UTP-011 — ExtractorChainService (MOD-011)

#### Test Case: UTP-011-A (JSON-LD available)

#### Test Case: UTP-011-B (A strategy throws despite its contract)

| ID         | Case                                   | Assert                                                   |
| ---------- | -------------------------------------- | -------------------------------------------------------- |
| UTS-011-A1 | JSON-LD available                      | Microdata and heuristic strategies are **not** invoked   |
| UTS-011-A2 | Only microdata available               | JSON-LD tried first, then microdata used                 |
| UTS-011-A3 | All strategies return null             | Explicit `NoRecipeFound`, not an empty payload (HAZ-009) |
| UTS-011-B1 | A strategy throws despite its contract | Chain isolates it and continues — defensive              |

---

## Egress ⚠️ security-critical

### UTP-006 — SsrfGuard (MOD-006)

#### Test Case: UTP-006-A (127.0.0.1, 127.1, ::1, 0.0.0.0, ::)

#### Test Case: UTP-006-B (93.184.216.34 [public])

#### Test Case: UTP-006-C (Rejection message)

Written **before** the fetcher exists. Adversarial by construction.

| ID         | Case                                                           | Assert                                          |
| ---------- | -------------------------------------------------------------- | ----------------------------------------------- |
| UTS-006-A1 | `127.0.0.1`, `127.1`, `::1`, `0.0.0.0`, `::`                   | Rejected                                        |
| UTS-006-A2 | `10.0.0.1`, `172.16.0.1`, `192.168.1.1`, `fc00::1`             | Rejected                                        |
| UTS-006-A3 | `169.254.169.254`, `fe80::1`                                   | Rejected (metadata)                             |
| UTS-006-A4 | `100.64.0.1` (CGNAT)                                           | Rejected                                        |
| UTS-006-A5 | Decimal (`2130706433`), octal, hex, and IPv6-mapped IPv4 forms | Rejected — no encoding bypass                   |
| UTS-006-B1 | `93.184.216.34` (public)                                       | Accepted                                        |
| UTS-006-B2 | Host resolving to one public **and** one private address       | Rejected — all must pass                        |
| UTS-006-C1 | Rejection message                                              | Discloses no resolved address (no probe oracle) |

### UTP-005 — SourceFetcherService (MOD-005)

#### Test Case: UTP-005-A (Guard rejects)

#### Test Case: UTP-005-B (Body exceeding the cap)

#### Test Case: UTP-005-C (Transient 503)

#### Test Case: UTP-005-D (Any request)

#### Test Case: UTP-005-E (Many distinct domains)

#### Test Case: UTP-005-F (Guard removed [mutation])

| ID         | Case                          | Assert                                             |
| ---------- | ----------------------------- | -------------------------------------------------- |
| UTS-005-A1 | Guard rejects                 | No socket opened                                   |
| UTS-005-A2 | Redirect chain, hop 3 private | Guard invoked on **every** hop; refused at hop 3   |
| UTS-005-A3 | 6 redirects                   | Refused after 5                                    |
| UTS-005-B1 | Body exceeding the cap        | Aborted mid-stream; not fully buffered             |
| UTS-005-B2 | Non-html content type         | Rejected                                           |
| UTS-005-C1 | Transient 503                 | Retried ≤2 with jittered backoff                   |
| UTS-005-C2 | 404                           | **Not** retried (4xx is not transient)             |
| UTS-005-C3 | Breaker open                  | Fails fast without a request                       |
| UTS-005-D1 | Any request                   | No `Authorization`/`Cookie` header (HAZ-032)       |
| UTS-005-D2 | Any response                  | Body never passed to the logger (REQ-NF-012)       |
| UTS-005-E1 | Many distinct domains         | Breaker map stays bounded (no unbounded growth)    |
| UTS-005-F1 | **Guard removed (mutation)**  | The suite **fails** — proves the control is tested |

---

## Lifecycle and policy

### UTP-023 — PaywalledDomainsService (MOD-023)

#### Test Case: UTP-023-A (Exact host on the list)

#### Test Case: UTP-023-B (Store throws)

| ID         | Case                                     | Assert                     |
| ---------- | ---------------------------------------- | -------------------------- |
| UTS-023-A1 | Exact host on the list                   | Blocked                    |
| UTS-023-A2 | Subdomain of a listed host               | Blocked                    |
| UTS-023-A3 | `notnytimes.com` vs listed `nytimes.com` | **Permitted** (HAZ-022)    |
| UTS-023-A4 | `NYTimes.com`, `www.nytimes.com`         | Blocked (normalized)       |
| UTS-023-A5 | Punycode/unicode host equivalents        | Consistent                 |
| UTS-023-B1 | Store throws                             | Fails **closed** (HAZ-044) |
| UTS-023-B2 | Cache stampede simulation                | Single-flight refresh      |

### UTP-025 — ImportDraftsService (MOD-025)

#### Test Case: UTP-025-A (open → confirmed, open → expired)

#### Test Case: UTP-025-B (Load with a non-owner id)

#### Test Case: UTP-025-C (Patch supplying a missing field)

#### Test Case: UTP-025-D (Expiry boundary [just before / just after])

| ID         | Case                                       | Assert                                   |
| ---------- | ------------------------------------------ | ---------------------------------------- |
| UTS-025-A1 | `open → confirmed`, `open → expired`       | Permitted                                |
| UTS-025-A2 | `confirmed → open`, `expired → confirmed`  | Rejected (terminal immutability)         |
| UTS-025-B1 | Load with a non-owner id                   | `404`, not `403` (HAZ-046)               |
| UTS-025-B2 | Load a non-existent id                     | `404` — indistinguishable from the above |
| UTS-025-C1 | Patch supplying a missing field            | `missingRequired` shrinks accordingly    |
| UTS-025-C2 | Patch clearing a required field            | It reappears in `missingRequired`        |
| UTS-025-D1 | Expiry boundary (just before / just after) | Correct classification at the edge       |

### UTP-003 — ImportJobsService (MOD-003)

#### Test Case: UTP-003-A (Every legal transition)

#### Test Case: UTP-003-B (Repeated idempotency key)

| ID         | Case                          | Assert                                     |
| ---------- | ----------------------------- | ------------------------------------------ |
| UTS-003-A1 | Every legal transition        | Permitted                                  |
| UTS-003-A2 | Every illegal transition      | Rejected                                   |
| UTS-003-B1 | Repeated idempotency key      | Original job returned; none created        |
| UTS-003-B2 | Same key, different principal | **Distinct** jobs — keys are per-principal |
| UTS-003-B3 | Same key, different endpoint  | Distinct jobs                              |

### UTP-002 — ImportsService (MOD-002)

#### Test Case: UTP-002-A (Happy path with instrumented ports)

#### Test Case: UTP-002-B (Classification raises)

| ID         | Case                               | Assert                                          |
| ---------- | ---------------------------------- | ----------------------------------------------- |
| UTS-002-A1 | Happy path with instrumented ports | Exact call **order** asserted (HAZ-026)         |
| UTS-002-A2 | Blocklist raises                   | Fetch never invoked                             |
| UTS-002-A3 | Extraction returns null            | Normalization never invoked; typed error raised |
| UTS-002-B1 | Classification raises              | No draft created                                |
| UTS-002-B2 | Dedup finds an existing recipe     | Draft creation short-circuited                  |

### UTP-026 — DraftConfirmationService (MOD-026)

#### Test Case: UTP-026-A (Complete draft)

#### Test Case: UTP-026-B (Food client throws)

#### Test Case: UTP-026-C (Source inspection)

| ID         | Case               | Assert                                        |
| ---------- | ------------------ | --------------------------------------------- |
| UTS-026-A1 | Complete draft     | Shipped `RecipesService.create` invoked once  |
| UTS-026-A2 | Incomplete draft   | `422`; create **not** invoked                 |
| UTS-026-A3 | Expired draft      | `410`; create not invoked                     |
| UTS-026-B1 | Food client throws | Confirmation still succeeds (HAZ-050)         |
| UTS-026-C1 | Source inspection  | No visibility decision made here (REQ-CN-007) |

### UTP-017 — FileParserService (MOD-017)

#### Test Case: UTP-017-A (Valid JSON / YAML / Markdown)

#### Test Case: UTP-017-B (.json name, ZIP magic bytes)

| ID         | Case                           | Assert                   |
| ---------- | ------------------------------ | ------------------------ |
| UTS-017-A1 | Valid JSON / YAML / Markdown   | Parsed to a common shape |
| UTS-017-B1 | `.json` name, ZIP magic bytes  | `415` (HAZ-037)          |
| UTS-017-B2 | YAML with hostile tags/anchors | Safe-parsed or rejected  |
| UTS-017-B3 | Oversize input                 | Rejected before parsing  |
| UTS-017-B4 | Schema-invalid recipe          | Field-level errors       |

### UTP-013 / UTP-015 — Provider adapters

| ID         | Case                               | Assert                                   |
| ---------- | ---------------------------------- | ---------------------------------------- |
| UTS-013-A1 | oEmbed 200 with a recipe caption   | Mapped payload                           |
| UTS-013-A2 | oEmbed 429 / 5xx / bad shape       | Distinct typed errors                    |
| UTS-013-B1 | Flag off                           | Adapter not constructed / channel absent |
| UTS-015-A1 | Textract success / empty / timeout | Text, `OcrFailed`, `ProviderUnavailable` |
| UTS-015-A2 | Any OCR result                     | Text never logged (HAZ-036)              |

---

## Frontend (MOD-027..MOD-032) — every state, both platforms

Each case below runs **twice**: once against the web `.tsx` leaf and once against the `.native.tsx` leaf.
`§7.1` requires a component test for **every** path, not a representative sample.

| ID          | Component         | States asserted                                                                                                                  |
| ----------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| UTS-027-a\* | ImportEntry       | idle · channel-selected · submitting · submit-disabled-while-in-flight · channel-unavailable (flag off) · validation error       |
| UTS-028-a\* | ImportProgress    | queued · running · succeeded · failed (per error class) · polling-stopped-on-unmount                                             |
| UTS-029-a\* | ImportDraftReview | complete · each missing-required permutation · unparsed ingredient row · low-confidence field · expired · saving · save-rejected |
| UTS-030-a\* | RecipeAttribution | web source · Instagram source · cloned-with-attribution · unverifiable source · absent (renders nothing)                         |
| UTS-031-a\* | ImportErrorState  | one case per error code, plus a compile-time exhaustiveness assertion (`never` default)                                          |
| UTS-032-a\* | hooks             | loading · success · error · abort-on-unmount · backoff schedule                                                                  |

Additional cross-cutting frontend assertions:

| ID       | Case                                    | Assert                                                    |
| -------- | --------------------------------------- | --------------------------------------------------------- |
| UTS-F-a1 | Every interactive element               | Accessible name via `getByRole`/`getByLabel` (REQ-NF-004) |
| UTS-F-a2 | Every state-conveying element           | Icon **or** text accompanies colour (REQ-NF-005)          |
| UTS-F-a3 | Every string rendered                   | Sourced from `messages.ts`; no literal (REQ-NF-006)       |
| UTS-F-a4 | Web and native leaves of each component | Identical exported names and type signatures (§14.3)      |

---

## MOD → UTP Coverage

| MOD     | UTP     | MOD                              | UTP                                                        | MOD         | UTP                  |
| ------- | ------- | -------------------------------- | ---------------------------------------------------------- | ----------- | -------------------- |
| MOD-002 | UTP-002 | MOD-011                          | UTP-011                                                    | MOD-022     | UTP-022              |
| MOD-003 | UTP-003 | MOD-013                          | UTP-013                                                    | MOD-023     | UTP-023              |
| MOD-005 | UTP-005 | MOD-015                          | UTP-015                                                    | MOD-024     | UTP-024              |
| MOD-006 | UTP-006 | MOD-017                          | UTP-017                                                    | MOD-025     | UTP-025              |
| MOD-008 | UTP-008 | MOD-018                          | UTP-018                                                    | MOD-026     | UTP-026              |
| MOD-009 | UTP-009 | MOD-019                          | UTP-019                                                    | MOD-027–032 | UTS-027..032         |
| MOD-010 | UTP-010 | MOD-020                          | UTP-020                                                    | MOD-033–034 | ITP-015 + type tests |
| MOD-021 | UTP-021 | MOD-001, 004, 007, 012, 014, 016 | covered via UTP-002/003/005/011/013/015 and ITP procedures |             |

## Summary

| Metric                           | Count                                                                   |
| -------------------------------- | ----------------------------------------------------------------------- |
| Unit test procedures (UTP)       | 22                                                                      |
| Enumerated unit cases (UTS)      | 120+                                                                    |
| Modules with unit coverage       | 34 / 34                                                                 |
| Mutation-verified controls       | SSRF guard (UTS-005-F1), sanitizer, provenance policy, canonicalization |
| Frontend states requiring a test | Every state, on both platforms — no sampling                            |

---

## Per-module unit procedures (Matrix D completion)

> One procedure per module that had no individually-addressable entry above. Each states a real assertion —
> these are not placeholders.

#### Test Case: UTP-001-A (Controller delegates without embedding policy)

**Linked Module:** MOD-001 (ImportsController)

| ID         | Case                                              | Assert                                                                                                               |
| ---------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| UTS-001-A1 | a request reaching the controller → it is handled | the DTO is validated, the principal resolved, and the call delegated with no policy decision taken in the controller |

#### Test Case: UTP-004-A (Worker is idempotent on redelivery)

**Linked Module:** MOD-004 (ImportJobWorker)

| ID         | Case                                                            | Assert                                                 |
| ---------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| UTS-004-A1 | a queue message for an already-terminal job → it is redelivered | the handler acknowledges without re-running the import |

#### Test Case: UTP-007-A (Extractor port never throws)

**Linked Module:** MOD-007 (RecipeExtractor port)

| ID         | Case                                                                   | Assert                                                   |
| ---------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| UTS-007-A1 | any document, including malformed input → it is passed to an extractor | the extractor returns a payload or null and never raises |

#### Test Case: UTP-009-A (Microdata items are mapped to the common payload)

**Linked Module:** MOD-009 (MicrodataExtractor)

| ID         | Case                                                   | Assert                                                                  |
| ---------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| UTS-009-A1 | a page carrying schema.org microdata → it is extracted | the mapped payload has the same shape as the JSON-LD extractor produces |

#### Test Case: UTP-010-A (Confidence reflects agreeing signals)

**Linked Module:** MOD-010 (HeuristicExtractor)

| ID         | Case                                                              | Assert                                                       |
| ---------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| UTS-010-A1 | pages with strong and weak structural signals → each is extracted | the strong page yields a higher confidence than the weak one |

#### Test Case: UTP-012-A (Port contract is honoured by any adapter)

**Linked Module:** MOD-012 (('OEmbedProvider port', 'ARCH-012'))

| ID         | Case                                                        | Assert                                                                 |
| ---------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| UTS-012-A1 | a caption provider bound to a fake → a caption is requested | the fake satisfies the port signature and returns the declared payload |

#### Test Case: UTP-013-A (Rate limiting is classified distinctly)

**Linked Module:** MOD-013 (('InstagramOEmbedAdapter', 'ARCH-013'))

| ID         | Case                                               | Assert                                                                |
| ---------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| UTS-013-A1 | a provider responding 429 → a caption is requested | a throttled error is raised, distinct from a generic provider failure |

#### Test Case: UTP-014-A (OCR port is substitutable)

**Linked Module:** MOD-014 (('OcrProvider port', 'ARCH-014'))

| ID         | Case                                                           | Assert                                                                    |
| ---------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| UTS-014-A1 | an OCR provider bound to a fake → text extraction is requested | the fake satisfies the port and the pipeline completes without the vendor |

#### Test Case: UTP-015-A (Provider timeout surfaces as unavailable)

**Linked Module:** MOD-015 (('TextractAdapter', 'ARCH-015'))

| ID         | Case                                                           | Assert                                                                 |
| ---------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| UTS-015-A1 | a provider that exceeds its deadline → extraction is attempted | a provider-unavailable error is raised and no partial text is returned |

#### Test Case: UTP-016-A (Source image is deleted on every terminal path)

**Linked Module:** MOD-016 (('OcrPipelineService', 'ARCH-016'))

| ID         | Case                                                                     | Assert                                         |
| ---------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| UTS-016-A1 | a stored OCR image on confirm, discard, and expiry → each path completes | the stored object is absent in all three cases |

#### Test Case: UTP-027-A (Gated channels are not offered)

**Linked Module:** MOD-027 (('ImportEntry', 'ARCH-027'))

| ID         | Case                                                                | Assert                                    |
| ---------- | ------------------------------------------------------------------- | ----------------------------------------- |
| UTS-027-A1 | a channel list omitting a gated channel → the entry surface renders | no affordance for that channel is present |

#### Test Case: UTP-028-A (Polling stops at a terminal state)

**Linked Module:** MOD-028 (('ImportProgress', 'ARCH-028'))

| ID         | Case                                                        | Assert                                          |
| ---------- | ----------------------------------------------------------- | ----------------------------------------------- |
| UTS-028-A1 | a job that reaches a terminal state → progress is displayed | polling ceases and no further request is issued |

#### Test Case: UTP-029-A (Save is blocked while required fields are missing)

**Linked Module:** MOD-029 (('ImportDraftReview', 'ARCH-029'))

| ID         | Case                                                               | Assert                                                |
| ---------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| UTS-029-A1 | a draft with a missing required field → the review surface renders | the save control is disabled and the reason is stated |

#### Test Case: UTP-030-A (Attribution renders only when a source exists)

**Linked Module:** MOD-030 (('RecipeAttribution', 'ARCH-030'))

| ID         | Case                                                         | Assert                                                    |
| ---------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| UTS-030-A1 | recipes with and without a source → each detail view renders | the attribution block appears only for the sourced recipe |

#### Test Case: UTP-031-A (Error union is exhaustive)

**Linked Module:** MOD-031 (('ImportErrorState', 'ARCH-031'))

| ID         | Case                                                  | Assert                                                                  |
| ---------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| UTS-031-A1 | the full set of import error codes → each is rendered | each code renders distinct copy and an unhandled code fails compilation |

#### Test Case: UTP-032-A (In-flight requests abort on unmount)

**Linked Module:** MOD-032 (('Import hooks', 'ARCH-032'))

| ID         | Case                                                    | Assert                                             |
| ---------- | ------------------------------------------------------- | -------------------------------------------------- |
| UTS-032-A1 | a hook with a request in flight → the consumer unmounts | the request is aborted and no state update follows |

#### Test Case: UTP-033-A (Every code maps to its documented status)

**Linked Module:** MOD-033 (ImportErrorCodes)

| ID         | Case                                  | Assert                                                                |
| ---------- | ------------------------------------- | --------------------------------------------------------------------- |
| UTS-033-A1 | each import error code → it is raised | the shipped filter maps it to the documented HTTP status and envelope |

#### Test Case: UTP-034-A (Channel union is exhaustive)

**Linked Module:** MOD-034 (ImportContracts)

| ID         | Case                                               | Assert                                                 |
| ---------- | -------------------------------------------------- | ------------------------------------------------------ |
| UTS-034-A1 | the import channel union → a switch omits a member | compilation fails rather than silently falling through |

#### Test Case: UTP-035-A (Unauthenticated request is refused before import work)

**Linked Module:** MOD-035

| ID         | Case                                                  | Assert                                         |
| ---------- | ----------------------------------------------------- | ---------------------------------------------- |
| UTS-035-A1 | A request with no valid token reaches an import route | It is refused before any import logic executes |

#### Test Case: UTP-036-A (Quality gates fail the build when violated)

**Linked Module:** MOD-036

| ID         | Case                                                                  | Assert                                                    |
| ---------- | --------------------------------------------------------------------- | --------------------------------------------------------- |
| UTS-036-A1 | A deliberate type, documentation, or mutation violation is introduced | The corresponding gate fails rather than passing silently |

---

> **Counts in this document are derived from the generated `v-model/traceability-matrix.md`.**
> That file is produced by `build-matrix.sh` from the artefacts and is the authoritative source; if a
> number here disagrees with it, this document is stale. Regenerate rather than hand-editing.
