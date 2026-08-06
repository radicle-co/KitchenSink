---
type: feat
created: 2026-08-02
status: ready
---

# feat: Code-quality, architectural-enforcement and review stack

## Summary

Close the enforcement gaps that are free and currently open, add the two layers nothing covers today (the workspace-dependency graph and the import boundary), reconfigure code review so one reviewer can read an ADR before advising a revert, and generalise the workflow-invariant guard pattern this repo already invented — because for the defect classes that have actually hurt us, it outperforms every product on the market.

---

## Problem Frame

Three defects shipped from a single recent session, and all three are **systemic rather than line-level**:

1. A missing-bundle fallback that **returned success**. CloudFormation recorded `CREATE_COMPLETE` for a 101-byte no-op, so production ran four weeks with no `food_app` database role behind green deploys, surfacing later in a different service as a Postgres auth error.
2. A **CI step-ordering hazard** — a build step placed after `npm prune --omit=dev`, so a devDependency binary was gone and the step died with exit 127.
3. **Workflow-reachability dead code** — production deploy legs that no trigger could reach, so they silently never ran.

Line-level review is already well covered. What is missing is enforcement of _structure_ and _intent_: the dependency graph, the import boundaries, the deliberate decisions recorded in ten ADRs, and the invariants that live in CI configuration rather than in application code.

Two findings reframe the problem away from "buy a better reviewer":

- **The reviewer that would have caught defects 2 and 3 never ran.** Copilot refused the PR containing them — 1,704 files, 210 "exceeds maximum" comments, zero findings. PR-size discipline is a larger measured lever than any tool choice.
- **The bots that do run are being briefed with false context.** `AGENTS.md` is auto-ingested by Copilot, CodeRabbit and Qodo, and it names the wrong auth vendor and states the inverse of a live ADR ruling.

---

## Requirements

| ID  | Requirement                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------- |
| R1  | Review bots must receive accurate repository context, including the ADR rulings that make deliberate decisions look like bugs |
| R2  | Credential leaks must be blocked at push time, not discovered after the fact, on a public repository                          |
| R3  | GitHub Actions workflows must be covered by the SAST that already runs for application code                                   |
| R4  | Undeclared (phantom) workspace dependencies must fail CI rather than resolve silently through hoisting                        |
| R5  | The prose import rules in `docs/CODING_STANDARDS.md` §4 and §14.2 must be machine-enforced                                    |
| R6  | At least one reviewer must be able to read an ADR before recommending a change that reverts it                                |
| R7  | The silent-success defect class must be checked by something other than human attention                                       |
| R8  | Workflow invariants (step ordering, job reachability, artifact pairing) must be guarded by executable tests                   |
| R9  | Infrastructure code must have security linting proportionate to owning VPC, IAM, RDS, S3 and ALB                              |
| R10 | Visual regressions must be detectable on both web and mobile without adding a paid vendor                                     |
| R11 | Reviewer selection must rest on measured hit-rate against known defects, not vendor claims                                    |

---

## Key Technical Decisions

**KTD1 — CORRECTED 2026-08-05: this repo has no CodeQL of its own, and no code scanning at all.** The original version of this decision asserted that CodeQL already ran via default setup and that the only gap was the `actions` language. That was **wrong**, and the correction changes U3 from a config tweak into standing CodeQL up for the first time. Verified from four angles:

- `GET /code-scanning/default-setup` → `state: "not-configured"` (its `languages` array lists _available_ languages, not enabled ones — that is what I misread).
- No CodeQL workflow file exists anywhere in `.github/workflows/`.
- `GET /code-scanning/analyses` and `/code-scanning/alerts` → **404 `no analysis found`**. This is genuine emptiness, not a scope problem: the same token successfully reads `default-setup`, which requires the same permission. My earlier claim that the 404 was "my token lacking `security_events`" was incorrect.
- The runs whose `workflowName` is `CodeQL` have `name: "Code Quality: PR #90"` and `event: dynamic` — they belong to **GitHub Code Quality**, a GitHub-hosted product, not to us.

