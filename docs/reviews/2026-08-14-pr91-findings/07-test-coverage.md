# QSE Report — Test-coverage gap audit (branch `chore/code-quality-enforcement-phase-1-2`, ahead of PR 91)

Audited against `CLAUDE.md` → _Testing policy — ABSOLUTE, NON-NEGOTIABLE_ and
`docs/CODING_STANDARDS.md` §7 / §7.1 (matrix at `docs/CODING_STANDARDS.md:469-484`, tier-location tables at
`:490-505`, the four-leg tier rule at `:522-528` and `:546-550`).

This is a **gap audit**. It reports what is MISSING, what is GREEN-BUT-EMPTY, and what NEVER RUNS. It does
not summarise what works.

---

## Gate Results (what I actually observed)

I ran **no** test suites (per instruction; several hit Postgres/LocalStack and Playwright shares a rate-limited
Clerk dev instance). What I did run, all read-only:

| Gate                          | How observed                                                         | Result                                                                             |
| ----------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Base CI (25 jobs)             | `gh run view 31762375997 --json jobs`                                | **all success** (2026-08-14T02:00Z, 10m32s)                                        |
| Heavy CI (Maestro + 3× k6)    | `gh run view 31762376012 --json jobs`                                | **all success** (53m24s) — recipe k6, food k6, identity k6, mobile Maestro all ran |
| Test collection (mobile)      | `npx vitest list --config vitest.config.ts --filesOnly` in `mobile/` | 10 files — **including `tests/e2e/auth.test.ts`** (see F-T2)                       |
| Test collection (recipe-core) | `npx vitest list --filesOnly`                                        | 13 files, no `node_modules` leakage                                                |
| Repo variables                | `gh variable list`                                                   | `ARGOS_ENABLED` is **absent** (see F-T5)                                           |
| Coverage %                    | grep for `thresholds` / `--coverage` across all vitest configs + CI  | **none exists anywhere** (see F-T12)                                               |
| Working tree                  | `git status --porcelain`                                             | clean; audit is of HEAD on this branch                                             |

Everything below is derived from reading files and read-only commands. Every claim carries a `file:line`.

---

## Per-package coverage-vs-policy table

Tier existence was determined by **finding the config file + the `package.json` script + actual test files +
the CI step**, not by assuming. `—` = not required for that package's category.

Legend: **✓** present and CI-wired · **✗** REQUIRED AND MISSING · **⚠** present but defective (see finding).

| Package                                                     | Category   | Unit    | Integration | E2E (vitest) | Playwright | Maestro | k6      | Gaps                         |
| ----------------------------------------------------------- | ---------- | ------- | ----------- | ------------ | ---------- | ------- | ------- | ---------------------------- |
| `services/identity`                                         | Service    | ✓ 38    | ✓ 5         | ✓ 3          | —          | —       | ✓ 4     | F-T3 (fake perf spec)        |
| `services/identity-webhooks`                                | Service    | ✓ 22    | ✓ 2         | ✓ 2          | —          | —       | **✗ 0** | **F-T6**                     |
| `services/food-service`                                     | Service    | ✓ 53    | ✓ 28        | ✓ 6          | —          | —       | ✓ 4     | F-T11                        |
| `services/recipe-service`                                   | Service    | ✓110    | ✓ 41        | ✓ 14         | —          | —       | ✓ 7     | F-T8, F-T11                  |
| `services/recipe-workers`                                   | Non-UI     | ✓ 16    | ✓ 7         | —            | —          | —       | —       | —                            |
| `clients/recipe-service`                                    | Non-UI     | ✓ 11    | ✓ 1         | —            | —          | —       | —       | —                            |
| `clients/food-service`                                      | Non-UI     | ✓ 2     | ✓ 1         | —            | —          | —       | —       | —                            |
| `clients/usda`                                              | Non-UI     | ✓ 1     | **✗ 0**     | —            | —          | —       | —       | **F-T13**                    |
| `shared/identity-db`                                        | Non-UI/DAL | ⚠ 1     | **✗ 0**     | —            | —          | —       | —       | **F-T13** (3 DAOs, 0 tests)  |
| `shared/clerk-verify`                                       | Non-UI     | ✓ 1     | **✗ 0**     | —            | —          | —       | —       | F-T13                        |
| `shared/identity-core`                                      | Non-UI     | ✓ 2     | **✗ 0**     | —            | —          | —       | —       | F-T13                        |
| `shared/nest-error-envelope`                                | Non-UI     | ✓ 1     | **✗ 0**     | —            | —          | —       | —       | F-T13                        |
| `shared/recipe-core`                                        | Non-UI     | ✓ 13    | **✗ 0**     | —            | —          | —       | —       | F-T13                        |
| `utils/identity`                                            | Non-UI     | ✓ 1     | **✗ 0**     | —            | —          | —       | —       | F-T13                        |
| `schemas/food` `/identity` `/recipe`                        | Non-UI     | **✗ 0** | **✗ 0**     | —            | —          | —       | —       | **F-T14** (no `test` script) |
| `infra/global`                                              | Non-UI     | ✓ 53    | ✓ 5         | —            | —          | —       | —       | not CI-wired separately¹     |
| `infra/alb`                                                 | Non-UI     | ✓ 1     | **✗ 0**     | —            | —          | —       | —       | F-T13                        |
| `infra/security`                                            | Non-UI     | ✓ 5     | **✗ 0**     | —            | —          | —       | —       | F-T13                        |
| `tools/contract-gen`                                        | Non-UI     | ✓ 6     | **✗ 0**     | —            | —          | —       | —       | F-T13                        |
| `tools/eslint`                                              | Non-UI     | ✓ 3     | **✗ 0**     | —            | —          | —       | —       | F-T13                        |
| `tools/test-utils`                                          | Non-UI     | ✓ 4     | **✗ 0**     | —            | —          | —       | —       | F-T13                        |
| `tools/service-test-harness`                                | Non-UI     | ✓ 1     | **✗ 0**     | —            | —          | —       | —       | F-T13                        |
| `tools/loadtest` `esbuild` `prettier` `typescript` `vitest` | Config     | 0       | 0           | —            | —          | —       | —       | config-only, accepted        |
| `apps/commise/web`                                          | UI         | ✓ 79    | ✓ 2         | —            | ⚠ 32       | —       | —       | **F-T5**, F-T7, F-T10, F-T15 |
| `apps/commise/mobile`                                       | UI         | ✓ 52    | **✗ 0**     | ⚠ 1          | —          | ⚠ 33    | —       | **F-T1, F-T2**, F-T9, F-T15  |
| `apps/commise/ui`                                           | UI         | ✓ 25    | **✗ 0**     | —            | (app)      | (app)   | —       | F-T11                        |
| `apps/commise/features/recipes`                             | UI         | ✓106    | **✗ 0**     | —            | (app)      | (app)   | —       | 4 native leaves untested²    |
| `apps/commise/features/account`                             | UI         | ✓ 9     | **✗ 0**     | —            | (app)      | (app)   | —       | —                            |
| `apps/commise/features/core`                                | UI-logic   | ✓ 10    | **✗ 0**     | —            | —          | —       | —       | F-T13                        |
| `apps/commise/i18n`                                         | Non-UI     | ✓ 3     | **✗ 0**     | —            | —          | —       | —       | F-T13                        |

