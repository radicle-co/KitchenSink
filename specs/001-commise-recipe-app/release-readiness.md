# Release Readiness: Commise Recipe App (feature 001)

> Feature: 001-commise-recipe-app | Date: 2026-07-16
> Verdict: **CONDITIONALLY READY**

## Summary

| Category                   | Status | Action Items |
| -------------------------- | :----: | :----------: |
| Feature Flags & Rollout    |   ✅   |      0       |
| Documentation              |   ⚠️   |      2       |
| Monitoring & Observability |   ⚠️   |      3       |
| Analytics                  |   ⚠️   |      1       |
| Deployment Dependencies    |   ⚠️   |      3       |
| Security / Supply-chain    |   ⚠️   |      3       |

The feature is **code-complete, review-clean, and verify-clean**, and the PR CI
pipeline is **green** (the previously-failing `ci / Test` job is fixed — see
"CI status" below). The conditions on shipping are **operational/ops-wiring**
items (subscribe alarms, run the SCA scan in CI, instrument the API-tier SLI,
confirm the `sharp` arch), not code defects.

## Prior Quality Gates

| Gate             |                                   Status                                    | Date       |
| ---------------- | :-------------------------------------------------------------------------: | ---------- |
| Pre-Impl Review  |                  Skipped — V-Model artifacts supersede it                   | 2026-07-06 |
| Code Review (6B) | **approved** — 0 CRITICAL / 0 HIGH (3 MED, 3 LOW; 5 fixed, 1 accepted DAMP) | 2026-07-16 |
| Verification (7) |       **approved** — PASS WITH WARNINGS, 0 CRITICAL (3 doc warnings)        | 2026-07-16 |
| Test Run         |                      Green locally + in CI (see below)                      | 2026-07-16 |

## CI status (PR #73)

The pipeline that was red is now green. Root cause of the failure and the fix:

- **`ci / Test` was failing** — the job ran `turbo run test` without a `^build`
  dependency, so `@commise/ui` (the only `@commise/*` package that ships built
  `dist` via its `exports` map rather than `src`) was never compiled in the test
  runner; its `./dist/index.js` target was absent, so ~21 web+native suites that
  import `{ palette }` from it failed to resolve the module.
- **Fix (commit `69cbe10`):** `turbo.json` `test`/`test:integration` now
  `dependsOn: ["^build"]` (matching the existing `test:e2e`/`typecheck`/`synth`
  tasks — the omission was the latent bug), and `@commise/features-recipes`
  declares its previously-undeclared `@commise/ui` dependency so turbo orders
  `@commise/ui#build` ahead of that package's tests.
- **Verified:** wiped `@commise/ui/dist`, ran `turbo run test` — 31/31 test tasks
  pass green from a clean build; the task graph confirms
  `@commise/features-recipes#test → @commise/ui#build`.
- **Result:** the full pipeline is green — **25 checks pass, 0 fail** (4 legitimate
  skips: Maestro mobile, k6 load, and two PR-close-only cleanup jobs).
- **Authed web E2E (`ci / E2E (web — Playwright)`) — fixed to green.** It ran for the
  first time (Clerk sandbox is CI-only) and exposed 6 real failures across three
  root causes, all resolved: (a) the difficulty/rating/visibility custom radios were
  `sr-only` inputs a visible overlay intercepted — made each a transparent full-size
  overlay so the semantic input is the click target; (b) the authenticated Home had
  no `<h1>` (the tested `home.welcome` was wired nowhere) — added it as the page's
  visually-hidden title; (c) `RecipeWidgetSlot` fetched during SSR and leaked an
  unhandled `getTokenRef.current is not a function` rejection (the widget is
  `ssr:false`, the token client-only) — deferred the fetch to the browser + hardened
  the token fn. Plus two E2E-only flow bugs (delete lives on the detail page, not the
  editor; `.check()` → `.click()` for the async-controlled star).

## Rollout Plan

This feature ships **no provider-managed feature flags** (LaunchDarkly/Unleash/etc.
— none found in a codebase scan, none introduced). Rollout is controlled by the
three mechanisms catalogued in `flags/registry.yml`:

- **Capability-gated Home widget** (the ship-safe surface): a dark recipe-service
  degrades the recipe widget to its skeleton, never a Home-page failure — an
  effective kill-switch.
- **Env levers**: per-user rate limits (`RATE_LIMIT_READ/WRITE/SEARCH/PHOTO_UPLOAD`,
  defaults 120/30/60/10) and `CLERK_ADMIT_NATIVE_CLIENT` (default OFF).
- **Flag seam** (`AppShellFeatureFlags.isEnabled`) available for future per-flag
  gating; no active keys today.

```yaml
strategy: internal-first  # capability present in all stages on deploy; no % ramp
stages:
  - { name: sandbox / pr-{N}, duration: "continuous (preview)" }
  - { name: prod internal, duration: "1d smoke" }
  - { name: prod GA, duration: "—" }
rollback_triggers:
  - "recipe-service 5xx rate > 2% for 5m"
  - "recipe-service p95 > 500ms for 10m (SC-009)"
  - "any erasure DLQ message or erasure-age alarm (P1 — compliance)"
```

## Rollback Plan

