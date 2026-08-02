# Hazard Analysis (FMEA): Recipe Importing

**Feature Branch**: `004-recipe-importing`
**Created**: 2026-05-10
**Revised**: 2026-08-02
**Status**: Approved
**Source**: `specs/004-recipe-importing/v-model/system-design.md`
**Standard**: General-purpose FMEA (non-regulated consumer software)

> **Revision note.** The hazard set below was the strongest artefact in the previous document set and is
> substantially retained. Three classes of defect are fixed: (1) **mitigation citations pointed at the wrong
> requirements** — HAZ-003 (SSRF) cited `REQ-014`, which was about 404 handling, so the Catastrophic hazard had
> no real requirement behind it; (2) hazards referenced SYS/ARCH components that no longer exist after the
> architecture was reconciled against shipped 001; (3) **no mitigation had reached `plan.md` or `tasks.md`** —
> a grep for `ssrf|sanitiz|size limit` across both returned nothing, so implementing the task list as written
> would have shipped the Catastrophic hazard. Every mitigation below now names a real requirement **and** the
> task that implements it.

## Overview

FMEA for **Recipe Importing**. Every system component (`SYS-001`..`SYS-013`) is assessed for realistic failure
modes. Each hazard carries a `HAZ-NNN` identifier and links to risk controls (`REQ-*` / `SYS-*` / `ARCH-*`) and
to the implementing task, giving the chain: Hazard → Requirement → Design → Task → Test.

**Non-regulated context.** Commise is a consumer recipe application. There are no life-safety concerns.
Severity is measured against user trust, data integrity, privacy, legal/attribution compliance, availability,
and platform cost.

**What makes this feature unusually hazardous relative to the rest of the platform:** it is the first surface
that performs **outbound HTTP to arbitrary user-supplied hosts** and then **persists third-party content**.
That combination is the origin of the two highest-severity hazards below (SSRF, stored XSS), neither of which
existed anywhere else in the system.

## ID Schema

- **Hazard**: `HAZ-{NNN}`, 3-digit, sequential, never renumbered.
- Each row names the component, failure mode, effect, severity, likelihood, risk, controls, residual risk, and
  the task that implements the control.

## Risk Matrix Definition

### Severity

| Level        | Definition                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Catastrophic | Cross-tenant data leak, broad unauthorized access, internal-network compromise, or platform-wide outage.                                      |
| Critical     | Individual-user data loss without recovery, sustained attribution/legal-compliance failure, security-control bypass, or core-flow outage ≥1h. |
| Serious      | Recoverable degradation: failed imports with a retry path, persistent extraction-quality drop, transient 5xx with idempotent retry.           |
| Minor        | Annoyance: slow import, partial extraction with a user-edit workaround, transient UI error with self-recovery.                                |
| Negligible   | Cosmetic: log noise, telemetry drift, copy inconsistency.                                                                                     |

### Likelihood

| Level      | Definition                                                          |
| ---------- | ------------------------------------------------------------------- |
| Frequent   | ≥1× per day in production.                                          |
| Probable   | ≥1× per week per 1k MAU.                                            |
| Occasional | ≥1× per month per 1k MAU.                                           |
| Remote     | Possible under unusual conditions (≥1× per quarter at small scale). |
| Improbable | Conceivable only under stacked failure or adversarial conditions.   |

### Risk classes

`Intolerable` — must not ship · `Undesirable` — must be mitigated to Tolerable · `Tolerable` — accepted with
controls · `Acceptable` — no further action.

---

## Hazard Register

### SYS-001 Source Fetcher — outbound egress