¹ `infra/global`'s 5 `*.integration.test.*` files are collected by its **default** `vitest.config.ts` (there is
no `vitest.integration.config.ts` and no `test:integration` script) — the tier name is a filename convention
only, so they run in the `Test` job. Not a hidden test, but it is not the four-leg tier §7 describes.
² `form/ChipInput.native.tsx`, `form/CuisineSelect.native.tsx`, `form/RecipeFormSections.native.tsx`,
`actions/icons.native.tsx` have no own `*.native.test.tsx`; they are exercised only through
`RecipeForm.native.test.tsx`.

**Tier-wiring cross-check (the four legs of `docs/CODING_STANDARDS.md:522-528`).** All 8 packages with a
`test:integration` script and all 6 with a `test:e2e` script **are** invoked by name in
`.github/workflows/_ci.yml` (`:343, :400, :444, :520, :631, :669, :671, :677` and `:742, :813, :929, :930,
:1105, :1304`). That leg is satisfied today — but nothing holds it there (F-T4), and one package fails the
"excluded from the default `test` glob" leg (F-T2).

---

## F-T1 — the entire mobile vitest E2E tier tests a function defined inside the test file

- **Severity:** Critical
- **File/Package:** `packages/apps/commise/mobile/tests/e2e/auth.test.ts:9-37` (`@commise/mobile`); CI job at
  `.github/workflows/_ci.yml:1271-1304`
- **Gap:** The file **re-declares `deriveAuthState` locally** (lines 9–37) and then tests its own copy. It
  imports nothing — verified: it is one of only two truly self-contained test files repo-wide, and
  `grep -rn deriveAuthState packages/apps/commise/mobile/src` shows the real one is re-exported from
  `packages/apps/commise/mobile/src/hooks/useAuth.ts:2` (sourced from `@commise/features-account`). This one
  file is the **whole** `test:e2e` script for `@commise/mobile`
  (`packages/apps/commise/mobile/package.json:13` → `vitest.e2e.config.ts:5` → `tests/e2e/**/*.test.ts`), and
  therefore the whole `E2E (mobile — Vitest)` CI job.
- **Why it matters:** The job is a permanent green that verifies zero production code. Every mutation to the
  shipped `deriveAuthState` survives it: invert `if (!isLoaded)` → still green; delete the
  `sessionClaims.act` impersonation block → **still green**, and an impersonated Clerk session is admitted;
  drop the `status === 'suspended'` check → still green, and a suspended account is admitted. (The real
  function _is_ covered by `packages/apps/commise/mobile/tests/auth.test.ts:19`, which imports it — so the
  loss is not the assertions, it is that a whole named CI tier reports on nothing.)
- **Smallest fix:** Delete lines 3–37 and `import { deriveAuthState } from '../../src/hooks/useAuth.js'`. That
  alone turns the tier honest. Then decide what mobile's vitest e2e tier is actually FOR — today it duplicates
  `tests/auth.test.ts` exactly, and the real mobile E2E is Maestro (`docs/CODING_STANDARDS.md:505`).
- **Verified (how):** Read the file in full; `grep -rn "deriveAuthState" packages/apps/commise/mobile/{src,tests}`;
  traced `package.json:13` → `vitest.e2e.config.ts:5` → `_ci.yml:1304`.

## F-T2 — mobile's default `test` glob swallows the E2E tier (fails the §7 four-leg rule)

