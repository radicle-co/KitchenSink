# PR #91 — Copilot review triage: workflows, CI scripts and their guards

**Date:** 2026-09-04
**Scope:** every open (`isResolved: false`, `isOutdated: false`) Copilot thread on a `.github/` path, plus
the one on `packages/infra/global/__tests__/commentTriggerGuard.test.ts` (a guard over `.github/`).
**Branch:** `chore/code-quality-enforcement-phase-1-2`, from `254a906b`.

⚠️ **Nothing here has been posted to the PR.** Replies are drafted for the owner to approve and send.
No thread was replied to, resolved or reacted to.

## Commits

| Commit     | Unit                                                                   |
| ---------- | ---------------------------------------------------------------------- |
| `371b2d30` | `cfn-export.sh` — a failed lookup is not an absent export              |
| `d5fbe696` | `commentTriggerGuard` — workflow-level env + every `secrets` spelling  |
| `3ffea38f` | the Maestro tier refuses any stage but `sandbox`                       |
| `5d588e4b` | **the merge blocker** — post-prune toolchain, across both deploy flows |

## Disposition summary

| #   | Thread id               | Path:line                          | Verdict            |
| --- | ----------------------- | ---------------------------------- | ------------------ |
| 1   | `PRRT_kwDOR7sDRs6XhHcI` | `.github/scripts/cfn-export.sh:65` | **fixed**          |
| 2   | `PRRT_kwDOR7sDRs6Xbohn` | `.github/scripts/cfn-export.sh:87` | **fixed**          |
| 3   | `PRRT_kwDOR7sDRs6a_jnd` | `prod-deploy.yml:268`              | **fixed**          |
| 4   | `PRRT_kwDOR7sDRs6bceIh` | `prod-deploy.yml:672`              | **fixed** ⚠️       |
| 5   | `PRRT_kwDOR7sDRs6bZ0_Z` | `prod-deploy.yml:753`              | **fixed** ⚠️       |
| 6   | `PRRT_kwDOR7sDRs6bWuzy` | `prod-deploy.yml:774`              | **fixed** ⚠️       |
| 7   | `PRRT_kwDOR7sDRs6blWZK` | `prod-deploy.yml:853`              | **fixed**          |
| 8   | `PRRT_kwDOR7sDRs6bCf_K` | `ci-full.yml:73`                   | **fixed**          |
| 9   | `PRRT_kwDOR7sDRs6bCVVi` | `claude-code-review.yml:85`        | **owner-decision** |
| 10  | `PRRT_kwDOR7sDRs6bZHFU` | `commentTriggerGuard.test.ts:195`  | **fixed**          |

⚠️ = the defect is real and fixed, but the comment's stated **mechanism** is factually wrong and the
drafted reply corrects it. Endorsing a false premise in a reply is how the false premise becomes folklore.

---

## 1. `cfn-export.sh:65` — the CLI failure is swallowed by the pipeline (`PRRT_kwDOR7sDRs6XhHcI`)

**Verdict: fixed** (`371b2d30`).

**Evidence.** The comment is correct and the script's own docblock claimed the opposite. The lookup was one
pipeline:

```bash
value=$(aws cloudformation list-exports … --query … | grep -vx 'None' | head -n1 || true)
```

Under `set -o pipefail` the CLI's exit 255 becomes the pipeline's status; the `|| true` — present to absorb
`grep`'s exit 1 when every page is `None`, the legitimate "absent" case — absorbs the CLI failure too. The
empty `value` then fell into the `-z` branch and was reported as `export … not found`. Measured against the
real script with an `aws` stub that exits 255 with a credentials error: status **1**, stderr `not found`,
the CLI's own diagnostic discarded.

**Fix.** The CLI call is captured on its own, before any filtering, so its status is observed. The contract is
now three-valued: `0` found, `1` absent, `2` the lookup failed — with the CLI's stderr passed through
untouched, because it names the actual cause. The usage error moved from `2` to `64` (`EX_USAGE`) so a caller
bug cannot read as a lookup failure.