| ID          | Failure mode                                                         | Effect                                                                                                    | Sev              | Lik        | Risk            | Controls (requirement · design · task)                                                                                                                                                                                   | Residual   |
| ----------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------- | ---------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| HAZ-001     | Fetch failure (DNS/TLS/timeout/4xx/5xx) treated as a success path    | Silent empty import; user sees a blank or partial recipe                                                  | Serious          | Occasional | Undesirable     | REQ-024, REQ-NF-007 · ARCH-005 throws typed `SourceUnreachable`; ARCH-033 maps it to `422` · **T-010, T-011**                                                                                                            | Tolerable  |
| HAZ-002     | Redirect chain unbounded or looping                                  | Worker starvation, import timeout, elevated cost                                                          | Serious          | Remote     | Tolerable       | REQ-NF-007 · ARCH-005 caps at 5 hops with total-time budget · **T-010**                                                                                                                                                  | Tolerable  |
| **HAZ-003** | **SSRF via user-supplied URL — internal/metadata/private-IP fetch**  | **Internal network probing; cloud credential theft via the instance metadata endpoint; lateral movement** | **Catastrophic** | **Remote** | **Undesirable** | **REQ-NF-009, REQ-018** · ARCH-006 rejects all non-public addresses, pins the connection to the validated IP (closing DNS rebinding), and re-validates **every** redirect hop · **T-010 (security tests written first)** | Tolerable  |
| HAZ-004     | Oversized response buffered without a size guard                     | Memory pressure, degraded service, DoS                                                                    | Critical         | Occasional | Undesirable     | REQ-NF-007 · ARCH-005 streams with a 5 MB early abort — **not** buffer-then-check · **T-010**                                                                                                                            | Tolerable  |
| HAZ-005     | Charset/BOM decode errors corrupt extracted text                     | Garbled ingredients persisted                                                                             | Serious          | Occasional | Undesirable     | REQ-001 · ARCH-005 charset normalization; ARCH-018 validates before persistence · **T-007, T-008**                                                                                                                       | Tolerable  |
| HAZ-031     | Slow-loris / trickled response consumes a worker for the full budget | Worker pool exhaustion under a small number of hostile URLs                                               | Serious          | Remote     | Tolerable       | REQ-NF-007 · ARCH-005 total-request deadline independent of the connect timeout; bulkhead bounds concurrent fetches · **T-010**                                                                                          | Tolerable  |
| HAZ-032     | Outbound request carries credentials or cookies                      | Credential leakage to a third-party host                                                                  | Critical         | Improbable | Undesirable     | REQ-NF-009 · ARCH-005 constructs requests with no auth headers, cookie jar disabled · **T-010**                                                                                                                          | Acceptable |

### SYS-002 Extractor Chain

| ID      | Failure mode                                                       | Effect                                                   | Sev     | Lik        | Risk        | Controls                                                                                                                 | Residual   |
| ------- | ------------------------------------------------------------------ | -------------------------------------------------------- | ------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ | ---------- |
| HAZ-006 | Markup format drift yields a false parse success                   | Fields mis-mapped (title/ingredients swapped or dropped) | Serious | Probable   | Undesirable | REQ-002 · ARCH-008 Zod-validates before accepting; falls through to ARCH-009/010 · **T-008**                             | Tolerable  |
| HAZ-007 | Partial parse accepted with no ingredients found                   | Unusable recipe saved; trust erosion                     | Serious | Probable   | Undesirable | REQ-012, REQ-013 · draft carries `missingRequired`; **confirmation is blocked** until complete · **T-007, T-016, T-022** | Acceptable |
| HAZ-009 | JS-rendered page interpreted as an empty document                  | False "success" with an empty recipe                     | Minor   | Probable   | Tolerable   | REQ-CN-006 · ARCH-011 classifies "fetched, nothing found" as `IMPORT_NO_RECIPE_FOUND` · **T-008**                        | Acceptable |
| HAZ-028 | JSON-LD parser accepts a non-`Recipe` object as a recipe           | Corrupted payload persisted with wrong semantics         | Serious | Occasional | Undesirable | REQ-002 · ARCH-008 strict `@type === 'Recipe'` check before acceptance · **T-008**                                       | Tolerable  |
| HAZ-033 | Adversarial markup causes catastrophic parser backtracking (ReDoS) | Worker CPU exhaustion from one crafted page              | Serious | Remote     | Tolerable   | REQ-NF-007 · heuristics avoid unbounded backtracking; per-job CPU/time budget bounds the blast radius · **T-008, T-010** | Tolerable  |

### SYS-003 Instagram Adapter

