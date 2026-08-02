# Traceability Matrix

**Generated**: 2026-08-02
**Source**: `specs/004-recipe-importing/v-model/`

## Matrix A — Validation (User View)

| Requirement ID | Requirement Description                                                                                                                                                                                                                                                                           | Test Case ID (ATP) | Validation Condition                                                   | Scenario ID (SCN) | Status      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------- | ----------------- | ----------- |
| **REQ-001**    | The system SHALL allow an authenticated user to import a recipe from a public website URL, extracting title, ingredient lines, instruction steps, times, servings, and photo URLs into an import draft.                                                                                           | ATP-001-A          | Structured-markup URL import yields a complete draft                   | SCN-001-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-001-B          | Unreachable source creates nothing                                     | SCN-001-B1        | ⬜ Untested |
| **REQ-002**    | The system SHALL attempt structured-markup extraction before heuristic extraction, and SHALL treat a JSON-LD object whose `@type` is not `Recipe` as no result rather than as a recipe.                                                                                                           | ATP-002-A          | JSON-LD is preferred over heuristics                                   | SCN-002-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-002-B          | Non-Recipe JSON-LD is not accepted as a recipe                         | SCN-002-B1        | ⬜ Untested |
| **REQ-003**    | The system SHALL enforce deduplication by canonicalized source URL: where a non-deleted recipe already exists for that key, it SHALL surface the existing recipe and offer to clone it rather than creating a second recipe.                                                                      | ATP-003-A          | Second import of the same URL surfaces the existing recipe             | SCN-003-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-003-B          | Equivalent URL variants resolve to one recipe                          | SCN-003-B1        | ⬜ Untested |
| **REQ-004**    | The system SHALL enforce deduplication uniqueness with a database constraint rather than a read-then-write check, so that concurrent imports of the same URL cannot both succeed.                                                                                                                 | ATP-004-A          | Concurrent imports of a new URL produce exactly one recipe             | SCN-004-A1        | ⬜ Untested |
| **REQ-005**    | The system SHALL allow an authenticated user to import a recipe from a public Instagram post by extracting recipe text from the post caption, and SHALL reject with an explicit reason a post whose caption contains no recipe text.                                                              | ATP-005-A          | Caption containing a recipe yields a draft                             | SCN-005-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-005-B          | Caption without recipe text is rejected explicitly                     | SCN-005-B1        | ⬜ Untested |
| **REQ-006**    | The system SHALL allow an authenticated user to import a recipe from a structured file in JSON, YAML, or Markdown-with-YAML-frontmatter form, determining the file type by content inspection rather than by the client-supplied name or MIME type.                                               | ATP-006-A          | Each supported format produces a draft                                 | SCN-006-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-006-B          | Filename is not trusted for type detection                             | SCN-006-B1        | ⬜ Untested |
| **REQ-007**    | The system SHALL allow an authenticated user to import a recipe from a photograph of a physical copy via OCR text extraction, producing a draft for review.                                                                                                                                       | ATP-007-A          | Legible photo yields a reviewable draft                                | SCN-007-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-007-B          | Unreadable image fails without creating a draft                        | SCN-007-B1        | ⬜ Untested |
| **REQ-008**    | The system SHALL parse each free-text ingredient line into a structured quantity, unit, and name, and SHALL retain the original line verbatim in all cases.                                                                                                                                       | ATP-008-A          | Structured quantity extracted with raw preserved                       | SCN-008-A1        | ⬜ Untested |
| **REQ-009**    | The system SHALL preserve an ingredient line that cannot be parsed, with a null quantity, flagged for user correction, and SHALL NOT fail the import because of it.                                                                                                                               | ATP-009-A          | Unparseable line is flagged, not discarded                             | SCN-009-A1        | ⬜ Untested |
| **REQ-010**    | The system SHALL submit parsed ingredient names to the food catalog for asynchronous resolution using the shipped resolution lifecycle, and SHALL NOT block draft confirmation on resolution completing.                                                                                          | ATP-010-A          | Confirmation succeeds while the food service is down                   | SCN-010-A1        | ⬜ Untested |
| **REQ-011**    | The system SHALL normalize extracted ISO-8601 durations to integer minutes and free-text servings to a positive integer where unambiguous, and SHALL leave the field empty and flagged where it is absent or ambiguous.                                                                           | ATP-011-A          | ISO-8601 durations become integer minutes                              | SCN-011-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-011-B          | Absent values are flagged, never fabricated                            | SCN-011-B1        | ⬜ Untested |
| **REQ-012**    | The system SHALL return every import as a draft carrying per-field extraction confidence and an explicit list of missing required fields, and SHALL create no recipe until that draft is confirmed.                                                                                               | ATP-012-A          | Draft carries confidence and missing-field list                        | SCN-012-A1        | ⬜ Untested |
| **REQ-013**    | The system SHALL validate a draft against the shipped `CreateRecipeRequest` contract on confirmation and SHALL reject an incomplete draft with field-level errors.                                                                                                                                | ATP-013-A          | Complete draft confirms into a recipe                                  | SCN-013-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-013-B          | Incomplete draft is refused with field-level errors                    | SCN-013-B1        | ⬜ Untested |
| **REQ-014**    | The system SHALL classify each import's provenance and set `sourceType` to `imported_public` for web and Instagram, `imported_physical` for photo/OCR, `imported_paid` for attested paid sources, and `user_created` for structured-file imports (a user's own export, not third-party material). | ATP-014-A          | Each channel sets the documented source type                           | SCN-014-A1        | ⬜ Untested |
| **REQ-015**    | The system SHALL delegate visibility enforcement to the shipped `evaluateVisibility` policy and SHALL NOT implement a second visibility rule.                                                                                                                                                     | ATP-015-A          | No second visibility rule exists in the feature                        | SCN-015-A1        | ⬜ Untested |
| **REQ-016**    | The system SHALL display source attribution — source URL, original author, and platform — for every recipe imported from a website or Instagram, on both web and mobile.                                                                                                                          | ATP-016-A          | Imported public recipe shows source, author, platform                  | SCN-016-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-016-B          | Non-imported recipe shows no attribution block                         | SCN-016-B1        | ⬜ Untested |
| **REQ-017**    | The system SHALL reject an import from a domain on the paywalled-source blocklist before performing any outbound request, and SHALL inform the user of the reason.                                                                                                                                | ATP-017-A          | Blocklisted domain is never contacted                                  | SCN-017-A1        | ⬜ Untested |
| **REQ-018**    | The system SHALL re-evaluate the blocklist and the private-address guard on every redirect hop, not only on the originally submitted URL.                                                                                                                                                         | ATP-018-A          | Redirect into a blocked domain is refused mid-chain                    | SCN-018-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-018-B          | Redirect into a private address is refused mid-chain                   | SCN-018-B1        | ⬜ Untested |
| **REQ-019**    | The system SHALL store the paywalled-domain blocklist as data with an admin-managed lifecycle and an audit trail recording who added each entry and when.                                                                                                                                         | ATP-019-A          | Admin addition takes effect without a deploy                           | SCN-019-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-019-B          | Non-admin cannot modify the blocklist                                  | SCN-019-B1        | ⬜ Untested |
| **REQ-020**    | The system SHALL match a blocklist entry by exact host or registrable suffix, and SHALL NOT match by substring.                                                                                                                                                                                   | ATP-020-A          | A look-alike domain is not blocked                                     | SCN-020-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-020-B          | A subdomain of a blocked domain is blocked                             | SCN-020-B1        | ⬜ Untested |
| **REQ-021**    | The system SHALL require, for manually entered content the user attests came from an external source, both an explicit attestation and a source citation — a URL where one exists, otherwise a free-text citation.                                                                                | ATP-021-A          | Citation is mandatory before saving                                    | SCN-021-A1        | ⬜ Untested |
| **REQ-022**    | The system SHALL classify an attested source that is not a publicly reachable web page as `imported_paid`, and such a recipe SHALL NOT be made public.                                                                                                                                            | ATP-022-A          | Cookbook citation yields a private, unpublishable recipe               | SCN-022-A1        | ⬜ Untested |
| **REQ-023**    | The system SHALL run automated paid-source detection heuristics as a secondary signal that flags a recipe for review only, and a heuristic SHALL NOT by itself reclassify a recipe or block a save.                                                                                               | ATP-023-A          | A heuristic does not override the user's declaration                   | SCN-023-A1        | ⬜ Untested |
| **REQ-024**    | The system SHALL report an unreachable, blocked, or recipe-free source with a distinct machine-readable error code per case, and SHALL create neither a recipe nor a draft in those cases.                                                                                                        | ATP-024-A          | Each failure kind returns its own code                                 | SCN-024-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-024-B          | A failed import persists nothing                                       | SCN-024-B1        | ⬜ Untested |
| **REQ-025**    | The system SHALL preserve an imported recipe when its original source is later removed, retaining the stored attribution and marking the source unverifiable.                                                                                                                                     | ATP-025-A          | Removed source leaves the recipe intact and marked unverifiable        | SCN-025-A1        | ⬜ Untested |
| **REQ-026**    | The system SHALL expire unconfirmed import drafts 7 days after creation (D-005), and SHALL delete the OCR source image on confirm, discard, or expiry — whichever occurs first, so that no image outlives its draft.                                                                              | ATP-026-A          | Drafts expire after seven days                                         | SCN-026-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-026-B          | OCR image never outlives its draft                                     | SCN-026-B1        | ⬜ Untested |
| **REQ-027**    | The system SHALL treat a draft or import job belonging to another user as non-existent rather than forbidden.                                                                                                                                                                                     | ATP-027-A          | Another user's draft is indistinguishable from absent                  | SCN-027-A1        | ⬜ Untested |
| **REQ-028**    | The system SHALL require an idempotency key on every non-idempotent import creation request and SHALL return the original outcome for a repeated key rather than importing twice.                                                                                                                 | ATP-028-A          | Repeated key produces exactly one import                               | SCN-028-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-028-B          | Missing key is refused                                                 | SCN-028-B1        | ⬜ Untested |
| **REQ-029**    | The system SHALL enforce a per-user daily import allowance across all channels and a tighter sub-allowance for OCR imports, evaluated as domain policy rather than as a transport throttler, and SHALL reject an exceeded allowance with a distinct code carrying the reset time.                 | ATP-029-A          | Exhausted allowance is refused with a reset time                       | SCN-029-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-029-B          | A bulk file counts as one import against the allowance                 | SCN-029-B1        | ⬜ Untested |
| **REQ-030**    | The system SHALL honour a `robots.txt` group that names the import user-agent in full, SHALL honour a path-specific wildcard `Disallow` matching the requested path, and SHALL NOT treat a bare wildcard `Disallow: /` as blocking a user-initiated import (D-007). Blocks SHALL be counted.      | ATP-030-A          | Bare wildcard disallow does not block a user-initiated import          | SCN-030-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-030-B          | A directive naming our agent is honoured in full                       | SCN-030-B1        | ⬜ Untested |
| **REQ-031**    | Recipe creation SHALL accept an explicit provenance and SHALL evaluate the C-004 visibility policy against that actual provenance, defaulting to `user_created` when none is supplied so existing behaviour is unchanged (D-011).                                                                 | ATP-031-A          | Provenance drives the visibility decision                              | SCN-031-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-031-B          | Existing creation behaviour is unchanged                               | SCN-031-B1        | ⬜ Untested |
| **REQ-032**    | Client-supplied provenance SHALL be whitelisted: a caller MAY declare only the attested paid-source class, and SHALL NOT be able to declare `imported_public` or `imported_physical`, which are server-set from the observed channel.                                                             | ATP-032-A          | A caller cannot obtain a private recipe by declaring a physical source | SCN-032-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-032-B          | A caller cannot attach false public attribution                        | SCN-032-B1        | ⬜ Untested |
| **REQ-033**    | The system SHALL import a single file containing up to 1,000 recipes (rejecting larger files with an explicit limit message), producing one draft per recipe, and SHALL allow complete drafts to be confirmed in one bulk action while surfacing incomplete drafts individually.                  | ATP-033-A          | One file yields one draft per recipe with a completeness split         | SCN-033-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-033-B          | A file above the recipe limit is refused                               | SCN-033-B1        | ⬜ Untested |
| **REQ-034**    | Bulk confirmation SHALL report a per-recipe outcome (created / already existed / failed with a reason) and SHALL apply deduplication per recipe; one recipe's failure SHALL NOT discard the others.                                                                                               | ATP-034-A          | One failure does not discard the successes                             | SCN-034-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-034-B          | An already-present recipe reports as existing, not failed              | SCN-034-B1        | ⬜ Untested |
| **REQ-035**    | Any import channel whose result is non-public by policy — photo/OCR and attested paid-source — SHALL require an active premium entitlement, SHALL refuse an unentitled caller with a distinct machine-readable code, and SHALL NOT advertise the channel to that caller (D-014).                  | ATP-035-A          | Unentitled caller is refused before any provider work                  | SCN-035-A1        | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-035-B          | Gated channels are not advertised to unentitled callers                | SCN-035-B1        | ⬜ Untested |
| **REQ-CN-001** | The system MUST NOT hold more than one non-deleted recipe per canonicalized source URL.                                                                                                                                                                                                           | ATP-CN-001-A       | No canonical URL ever holds two live recipes                           | SCN-CN-001-A1     | ⬜ Untested |
| **REQ-CN-002** | The dedup uniqueness constraint MUST exclude soft-deleted rows, so that a deleted import can be re-imported.                                                                                                                                                                                      | ATP-CN-002-A       | Soft-deleted recipe does not block a fresh import                      | SCN-CN-002-A1     | ⬜ Untested |
| **REQ-CN-003** | The system MUST NOT make public any recipe classified `imported_paid`, regardless of the channel through which it was entered.                                                                                                                                                                    | ATP-CN-003-A       | Publication is refused regardless of entry channel                     | SCN-CN-003-A1     | ⬜ Untested |
| **REQ-CN-004** | Instagram import MUST be limited to posts carrying recipe text in the caption; video-only and image-only posts are out of scope.                                                                                                                                                                  | ATP-CN-004-A       | Non-caption posts are out of scope and say so                          | SCN-CN-004-A1     | ⬜ Untested |
| **REQ-CN-005** | RDFa extraction is out of scope; the extractor chain is JSON-LD, microdata, and heuristic HTML only.                                                                                                                                                                                              | ATP-CN-005-A       | Only the three documented strategies are present                       | SCN-CN-005-A1     | ⬜ Untested |
| **REQ-CN-006** | Sites requiring client-side JavaScript rendering are out of scope at launch and MUST be reported as "no recipe found" rather than as an empty success.                                                                                                                                            | ATP-CN-006-A       | A client-rendered page is a stated failure, not an empty success       | SCN-CN-006-A1     | ⬜ Untested |
| **REQ-CN-007** | The feature MUST NOT introduce a second implementation of attribution storage, clone behaviour, visibility policy, error-envelope mapping, or rate limiting.                                                                                                                                      | ATP-CN-007-A       | Import creates recipes only through the shipped path                   | SCN-CN-007-A1     | ⬜ Untested |
| **REQ-CN-008** | Every user-facing capability MUST ship to web and mobile in the same release.                                                                                                                                                                                                                     | ATP-CN-008-A       | No capability exists on only one platform                              | SCN-CN-008-A1     | ⬜ Untested |
| **REQ-CN-009** | Every API path introduced by this feature SHALL begin `/api/{version}/`; references to endpoints shipped by other features SHALL cite their actual current path until the platform-wide prefix migration lands (D-015).                                                                           | ATP-CN-009-A       | Every introduced endpoint is /api/v1-prefixed                          | SCN-CN-009-A1     | ⬜ Untested |
| **REQ-IF-001** | The system SHALL integrate with the Meta-hosted Instagram oEmbed endpoint using an application credential, behind a capability flag that defaults to disabled.                                                                                                                                    | ATP-IF-001-A       | Disabled flag hides the channel entirely                               | SCN-IF-001-A1     | ⬜ Untested |
| **REQ-IF-002** | The system SHALL integrate with AWS Textract for OCR text extraction, behind an `OcrProvider` port.                                                                                                                                                                                               | ATP-IF-002-A       | Pipeline runs against a substituted provider                           | SCN-IF-002-A1     | ⬜ Untested |
| **REQ-IF-003** | The system SHALL create imported recipes exclusively through the shipped 001 recipe write path, conforming to the shipped `CreateRecipeRequest` contract.                                                                                                                                         | ATP-IF-003-A       | Imported recipes satisfy the shipped creation contract                 | SCN-IF-003-A1     | ⬜ Untested |
| **REQ-IF-004** | The system SHALL enforce authentication on every import endpoint via the shipped Clerk session-token middleware, rejecting unauthenticated requests before any import work.                                                                                                                       | ATP-IF-004-A       | Unauthenticated request is refused before any work                     | SCN-IF-004-A1     | ⬜ Untested |
| **REQ-IF-005** | The system SHALL resolve parsed ingredient names against the food catalog via the shipped typed food-service client.                                                                                                                                                                              | ATP-IF-005-A       | Parsed names are submitted to the catalog                              | SCN-IF-005-A1     | ⬜ Untested |
| **REQ-IF-006** | The system SHALL publish every import endpoint in the shipped OpenAPI contract before implementation, and SHALL expose them through the shipped typed recipe-service client.                                                                                                                      | ATP-IF-006-A       | Documented contract matches actual responses                           | SCN-IF-006-A1     | ⬜ Untested |
| **REQ-NF-001** | All TypeScript introduced by this feature MUST compile with `strict: true`, with no `any` outside explicitly marked test doubles.                                                                                                                                                                 | ATP-NF-001-A       | Type checking passes with no escape hatches                            | SCN-NF-001-A1     | ⬜ Untested |
| **REQ-NF-002** | All exported functions and interfaces introduced by this feature MUST carry JSDoc documentation.                                                                                                                                                                                                  | ATP-NF-002-A       | All exported symbols are documented                                    | SCN-NF-002-A1     | ⬜ Untested |
| **REQ-NF-003** | Structured-markup URL extraction MUST achieve at least 85% field-level accuracy for title, ingredient lines, and instruction steps against the hand-verified fixture corpus (SC-002).                                                                                                             | ATP-NF-003-A       | Corpus accuracy meets the threshold                                    | SCN-NF-003-A1     | ⬜ Untested |
| **REQ-NF-004** | Every UI component introduced by this feature MUST expose an accessible name queryable via `getByRole` or `getByLabel`.                                                                                                                                                                           | ATP-NF-004-A       | Every import control is reachable by role or label                     | SCN-NF-004-A1     | ⬜ Untested |
| **REQ-NF-005** | Colour MUST NOT be the sole conveyor of state in any UI introduced by this feature; an icon or text label MUST accompany it.                                                                                                                                                                      | ATP-NF-005-A       | Every state carries an icon or text label                              | SCN-NF-005-A1     | ⬜ Untested |
| **REQ-NF-006** | All user-facing copy MUST be routed through the shipped localization path and shared between web and mobile; the service MUST return machine-readable codes, not user-facing prose.                                                                                                               | ATP-NF-006-A       | No user-facing literal is hard-coded                                   | SCN-NF-006-A1     | ⬜ Untested |
| **REQ-NF-007** | Every outbound request MUST carry an explicit connection and request timeout, a bounded redirect count, a bounded response size, and MUST be wrapped in a circuit breaker.                                                                                                                        | ATP-NF-007-A       | Every outbound call is bounded and breaker-wrapped                     | SCN-NF-007-A1     | ⬜ Untested |
| **REQ-NF-008** | Retries MUST be limited to idempotent requests and transient failures, capped in count, with exponential backoff and full jitter.                                                                                                                                                                 | ATP-NF-008-A       | Transient failures retry; client errors do not                         | SCN-NF-008-A1     | ⬜ Untested |
| **REQ-NF-009** | The system MUST NOT issue an outbound request to a loopback, private, link-local, CGNAT, unique-local, or unspecified address, and MUST enforce this on every redirect hop.                                                                                                                       | ATP-NF-009-A       | Private and link-local addresses are refused                           | SCN-NF-009-A1     | ⬜ Untested |
|                |                                                                                                                                                                                                                                                                                                   | ATP-NF-009-B       | Address is re-validated after DNS changes                              | SCN-NF-009-B1     | ⬜ Untested |
| **REQ-NF-010** | All extracted third-party content MUST be sanitized before persistence; no extracted markup may be stored or rendered as HTML.                                                                                                                                                                    | ATP-NF-010-A       | Markup in a source cannot become active content                        | SCN-NF-010-A1     | ⬜ Untested |
| **REQ-NF-011** | Import endpoints MUST publish latency and availability SLOs and MUST be load- and soak-tested against them.                                                                                                                                                                                       | ATP-NF-011-A       | Latency targets hold under load and shed cleanly beyond it             | SCN-NF-011-A1     | ⬜ Untested |
| **REQ-NF-012** | The system MUST NOT log fetched response bodies or OCR-extracted text.                                                                                                                                                                                                                            | ATP-NF-012-A       | No third-party content reaches the logs                                | SCN-NF-012-A1     | ⬜ Untested |
| **REQ-NF-013** | The pure import core MUST meet mutation-score thresholds enforced in CI — 90% for policy and normalization modules, 95% for the SSRF guard, 80% for extractors — with I/O adapters reported but not gated (D-010).                                                                                | ATP-NF-013-A       | Mutation score meets the per-area threshold                            | SCN-NF-013-A1     | ⬜ Untested |

