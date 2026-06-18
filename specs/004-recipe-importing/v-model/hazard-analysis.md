# Hazard Analysis (FMEA): Recipe Importing

**Feature Branch**: `004-recipe-importing`
**Created**: 2026-05-10
**Status**: Draft
**Source**: `specs/004-recipe-importing/v-model/system-design.md`
**Standard**: General-Purpose FMEA (non-regulated software; `domain: ''` in `v-model-config.yml`)

## Overview

This document presents the Failure Mode and Effects Analysis (FMEA) for the **Recipe Importing** feature. Every system component (`SYS-001`..`SYS-009`) from `system-design.md` is assessed for realistic failure modes. Each hazard receives a unique `HAZ-NNN` identifier and is linked to risk-control measures (`REQ-NNN` / `SYS-NNN` / `ARCH-NNN`), enabling the traceability chain: Hazard → Mitigation → Requirement → Test Case (Matrix H in `traceability-matrix.md`).

**Non-regulated context.** Commise is a consumer recipe management application. There are no life-safety, vehicle-control, medical-device, or aviation-control concerns. Severity is measured against **user trust, data integrity, privacy, availability, attribution compliance, and platform cost** — not personal injury.

## ID Schema

- **Hazard ID**: `HAZ-{NNN}` — 3-digit zero-padded, sequential (HAZ-001, HAZ-002, ...). Never renumbered.
- **Lineage**: From any `HAZ-NNN`, the Mitigation column lists `REQ-NNN`, `SYS-NNN`, and (where useful) `ARCH-NNN` references. The full chain to verification test cases (`ATP-NNN`, `STP-NNN`, `ITP-NNN`, `UTP-NNN`) lives in `traceability-matrix.md` (Matrix H — Hazard Traceability).

## Risk Matrix Definition

### Severity Scale (consumer SaaS — recipe app)

| Level        | Definition                                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catastrophic | Cross-tenant data leak, broad unauthorized access, persistent loss of user-owned recipe data, or platform-wide outage.                                                     |
| Critical     | Individual-user data loss without recovery, sustained attribution/legal-compliance failure, security control bypass for one user, or sustained core-flow outage (≥1 hour). |
| Serious      | Recoverable degradation: failed imports with retry path, persistent extraction quality drop, transient endpoint 5xx with idempotent retry.                                 |
| Minor        | Annoyance: slow import turnaround, partial field extraction with user-edit workaround, transient UI error with self-recovery.                                              |
| Negligible   | Cosmetic only: log noise, telemetry drift, copy/wording inconsistency.                                                                                                     |

### Likelihood Scale

| Level      | Definition                                                                   |
| ---------- | ---------------------------------------------------------------------------- |
| Frequent   | Expected on a regular cadence under normal load (≥1× per day in production). |
| Probable   | Expected occasionally (≥1× per week per 1k MAU).                             |
| Occasional | Expected rarely (≥1× per month per 1k MAU).                                  |
| Remote     | Possible under unusual conditions (≥1× per quarter at small scale).          |
| Improbable | Conceivable only under stacked failure or adversarial conditions.            |

### Risk Level Matrix

|              | Frequent     | Probable     | Occasional   | Remote      | Improbable  |
| ------------ | ------------ | ------------ | ------------ | ----------- | ----------- |
| Catastrophic | Unacceptable | Unacceptable | Unacceptable | Undesirable | Undesirable |
| Critical     | Unacceptable | Unacceptable | Undesirable  | Undesirable | Tolerable   |
| Serious      | Unacceptable | Undesirable  | Undesirable  | Tolerable   | Tolerable   |
| Minor        | Undesirable  | Tolerable    | Tolerable    | Tolerable   | Acceptable  |
| Negligible   | Tolerable    | Tolerable    | Acceptable   | Acceptable  | Acceptable  |

**Disposition rule**: `Unacceptable` MUST be mitigated to `Undesirable` or lower before release. `Undesirable` MUST have explicit residual-risk acceptance recorded in this document. `Tolerable` and `Acceptable` may ship with standard controls.