- **Severity:** High
- **File/Package:** `packages/apps/commise/mobile/vitest.config.ts:10` vs `vitest.e2e.config.ts:5`
- **Gap:** The default config's `include: ['tests/**/*.test.ts']` has **no exclude for `tests/e2e/**`**, so
`tests/e2e/auth.test.ts`is collected by BOTH tiers.`docs/CODING_STANDARDS.md:522-528`requires
"the default`test`include globs MUST exclude the other tiers' patterns" as one of four mandatory legs.
Every other tiered package honours it —`identity/vitest.config.ts:14`, `food-service/vitest.config.ts:14`,
`recipe-service/vitest.config.ts:16`, `recipe-workers/vitest.config.ts:21`,
`identity-webhooks/vitest.config.ts:17`, `web/vitest.config.ts:22`. Mobile is the sole violator.
- **Why it matters:** Two consequences, both bad. (a) The `Test` job silently pays for the e2e tier, so a
  future _real_ mobile e2e spec (one that boots a harness, hits the network, or needs secrets) would run in
  the wrong job with none of its environment — the failure mode is a confusing red in `Test`, not in
  `E2E (mobile)`. (b) It masks F-T1: the e2e job's green is indistinguishable from the unit job's green
  because they run the identical file.
- **Smallest fix:** Add `exclude: ['node_modules', 'dist', 'tests/e2e/**']` to
  `packages/apps/commise/mobile/vitest.config.ts`.
- **Verified (how):** `npx vitest list --config vitest.config.ts --filesOnly` in `packages/apps/commise/mobile`
  printed `tests/e2e/auth.test.ts` among its 10 files.

## F-T3 — a tautological "performance" spec runs in the default `Test` job and asserts literals against themselves

- **Severity:** High
- **File/Package:** `packages/services/identity/tests/perf/latency-perf.test.ts:1-33`
- **Gap:** All five tests assert a locally-declared literal against the same literal:
  `const targets = { tokenRefreshP99: 500 }` … `expect(targets.tokenRefreshP99).toBe(500)` (lines 4–12); the
  second `describe` does the same with `const maxRetries = 3; expect(maxRetries).toBe(3)` (lines 24–26). No
  import, no production module, no measurement. It is collected by the default tier
  (`identity/vitest.config.ts:6` includes `tests/**/*.test.ts`; `:14` excludes only `tests/e2e/**` and
  `*.integration.test.ts`), so it runs in the green `Test` job on every PR.
- **Why it matters:** It is a **false signal about the exact thing it names**. A reader (or an agent) counting
  tiers sees "identity has latency-target tests" and stops looking. The real SLO gate is
  `packages/services/identity/tests/load/*.load.js`, which runs only in the heavy tier behind
  `run_load_test` (`.github/workflows/_ci-heavy.yml:1091-1107`). Mutating any real latency budget, retry
  count, or backoff constant in `src/` leaves this file green. `docs/CODING_STANDARDS.md:57` (via CLAUDE.md)
  says such a test "MUST NOT be counted toward the test mandate".
- **Smallest fix:** Delete the file. The budgets it "documents" already live, executably, in the k6 thresholds.
- **Verified (how):** Read the file in full; confirmed collection by reading `identity/vitest.config.ts:5-14`;
  confirmed the real SLO gate location by grepping `k6 run` in `.github/workflows/_ci-heavy.yml`.

## F-T4 — no guard holds vitest tiers to CI, though the same failure has already happened twice

- **Severity:** High
- **File/Package:** repo-wide; the asymmetry is `packages/infra/global/__tests__/k6-load-tier-wiring.test.ts`
  vs. the absence of an equivalent for `test:integration` / `test:e2e`
- **Gap:** `grep -rn "test:integration\|test:e2e" packages/infra/global/__tests__/*.test.ts` returns **nothing**.
  The repo has a filesystem-discovering guard proving every committed `*.load.js` is invoked by a workflow step
  (`k6-load-tier-wiring.test.ts:180-200`, non-vacuity at `:576`) — built precisely because identity's four k6
  scripts sat unrun. The vitest tiers have no such guard, even though the identical failure recurred:
  `.github/workflows/_ci.yml:744-749` records that recipe-service's **entire e2e tier** (14 spec files / 54
  tests, including `erasure-lock.e2e.test.ts` for GDPR C-007) was dark until 2026-08-07 because no workflow
  invoked `test:e2e`; and `:530-532` records the same for recipe-workers' integration tier.
- **Why it matters:** Today all 14 non-unit scripts are wired (I verified each). Nothing keeps them wired. A
  renamed script, a renamed workspace, or a new package with a `test:integration` script and no job is green
  by construction, and the class has a 2-for-2 record in this repo. PR 91 will add at least one new tier.
- **Smallest fix:** One test in `packages/infra/global/__tests__/`: enumerate every workspace
  `package.json` for `test:integration` / `test:e2e`, parse `.github/workflows/*.yml`, and assert each script
  is named by some step's `run:`. It is the same shape as `k6-load-tier-wiring.test.ts` and can reuse its
  workflow parser.
- **Verified (how):** Grepped all of `packages/infra/global/__tests__/` for the two script names (zero hits);
  read `k6-load-tier-wiring.test.ts:1-100,576-590`; hand-traced all 14 scripts to their `_ci.yml` steps.

## F-T5 — the visual-regression gate is inert: `ARGOS_ENABLED` is not set, so nothing compares the screenshots

- **Severity:** High
- **File/Package:** `.github/workflows/_ci.yml:1238-1240`; `packages/apps/commise/web/tests/e2e/visualRegression.spec.ts:24-25`
- **Gap:** The spec's own docstring states its job is "to produce a small set of deterministic PNGs under
  `screenshots/`" and that "Argos's own comparison happens off-box". The only consumer is the upload step,
  gated `if: ${{ … && vars.ARGOS_ENABLED == 'true' }}`. `gh variable list` returns
  `DOMAIN_NAME, SANDBOX_PREVIEW_MODE, SANDBOX_VPC_ID, VERCEL_PROJECT_ID, VERCEL_TEAM_ID` — **`ARGOS_ENABLED`
  does not exist**, so the condition is permanently false.