### Matrix A Coverage

| Metric                     | Value        |
| -------------------------- | ------------ |
| **Total Requirements**     | 63           |
| **Total Test Cases (ATP)** | 86           |
| **Total Scenarios (SCN)**  | 86           |
| **REQ → ATP Coverage**     | 63/63 (100%) |
| **ATP → SCN Coverage**     | 86/86 (100%) |

## Matrix B — Verification (Architectural View)

| Requirement ID | System Component (SYS) | Component Name             | Test Case ID (STP) | Technique | Scenario ID (STS) | Status      |
| -------------- | ---------------------- | -------------------------- | ------------------ | --------- | ----------------- | ----------- |
| **REQ-001**    | SYS-001                | Source Fetcher             | STP-001-A          | —         | STS-001-A1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-A          | —         | STS-001-A2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-B          | —         | STS-001-B1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-B          | —         | STS-001-B2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-C          | —         | STS-001-C1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-C          | —         | STS-001-C2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D3        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D4        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D5        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-E          | —         | STS-001-E1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-E          | —         | STS-001-E2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-F          | —         | STS-001-F1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-F          | —         | STS-001-F2        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A2        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A3        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A4        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-B          | —         | STS-002-B1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-C          | —         | STS-002-C1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-C          | —         | STS-002-C2        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-D          | —         | STS-002-D1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-E          | —         | STS-002-E1        | ⬜ Untested |
| **REQ-002**    | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A2        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A3        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A4        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-B          | —         | STS-002-B1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-C          | —         | STS-002-C1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-C          | —         | STS-002-C2        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-D          | —         | STS-002-D1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-E          | —         | STS-002-E1        | ⬜ Untested |
| **REQ-003**    | SYS-009                | Deduplication Guard        | STP-009-A          | —         | STS-009-A1        | ⬜ Untested |
|                | SYS-009                | Deduplication Guard        | STP-009-A          | —         | STS-009-A2        | ⬜ Untested |
|                | SYS-009                | Deduplication Guard        | STP-009-B          | —         | STS-009-B1        | ⬜ Untested |
|                | SYS-009                | Deduplication Guard        | STP-009-B          | —         | STS-009-B2        | ⬜ Untested |
| **REQ-004**    | SYS-009                | Deduplication Guard        | STP-009-A          | —         | STS-009-A1        | ⬜ Untested |
|                | SYS-009                | Deduplication Guard        | STP-009-A          | —         | STS-009-A2        | ⬜ Untested |
|                | SYS-009                | Deduplication Guard        | STP-009-B          | —         | STS-009-B1        | ⬜ Untested |
|                | SYS-009                | Deduplication Guard        | STP-009-B          | —         | STS-009-B2        | ⬜ Untested |
| **REQ-005**    | SYS-003                | Instagram oEmbed Adapter   | STP-003-A          | —         | STS-003-A1        | ⬜ Untested |
|                | SYS-003                | Instagram oEmbed Adapter   | STP-003-B          | —         | STS-003-B1        | ⬜ Untested |
|                | SYS-003                | Instagram oEmbed Adapter   | STP-003-B          | —         | STS-003-B2        | ⬜ Untested |
|                | SYS-003                | Instagram oEmbed Adapter   | STP-003-C          | —         | STS-003-C1        | ⬜ Untested |
|                | SYS-003                | Instagram oEmbed Adapter   | STP-003-C          | —         | STS-003-C2        | ⬜ Untested |
| **REQ-006**    | SYS-005                | File Parser                | STP-005-A          | —         | STS-005-A1        | ⬜ Untested |
|                | SYS-005                | File Parser                | STP-005-B          | —         | STS-005-B1        | ⬜ Untested |
|                | SYS-005                | File Parser                | STP-005-B          | —         | STS-005-B2        | ⬜ Untested |
|                | SYS-005                | File Parser                | STP-005-B          | —         | STS-005-B3        | ⬜ Untested |
| **REQ-007**    | SYS-004                | OCR Pipeline               | STP-004-A          | —         | STS-004-A1        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-A          | —         | STS-004-A2        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-B          | —         | STS-004-B1        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-B          | —         | STS-004-B2        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-C          | —         | STS-004-C1        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-D          | —         | STS-004-D1        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-D          | —         | STS-004-D2        | ⬜ Untested |
| **REQ-008**    | SYS-006                | Normalizer                 | STP-006-A          | —         | STS-006-A1        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-A          | —         | STS-006-A2        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-B          | —         | STS-006-B1        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-B          | —         | STS-006-B2        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-C          | —         | STS-006-C1        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-D          | —         | STS-006-D1        | ⬜ Untested |
| **REQ-009**    | SYS-006                | Normalizer                 | STP-006-A          | —         | STS-006-A1        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-A          | —         | STS-006-A2        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-B          | —         | STS-006-B1        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-B          | —         | STS-006-B2        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-C          | —         | STS-006-C1        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-D          | —         | STS-006-D1        | ⬜ Untested |
| **REQ-010**    | SYS-012                | Draft Confirmation Bridge  | STP-012-A          | —         | STS-012-A1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-A          | —         | STS-012-A2        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-B          | —         | STS-012-B1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-C          | —         | STS-012-C1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-D          | —         | STS-012-D1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-E          | —         | STS-012-E1        | ⬜ Untested |
| **REQ-011**    | SYS-006                | Normalizer                 | STP-006-A          | —         | STS-006-A1        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-A          | —         | STS-006-A2        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-B          | —         | STS-006-B1        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-B          | —         | STS-006-B2        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-C          | —         | STS-006-C1        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-D          | —         | STS-006-D1        | ⬜ Untested |
| **REQ-012**    | SYS-006                | Normalizer                 | STP-006-A          | —         | STS-006-A1        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-A          | —         | STS-006-A2        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-B          | —         | STS-006-B1        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-B          | —         | STS-006-B2        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-C          | —         | STS-006-C1        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-D          | —         | STS-006-D1        | ⬜ Untested |
| **REQ-013**    | SYS-012                | Draft Confirmation Bridge  | STP-012-A          | —         | STS-012-A1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-A          | —         | STS-012-A2        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-B          | —         | STS-012-B1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-C          | —         | STS-012-C1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-D          | —         | STS-012-D1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-E          | —         | STS-012-E1        | ⬜ Untested |
| **REQ-014**    | SYS-007                | Provenance Classifier      | STP-007-A          | —         | STS-007-A1        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-B          | —         | STS-007-B1        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-B          | —         | STS-007-B2        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-C          | —         | STS-007-C1        | ⬜ Untested |
| **REQ-015**    | SYS-012                | Draft Confirmation Bridge  | STP-012-A          | —         | STS-012-A1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-A          | —         | STS-012-A2        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-B          | —         | STS-012-B1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-C          | —         | STS-012-C1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-D          | —         | STS-012-D1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-E          | —         | STS-012-E1        | ⬜ Untested |
| **REQ-016**    | SYS-013                | Import UI                  | STP-013-A          | —         | STS-013-A1        | ⬜ Untested |
|                | SYS-013                | Import UI                  | STP-013-A          | —         | STS-013-A2        | ⬜ Untested |
|                | SYS-013                | Import UI                  | STP-013-B          | —         | STS-013-B1        | ⬜ Untested |
| **REQ-017**    | SYS-008                | Paywall Blocklist          | STP-008-A          | —         | STS-008-A1        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-A          | —         | STS-008-A2        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-A          | —         | STS-008-A3        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-B          | —         | STS-008-B1        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-B          | —         | STS-008-B2        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-C          | —         | STS-008-C1        | ⬜ Untested |
| **REQ-018**    | SYS-001                | Source Fetcher             | STP-001-A          | —         | STS-001-A1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-A          | —         | STS-001-A2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-B          | —         | STS-001-B1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-B          | —         | STS-001-B2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-C          | —         | STS-001-C1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-C          | —         | STS-001-C2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D3        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D4        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D5        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-E          | —         | STS-001-E1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-E          | —         | STS-001-E2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-F          | —         | STS-001-F1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-F          | —         | STS-001-F2        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-A          | —         | STS-008-A1        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-A          | —         | STS-008-A2        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-A          | —         | STS-008-A3        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-B          | —         | STS-008-B1        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-B          | —         | STS-008-B2        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-C          | —         | STS-008-C1        | ⬜ Untested |
| **REQ-019**    | SYS-008                | Paywall Blocklist          | STP-008-A          | —         | STS-008-A1        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-A          | —         | STS-008-A2        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-A          | —         | STS-008-A3        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-B          | —         | STS-008-B1        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-B          | —         | STS-008-B2        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-C          | —         | STS-008-C1        | ⬜ Untested |
| **REQ-020**    | SYS-008                | Paywall Blocklist          | STP-008-A          | —         | STS-008-A1        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-A          | —         | STS-008-A2        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-A          | —         | STS-008-A3        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-B          | —         | STS-008-B1        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-B          | —         | STS-008-B2        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-C          | —         | STS-008-C1        | ⬜ Untested |
| **REQ-021**    | SYS-007                | Provenance Classifier      | STP-007-A          | —         | STS-007-A1        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-B          | —         | STS-007-B1        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-B          | —         | STS-007-B2        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-C          | —         | STS-007-C1        | ⬜ Untested |
| **REQ-022**    | SYS-007                | Provenance Classifier      | STP-007-A          | —         | STS-007-A1        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-B          | —         | STS-007-B1        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-B          | —         | STS-007-B2        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-C          | —         | STS-007-C1        | ⬜ Untested |
| **REQ-023**    | SYS-007                | Provenance Classifier      | STP-007-A          | —         | STS-007-A1        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-B          | —         | STS-007-B1        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-B          | —         | STS-007-B2        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-C          | —         | STS-007-C1        | ⬜ Untested |
| **REQ-024**    | SYS-001                | Source Fetcher             | STP-001-A          | —         | STS-001-A1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-A          | —         | STS-001-A2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-B          | —         | STS-001-B1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-B          | —         | STS-001-B2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-C          | —         | STS-001-C1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-C          | —         | STS-001-C2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D3        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D4        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D5        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-E          | —         | STS-001-E1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-E          | —         | STS-001-E2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-F          | —         | STS-001-F1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-F          | —         | STS-001-F2        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-A          | —         | STS-011-A1        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-A          | —         | STS-011-A2        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-B          | —         | STS-011-B1        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-B          | —         | STS-011-B2        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-C          | —         | STS-011-C1        | ⬜ Untested |
| **REQ-025**    | SYS-013                | Import UI                  | STP-013-A          | —         | STS-013-A1        | ⬜ Untested |
|                | SYS-013                | Import UI                  | STP-013-A          | —         | STS-013-A2        | ⬜ Untested |
|                | SYS-013                | Import UI                  | STP-013-B          | —         | STS-013-B1        | ⬜ Untested |
| **REQ-026**    | SYS-004                | OCR Pipeline               | STP-004-A          | —         | STS-004-A1        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-A          | —         | STS-004-A2        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-B          | —         | STS-004-B1        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-B          | —         | STS-004-B2        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-C          | —         | STS-004-C1        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-D          | —         | STS-004-D1        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-D          | —         | STS-004-D2        | ⬜ Untested |
| **REQ-027**    | SYS-010                | Import Draft Store         | STP-010-A          | —         | STS-010-A1        | ⬜ Untested |
|                | SYS-010                | Import Draft Store         | STP-010-A          | —         | STS-010-A2        | ⬜ Untested |
|                | SYS-010                | Import Draft Store         | STP-010-B          | —         | STS-010-B1        | ⬜ Untested |
|                | SYS-010                | Import Draft Store         | STP-010-C          | —         | STS-010-C1        | ⬜ Untested |
|                | SYS-010                | Import Draft Store         | STP-010-C          | —         | STS-010-C2        | ⬜ Untested |
|                | SYS-010                | Import Draft Store         | STP-010-C          | —         | STS-010-C3        | ⬜ Untested |
|                | SYS-010                | Import Draft Store         | STP-010-D          | —         | STS-010-D1        | ⬜ Untested |
| **REQ-028**    | SYS-011                | Import Job Orchestrator    | STP-011-A          | —         | STS-011-A1        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-A          | —         | STS-011-A2        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-B          | —         | STS-011-B1        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-B          | —         | STS-011-B2        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-C          | —         | STS-011-C1        | ⬜ Untested |
| **REQ-029**    | SYS-011                | Import Job Orchestrator    | STP-011-A          | —         | STS-011-A1        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-A          | —         | STS-011-A2        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-B          | —         | STS-011-B1        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-B          | —         | STS-011-B2        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-C          | —         | STS-011-C1        | ⬜ Untested |
| **REQ-030**    | SYS-001                | Source Fetcher             | STP-001-A          | —         | STS-001-A1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-A          | —         | STS-001-A2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-B          | —         | STS-001-B1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-B          | —         | STS-001-B2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-C          | —         | STS-001-C1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-C          | —         | STS-001-C2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D3        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D4        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D5        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-E          | —         | STS-001-E1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-E          | —         | STS-001-E2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-F          | —         | STS-001-F1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-F          | —         | STS-001-F2        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-A          | —         | STS-008-A1        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-A          | —         | STS-008-A2        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-A          | —         | STS-008-A3        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-B          | —         | STS-008-B1        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-B          | —         | STS-008-B2        | ⬜ Untested |
|                | SYS-008                | Paywall Blocklist          | STP-008-C          | —         | STS-008-C1        | ⬜ Untested |
| **REQ-031**    | SYS-007                | Provenance Classifier      | STP-007-A          | —         | STS-007-A1        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-B          | —         | STS-007-B1        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-B          | —         | STS-007-B2        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-C          | —         | STS-007-C1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-A          | —         | STS-012-A1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-A          | —         | STS-012-A2        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-B          | —         | STS-012-B1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-C          | —         | STS-012-C1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-D          | —         | STS-012-D1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-E          | —         | STS-012-E1        | ⬜ Untested |
| **REQ-032**    | SYS-007                | Provenance Classifier      | STP-007-A          | —         | STS-007-A1        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-B          | —         | STS-007-B1        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-B          | —         | STS-007-B2        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-C          | —         | STS-007-C1        | ⬜ Untested |
| **REQ-033**    | SYS-005                | File Parser                | STP-005-A          | —         | STS-005-A1        | ⬜ Untested |
|                | SYS-005                | File Parser                | STP-005-B          | —         | STS-005-B1        | ⬜ Untested |
|                | SYS-005                | File Parser                | STP-005-B          | —         | STS-005-B2        | ⬜ Untested |
|                | SYS-005                | File Parser                | STP-005-B          | —         | STS-005-B3        | ⬜ Untested |
|                | SYS-009                | Deduplication Guard        | STP-009-A          | —         | STS-009-A1        | ⬜ Untested |
|                | SYS-009                | Deduplication Guard        | STP-009-A          | —         | STS-009-A2        | ⬜ Untested |
|                | SYS-009                | Deduplication Guard        | STP-009-B          | —         | STS-009-B1        | ⬜ Untested |
|                | SYS-009                | Deduplication Guard        | STP-009-B          | —         | STS-009-B2        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-A          | —         | STS-012-A1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-A          | —         | STS-012-A2        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-B          | —         | STS-012-B1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-C          | —         | STS-012-C1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-D          | —         | STS-012-D1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-E          | —         | STS-012-E1        | ⬜ Untested |
| **REQ-034**    | SYS-009                | Deduplication Guard        | STP-009-A          | —         | STS-009-A1        | ⬜ Untested |
|                | SYS-009                | Deduplication Guard        | STP-009-A          | —         | STS-009-A2        | ⬜ Untested |
|                | SYS-009                | Deduplication Guard        | STP-009-B          | —         | STS-009-B1        | ⬜ Untested |
|                | SYS-009                | Deduplication Guard        | STP-009-B          | —         | STS-009-B2        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-A          | —         | STS-012-A1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-A          | —         | STS-012-A2        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-B          | —         | STS-012-B1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-C          | —         | STS-012-C1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-D          | —         | STS-012-D1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-E          | —         | STS-012-E1        | ⬜ Untested |
| **REQ-035**    | SYS-004                | OCR Pipeline               | STP-004-A          | —         | STS-004-A1        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-A          | —         | STS-004-A2        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-B          | —         | STS-004-B1        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-B          | —         | STS-004-B2        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-C          | —         | STS-004-C1        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-D          | —         | STS-004-D1        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-D          | —         | STS-004-D2        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-A          | —         | STS-007-A1        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-B          | —         | STS-007-B1        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-B          | —         | STS-007-B2        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-C          | —         | STS-007-C1        | ⬜ Untested |
| **REQ-CN-001** | SYS-009                | Deduplication Guard        | STP-009-A          | —         | STS-009-A1        | ⬜ Untested |
|                | SYS-009                | Deduplication Guard        | STP-009-A          | —         | STS-009-A2        | ⬜ Untested |
|                | SYS-009                | Deduplication Guard        | STP-009-B          | —         | STS-009-B1        | ⬜ Untested |
|                | SYS-009                | Deduplication Guard        | STP-009-B          | —         | STS-009-B2        | ⬜ Untested |
| **REQ-CN-002** | SYS-009                | Deduplication Guard        | STP-009-A          | —         | STS-009-A1        | ⬜ Untested |
|                | SYS-009                | Deduplication Guard        | STP-009-A          | —         | STS-009-A2        | ⬜ Untested |
|                | SYS-009                | Deduplication Guard        | STP-009-B          | —         | STS-009-B1        | ⬜ Untested |
|                | SYS-009                | Deduplication Guard        | STP-009-B          | —         | STS-009-B2        | ⬜ Untested |
| **REQ-CN-003** | SYS-007                | Provenance Classifier      | STP-007-A          | —         | STS-007-A1        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-B          | —         | STS-007-B1        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-B          | —         | STS-007-B2        | ⬜ Untested |
|                | SYS-007                | Provenance Classifier      | STP-007-C          | —         | STS-007-C1        | ⬜ Untested |
| **REQ-CN-004** | SYS-003                | Instagram oEmbed Adapter   | STP-003-A          | —         | STS-003-A1        | ⬜ Untested |
|                | SYS-003                | Instagram oEmbed Adapter   | STP-003-B          | —         | STS-003-B1        | ⬜ Untested |
|                | SYS-003                | Instagram oEmbed Adapter   | STP-003-B          | —         | STS-003-B2        | ⬜ Untested |
|                | SYS-003                | Instagram oEmbed Adapter   | STP-003-C          | —         | STS-003-C1        | ⬜ Untested |
|                | SYS-003                | Instagram oEmbed Adapter   | STP-003-C          | —         | STS-003-C2        | ⬜ Untested |
| **REQ-CN-005** | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A2        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A3        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A4        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-B          | —         | STS-002-B1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-C          | —         | STS-002-C1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-C          | —         | STS-002-C2        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-D          | —         | STS-002-D1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-E          | —         | STS-002-E1        | ⬜ Untested |
| **REQ-CN-006** | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A2        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A3        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A4        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-B          | —         | STS-002-B1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-C          | —         | STS-002-C1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-C          | —         | STS-002-C2        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-D          | —         | STS-002-D1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-E          | —         | STS-002-E1        | ⬜ Untested |
| **REQ-CN-007** | SYS-012                | Draft Confirmation Bridge  | STP-012-A          | —         | STS-012-A1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-A          | —         | STS-012-A2        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-B          | —         | STS-012-B1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-C          | —         | STS-012-C1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-D          | —         | STS-012-D1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-E          | —         | STS-012-E1        | ⬜ Untested |
| **REQ-CN-008** | SYS-013                | Import UI                  | STP-013-A          | —         | STS-013-A1        | ⬜ Untested |
|                | SYS-013                | Import UI                  | STP-013-A          | —         | STS-013-A2        | ⬜ Untested |
|                | SYS-013                | Import UI                  | STP-013-B          | —         | STS-013-B1        | ⬜ Untested |
| **REQ-CN-009** | SYS-015                | Contract & Quality Gates   | STP-015-A          | —         | STS-015-A1        | ⬜ Untested |
| **REQ-IF-001** | SYS-003                | Instagram oEmbed Adapter   | STP-003-A          | —         | STS-003-A1        | ⬜ Untested |
|                | SYS-003                | Instagram oEmbed Adapter   | STP-003-B          | —         | STS-003-B1        | ⬜ Untested |
|                | SYS-003                | Instagram oEmbed Adapter   | STP-003-B          | —         | STS-003-B2        | ⬜ Untested |
|                | SYS-003                | Instagram oEmbed Adapter   | STP-003-C          | —         | STS-003-C1        | ⬜ Untested |
|                | SYS-003                | Instagram oEmbed Adapter   | STP-003-C          | —         | STS-003-C2        | ⬜ Untested |
| **REQ-IF-002** | SYS-004                | OCR Pipeline               | STP-004-A          | —         | STS-004-A1        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-A          | —         | STS-004-A2        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-B          | —         | STS-004-B1        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-B          | —         | STS-004-B2        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-C          | —         | STS-004-C1        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-D          | —         | STS-004-D1        | ⬜ Untested |
|                | SYS-004                | OCR Pipeline               | STP-004-D          | —         | STS-004-D2        | ⬜ Untested |
| **REQ-IF-003** | SYS-012                | Draft Confirmation Bridge  | STP-012-A          | —         | STS-012-A1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-A          | —         | STS-012-A2        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-B          | —         | STS-012-B1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-C          | —         | STS-012-C1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-D          | —         | STS-012-D1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-E          | —         | STS-012-E1        | ⬜ Untested |
| **REQ-IF-004** | SYS-014                | Auth Enforcement (shipped) | STP-014-A          | —         | STS-014-A1        | ⬜ Untested |
| **REQ-IF-005** | SYS-012                | Draft Confirmation Bridge  | STP-012-A          | —         | STS-012-A1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-A          | —         | STS-012-A2        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-B          | —         | STS-012-B1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-C          | —         | STS-012-C1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-D          | —         | STS-012-D1        | ⬜ Untested |
|                | SYS-012                | Draft Confirmation Bridge  | STP-012-E          | —         | STS-012-E1        | ⬜ Untested |
| **REQ-IF-006** | SYS-015                | Contract & Quality Gates   | STP-015-A          | —         | STS-015-A1        | ⬜ Untested |
| **REQ-NF-001** | SYS-015                | Contract & Quality Gates   | STP-015-A          | —         | STS-015-A1        | ⬜ Untested |
| **REQ-NF-002** | SYS-015                | Contract & Quality Gates   | STP-015-A          | —         | STS-015-A1        | ⬜ Untested |
| **REQ-NF-003** | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A2        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A3        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-A          | —         | STS-002-A4        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-B          | —         | STS-002-B1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-C          | —         | STS-002-C1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-C          | —         | STS-002-C2        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-D          | —         | STS-002-D1        | ⬜ Untested |
|                | SYS-002                | Extractor Chain            | STP-002-E          | —         | STS-002-E1        | ⬜ Untested |
| **REQ-NF-004** | SYS-013                | Import UI                  | STP-013-A          | —         | STS-013-A1        | ⬜ Untested |
|                | SYS-013                | Import UI                  | STP-013-A          | —         | STS-013-A2        | ⬜ Untested |
|                | SYS-013                | Import UI                  | STP-013-B          | —         | STS-013-B1        | ⬜ Untested |
| **REQ-NF-005** | SYS-013                | Import UI                  | STP-013-A          | —         | STS-013-A1        | ⬜ Untested |
|                | SYS-013                | Import UI                  | STP-013-A          | —         | STS-013-A2        | ⬜ Untested |
|                | SYS-013                | Import UI                  | STP-013-B          | —         | STS-013-B1        | ⬜ Untested |
| **REQ-NF-006** | SYS-013                | Import UI                  | STP-013-A          | —         | STS-013-A1        | ⬜ Untested |
|                | SYS-013                | Import UI                  | STP-013-A          | —         | STS-013-A2        | ⬜ Untested |
|                | SYS-013                | Import UI                  | STP-013-B          | —         | STS-013-B1        | ⬜ Untested |
| **REQ-NF-007** | SYS-001                | Source Fetcher             | STP-001-A          | —         | STS-001-A1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-A          | —         | STS-001-A2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-B          | —         | STS-001-B1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-B          | —         | STS-001-B2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-C          | —         | STS-001-C1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-C          | —         | STS-001-C2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D3        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D4        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D5        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-E          | —         | STS-001-E1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-E          | —         | STS-001-E2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-F          | —         | STS-001-F1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-F          | —         | STS-001-F2        | ⬜ Untested |
| **REQ-NF-008** | SYS-001                | Source Fetcher             | STP-001-A          | —         | STS-001-A1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-A          | —         | STS-001-A2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-B          | —         | STS-001-B1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-B          | —         | STS-001-B2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-C          | —         | STS-001-C1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-C          | —         | STS-001-C2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D3        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D4        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D5        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-E          | —         | STS-001-E1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-E          | —         | STS-001-E2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-F          | —         | STS-001-F1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-F          | —         | STS-001-F2        | ⬜ Untested |
| **REQ-NF-009** | SYS-001                | Source Fetcher             | STP-001-A          | —         | STS-001-A1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-A          | —         | STS-001-A2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-B          | —         | STS-001-B1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-B          | —         | STS-001-B2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-C          | —         | STS-001-C1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-C          | —         | STS-001-C2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D3        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D4        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-D          | —         | STS-001-D5        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-E          | —         | STS-001-E1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-E          | —         | STS-001-E2        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-F          | —         | STS-001-F1        | ⬜ Untested |
|                | SYS-001                | Source Fetcher             | STP-001-F          | —         | STS-001-F2        | ⬜ Untested |
| **REQ-NF-010** | SYS-006                | Normalizer                 | STP-006-A          | —         | STS-006-A1        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-A          | —         | STS-006-A2        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-B          | —         | STS-006-B1        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-B          | —         | STS-006-B2        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-C          | —         | STS-006-C1        | ⬜ Untested |
|                | SYS-006                | Normalizer                 | STP-006-D          | —         | STS-006-D1        | ⬜ Untested |
| **REQ-NF-011** | SYS-011                | Import Job Orchestrator    | STP-011-A          | —         | STS-011-A1        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-A          | —         | STS-011-A2        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-B          | —         | STS-011-B1        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-B          | —         | STS-011-B2        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-C          | —         | STS-011-C1        | ⬜ Untested |
| **REQ-NF-012** | SYS-011                | Import Job Orchestrator    | STP-011-A          | —         | STS-011-A1        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-A          | —         | STS-011-A2        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-B          | —         | STS-011-B1        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-B          | —         | STS-011-B2        | ⬜ Untested |
|                | SYS-011                | Import Job Orchestrator    | STP-011-C          | —         | STS-011-C1        | ⬜ Untested |
| **REQ-NF-013** | SYS-015                | Contract & Quality Gates   | STP-015-A          | —         | STS-015-A1        | ⬜ Untested |

