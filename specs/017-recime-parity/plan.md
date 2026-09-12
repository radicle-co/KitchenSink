# Implementation Plan: ReciMe Parity

**Branch**: `chore/code-quality-enforcement-phase-1-2` | **Date**: 2026-08-22 | **Spec**: [`spec.md`](./spec.md)
**Input**: Feature specification from `/specs/017-recime-parity/spec.md`

> **Branch note.** Spec Kit resolves features from a numeric branch prefix
> (`common.sh:146 find_feature_dir_by_prefix`), so `setup-plan.sh` refuses this branch. The standing owner
> directive is to land on the open branch and never split, so the script's work (`mkdir`, template copy) was
> performed directly against the directory in `.specify/feature.json`. **`.specify/feature.json` is a shared
> singleton** — another session is working `016`, and it must re-point the file before its own Spec Kit run.

## Summary

Close the ReciMe capability gaps as a **delta** across seven owner specs: a five-tier video-import waterfall
and the capture surfaces that reach it, two-way library portability, a kitchen-grade cook mode, and household
as a first-class ownership boundary.

> **Re-planned 2026-08-22** after `/speckit-clarify` answered five questions (spec now 47 FRs). The
> clarifications added a notification dependency, an authorization layer and a durability rule — all three are
> resolved in Phase 0 as R-08…R-11, and **none of them blocks the increment order below**.

Phase 0 ([`research.md`](./research.md)) changed the shape of this materially. **Three of the gap analysis's
premises did not survive contact with the code**: the unstated-quantity representation already ships
(`ABSENT_QUANTITY`, R-01), a contracted GDPR export already ships (R-02), and the Bedrock client and
ADR-0024 spend ceiling already exist (R-03). What is genuinely green-field is **one subsystem** — the
waterfall — plus unit conversion, dark mode, a PDF renderer, an importer for our own export format, and the
household entity. The technical approach is therefore: **model the household first** (the one-way door), then
build the waterfall as a Chain of Responsibility over a shared `Capture`, and treat everything else as
extension of shipped code.

## Technical Context

**Language/Version**: TypeScript 5.x, strict; Node 24 (repo requires v24 — shell defaults to 18)
**Primary Dependencies**: NestJS 11 + Drizzle (`recipe-service`), Next.js 15 / React 19 (`web`), Expo 57 / RN 0.86 (`mobile`), zod (authored contracts), `@kitchensink/recipe-core`, `@kitchensink/recipe-import-core`, `@kitchensink/bedrock-client`, TanStack Query; **`014-FR-001` notification publish** (new dependency from clarification Q5)
**Storage**: RDS PostgreSQL 18, Drizzle ORM; S3 for version archive. **No new datastore.**
**Testing**: vitest (unit / `.integration.test.ts` / `.e2e.test.ts`), Playwright (`.spec.ts`, web), Maestro (mobile), k6 (service load)
**Target Platform**: Web (Next.js on Vercel), iOS + Android (Expo), ECS/Fargate services, Lambda workers
**Project Type**: Monorepo — npm workspaces + Turborepo; web + mobile + services
**Performance Goals**: SC-003a share→acceptance under 2 s median (any tier); SC-003b share→draft under 20 s median for tier 1–2 captures; SC-001 ≥80 % extraction on the adversarial corpus; SC-002 ≥60 % on caption-less + speech-less; SC-012 no single platform >50 % of the corpus
**Constraints**: ADR-0024 single monthly spend ceiling (prod); GR-005 forbids ad-hoc offline design; `016-FR-027` forbids persisting third-party image bytes; `001-FR-044a` lockstep web+mobile; extension limited to **`activeTab`** (FR-014); retrieval is **user-directed only** — no crawl, batch, rotation or UA spoofing (FR-001a); ADR-0024's settle is **never retried**
**Scale/Scope**: 50 FRs across 8 owner specs (`014` added by clarification Q5), 3 backend services, 2 client apps, 1 new browser extension surface

**NEEDS CLARIFICATION** (tracked as U-1…U-4 in `research.md`; none blocks Increments 1–2):