- **Why it matters:** The spec runs on every PR (it is inside the 4-shard Playwright matrix), spends runner
  minutes, asserts a handful of `toBeVisible()`, writes PNGs, and **no baseline comparison ever happens**.
  There is no visual-regression coverage at all today, while the pipeline presents a passing check named after
  it. A whole-page style regression — the class this gate exists for — ships green.
- **Smallest fix:** Either create the Argos project and set the repo variable, or delete the spec and its
  upload steps. A gate that cannot fire is worse than no gate, because it is counted as one. (The step's own
  comment already argues this: "a step that always fails is worse than one that is explicitly switched off" —
  the switched-off state has now outlived its intent.)
- **Verified (how):** `gh variable list`; read `_ci.yml:1224-1251`; read `visualRegression.spec.ts:1-70`.

## F-T6 — `identity-webhooks` is a deployable HTTP API with no k6 tier, and the k6 guard is blind to it

- **Severity:** Medium-High
- **File/Package:** `packages/services/identity-webhooks` — no `tests/load/` directory, no `test:load` script,
  no job
- **Gap:** §7.1 (`docs/CODING_STANDARDS.md:473`) requires k6 for "every deployable HTTP service".
  identity-webhooks serves the public, unauthenticated `POST /api/v1/webhooks/users` through API Gateway
  (CLAUDE.md, _Clerk Webhooks_). `ls packages/services/identity-webhooks/tests/` shows `__fixtures__ e2e
erase-identity.integration.test.ts global-setup.ts integration-db.ts tombstone-sweep.integration.test.ts` —
  no `load/`. And the guard that would catch this cannot: `k6-load-tier-wiring.test.ts:576` asserts
  non-vacuity only for "every service **that has the tier**", and its discovery at `:188-195` skips a service
  whose `tests/load` directory is absent.
- **Why it matters:** This is the one endpoint an outside party (Clerk) drives at a rate we do not control,
  behind a VPC-attached Lambda on a shared RDS. It is also the erasure write path. Its concurrency/throughput
  behaviour is entirely unmeasured, and the guard designed to notice missing k6 coverage is structurally
  unable to notice this instance of it.
- **Smallest fix:** Two parts, and the second matters more. (1) Add one k6 script for the signed-webhook
  ingest path. (2) Extend `k6-load-tier-wiring.test.ts` with a service-completeness assertion: enumerate
  `packages/services/*` that expose an HTTP surface and require a non-empty `tests/load/`, with an explicit
  documented exemption list (the `KNOWN_UNRUN_FLOWS` ratchet pattern at
  `maestro-flow-selection.test.ts:245` is the precedent).
- **Verified (how):** `ls packages/services/identity-webhooks/tests/`; grepped `test:load` and `k6 run` across
  `.github/workflows/`; read `k6-load-tier-wiring.test.ts:180-200,576-590`.

## F-T7 — the web app's last-resort error boundary is tested only for its Sentry side-effect

- **Severity:** Medium
- **File/Package:** `packages/apps/commise/web/tests/globalError.test.tsx` (16 lines, one test) vs.
  `packages/apps/commise/web/src/app/global-error.tsx:12-18`
- **Gap:** The single test asserts `expect(mockCaptureException).toHaveBeenCalledWith(error)` and nothing else.
  The component's entire render output — `<html lang="en"><body><NextError statusCode={0} /></body></html>` —
  is unasserted, and no other test touches it (`grep -n "global-error\|GlobalError"
src/app/__tests__/routeBoundaries.test.tsx` returns nothing).
- **Why it matters:** Mutation lens: change the return to `null`, or drop the `<html>/<body>` wrapper Next
  **requires** for `global-error` (without it the root layout is replaced by nothing and the user gets a blank
  document), and the test stays green. §7.1 (`:471`) requires a component test for "EVERY UI path/state …
  error". This is the last-resort state — the one a user only ever reaches when everything else already failed.
- **Smallest fix:** Add two assertions to the existing test: that the rendered container is non-empty, and that
  the `<html lang>`/`<body>` wrapper is present.
- **Verified (how):** Read both files in full; grepped `routeBoundaries.test.tsx`. (For contrast, mobile's
  equivalent IS properly covered — `tests/screens/AppRoot.native.test.tsx:62-82` renders the real crash,
  asserts the `alert` role, and drives the retry to recovery.)

## F-T8 — `recipe-service`'s DB pool config has zero tests, while the module it says it mirrors has them

- **Severity:** Medium
- **File/Package:** `packages/services/recipe-service/src/database/pool-config.ts:42-107`
- **Gap:** No test file references it anywhere (`grep -rln "pool-config" packages/services/recipe-service
--include="*.test.ts"` → empty). Its own docstring at line 3 says it "Mirrors the shipped food service
  (`packages/services/food-service/src/database/pool-config.ts`)" — and that one **does** have
  `packages/services/food-service/src/database/__tests__/pool-config.test.ts`.