### Matrix B Coverage

| Metric                            | Value        |
| --------------------------------- | ------------ |
| **Total System Components (SYS)** | 15           |
| **Total System Test Cases (STP)** | 48           |
| **Total System Scenarios (STS)**  | 83           |
| **REQ → SYS Coverage**            | 63/63 (100%) |
| **SYS → STP Coverage**            | 15/15 (100%) |

## Matrix C — Integration Verification (Module Boundary View)

| System Component (SYS)                                                                             | Parent REQs                                                                              | Architecture Module (ARCH) | Module Name                   | Test Case ID (ITP) | Technique | Scenario ID (ITS) | Status      |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------- | ----------------------------- | ------------------ | --------- | ----------------- | ----------- |
| SYS-001 (REQ-001, REQ-018, REQ-024, REQ-NF-007, REQ-NF-008, REQ-NF-009, REQ-030)                   | REQ-001, REQ-018, REQ-024, REQ-NF-007, REQ-NF-008, REQ-NF-009, REQ-030                   | ARCH-005                   | SourceFetcherService          | ITP-005-A          | —         | ITS-005-A1        | ⬜ Untested |
| SYS-001 (REQ-001, REQ-018, REQ-024, REQ-NF-007, REQ-NF-008, REQ-NF-009, REQ-030)                   | REQ-001, REQ-018, REQ-024, REQ-NF-007, REQ-NF-008, REQ-NF-009, REQ-030                   | ARCH-005                   | SourceFetcherService          | ITP-005-A          | —         | ITS-005-A2        | ⬜ Untested |
| SYS-001 (REQ-001, REQ-018, REQ-024, REQ-NF-007, REQ-NF-008, REQ-NF-009, REQ-030)                   | REQ-001, REQ-018, REQ-024, REQ-NF-007, REQ-NF-008, REQ-NF-009, REQ-030                   | ARCH-005                   | SourceFetcherService          | ITP-005-B          | —         | ITS-005-B1        | ⬜ Untested |
| SYS-001 (REQ-001, REQ-018, REQ-024, REQ-NF-007, REQ-NF-008, REQ-NF-009, REQ-030)                   | REQ-001, REQ-018, REQ-024, REQ-NF-007, REQ-NF-008, REQ-NF-009, REQ-030                   | ARCH-005                   | SourceFetcherService          | ITP-005-B          | —         | ITS-005-B2        | ⬜ Untested |
| SYS-001 (REQ-001, REQ-018, REQ-024, REQ-NF-007, REQ-NF-008, REQ-NF-009, REQ-030)                   | REQ-001, REQ-018, REQ-024, REQ-NF-007, REQ-NF-008, REQ-NF-009, REQ-030                   | ARCH-006                   | SsrfGuard                     | ITP-006-A          | —         | ITS-006-A1        | ⬜ Untested |
| SYS-001 (REQ-001, REQ-018, REQ-024, REQ-NF-007, REQ-NF-008, REQ-NF-009, REQ-030)                   | REQ-001, REQ-018, REQ-024, REQ-NF-007, REQ-NF-008, REQ-NF-009, REQ-030                   | ARCH-006                   | SsrfGuard                     | ITP-006-B          | —         | ITS-006-B1        | ⬜ Untested |
| SYS-001 (REQ-001, REQ-018, REQ-024, REQ-NF-007, REQ-NF-008, REQ-NF-009, REQ-030)                   | REQ-001, REQ-018, REQ-024, REQ-NF-007, REQ-NF-008, REQ-NF-009, REQ-030                   | ARCH-006                   | SsrfGuard                     | ITP-006-B          | —         | ITS-006-B2        | ⬜ Untested |
| SYS-001 (REQ-001, REQ-018, REQ-024, REQ-NF-007, REQ-NF-008, REQ-NF-009, REQ-030)                   | REQ-001, REQ-018, REQ-024, REQ-NF-007, REQ-NF-008, REQ-NF-009, REQ-030                   | ARCH-006                   | SsrfGuard                     | ITP-006-C          | —         | ITS-006-C1        | ⬜ Untested |
| SYS-002 (REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006)                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | ARCH-008                   | JsonLdExtractor               | ITP-008-A          | —         | ITS-008-A1        | ⬜ Untested |
| SYS-002 (REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006)                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | ARCH-008                   | JsonLdExtractor               | ITP-008-A          | —         | ITS-008-A2        | ⬜ Untested |
| SYS-002 (REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006)                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | ARCH-008                   | JsonLdExtractor               | ITP-008-B          | —         | ITS-008-B1        | ⬜ Untested |
| SYS-002 (REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006)                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | ARCH-008                   | JsonLdExtractor               | ITP-008-C          | —         | ITS-008-C1        | ⬜ Untested |
| SYS-002 (REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006)                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | ARCH-008                   | JsonLdExtractor               | ITP-008-C          | —         | ITS-008-C2        | ⬜ Untested |
| SYS-002 (REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006)                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | ARCH-009                   | MicrodataExtractor            | ITP-009-A          | —         | ITS-009-A1        | ⬜ Untested |
| SYS-002 (REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006)                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | ARCH-009                   | MicrodataExtractor            | ITP-009-A          | —         | ITS-009-A2        | ⬜ Untested |
| SYS-002 (REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006)                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | ARCH-009                   | MicrodataExtractor            | ITP-009-B          | —         | ITS-009-B1        | ⬜ Untested |
| SYS-002 (REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006)                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | ARCH-009                   | MicrodataExtractor            | ITP-009-C          | —         | ITS-009-C1        | ⬜ Untested |
| SYS-002 (REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006)                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | ARCH-009                   | MicrodataExtractor            | ITP-009-C          | —         | ITS-009-C2        | ⬜ Untested |
| SYS-002 (REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006)                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | ARCH-010                   | HeuristicExtractor            | ITP-010-A          | —         | ITS-010-A1        | ⬜ Untested |
| SYS-002 (REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006)                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | ARCH-010                   | HeuristicExtractor            | ITP-010-A          | —         | ITS-010-A2        | ⬜ Untested |
| SYS-002 (REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006)                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | ARCH-010                   | HeuristicExtractor            | ITP-010-B          | —         | ITS-010-B1        | ⬜ Untested |
| SYS-002 (REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006)                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | ARCH-010                   | HeuristicExtractor            | ITP-010-C          | —         | ITS-010-C1        | ⬜ Untested |
| SYS-002 (REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006)                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | ARCH-010                   | HeuristicExtractor            | ITP-010-C          | —         | ITS-010-C2        | ⬜ Untested |
| SYS-002 (REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006)                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | ARCH-011                   | ExtractorChainService         | ITP-011-A          | —         | ITS-011-A1        | ⬜ Untested |
| SYS-002 (REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006)                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | ARCH-011                   | ExtractorChainService         | ITP-011-B          | —         | ITS-011-B1        | ⬜ Untested |
| SYS-002 (REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006)                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | ARCH-011                   | ExtractorChainService         | ITP-011-C          | —         | ITS-011-C1        | ⬜ Untested |
| SYS-002 (REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006)                                     | REQ-001, REQ-002, REQ-NF-003, REQ-CN-005, REQ-CN-006                                     | ARCH-011                   | ExtractorChainService         | ITP-011-D          | —         | ITS-011-D1        | ⬜ Untested |
| SYS-003 (REQ-005, REQ-IF-001, REQ-CN-004)                                                          | REQ-005, REQ-IF-001, REQ-CN-004                                                          | ARCH-012                   | OEmbedProvider (port)         | ITP-012-A          | —         | ITS-012-A1        | ⬜ Untested |
| SYS-003 (REQ-005, REQ-IF-001, REQ-CN-004)                                                          | REQ-005, REQ-IF-001, REQ-CN-004                                                          | ARCH-012                   | OEmbedProvider (port)         | ITP-012-A          | —         | ITS-012-A2        | ⬜ Untested |
| SYS-003 (REQ-005, REQ-IF-001, REQ-CN-004)                                                          | REQ-005, REQ-IF-001, REQ-CN-004                                                          | ARCH-012                   | OEmbedProvider (port)         | ITP-012-B          | —         | ITS-012-B1        | ⬜ Untested |
| SYS-003 (REQ-005, REQ-IF-001, REQ-CN-004)                                                          | REQ-005, REQ-IF-001, REQ-CN-004                                                          | ARCH-012                   | OEmbedProvider (port)         | ITP-012-B          | —         | ITS-012-B2        | ⬜ Untested |
| SYS-003 (REQ-005, REQ-IF-001, REQ-CN-004)                                                          | REQ-005, REQ-IF-001, REQ-CN-004                                                          | ARCH-012                   | OEmbedProvider (port)         | ITP-012-C          | —         | ITS-012-C1        | ⬜ Untested |
| SYS-003 (REQ-005, REQ-IF-001, REQ-CN-004)                                                          | REQ-005, REQ-IF-001, REQ-CN-004                                                          | ARCH-012                   | OEmbedProvider (port)         | ITP-012-D          | —         | ITS-012-D1        | ⬜ Untested |
| SYS-003 (REQ-005, REQ-IF-001, REQ-CN-004)                                                          | REQ-005, REQ-IF-001, REQ-CN-004                                                          | ARCH-013                   | InstagramOEmbedAdapter        | ITP-013-A          | —         | ITS-013-A1        | ⬜ Untested |
| SYS-003 (REQ-005, REQ-IF-001, REQ-CN-004)                                                          | REQ-005, REQ-IF-001, REQ-CN-004                                                          | ARCH-013                   | InstagramOEmbedAdapter        | ITP-013-B          | —         | ITS-013-B1        | ⬜ Untested |
| SYS-003 (REQ-005, REQ-IF-001, REQ-CN-004)                                                          | REQ-005, REQ-IF-001, REQ-CN-004                                                          | ARCH-013                   | InstagramOEmbedAdapter        | ITP-013-B          | —         | ITS-013-B2        | ⬜ Untested |
| SYS-004 (REQ-007, REQ-026, REQ-IF-002, REQ-035)                                                    | REQ-007, REQ-026, REQ-IF-002, REQ-035                                                    | ARCH-014                   | OcrProvider (port)            | ITP-014-A          | —         | ITS-014-A1        | ⬜ Untested |
| SYS-004 (REQ-007, REQ-026, REQ-IF-002, REQ-035)                                                    | REQ-007, REQ-026, REQ-IF-002, REQ-035                                                    | ARCH-014                   | OcrProvider (port)            | ITP-014-A          | —         | ITS-014-A2        | ⬜ Untested |
| SYS-004 (REQ-007, REQ-026, REQ-IF-002, REQ-035)                                                    | REQ-007, REQ-026, REQ-IF-002, REQ-035                                                    | ARCH-014                   | OcrProvider (port)            | ITP-014-B          | —         | ITS-014-B1        | ⬜ Untested |
| SYS-004 (REQ-007, REQ-026, REQ-IF-002, REQ-035)                                                    | REQ-007, REQ-026, REQ-IF-002, REQ-035                                                    | ARCH-014                   | OcrProvider (port)            | ITP-014-C          | —         | ITS-014-C1        | ⬜ Untested |
| SYS-004 (REQ-007, REQ-026, REQ-IF-002, REQ-035)                                                    | REQ-007, REQ-026, REQ-IF-002, REQ-035                                                    | ARCH-015                   | TextractAdapter               | ITP-015-A          | —         | ITS-015-A1        | ⬜ Untested |
| SYS-004 (REQ-007, REQ-026, REQ-IF-002, REQ-035)                                                    | REQ-007, REQ-026, REQ-IF-002, REQ-035                                                    | ARCH-015                   | TextractAdapter               | ITP-015-A          | —         | ITS-015-A2        | ⬜ Untested |
| SYS-004 (REQ-007, REQ-026, REQ-IF-002, REQ-035)                                                    | REQ-007, REQ-026, REQ-IF-002, REQ-035                                                    | ARCH-015                   | TextractAdapter               | ITP-015-B          | —         | ITS-015-B1        | ⬜ Untested |
| SYS-004 (REQ-007, REQ-026, REQ-IF-002, REQ-035)                                                    | REQ-007, REQ-026, REQ-IF-002, REQ-035                                                    | ARCH-016                   | OcrPipelineService            | ITP-016-A          | —         | ITS-016-A1        | ⬜ Untested |
| SYS-004 (REQ-007, REQ-026, REQ-IF-002, REQ-035)                                                    | REQ-007, REQ-026, REQ-IF-002, REQ-035                                                    | ARCH-016                   | OcrPipelineService            | ITP-016-A          | —         | ITS-016-A2        | ⬜ Untested |
| SYS-004 (REQ-007, REQ-026, REQ-IF-002, REQ-035)                                                    | REQ-007, REQ-026, REQ-IF-002, REQ-035                                                    | ARCH-016                   | OcrPipelineService            | ITP-016-B          | —         | ITS-016-B1        | ⬜ Untested |
| SYS-004 (REQ-007, REQ-026, REQ-IF-002, REQ-035)                                                    | REQ-007, REQ-026, REQ-IF-002, REQ-035                                                    | ARCH-016                   | OcrPipelineService            | ITP-016-C          | —         | ITS-016-C1        | ⬜ Untested |
| SYS-005 (REQ-006, REQ-033)                                                                         | REQ-006, REQ-033                                                                         | ARCH-017                   | FileParserService             | ITP-017-A          | —         | ITS-017-A1        | ⬜ Untested |
| SYS-006 (REQ-008, REQ-009, REQ-011, REQ-012, REQ-NF-010)                                           | REQ-008, REQ-009, REQ-011, REQ-012, REQ-NF-010                                           | ARCH-018                   | NormalizerService             | ITP-018-A          | —         | ITS-018-A1        | ⬜ Untested |
| SYS-006 (REQ-008, REQ-009, REQ-011, REQ-012, REQ-NF-010)                                           | REQ-008, REQ-009, REQ-011, REQ-012, REQ-NF-010                                           | ARCH-019                   | IngredientLineParser          | ITP-019-A          | —         | ITS-019-A1        | ⬜ Untested |
| SYS-006 (REQ-008, REQ-009, REQ-011, REQ-012, REQ-NF-010)                                           | REQ-008, REQ-009, REQ-011, REQ-012, REQ-NF-010                                           | ARCH-020                   | ValueNormalizers              | ITP-020-A          | —         | ITS-020-A1        | ⬜ Untested |
| SYS-006 (REQ-008, REQ-009, REQ-011, REQ-012, REQ-NF-010)                                           | REQ-008, REQ-009, REQ-011, REQ-012, REQ-NF-010                                           | ARCH-021                   | ContentSanitizer              | ITP-021-A          | —         | ITS-021-A1        | ⬜ Untested |
| SYS-007 (REQ-014, REQ-021, REQ-022, REQ-023, REQ-CN-003, REQ-031, REQ-032, REQ-035)                | REQ-014, REQ-021, REQ-022, REQ-023, REQ-CN-003, REQ-031, REQ-032, REQ-035                | ARCH-022                   | ProvenancePolicy              | ITP-022-A          | —         | ITS-022-A1        | ⬜ Untested |
| SYS-008 (REQ-017, REQ-018, REQ-019, REQ-020, REQ-030)                                              | REQ-017, REQ-018, REQ-019, REQ-020, REQ-030                                              | ARCH-023                   | PaywalledDomainsService       | ITP-023-A          | —         | ITS-023-A1        | ⬜ Untested |
| SYS-009 (REQ-003, REQ-004, REQ-CN-001, REQ-CN-002, REQ-033, REQ-034)                               | REQ-003, REQ-004, REQ-CN-001, REQ-CN-002, REQ-033, REQ-034                               | ARCH-024                   | CanonicalSourceUrl            | ITP-024-A          | —         | ITS-024-A1        | ⬜ Untested |
| SYS-010 (expired`), owner-scoped reads, user corrections, and expiry sweeping., REQ-027)           | expired`), owner-scoped reads, user corrections, and expiry sweeping., REQ-027           | ARCH-025                   | ImportDraftsService           | ITP-025-A          | —         | ITS-025-A1        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-001                   | ImportsController             | ITP-001-A          | —         | ITS-001-A1        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-001                   | ImportsController             | ITP-001-A          | —         | ITS-001-A2        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-001                   | ImportsController             | ITP-001-A          | —         | ITS-001-A3        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-001                   | ImportsController             | ITP-001-B          | —         | ITS-001-B1        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-001                   | ImportsController             | ITP-001-B          | —         | ITS-001-B2        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-001                   | ImportsController             | ITP-001-C          | —         | ITS-001-C1        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-002                   | ImportsService                | ITP-002-A          | —         | ITS-002-A1        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-002                   | ImportsService                | ITP-002-A          | —         | ITS-002-A2        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-002                   | ImportsService                | ITP-002-B          | —         | ITS-002-B1        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-002                   | ImportsService                | ITP-002-B          | —         | ITS-002-B2        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-003                   | ImportJobsService             | ITP-003-A          | —         | ITS-003-A1        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-003                   | ImportJobsService             | ITP-003-B          | —         | ITS-003-B1        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-003                   | ImportJobsService             | ITP-003-B          | —         | ITS-003-B2        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-003                   | ImportJobsService             | ITP-003-B          | —         | ITS-003-B3        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-003                   | ImportJobsService             | ITP-003-C          | —         | ITS-003-C1        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-003                   | ImportJobsService             | ITP-003-C          | —         | ITS-003-C2        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-003                   | ImportJobsService             | ITP-003-D          | —         | ITS-003-D1        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-003                   | ImportJobsService             | ITP-003-D          | —         | ITS-003-D2        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-003                   | ImportJobsService             | ITP-003-E          | —         | ITS-003-E1        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-004                   | ImportJobWorker               | ITP-004-A          | —         | ITS-004-A1        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-004                   | ImportJobWorker               | ITP-004-A          | —         | ITS-004-A2        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-004                   | ImportJobWorker               | ITP-004-A          | —         | ITS-004-A3        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-004                   | ImportJobWorker               | ITP-004-B          | —         | ITS-004-B1        | ⬜ Untested |
| SYS-011 (REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011)                                        | REQ-024, REQ-028, REQ-NF-012, REQ-029, REQ-NF-011                                        | ARCH-004                   | ImportJobWorker               | ITP-004-C          | —         | ITS-004-C1        | ⬜ Untested |
| SYS-012 (REQ-010, REQ-013, REQ-015, REQ-IF-003, REQ-IF-005, REQ-CN-007, REQ-031, REQ-033, REQ-034) | REQ-010, REQ-013, REQ-015, REQ-IF-003, REQ-IF-005, REQ-CN-007, REQ-031, REQ-033, REQ-034 | ARCH-026                   | DraftConfirmationService      | ITP-026-A          | —         | ITS-026-A1        | ⬜ Untested |
| SYS-013 (REQ-016, REQ-025, REQ-NF-004, REQ-NF-005, REQ-NF-006, REQ-CN-008)                         | REQ-016, REQ-025, REQ-NF-004, REQ-NF-005, REQ-NF-006, REQ-CN-008                         | ARCH-027                   | ImportEntry                   | ITP-027-A          | —         | ITS-027-A1        | ⬜ Untested |
| SYS-013 (REQ-016, REQ-025, REQ-NF-004, REQ-NF-005, REQ-NF-006, REQ-CN-008)                         | REQ-016, REQ-025, REQ-NF-004, REQ-NF-005, REQ-NF-006, REQ-CN-008                         | ARCH-028                   | ImportProgress                | ITP-028-A          | —         | ITS-028-A1        | ⬜ Untested |
| SYS-013 (REQ-016, REQ-025, REQ-NF-004, REQ-NF-005, REQ-NF-006, REQ-CN-008)                         | REQ-016, REQ-025, REQ-NF-004, REQ-NF-005, REQ-NF-006, REQ-CN-008                         | ARCH-029                   | ImportDraftReview             | ITP-029-A          | —         | ITS-029-A1        | ⬜ Untested |
| SYS-013 (REQ-016, REQ-025, REQ-NF-004, REQ-NF-005, REQ-NF-006, REQ-CN-008)                         | REQ-016, REQ-025, REQ-NF-004, REQ-NF-005, REQ-NF-006, REQ-CN-008                         | ARCH-030                   | RecipeAttribution             | ITP-030-A          | —         | ITS-030-A1        | ⬜ Untested |
| SYS-013 (REQ-016, REQ-025, REQ-NF-004, REQ-NF-005, REQ-NF-006, REQ-CN-008)                         | REQ-016, REQ-025, REQ-NF-004, REQ-NF-005, REQ-NF-006, REQ-CN-008                         | ARCH-031                   | ImportErrorState              | ITP-031-A          | —         | ITS-031-A1        | ⬜ Untested |
| SYS-013 (REQ-016, REQ-025, REQ-NF-004, REQ-NF-005, REQ-NF-006, REQ-CN-008)                         | REQ-016, REQ-025, REQ-NF-004, REQ-NF-005, REQ-NF-006, REQ-CN-008                         | ARCH-032                   | useImportJob / useImportDraft | ITP-032-A          | —         | ITS-032-A1        | ⬜ Untested |
| SYS-014 (REQ-IF-004)                                                                               | REQ-IF-004                                                                               | ARCH-035                   | AuthMiddleware (shipped)      | ITP-035-A          | —         | ITS-035-A1        | ⬜ Untested |
| SYS-015 (REQ-IF-006, REQ-NF-001, REQ-NF-002, REQ-NF-013, REQ-CN-009)                               | REQ-IF-006, REQ-NF-001, REQ-NF-002, REQ-NF-013, REQ-CN-009                               | ARCH-036                   | CiQualityGates                | ITP-036-A          | —         | ITS-036-A1        | ⬜ Untested |
| N/A (Cross-Cutting)                                                                                | —                                                                                        | ARCH-033                   | ImportErrorCodes              | ITP-033-A          | —         | ITS-033-A1        | ⬜ Untested |
| N/A (Cross-Cutting)                                                                                | —                                                                                        | ARCH-034                   | ImportContracts               | ITP-034-A          | —         | ITS-034-A1        | ⬜ Untested |