## Operational States

`system-design.md` does not define explicit operational states for the importing subsystem; the implicit state is **NORMAL** (steady-state production). The following operating modes are referenced where relevant for state-dependent hazards:

| State             | Definition                                                               | Source                    |
| ----------------- | ------------------------------------------------------------------------ | ------------------------- |
| NORMAL            | Steady-state operation under expected load and upstream availability.    | Implicit                  |
| DEGRADED-UPSTREAM | Source sites/oEmbed/OCR providers returning elevated errors or latency.  | SYS-001, SYS-002, SYS-003 |
| RATE-LIMITED      | Upstream source is actively rate limiting requests (429 / throttling).   | SYS-001, SYS-002          |
| REDIRECT-CHAIN    | URL fetch path enters multi-hop redirects and canonicalization handling. | SYS-001                   |
| OCR-REVIEW        | OCR draft is presented for user correction before final save.            | SYS-003                   |

## Hazard Register (FMEA)

> One or more `HAZ-NNN` per `SYS-NNN`. Mitigations cite existing `REQ-NNN`, `SYS-NNN`, or `ARCH-NNN` identifiers.

### SYS-001 — Web URL Extractor

| HAZ ID  | Component | Failure Mode                                                                    | Operational State | Effect                                                           | Severity     | Likelihood | Risk Level  | Mitigation                                                                                                | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------- | ------------ | ---------- | ----------- | --------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-001 | SYS-001   | URL fetch failure (DNS/TLS/timeout/4xx/5xx) treated as generic success path.    | DEGRADED-UPSTREAM | User sees incomplete import or silent failure.                   | Serious      | Occasional | Undesirable | REQ-001, REQ-NF-002; ARCH-003 throws `UrlUnreachableError`; ARCH-017 normalizes to deterministic 4xx/5xx. | Tolerable     |
| HAZ-002 | SYS-001   | Redirect loop or excessive redirect hops not bounded.                           | REDIRECT-CHAIN    | Worker/thread starvation, import timeout, elevated cost.         | Serious      | Remote     | Tolerable   | REQ-NF-001; ARCH-003 redirect cap + timeout; SYS-009 hard-fails on extractor timeout.                     | Tolerable     |
| HAZ-003 | SYS-001   | SSRF via user-supplied URL (internal metadata/private IP fetch).                | NORMAL            | Internal network probing or data exposure.                       | Catastrophic | Remote     | Undesirable | REQ-014 input validation; ARCH-002 URL DTO validation; ARCH-003 egress allowlist/deny private CIDRs.      | Tolerable     |
| HAZ-004 | SYS-001   | Oversized HTML payload accepted without size guard.                             | NORMAL            | Memory pressure, degraded performance, potential DoS.            | Critical     | Occasional | Undesirable | REQ-NF-001, REQ-NF-002; ARCH-003 max response-size limit + early abort.                                   | Tolerable     |
| HAZ-005 | SYS-001   | UTF-8/BOM/charset decode errors corrupt extracted text.                         | NORMAL            | Garbled ingredients/instructions and incorrect persisted recipe. | Serious      | Occasional | Undesirable | REQ-001; ARCH-003 charset normalization; ARCH-016 typed payload validation before persistence.            | Tolerable     |
| HAZ-006 | SYS-001   | schema.org/microdata format drift yields false parse success.                   | NORMAL            | Incorrect field mapping (title/ingredients swapped or missing).  | Serious      | Probable   | Undesirable | REQ-001; ARCH-004 strict schema validation + null on invalid; fallback to ARCH-005 heuristics.            | Tolerable     |
| HAZ-007 | SYS-001   | Partial parse accepted with no ingredients found.                               | NORMAL            | Unusable imported recipe saved, user trust erosion.              | Serious      | Probable   | Undesirable | REQ-001, REQ-011; ARCH-005 confidence threshold + required-field checks in ARCH-001 before save.          | Tolerable     |
| HAZ-008 | SYS-001   | Malicious HTML/script fragments persisted and later rendered unsanitized.       | NORMAL            | Stored XSS risk in recipe views.                                 | Critical     | Remote     | Undesirable | REQ-NF-004; ARCH-002 DTO sanitization boundary; ARCH-013 persistence sanitization/encoding contract.      | Tolerable     |
| HAZ-009 | SYS-001   | JS-rendered pages interpreted as empty content without explicit classification. | NORMAL            | False "success" with empty extraction on modern recipe sites.    | Minor        | Probable   | Tolerable   | REQ-001; ARCH-003 classify dynamic-render failure and return actionable extraction error via ARCH-017.    | Acceptable    |