| ID      | Failure mode                                             | Effect                                               | Sev     | Lik        | Risk        | Controls                                                                                                     | Residual   |
| ------- | -------------------------------------------------------- | ---------------------------------------------------- | ------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------------ | ---------- |
| HAZ-010 | Upstream rate-limit (429) not classified                 | Burst failures look generic; retries amplify         | Serious | Occasional | Undesirable | REQ-005, REQ-NF-008 · ARCH-013 maps 429 to an explicit throttled error; backoff with full jitter · **T-019** | Tolerable  |
| HAZ-011 | Caption parser false-positive on promotional text        | Low-quality recipe imported                          | Minor   | Probable   | Tolerable   | REQ-012 · draft review is the correction point (ARCH-029) · **T-022**                                        | Acceptable |
| HAZ-012 | Provider contract drift (field rename/removal)           | Channel breaks for valid URLs until adapter update   | Serious | Remote     | Tolerable   | REQ-IF-001 · ARCH-013 validates response shape; contract test pins the expected shape · **T-019**            | Tolerable  |
| HAZ-030 | Adapter timeout returned as a success-like empty payload | Empty imports created instead of an explicit failure | Serious | Remote     | Tolerable   | REQ-024 · ARCH-013 throws typed; ARCH-002 hard-fails the job · **T-019**                                     | Acceptable |
| HAZ-034 | Meta credential absent or expired in a deployed stage    | Channel silently 500s for every user                 | Serious | Occasional | Undesirable | REQ-IF-001 · capability flag defaults **off**; the channel is hidden rather than broken (D-002) · **T-019**  | Acceptable |

### SYS-004 OCR Pipeline

| ID      | Failure mode                                   | Effect                                                                                                       | Sev      | Lik        | Risk        | Controls                                                                                                                   | Residual   |
| ------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------- | ---------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- | ---------- |
| HAZ-013 | Provider latency spike without timeout/backoff | Photo import stalls; user abandons                                                                           | Serious  | Occasional | Undesirable | REQ-NF-007 · ARCH-015 bounded polling + hard timeout; breaker opens · **T-018**                                            | Tolerable  |
| HAZ-014 | Partial OCR text saved as if complete          | Missing ingredients persisted silently                                                                       | Serious  | Occasional | Undesirable | REQ-012 · OCR uses the same draft path; confirmation blocked while incomplete · **T-018, T-022**                           | Acceptable |
| HAZ-035 | Source image retained indefinitely             | Storage cost growth and an avoidable privacy liability (photos may contain faces, handwriting, surroundings) | Critical | Probable   | Undesirable | REQ-026 · ARCH-016 deletes on confirm/discard/expiry, whichever is first; S3 lifecycle rule as backstop · **T-018, T-012** | Tolerable  |
| HAZ-036 | OCR text logged for debugging                  | Third-party content and potential PII in logs                                                                | Critical | Occasional | Undesirable | REQ-NF-012 · logging policy forbids body/text; enforced by review and a log-assertion test · **T-018**                     | Tolerable  |

### SYS-005 File Parser

| ID      | Failure mode                                              | Effect                                         | Sev      | Lik        | Risk        | Controls                                                                                     | Residual   |
| ------- | --------------------------------------------------------- | ---------------------------------------------- | -------- | ---------- | ----------- | -------------------------------------------------------------------------------------------- | ---------- |
| HAZ-037 | File type trusted from the client-supplied name/MIME      | Parser confusion; unexpected content processed | Serious  | Occasional | Undesirable | REQ-006 · ARCH-017 determines type by magic bytes (`file-type`) · **T-015**                  | Tolerable  |
| HAZ-038 | YAML parsed with type resolution enabling object creation | Deserialization attack surface                 | Critical | Remote     | Undesirable | REQ-006 · `yaml` safe-parse only; no custom tags/anchors expansion beyond bounds · **T-015** | Tolerable  |
| HAZ-039 | Decompression/expansion bomb in an uploaded file          | Memory exhaustion                              | Serious  | Remote     | Tolerable   | REQ-006 · 1 MB upload cap enforced before parse · **T-015**                                  | Acceptable |

### SYS-006 Normalizer

| ID      | Failure mode                                               | Effect                                                       | Sev      | Lik      | Risk        | Controls                                                                                            | Residual   |
| ------- | ---------------------------------------------------------- | ------------------------------------------------------------ | -------- | -------- | ----------- | --------------------------------------------------------------------------------------------------- | ---------- |
| HAZ-008 | Malicious markup persisted and later rendered              | **Stored XSS** in recipe views across web and mobile         | Critical | Remote   | Undesirable | REQ-NF-010 · ARCH-021 zero-tag-allowlist sanitization before persistence · **T-007**                | Tolerable  |
| HAZ-029 | Unsanitized field bypasses the boundary on one path        | Stored XSS via a path that skipped sanitization              | Critical | Remote   | Undesirable | REQ-NF-010 · sanitization applied in ARCH-018, which **every** channel traverses · **T-007, T-011** | Tolerable  |
| HAZ-040 | Missing required value silently defaulted (`servings = 1`) | Fabricated data presented to the user as extracted fact      | Critical | Probable | Undesirable | REQ-011 · ARCH-020 **never** defaults; absent ⇒ `missingRequired` · **T-007** (explicit test)       | Acceptable |
| HAZ-041 | Ingredient line mis-parsed and the original discarded      | Irrecoverable data loss — the user cannot see what was meant | Serious  | Probable | Undesirable | REQ-008, REQ-009 · ARCH-019 **always** retains `raw` · **T-007, T-022**                             | Acceptable |

