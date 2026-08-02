# System Test Plan: Recipe Importing

**Feature Branch**: `004-recipe-importing`
**Regenerated**: 2026-08-02
**Status**: Approved
**Source**: `system-design.md` (SYS-001..SYS-013)
**Level**: System verification — "did we build it right, end to end?"
**Realisation**: service e2e (`tests/e2e/*.e2e.spec.ts`, real Postgres + LocalStack + a local fixture server),
Playwright (web), Maestro (mobile).

## ID Schema

`STP-{SYS}-{letter}` — a procedure against a system component · `STS-{SYS}-{letter}{n}` — a scenario within it.

## Test Environment

| Dependency       | System test uses                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Postgres         | Real, ephemeral (Docker), migrated                                                                                             |
| AWS (S3, SQS)    | LocalStack (Community) per the shipped harness                                                                                 |
| Third-party HTTP | **Local fixture server** — never the live internet, so results are deterministic and we never load someone else's site from CI |
| Textract         | Faked through `OcrProvider`; one contract test pins the real response shape                                                    |
| Meta oEmbed      | Faked through `OEmbedProvider`; CI is green without a Meta credential (D-002)                                                  |
| Clerk            | Test tokens per the shipped e2e harness                                                                                        |

---

## STP-001 — Source Fetcher (SYS-001) ⚠️ security-critical

#### Test Case: STP-001-A (Fixture page returns 200 text/html)

#### Test Case: STP-001-B (Source never completes headers within the connect budget)

#### Test Case: STP-001-C (Response body exceeds 5 MB)

#### Test Case: STP-001-D (URL host resolves to 127.0.0.1)

#### Test Case: STP-001-E (10 consecutive failures from one domain)

#### Test Case: STP-001-F (Response is application/pdf)

| ID         | Scenario                                                    | Expected                                                      |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| STS-001-A1 | Fixture page returns 200 `text/html`                        | Document returned; extraction proceeds                        |
| STS-001-A2 | Source returns 404 / 410 / 500                              | `IMPORT_SOURCE_UNREACHABLE`; no draft                         |
| STS-001-B1 | Source never completes headers within the connect budget    | Aborted at 3s                                                 |
| STS-001-B2 | Source trickles bytes indefinitely (slow loris)             | Aborted at the 10s total deadline; worker released (HAZ-031)  |
| STS-001-C1 | Response body exceeds 5 MB                                  | Aborted mid-stream; `IMPORT_PAYLOAD_TOO_LARGE`; memory flat   |
| STS-001-C2 | 6 chained redirects                                         | Refused after 5 hops                                          |
| STS-001-D1 | URL host resolves to `127.0.0.1`                            | Refused; **no** socket opened                                 |
| STS-001-D2 | URL host resolves to `169.254.169.254`                      | Refused (cloud metadata unreachable)                          |
| STS-001-D3 | Public URL 302-redirects to a private address               | Refused **at the hop** (REQ-018)                              |
| STS-001-D4 | Host resolves to both a public and a private address        | Refused — every address must pass                             |
| STS-001-D5 | DNS answer changes between validation and connect           | Connection pinned to the validated address; rebinding fails   |
| STS-001-E1 | 10 consecutive failures from one domain                     | Breaker opens; subsequent imports fail fast with `503`        |
| STS-001-E2 | After the breaker's half-open interval, the source recovers | Breaker closes; imports resume                                |
| STS-001-F1 | Response is `application/pdf`                               | Rejected — html content types only                            |
| STS-001-F2 | Any fetch                                                   | No `Authorization`/`Cookie` header is sent; body never logged |

## STP-002 — Extractor Chain (SYS-002)

#### Test Case: STP-002-A (Well-formed JSON-LD Recipe)

#### Test Case: STP-002-B (Microdata only)

#### Test Case: STP-002-C (No structured markup, recognisable structure)

#### Test Case: STP-002-D (Non-UTF-8 charset with a BOM)

#### Test Case: STP-002-E (Page crafted to stress heuristic patterns)