### SYS-002 — Instagram oEmbed Adapter

| HAZ ID  | Component | Failure Mode                                                  | Operational State | Effect                                                               | Severity | Likelihood | Risk Level  | Mitigation                                                                                             | Residual Risk |
| ------- | --------- | ------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------ | ------------- |
| HAZ-010 | SYS-002   | Upstream oEmbed rate-limit not detected/classified.           | RATE-LIMITED      | Burst failures appear as generic errors; retries amplify throttling. | Serious  | Occasional | Undesirable | REQ-002, REQ-NF-002; ARCH-006 maps 429 to explicit throttled error; SYS-009 retry policy with backoff. | Tolerable     |
| HAZ-011 | SYS-002   | Caption parser false-positive on non-recipe promotional text. | NORMAL            | Low-quality/incorrect recipe imported.                               | Minor    | Probable   | Tolerable   | REQ-003; ARCH-006 non-empty + recipe-content checks; ARCH-016 payload shape constraints.               | Acceptable    |
| HAZ-012 | SYS-002   | Instagram API contract drift (field rename/removal).          | DEGRADED-UPSTREAM | Import path breaks for valid URLs until adapter update.              | Serious  | Remote     | Tolerable   | REQ-002, REQ-IF-001; ARCH-006 strict response validation + explicit `OEmbedApiError` via ARCH-017.     | Tolerable     |

### SYS-003 — OCR Physical Copy Pipeline

| HAZ ID  | Component | Failure Mode                                                              | Operational State | Effect                                                     | Severity | Likelihood | Risk Level  | Mitigation                                                                                             | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------ | ------------- |
| HAZ-013 | SYS-003   | OCR provider latency spikes without timeout/backoff.                      | DEGRADED-UPSTREAM | Photo import stalls; user abandons flow.                   | Serious  | Occasional | Undesirable | REQ-009, REQ-NF-002; ARCH-007 timeout + retry/backoff; ARCH-017 error normalization for user feedback. | Tolerable     |
| HAZ-014 | SYS-003   | OCR text extraction returns partial content and save proceeds unreviewed. | OCR-REVIEW        | Missing ingredients/instructions persisted as if complete. | Serious  | Occasional | Undesirable | REQ-011; SYS-003 mandatory review-and-correct step before ARCH-008 save path.                          | Tolerable     |

### SYS-004 — Attribution & Visibility Gate

| HAZ ID  | Component | Failure Mode                                                                      | Operational State | Effect                                                         | Severity | Likelihood | Risk Level  | Mitigation                                                                                               | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------- | -------- | ---------- | ----------- | -------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-015 | SYS-004   | Attribution metadata dropped on create/update path.                               | NORMAL            | Legal/compliance exposure for imported public recipes.         | Critical | Occasional | Undesirable | REQ-004, REQ-013; ARCH-011 enforces attribution object for web/Instagram imports before persistence.     | Tolerable     |
| HAZ-016 | SYS-004   | Visibility defaults wrong (web/Instagram saved private or physical saved public). | NORMAL            | Policy violation and inconsistent user-facing behavior.        | Critical | Remote     | Undesirable | REQ-005, REQ-010; ARCH-011 import-type mapping with explicit branch coverage in tests.                   | Tolerable     |
| HAZ-017 | SYS-004   | Clone-and-edit premium gate bypassed.                                             | NORMAL            | Public import becomes private without substantive edit policy. | Critical | Remote     | Undesirable | REQ-006, REQ-007; ARCH-012 enforces premium + substantive-edit preconditions before visibility mutation. | Tolerable     |