**Draft reply.**

> Correct, and the docblock claimed the opposite ("a genuine CLI failure still aborts"), which is why reading
> it did not catch this. Fixed in `371b2d30`: the `aws` call is now captured on its own before any filtering,
> so its exit status is observed rather than folded into the pipeline. The script has three outcomes instead
> of two — `0` found, `1` absent, `2` lookup failed — and the CLI's own stderr is passed through untouched.
> `cfnExport.test.ts` drives the real script with an `aws` stub that exits 255 with a credentials error and
> pins the two non-zero statuses as distinct; both cases were watched fail first.

---

## 2. `cfn-export.sh:87` — `--optional` swallows everything (`PRRT_kwDOR7sDRs6Xbohn`)

**Verdict: fixed** (`371b2d30`).

**Evidence.** Same root cause, worse blast radius. `resolve_cfn_export_optional` ran the strict lookup inside
an `if` — which disables `errexit` for the tested command — and returned `0` on **every** branch. Measured:
with the credentials-failure stub, `--optional` exited **0** and printed nothing, which every caller reads as
"the export is absent, the stack is not deployed yet". Eleven call sites use `--optional`.

**Fix.** The tolerance is keyed on the **status**, not on "non-zero": only `1` (absent) maps to `0`. A lookup
failure propagates with its diagnostic and aborts the caller's `set -e` assignment.

**Draft reply.**

> Right, and it was the more dangerous half: `--optional` returned 0 on every branch, so a credentials or
> permissions failure was reported to eleven call sites as "not deployed yet". Fixed in `371b2d30` — the
> tolerance is now keyed on the status rather than on "non-zero", so only `1` (absent) maps to 0 and a lookup
> failure still propagates. Watched fail first against the real script with a stub `aws` exiting 255.

---

## 3. `prod-deploy.yml:268` — `@sentry/cli@latest` in the production deploy (`PRRT_kwDOR7sDRs6a_jnd`)

**Verdict: fixed** (`5d588e4b`).

**Evidence.** Correct. The step runs `npx @sentry/cli@latest` twice with `SENTRY_AUTH_TOKEN` in scope, so
whatever the registry serves at that moment executes in the deploy environment. (One detail for accuracy: the
step sits _above_ the prune, so this is a pinning problem only, not a post-prune resolution one.)

**Fix.** `@sentry/cli` is now a devDependency of `@kitchensink/identity-webhooks` — the package whose source
maps it uploads — and the step invokes `npx --no-install sentry-cli`, so the binary that runs is the one the
lockfile pins and Dependabot bumps. `--no-install` makes the registry fallback impossible rather than
unlikely. The same treatment was applied to the one other floating tool in the tree, `npx --yes
@argos-ci/cli@6` in `_ci.yml` (a major-only range, so the registry chose the minor on the day).

**Draft reply.**

> Fixed in `5d588e4b`. `@sentry/cli` is now a devDependency of `identity-webhooks` and the step runs
> `npx --no-install sentry-cli`, so the binary executing with the Sentry token in scope is the one the
> lockfile pins. `--no-install` makes the registry fallback impossible rather than merely unlikely. One
> correction for the record: this step is _above_ `npm prune --omit=dev`, so it was a pinning problem only.
> The same fix went to `npx --yes @argos-ci/cli@6` in `_ci.yml`. A new derived guard
> (`postPruneToolchain.test.ts`) now fails on any `npx` whose target the lockfile does not provide or that
> carries a non-exact version.

---

## 4. `prod-deploy.yml:672` — the food deploy leg is unreachable (`PRRT_kwDOR7sDRs6bceIh`)

**Verdict: fixed, mechanism corrected** (`5d588e4b`).

**Evidence — the conclusion is right, the stated reason is measurably wrong.** The comment says the food leg
"is unreachable as written" because "the food package keeps TypeScript and esbuild in devDependencies, so
those binaries … have already been removed". That is false, and it is worth stating plainly because the same
claim was made once before in this repo and recorded as a correction inside
`workflowInvariants.test.ts`: `typescript` is a declared runtime `dependencies` entry of
`packages/tools/contract-gen` and `esbuild` of `packages/tools/esbuild`, so `npm prune --omit=dev` removes
neither. Production run **30764536782** executed the prune and then these very steps, successfully.