So the `Analyze (javascript-typescript)` / `Analyze (python)` jobs I verified as succeeding are real, but they are **Code Quality's** CodeQL, which surfaces findings as PR comments and does **not** publish SARIF to code scanning. Hence: no Security tab data, no alert history, no dismissal workflow, and no `actions` coverage.

Two consequences: (1) the two earlier research passes that concluded "no SAST is running" were **right**, and overruling them propagated a false premise into this plan; (2) the Code Quality keep/disable question below is now materially more consequential, because disabling it removes the only CodeQL execution in the repository.

One piece of good luck: because default setup is `not-configured`, an advanced-setup workflow can be added with **no conflict** — the usual "disable default setup first" ordering trap does not apply here.

**KTD2 — `security-and-quality`, not `security-extended`.** The query closest to our defect-3 class, `actions/if-expression-always-true`, is tagged `actions` + `maintainability` with **no `security` tag**. `security-extended` widens precision but keeps the security-tag filter, so it silently omits that query. Only `security-and-quality` drops the filter.

**KTD3 — CodeRabbit is the only added vendor.** This reverses an earlier recommendation of SonarQube Cloud. CodeRabbit's free tier is gated on repository _visibility_ alone, and it runs Semgrep, Checkov, Trivy, actionlint and TruffleHog inside the review. Adding Sonar or Snyk on top buys overlapping findings and a second triage inbox.

**KTD4 — Fix the reviewer's context before adding reviewers.** A bot told the wrong auth vendor and the inverse of a live ADR produces confidently wrong advice. This is the cheapest change in the plan and gates the value of every other reviewer.

**KTD5 — Advisory first, blocking once clean.** Rules measuring zero violations today (`import-x/no-relative-packages`, the app→service type-only rule) gate immediately. Rules with an existing backlog (`turbo boundaries` at 209 findings, cdk-nag on live stacks) land advisory with a baseline, then ratchet.

**KTD6 — Own the rules for our own failure classes.** Of the three benchmark defects, one is reachable off-the-shelf, one is a coin flip, and workflow reachability is caught by nothing on the market — verified against every shipped CodeQL `actions` query, all 41 zizmor audits, and actionlint's full check list. The existing vitest-over-parsed-workflow-YAML guards are the better answer and already exist; generalising them outranks buying a fourth bot.

**KTD7 — No new visual vendor.** Web uses Argos Hobby ($0, 5,000 screenshots/month, visibility-gated) inside the existing Playwright specs. Mobile needs nothing bought: Maestro shipped `assertScreenshot` in CLI v2.2.0 with `thresholdPercentage` and `cropOn`, and we already own ~29 flows plus an emulator job.

---

## High-Level Technical Design

Five enforcement lanes, chosen so no two occupy the same ground:

| Lane           | Reads                         | Catches                                                           | Mechanism                                                      |
| -------------- | ----------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| Manifest truth | `package.json` graph          | phantom/undeclared deps, out-of-package imports                   | `turbo boundaries`                                             |
| Source truth   | the AST                       | relative imports crossing workspaces, banned syntax               | ESLint + `import-x`                                            |
| Config truth   | workflow YAML + embedded bash | step ordering, job reachability, artifact pairing                 | vitest guards                                                  |
| Security truth | code, IaC, dependencies       | vulns, IaC misconfig, leaked secrets                              | CodeQL + zizmor + CodeRabbit's bundled tools + push protection |
| Intent truth   | ADRs, standards, the diff     | reverts of deliberate decisions, silent-success, coverage theatre | reviewers with repo context                                    |

The first three are deterministic and produce no comment noise. The fifth is the only one that can read intent, and is also the only one that can be confidently wrong — which is why R1 gates it.

---

## Implementation Units

### Phase 1 — The free floor

### U1. Correct the context every review bot ingests

**Goal:** Stop briefing reviewers with false information.
**Requirements:** R1
**Dependencies:** none
**Files:**

