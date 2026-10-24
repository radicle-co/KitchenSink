# Product Forge Revalidation Log: Feature 008

**Branch**: `008-cooking-mode`
**Created**: 2026-05-09
**Status**: Pending initial human review
**Mode**: Retroactive bootstrap

## Milestone Assignment

- **Milestone**: `M3` Rohan
- **Public launch**: Beta
- **Source of truth**: ../v1-launch-plan.md
- **Last updated**: 2026-08-02

---

## Purpose

This file records the iterative revalidation cycle for the Product Forge layer of feature 008. Each revision captures user feedback, the corrections applied, and an explicit approval marker.

This feature was **retroactively bootstrapped** — the SpecKit + V-Model artifacts already existed before Product Forge was layered on. Revalidation here therefore focuses on:

1. Whether the synthesized `research/` and `product-spec/` artifacts faithfully reflect the existing `spec.md`, `plan.md`, `research.md`, `tasks.md`, and `v-model/requirements.md`.
2. Whether the new artifacts surface any gaps, contradictions, or stale assumptions in the upstream artifacts.
3. Whether the Must Have / Should Have / Could Have decomposition in `product-spec/product-spec.md` matches the user's intended cooking-mode scope.

---

## Revision Log

### Revision 0 — Initial Bootstrap (2026-05-09)

**Author**: Sisyphus (Product Forge bootstrap)
**Trigger**: User-requested retroactive bootstrap for feature 008 using the 001 pattern.

**Artifacts produced**:

- [research/competitors.md](./research/competitors.md)
- [research/ux-patterns.md](./research/ux-patterns.md)
- [research/codebase-analysis.md](./research/codebase-analysis.md)
- [research/tech-stack.md](./research/tech-stack.md)
- [research/metrics-roi.md](./research/metrics-roi.md)
- [product-spec/product-spec.md](./product-spec/product-spec.md)
- [product-spec/user-journey.md](./product-spec/user-journey.md)
- [product-spec/wireframes/](./product-spec/wireframes/)
- [product-spec/metrics.md](./product-spec/metrics.md)

**Synthesis sources**:

| Bootstrapped File    | Primary Source(s)                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| competitors.md       | `research.md` RQ-1 competitor survey, user-specified competitor set (Paprika/SideChef/Yummly/Kitchen Stories) |
| ux-patterns.md       | `research.md` RQ-3/RQ-6, `plan.md` navigation + accessibility sections                                        |
| codebase-analysis.md | root `package.json`, `AGENTS.md`, `plan.md` platform/workspace targets                                        |
| tech-stack.md        | `research.md` RQ-2/RQ-4/RQ-5/RQ-7/RQ-8, `plan.md` sections 1..9                                               |
| metrics-roi.md       | `spec.md` FR/NFR/SC, `v-model/requirements.md` REQ and REQ-NF mappings                                        |
| product-spec.md      | `spec.md` story + FR-032..FR-035, `plan.md` component/behavior model, `v-model/requirements.md`               |
| user-journey.md      | `spec.md` acceptance scenarios and edge case, `plan.md` session/timer/wake-lock flows                         |
| wireframes/          | `spec.md` FRs, `plan.md` navigation/timer architecture, user-requested wireframe screen set                   |
| metrics.md           | `spec.md` SC/NFR set + `v-model/requirements.md` verification methods                                         |

**Traceability notes**:

- Every story in `product-spec/product-spec.md` references at least one canonical FR from `spec.md`.
- Added warnings (not blockers) where requirements implied by research/plan are not explicit FRs in `spec.md`.
- No changes were made to `spec.md`, `plan.md`, `tasks.md`, or `v-model/requirements.md`.

---

## Pending Reviewer Questions

1. ~~Should voice control remain **Should Have** for v1?~~ → **Answered 2026-08-05: remains Should Have.** US-006 is not promoted.
2. ~~Should ingredient checkoff and cook-time scaling remain **Should Have** until explicit FRs are added?~~ → **Answered
   2026-08-05: both promoted into v1 scope**, with new backing requirements `FR-032a` (checkoff) and `FR-034a` (scaling).
3. ~~Should cross-device sync remain **Out of Scope**?~~ → **Answered 2026-08-05: yes, out of scope.** The speculative
   `CookingSessionEvent` WebSocket sketch was removed from `plan.md` §3.

---

### Revision 1 — Reconciliation against shipped `main` (2026-08-05)

**Trigger**: `/speckit.product-forge.forge` resumed feature 008 at the revalidation gate. Pre-flight compared the artifacts —
last reconciled at the FR level on 2026-08-02 (`472e1773`) — against the **shipped** codebase. The FR layer was sound; the
**architecture layer had never been reconciled**, and eight defects were found. All are corrected in this revision.

