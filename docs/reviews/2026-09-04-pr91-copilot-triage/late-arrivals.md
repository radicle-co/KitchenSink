# PR #91 review triage — late arrivals

Nine threads that no earlier disposition document covered, triaged against `ea75ec4b`. All nine were
replied to and resolved on the PR. One code change: `ce403f5b`.

| #   | Thread                  | Location                                                        | Verdict                          | Replied | Resolved |
| --- | ----------------------- | --------------------------------------------------------------- | -------------------------------- | ------- | -------- |
| 1   | `PRRT_kwDOR7sDRs6XhR3_` | `services/recipe-service/package.json:64`                       | **wrong** — premise disproved    | yes     | yes      |
| 2   | `PRRT_kwDOR7sDRs6XpE-U` | `.github/workflows/claude.yml`                                  | **stale** — already fixed        | yes     | yes      |
| 3   | `PRRT_kwDOR7sDRs6YGX7C` | root `package.json` (boundaries)                                | **stale** — already fixed        | yes     | yes      |
| 4   | `PRRT_kwDOR7sDRs6bcNd4` | `.github/workflows/sandbox-deploy.yml`                          | **stale** — already fixed        | yes     | yes      |
| 5   | `PRRT_kwDOR7sDRs6bk_PD` | `recipe-workers/src/handlers/verifyLine.ts`                     | **stale** — already fixed (U35)  | yes     | yes      |
| 6   | `PRRT_kwDOR7sDRs6fSkx7` | `tools/cookbook-import/src/RecipeApiClient.ts:117`              | **false positive** — dup of 325  | yes     | yes      |
| 7   | `PRRT_kwDOR7sDRs6fTPyF` | `clients/food-service/src/__tests__/contractSkew.test.ts:253`   | **real** — fixed `ce403f5b`      | yes     | yes      |
| 8   | `PRRT_kwDOR7sDRs6fTPyM` | `clients/recipe-service/src/__tests__/contractSkew.test.ts:256` | **real** — fixed `ce403f5b`      | yes     | yes      |
| 9   | `PRRT_kwDOR7sDRs6fTZAL` | `cdk.context.json:14`                                           | **wrong** — intentional artifact | yes     | yes      |

---

## 1. `PRRT_kwDOR7sDRs6XhR3_` — `@kitchensink/infra-security` as a devDependency — **wrong**

**Claim.** `npm prune --omit=dev` removes it before the compiled CDK entrypoint runs, so the deploy crashes.

**Evidence (re-measured on this tree, not inherited).**

- `npm prune --omit=dev --dry-run` → 297 removals, **zero** `@kitchensink/*` or `@commise/*`.
- `npm ls @kitchensink/infra-security --omit=dev` → `└── @kitchensink/infra-security@0.0.0 -> ./packages/infra/security`.

npm links every package in the root `workspaces` array into the root `node_modules` as part of the workspace
topology; that link is not a dependency edge `--omit=dev` prunes, so the declaring section is irrelevant to
survival. Consistent with the same finding rejected three times in `apps-and-identity.md` §10–12 and once in
`tools-infra-quality.md` §25.

The adjacent real risk — the deploy runs the **compiled** `dist/bin/app.js` under plain `node` — was already
solved: `packages/infra/security/package.json` exports built JS rather than `./src`. The one thing the prune
genuinely removed was the `aws-cdk` CLI, now a root `dependencies` entry with a post-prune
`npx --no-install cdk --version` guard.

## 2. `PRRT_kwDOR7sDRs6XpE-U` — `claude.yml` has no author-association guard — **stale**

Correct when written; the guard now exists and is more careful than the finding asked for. All four
`github.event_name` branches conjoin the trigger phrase with an association check **on their own payload
path** (`comment.` / `review.` / `issue.`), because a guard on the wrong path evaluates to `''` — falsy — and
silently disables that branch while leaving the others open. Allowed set is `OWNER`/`MEMBER`/`COLLABORATOR`
via `contains(fromJSON('[…]'), …)`, an array so exact-match rather than the `unsound-contains` substring
class; `CONTRIBUTOR` is deliberately excluded.