- **Why it matters:** The module carries real, security- and availability-relevant branching that a mutation
  survives untested: the `STAGE === 'local'` branch (`:51`), the missing-`DB_PASSWORD` throw (`:54-56`), the
  `DATABASE_URL`-wins precedence (`:79-83`), the port validation `!Number.isInteger || <=0 || >65535`
  (`:97-99`), and — most consequentially — whether the RDS-IAM `password` provider is installed as a
  **function** (`:69`) rather than a resolved string. If it were ever resolved once instead of per-connection,
  every pooled connection past the ~15-minute token TTL fails, and the symptom is an intermittent production
  auth storm, not a test failure.
- **Smallest fix:** Copy `food-service/src/database/__tests__/pool-config.test.ts` and re-point it. The
  behaviours are the same shape.
- **Verified (how):** Read `pool-config.ts` in full; `ls packages/services/{food-service,recipe-service}/src/database/__tests__/`;
  grepped for any test referencing the module.

## F-T9 — two committed Maestro flows are executed by nothing

- **Severity:** Medium
- **File/Package:** `packages/infra/global/__tests__/maestro-flow-selection.test.ts:245`
- **Gap:** `KNOWN_UNRUN_FLOWS = ['homeRecentRecipeTap', 'recipes/source-tabs']` — two story flows that exist
  under `packages/apps/commise/mobile/.maestro/` and are in no vertical of `FLOW_PLAN`, so the emulator never
  runs them. `recipes/source-tabs` is the mobile half of a round trip whose web pair
  (`tests/e2e/recipeSourceTabs.spec.ts`) "caught a one-way trip that no per-surface test could see" (the
  ratchet's own note, `:241-243`).
- **Why it matters:** §7.1 requires a Maestro flow per mobile user story. Two stories have a flow that has
  never executed on a device — i.e. two stories are uncovered on mobile, and the flow files' existence makes
  them look covered to anyone counting files. **Mitigating:** this is a ratchet, not a silent gap — the
  equality assertion at `:420-425` fails the build if a NEW dead flow appears or a listed one is promoted, and
  the reason for deferral is documented. It is a known, bounded debt rather than a false green.
- **Smallest fix:** Promote both into `FLOW_PLAN` (`home` and `discovery` verticals respectively) in a PR whose
  Maestro tier is watched, then delete them from `KNOWN_UNRUN_FLOWS`.
- **Verified (how):** Read `maestro-flow-selection.test.ts:227-245,390-425`; listed the 33 flow YAMLs; read
  the `FLOW_PLAN` construction in `packages/apps/commise/mobile/tests/e2e/run-maestro-flows.sh`.

## F-T10 — the only Playwright spec that talks to a real backend is gated on an env var no workflow sets

- **Severity:** Medium
- **File/Package:** `packages/apps/commise/web/tests/e2e/recipeLive.spec.ts:14,17`
- **Gap:** `const LIVE = process.env['E2E_LIVE_BACKEND'] === '1'` … `test.skip(!LIVE, …)`.
  `grep -rn "E2E_LIVE_BACKEND" .github/` finds only a prose mention at `_ci.yml:985` ("which stays skipped
  here"). No workflow — base, heavy, nightly or dispatch — ever sets it. The spec therefore runs **nowhere**.
- **Why it matters:** Every one of the other 31 Playwright specs mocks the API with the origin-agnostic glob
  `page.route('**/api/v1/**')` (`_ci.yml:980-984`). So this is the single spec that would catch a
  contract/serialisation/owner-gating divergence between the shipped web client and the real service — the
  class that mocked specs cannot see by construction — and it is inert. The deliberateness is documented; the
  consequence (zero live-backend web coverage anywhere in CI) is not.
- **Smallest fix:** Either wire it into the heavy tier alongside a booted recipe-local + identity-local (the
  Maestro job at `_ci-heavy.yml:259-306` already builds and boots exactly that stack, so the harness exists),
  or accept it and record the residual risk explicitly in the ADR-style note the spec header already uses.
- **Verified (how):** Read the spec header; `grep -rn "E2E_LIVE_BACKEND" .github/ packages/`.

## F-T11 — `passWithNoTests: true` turns a broken include glob into a green tier, on five configs

- **Severity:** Medium
- **File/Package:** `packages/services/identity/vitest.e2e.config.ts:7`,
  `packages/services/food-service/vitest.e2e.config.ts:14`,
  `packages/services/recipe-service/vitest.e2e.config.ts:18`,
  `packages/services/identity/vitest.integration.config.ts:13`,
  `packages/services/recipe-service/vitest.integration.config.ts:24`,
  `packages/services/recipe-workers/vitest.{config,integration.config}.ts:18,19`,
  `packages/services/identity-webhooks/vitest.{config,integration.config}.ts:18,35`,
  `packages/apps/commise/ui/vitest.config.ts:12`
- **Gap:** Each config's `include` glob is the only thing standing between "the tier ran 54 tests" and "the
  tier ran 0 tests"; `passWithNoTests: true` makes the second outcome **exit 0**. A file relocation, a suffix
  typo, or a directory rename produces a green named CI job that executed nothing. Note that
  `packages/apps/commise/mobile/vitest.e2e.config.ts:6` explicitly sets `passWithNoTests: false` — so the
  correct posture is already known in this repo, just not applied consistently.
- **Why it matters:** This is the mechanical enabler of the exact failure `_ci.yml:744-749` and `:454-457`
  already record twice (a whole dark e2e tier; an `--if-present` that "had stopped being a placeholder and
  become a hazard"). The repo removed `--if-present` for that reason and left the in-config equivalent.
- **Smallest fix:** Set `passWithNoTests: false` on every tier that has ≥1 spec today (verified: all of them
  do — identity e2e 3, food e2e 6, recipe e2e 14, identity int 5, recipe int 41, recipe-workers int 7,
  identity-webhooks int 2, ui 25).
- **Verified (how):** Grepped `passWithNoTests` across all configs; counted the matching files under each
  config's include glob with `find`/`ls` (see the table above).

## F-T12 — coverage is never measured anywhere, so §7's pyramid and "every UI state" rule are unenforceable

- **Severity:** Medium
- **File/Package:** repo-wide — all vitest configs + `.github/workflows/_ci.yml`
- **Gap:** `grep -rn "thresholds\|lines:\|statements:\|branches:" --include="vitest*.config.*" packages/`
  returns **nothing**. Only `packages/apps/commise/mobile/vitest.config.ts:24-30` declares a `coverage` block
  at all, and it sets reporters with no thresholds. No CI step anywhere passes `--coverage`.
- **Why it matters:** `docs/CODING_STANDARDS.md:459` states a numeric pyramid (≥70% unit / ≤20% integration /
  ≤10% E2E) and `:471` requires a component test for **every** UI path/state. Neither is measured, so both are
  enforced only by reviewer attention. That is precisely how the four gaps in this report that are pure
  omissions (F-T6, F-T8, F-T13, and the 4 untested native leaves) reached HEAD behind 25 green checks. Note
  `packages/services/recipe-service` has a `test:mutation` script (`stryker run`) — the strongest available
  signal — and no workflow invokes it either.
- **Smallest fix:** Add `--coverage` + a per-package `thresholds` floor to the `Test` CI job for the four
  services and the three UI packages, seeded at today's measured numbers so it is a ratchet rather than a
  blocker (the `boundaries-baseline.json` pattern at `_ci.yml:169-184` is the in-repo precedent).
- **Verified (how):** Grepped every `vitest*.config.*` and every workflow for coverage flags/thresholds;
  read `packages/tools/vitest/vitest.config.js` (the shared base) — it declares no coverage block.

## F-T13 — non-UI libraries and clients have unit tests only; §7.1 requires both tiers, always

- **Severity:** Medium
- **File/Package:** `clients/usda`, `shared/identity-db`, `shared/clerk-verify`, `shared/identity-core`,
  `shared/nest-error-envelope`, `shared/recipe-core`, `utils/identity`, `infra/alb`, `infra/security`,
  `tools/{contract-gen,eslint,test-utils,service-test-harness}`, `apps/commise/{i18n,ui,features/*}`
- **Gap:** None has a `vitest.integration.config.ts`, a `test:integration` script, or a CI step.
  `docs/CODING_STANDARDS.md:472` is unambiguous: "Non-UI code (services, DALs, domain logic, controllers,
  DTOs, workers, **libraries, utilities**): unit tests AND integration tests — BOTH, always. … A unit test
  alone is a VIOLATION."
- **Why it matters:** Two of these are not merely formal violations. **`shared/identity-db`** ships 12 source
  files including three DAOs (`dao/user.dao.ts`, `dao/account.dao.ts`, `dao/webhookEvents.dao.ts`) and has
  exactly one test — `src/__tests__/ulid.test.ts`. The DAO layer's real-Postgres behaviour is covered only
  _transitively_, through `identity`'s and `identity-webhooks`' suites; a DAO change that breaks a caller
  neither service exercises is uncaught, and the package can be built and published green on its own.
  **`clients/usda`** validates an untrusted third-party wire shape at the boundary
  (ADR-0014 / `docs/CODING_STANDARDS.md:1176-1187`) with a single unit test and no transport-level tier, while
  its two peer clients (`clients/recipe-service`, `clients/food-service`) both have real
  `src/__integration__/` suites driving a booted `node:http` server. That asymmetry is the gap: the client we
  trust least has the weakest tier.
- **Smallest fix:** Prioritise the two that carry real risk — a real-Postgres integration tier for
  `shared/identity-db`'s DAOs, and an undici-`MockAgent`/booted-server transport tier for `clients/usda`
  (the pattern already exists at `food-service/tests/e2e/usda-adapter-http-contract.e2e.test.ts`). Then make a
  deliberate, written ruling on whether pure-function packages (`recipe-core`, `features/core`, `utils/identity`)
  are exempt from §7.1's "libraries" clause — today they are silently non-compliant, which is worse than an
  explicit carve-out.
- **Verified (how):** Enumerated every workspace's `package.json` scripts and config files programmatically;
  `find`-counted source vs test files per package; `ls packages/shared/identity-db/src/`.

## F-T14 — `packages/schemas/*` have no `test` script, so `turbo run test` skips them silently

- **Severity:** Low
- **File/Package:** `packages/schemas/food`, `packages/schemas/identity`, `packages/schemas/recipe`
- **Gap:** Each declares only `build` and `typecheck`. `turbo run test` (the `Test` CI job, `_ci.yml:300`)
  runs a task only in packages that define it, so all three are skipped with no output distinguishing
  "skipped" from "passed". They export runtime zod validators that clients import.
- **Why it matters:** Mostly covered by design: staleness is caught by the `contract-drift` job
  (`_ci.yml:253-276`) and parse behaviour is exercised in the owning service. The residual gap is that a
  hand-edit to a generated schema package that _round-trips_ through the generator (so drift stays clean) has
  no test of its own asserting the exported validator still rejects what it must.
- **Smallest fix:** Add a `test` script + one spec per schema package asserting each exported zod rejects a
  representative invalid payload — the cheapest possible non-vacuity proof for a package clients depend on.
- **Verified (how):** Read all three `package.json` files; read the `test` task definition in `turbo.json:113-116`.

## F-T15 — no end-to-end coverage of the async PENDING → RESOLVED transition on either platform

- **Severity:** Medium (**High for PR 91**)
- **File/Package:** `packages/apps/commise/web/tests/e2e/*.spec.ts`; `packages/apps/commise/mobile/.maestro/`
- **Gap:** The ingredient food-resolution flow — the repo's only existing async, poll-to-terminal-state UI
  mechanism — is covered at unit and integration level well (11 test files reference `FoodResolutionStatus`,
  including `features/recipes/src/hooks/__tests__/usePollIngredientStatus.test.tsx` and
  `recipe-service/__tests__/integration/ingredients/add-by-name.integration.test.ts`). But **no Playwright spec
  or Maestro flow drives the transition**: the single e2e touchpoint is
  `packages/apps/commise/web/tests/e2e/ingredientCatalogPick.spec.ts:55`, which asserts a line that is
  _already_ `Resolved` in the mocked ADMIT response. `grep -rln "foodResolutionStatus\|IngredientStatus\|resolving"`
  across all 32 web specs returns zero files.
- **Why it matters:** The one behaviour a unit test structurally cannot prove for a poller is that the UI
  actually _arrives_ at the terminal state in a real browser/device — that the poll is mounted, keyed and
  unmounted correctly against real React scheduling. That is the exact shape of PR 91's "async status
  messages", one layer more complex (bulk, many rows, partial failure).
- **Smallest fix:** Add one Playwright spec that serves PENDING first and RESOLVED on the second
  `page.route('**/api/v1/**')` fulfilment, and asserts the badge flips; add the Maestro mirror. Do this
  **before** PR 91 lands, so the import UI inherits a proven pattern instead of inventing one.
- **Verified (how):** Listed all 32 specs and 33 flows; grepped each for the status vocabulary; read
  `ingredientCatalogPick.spec.ts:52-55`.

## F-T16 — cross-platform parity gap on the exact component PR 91 will duplicate

- **Severity:** Low
- **File/Package:** `packages/apps/commise/mobile/src/components/IngredientStatusPoller.tsx` (no test) vs.
  `packages/apps/commise/web/tests/components/recipes/IngredientStatusPoller.test.tsx` (5 tests)
- **Gap:** The mobile adapter has no test at all; `grep -rn "IngredientStatusPoller"
packages/apps/commise/mobile/tests/` returns nothing. Four other mobile components are likewise unreferenced
  by any test: `src/components/account/SignOutButton.tsx`, `src/components/home/RoadmapWidgetSlot.tsx`,
  `src/components/home/skeletons/PlaceholderWidgetCard.tsx`, `src/components/RootErrorFallback.tsx`.
  (`RootErrorFallback` is in fact covered transitively and correctly by
  `tests/screens/AppRoot.native.test.tsx:62-82` — I verified it and it is **not** a gap; the other four are.)
- **Why it matters:** The mobile poller is a 4-line pass-through to the tested shared hook, so the _logic_ risk
  is small. The **process** risk is what matters: the web sibling got five tests and the mobile one got zero
  on the same feature, which is the parity drift `docs/CODING_STANDARDS.md:955-964` (§14.1 Lockstep Parity)
  exists to prevent — and PR 91 ships an import UI on both platforms.
- **Smallest fix:** Add the mobile `.native.test.tsx` mirroring the web file's five cases; it can reuse
  `features/recipes/vitest.native.config.ts`'s existing stubs.
- **Verified (how):** Scripted a per-component "is this name referenced by any test file" sweep over
  `mobile/src/{screens,components}` and `web/src/{components,app}`; read the mobile poller and
  `AppRoot.native.test.tsx` in full to separate the real gaps from the transitively-covered one.

---

## Where the missing tiers bite hardest for PR 91 (bulk import + async status + food shell entries + import UI)

Ranked by what would actually reach production behind green checks.

1. **Async import status has no e2e proof on either platform (F-T15).** PR 91's status messages are the
   ingredient poller's problem at N rows. The repo has no executable precedent for asserting a status
   transition in a browser or on a device — so PR 91 will either invent one under time pressure or ship
   unit-only. Fix F-T15 first; it is the highest-leverage item in this report.
2. **Bulk import is a load-shaped change and k6 is opt-in (F-T12 + heavy-tier gating).** Every k6 job sits
   behind one shared `run_load_test` input (`_ci-heavy.yml:434,651,1021`) reached via nightly, dispatch, the
   `heavy-e2e` label, or a **food-search path filter** (`heavy-e2e.yml:407-411`) that does not name
   recipe-service import paths. A bulk-import endpoint can therefore merge with zero load evidence unless
   somebody remembers the label. Extend the path filter to the new import routes in the same PR.
3. **`recipe-service`'s pool config is untested (F-T8) and bulk import is exactly what exhausts a pool.**
   Connection count, IAM-token refresh under sustained connection churn, and the `DATABASE_URL`-vs-`DB_*`
   precedence all become live concerns the moment a request opens many short transactions. Copy food's test
   before, not after.
4. **Food shell entries cross a service boundary with no repo-wide tier guard (F-T4).** The contract tiers
   that would catch skew — `clients/food-service`'s `src/__integration__/contractSkew.integration.test.ts` and
   the `contract-drift` job — are wired today by hand. If PR 91 adds a new client method or a new integration
   config and no CI step, it is green and dark, exactly as recipe-service's e2e tier was for months.
5. **New import UI on both platforms inherits F-T5 and F-T16.** There is no visual-regression comparison at
   all, and the most recent cross-platform component already shipped with tests on web and none on mobile.
   A new two-platform surface will repeat both unless the guards land first.
6. **Mobile's e2e tier cannot be trusted as a signal (F-T1/F-T2).** If PR 91's import flow is added to
   `@commise/mobile`'s `test:e2e`, it joins a tier whose sole existing member tests a function it declares
   itself. Fix the tier before adding to it.

---

## Release Decision

**NOT READY** — as a _test-coverage posture_ for taking PR 91. The branch's own CI is fully green (verified:
25/25 base jobs, 4/4 heavy jobs) and I found no failing gate. These are blockers on the coverage system, not
on this branch's functionality:

1. **F-T1 / F-T2** — a named CI tier that verifies nothing, double-collected. Must be fixed before any new
   mobile e2e work.
2. **F-T3** — a tautological spec presenting itself as latency coverage.
3. **F-T4** — no guard holding vitest tiers to CI, for a failure with a 2-for-2 record here and a new tier
   arriving in PR 91.
4. **F-T5** — the visual-regression gate cannot fire, while a new two-platform UI is inbound.
5. **F-T15** — no e2e proof of an async status transition, which is PR 91's central mechanism.

F-T6, F-T8, F-T11, F-T12, F-T13 should be scheduled; F-T7, F-T9, F-T10, F-T14, F-T16 are debt worth tracking.

## Next Steps

- **Before PR 91 opens:** F-T1, F-T2, F-T3 (deletions/one-line config), then F-T15 (one Playwright spec + one
  Maestro flow establishing the async-status pattern PR 91 will copy).
- **In PR 91 itself:** F-T8 (copy food's `pool-config.test.ts`), extend `heavy-e2e.yml`'s `run_load_test` path
  filter to the new import routes, and add the import routes' k6 script alongside the endpoint.
- **Next sprint:** F-T4 and F-T6's guard half (one test in `packages/infra/global/__tests__/`, reusing
  `k6-load-tier-wiring.test.ts`'s workflow parser), F-T11 (`passWithNoTests: false`), F-T12 (coverage ratchet
  seeded at today's numbers).
- **Recommend to the main session:**
    - `compound-engineering:ce-testing-reviewer` — a deeper per-file mutation review of the ~330 UI component
      tests, which I sampled rather than exhausted.
    - `per-1` — whether bulk import needs its own k6 profile and SLO, and whether recipe-service's pool sizing
      holds under it.
    - `staff-architect` — the tier-wiring guard's shape (F-T4/F-T6) is a cross-cutting seam; it should be
      designed once, not bolted on.
    - `sre-1` — F-T5 (Argos project provisioning) and F-T6's operational half.

**Confidence: High** for everything asserted (each finding was read at source and, where behavioural,
confirmed with a read-only command). **Medium** for completeness — see below.

---

## Not examined

- **I ran no test suite.** No `npm test`, no `vitest run`, no `pytest`-equivalent, no Playwright, no k6, no
  integration tier. All pass/fail statements come from `gh run view` on runs 31762375997 / 31762376012, or
  from `vitest list` (collection only, no execution).
- **Mutation testing was reasoning, not execution.** `packages/services/recipe-service` has a `test:mutation`
  (`stryker run`) script; I did not run it, and no CI job does either. Every "this mutation survives" claim is
  derived from reading the code and the assertion, not from an executed mutant.
- **Not exhaustively reviewed:** the ~330 UI component tests in `web`, `mobile`, `ui`, `features/recipes`
  (106 files) and `features/account`. I sampled them with three programmatic heuristics — assertion-free
  files, ≥80% mock-only assertions, ≥70% weak assertions — read every hit, and confirmed that
  `packages/infra/global/__tests__/shared-alb-stack.test.ts` (0 `expect()`, but CDK `Template.*` throws) and
  `features/recipes/src/components/__tests__/RecipeWidgetCard.native.test.tsx` (`getByRole` throws) are
  **false positives**, not findings. Individual assertion quality across the remainder is unaudited.
- **Not reviewed at all:** the 53 tests in `packages/infra/global/__tests__/` beyond the four I cite
  (`k6-load-tier-wiring`, `maestro-flow-selection`, `workflow-invariants`, `shared-alb-stack`); the
  `packages/services/*/infra/__tests__/` CDK synth suites; `packages/tools/eslint`'s three RuleTester specs;
  the Maestro YAML flow bodies (I listed and traced their selection, I did not read what they assert); the k6
  scripts' threshold values (I confirmed they run, not that their SLOs are right).
- **Not verified:** whether `ARGOS_ENABLED` exists as an _environment_-scoped variable rather than a
  repository one — `gh variable list` shows repository scope only. If it does exist at environment scope,
  F-T5's severity drops (the workflow reads `vars.`, which resolves environment vars only for jobs with an
  `environment:` key, and `e2e-web-report` has none — so I believe the finding stands, but I could not prove
  the negative for every scope).
- **Not verified:** whether vitest's base `exclude: ['node_modules', 'dist']`
  (`packages/tools/vitest/vitest.config.js`) — which replaces vitest's `**/node_modules/**` default rather
  than extending it — can collect tests from a nested `node_modules`. I checked one consumer
  (`shared/recipe-core`, 13 files, clean) and found no leak; I did not check all 20 consumers. Latent, not
  demonstrated, and deliberately not filed as a finding.
- **Not examined:** PR 91's actual diff. It is not on this branch and I did not fetch it; section 5 reasons
  from the task's description of it (bulk import, async status messages, food shell entries, import UI on both
  platforms) against the existing codebase.