### SYS-005 — Deduplication Guard

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                       | Severity | Likelihood | Risk Level  | Mitigation                                                                                              | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------ | -------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-018 | SYS-005   | Duplicate imports created due to race between check and persist.            | NORMAL            | Multiple public copies of same source URL.                   | Serious  | Occasional | Undesirable | REQ-008, REQ-CN-001; ARCH-010 + ARCH-015 enforce atomic dedupe check with unique source-url constraint. | Tolerable     |
| HAZ-019 | SYS-005   | URL canonicalization mismatch (`http/https`, query params, trailing slash). | NORMAL            | False negatives in deduplication; duplicate recipes created. | Serious  | Probable   | Undesirable | REQ-008; ARCH-010 canonicalization before lookup; ARCH-015 normalized source-url index key.             | Tolerable     |

### SYS-006 — Paywall Blocklist Enforcer

| HAZ ID  | Component | Failure Mode                                                         | Operational State | Effect                                                       | Severity | Likelihood | Risk Level  | Mitigation                                                                                                | Residual Risk |
| ------- | --------- | -------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------ | -------- | ---------- | ----------- | --------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-020 | SYS-006   | Paywalled source not detected (blocklist miss).                      | NORMAL            | Copyright/compliance breach via unauthorized import.         | Critical | Occasional | Undesirable | REQ-012, REQ-013, REQ-CN-002; ARCH-009 centralized paywall-domain rules consulted pre-extraction.         | Tolerable     |
| HAZ-021 | SYS-006   | robots.txt disallow ignored during crawler-style fetch path.         | NORMAL            | Terms-of-service violation and source-site abuse complaints. | Serious  | Remote     | Tolerable   | REQ-012, REQ-CN-004; SYS-006 policy gate validates domain-level crawl constraints before import proceeds. | Tolerable     |
| HAZ-022 | SYS-006   | Over-broad blocklist false-positives legitimate free recipe domains. | NORMAL            | Valid imports blocked; user frustration/churn.               | Minor    | Occasional | Tolerable   | REQ-CN-002; ARCH-009 scoped domain matching + monitored allowlist exceptions.                             | Acceptable    |

### SYS-007 — Recipe Persistence Adapter

| HAZ ID  | Component | Failure Mode                                                                    | Operational State | Effect                                                 | Severity | Likelihood | Risk Level  | Mitigation                                                                                         | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------ | -------- | ---------- | ----------- | -------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-023 | SYS-007   | Persistence succeeds but attribution fields omitted in DB write mapping.        | NORMAL            | Attribution not displayed despite successful import.   | Critical | Remote     | Undesirable | REQ-004, REQ-015; ARCH-013 typed mapping contract includes attribution fields for sourced imports. | Tolerable     |
| HAZ-024 | SYS-007   | Partial transaction commit leaves recipe row without required related metadata. | NORMAL            | Inconsistent records; downstream read/render failures. | Serious  | Remote     | Tolerable   | REQ-NF-001; ARCH-013 transactional persistence boundary with rollback on mapping/persist errors.   | Tolerable     |

### SYS-008 — Auth Enforcement Middleware

| HAZ ID  | Component | Failure Mode                                                             | Operational State | Effect                                                   | Severity     | Likelihood | Risk Level  | Mitigation                                                                                                | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------ | ----------------- | -------------------------------------------------------- | ------------ | ---------- | ----------- | --------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-025 | SYS-008   | JWT validation bypass or misconfiguration allows unauthenticated import. | NORMAL            | Unauthorized recipe creation/modification path exposure. | Catastrophic | Improbable | Undesirable | REQ-IF-004; SYS-008 Clerk auth middleware on all import endpoints; ARCH-014 strict token validation path. | Tolerable     |