- **U-1** per-import inference cost for tiers 3–4 against ADR-0024's ceiling
- **U-2** whether transient frame decode is a reproduction (`016` owns)
- **U-3** offline convergence rule for a shared list (`docs/offline-strategy.md`, GR-005 AC-005-d)
- **U-4** `006-FR-032` idempotency under concurrent household editors (`006` owns)

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #    | Principle                           | Status                 | Notes                                                                                                                                                                                                                                                                                                                         |
| ---- | ----------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I    | **Correctness & Type Safety**       | ☑ Pass                 | Waterfall results are a discriminated union per tier; `IngredientQuantity` is reused, not re-declared (R-01). ISO-8601 strings at every interface.                                                                                                                                                                            |
| II   | **Readability & JSDoc**             | ☑ Pass                 | Named exports; JSDoc on all exports; each tier adapter documents `@sideEffect`.                                                                                                                                                                                                                                               |
| III  | **Code Organization & Imports**     | ☑ Pass                 | New shared logic in `packages/shared/recipe-import-core`; no `helpers/`; `.js` on relative imports under NodeNext, extensionless in `@commise/web`. Household role enforcement lands in `household/domain/householdPolicy.ts` beside the three existing policy modules (R-09), **not** a Guard — the layer ADR-0023 ruled on. |
| IV   | **Testing Discipline**              | ⚠️ Pass with attention | Pyramid holds, but the adversarial corpus (SC-001/SC-002) is an **integration** asset and must not inflate the ≤20 % band — see Complexity Tracking. Playwright `getByRole`/`getByLabel` only.                                                                                                                                |
| V    | **Monorepo & Workspace Governance** | ⚠️ **Deviation**       | The browser extension (FR-014) is a **new workspace and a third distribution surface**. Must extend shared tooling and be declared in Turbo. See Complexity Tracking.                                                                                                                                                         |
| VI   | **Formatting & Tooling**            | ☑ Pass                 | Shared Prettier/ESLint; `generate:types` before build; hooks active.                                                                                                                                                                                                                                                          |
| VII  | **Accessibility & UX Consistency**  | ☑ Pass                 | Dark mode via design tokens only (FR-027); NFR-004 applies to tier badges, confidence, and household attribution; voice is additive with tap authoritative.                                                                                                                                                                   |
| VIII | **Cross-Platform Parity**           | ⚠️ **Waiver required** | FR-014 ships to desktop browsers only and has no mobile peer. Recorded below as the constitutional waiver Principle VIII demands.                                                                                                                                                                                             |

## Project Structure

### Documentation (this feature)

```text
specs/017-recime-parity/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0 — R-01…R-07, U-1…U-4
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   ├── capture.md
│   ├── household.md
│   └── portability.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks — NOT created here
```

### Source Code (repository root)

```text
packages/shared/
├── recipe-core/src/
│   ├── ingredientQuantity.ts        # REUSED unchanged (R-01)
│   ├── scaling.ts                   # REUSED unchanged — absent-safe
│   └── units/                       # NEW — FR-026 metric ⇄ imperial, display-only
├── recipe-import-core/src/
│   ├── ingredientLine.ts            # REUSED — terminal parse of every tier
│   └── capture/                     # NEW — the waterfall
│       ├── captureChain.ts          #   Chain of Responsibility, tier order + short-circuit
│       ├── tiers/{caption,transcript,frameText,vision,sourceSite}.ts
│       ├── captureResult.ts         #   per-field provenance + per-tier cost
│       └── channel.ts               #   016-FR-028 classification
└── household-core/                  # NEW workspace — FR-030…FR-032 invariants, pure

packages/services/recipe-service/src/
├── account/                         # REUSED — export.service/dal/mappers (R-02)
├── recipes/import/                  # NEW — capture endpoints, quota, provenance
├── household/                       # NEW — membership, seats, invite lifecycle
│   └── domain/householdPolicy.ts    #   pure role policy (R-09), sibling of visibilityPolicy
└── database/migrations/             # NEW — households, memberships; EXPAND-FIRST (ADR-0022)

packages/services/recipe-workers/src/handlers/
├── verifyLine.ts                    # REUSED — ADR-0024 reserve-then-settle precedent
└── captureWorker.ts                 # NEW — tiers 2–4; resumes at first tier with no row (R-11)

packages/apps/commise/
├── features/recipes/src/
│   ├── capture/                     # NEW — shared orchestration hooks (web + mobile)
│   ├── export/                      # NEW — FR-019 document rendering
│   └── units/                       # NEW — conversion presentation
├── web/                             # share-target manifest, dark theme, cook mode
├── mobile/                          # share extension (.native.*), voice, cook mode
└── ui/                              # dark-mode tokens (FR-027)

packages/extension/                  # NEW WORKSPACE — FR-014, Chrome first (waiver)
```

**Structure Decision**: Shared-code-first per Principle VIII. All capture, household, unit and export logic
lands in `packages/shared/*` and `features/recipes`, consumed by both apps; only the share-target registration
and voice/speech bindings fork via `.native.*`. The waterfall lives in `recipe-import-core` beside the parser
it terminates in, so no new service owns extraction. The extension is the sole new workspace.

## Implementation Increments

Ordered by **risk and dependency**, not by story priority — per the spec's own closing note.

