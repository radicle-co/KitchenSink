# Sync-Verify Report: Feature 008-cooking-mode

**Date**: 2026-06-02 | **Mode**: Pre-implementation, 7-layer scan | **Read-Only scan — no code modified**

---

## Scan Parameters

| Parameter                 | Value                                             |
| ------------------------- | ------------------------------------------------- |
| Feature absolute          | `specs/008-cooking-mode/`                         |
| Monorepo                  | `packages/apps/commise/{web,mobile}/`             |
| L5 (code ↔ tests)         | **Skipped per directive**                         |
| L6 (missing-impl)         | **INFO** — no code changes performed              |
| `apps/X` refs in tasks.md | Flagged **INFO** (uses legacy monorepo shorthand) |

---

## L1 — Research ↔ Product-Spec ↔ Codebase

**Status**: **PASS**

- `research.md` RQ-1..RQ-8 answer the 8 research questions and flow into `product-spec/product-spec.md`.
- `research/codebase-analysis.md` correctly notes monorepo layout under Turborepo; no workspace topology errors.
- `research/metrics-roi.md` and `product-spec/metrics.md` are cross-referenced; story-level metrics map to FRs.
- Product personas (Casey — beginner/accessibility primary; Taylor — aspiring chef secondary) are traceable to Must Have / Should Have decomposition.

**Evidence**: `product-spec.md` §Personas → Must Have stories FR-032..FR-035; wireframes mirror research RQ-3 navigation UX.

---

## L2 — Spec.md ↔ Plan.md ↔ Tasks.md (Must Have Coverage)

**Status**: **PASS** (no CRITICAL; 1 WARNING)

### Must Have FR coverage

| FR                    | Spec.md | Plan.md | Tasks.md                   | Covered by task |
| --------------------- | ------- | ------- | -------------------------- | --------------- |
| FR-032 (step display) | Y       | Y       | T-008..T-011               | Y               |
| FR-033 (navigation)   | Y       | Y       | T-012..T-015               | Y               |
| FR-034 (timers)       | Y       | Y       | T-003, T-016..T-021        | Y               |
| FR-035 (wake lock)    | Y       | Y       | T-004, T-005, T-022, T-023 | Y               |

### ⚠️ WARNING — Task count divergence

- `tasks.md` header claims **32 tasks**, but dependency graph and body describe **32 tasks** (T-001..T-032) — verified by grep count of `T-N* ·` headers = 32.
- **No orphaned FRs**; all 4 Must Have FRs map to at least one task.
- `product-spec.md` §Must Have claims 5 stories mapped to canonical FRs = 100% coverage, but canonical spec.md only defines FR-032..FR-035 (4 FRs). This is a counting mismatch, not a scope gap.

---

## L3 — V-Model ↔ Spec.md ↔ Plan.md

**Status**: **PASS**

### Requirements ↔ Architecture traceability

| REQ        | SYS parent   | ARCH coverage      | MOD coverage     | Task coverage              |
| ---------- | ------------ | ------------------ | ---------------- | -------------------------- |
| REQ-001    | SYS-001      | ARCH-001..ARCH-003 | MOD-001..MOD-003 | T-010, T-011               |
| REQ-002    | SYS-002      | ARCH-004, ARCH-005 | MOD-004, MOD-005 | T-012, T-014               |
| REQ-003    | SYS-002      | ARCH-004, ARCH-005 | MOD-004, MOD-005 | T-012, T-014               |
| REQ-004    | SYS-003      | ARCH-006, ARCH-007 | MOD-006, MOD-007 | T-003, T-016..T-019        |
| REQ-005    | SYS-003      | ARCH-006, ARCH-007 | MOD-006, MOD-007 | T-003, T-016..T-019        |
| REQ-006    | SYS-003      | ARCH-006, ARCH-008 | MOD-006, MOD-008 | T-020, T-021               |
| REQ-007    | SYS-004      | ARCH-009           | MOD-009          | T-004, T-005, T-022, T-023 |
| REQ-008    | SYS-001      | ARCH-001           | MOD-001          | T-008, T-009               |
| REQ-009    | SYS-001      | ARCH-003           | MOD-003          | T-010, T-011               |
| REQ-010    | SYS-002      | ARCH-005           | MOD-005          | T-014, T-015               |
| REQ-011    | SYS-005      | ARCH-010           | MOD-010          | T-007, T-026, T-027        |
| REQ-IF-001 | SYS-006      | ARCH-011           | MOD-011          | T-006                      |
| REQ-IF-002 | SYS-007      | ARCH-012           | MOD-012          | (implicit auth)            |
| REQ-IF-003 | SYS-001..007 | ARCH-001           | MOD-001          | T-008, T-009 (parity)      |
| REQ-NF-001 | SYS-008      | ARCH-014           | MOD-015          | N/A (build config)         |
| REQ-NF-002 | SYS-008      | ARCH-014           | MOD-015          | N/A (build config)         |
| REQ-NF-003 | SYS-001      | ARCH-002           | MOD-002          | T-028                      |
| REQ-NF-004 | SYS-008      | ARCH-014           | MOD-017          | T-028                      |
| REQ-NF-005 | SYS-001      | ARCH-002           | MOD-002          | T-028                      |
| REQ-CN-001 | SYS-006      | ARCH-011           | MOD-011          | T-006                      |
| REQ-CN-002 | SYS-004      | ARCH-009           | MOD-009          | T-022, T-023               |