Confirmed here with `npm prune --omit=dev --dry-run`: the removal set contains `aws-cdk`, `turbo` and
`@nestjs/cli`, and does **not** contain `typescript` or `esbuild`.

What _was_ broken at that position is different and was not named: the leg's `npx cdk` (removed by the prune,
so it resolved an unpinned CLI from the registry) and, one leg over, the `npx tsx` app runners.

**Fix.** The ordering was wrong regardless — the build survived on a transitive edge nobody asserted, which a
dependency cleanup could remove with no diff in the workflow. Everything that builds now sits above the prune
(`docker:prepare`, `bundle:lambda`, `infra:build` for food, recipe, recipe-workers and ingredient-parser) and
everything below it runs a compiled artefact under `node`.

**Draft reply.**

> Fixed in `5d588e4b`, and thank you — but the stated mechanism is wrong and the correction matters, because
> the same claim was made against this file once before and is recorded as a correction inside
> `workflowInvariants.test.ts`. `typescript` and `esbuild` are declared runtime `dependencies` of
> `packages/tools/contract-gen` and `packages/tools/esbuild`, so `npm prune --omit=dev` removes neither
> (confirmed with `npm prune --omit=dev --dry-run`: the removal set is `aws-cdk`, `turbo`, `@nestjs/cli` and
> friends). Production run 30764536782 executed the prune and then these steps successfully, so the leg was
> not unreachable.
>
> The ordering was still wrong — it survived on a transitive edge nothing asserted — and the _real_ defect at
> this position was the one not named: `npx cdk` after the prune, where `aws-cdk` genuinely is dev-only, so
> the CLI came from the registry unpinned on every production deploy. Both are fixed: all build work is
> hoisted above the prune, the CDK CLI is a root dependency (and excluded from the images via
> `.dockerignore`), and `postPruneToolchain.test.ts` now derives what the prune removes from the manifests
> and the lockfile instead of from a list of command names.

---

## 5. `prod-deploy.yml:753` — unversioned `npx tsx` after the prune (`PRRT_kwDOR7sDRs6bZ0_Z`)

**Verdict: fixed, mechanism corrected** (`5d588e4b`).