| #   | Defect                                                                                                                                                                              | Severity                                                                                                                                                                                                           | Correction                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 7 tasks placed feature UI in `@commise/ui` (the design system: `button`, `input`, `surface`, `tokens`, …). Cross-platform feature UI ships from `packages/apps/commise/features/*`. | High — inverts the dependency direction, makes the design system depend on recipe domain types                                                                                                                     | Retargeted to `packages/apps/commise/features/cooking/src/` (`@commise/features-cooking`); placement rule recorded in `plan.md` §1                                         |
| 2   | `plan.md` defined a local `RecipeInstruction` type                                                                                                                                  | **CRITICAL** — direct GR-007 AC-007-d violation ("defining a local copy of any of these types is prohibited")                                                                                                      | Imports the shipped `RecipeStep` from `@kitchensink/recipe-core`, which already carries `stepNumber`, `instruction`, and `timerSeconds` (spec.md D-003)                    |
| 3   | Unit mismatch: planned `durationMinutes` vs shipped `timerSeconds`                                                                                                                  | High — silently produces timers 60× wrong                                                                                                                                                                          | `RecipeStep.timerSeconds` is the single authority; converted to ms once, at timer construction                                                                             |
| 4   | `completedSteps: Set<number>` on a session persisted as JSON                                                                                                                        | High — `JSON.stringify(new Set())` is `{}`; every completed step is silently lost on resume, and only after a real interruption                                                                                    | Typed `number[]`; a JSON round-trip test is required (T-001, T-017)                                                                                                        |
| 5   | `wake-lock.ts` registered `document.addEventListener` **at module scope**                                                                                                           | High — `@commise/web` server-renders, so importing the module under SSR throws `ReferenceError: document is not defined`; the listener also leaked and re-acquired the lock long after exit                        | Rewritten as `acquireWakeLock()` returning a disposer that removes the listener and releases the sentinel; SSR import-safety is an explicit test                           |
| 6   | `wake-lock-rn.ts` + `KeepAwake.activate()`                                                                                                                                          | High — `-rn` is not a suffix Metro resolves (mobile would silently fall through to the web path, so FR-035 would not work on device), and `activate()`/`deactivate()` are not exported by `expo-keep-awake@57.0.1` | `wakeLock.native.ts` using `activateKeepAwakeAsync(tag)` / `deactivateKeepAwake(tag)`                                                                                      |
| 7   | `plan.md` §3 specified `GET /api/v1/recipes/{id}/instructions`                                                                                                                      | Medium — phantom contract; the route does not exist in `recipes.controller.ts`                                                                                                                                     | Removed. Cooking Mode reads the existing `GET /api/v1/recipes/{id}` detail payload, which already embeds `steps: RecipeStepView[]`. **No endpoint and no service change.** |
| 8   | Task list had unit tests only — no component, Playwright, Maestro, or integration tasks                                                                                             | High — cannot satisfy the repository testing policy, so the feature could never be "done"                                                                                                                          | Added T-018 (component, every state), T-019 (Playwright web), T-020 (Maestro mobile), T-021 (integration); T-017…T-021 marked `Test-first: true`                           |

**Additional scope resolution.** `tasks.md` T-016 specified "timer recalculation" while US-009 specified scaling _guidance_ —
a contradiction. Resolved in favour of US-009 (spec.md **D-002**): cook time does not scale linearly with yield, so auto-scaling
timers would emit incorrect and potentially unsafe cooking instructions. `FR-034a` scales **quantities only** and requires an
advisory. This also aligns with the pre-existing `REQ-CN-001` (Cooking Mode must not modify Recipe data).

**Artifacts changed**: `spec.md` (FR-032a, FR-034a, scenarios 6–7, Key Entities, D-001…D-003), `plan.md` (§1–§5),
`tasks.md` (T-000 added, 7 tasks retargeted, T-004/T-005/T-011/T-015/T-016 corrected, T-018…T-021 added),
`product-spec/product-spec.md` (US-008/009 promoted), `v-model/requirements.md` (REQ-012…REQ-015),
`v-model/traceability-matrix.md` (4 rows).

**Known remaining gap (blocks implementation, not this gate):** `REQ-012`…`REQ-015` are recorded in the matrix as
`❌ MISSING` acceptance coverage, matching the existing convention for `REQ-009`, `REQ-010`, `REQ-NF-001`, `REQ-NF-002`. The
V-Model V3/V5/V7/V9 artifacts (`acceptance-plan.md`, `system-test.md`, `integration-test.md`, `unit-test.md`) must be
regenerated to cover the four new requirements before implementation begins. Coverage was **not** fabricated here.

---

## Approval Marker

- [x] **Approved by human reviewer**
    - Name: Brandon (repository owner)
    - Date: 2026-08-07
    - Notes / requested changes: Approved at the Phase 3 gate covering Revision 1 in full — the three reviewer answers
      (US-008/US-009 promoted; voice control stays Should Have; cross-device sync stays out of scope), the eight
      architecture-layer corrections, and the D-002 ruling that scaling applies to quantities only. `feature_mode` resolved to
      `v-model`. Approval is explicitly conditional on the known gap below being closed **before** implementation: the V-Model
      V3/V5/V7/V9 artifacts must be regenerated to cover `REQ-012`…`REQ-015`, then V10 trace re-run. No acceptance coverage was
      fabricated to clear this gate.

`revalidation` is `approved` in `.forge-status.yml` as of 2026-08-07.