### SYS-007 Provenance Classifier

| ID      | Failure mode                                         | Effect                                                           | Sev      | Lik        | Risk        | Controls                                                                                                | Residual   |
| ------- | ---------------------------------------------------- | ---------------------------------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------- | ---------- |
| HAZ-016 | Provenance mis-classified (physical saved as public) | Policy violation; a private-origin recipe made public            | Critical | Remote     | Undesirable | REQ-014 · ARCH-022 pure total function with exhaustive branch tests · **T-006**                         | Tolerable  |
| HAZ-017 | Clone/premium gate bypassed                          | Public import made private without a substantive edit            | Critical | Remote     | Undesirable | REQ-015 · delegated to the **shipped** `evaluateVisibility`; 004 adds no second rule · **T-006, T-016** | Acceptable |
| HAZ-042 | A heuristic reclassifies a recipe on its own         | False accusation of paid-source use; wrongly blocked publication | Serious  | Occasional | Undesirable | REQ-023 · heuristics **flag for review only**, never adjudicate (D-003) · **T-006**                     | Acceptable |
| HAZ-043 | Classification failure defaults to a public class    | Paid or private-origin content published                         | Critical | Remote     | Undesirable | REQ-014 · classification is a **hard-fail** gate; there is no default-to-public path · **T-006, T-011** | Tolerable  |

### SYS-008 Paywall Blocklist

| ID      | Failure mode                                         | Effect                                                   | Sev      | Lik        | Risk        | Controls                                                                                                                                                                | Residual   |
| ------- | ---------------------------------------------------- | -------------------------------------------------------- | -------- | ---------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| HAZ-020 | Blocklist miss — paywalled source not detected       | Copyright/TOS breach via an unauthorized import          | Critical | Occasional | Undesirable | REQ-017 · ARCH-023 consulted pre-fetch and per redirect hop; admin-updatable without deploy (D-004) · **T-009, T-017**                                                  | Tolerable  |
| HAZ-021 | `robots.txt` disallow ignored                        | TOS violation; source-site abuse complaints              | Serious  | Remote     | Tolerable   | REQ-030 · agent-specific groups honoured in full; path-specific wildcard rules honoured; bare wildcard `Disallow: /` does not block (D-007); blocks counted · **T-010** | Tolerable  |
| HAZ-022 | Over-broad matching blocks legitimate domains        | Valid imports refused; user frustration                  | Minor    | Occasional | Tolerable   | REQ-020 · exact-host or registrable-suffix matching only, **never substring** · **T-009**                                                                               | Acceptable |
| HAZ-044 | Blocklist store unavailable and the check fails open | Every blocked source becomes importable during an outage | Critical | Remote     | Undesirable | REQ-017 · the check fails **closed**; a lookup error aborts the import · **T-009, T-011**                                                                               | Tolerable  |

### SYS-009 Deduplication Guard

| ID      | Failure mode                                           | Effect                                           | Sev     | Lik        | Risk        | Controls                                                                                                               | Residual   |
| ------- | ------------------------------------------------------ | ------------------------------------------------ | ------- | ---------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- | ---------- |
| HAZ-018 | Race between duplicate check and insert                | Two public recipes for one source URL            | Serious | Occasional | Undesirable | REQ-004, REQ-CN-001 · partial **unique index** is the authority; the lookup is only an optimisation · **T-002, T-014** | Acceptable |
| HAZ-019 | URL canonicalization mismatch (scheme/params/slash)    | Dedup false negatives; duplicates accumulate     | Serious | Probable   | Undesirable | REQ-003 · ARCH-024 value object canonicalizes at construction, so no caller can forget · **T-005**                     | Acceptable |
| HAZ-045 | Unique index blocks re-import of a soft-deleted recipe | A user who deletes an import can never re-add it | Serious | Probable   | Undesirable | REQ-CN-002 · the index is partial on `deleted_at IS NULL` · **T-002** (explicit test)                                  | Acceptable |

