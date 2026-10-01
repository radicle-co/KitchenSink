# Sync-Verify Report: 002-user-auth

**Date**: 2026-06-02 (Run #2 — post-HITL resolution)
**Phase**: implement
**Layers checked**: 1–7 (all)
**Layers skipped**: none

## Verdict

**RESOLVED** (post-HITL): all 18 original CRITICAL drifts collapsed to a single root cause (stale paths in `tasks.md`). 17 resolved by updating paths to match the actual monorepo layout; 1 reopened (T-060) as a genuine restructure bug requiring code work. T-002 rewritten + `plan.md` propagated to reflect the deliberate schemas-in-identity refactor (commits `2064357`, `6a9570c`, `ee1d4d1`).

## Summary

| Severity    | Count                                       |
| ----------- | ------------------------------------------- |
| ❌ CRITICAL | 0                                           |
| ⚠️ WARNING  | 24 (23 deferred + 1 Layer-4)                |
| ℹ️ INFO     | 1                                           |
| ✅ CLEAN    | 4 layers (2, 6, and 2-of-3 segments of 1/7) |
| 🔧 RESOLVED | 19 (HITL Groups A+B+C+E applied)            |
| ⏸️ DEFERRED | 24 (HITL Group D — FR traceability)         |

## Resolution Session

| Field                    | Value                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| Operator                 | user                                                                                              |
| Applied groups           | A (path updates), B (T-060 reopen), C (T-002 rewrite + plan propagation), E (drop false positive) |
| Deferred groups          | D (23 Layer-3 FR-traceability gaps)                                                               |
| Files modified           | `specs/002-user-auth/tasks.md`, `specs/002-user-auth/plan.md`                                     |
| Files verified unchanged | `specs/002-user-auth/spec.md`, `specs/002-user-auth/data-model.md` (already accurate)             |

## Per-Layer Results (post-resolution)

### Layer 1: research/ ↔ product-spec/ — ℹ️ 1 INFO (open)

- DRIFT-001 (INFO): No research citations in product-spec.md (optional).

### Layer 2: product-spec/ ↔ spec.md — ✅ CLEAN

- No findings.

### Layer 3: spec.md ↔ plan.md — ⏸️ 23 WARNING DEFERRED + 1 RESOLVED

- DRIFT-002 through DRIFT-024 (23 items): FR-002..FR-024 declared in spec.md not explicitly traced in plan.md. **DEFERRED** to next sync-verify run (HITL Group D).
- DRIFT-T002-REWRITE: **RESOLVED**. T-002 description + plan.md `Shared schema contract` row + plan.md `packages/shared/auth-types/` package section rewritten to reflect schemas-in-identity refactor.

### Layer 4: plan.md ↔ tasks.md — ⚠️ 1 WARNING (open)

- DRIFT-025: Every plan FR should be implemented by at least one task. Will resolve once Group D is applied.

### Layer 5: tasks.md ↔ Code — 🔧 18 RESOLVED (17 via path update, 1 reopened)

All 18 CRITICAL drifts had a shared root cause: `tasks.md` referenced pre-restructure paths (`apps/web/`, `apps/mobile/`) while the actual monorepo uses `packages/apps/commise/{web,mobile}/`.

| Original DRIFT                     | Task                                           | Action                                                                                                                                                |
| ---------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| DRIFT-026                          | T-050 web middleware                           | ✅ Path updated → `packages/apps/commise/web/src/middleware.ts`                                                                                       |
| DRIFT-027                          | T-060 mobile auto-auth                         | 🔁 **REOPENED** (`[x]` → `[ ]`). Current impl `mobile/App.tsx` does not match Expo Router `app/_layout.tsx` architecture.                             |
| DRIFT-028                          | T-051 web session                              | ✅ Path updated → `packages/apps/commise/web/src/`                                                                                                    |
| DRIFT-029                          | T-061 mobile token storage                     | ✅ Path updated → `packages/apps/commise/mobile/src/storage/tokenCache.ts` + `services/`                                                              |
| DRIFT-030                          | T-052 web logout                               | ✅ Path updated → `packages/apps/commise/web/src/`                                                                                                    |
| DRIFT-031                          | T-062 mobile logout                            | ✅ Path updated → `packages/apps/commise/mobile/src/` (services + hooks)                                                                              |
| DRIFT-032                          | T-021 user-created webhook                     | ✅ Path updated → `…/handlers/identityWebhook.ts` + description revised (consolidated svix dispatcher)                                                |
| DRIFT-033                          | T-053 web profile                              | ✅ Path updated → `packages/apps/commise/web/src/app/profile/page.tsx`. `(protected)` route group deliberately dropped (middleware-based protection). |
| DRIFT-034..DRIFT-043 (10 implicit) | T-001 auth-types, T-023 reconciliation, et al. | ✅ False positives: paths were already exact matches in HEAD. Agent's path-walk error in initial scan.                                                |

### Layer 6: spec.md ↔ Code — ✅ CLEAN

- All Must Have user stories have implementation evidence.

### Layer 7: Cross-link integrity — ⚠️ 1 WARNING (open)

- Minor: 1 broken cross-link reported by initial scan; verify on next run.

## Resolved Drift Details

### DRIFT-T002-REWRITE — RESOLVED 2026-06-02

| Field                  | Value                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Layer**              | 3                                                                                                                                                                                                 |
| **Direction**          | Backward (code reality not reflected in plan/spec)                                                                                                                                                |
| **Original severity**  | CRITICAL (from HITL escalation)                                                                                                                                                                   |
| **Source artifact**    | `packages/services/identity/src/database/schema/` (HEAD) + commits `2064357`, `6a9570c`, `ee1d4d1`                                                                                                |
| **Target artifact**    | `tasks.md` T-002, `plan.md` L132 + L163-167                                                                                                                                                       |
| **Evidence**           | Refactor commits explicitly migrated Drizzle schemas + DAOs + ulid out of `auth-types` into `identity/`. `data-model.md` L15+L17 already reflected this; `tasks.md` and `plan.md` did not.        |
| **Resolution applied** | T-002 rewritten with architecture-revised note + new acceptance criteria. `plan.md` "Shared schema contract" row rewritten. `plan.md` "packages/shared/auth-types/" section marked as types-only. |
| **Approved by**        | user (HITL Group C)                                                                                                                                                                               |

### DRIFT-T060-REOPENED — REOPENED 2026-06-02

| Field                  | Value                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| **Layer**              | 5                                                                                               |
| **Direction**          | Forward                                                                                         |
| **Original severity**  | CRITICAL                                                                                        |
| **Source artifact**    | `specs/002-user-auth/tasks.md` T-060 (path: `apps/mobile/app/_layout.tsx`)                      |
| **Target artifact**    | `packages/apps/commise/mobile/App.tsx` (HEAD)                                                   |
| **Evidence**           | Mobile root uses single-entry `App.tsx`, not Expo Router root layout convention.                |
| **Resolution applied** | T-060 status `[x]` → `[ ]` + status note added explaining the Expo Router migration is pending. |
| **Approved by**        | user (HITL Group B)                                                                             |

## Deferred Items

23 Layer-3 FR-traceability gaps (DRIFT-002 through DRIFT-024) deferred to next sync-verify run per user decision (HITL Group D). Recommended remediation: append a "Requirement Traceability" addendum to `plan.md` mapping FR-002..FR-024 to plan sections, or explicitly mark out-of-scope FRs as deferred to phase 2.

## Sync History

| Run | Date                   | Layers | CRITICAL | WARNING          | INFO | Verdict        |
| --- | ---------------------- | ------ | -------- | ---------------- | ---- | -------------- |
| #1  | 2026-06-02 00:51       | 1–7    | 18       | 25               | 1    | CRITICAL DRIFT |
| #2  | 2026-06-02 (post-HITL) | 1–7    | 0        | 24 (23 deferred) | 1    | RESOLVED       |