```yaml
reversible: conditional
mechanism: revert_deploy # no runtime flag to flip; roll the ECS/Lambda deploy back
data_concerns:
    - 'Migrations 0010 (ratings/difficulty/cover) + 0011 (photo thumbnail key) are ADDITIVE
      (new columns/tables). A code rollback is safe against the migrated schema — the new
      columns are simply unread. Do NOT down-migrate to reverse a code rollback.'
    - 'S3 version archives + erasure are async/idempotent; a rollback does not orphan them.'
steps:
    - 'Redeploy the prior recipe-service task definition + recipe-workers Lambda versions.'
    - 'Leave migrations 0010/0011 in place (additive; forward-compatible with old code).'
    - 'Watch erasure + archive alarms for 10m; confirm DLQs stay empty.'
```

## Action Items Before Ship

> **Deployment footprint (verified via AWS, account 040663841500 / us-east-1, 2026-07-16).** A read-only audit of the live account materially sharpens the deploy items below:
>
> - **recipe-service** is deployed **only** as `kitchensink-recipe-service-pr-73` (a manual push — there is **no CI image-build step** for recipe-service; only food/identity have `buildx --platform linux/amd64`). Its deployed image is `amd64/linux` and the Fargate task is `X86_64` → **sharp arch matches**.
> - **recipe-workers is NOT deployed to any environment.** No `kitchensink-recipe-workers-*` stack, no version-archive/account-erasure Lambdas, no archive/erasure SQS queues, and **no recipe alarm SNS topic** exist. The 6 alarms are defined in CDK but unprovisioned. The only live recipe Lambdas are the DB-bootstrap + migration custom resources.

| #   | Category      | Action                                                                                                                                                                                                                                                                            | Priority | Status  |
| --- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------: | :-----: |
| 1   | Deployment    | **Deploy the `recipe-workers` stack** (deployed nowhere — no workers, queues, or alarms exist), then subscribe a pager/human to its per-stage alarm SNS topic                                                                                                                     |   MUST   |  TODO   |
| 2   | Deployment    | Wire a **CI image-build + deploy for recipe-service** (mirror food/identity: `buildx --platform linux/amd64` → ECR → CDK), so deploys stop being manual and stay arch-correct                                                                                                     |   MUST   |  TODO   |
| 3   | Monitoring    | Instrument the API-tier SLI for SC-009 — alarm on recipe-service ALB `TargetResponseTime` (p95 ≤ 500ms) + `HTTPCode_Target_5XX_Count`; no app change required                                                                                                                     |   MUST   |  TODO   |
| 4   | Security/SCA  | Run `osv-scanner` (PR-diff mode) + a `syft` SBOM in CI over the 4 new deps (`sharp`, `@aws-sdk/client-{s3,sqs}`, `@aws-sdk/rds-signer`) — tools absent locally                                                                                                                    |   MUST   |  TODO   |
| 5   | Deployment    | Apply migrations 0010 + 0011 to the target-stage DB before the service deploy (the `RecipeMigrationFunction` Lambda exists; DB is in-VPC)                                                                                                                                         |   MUST   |  TODO   |
| ✅  | Deployment    | ~~Confirm `sharp` arch == Fargate task arch~~ — **VERIFIED** via AWS: deployed image `amd64/linux` == task `X86_64`                                                                                                                                                               |   MUST   |  DONE   |
| ✅  | Testing       | ~~Run the authed web E2E in CI~~ — **DONE**: ran in CI, surfaced + fixed 6 real issues (clickable custom radios, Home `<h1>`, no SSR recipe fetch, two E2E flow bugs); `ci / E2E (web — Playwright)` now green. Maestro mobile + k6 SC-009 stay CI-skipped (device farm / opt-in) |   MUST   | PARTIAL |
| 6   | Documentation | Write the T052 backend quickstart runbook (open ledger residual — doc polish, not code)                                                                                                                                                                                           |  SHOULD  |  TODO   |
| 7   | Security      | Add `actions/attest-build-provenance` to the release workflow                                                                                                                                                                                                                     |  SHOULD  |  TODO   |
| 8   | Monitoring    | Long-horizon erasure SLA-window signal (belt-and-suspenders over the 1h stuck-job alarm)                                                                                                                                                                                          |   NICE   |  TODO   |

## Ship Checklist

- [ ] All MUST-priority action items (1–6) completed
- [x] Rollout control defined (capability-gate + env levers; documented in `flags/registry.yml`)
- [ ] Monitoring alerts reach a human (SNS subscription — item 1)
- [x] Rollback plan documented (revert-deploy; additive migrations)
- [ ] Team notified of upcoming release
- [ ] Release notes / changelog drafted

## Verdict

**CONDITIONALLY READY.**

The code is complete, reviewed (0 CRITICAL/HIGH), verified (0 CRITICAL), and CI is
green. Shipping is conditional on the six MUST operational items above — every one
is deploy-time wiring or a CI-gate run, none is a code change. The two compliance
SLIs (erasure age + DLQ) are fully instrumented and alarmed; they need only a human
on the SNS subscription (item 1) to be production-observable. The one genuine
observability gap is the API-tier latency/error SLI (item 2), which is an ALB-metric
alarm with no code impact.