| #     | Increment                                                       | Delivers                                                                                              | Gated on                                                                              |
| ----- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **0** | Household model, migration, `householdPolicy`, erasure transfer | FR-030, FR-030a/b/c, FR-031, FR-032, FR-032a/b/c, FR-034                                              | — design first; one-way door (R-07). Touches `accountErasureWorker` (R-12).           |
| **1** | Capture chain, tiers 1–2 + 5, share sheet, in-app completion    | FR-001, FR-001a/b, FR-002, FR-005, FR-007, FR-008, FR-009, FR-011a/b, FR-012, FR-013, FR-013a, FR-015 | **Nothing.** R-08 binds FR-013a to the in-app surface, mandatory regardless of `014`. |
| **2** | Portability                                                     | FR-016…FR-020                                                                                         | R-02 reuse                                                                            |
| **3** | Kitchen — timers, units, dark mode, step ingredients            | FR-021/022/023/026/027/035/036                                                                        | —                                                                                     |
| **4** | Tiers 3–4 (frame OCR + vision)                                  | FR-003, FR-004, FR-010, FR-011, FR-037, FR-038, FR-039                                                | **U-1 cost model, U-2 legal ruling in `016`**                                         |
| **5** | Offline + shared list + voice                                   | FR-024/025/028/029/033                                                                                | **U-3 `docs/offline-strategy.md`**                                                    |
| **6** | Browser extension (`activeTab`)                                 | FR-014                                                                                                | Increment 1                                                                           |
| **7** | Push binding for completion                                     | FR-013a via `014-FR-001`                                                                              | `014` existing at all — it has **no package today**                                   |

Increments 0–3 are unblocked today. Increment 0 is design-first and blocks nothing but must not be retrofitted.
Increment 7 is deliberately last and additive: the completion signal ships in-app in Increment 1, and push
becomes a second binding of the same publisher port once `014` exists.

## Complexity Tracking

| Violation                                                            | Why Needed                                                                                                                                                                                                                 | Simpler Alternative Rejected Because                                                                                                                                                                                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Principle VIII waiver — FR-014 browser extension is desktop-only** | ReciMe's extension has 30,000 users and is a primary capture path on desktop, where no mobile peer can exist. Registering the constitutional waiver Principle VIII requires.                                               | "Ship it to mobile too" is not implementable — mobile browsers have no extension surface; the mobile peer of this capability is the share sheet (FR-012), which ships in the same increment.                                                      |
| **Principle V — a new `packages/extension` workspace**               | An extension has its own manifest, build target and store review; it cannot live inside `@commise/web`.                                                                                                                    | Folding it into the web app would put a store-reviewed artifact inside a Vercel deployment and break both build targets.                                                                                                                          |
| **Principle IV — adversarial corpus is a large integration asset**   | SC-001/SC-002 are only meaningful against real videos; a mocked fixture cannot measure extraction accuracy.                                                                                                                | Unit-testing each tier in isolation proves the tier calls its adapter, not that the waterfall extracts a recipe — precisely the mocked-boundary blind spot CLAUDE.md §7.1 names. Corpus runs are excluded from the pyramid ratio and gated to CI. |
| **FR-013a ships in-app before `014` exists**                         | The spec requires a user with notifications denied to still find their draft, so an in-app completion surface is mandatory regardless. Building push first delivers the optional half and leaves the required half undone. | Blocking Increment 1 on `014` builds an entire notification service to finish a capture flow, and inverts §7's ordering, which puts `014` last.                                                                                                   |
| **Household introduced before its own user story ships**             | FR-030 is a persisted ownership boundary across `006`/`007`/`010`; retrofitting it is the failure every competitor is currently living through (§8 decision 5).                                                            | A nullable `household_id` with a solo fallback creates two ownership paths and the fallback branch rots. CLAUDE.md's YAGNI carve-out covers exactly this case.                                                                                    |

## Post-Design Constitution Re-check

Re-evaluated after `data-model.md` and `contracts/`: **no new violations.** The three deviations above are
unchanged and justified. Two standing obligations carry into `/speckit-tasks`:

- **GR-005** — Increment 5 may not start before `docs/offline-strategy.md` exists.
- **ADR-0022** — the household migration is EXPAND-FIRST and runs via the in-stack Trigger, not a pipeline step.
- **ADR-0023** — household role checks stay in `householdPolicy`; never a route Guard (R-09).
- **ADR-0024** — settle is never retried; resume-from-tier (R-11) is what makes SQS redelivery safe without it.
- **Erasure integration** — FR-032a…FR-032c land _inside_ `accountErasureWorker`, ordered before the membership row is removed. Its doc comment ("the failure this worker is designed against is … a false success") is the specification for adding to it safely.