### SYS-010/011 Drafts, Jobs, Orchestration

| ID      | Failure mode                                                                            | Effect                                                                                        | Sev          | Lik        | Risk        | Controls                                                                                                                | Residual   |
| ------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------ | ---------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- | ---------- |
| HAZ-026 | Pipeline step ordering regression (dedupe/policy after persist)                         | Invalid or duplicate records committed before controls apply                                  | Critical     | Remote     | Undesirable | REQ-024 · ARCH-002 owns the fixed sequence; unit tests assert call **order**, not just outcome · **T-011**              | Tolerable  |
| HAZ-027 | Error normalization missed on one path                                                  | Internal details leak; inconsistent client behaviour                                          | Serious      | Occasional | Undesirable | REQ-024 · the **shipped** `ApiExceptionFilter` is the single boundary · **T-003**                                       | Acceptable |
| HAZ-046 | Another user's draft or job readable by id                                              | **Cross-tenant data exposure** (BOLA/IDOR, OWASP API #1)                                      | Catastrophic | Remote     | Undesirable | REQ-027 · owner-scoped reads returning `404`, never `403`; IDOR tests on every id-bearing route · **T-012, T-013**      | Tolerable  |
| HAZ-047 | Client retry double-imports                                                             | Duplicate drafts and duplicate OCR spend                                                      | Serious      | Probable   | Undesirable | REQ-028 · `Idempotency-Key` required; first outcome cached per (key, endpoint, principal) · **T-013**                   | Acceptable |
| HAZ-048 | Unbounded intake under load                                                             | Queue growth → OOM rather than graceful shedding                                              | Critical     | Occasional | Undesirable | REQ-NF-011 · bounded queue; `429` shedding; k6 soak-to-failure proves the limit · **T-026**                             | Tolerable  |
| HAZ-049 | Drafts accumulate without expiry                                                        | Unbounded table growth; stale third-party content retained                                    | Serious      | Probable   | Undesirable | REQ-026 · 7-day expiry sweep, cap enforced in prod (D-005) · **T-012**                                                  | Acceptable |
| HAZ-056 | Single user or compromised account drives unbounded OCR / outbound volume               | Runaway Textract spend and third-party abuse complaints                                       | Serious      | Occasional | Undesirable | REQ-029 · daily allowance (200/day, 50/day OCR) evaluated in ARCH-002 as domain policy · **T-013**                      | Acceptable |
| HAZ-057 | Client mass-assigns `sourceType` to obtain a private recipe or attach false attribution | Free-tier caller bypasses the C-004 premium gate; fabricated source credit on a public recipe | Critical     | Occasional | Undesirable | REQ-032 · server-set provenance for observed channels; client whitelist admits only the attested paid class · **T-029** | Tolerable  |
| HAZ-058 | Bulk import partially fails and discards successful recipes                             | A 187-recipe migration loses everything on one bad row; user abandons migration               | Serious      | Probable   | Undesirable | REQ-034 · per-recipe outcome, per-recipe transaction; no all-or-nothing batch · **T-030**                               | Acceptable |
| HAZ-059 | Bulk import floods the food service with ingredient resolutions                         | 003 degraded or throttled by one user's migration                                             | Serious      | Occasional | Undesirable | REQ-034 · resolution stays asynchronous and is batched/queued, never a synchronous fan-out per recipe · **T-030**       | Tolerable  |
| HAZ-060 | Oversized export file exhausts memory or transaction limits                             | Import worker OOM; partial writes                                                             | Serious      | Occasional | Undesirable | REQ-033 · bounded recipe count and file size per upload, streamed parse, chunked persistence · **T-030**                | Tolerable  |
| HAZ-061 | Premium gate bypassed on a non-public channel                                           | Free-tier caller obtains private recipes and bills Textract to the platform                   | Critical     | Remote     | Undesirable | REQ-035 · entitlement checked in ARCH-002 before the channel runs, from the signed token's permissions · **T-031**      | Tolerable  |

### SYS-012 Confirmation Bridge