- Modify: `AGENTS.md`
- Modify: `.github/copilot-instructions.md`
- Create: `.github/instructions/infra.instructions.md`, `.github/instructions/workflows.instructions.md`
- Create: `packages/infra/global/__tests__/reviewer-context.test.ts`

**Approach:** `AGENTS.md` currently names `@auth0/nextjs-auth0` and `react-native-auth0` for a Clerk repo, and states _"Sandbox front-ends use path routing, NOT per-PR subdomains"_ — the inverse of the ruling since the 2026-07-13 cutover, where the path form 404s by design. Correct both. Then add path-scoped Copilot instruction files with `applyTo` frontmatter, inlining each ADR's "looks wrong, isn't" ruling scoped to the paths it governs. Copilot's documentation states instructions cannot follow external links, so the rulings must be inlined rather than referenced.

**Patterns to follow:** the "Deliberate decisions — looks wrong, isn't" section of `CLAUDE.md` is the source of truth for the rulings.

**Test scenarios:**

- `AGENTS.md` contains no reference to `auth0` (the repo uses Clerk) — fails on the current file
- `AGENTS.md` does not assert path routing as the current sandbox addressing form
- Every ADR marked deliberate in `CLAUDE.md` appears in at least one instruction file or `AGENTS.md`
- Each `.github/instructions/*.instructions.md` has `applyTo` frontmatter naming at least one glob

**Verification:** the guard fails against today's `AGENTS.md` and passes after correction.

---

### U2. Turn on repository secret protection

**Goal:** Block credential pushes on a public repository.
**Requirements:** R2
**Dependencies:** none
**Files:** none in-repo — repository settings change, recorded in `docs/CI_ARCHITECTURE.md`

**Approach:** Secret scanning, push protection, non-provider patterns and validity checks are all currently disabled. All are free on public repositories. Enable, then record the expected state so drift is noticeable.

**Test expectation: none —** this is a repository setting with no code surface. Verified by API read rather than a test.

**Verification:** `security_and_analysis.secret_scanning.status` and `secret_scanning_push_protection.status` both read `enabled`; a scratch branch pushing a dummy test credential is rejected.

---

### U3. Extend CodeQL to workflows, and add zizmor

**Goal:** Cover GitHub Actions with the SAST already running for code.
**Requirements:** R3
**Dependencies:** none
**Files:**

- Create: `.github/workflows/codeql.yml`
- Create: `.github/workflows/zizmor.yml` (or a job within the existing CI)

**Approach:** Stand up CodeQL for the first time via advanced setup — see the corrected KTD1: there is no default setup to migrate from, and `code-scanning/analyses` is empty, so this also lights up the Security tab, alert history and SARIF that the repo currently has none of. Because default setup is `not-configured`, the workflow can be added with no conflict. Include `actions` (GA, `build-mode: none`) alongside `javascript-typescript` and `python` (46 tracked `.py` files, all vendored SpecKit tooling — low value but near-zero cost). Select `security-and-quality` per KTD2. Add zizmor for the 40 audits CodeQL does not cover, uploading SARIF.

**Patterns to follow:** existing workflow conventions in `.github/workflows/_ci.yml` — pinned action versions, Node 24.

**Test scenarios:**

- The CodeQL workflow's language list includes `actions` — fails today
- The configured query suite is `security-and-quality`, not `default` or `security-extended`
- Both new workflows pass `actionlint`

**Verification:** a CodeQL run reports analysis for three languages; zizmor SARIF appears in the Security tab.

---

### Phase 2 — Boundaries

### U4. Fix the phantom dependency, then gate the graph

**Goal:** Make undeclared workspace dependencies fail rather than resolve by hoisting.
**Requirements:** R4
**Dependencies:** none
**Files:**

- Modify: `packages/apps/commise/web/package.json`, `packages/apps/commise/mobile/package.json`
- Modify: `package.json` (root script), `.github/workflows/_ci.yml`
- Create: `packages/infra/global/__tests__/workspace-boundaries.test.ts` (or a boundaries baseline file)