| ID         | Scenario                                          | Expected                                               |
| ---------- | ------------------------------------------------- | ------------------------------------------------------ |
| STS-002-A1 | Well-formed JSON-LD `Recipe`                      | JSON-LD strategy hits; all mapped fields populated     |
| STS-002-A2 | JSON-LD nested in `@graph`                        | Recipe located and extracted                           |
| STS-002-A3 | JSON-LD present but `@type` is `Article`          | Not accepted as a recipe; chain continues (HAZ-028)    |
| STS-002-A4 | One malformed JSON-LD block alongside a valid one | The valid block is used; the malformed one is skipped  |
| STS-002-B1 | Microdata only                                    | Microdata strategy hits                                |
| STS-002-C1 | No structured markup, recognisable structure      | Heuristic strategy hits with confidence < 1            |
| STS-002-C2 | No recognisable recipe at all                     | `IMPORT_NO_RECIPE_FOUND` — explicit, not empty success |
| STS-002-D1 | Non-UTF-8 charset with a BOM                      | Text decoded correctly, not mojibake (HAZ-005)         |
| STS-002-E1 | Page crafted to stress heuristic patterns         | Completes inside the per-job CPU budget (HAZ-033)      |

## STP-003 — Instagram (SYS-003, gated)

#### Test Case: STP-003-A (Flag off; endpoint called)

#### Test Case: STP-003-B (Flag on; caption contains a recipe)

#### Test Case: STP-003-C (Provider returns 429)

| ID         | Scenario                             | Expected                                                  |
| ---------- | ------------------------------------ | --------------------------------------------------------- |
| STS-003-A1 | Flag off; endpoint called            | `404`; channel absent from `GET /import/sources`          |
| STS-003-B1 | Flag on; caption contains a recipe   | Draft produced; `imported_public`                         |
| STS-003-B2 | Flag on; caption has no recipe text  | `IMPORT_NO_CAPTION`                                       |
| STS-003-C1 | Provider returns 429                 | Classified as throttled, distinct from a generic failure  |
| STS-003-C2 | Provider returns an unexpected shape | `IMPORT_PROVIDER_UNAVAILABLE`; no partial draft (HAZ-012) |

## STP-004 — OCR (SYS-004)

#### Test Case: STP-004-A (Clear printed recipe photo)

#### Test Case: STP-004-B (Image yielding no usable text)

#### Test Case: STP-004-C (Provider exceeds the deadline)

#### Test Case: STP-004-D (Draft confirmed, discarded, or expired)

| ID         | Scenario                               | Expected                                                |
| ---------- | -------------------------------------- | ------------------------------------------------------- |
| STS-004-A1 | Clear printed recipe photo             | Draft produced; `imported_physical`; private on confirm |
| STS-004-A2 | Handwritten recipe photo               | Draft produced; low confidence surfaced                 |
| STS-004-B1 | Image yielding no usable text          | `IMPORT_OCR_FAILED`; no draft; object deleted           |
| STS-004-B2 | Upload above 10 MB, or a non-image     | `413` / `415` by magic bytes                            |
| STS-004-C1 | Provider exceeds the deadline          | `IMPORT_PROVIDER_UNAVAILABLE`; worker released          |
| STS-004-D1 | Draft confirmed, discarded, or expired | S3 object absent in all three cases (REQ-026)           |
| STS-004-D2 | Any OCR run                            | Extracted text appears in **no** log line (HAZ-036)     |

## STP-005 — File import (SYS-005)

#### Test Case: STP-005-A (Valid JSON / YAML / Markdown)

#### Test Case: STP-005-B (.json name, ZIP bytes)

| ID         | Scenario                       | Expected                          |
| ---------- | ------------------------------ | --------------------------------- |
| STS-005-A1 | Valid JSON / YAML / Markdown   | Draft produced (one per format)   |
| STS-005-B1 | `.json` name, ZIP bytes        | `415` (HAZ-037)                   |
| STS-005-B2 | YAML with hostile tags/anchors | Safe-parsed or rejected (HAZ-038) |
| STS-005-B3 | File above the 1 MB cap        | `413` before parsing (HAZ-039)    |

## STP-006 — Normalization (SYS-006)

#### Test Case: STP-006-A (recipeIngredient: ["2 cups flour", "salt to taste"])

#### Test Case: STP-006-B (prepTime: "PT1H30M")

#### Test Case: STP-006-C (recipeYield: "4 servings" / "serves 4-6" / "a crowd")

#### Test Case: STP-006-D (Fields containing <script> or <img onerror>)