- All 14 ARCH modules map to MODs (see `architecture-design.md` ARCH → MOD table).
- `module-design.md` defines 18 MODs; coverage is complete.
- `traceability-matrix.md` Matrix A maps every REQ to AT/AC test cases; all are `⬜ Untested` (pre-implementation expectation).

---

## L4 — Wireframes ↔ User-Journey ↔ Acceptance-Plan ↔ Plan.md

**Status**: **PASS**

| Wireframe                   | Journey seq            | Acceptance AT         | Plan §                                |
| --------------------------- | ---------------------- | --------------------- | ------------------------------------- |
| `cook-step.md`              | Journey A step display | AT-008-A (ATS-A1..A3) | §4 Frontend Components, §6 Typography |
| `cook-timer.md`             | Journey A timer start  | AT-008-D (ATS-D1..D4) | §5 Timer Component                    |
| `cook-completed.md`         | Journey A completion   | —                     | §4                                    |
| `cook-ingredients-panel.md` | —                      | —                     | (Phase-2 optional; not in Must Have)  |
| `cook-voice-control.md`     | —                      | —                     | §5 Voice Control (Phase 3)            |

- All wireframe Must Have content is represented in acceptance plan.
- Navigation UX diagram in `plan.md` §4 matches `cook-step.md` layout (tap zones, step dots).
- Voice control wireframe (`cook-voice-control.md`) and ingredients panel are Phase-2/Phase-3 scoped; they trace to Should Have / Could Have stories and do not affect Must Have alignment.

---

## L5 — Code ↔ Tests (Skipped)

**Status**: **SKIPPED**

- Directive: `L5 skip`.
- Reason: Pre-implementation scan; no implementation or test code exists to verify.

---

## L6 — Missing-Impl Coverage (INFO)

**Status**: **INFO**

### Monorepo code survey

- `packages/apps/commise/web/src/` — **No `features/cooking-mode/` directory.** Existing code: auth-only middleware, pages, components, hooks, lib, types (all Clerk-related).
- `packages/apps/commise/mobile/src/` — **No `features/cooking-mode/` directory.** Existing code: auth-only screens, components, hooks, services, storage.
- `packages/shared/cooking/` — **Does not exist.** `packages/shared/` itself is present and ships `recipe-core`, `identity-core`, `identity-db`, and `clerk-verify`; the missing target is the planned `cooking` package. No shared cooking types, session store, timer service, or wake lock utilities found.
- `packages/apps/commise/web/package.json` — `expo-keep-awake` **not present**; no cooking-mode deps.
- `packages/apps/commise/mobile/package.json` — `expo-keep-awake` **not present**.

### Task implementation status (all 32 tasks NOT STARTED)

