# Quickstart: Validating ReciMe Parity (017)

**Plan**: [`plan.md`](./plan.md) · **Contracts**: [`contracts/`](./contracts/) · **Data model**: [`data-model.md`](./data-model.md)

A run/validation guide, not an implementation guide. Scenarios map to the spec's Success Criteria.

## Prerequisites

- **Node 24.** The shell here defaults to 18; prefix commands with the v24 nvm bin or vitest and the husky
  hooks fail.
- Docker (Postgres + LocalStack for the e2e tier).
- Clerk **dev** keys from Secrets Manager for Playwright. ⛔ `pk_live` is domain-locked and cannot run on
  localhost.
- ⚠️ Do not run Playwright locally while CI is running — both share one Clerk dev instance and the rate limit
  turns CI red.
- Give each test tier **its own database**; shared DBs race schema resets.

## Build and gate

```bash
npm install
npm run build          # Turbo order; generate:types runs first
npm run typecheck
npm run lint
npm run test
```

`@commise/web` changes additionally need a real `next build` — App Router page-export and RSC rules only fail
at build time, and a build break skips every e2e job.

---

## SC-001 / SC-002 — extraction accuracy (Increment 1, then 4)

The headline claim. Runs against the fixed adversarial corpus, **not** mocked fixtures — a mocked boundary
proves the tier called its adapter, not that a recipe came out.

```bash
npm run test:integration --workspace=packages/shared/recipe-import-core
```

**Expected**: ≥80 % of the corpus yields a structurally complete recipe (title, ≥1 quantified ingredient, ≥1
step, servings, ≥1 time field — feature `015`'s floor). On the caption-less **and** speech-less subset, ≥60 %.

The corpus must over-weight the four cases the competitor is documented or measured to fail: silent/ASMR with
on-screen text, text-overlay-only, comment-thread recipes, multi-recipe posts. **Before tiers 3–4 exist the
caption-less subset scores ~0 %** — that is the correct red baseline, and it is what proves the corpus can
detect the capability's absence.

## SC-003a / SC-003b — share to acceptance, then to draft (Increment 1)

```bash
npm run test:e2e --workspace=packages/apps/commise/web      # Playwright
# mobile: .maestro/capture/share-sheet.yaml
```

**Expected**: from share-sheet invocation on a cold app to **confirmed acceptance**, median < 2 s, with no app
switch required (SC-003a) — this must hold for every tier. Then to a **ready draft**, median < 20 s for
captures resolved by tiers 1–2 (SC-003b); tiers 3–4 notify on completion rather than being waited on.

⚠️ The acceptance path must be asserted under a **killed share extension** — accepting durably before
extraction is the whole point of the clarification, and a test that never kills the extension cannot detect
its absence. Playwright uses `getByRole`/`getByLabel` only; `page.waitForTimeout()` is banned.

## SC-004 / SC-005 — portability round-trip (Increment 2)

```bash
npm run test:integration --workspace=packages/services/recipe-service
```

**Expected**: a 2,000-recipe competitor export yields a per-recipe outcome for **every** entry and zero silent
drops; and an export re-imported into an empty account reproduces **100 %** of user-visible fields, asserted
field-by-field rather than by spot check.

⚠️ This is the scenario that first exercises the round-trip importer. Until it exists nothing proves the
shipped `GET /api/v1/account/export` is lossless (R-02).

## SC-006 — the kitchen (Increments 3, 5)

```bash
npm run test --workspace=packages/apps/commise/features/recipes   # component tier, all states
npm run test:e2e --workspace=packages/apps/commise/web
# mobile: .maestro/cooking/multi-timer-offline.yaml
```

**Expected**: a three-timer recipe completes end to end hands-free, in airplane mode, in dark mode, with units
converted — zero blocking failures. Referenced source photographs render the **placeholder** offline and are
**not** cached (`016-FR-027e`); a user-supplied replacement is available offline.

## Capture resume after a crash (Increment 1)

```bash
npm run test:integration --workspace=packages/services/recipe-workers
```

**Expected**: kill the worker after a committed tier and redeliver the message — the capture **resumes at the
first tier with no row**, re-pays for nothing, and consumes no second unit of import quota. ⚠️ A test that
never kills the worker cannot detect the absence of this behaviour; the kill is the assertion.

## Household role policy (Increment 0)

```bash
npm run test --workspace=packages/services/recipe-service   # householdPolicy unit suite
```

**Expected**: `evaluateHouseholdAction` is a pure function with a full truth table — every (role × state ×
action) pair asserted, including the `isSelf` leave case and the sole-owner `409`. Apply the mutation lens: if
`delete` were wrongly allowed for a member, a test must fail.

## Sole-owner erasure transfers ownership (Increment 0)

```bash
npm run test:integration --workspace=packages/services/recipe-workers
```

**Expected**: erasing the sole owner of a two-person household **succeeds** — erasure is never blocked — and
the remaining member is owner afterwards. Assert all four properties: the transfer happens **before** the
departing membership row is removed; redelivering the erasure message does not transfer twice; a tie between
two equally-tenured members resolves identically on repeat runs; and the household's `display_name` no longer
contains the erased owner's handle.

⚠️ The last one is the easy miss: erasure pseudonymizes recipes, so a household still named after the erased
owner leaks the identity the erasure was supposed to remove.

## SC-010 — household (Increment 0 design, later delivery)

```bash
npm run test:integration --workspace=packages/services/recipe-service
```

**Expected**: a two-person household shares a plan and its list with zero cases of one member's action being
invisible to the other, and zero cases of a departing member's exit destroying household content. Seat
exhaustion returns `409` with a stated reason. The sole owner cannot leave.

## SC-011 — voice safety (Increment 5)

**Expected**: across a scripted noise-and-crosstalk set, voice navigation **never** mutates cooking state on a
misrecognised or ambient utterance — `008` HAZ-005's mitigation, with tap/gesture authoritative throughout.

## SC-008 — spend (Increment 4)

**Expected**: inference spend per successful import stays within FR-011's per-import bound and ADR-0024's
monthly ceiling, measured over a full month of **real traffic** — not modelled.

⚠️ Blocked on **U-1**: ADR-0024's ceiling was sized for U11's ~660-token line verification, not a vision
waterfall. Do not enable tiers 3–4 in prod before the cost model lands.

---

## Migration check (household, Increment 0)

The household migration is **EXPAND-FIRST** and runs inside the deploy via the ADR-0022 in-stack Trigger —
never as a pipeline step before `cdk deploy`, which would invoke the _previous_ release's runner.

```bash
npm run test:integration --workspace=packages/services/recipe-service   # asserts the migrated schema
```

A unit test cannot observe a migration that did not apply; this tier must run against a real database.

## Gates that block, not warn

| Gate                                                 | Blocks                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `docs/offline-strategy.md` missing (GR-005 AC-005-d) | Increment 5 — FR-025, FR-033                                            |
| U-1 cost model                                       | Increment 4 in prod                                                     |
| U-2 legal ruling in `016`                            | Tiers 3–4 shipping                                                      |
| `cross-feature-FR-index.md`                          | Registered 2026-08-22 ✅                                                |
| ~~U-5 complete/delete split~~                        | **Closed 2026-08-22** — accepted, and applies to plans and taxonomy too |
| `014` has no package at all                          | Increment 7 only — Increment 1 ships completion in-app (R-08)           |