| ID         | Scenario                                                   | Expected                                                            |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| STS-006-A1 | `recipeIngredient: ["2 cups flour", "salt to taste"]`      | Structured quantities where determinable; `raw` retained on both    |
| STS-006-A2 | An ingredient line the parser cannot interpret             | `quantity: null`, flagged, raw preserved; import still succeeds     |
| STS-006-B1 | `prepTime: "PT1H30M"`                                      | 90 minutes                                                          |
| STS-006-B2 | Times absent                                               | Fields empty and listed in `missingRequired`; **never 0** (HAZ-040) |
| STS-006-C1 | `recipeYield: "4 servings"` / `"serves 4-6"` / `"a crowd"` | 4 / 4-flagged / empty-flagged                                       |
| STS-006-D1 | Fields containing `<script>` or `<img onerror>`            | Persisted inert; nothing renders as markup (HAZ-008)                |

## STP-007 — Provenance (SYS-007)

#### Test Case: STP-007-A (Each channel imported)

#### Test Case: STP-007-B (Manual paste, attested, non-public citation)

#### Test Case: STP-007-C (Heuristic flags content the user attested otherwise)

| ID         | Scenario                                            | Expected                                               |
| ---------- | --------------------------------------------------- | ------------------------------------------------------ |
| STS-007-A1 | Each channel imported                               | `sourceType` per REQ-014 for all five channels         |
| STS-007-B1 | Manual paste, attested, non-public citation         | `imported_paid`; public visibility refused end-to-end  |
| STS-007-B2 | Manual paste, attested, public URL citation         | `imported_public`                                      |
| STS-007-C1 | Heuristic flags content the user attested otherwise | Flagged for review; classification unchanged (HAZ-042) |

## STP-008 — Blocklist (SYS-008)

#### Test Case: STP-008-A (Blocked domain)

#### Test Case: STP-008-B (Admin adds a domain)

#### Test Case: STP-008-C (Blocklist store unavailable)

| ID         | Scenario                                  | Expected                                                       |
| ---------- | ----------------------------------------- | -------------------------------------------------------------- |
| STS-008-A1 | Blocked domain                            | `IMPORT_SOURCE_BLOCKED`; fixture server records **no** request |
| STS-008-A2 | Subdomain of a blocked domain             | Blocked                                                        |
| STS-008-A3 | `notnytimes.com` vs blocked `nytimes.com` | Permitted (HAZ-022)                                            |
| STS-008-B1 | Admin adds a domain                       | Effective without a deploy; audit row written                  |
| STS-008-B2 | Non-admin calls the admin endpoint        | `403`                                                          |
| STS-008-C1 | Blocklist store unavailable               | Import **fails closed**, not open (HAZ-044)                    |

## STP-009 — Dedup (SYS-009)

#### Test Case: STP-009-A (Same URL imported twice sequentially)

#### Test Case: STP-009-B (Two concurrent imports of one new URL)

| ID         | Scenario                                                  | Expected                                 |
| ---------- | --------------------------------------------------------- | ---------------------------------------- |
| STS-009-A1 | Same URL imported twice sequentially                      | Existing recipe surfaced; no duplicate   |
| STS-009-A2 | URLs differing only by case/slash/`utm_*`/fragment        | Treated as the same source               |
| STS-009-B1 | Two concurrent imports of one new URL                     | Exactly one recipe; loser resolves to it |
| STS-009-B2 | Previously imported recipe soft-deleted, then re-imported | Succeeds (REQ-CN-002)                    |

## STP-010 — Drafts and jobs (SYS-010, SYS-011)

#### Test Case: STP-010-A (Draft created, patched, confirmed)

#### Test Case: STP-010-B (Another user's draft/job id requested)

#### Test Case: STP-010-C (Same Idempotency-Key submitted twice)

#### Test Case: STP-010-D (Pipeline step order asserted under fault injection)

| ID         | Scenario                                           | Expected                                                      |
| ---------- | -------------------------------------------------- | ------------------------------------------------------------- |
| STS-010-A1 | Draft created, patched, confirmed                  | Recipe created; draft `confirmed`; second confirm is rejected |
| STS-010-A2 | Draft past expiry                                  | `410`; sweep removes it and its OCR object                    |
| STS-010-B1 | Another user's draft/job id requested              | `404`, never `403` (HAZ-046)                                  |
| STS-010-C1 | Same `Idempotency-Key` submitted twice             | One job, one draft (HAZ-047)                                  |
| STS-010-C2 | Queue message redelivered                          | Exactly one effect                                            |
| STS-010-C3 | Job fails past the retry cap                       | Routed to the DLQ; job marked failed with a typed code        |
| STS-010-D1 | Pipeline step order asserted under fault injection | Order never varies (HAZ-026)                                  |