Two facts recorded in the file that are worth not re-litigating: the action's own write-access check is not a
substitute (it runs after the runner is provisioned and the secret is in the environment, and is disableable
from this file), and **zizmor does not catch this class** — `dangerous-triggers` covers only
`pull_request_target`/`workflow_run`. The property is asserted structurally instead, by
`packages/infra/global/__tests__/commentTriggerGuard.test.ts`, which forces the association atom false and
requires the job to become unreachable.

## 3. `PRRT_kwDOR7sDRs6YGX7C` — `boundaries` scripts pipe without `pipefail` — **stale**

The pipeline no longer exists: root `package.json:37-38` is `node scripts/boundariesRatchet.mjs`. The script's
own header records this exact review comment being acted on — _"WHY IT SPAWNS TURBO ITSELF (changed
2026-08-10 — PR #91 review)"_.

⛔ **Worth preserving: `set -o pipefail` was NOT the available fix.** `npm config get script-shell` is unset,
so npm runs scripts through `/bin/sh` = `dash` locally and on `ubuntu-latest`, where it is
`set: Illegal option -o pipefail`. Owning the child removes the pipeline and lets a broken toolchain and a
boundaries violation get different messages. The script additionally pins a contract on the child (0 findings
→ exit 0 + `no issues found`; k findings → exit 1 + `k issues found`; anything else is a hard failure), which
closes the "missing Turbo task" half of the finding.

## 4. `PRRT_kwDOR7sDRs6bcNd4` — `aws lambda invoke` ignores `FunctionError` — **stale**

Correct, already fixed, and the fix generalised the finding rather than patching the one site. The food
migration step is now `bash .github/scripts/run-migrations.sh run …`; the reviewer's own observation that the
three call sites had three different amounts of rigour (recipe grepped `errorType`, identity read
`FunctionError`, this one read neither) is what drove routing all three through one definition, which reads
**both** signals. The step keeps its ADR-0010 ensure-exists gate and its ordering behind the sandbox-database
wake step (ADR-0007).

## 5. `PRRT_kwDOR7sDRs6bk_PD` — `plan.modelId` used as the Bedrock address — **stale**

Correct including the "works only because Nova's two strings coincide" diagnosis; fixed as U35.
`verifyLine.ts` now passes `invocationId: plan.invocationId` and keeps `plan.modelId` for verdict/memo
identity, both resolved from the one registry so pricing and addressing cannot disagree.

The requested regression test exists in `spendArithmetic.test.ts`, plus a stronger mutation guard: _"prices
EVERY registered model off its own registry key, never off its address"_ iterates `BEDROCK_MODEL_REGISTRY` and
pins both ids for every entry, so a newly added profile-only model inherits the property instead of needing
its own case.

## 6. `PRRT_kwDOR7sDRs6fSkx7` — `js/file-access-to-http` at `RecipeApiClient.ts:117` — **false positive**

Alert 344 is alert 325 relocated: line 117 is the same `fetch()` inside `RecipeApiClient.request`, which moved
when the retry/abort fix landed in `75078f48`. Disposition unchanged from `tools-infra-quality.md` §24 — "file
data reaches an outbound request" describes what a cookbook importer is.

Re-verified rather than inherited: `baseUrl` comes from the `--recipe-url` CLI argument through
`assertWritableImportOrigin` (`scripts/importCookbook.ts:161`), never from the parsed corpus, and every body
goes through `createRecipeRequestSchema.parse` before it leaves (`RecipeApiClient.ts:260`).

## 7–8. `PRRT_kwDOR7sDRs6fTPyF` / `…fTPyM` — "use of returnless function" in `contractSkew.test.ts` — **real, fixed**

⚠️ **These two reverse `services.md` §13 and `tools-infra-quality.md` §12–14, which rejected the same alert
as a false positive.** The rejection's load-bearing premise — _"acting on this alert would delete the only
check that the void contract holds"_ — is false, and `apps-and-identity.md` §9 had already demonstrated why by
shipping the better fix to the third sibling. There was no reason for the three copies of this test to
disagree.

