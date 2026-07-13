---
type: feat
date: 2026-07-13
origin: docs/plans/2026-07-12-001-feat-sandbox-subdomain-migration-plan.md
---

# Follow-ups: subdomain cutover, mobile azp decode, recipe k6 load test

Three loose ends from the subdomain-migration work, each a different mix of _implementable code_ vs.
_operationally/empirically gated_. This plan draws the line explicitly per item and implements everything
that can land safely; the gated remainder is a documented runbook, not silent debt.

## Item A — Recipe k6 load test (make the mandated test actually runnable)

**State:** the recipe k6 scripts already exist (`packages/services/recipe-service/tests/load/*.load.js`)
and the CI `load-test` job exists in `_ci.yml`, gated behind `inputs.run_load_test` (default false). But
**nothing ever passes `run_load_test: true`** — `ci-main.yml`/`ci-pr.yml` don't, and (unlike the food API,
which has `food-loadtest.yml`) recipe has **no trigger**. So the mandated perf test is written but never
run.

**Implement:**

- **U-A1** — `.github/workflows/recipe-loadtest.yml`: a `workflow_dispatch` (+ weekly `schedule`) that
  invokes the reusable `_ci.yml` with `run_load_test: true` and the `sandbox` stage, so the recipe k6
  job runs on demand and regularly. Mirrors the food-loadtest trigger pattern.
- **Verification:** the workflow parses; a dispatch runs the `Load test (recipe — k6)` job (boots
  recipe-service + Postgres, runs `tests/load` k6, threshold breach fails the job).

**Gated (documented, not code):** the job's `RECIPE_LOAD_TEST_TOKEN` secret is **not set** — a real
Clerk token minted for authenticated load requests. The workflow lands ready; a first real run needs that
secret (same shape as the food load test needing its Clerk secret). Documented in the workflow header.

## Item B — Mobile `azp` decode → RESOLVED from the `@clerk/backend` source (no device needed)

**Finding (definitive, from `node_modules/@clerk/backend` `assertAuthorizedPartiesClaim`):**

```js
if (!azp || !authorizedParties || authorizedParties.length === 0) return;   // azp absent → check SKIPPED
if (!authorizedParties.includes(azp)) throw ...;
```

So an **azp-less token passes even in list mode.** Consequences:

- Mobile (`@clerk/expo`) calls the identity service in **list mode** (prod / sandbox-in-list-mode). An
  azp-less native token is **accepted** — mobile is **not** broken by list mode, and the identity service
  already serves mobile today, which empirically confirms it.
- Our self-owned **pattern** mode is the _only_ place an azp-less token is rejected (fail-closed, by
  design) — and pattern mode is **sandbox-web-only**. Mobile never hits it.
- Therefore the subdomain migration (sandbox web, pattern mode) **does not affect mobile**, and **no
  native-admission gate is required** for the current topology. The spike's R10 worry ("azp-less tokens
  already 401 list-mode services") was **incorrect** — Clerk skips the check on absent azp.

**Implement:**

- **U-B1** — regression test in `@kitchensink/clerk-verify`: list mode (authorizedParties set, no pattern)
  accepts a token whose payload has **no `azp`** (encodes the "wrapper does not reject azp-less in list
  mode" contract, so a future refactor can't silently break mobile).
- **U-B2** — resolve R10 in the docs: update the spike brainstorm + ADR-0001 with the source-verified
  finding, and document that the `admitAzplessToken` hook stays available _only_ for a hypothetical future
  pattern-mode-serves-native topology (which would also require a Clerk JWT-template native claim as the
  positive signal — never admit on absence alone).

**Gated (documented):** decoding an actual `@clerk/expo` token to see its literal claim set still needs a
device/build; it's no longer on the critical path (correctness is established from the library contract +
the fact that mobile works today).

## Item C — Subdomain cutover

**State:** all code/infra is shipped and the router serves both path + subdomain (verified live). The
cutover is an _operational_ sequence; its core gate — a real sign-in on `pr-N.sandbox.commise.app` to
confirm `azp` == the subdomain — needs an interactive/automated auth flow, and the shared-sandbox flips
are outward-facing.

**Implement:**

- **U-C1** — `packages/apps/commise/web/scripts/cutover-smoke.ts`: a runnable verifier that, given a PR
  number + mode, checks the sandbox serves correctly — path (`sandbox.commise.app/pr-N/`) and subdomain
  (`pr-N.sandbox.commise.app/`) both resolve (DNS), route through CloudFront (not NXDOMAIN), and reach the
  app past Vercel protection (not a `vercel.com/sso` redirect). Fails loudly on NXDOMAIN / 404 / SSO. This
  de-risks each cutover step with a repeatable check instead of ad-hoc curls.
- **Verification:** run it against pr-73 now — path must pass; subdomain reaches the app (carrying the
  `/pr-73` basePath until the build flips, which the script reports rather than fails on).

**Gated (documented runbook — NOT executed here):** the live shared-sandbox flips
(`CLERK_AZP_PREVIEW_MODE=transition` deploy of sandbox identity; `SANDBOX_PREVIEW_MODE=subdomain` as a
Vercel Preview env + GitHub repo var; the two Vercel dashboard toggles) and the interactive azp sign-in
confirmation stay in the migration plan's cutover runbook. Rationale: these change the shared environment
for every preview and the azp confirmation cannot be self-certified without a real auth flow; the
transition design keeps every step reversible, so they are safe to do deliberately, not blind.

## Scope Boundaries

- **Prod:** untouched throughout (list mode, exact-match azp).
- No change to the shipped migration code (U1–U7 in the migration plan) — this is trigger + test + docs +
  a smoke tool around it.