| ID      | Failure mode                                                | Effect                                                               | Sev      | Lik        | Risk        | Controls                                                                                                     | Residual   |
| ------- | ----------------------------------------------------------- | -------------------------------------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------------ | ---------- |
| HAZ-015 | Attribution dropped on the create path                      | Legal/compliance exposure for imported public recipes                | Critical | Occasional | Undesirable | REQ-016 · attribution carried on the draft and asserted on the created recipe · **T-016** (integration test) | Tolerable  |
| HAZ-023 | Attribution fields omitted in the DB write mapping          | Attribution not displayed despite a successful import                | Critical | Remote     | Undesirable | REQ-016 · typed mapping; integration test asserts persisted attribution · **T-016**                          | Tolerable  |
| HAZ-024 | Partial commit leaves a recipe without its related rows     | Inconsistent records; downstream render failures                     | Serious  | Remote     | Tolerable   | REQ-IF-003 · creation runs through 001's shipped transactional write path · **T-016**                        | Acceptable |
| HAZ-050 | Food-service outage blocks confirmation                     | Users cannot save any import while a non-critical dependency is down | Serious  | Occasional | Undesirable | REQ-010 · resolution is asynchronous and **never** blocks confirmation; degrades to unresolved · **T-016**   | Acceptable |
| HAZ-051 | A second recipe-creation path is introduced alongside 001's | Two write authorities drift; C-004 enforced in only one              | Critical | Occasional | Undesirable | REQ-CN-007 · confirmation delegates to `RecipesService.create`; enforced by review + inspection · **T-016**  | Tolerable  |

### SYS-013 Import UI

| ID      | Failure mode                                             | Effect                                                      | Sev          | Lik        | Risk        | Controls                                                                                         | Residual   |
| ------- | -------------------------------------------------------- | ----------------------------------------------------------- | ------------ | ---------- | ----------- | ------------------------------------------------------------------------------------------------ | ---------- |
| HAZ-025 | Unauthenticated import reaches the service               | Unauthorized recipe creation                                | Catastrophic | Improbable | Undesirable | REQ-IF-004 · the **shipped** Clerk middleware guards every route · **T-014..T-019**              | Acceptable |
| HAZ-052 | Import state conveyed by colour alone                    | Users with colour-vision deficiency cannot perceive failure | Serious      | Probable   | Undesirable | REQ-NF-005 · icon + text pairing; component tests assert the text affordance · **T-024**         | Acceptable |
| HAZ-053 | Web ships an import capability mobile lacks              | Platform drift; §14.1 violation                             | Serious      | Probable   | Undesirable | REQ-CN-008 · T-021..T-024 each deliver both platforms; review checklist rejects an unpaired task | Acceptable |
| HAZ-054 | A gated channel renders as an affordance that then fails | Dead UI; user attempts an unavailable action                | Minor        | Occasional | Tolerable   | REQ-IF-001 · the channel list is server-driven by `GET /import/sources` · **T-019, T-021**       | Acceptable |
| HAZ-055 | Hard-coded user-facing copy                              | Untranslatable UI; platform copy drift                      | Minor        | Probable   | Tolerable   | REQ-NF-006 · copy lives in shared `messages.ts` via `useMessages` · **T-021..T-024**             | Acceptable |

---

## Summary

| Metric                                   | Count   |
| ---------------------------------------- | ------- |
| Total hazards                            | 61      |
| Catastrophic                             | 3       |
| Critical                                 | 20      |
| Serious                                  | 33      |
| Minor                                    | 5       |
| Residual **Intolerable**                 | 0       |
| Residual **Undesirable** (must not ship) | 0       |
| Hazards whose control reaches a task     | 61 / 61 |

### The three Catastrophic hazards

1. **HAZ-003 — SSRF.** The defining risk of this feature. Controlled by REQ-NF-009/REQ-018 and implemented in
   **T-010**, whose security tests are written before the fetcher exists and include a test that fails if the
   guard is removed.
2. **HAZ-046 — cross-tenant draft/job access.** Controlled by REQ-027 and implemented in T-012/T-013 with
   owner-scoped reads that return `404` rather than `403`.
3. **HAZ-025 — unauthenticated import.** Controlled by the shipped Clerk middleware; 004 adds no new auth path.

### Traceability

Every hazard maps to at least one requirement in `requirements.md` and at least one task in `tasks.md`. The
Hazard Traceability matrix (Matrix H in `traceability-matrix.md`) is generated from this register; a hazard with
no test-case mapping is a release blocker.