The flagged line was `expect(reportContractSkewOnce({ … })).toBeUndefined()`. The rejection is right that the
"use of the return value" _is_ the assertion, and right that laundering it through an intermediate would still
count as a use while obscuring the intent. But the property is a **type** property, so it is now stated as
one:

```ts
expectTypeOf(reportContractSkewOnce).returns.toBeVoid();
```

Strictly stronger, not a workaround: a `void` signature makes TypeScript reject an `async` implementation and
a `return <value>`, neither of which one sampled call establishes — and it is enforced by `tsc --noEmit`,
because both packages' `include` is `src/**/*.ts` and covers `src/__tests__`.

**Red before green, both packages, both directions:**

| Mutation to `reportContractSkewOnce`            | Result                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `: void` → `: string`                           | `TS2349 … Type 'ExpectVoid<string>' has no call signatures`        |
| `function … : void` → `async … : Promise<void>` | `TS2349 … Type 'ExpectVoid<Promise<void>>' has no call signatures` |
| reverted                                        | `tsc --noEmit` clean; 27/27 each                                   |

All three siblings now agree. `reportContractSkewOnce` stays `void` by design — a fire-and-forget probe a
per-keystroke typeahead client cannot await on a hot path — with the contract pinned at compile time rather
than sampled at runtime.

## 9. `PRRT_kwDOR7sDRs6fTZAL` — root `cdk.context.json` is ignored but committed — **wrong**

The finding's own escape clause ("unless intentionally tracked as a reproducibility artifact") is satisfied
verbatim by `10b66334`: _"Committing the cache is the point of the file — it keeps synth deterministic and off
the Route 53 API, so CI and a fresh clone resolve the same zone without credentials for the lookup."_ The
ignore rule stops an incidental synth dirtying a tree; the file was force-added deliberately.

- **Cannot pin synth to one account.** CDK context keys carry account and region
  (`hosted-zone:account=040663841500:…:region=us-east-1`); another account is a cache miss and looks up live.
- **Dropping the entry is the change with the cost.** `DomainStack.ts:35` calls `HostedZone.fromLookup`, which
  with no cache and no credentials yields CDK's dummy zone — a credential-free synth would then produce a
  different template than a deploy.
- **The root copy is not a stray duplicate** of `packages/infra/global/cdk.context.json`. CDK reads
  `cdk.context.json` from the **invocation directory**, and the two entrypoints differ:
  `npm run synth --workspace=packages/infra/global` runs in the package dir; `prod-deploy.yml:492` runs
  `npx cdk deploy --app "node packages/infra/global/dist/bin/app.js"` from the repo root with no
  `working-directory`. Deleting the root file takes the CI deploy off the cache while leaving the local synth
  on it — precisely the divergence the file prevents.

⚠️ **Residual, for the owner.** The root and `packages/infra/global/` copies are byte-identical and are two
representations of one fact, kept in step by nothing. They are not mergeable (the invocation directories
genuinely differ), but a guard asserting the two files agree — the shape `natEgressConsumers.test.ts` uses —
would stop them drifting. Not added here; it is a new guard rather than a triage fix.

---

## Verification record

| Gate                                                           | Result                                                                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `contractSkew` type assertion red → green (food, ×2 mutations) | `TS2349` at the assertion → clean                                                                               |
| `contractSkew` type assertion red → green (recipe, `async`)    | `TS2349` at the assertion → clean                                                                               |
| food-service-client / recipe-service-client unit suites        | 27/27 and 27/27; package suites 5 tasks green (484 tests recipe)                                                |
| repo-wide `npm run lint`                                       | 75/75 tasks successful                                                                                          |
| repo-wide `npm run typecheck`                                  | 71/71 tasks successful                                                                                          |
| `turbo run test --filter=@kitchensink/infra-global --force`    | 2079/2081 — the 2 failures are the known agent-worktree path-length ones (`serviceDevRunner`, `vitestTempRoot`) |

`zizmor` not run: no workflow file was modified. Nothing pushed; `ce403f5b` sits on the worktree branch.