| Task  | Target file (from tasks.md)                                                | Exists?                        |
| ----- | -------------------------------------------------------------------------- | ------------------------------ |
| T-001 | `packages/shared/cooking/src/types.ts`                                     | No (`shared/cooking/` missing) |
| T-002 | `packages/shared/cooking/src/session-store.ts`                             | No                             |
| T-003 | `packages/shared/cooking/src/timer-service.ts`                             | No                             |
| T-004 | `packages/shared/cooking/src/wake-lock.ts`                                 | No                             |
| T-005 | `packages/shared/cooking/src/wake-lock-rn.ts`                              | No                             |
| T-006 | `packages/shared/cooking/src/recipe-api.ts`                                | No                             |
| T-007 | `packages/shared/cooking/src/offline-cache.ts`                             | No                             |
| T-008 | `apps/web/src/features/cooking-mode/CookingModeScreen.tsx`                 | No                             |
| T-009 | `apps/mobile/src/features/cooking-mode/CookingModeScreen.tsx`              | No                             |
| T-010 | `apps/web/src/features/cooking-mode/StepDisplay.tsx`                       | No                             |
| T-011 | `apps/mobile/src/features/cooking-mode/StepDisplay.tsx`                    | No                             |
| T-012 | `apps/web/src/features/cooking-mode/StepNavigation.tsx`                    | No                             |
| T-013 | `apps/mobile/src/features/cooking-mode/StepNavigation.tsx`                 | No                             |
| T-014 | Web gesture wiring                                                         | No                             |
| T-015 | Mobile gesture wiring                                                      | No                             |
| T-016 | `apps/web/src/features/cooking-mode/TimerBadge.tsx`                        | No                             |
| T-017 | `apps/mobile/src/features/cooking-mode/TimerBadge.tsx`                     | No                             |
| T-018 | `apps/web/src/features/cooking-mode/ActiveTimers.tsx` + `TimerCard.tsx`    | No                             |
| T-019 | `apps/mobile/src/features/cooking-mode/ActiveTimers.tsx` + `TimerCard.tsx` | No                             |
| T-020 | Web timer alert wiring                                                     | No                             |
| T-021 | Mobile timer alert wiring                                                  | No                             |
| T-022 | Web wake-lock screen integration                                           | No                             |
| T-023 | Mobile wake-lock screen integration                                        | No                             |
| T-024 | Web session resume                                                         | No                             |
| T-025 | Mobile session resume                                                      | No                             |
| T-026 | Web offline handling                                                       | No                             |
| T-027 | Mobile offline handling                                                    | No                             |
| T-028 | Accessibility audit                                                        | No                             |
| T-029 | Keyboard navigation (web)                                                  | No                             |
| T-030 | Voice control (web)                                                        | No                             |
| T-031 | Voice control (mobile)                                                     | No                             |
| T-032 | E2E tests (Playwright / Detox)                                             | No                             |

**Assessment**: Expected pre-implementation gap. No implementation files exist; this is consistent with `.forge-status.yml` showing `implement: not-started`.

---

## L7 — Cross-File Consistency & Drift Check

**Status**: **PASS** (1 INFO)

### Identified drift

| Check          | Finding                                                                                                                                                              | Severity                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| FR count       | `product-spec.md` claims 5 Must Have stories mapped to canonical FRs, but `spec.md` only defines FR-032..FR-035 (4 FRs)                                              | INFO                     |
| Path shorthand | `tasks.md` uses `apps/web/…` and `apps/mobile/…` shorthand, but actual monorepo paths are `packages/apps/commise/web/src/…` and `packages/apps/commise/mobile/src/…` | INFO                     |
| Workspace      | Root `package.json` workspaces include `packages/apps/commise/web` and `packages/apps/commise/mobile`, so the shorthand is unambiguous in Turborepo context.         | —                        |
| Package deps   | `expo-keep-awake` referenced in T-005 but absent from `mobile/package.json`                                                                                          | INFO (expected pre-impl) |

---

## Summary

| Layer                                       | Status      | Notes                                                      |
| ------------------------------------------- | ----------- | ---------------------------------------------------------- |
| L1 Research ↔ Product-Spec ↔ Codebase       | **PASS**    | Consistent, no gaps                                        |
| L2 Spec ↔ Plan ↔ Tasks (Must Have)          | **PASS**    | All 4 Must-Have FRs covered; 1 WARNING (FR-count mismatch) |
| L3 V-Model ↔ Spec ↔ Plan                    | **PASS**    | REQ→SYS→ARCH→MOD fully traceable; all AT/AC mapped         |
| L4 Wireframes ↔ Journey ↔ Acceptance ↔ Plan | **PASS**    | Visual + behavioral alignment confirmed                    |
| **L5 Code ↔ Tests**                         | **SKIPPED** | Per directive                                              |
| **L6 Missing-Impl**                         | **INFO**    | 0/32 tasks started; 0 cooking-mode source files exist      |
| L7 Cross-File Consistency                   | **PASS**    | 2 INFO items (FR-count drift, path shorthand)              |

**Overall**: All scanned layers pass. No CRITICAL findings. Feature is ready for implementation initiation.