**Evidence.** The conclusion is right; the premise ("after `npm prune --omit=dev`, `tsx` is no longer
installed for this workspace") is not. `tsx` is `devOptional: true` in the lockfile: it survives the prune
through `vite`'s optional peer edge. Nothing in this repository declares it. So the step did not fetch from
the registry _today_ — it rested on an accident that any dependency bump could remove, with no diff here, and
at that moment it would begin fetching an unpinned `tsx` and executing it inside the production deploy.

The distinction is worth keeping: "removed" is a live registry fallback, "undeclared survivor" is the same
fallback deferred. Both are violations after a prune, and the new guard reports them as separate classes.

**Fix.** This call site (`printFoodHost.ts`) and every other post-prune `npx tsx` now run compiled output
under plain `node` — `packages/services/food-service/infra/dist/bin/printFoodHost.js` here, emitted by an
`infra:build` hoisted above the prune. Eleven call sites in total across the two deploy workflows.

**Draft reply.**

> Fixed in `5d588e4b` — this now runs `node …/infra/dist/bin/printFoodHost.js`, compiled by an `infra:build`
> hoisted above the prune. One correction: `tsx` is not removed by the prune. It is `devOptional: true` in
> the lockfile and survives through `vite`'s optional peer edge — nothing here declares it. So the risk was
> not a fetch today but a fetch on the day that edge moves, with no diff in this repo to show for it. The new
> guard reports "removed by the prune" and "survives only through an edge nobody declares" as separate
> classes, because they fail at different times and both are violations after a prune.

---

## 6. `prod-deploy.yml:774` — recipe `infra:build` + bundle after the prune (`PRRT_kwDOR7sDRs6bWuzy`)

**Verdict: fixed, mechanism corrected** (`5d588e4b`). Same analysis as #4, recipe leg.

**Draft reply.**

> Fixed in `5d588e4b` — `docker:prepare`, `bundle:lambda` and `infra:build` for recipe are hoisted above the
> prune, and the step below it now only builds and pushes the image. As on the food leg, though, the stated
> mechanism is wrong: `typescript` and `esbuild` are declared runtime dependencies of two tools packages, so
> the prune does not remove them and this leg did run successfully in production (run 30764536782). The
> ordering was still wrong, because it depended on a transitive edge nothing asserted — that is now asserted
> by `postPruneToolchain.test.ts`, which derives the survivor set from the manifests and the lockfile.

---

## 7. `prod-deploy.yml:853` — recipe-workers `npx cdk` + nested `npx tsx` (`PRRT_kwDOR7sDRs6blWZK`)

**Verdict: fixed** (`5d588e4b`).

**Evidence.** The strongest of the four, and half-right on the mechanism in the most important direction:
`aws-cdk` **is** removed by the prune (`dev: true` in the lockfile; no workspace declares it under
`dependencies`), so `npx cdk` fell through to the registry and executed an unpinned CDK CLI inside the
production deploy — including, as the comment says, a CLI potentially incompatible with the checked-in
`aws-cdk-lib`. `tsx` is the "undeclared survivor" case in #5 rather than removed. This was true of **eight**
`npx cdk` sites, not one: every CDK deploy in the job, the identity leg included, plus four more in
`sandbox-identity-deploy.yml`, which also prunes and which no thread mentioned.

**Fix.** Both halves, as the comment recommends. The CDK app compilation moved above the prune, and
`--app "npx tsx …/app.ts"` became `--app "node …/infra/dist/bin/app.js"` for recipe-workers and
ingredient-parser (deploy, verify and drift call sites alike). The CLI itself is kept: `aws-cdk` is now a root
`dependencies` entry so it survives the prune, `.dockerignore` re-excludes `node_modules/aws-cdk` so the
service images stay byte-identical, and the post-prune "Verify runtime dependencies" step runs
`npx --no-install cdk --version` so a regression fails at the prune with the reason rather than at the first
deploy.

**Draft reply.**

> Fixed in `5d588e4b`, and this was the most consequential of the four — `aws-cdk` genuinely is removed by the
> prune (`dev: true` in the lockfile, declared under `dependencies` by no workspace), so every production
> deploy was running a CDK CLI pulled unpinned from the registry. It was **eight** call sites in this job, not
> one — the identity leg included — plus four more in `sandbox-identity-deploy.yml`, which also prunes and
> which no thread had reached.
>
> Both halves of your recommendation are in: the CDK app compilation is hoisted above the prune and the
> runners are now `--app "node …/infra/dist/bin/app.js"`; and the CLI is kept installed by declaring
> `aws-cdk` in the root `dependencies` (with `node_modules/aws-cdk` re-excluded in `.dockerignore`, so the
> images are unchanged). The post-prune verification step now runs `npx --no-install cdk --version`, so a
> regression fails at the prune with the reason instead of mid-deploy. One correction: `tsx` was not removed
> — it survives as a `devOptional` peer of `vite`, which is its own problem and is fixed the same way.

---

## 8. `ci-full.yml:73` — the dispatcher passes `prod` into the Maestro tier (`PRRT_kwDOR7sDRs6bCf_K`)

**Verdict: fixed** (`3ffea38f`).

**Evidence.** Correct. `e2e-mobile-maestro` consumes `inputs.stage` for a **write**: it loads that stage's
Clerk keys and runs `ensure-signin-user.mjs`, provisioning the shared `+clerk_test` sign-in user into that
tenant. Everything it then measures is stage-independent — the recipe service it drives is a runner-local
container under the dev-auth bypass — so a `prod` dispatch mutates the production Clerk instance in exchange
for a result that says nothing about production. `ci-full.yml` offers `prod` in its `stage` choice and
forwarded it unchanged.

**Fix.** The job refuses, as its **first** step, any stage but `sandbox`: `exit 1` with an `::error::` naming
the tenant it would have written to, placed before the `load-secrets` step so a refused run never holds a
production credential. A job-level `if:` was rejected deliberately — it skips silently, producing a green
heavy run whose mobile tier ran nothing, which is the class of outcome this repo's guards exist to prevent.
The dispatcher keeps forwarding the input unchanged, with a comment saying why, so the operator sees the
mistake rather than a quietly narrowed run.

`maestroStageGuard.test.ts` discovers the provisioning job, finds the refusal structurally (the step binding
`STAGE: ${{ inputs.stage }}`) and proves its decision by executing that body — and only that body — under
real bash with `STAGE=prod` and `STAGE=sandbox`, then pins its position ahead of the secret load.

**Draft reply.**

> Fixed in `3ffea38f`. The Maestro job now refuses any stage but `sandbox` as its first step — `exit 1` with
> an `::error::` naming the tenant it would have written to — placed before `load-secrets`, so a refused run
> never holds a production credential. A job-level `if:` was considered and rejected: it skips silently,
> which would produce a green heavy run whose mobile tier ran nothing. The dispatcher still forwards the
> input unchanged (with a comment saying why) so the mistake is visible rather than quietly narrowed.
> `maestroStageGuard.test.ts` executes the refusal's own bash under both stages and pins its position ahead
> of the secret load.

---

## 9. `claude-code-review.yml:85` — the marketplace resolves a mutable default branch (`PRRT_kwDOR7sDRs6bCVVi`)

**Verdict: owner-decision.** The premise is correct. The recommended remedy is **not expressible** through
this action's input, and I have not invented a substitute.

**Evidence.**

- The premise holds: `plugin_marketplaces: 'https://github.com/anthropics/claude-code.git'` names a repo, not
  a ref. `claude-code-action@6b082c41` passes the string verbatim to `claude plugin marketplace add <url>`
  (`base-action/src/install-plugins.ts`), and the marketplace catalog is fetched from that repo's default
  branch. Pinning `anthropics/claude-code-action` does not pin the plugin the job loads, and the job holds
  `CLAUDE_CODE_OAUTH_TOKEN` with `pull-requests: write`.
- **The recommended fix does not work at this pinned version.** The action validates every marketplace entry
  against
  `/^https:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]+\.git$/`,
  anchored on `.git$`. Claude Code's documented pin syntaxes are `#ref` appended to a git URL and `@ref`
  appended to `owner/repo` shorthand. A `#ref` fragment falls **after** `.git`, so the regex rejects it
  (`Invalid marketplace URL format`); the shorthand form has no `https://` prefix and no `.git` suffix, so it
  is rejected too. There is no supported ref syntax that survives this input's validation.
- Even where pinning is possible, the docs are explicit that **marketplace** sources support `ref`
  (branch/tag) but **not** `sha` — so the strongest available pin would be a mutable tag, not an immutable
  commit.
- On blast radius: the marketplace repo is `anthropics/claude-code` — the **same vendor** as the pinned
  action whose code actually holds the token. Pinning would narrow the window for a compromise of one repo's
  default branch; it would not change the trust anchor.

**The options, with their costs.** None is free, which is why this is the owner's call:

1. **Accept and record.** Cost: the residual the comment describes stands.
2. **Vendor the plugin** into `.github/` and drop `plugin_marketplaces`. Removes the mutable fetch; adds a
   copy of a third-party prompt set to maintain by hand, and it will rot silently.
3. **Drop the plugin.** The reviewer still runs; it loses the toolkit's prompts.
4. **Wait for the action to accept a ref**, then pin and guard it in `workflowProvenance.test.ts` beside the
   Maestro pin. Zero cost now, but nothing signals when it becomes possible.

**Recommendation.** Option 1 or 4. I did not implement any of them: 2 and 3 change what the reviewer does,
which is a product decision, and 1/4 are a decision to record rather than code to write.

**Draft reply.**

> The premise is right and I am leaving this open for the maintainer rather than closing it. Pinning
> `claude-code-action` does not pin the marketplace catalog, which is fetched from `anthropics/claude-code`'s
> default branch in a job holding `CLAUDE_CODE_OAUTH_TOKEN` and `pull-requests: write`.
>
> The recommended fix, though, is not expressible at the pinned version. `claude-code-action@6b082c41`
> validates each marketplace entry against `/^https:\/\/[…]+\.git$/`, anchored on `.git$`, and passes the
> string verbatim to `claude plugin marketplace add`. Claude Code's documented pins are `#ref` after a git URL
> — which falls after `.git` and is rejected by that regex — and `@ref` after `owner/repo` shorthand, which
> has neither the `https://` prefix nor the `.git` suffix the regex requires. The docs also note that
> marketplace sources support `ref` (branch/tag) but not `sha`, so even where it works the strongest pin is a
> mutable tag.
>
> Worth weighing alongside that: the marketplace is `anthropics/claude-code`, the same vendor as the pinned
> action whose code holds the token, so pinning would narrow a window rather than move the trust anchor. The
> real options are to vendor the plugin, drop it, or accept and revisit when the action accepts a ref — all
> product calls rather than defects, so I have not picked one.

---

## 10. `commentTriggerGuard.test.ts:195` — workflow-level `env` and dot-free secrets (`PRRT_kwDOR7sDRs6bZHFU`)

**Verdict: fixed** (`d5fbe696`).

**Evidence.** Both halves correct, and both matter because they decide whether the guard **applies to a job at
all** — a job it reads as unprivileged is never checked for an `author_association` gate.

- `isPrivileged` serialised the job alone, so a secret in the workflow-level `env:` — inherited by every job,
  and absent from the job's own text — was invisible.
- The matcher recognised `secrets.NAME` and a `secrets:` key only. `secrets['NAME']` and `toJSON(secrets)`
  are valid and dot-free.

**Fix.** `doc.env` is serialised with the job, and the matcher covers the dot, index and `toJSON` forms plus
the `secrets:` key, anchored on a word boundary so prose such as "read stage-scoped secrets from Secrets
Manager" in a step name cannot manufacture a privilege. Three positive fixtures, each watched fail against the
previous implementation. The real-tree pin (`claude.yml::claude`) is unchanged.

**Draft reply.**

> Both halves were real and both decided whether the guard applied to a job at all, which made them worse than
> a missed finding. Fixed in `d5fbe696`: `isPrivileged` now serialises the workflow-level `env:` together with
> the job, and the matcher covers `secrets.NAME`, `secrets['NAME']`, `toJSON(secrets)` and the `secrets:`
> forwarding key — anchored on a word boundary so prose like "read stage-scoped secrets from Secrets Manager"
> in a step name cannot invent a privilege. Three positive fixtures were added and each was watched fail
> against the previous version. The real-tree pin is unchanged.

---

## Residual risk

- **Thread 9 is unresolved by design**, pending an owner decision.
- **Nothing here has been executed against AWS.** The post-prune fix is verified by construction (every
  compiled entrypoint was run under `node` locally, and the guard derives the survivor set from the committed
  lockfile), but the first real proof is a production deploy — and prod has not deployed since 2026-08-17, so
  this pipeline has not run end to end in over two weeks regardless of this change.
- **`sandbox-identity-deploy.yml` was fixed but not exercised.** Its four `npx cdk` sites and one `npx tsx`
  smoke were in the same broken position and are corrected the same way; no thread covered that file, so no
  reviewer has looked at it.
- **The three test failures in this worktree are environmental** (`vitestTempRoot`, `serviceDevRunner`,
  `cdkNagSynth.integration`) — all `EINVAL` on a Unix-domain socket path, caused by the agent worktree's path
  length, not by any change here.