## STP-011 — Confirmation bridge (SYS-012)

#### Test Case: STP-011-A (Complete draft confirmed)

#### Test Case: STP-011-B (Food service unavailable at confirm)

#### Test Case: STP-011-C (Imported-paid draft confirmed, then made public)

| ID         | Scenario                                        | Expected                                                           |
| ---------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| STS-011-A1 | Complete draft confirmed                        | Recipe created via the shipped path with correct attribution       |
| STS-011-A2 | Incomplete draft confirmed                      | `422` with the field list; no recipe                               |
| STS-011-B1 | Food service unavailable at confirm             | Confirmation **succeeds**; ingredients remain unresolved (HAZ-050) |
| STS-011-B2 | Food service recovers                           | Ingredients resolve asynchronously                                 |
| STS-011-C1 | Imported-paid draft confirmed, then made public | Refused by the shipped policy (HAZ-051)                            |

## STP-012 — UI (SYS-013), web and mobile

#### Test Case: STP-012-A (Import a URL from web [Playwright])

#### Test Case: STP-012-B (Photo import from mobile [Maestro])

#### Test Case: STP-012-C (Draft with missing servings, both platforms)

#### Test Case: STP-012-D (Each error code, both platforms)

#### Test Case: STP-012-E (Attribution on an imported recipe, both platforms)

| ID         | Scenario                                          | Expected                                                |
| ---------- | ------------------------------------------------- | ------------------------------------------------------- |
| STS-012-A1 | Import a URL from web (Playwright)                | Draft review reached and confirmed; recipe visible      |
| STS-012-A2 | Import a URL from mobile (Maestro)                | Same outcome                                            |
| STS-012-B1 | Photo import from mobile (Maestro)                | Draft reached, confirmed, recipe private                |
| STS-012-C1 | Draft with missing servings, both platforms       | Confirm disabled until supplied                         |
| STS-012-D1 | Each error code, both platforms                   | Distinct copy + icon; keyboard/screen-reader accessible |
| STS-012-E1 | Attribution on an imported recipe, both platforms | Source, author, platform visible                        |

## STP-013 — Auth (shipped middleware, SYS boundary)

#### Test Case: STP-013-A (No bearer token)

#### Test Case: STP-013-B (Valid token)

| ID         | Scenario                     | Expected                                                                               |
| ---------- | ---------------------------- | -------------------------------------------------------------------------------------- |
| STS-013-A1 | No bearer token              | `401` before any import work                                                           |
| STS-013-A2 | Expired or wrong-`azp` token | `401`                                                                                  |
| STS-013-B1 | Valid token                  | `principal.userId` is the **app ULID**, and the created recipe's `owner_id` matches it |

---

## SYS → STP Coverage

| SYS     | Procedures | SYS     | Procedures |
| ------- | ---------- | ------- | ---------- |
| SYS-001 | STP-001    | SYS-008 | STP-008    |
| SYS-002 | STP-002    | SYS-009 | STP-009    |
| SYS-003 | STP-003    | SYS-010 | STP-010    |
| SYS-004 | STP-004    | SYS-011 | STP-010    |
| SYS-005 | STP-005    | SYS-012 | STP-011    |
| SYS-006 | STP-006    | SYS-013 | STP-012    |
| SYS-007 | STP-007    | _auth_  | STP-013    |

## Summary

| Metric                                    | Count                          |
| ----------------------------------------- | ------------------------------ |
| System test procedures (STP)              | 13                             |
| System test scenarios (STS)               | 81                             |
| SYS components covered                    | 13 / 13                        |
| Scenarios targeting a Catastrophic hazard | 6 (STS-001-D1..d5, STS-010-B1) |

## STP-014 — Auth enforcement (SYS-014)

#### Test Case: STP-014-A (Unauthenticated import is refused)

| ID         | Scenario                                                   | Expected                                                           |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| STS-014-A1 | Every import endpoint called without a valid session token | Refused before any import work; no job, draft, or outbound request |

## STP-015 — Contract & quality gates (SYS-015)

#### Test Case: STP-015-A (Gates hold end to end)

| ID         | Scenario                                                               | Expected                                         |
| ---------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| STS-015-A1 | Contract round-trip, type, documentation, and mutation gates run in CI | All pass; a deliberate violation fails the build |