### SYS-009 — Import Orchestrator

| HAZ ID  | Component | Failure Mode                                                              | Operational State | Effect                                                        | Severity | Likelihood | Risk Level  | Mitigation                                                                                             | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------ | ------------- |
| HAZ-026 | SYS-009   | Step ordering regression (dedupe/attribution checks after persistence).   | NORMAL            | Invalid or duplicate records committed before controls apply. | Critical | Remote     | Undesirable | REQ-NF-001; ARCH-001 orchestrates fixed sequence (paywall → extract → dedupe → attribution → persist). | Tolerable     |
| HAZ-027 | SYS-009   | Error normalization omitted for one path, leaking internal error details. | NORMAL            | Information disclosure and inconsistent client behavior.      | Serious  | Occasional | Undesirable | REQ-NF-004; ARCH-017 centralized error mapping invoked from ARCH-001/ARCH-002.                         | Tolerable     |

## Progressive Deepening (Architecture-Level)

The following hazards emerged from `architecture-design.md` decomposition (18 ARCH modules). They are **appended** to the SYS-level register above and capture failure modes only visible at the ARCH boundary.

| HAZ ID  | Component           | Failure Mode                                                                     | Operational State | Effect                                                                  | Severity | Likelihood | Risk Level  | Mitigation                                                                                     | Residual Risk |
| ------- | ------------------- | -------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------- | -------- | ---------- | ----------- | ---------------------------------------------------------------------------------------------- | ------------- |
| HAZ-028 | ARCH-003 + ARCH-004 | `application/ld+json` parser accepts non-Recipe JSON-LD object as valid recipe.  | NORMAL            | Corrupted recipe payload persisted with wrong semantics.                | Serious  | Occasional | Undesirable | REQ-001; ARCH-004 strict `@type=Recipe` validation; ARCH-003 fallback to ARCH-005 on mismatch. | Tolerable     |
| HAZ-029 | ARCH-002 + ARCH-013 | Unsanitized payload fields pass controller boundary and persist raw HTML/script. | NORMAL            | Stored XSS in downstream recipe rendering clients.                      | Critical | Remote     | Undesirable | REQ-NF-004; ARCH-002 DTO sanitization + ARCH-013 persistence sanitization contract.            | Tolerable     |
| HAZ-030 | ARCH-006 + ARCH-001 | oEmbed adapter timeout returned as success-like empty payload.                   | DEGRADED-UPSTREAM | Empty/low-quality imports created instead of explicit failure response. | Serious  | Remote     | Tolerable   | REQ-002, REQ-NF-002; ARCH-006 throws typed error, ARCH-001 hard-fails and routes via ARCH-017. | Tolerable     |

## Coverage Summary

| Metric                               | Count |
| ------------------------------------ | ----- |
| Total System Components (SYS)        | 9     |
| Components with ≥1 hazard            | 9     |
| Total Hazards                        | 30    |
| Unacceptable risks (post-mitigation) | 0     |
| Undesirable risks (residual)         | 0     |
| Tolerable residual risks             | 24    |
| Acceptable residual risks            | 6     |

Coverage check: **100% of system components (`SYS-001`..`SYS-009`) have at least one hazard.**

## Frozen-Pending-Resolution Tracker

No `[FROZEN-PENDING-RESOLUTION:*]` markers are present in `specs/004-recipe-importing/v-model/system-design.md` at the time of this hazard pass.

## Domain Note (non-regulated)

This artifact intentionally uses a lightweight, general-purpose FMEA profile suitable for consumer SaaS. No regulated safety taxonomy is applied.

## Glossary

- **FMEA**: Failure Mode and Effects Analysis.
- **Residual Risk**: Risk remaining after listed mitigations are applied.
- **Attribution compliance**: Preservation and presentation of source URL/author/platform for web/Instagram imports.
- **SSRF**: Server-Side Request Forgery via attacker-controlled URL inputs.
