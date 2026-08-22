# Tasks: 015 Publishing Rewards

**Source**: [`plan.md`](./plan.md) · **Spec**: [`spec.md`](./spec.md) · **Digest**: [`plan/digest.md`](./plan/digest.md)
**Created**: 2026-08-22

> ⛔ **DO NOT START IMPLEMENTATION.** Owner directive 2026-08-22: stop after tasks. Groups B–H are
> additionally gated on the blockers in [`plan.md` §9](./plan.md#9--blocking-dependencies--what-must-be-implemented-first).
> Group I is **not implementable at all** until 008 and 012 exist.

> **TDD is law** (CLAUDE.md §7.1). Every `TC*` task carries `Test-first: true` and MUST be written, run, and
> **watched fail** before its paired implementation task. A test that has never failed has proved nothing.

---

## Group A — Unblock (gating, mostly not code)

- [ ] A001 — Land 016 Legal Compliance Framework: ToS content licence granting display + clone rights
      Paths: unknown
      Size: XL
      Blocks: everything. We currently have no stated right to display a user's recipe or permit cloning.
- [ ] A002 — Land 016's registered DMCA agent + repeat-infringer policy (D24)
      Paths: unknown
      Size: L
      Blocks: FR-015–FR-019, User Story 4.
- [ ] A003 — Owner decision on D5 re-pricing before launch (removing the privacy paywall removes the free tier's only lever)
      Paths: unknown
      Size: S

---

## Group B — Data model + migration (US1, US2, US4)

- [ ] TC010 — Integration test: migration 0025 applies against a real DB and creates all four tables
      Paths: packages/services/recipe-service/tests/rewardsMigration.integration.test.ts
      Test-first: true
      Size: S
- [ ] TC011 — Integration test: `contributor_standing` CHECK rejects a tier decrease (FR-007i ratchet)
      Paths: packages/services/recipe-service/tests/rewardsMigration.integration.test.ts
      Test-first: true
      Size: S
- [ ] TC012 — Integration test: slot balance excludes reversed grants; unrelated grants untouched by a reversal (FR-016)
      Paths: packages/services/recipe-service/tests/rewardLedger.integration.test.ts
      Test-first: true
      Size: M
- [ ] B013 — Write migration `0025_publishing_rewards.sql` — EXPAND-ONLY: 4 CREATE TABLEs + ratchet CHECK
      Paths: packages/services/recipe-service/src/database/migrations/0025_publishing_rewards.sql
      Size: M
- [ ] B014 — Drizzle schema for `recipe_publications`, `reward_grants`, `recipe_impact_signals`, `contributor_standing`
      Paths: packages/services/recipe-service/src/database/schema/rewards.ts, packages/services/recipe-service/src/database/schema/index.ts
      Size: M
- [ ] TC015 — Schema guard test: `recipe_impact_signals` has NO viewer/identity column, ever (012-FR-024)
      Paths: packages/services/recipe-service/src/database/**tests**/impactSignalsAggregateOnly.test.ts
      Test-first: true
      Size: S

---

## Group C — Pure domain policies (US1, US3)

- [ ] TC020 — Unit tests: `evaluateEligibility` over the full provenance × completeness × duplicate × takedown matrix (FR-001, FR-003–FR-006, FR-011, FR-017)
      Paths: packages/services/recipe-service/src/recipes/domain/**tests**/publicationEligibility.test.ts
      Test-first: true
      Size: M
- [ ] C021 — Implement `publicationEligibility.ts` — the single authoritative rule FR-003 demands
      Paths: packages/services/recipe-service/src/recipes/domain/publicationEligibility.ts
      Size: M
- [ ] TC022 — Unit tests: `rewardSchedule` band boundaries — ordinals 1, 10, 11, 30, 31, 70, 71 (mutation lens: off-by-one MUST fail)
      Paths: packages/services/recipe-service/src/recipes/domain/**tests**/rewardSchedule.test.ts
      Test-first: true
      Size: S
- [ ] C023 — Implement `rewardSchedule.ts` as a table-driven band lookup terminating at 50 (FR-007a)
      Paths: packages/services/recipe-service/src/recipes/domain/rewardSchedule.ts
      Size: S
- [ ] TC024 — Unit tests: `evaluateEarnRate` at 3/24h and 10/7d boundaries; publication never blocked (FR-010)
      Paths: packages/services/recipe-service/src/recipes/domain/**tests**/earnRateLimit.test.ts
      Test-first: true
      Size: S
- [ ] C025 — Implement `earnRateLimit.ts`
      Paths: packages/services/recipe-service/src/recipes/domain/earnRateLimit.ts
      Size: S

---

## Group D — The C-004 amendment (D4a — sequence FIRST, behind a flag)

- [ ] TC030 — Unit tests: C-004 matrix re-asserted with the new `hasAvailablePrivateSlot` input; free+slot→private ALLOWED, free+no-slot→DENIED, premium unchanged
      Paths: packages/services/recipe-service/src/recipes/domain/**tests**/visibilityPolicy.test.ts
      Test-first: true
      Size: M
- [ ] D031 — Amend `VisibilityPolicyInput` with a REQUIRED `hasAvailablePrivateSlot` field (required so every call site is a compile error, never a silent default)
      Paths: packages/services/recipe-service/src/recipes/domain/visibilityPolicy.ts
      Size: S
- [ ] D032 — Update the C-004 matrix docstring in the same commit — leaving it stale makes the file lie
      Paths: packages/services/recipe-service/src/recipes/domain/visibilityPolicy.ts
      Size: XS
- [ ] D033 — Resolve slot balance at all 4 call sites (create, update, clone-default, set-visibility) and pass it in
      Paths: packages/services/recipe-service/src/recipes/recipes.service.ts
      Size: M
- [ ] TC034 — Regression: clone and import visibility behaviour is UNCHANGED by the amendment
      Paths: packages/services/recipe-service/tests/e2e/recipeCloneVisibility.e2e.test.ts
      Test-first: true
      Size: M

---

## Group E — Service, DAL, API contract (US1, US2, US4)

- [ ] TC040 — Integration: publish grants per schedule, records attestation, re-evaluates eligibility at confirm (FR-002, FR-004)
      Paths: packages/services/recipe-service/tests/publishReward.integration.test.ts
      Test-first: true
      Size: M
- [ ] TC041 — Integration: unpublish leaves balance IDENTICAL and warns nothing (FR-012, SC-004)
      Paths: packages/services/recipe-service/tests/publishReward.integration.test.ts
      Test-first: true
      Size: S
- [ ] TC042 — Integration: a recipe earns AT MOST ONCE across publish/unpublish/republish (FR-005)
      Paths: packages/services/recipe-service/tests/publishReward.integration.test.ts
      Test-first: true
      Size: S
- [ ] E043 — `rewards/` module scaffold mirroring the shipped `ratings/` layout
      Paths: packages/services/recipe-service/src/rewards/rewards.module.ts, packages/services/recipe-service/src/rewards/rewards.service.ts, packages/services/recipe-service/src/rewards/dal/rewards.dao.ts
      Size: M
- [ ] E044 — `POST /api/v1/recipes/:id/publish` + `DELETE .../publish` controller
      Paths: packages/services/recipe-service/src/rewards/rewards.controller.ts
      Size: M
- [ ] E045 — `GET /api/v1/rewards/me` — balance, schedule position, append-only ledger (FR-009, FR-007a-i)
      Paths: packages/services/recipe-service/src/rewards/rewards.controller.ts
      Size: S
- [ ] E046 — Author zod wire contract in-service; copy to `packages/schemas/recipe` per ADR-0014
      Paths: packages/services/recipe-service/src/rewards/rewards.schema.ts, packages/schemas/recipe/src/rewards.ts
      Size: M
- [ ] E047 — Extend the EXISTING erasure cascade to all four tables — do not create a second erasure path (FR-021, FR-022)
      Paths: packages/services/recipe-service/src/account/domain, packages/services/recipe-service/src/database/schema/rewards.ts
      Size: M
- [ ] E048 — Materialize slot balance with the ledger as source of truth; reconciliation asserted in integration
      Paths: packages/services/recipe-service/src/rewards/dal/rewards.dao.ts
      Size: M
- [ ] E049 — Takedown reversal path: reverse only that recipe's grant; withhold while a notice is open (FR-016, FR-017)
      Paths: packages/services/recipe-service/src/rewards/rewards.service.ts
      Size: M
- [ ] E050 — Repeat-infringer eligibility loss + notification with appeal path (FR-018, FR-019)
      Paths: packages/services/recipe-service/src/rewards/rewards.service.ts
      Size: M

---

## Group F — Web UI (US1, US2)

- [ ] TC060 — Component tests: publish sheet in EVERY state — eligible, ineligible+reason, at-ceiling, rate-limited, attestation-declined, loading, error
      Paths: packages/apps/commise/web/src/features/rewards/**tests**/PublishSheet.test.tsx
      Test-first: true
      Size: M
- [ ] F061 — Publish sheet: states the grant, states what publishing means, requires attestation (FR-008, FR-028, NFR-005)
      Paths: packages/apps/commise/web/src/features/rewards/PublishSheet.tsx
      Size: M
- [ ] F062 — Slot meter: position, next grant, ceiling (FR-007a-i, SC-009)
      Paths: packages/apps/commise/web/src/features/rewards/SlotMeter.tsx
      Size: S
- [ ] TC063 — Playwright: US1 publish-and-earn; US2 unpublish-without-loss (getByRole/getByLabel only)
      Paths: packages/apps/commise/web/tests/e2e/publishingRewards.spec.ts
      Test-first: true
      Size: M
- [ ] TC064 — Test: unpublish step-count parity with publish (FR-029, SC-010) — asserted, never reviewed
      Paths: packages/apps/commise/web/tests/e2e/publishingRewards.spec.ts
      Test-first: true
      Size: S
- [ ] F065 — Localize every new string; no hard-coded literals (FR-024)
      Paths: packages/apps/commise/web/src/i18n
      Size: S

---

## Group G — Mobile UI (US1, US2 — same release, FR-023)

- [ ] TC070 — Native component tests: publish sheet, all states
      Paths: packages/apps/commise/mobile/tests/components/PublishSheet.native.test.tsx
      Test-first: true
      Size: M
- [ ] G071 — Publish sheet + slot meter (native)
      Paths: packages/apps/commise/mobile/src/features/rewards/PublishSheet.native.tsx, packages/apps/commise/mobile/src/features/rewards/SlotMeter.native.tsx
      Size: M
- [ ] TC072 — Maestro flow: publish-and-earn, unpublish-without-loss
      Paths: packages/apps/commise/mobile/.maestro/rewards/publish-flow.yaml
      Test-first: true
      Size: M
- [ ] G073 — Localize every new mobile string (FR-024)
      Paths: packages/apps/commise/mobile/src/i18n
      Size: S

---

## Group H — Cross-cutting invariant guards

- [ ] TC080 — **Ratchet guard** (SC-008): set-equality assertion over every reward view model that NONE renders an expiring / at-risk / decaying / rank-relative state (FR-007i, FR-025, FR-026) — in the style of `natEgressConsumers.test.ts`, not a spot check
      Paths: packages/services/recipe-service/src/rewards/**tests**/ratchet.test.ts
      Test-first: true
      Size: M
- [ ] TC081 — Guard: no milestone is keyed on publication count except the FR-007l first-publication milestone (SC-012)
      Paths: packages/services/recipe-service/src/rewards/**tests**/ratchet.test.ts
      Test-first: true
      Size: S
- [ ] TC082 — k6: `GET /rewards/me` under load (renders on every recipe view)
      Paths: packages/services/recipe-service/tests/k6/rewardsMe.k6.js
      Test-first: true
      Size: S

---

## Group I — Recognition seam ONLY (US5, US6) ⛔ NOT IMPLEMENTABLE

> **No cook/save telemetry exists anywhere in the recipe service** (verified: no `cooked`, `cookCount`,
> `saveCount` or `cookLog` symbol in `src/`). `FR-007f`'s cook signal — the primary recognition mechanic —
> has **no data source**. 008 cooking-mode is unimplemented; 012 creator-profiles has no code at all.
> Only the outbound seam may be built now. Everything downstream of it waits.

- [ ] I090 — Define `standing.port.ts` — the one-way outbound seam 012 will consume (FR-032). Interface only, no implementation.
      Paths: packages/services/recipe-service/src/rewards/standing.port.ts
      Size: S
- [ ] I091 — ⛔ BLOCKED on 008: cook-event ingestion for `recipe_impact_signals` (FR-007f)
      Paths: unknown
      Size: L
- [ ] I092 — ⛔ BLOCKED on 008/012: impact milestones + standing ladder (FR-007g, FR-007h)
      Paths: unknown
      Size: L
- [ ] I093 — ⛔ BLOCKED on 012: public standing render on the creator profile (C-015-018)
      Paths: unknown
      Size: M
- [ ] I094 — ⛔ BLOCKED on Group I above: FR-007l first-publication milestone, FR-007m reciprocity signal, FR-007n parity (US6)
      Paths: unknown
      Size: L