**Approach:** `@commise/features-core` is imported from production source in both web and mobile but declared in neither manifest — it resolves only through npm workspace hoisting, which is exactly the class that survives a local build and breaks in a container. Declare it in both. Then wire `turbo boundaries` as a script and CI step. The remaining ~209 findings (mostly devDependency-shaped) land as an allowlist baseline to burn down, per KTD5.

**Execution note:** fix the production defect first as its own commit, so it is not buried in baseline churn.

**Patterns to follow:** the memory note on shared workspace package exports — verify build-order changes from a clean state, or the failure is invisible.

**Test scenarios:**

- `@commise/features-core` appears in both apps' dependencies
- `turbo boundaries` exits non-zero on an introduced undeclared import, and zero on the baselined tree
- A clean-state install (no hoisted `node_modules`) can resolve every production import

**Verification:** boundaries runs in CI and fails on a deliberately-introduced phantom import.

---

### U5. Register the import boundary rules

**Goal:** Machine-enforce the prose import rules.
**Requirements:** R5
**Dependencies:** none
**Files:** Modify `packages/tools/eslint/index.js`

**Approach:** `eslint-plugin-import-x` is installed and a declared peer dependency but never registered. Add `import-x/no-relative-packages` (encoding §4: a relative path may never leave its workspace) and extend the existing `no-restricted-imports` block so apps may import only _types_ from a deployable service (§14.2). Both measure **zero violations today**, so they gate immediately rather than needing a baseline.

**Patterns to follow:** the existing `check-file` and `native-a11y` plugin blocks in the same file.

**Test scenarios:**

- Lint passes on the tree unchanged (proves the pure-ratchet claim)
- A deliberately-added relative import crossing a workspace boundary fails lint
- A value import from a service package fails; the same import as `import type` passes

**Verification:** full `turbo run lint` green, and each negative case fails as expected.

---

### Phase 3 — Review

### U6. Give one reviewer the ability to read an ADR

**Goal:** Replace the diff-locked reviewer with one that can check intent.
**Requirements:** R6, R7
**Dependencies:** U1
**Files:** Modify `.github/workflows/claude-code-review.yml`

**Approach:** The stock `code-review` plugin is prompt-locked to the diff and granted only `Bash(gh …)` — no `Read`, `Grep` or `Glob` — so it structurally cannot open `docs/architecture/decisions/`. Swap it for the `pr-review-toolkit` plugin with an explicit prompt. Two of its agents match our failure classes: `silent-failure-hunter`, whose charter states fallbacks must be explicit and that falling back without user awareness is hiding problems (a verbatim description of defect 1), and `pr-test-analyzer`, which judges behavioural rather than line coverage. **`pr-test-analyzer`'s stock prompt must be overridden** — it says "without being overly pedantic about 100% coverage", which contradicts the absolute §7.1 mandate. Label-gate the workflow so it does not fire on every push.

**Test scenarios:**

- The workflow grants `Read`/`Grep` and names the ADR directory in its prompt
- The prompt overrides the coverage-pedantry language
- The workflow is label-gated rather than firing on every synchronize

**Verification:** on a PR touching a guard-commented file, the reviewer cites the relevant ADR rather than proposing a revert.

---

### U7. Reviewer bake-off against known defects

**Goal:** Choose reviewers on measured hit-rate, not marketing.
**Requirements:** R11
**Dependencies:** U1, U6
**Files:** Create `docs/solutions/2026-08-reviewer-bakeoff.md` (results)

**Approach:** Replay commit `de07bdaf` as a **1-file / 193-line** draft PR — deliberately under Copilot's 300-file cliff, so for the first time all reviewers actually run and we measure capability rather than refusal. That commit introduced defects 2 and 3, and their fixes (`c11b9252`, `50d5a1fb`) plus the two guard tests give unambiguous ground truth. Replay the `data-stack.ts` inline-stub hunk separately for defect 1. Run a **third, separate ADR-trap PR** touching the NAT instance or shared ALB.

