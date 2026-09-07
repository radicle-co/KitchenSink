// ⚠️ DELIBERATE — read `__tests__/commitProvenance.test.ts` before changing any of the three decisions
// below (stack tag not resource tag, Aspect not loop, `unknown` not a fabricated sha).
//
// THE COMMIT that produced a deployed stack. One value, one place, stamped by every CDK app.
//
// ## Why this exists
//
// `docs/architecture/2026-08-28-ingredient-pipeline-state.md` §1 was a hand-maintained table headed "What
// runs where, today", and it said `verifyLine` was deployed. It was not: `kitchensink-recipe-workers-prod`
// held six Lambdas and had last been updated on 2026-08-02 while the branch stood 600+ commits ahead. The
// table was wrong, but the table is not the defect — the defect is that NOTHING RECORDED WHICH COMMIT
// PRODUCED A DEPLOYED STACK. The only stack tag was `Environment`, so no mechanism, human or automated,
// could notice that prod was a month stale, and a document generated from the CDK source would have made
// exactly the same claim: CDK describes INTENT, and only the account holds REALITY.
//
// One tag closes that. `scripts/deploymentDrift.mjs` reads it back and compares it against the
// commit under deploy, so "prod is stale" becomes a fact a machine can state rather than a thing somebody
// has to remember to check.
//
// ## Why it lives in @kitchensink/infra-security
//
// Same reason as `NODE_LAMBDA_RUNTIME`: this is the one package every CDK app already depends on (each
// `bin/app.ts` calls `attachSecurityChecks`), so centralising here adds no dependency edge. Provenance is
// also a supply-chain fact — "which source produced the artefact running in production" is the question
// every deployment-integrity control is ultimately asking.
import { Aspects, Stack } from 'aws-cdk-lib';
import type { App } from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';

/**
 * The CloudFormation STACK tag key carrying the commit a deploy was built from.
 *
 * ⛔ A STACK tag, never `Tags.of(app).add(...)`. Measured against `aws-cdk-lib` 2.x: the aspect form writes a
 * `Tags` property onto every taggable resource, so a value that changes with every commit would rewrite every
 * prod resource on every deploy — breaching the no-prod-diff line ADR-0002 and ADR-0008 both rest on, for a
 * fact about the BUILD rather than about any resource's configuration. `stack.tags.setTag` leaves the
 * template byte-identical (asserted), rides to CloudFormation in the cloud assembly, and is propagated to
 * supporting resources by CloudFormation itself.
 *
 * ⛔ Do not rename it. `scripts/deploymentDrift.mjs` reads this exact key out of `describe-stacks`, and a rename
 * would make every already-deployed stack read as untagged — i.e. it would silently reset the baseline the
 * staleness report is measured against.
 */
export const COMMIT_TAG_KEY = 'CommitSha';

/**
 * The value stamped when no commit can be established.
 *
 * ⛔ NEVER a fabricated or partial sha. A wrong sha is worse than an absent one: the drift check would either
 * report a stale deploy that is not stale, or — by accident — a current one that is not current. `unknown` is
 * a state the report handles explicitly and loudly.
 *
 * It is also, deliberately, not a hex string, so it can never be mistaken for a real commit.
 */
export const UNKNOWN_COMMIT = 'unknown';

/**
 * A commit sha, abbreviated or full: lowercase hex, 7 to 40 characters.
 *
 * The lower bound is git's own default abbreviation length; the upper is SHA-1. Anchored, because the whole
 * point is to REFUSE anything that is not a sha — a branch name, a ref, a `pr-{N}` scope token, or a value
 * carrying characters CloudFormation would reject in a tag.
 */
const COMMIT_SHA = /^[0-9a-f]{7,40}$/u;

/**
 * The commit this synth was built from, or {@link UNKNOWN_COMMIT}.
 *
 * `COMMIT_SHA` is checked before `GITHUB_SHA` because the explicit variable is the deliberate one: a workflow
 * redeploying an older tree passes that tree's sha, while `GITHUB_SHA` names the run's own ref.
 *
 * ⛔ The environment is the ONLY source. Shelling out to `git rev-parse` at synth time would read the machine
 * the synth runs on rather than the tree the artefact was built from — which is a different fact in CI (the
 * checkout is detached at a merge commit that exists nowhere else) and an actively misleading one in a
 * container that has no `.git` at all.
 *
 * ⚠️ It cannot tell a clean tree from a dirty one, because a sha handed over in an environment variable
 * carries no such information. A local `cdk deploy` from a dirty worktree therefore stamps the sha of the
 * commit it is sitting on, not of the bytes it deployed. That is a known limit of the cheap mechanism, and
 * the reason `prod-deploy.yml` is the only sanctioned path to prod.
 *
 * @param environment - The process environment to read.
 * @returns A validated sha, or {@link UNKNOWN_COMMIT}. Pure.
 */
export function resolveCommitSha(environment: NodeJS.ProcessEnv): string {
    for (const key of ['COMMIT_SHA', 'GITHUB_SHA']) {
        const candidate = (environment[key] ?? '').trim();

        if (COMMIT_SHA.test(candidate)) {
            return candidate;
        }
    }

    return UNKNOWN_COMMIT;
}

/**
 * Stamp {@link COMMIT_TAG_KEY} onto every stack the app synthesizes.
 *
 * ⛔ An ASPECT, not a loop over `app.node.findAll()`. A loop sees only the stacks that exist when it runs, so
 * it would have to be the last statement of every entrypoint — an ordering rule enforced by eye, whose breach
 * is SILENT (it stamps nothing, and a guard that only checks the call is present still passes). An Aspect
 * visits after the whole tree is built, so this can sit beside `attachSecurityChecks(app)` where every app
 * already has a call site.
 *
 * @param app - The CDK app.
 * @param environment - Environment to resolve the sha from; defaults to the process environment.
 * @sideEffect Registers an Aspect and reads the process environment.
 */
export function stampCommitProvenance(app: App, environment: NodeJS.ProcessEnv = process.env): void {
    const sha = resolveCommitSha(environment);

    Aspects.of(app).add({
        visit(node: IConstruct): void {
            if (Stack.isStack(node)) {
                node.tags.setTag(COMMIT_TAG_KEY, sha);
            }
        },
    });
}