### Matrix C Coverage

| Metric                                 | Value        |
| -------------------------------------- | ------------ |
| **Total Architecture Modules (ARCH)**  | 36           |
| **Total Cross-Cutting Modules**        | 2            |
| **Total Integration Test Cases (ITP)** | 68           |
| **Total Integration Scenarios (ITS)**  | 95           |
| **SYS → ARCH Coverage**                | 15/15 (100%) |
| **ARCH → ITP Coverage**                | 36/36 (100%) |

### Uncovered Requirements (REQ without ATP)

None — full coverage.

### Orphaned Test Cases (ATP without valid REQ)

None — all tests trace to requirements.

### Uncovered Requirements — System Level (REQ without SYS)

None — full coverage.

### Orphaned System Test Cases (STP without valid SYS)

None — all system tests trace to components.

### Uncovered System Components — Architecture Level (SYS without ARCH)

None — full coverage.

### Orphaned Integration Test Cases (ITP without valid ARCH)

None — all integration tests trace to modules.

## Matrix D — Implementation Verification (Module View)

| Architecture Module (ARCH)                    | Parent System                      | Module Design (MOD) | Module Name                               | Test Case ID (UTP) | Technique | Scenario ID (UTS) | Status      |
| --------------------------------------------- | ---------------------------------- | ------------------- | ----------------------------------------- | ------------------ | --------- | ----------------- | ----------- |
| ARCH-001 (SYS-011)                            | SYS-011                            | MOD-001             | ImportsController                         | UTP-001-A          | —         | UTS-001-A1        | ⬜ Untested |
| ARCH-002 (SYS-011)                            | SYS-011                            | MOD-002             | Facade                                    | UTP-002-A          | —         | UTS-002-A1        | ⬜ Untested |
| ARCH-002 (SYS-011)                            | SYS-011                            | MOD-002             | Facade                                    | UTP-002-A          | —         | UTS-002-A2        | ⬜ Untested |
| ARCH-002 (SYS-011)                            | SYS-011                            | MOD-002             | Facade                                    | UTP-002-A          | —         | UTS-002-A3        | ⬜ Untested |
| ARCH-002 (SYS-011)                            | SYS-011                            | MOD-002             | Facade                                    | UTP-002-B          | —         | UTS-002-B1        | ⬜ Untested |
| ARCH-002 (SYS-011)                            | SYS-011                            | MOD-002             | Facade                                    | UTP-002-B          | —         | UTS-002-B2        | ⬜ Untested |
| ARCH-003 (SYS-011)                            | SYS-011                            | MOD-003             | ImportJobsService                         | UTP-003-A          | —         | UTS-003-A1        | ⬜ Untested |
| ARCH-003 (SYS-011)                            | SYS-011                            | MOD-003             | ImportJobsService                         | UTP-003-A          | —         | UTS-003-A2        | ⬜ Untested |
| ARCH-003 (SYS-011)                            | SYS-011                            | MOD-003             | ImportJobsService                         | UTP-003-B          | —         | UTS-003-B1        | ⬜ Untested |
| ARCH-003 (SYS-011)                            | SYS-011                            | MOD-003             | ImportJobsService                         | UTP-003-B          | —         | UTS-003-B2        | ⬜ Untested |
| ARCH-003 (SYS-011)                            | SYS-011                            | MOD-003             | ImportJobsService                         | UTP-003-B          | —         | UTS-003-B3        | ⬜ Untested |
| ARCH-004 (SYS-011)                            | SYS-011                            | MOD-004             | ImportJobWorker                           | UTP-004-A          | —         | UTS-004-A1        | ⬜ Untested |
| ARCH-005 (SYS-001)                            | SYS-001                            | MOD-005             | SourceFetcherService ⚠️ security-critical | UTP-005-A          | —         | UTS-005-A1        | ⬜ Untested |
| ARCH-005 (SYS-001)                            | SYS-001                            | MOD-005             | SourceFetcherService ⚠️ security-critical | UTP-005-A          | —         | UTS-005-A2        | ⬜ Untested |
| ARCH-005 (SYS-001)                            | SYS-001                            | MOD-005             | SourceFetcherService ⚠️ security-critical | UTP-005-A          | —         | UTS-005-A3        | ⬜ Untested |
| ARCH-005 (SYS-001)                            | SYS-001                            | MOD-005             | SourceFetcherService ⚠️ security-critical | UTP-005-B          | —         | UTS-005-B1        | ⬜ Untested |
| ARCH-005 (SYS-001)                            | SYS-001                            | MOD-005             | SourceFetcherService ⚠️ security-critical | UTP-005-B          | —         | UTS-005-B2        | ⬜ Untested |
| ARCH-005 (SYS-001)                            | SYS-001                            | MOD-005             | SourceFetcherService ⚠️ security-critical | UTP-005-C          | —         | UTS-005-C1        | ⬜ Untested |
| ARCH-005 (SYS-001)                            | SYS-001                            | MOD-005             | SourceFetcherService ⚠️ security-critical | UTP-005-C          | —         | UTS-005-C2        | ⬜ Untested |
| ARCH-005 (SYS-001)                            | SYS-001                            | MOD-005             | SourceFetcherService ⚠️ security-critical | UTP-005-C          | —         | UTS-005-C3        | ⬜ Untested |
| ARCH-005 (SYS-001)                            | SYS-001                            | MOD-005             | SourceFetcherService ⚠️ security-critical | UTP-005-D          | —         | UTS-005-D1        | ⬜ Untested |
| ARCH-005 (SYS-001)                            | SYS-001                            | MOD-005             | SourceFetcherService ⚠️ security-critical | UTP-005-D          | —         | UTS-005-D2        | ⬜ Untested |
| ARCH-005 (SYS-001)                            | SYS-001                            | MOD-005             | SourceFetcherService ⚠️ security-critical | UTP-005-E          | —         | UTS-005-E1        | ⬜ Untested |
| ARCH-005 (SYS-001)                            | SYS-001                            | MOD-005             | SourceFetcherService ⚠️ security-critical | UTP-005-F          | —         | UTS-005-F1        | ⬜ Untested |
| ARCH-006 (SYS-001)                            | SYS-001                            | MOD-006             | SsrfGuard ⚠️ security-critical            | UTP-006-A          | —         | UTS-006-A1        | ⬜ Untested |
| ARCH-006 (SYS-001)                            | SYS-001                            | MOD-006             | SsrfGuard ⚠️ security-critical            | UTP-006-A          | —         | UTS-006-A2        | ⬜ Untested |
| ARCH-006 (SYS-001)                            | SYS-001                            | MOD-006             | SsrfGuard ⚠️ security-critical            | UTP-006-A          | —         | UTS-006-A3        | ⬜ Untested |
| ARCH-006 (SYS-001)                            | SYS-001                            | MOD-006             | SsrfGuard ⚠️ security-critical            | UTP-006-A          | —         | UTS-006-A4        | ⬜ Untested |
| ARCH-006 (SYS-001)                            | SYS-001                            | MOD-006             | SsrfGuard ⚠️ security-critical            | UTP-006-A          | —         | UTS-006-A5        | ⬜ Untested |
| ARCH-006 (SYS-001)                            | SYS-001                            | MOD-006             | SsrfGuard ⚠️ security-critical            | UTP-006-B          | —         | UTS-006-B1        | ⬜ Untested |
| ARCH-006 (SYS-001)                            | SYS-001                            | MOD-006             | SsrfGuard ⚠️ security-critical            | UTP-006-B          | —         | UTS-006-B2        | ⬜ Untested |
| ARCH-006 (SYS-001)                            | SYS-001                            | MOD-006             | SsrfGuard ⚠️ security-critical            | UTP-006-C          | —         | UTS-006-C1        | ⬜ Untested |
| ARCH-007 (null`. Returns null, never throws.) | null`. Returns null, never throws. | MOD-007             | port                                      | UTP-007-A          | —         | UTS-007-A1        | ⬜ Untested |
| ARCH-008 (SYS-002)                            | SYS-002                            | MOD-008             | JsonLdExtractor                           | UTP-008-A          | —         | UTS-008-A1        | ⬜ Untested |
| ARCH-008 (SYS-002)                            | SYS-002                            | MOD-008             | JsonLdExtractor                           | UTP-008-A          | —         | UTS-008-A2        | ⬜ Untested |
| ARCH-008 (SYS-002)                            | SYS-002                            | MOD-008             | JsonLdExtractor                           | UTP-008-A          | —         | UTS-008-A3        | ⬜ Untested |
| ARCH-008 (SYS-002)                            | SYS-002                            | MOD-008             | JsonLdExtractor                           | UTP-008-B          | —         | UTS-008-B1        | ⬜ Untested |
| ARCH-008 (SYS-002)                            | SYS-002                            | MOD-008             | JsonLdExtractor                           | UTP-008-B          | —         | UTS-008-B2        | ⬜ Untested |
| ARCH-008 (SYS-002)                            | SYS-002                            | MOD-008             | JsonLdExtractor                           | UTP-008-B          | —         | UTS-008-B3        | ⬜ Untested |
| ARCH-008 (SYS-002)                            | SYS-002                            | MOD-008             | JsonLdExtractor                           | UTP-008-B          | —         | UTS-008-B4        | ⬜ Untested |
| ARCH-008 (SYS-002)                            | SYS-002                            | MOD-008             | JsonLdExtractor                           | UTP-008-C          | —         | UTS-008-C1        | ⬜ Untested |
| ARCH-009 (SYS-002)                            | SYS-002                            | MOD-009             | MicrodataExtractor                        | UTP-009-A          | —         | UTS-009-A1        | ⬜ Untested |
| ARCH-010 (SYS-002)                            | SYS-002                            | MOD-010             | HeuristicExtractor                        | UTP-010-A          | —         | UTS-010-A1        | ⬜ Untested |
| ARCH-010 (SYS-002)                            | SYS-002                            | MOD-010             | HeuristicExtractor                        | UTP-010-A          | —         | UTS-010-A2        | ⬜ Untested |
| ARCH-011 (SYS-002)                            | SYS-002                            | MOD-011             | ExtractorChainService                     | UTP-011-A          | —         | UTS-011-A1        | ⬜ Untested |
| ARCH-011 (SYS-002)                            | SYS-002                            | MOD-011             | ExtractorChainService                     | UTP-011-A          | —         | UTS-011-A2        | ⬜ Untested |
| ARCH-011 (SYS-002)                            | SYS-002                            | MOD-011             | ExtractorChainService                     | UTP-011-A          | —         | UTS-011-A3        | ⬜ Untested |
| ARCH-011 (SYS-002)                            | SYS-002                            | MOD-011             | ExtractorChainService                     | UTP-011-B          | —         | UTS-011-B1        | ⬜ Untested |
| ARCH-012 (SYS-003)                            | SYS-003                            | MOD-012             | OEmbedProvider port                       | UTP-012-A          | —         | UTS-012-A1        | ⬜ Untested |
| ARCH-013 (SYS-003)                            | SYS-003                            | MOD-013             | InstagramOEmbedAdapter                    | UTP-013-A          | —         | UTS-013-A1        | ⬜ Untested |
| ARCH-013 (SYS-003)                            | SYS-003                            | MOD-013             | InstagramOEmbedAdapter                    | UTP-013-A          | —         | UTS-013-A2        | ⬜ Untested |
| ARCH-014 (SYS-004)                            | SYS-004                            | MOD-014             | OcrProvider port                          | UTP-014-A          | —         | UTS-014-A1        | ⬜ Untested |
| ARCH-015 (SYS-004)                            | SYS-004                            | MOD-015             | TextractAdapter                           | UTP-015-A          | —         | UTS-015-A1        | ⬜ Untested |
| ARCH-015 (SYS-004)                            | SYS-004                            | MOD-015             | TextractAdapter                           | UTP-015-A          | —         | UTS-015-A2        | ⬜ Untested |
| ARCH-016 (SYS-004)                            | SYS-004                            | MOD-016             | OcrPipelineService                        | UTP-016-A          | —         | UTS-016-A1        | ⬜ Untested |
| ARCH-017 (SYS-005)                            | SYS-005                            | MOD-017             | FileParserService                         | UTP-017-A          | —         | UTS-017-A1        | ⬜ Untested |
| ARCH-017 (SYS-005)                            | SYS-005                            | MOD-017             | FileParserService                         | UTP-017-B          | —         | UTS-017-B1        | ⬜ Untested |
| ARCH-017 (SYS-005)                            | SYS-005                            | MOD-017             | FileParserService                         | UTP-017-B          | —         | UTS-017-B2        | ⬜ Untested |
| ARCH-017 (SYS-005)                            | SYS-005                            | MOD-017             | FileParserService                         | UTP-017-B          | —         | UTS-017-B3        | ⬜ Untested |
| ARCH-017 (SYS-005)                            | SYS-005                            | MOD-017             | FileParserService                         | UTP-017-B          | —         | UTS-017-B4        | ⬜ Untested |
| ARCH-018 (SYS-006)                            | SYS-006                            | MOD-018             | NormalizerService                         | UTP-018-A          | —         | UTS-018-A1        | ⬜ Untested |
| ARCH-018 (SYS-006)                            | SYS-006                            | MOD-018             | NormalizerService                         | UTP-018-A          | —         | UTS-018-A2        | ⬜ Untested |
| ARCH-018 (SYS-006)                            | SYS-006                            | MOD-018             | NormalizerService                         | UTP-018-A          | —         | UTS-018-A3        | ⬜ Untested |
| ARCH-018 (SYS-006)                            | SYS-006                            | MOD-018             | NormalizerService                         | UTP-018-B          | —         | UTS-018-B1        | ⬜ Untested |
| ARCH-018 (SYS-006)                            | SYS-006                            | MOD-018             | NormalizerService                         | UTP-018-C          | —         | UTS-018-C1        | ⬜ Untested |
| ARCH-019 (SYS-006)                            | SYS-006                            | MOD-019             | IngredientLineParser                      | UTP-019-A          | —         | UTS-019-A1        | ⬜ Untested |
| ARCH-019 (SYS-006)                            | SYS-006                            | MOD-019             | IngredientLineParser                      | UTP-019-A          | —         | UTS-019-A2        | ⬜ Untested |
| ARCH-019 (SYS-006)                            | SYS-006                            | MOD-019             | IngredientLineParser                      | UTP-019-A          | —         | UTS-019-A3        | ⬜ Untested |
| ARCH-019 (SYS-006)                            | SYS-006                            | MOD-019             | IngredientLineParser                      | UTP-019-A          | —         | UTS-019-A4        | ⬜ Untested |
| ARCH-019 (SYS-006)                            | SYS-006                            | MOD-019             | IngredientLineParser                      | UTP-019-A          | —         | UTS-019-A5        | ⬜ Untested |
| ARCH-019 (SYS-006)                            | SYS-006                            | MOD-019             | IngredientLineParser                      | UTP-019-A          | —         | UTS-019-A6        | ⬜ Untested |
| ARCH-019 (SYS-006)                            | SYS-006                            | MOD-019             | IngredientLineParser                      | UTP-019-B          | —         | UTS-019-B1        | ⬜ Untested |
| ARCH-019 (SYS-006)                            | SYS-006                            | MOD-019             | IngredientLineParser                      | UTP-019-B          | —         | UTS-019-B2        | ⬜ Untested |
| ARCH-020 (SYS-006)                            | SYS-006                            | MOD-020             | ValueNormalizers                          | UTP-020-A          | —         | UTS-020-A1        | ⬜ Untested |
| ARCH-020 (SYS-006)                            | SYS-006                            | MOD-020             | ValueNormalizers                          | UTP-020-A          | —         | UTS-020-A2        | ⬜ Untested |
| ARCH-020 (SYS-006)                            | SYS-006                            | MOD-020             | ValueNormalizers                          | UTP-020-A          | —         | UTS-020-A3        | ⬜ Untested |
| ARCH-020 (SYS-006)                            | SYS-006                            | MOD-020             | ValueNormalizers                          | UTP-020-B          | —         | UTS-020-B1        | ⬜ Untested |
| ARCH-020 (SYS-006)                            | SYS-006                            | MOD-020             | ValueNormalizers                          | UTP-020-B          | —         | UTS-020-B2        | ⬜ Untested |
| ARCH-020 (SYS-006)                            | SYS-006                            | MOD-020             | ValueNormalizers                          | UTP-020-B          | —         | UTS-020-B3        | ⬜ Untested |
| ARCH-020 (SYS-006)                            | SYS-006                            | MOD-020             | ValueNormalizers                          | UTP-020-C          | —         | UTS-020-C1        | ⬜ Untested |
| ARCH-021 (SYS-006)                            | SYS-006                            | MOD-021             | ContentSanitizer                          | UTP-021-A          | —         | UTS-021-A1        | ⬜ Untested |
| ARCH-021 (SYS-006)                            | SYS-006                            | MOD-021             | ContentSanitizer                          | UTP-021-A          | —         | UTS-021-A2        | ⬜ Untested |
| ARCH-021 (SYS-006)                            | SYS-006                            | MOD-021             | ContentSanitizer                          | UTP-021-A          | —         | UTS-021-A3        | ⬜ Untested |
| ARCH-021 (SYS-006)                            | SYS-006                            | MOD-021             | ContentSanitizer                          | UTP-021-A          | —         | UTS-021-A4        | ⬜ Untested |
| ARCH-021 (SYS-006)                            | SYS-006                            | MOD-021             | ContentSanitizer                          | UTP-021-A          | —         | UTS-021-A5        | ⬜ Untested |
| ARCH-021 (SYS-006)                            | SYS-006                            | MOD-021             | ContentSanitizer                          | UTP-021-B          | —         | UTS-021-B1        | ⬜ Untested |
| ARCH-022 (SYS-007)                            | SYS-007                            | MOD-022             | ProvenancePolicy                          | UTP-022-A          | —         | UTS-022-A1        | ⬜ Untested |
| ARCH-022 (SYS-007)                            | SYS-007                            | MOD-022             | ProvenancePolicy                          | UTP-022-B          | —         | UTS-022-B1        | ⬜ Untested |
| ARCH-022 (SYS-007)                            | SYS-007                            | MOD-022             | ProvenancePolicy                          | UTP-022-B          | —         | UTS-022-B2        | ⬜ Untested |
| ARCH-022 (SYS-007)                            | SYS-007                            | MOD-022             | ProvenancePolicy                          | UTP-022-C          | —         | UTS-022-C1        | ⬜ Untested |
| ARCH-022 (SYS-007)                            | SYS-007                            | MOD-022             | ProvenancePolicy                          | UTP-022-C          | —         | UTS-022-C2        | ⬜ Untested |
| ARCH-023 (SYS-008)                            | SYS-008                            | MOD-023             | PaywalledDomainsService                   | UTP-023-A          | —         | UTS-023-A1        | ⬜ Untested |
| ARCH-023 (SYS-008)                            | SYS-008                            | MOD-023             | PaywalledDomainsService                   | UTP-023-A          | —         | UTS-023-A2        | ⬜ Untested |
| ARCH-023 (SYS-008)                            | SYS-008                            | MOD-023             | PaywalledDomainsService                   | UTP-023-A          | —         | UTS-023-A3        | ⬜ Untested |
| ARCH-023 (SYS-008)                            | SYS-008                            | MOD-023             | PaywalledDomainsService                   | UTP-023-A          | —         | UTS-023-A4        | ⬜ Untested |
| ARCH-023 (SYS-008)                            | SYS-008                            | MOD-023             | PaywalledDomainsService                   | UTP-023-A          | —         | UTS-023-A5        | ⬜ Untested |
| ARCH-023 (SYS-008)                            | SYS-008                            | MOD-023             | PaywalledDomainsService                   | UTP-023-B          | —         | UTS-023-B1        | ⬜ Untested |
| ARCH-023 (SYS-008)                            | SYS-008                            | MOD-023             | PaywalledDomainsService                   | UTP-023-B          | —         | UTS-023-B2        | ⬜ Untested |
| ARCH-024 (SYS-009)                            | SYS-009                            | MOD-024             | CanonicalSourceUrl                        | UTP-024-A          | —         | UTS-024-A1        | ⬜ Untested |
| ARCH-024 (SYS-009)                            | SYS-009                            | MOD-024             | CanonicalSourceUrl                        | UTP-024-A          | —         | UTS-024-A2        | ⬜ Untested |
| ARCH-024 (SYS-009)                            | SYS-009                            | MOD-024             | CanonicalSourceUrl                        | UTP-024-A          | —         | UTS-024-A3        | ⬜ Untested |
| ARCH-024 (SYS-009)                            | SYS-009                            | MOD-024             | CanonicalSourceUrl                        | UTP-024-A          | —         | UTS-024-A4        | ⬜ Untested |
| ARCH-024 (SYS-009)                            | SYS-009                            | MOD-024             | CanonicalSourceUrl                        | UTP-024-A          | —         | UTS-024-A5        | ⬜ Untested |
| ARCH-024 (SYS-009)                            | SYS-009                            | MOD-024             | CanonicalSourceUrl                        | UTP-024-A          | —         | UTS-024-A6        | ⬜ Untested |
| ARCH-024 (SYS-009)                            | SYS-009                            | MOD-024             | CanonicalSourceUrl                        | UTP-024-A          | —         | UTS-024-A7        | ⬜ Untested |
| ARCH-024 (SYS-009)                            | SYS-009                            | MOD-024             | CanonicalSourceUrl                        | UTP-024-B          | —         | UTS-024-B1        | ⬜ Untested |
| ARCH-024 (SYS-009)                            | SYS-009                            | MOD-024             | CanonicalSourceUrl                        | UTP-024-B          | —         | UTS-024-B2        | ⬜ Untested |
| ARCH-025 (SYS-010)                            | SYS-010                            | MOD-025             | ImportDraftsService                       | UTP-025-A          | —         | UTS-025-A1        | ⬜ Untested |
| ARCH-025 (SYS-010)                            | SYS-010                            | MOD-025             | ImportDraftsService                       | UTP-025-A          | —         | UTS-025-A2        | ⬜ Untested |
| ARCH-025 (SYS-010)                            | SYS-010                            | MOD-025             | ImportDraftsService                       | UTP-025-B          | —         | UTS-025-B1        | ⬜ Untested |
| ARCH-025 (SYS-010)                            | SYS-010                            | MOD-025             | ImportDraftsService                       | UTP-025-B          | —         | UTS-025-B2        | ⬜ Untested |
| ARCH-025 (SYS-010)                            | SYS-010                            | MOD-025             | ImportDraftsService                       | UTP-025-C          | —         | UTS-025-C1        | ⬜ Untested |
| ARCH-025 (SYS-010)                            | SYS-010                            | MOD-025             | ImportDraftsService                       | UTP-025-C          | —         | UTS-025-C2        | ⬜ Untested |
| ARCH-025 (SYS-010)                            | SYS-010                            | MOD-025             | ImportDraftsService                       | UTP-025-D          | —         | UTS-025-D1        | ⬜ Untested |
| ARCH-026 (SYS-012)                            | SYS-012                            | MOD-026             | DraftConfirmationService                  | UTP-026-A          | —         | UTS-026-A1        | ⬜ Untested |
| ARCH-026 (SYS-012)                            | SYS-012                            | MOD-026             | DraftConfirmationService                  | UTP-026-A          | —         | UTS-026-A2        | ⬜ Untested |
| ARCH-026 (SYS-012)                            | SYS-012                            | MOD-026             | DraftConfirmationService                  | UTP-026-A          | —         | UTS-026-A3        | ⬜ Untested |
| ARCH-026 (SYS-012)                            | SYS-012                            | MOD-026             | DraftConfirmationService                  | UTP-026-B          | —         | UTS-026-B1        | ⬜ Untested |
| ARCH-026 (SYS-012)                            | SYS-012                            | MOD-026             | DraftConfirmationService                  | UTP-026-C          | —         | UTS-026-C1        | ⬜ Untested |
| ARCH-027 (SYS-013)                            | SYS-013                            | MOD-027             | ImportEntry                               | UTP-027-A          | —         | UTS-027-A1        | ⬜ Untested |
| ARCH-028 (SYS-013)                            | SYS-013                            | MOD-028             | ImportProgress                            | UTP-028-A          | —         | UTS-028-A1        | ⬜ Untested |
| ARCH-029 (SYS-013)                            | SYS-013                            | MOD-029             | ImportDraftReview                         | UTP-029-A          | —         | UTS-029-A1        | ⬜ Untested |
| ARCH-030 (SYS-013)                            | SYS-013                            | MOD-030             | RecipeAttribution                         | UTP-030-A          | —         | UTS-030-A1        | ⬜ Untested |
| ARCH-031 (SYS-013)                            | SYS-013                            | MOD-031             | ImportErrorState                          | UTP-031-A          | —         | UTS-031-A1        | ⬜ Untested |
| ARCH-032 (SYS-013)                            | SYS-013                            | MOD-032             | Import hooks                              | UTP-032-A          | —         | UTS-032-A1        | ⬜ Untested |
| ARCH-033 ([CROSS-CUTTING])                    | [CROSS-CUTTING]                    | MOD-033             | ImportErrorCodes                          | UTP-033-A          | —         | UTS-033-A1        | ⬜ Untested |
| ARCH-034 ([CROSS-CUTTING])                    | [CROSS-CUTTING]                    | MOD-034             | ImportContracts                           | UTP-034-A          | —         | UTS-034-A1        | ⬜ Untested |
| ARCH-035 (SYS-014)                            | SYS-014                            | MOD-035             | shipped                                   | UTP-035-A          | —         | UTS-035-A1        | ⬜ Untested |
| ARCH-036 (SYS-015)                            | SYS-015                            | MOD-036             | CiQualityGates                            | UTP-036-A          | —         | UTS-036-A1        | ⬜ Untested |

### Matrix D Coverage

| Metric                          | Value        |
| ------------------------------- | ------------ |
| **Total Module Designs (MOD)**  | 36           |
| **External Modules**            | 0            |
| **Testable Modules**            | 36           |
| **Total Unit Test Cases (UTP)** | 64           |
| **Total Unit Scenarios (UTS)**  | 133          |
| **ARCH → MOD Coverage**         | 36/36 (100%) |
| **MOD → UTP Coverage**          | 36/36 (100%) |

## Matrix H — Hazard Traceability

| HAZ ID  | Mitigation       | Verification        | Status     |
| ------- | ---------------- | ------------------- | ---------- |
| HAZ-001 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-002 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-003 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-004 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-005 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-006 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-007 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-008 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-009 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-010 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-011 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-012 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-013 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-014 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-015 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-016 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-017 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-018 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-019 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-020 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-021 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-022 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-023 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-024 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-025 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-026 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-027 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-028 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-029 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-030 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-031 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-032 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-033 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-034 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-035 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-036 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-037 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-038 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-039 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-040 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-041 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-042 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-043 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-044 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-045 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-046 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-047 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-048 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-049 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-050 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-051 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-052 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-053 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-054 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-055 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-056 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-057 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-058 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-059 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-060 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |
| HAZ-061 | ⚠️ No mitigation | ⚠️ No test coverage | ⬜ Pending |

### Matrix H Coverage

| Metric                    | Value     |
| ------------------------- | --------- |
| **Total Hazards (HAZ)**   | 61        |
| **HAZ with Verification** | 0/61 (0%) |

## Audit Notes

- **Matrix generated by**: `build-matrix.sh` (deterministic regex parser)
- **Source documents**: `requirements.md`, `acceptance-plan.md`, `system-design.md`, `system-test.md`, `architecture-design.md`, `integration-test.md`, `module-design.md`, `unit-test.md`, `hazard-analysis.md`
- **Last validated**: 2026-08-02