Score per arm, in this order: **(a) ADR-revert count** — how often it advised undoing a documented deliberate decision; then **(b)** did it name the ground-truth defect; **(c)** total comments; **(d)** false positives. A bot scoring above zero on (a) is net-negative regardless of hit rate.

**Test expectation: none —** this unit produces a measurement, not code.

**Verification:** a results table with all four scores per arm, and a stated decision on which reviewers stay.

---

### Phase 4 — Our own rules

### U8. Generalise the workflow-invariant guard pattern

**Goal:** Cover the defect classes no product catches.
**Requirements:** R8
**Dependencies:** none
**Files:**

- Create: `packages/infra/global/__tests__/workflow-invariants.test.ts`
- Modify: existing guards if shared helpers are extracted

**Approach:** Three guards already exist and work — build-order, reachability, bootstrap-bundle — and they share a pattern worth generalising: parse the workflow YAML, and **execute the embedded bash rather than re-implementing it**, so a second copy of the rules cannot drift from the one CI runs. Extend to invariants currently unguarded: every job in the `needs` closure of a real trigger is reachable; every `download-artifact` name has an earlier matching upload; no prune-like step precedes a build-like step; and the `continue-on-error` / `|| true` surface (8 and 9 occurrences respectively) is enumerated so silent-success additions are visible.

**Execution note:** test-first — each invariant's test must be observed failing against a deliberately broken fixture before the assertion is trusted.

**Patterns to follow:** `packages/infra/global/__tests__/prod-deploy-reachability.test.ts` — in particular its treatment of an unrecognised `${{ }}` expression as a hard error rather than an empty string.

**Test scenarios:**

- A job unreachable from any trigger fails the guard
- A `download-artifact` with no matching upload fails
- A build step placed after the prune fails
- A new `continue-on-error` appears in the enumerated inventory
- Each assertion is mutation-verified: reverting the fix re-reds the test

**Verification:** all guards green on current `main`, and each fails against its broken fixture.

---

### Phase 5 — Breadth

### U9. IaC security linting on the CDK apps

**Goal:** Give infrastructure code security coverage proportionate to its blast radius.
**Requirements:** R9
**Dependencies:** none
**Files:** Modify the CDK app entrypoints under `packages/infra/global/bin/` and each service's `infra/bin/`; add a CI step

**Approach:** There is no cdk-nag, no Checkov and no `Aspects` anywhere, on infrastructure owning VPC, IAM, RDS, S3 and ALB. Add cdk-nag as an `Aspect` in **advisory mode** first — it will surface a backlog on live stacks, and per KTD5 that backlog is suppressed-with-reason rather than fixed in this plan. Each suppression must carry a justification.

**Test scenarios:**

- Synth succeeds with the Aspect attached
- Findings are reported without failing the build in advisory mode
- Every suppression carries a non-empty reason
- **Prod templates are unchanged** — an Aspect that alters synthesized output would breach the no-prod-diff line (ADR-0002 / ADR-0008)

**Verification:** `cdk synth` for prod produces a byte-identical template to `main` before the change.

---

### U10. Visual regression on both platforms

**Goal:** Detect visual regressions without adding a paid vendor.
**Requirements:** R10
**Dependencies:** none
**Files:**

- Modify: `packages/apps/commise/web/playwright.config.ts` and selected specs under `packages/apps/commise/web/tests/e2e/`
- Modify: selected flows under `packages/apps/commise/mobile/.maestro/`
- Create: a mockup-fidelity spec comparing `docs/mockups/screens/screen-*.html` against the implementation

**Approach:** Web uses Argos (Hobby tier, OIDC tokenless auth — which matters because fork PRs cannot see secrets). Mobile uses Maestro's own `assertScreenshot` with baselines committed as PNGs, pinned to one emulator profile, behind the existing `heavy-e2e` label. For mockup fidelity, build rather than buy: the nine mockups are self-contained static HTML, so one Playwright pass can screenshot mockup and implementation at the same viewport in the same browser and hand both to an LLM with the token scale — which reasons about tokens and WCAG intent in a way pixel-diff products do not.

**Test scenarios:**

- A deliberate colour change to a token fails the web visual check
- A deliberate layout change fails the corresponding Maestro flow
- Baselines are stable across two consecutive unchanged runs (no flake from font rendering)

**Verification:** both platforms produce a baseline and detect a seeded regression.

---

## Scope Boundaries

**Not doing:**

- SonarQube Cloud, Snyk Code — superseded by CodeRabbit's bundled toolchain (KTD3)
- dependency-cruiser, knip — largely redundant with `turbo boundaries` at several times the setup cost
- CodeScene, Codacy, Qlty, Nx boundaries, Sheriff, ts-prune — rejected on capability, staleness, or migration cost
- Chromatic (needs a Storybook we do not have), Percy/Applitools for mobile (Appium-driven, would mean a second suite)
- Adding a LICENSE — a commercial decision, not a tooling one

### Deferred to Follow-Up Work

- Burning down the ~209 boundaries baseline
- Fixing the cdk-nag backlog and moving it from advisory to blocking
- The `process.env['KEY']` bracket-notation lint rule — the selector works but yields 84 hits, four of which are _mandatory_ dot-access for Next.js/Expo static inlining, so it needs scoping and exemptions
- Removing the `/v1/*` deprecated route alias once the Clerk dashboard is repointed and shipped mobile builds drain (ADR-0011)

---

## Risks & Dependencies

| Risk                                                                                             | Mitigation                                                                          |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Adding reviewers increases noise until U1 lands, making bots confidently wrong about ADRs        | U6 depends on U1; CodeRabbit adopted at `profile: quiet` with path filters          |
| cdk-nag Aspect could alter synthesized prod templates                                            | U9 verification is a byte-identical prod synth against `main`                       |
| Argos baselines flake on font rendering between WSL2 and CI                                      | Use the documented Chromium launch flags; require two consecutive stable runs       |
| CodeRabbit's free tier scales its hourly caps with project popularity, and this repo has 0 stars | Expect the bottom of the 1–10 reviews/hour band; acceptable at current PR volume    |
| The bake-off measures one commit, not a distribution                                             | Three separate replays (two defect classes plus the ADR trap); treat as directional |

---

## Open Questions

- **GitHub Code Quality: keep or disable?** Verified **not** a billing question — the organisation bill shows `["actions"]` only, total net $0.00 across all months, with no code-quality line item. Owner ruling 2026-08-05: **keep, re-decide after the U7 bake-off.** Note the corrected KTD1 raises the stakes — until U3 lands, Code Quality's internal CodeQL is the _only_ CodeQL execution in the repo, so disabling it today would leave zero SAST. Once U3 ships our own analysis, the decision reverts to a pure signal-to-noise call: of ten comments on one PR, one was a real defect (a missing `await` making a test unable to fail — the banned class), two minor, six duplicate nags.
- **PR-size discipline** — enforce under 300 files / 20,000 lines by convention, or add a Danger-style gate? The measured effect is larger than any tool in this plan.
- Whether Danger JS is worth adding for the §7.1 test-mandate gate, or whether `pr-test-analyzer` (U6) covers it adequately.

---

## Sources & Research

- Two research passes this session: architectural-enforcement tooling, and AI code-review agents. Both are cited inline above where they changed a decision.
- **Correction (2026-08-05).** An earlier revision of this section said both passes were "wrong" to conclude no SAST is running, and attributed the code-scanning 404s to a token missing `security_events`. Both statements were incorrect — see the corrected KTD1. The passes were right: there is no CodeQL of our own, no code-scanning analyses, and the 404s are genuine emptiness. The lesson worth keeping: seeing `Perform CodeQL Analysis` succeed in a run list proves _something_ ran CodeQL, not that _we_ did. The discriminating check is `code-scanning/default-setup` plus `code-scanning/analyses`, not the job names.
- Free-tier eligibility was re-checked against the absence of a LICENSE file, which disqualifies Greptile OSS, Qodo OSS, and the Argos and Applitools OSS grants. Only visibility-gated tiers qualify.
