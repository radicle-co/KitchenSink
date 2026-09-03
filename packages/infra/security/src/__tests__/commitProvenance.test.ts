/**
 * Unit tests for the COMMIT PROVENANCE stamp — the one fact no deployed stack in this repository carried.
 *
 * ## The defect this closes
 *
 * `docs/architecture/2026-08-28-ingredient-pipeline-state.md` §1 was a hand-maintained table headed "What
 * runs where, today". It marked `verifyLine` and the other recipe-workers handlers deployed. Measured
 * against the live account: `kitchensink-recipe-workers-prod` held SIX Lambdas and was last updated
 * 2026-08-02, while the branch stood 600+ commits ahead — neither `verifyLine` nor `parseLine` existed
 * anywhere. The root cause is not the table. It is that **nothing recorded which commit produced a deployed
 * stack**: the only stack tag was `Environment`, so no mechanism — human or automated — could notice that
 * prod was a month stale. A document generated from CDK alone would have said the same thing, because CDK
 * describes INTENT and only the account holds REALITY.
 *
 * ## Why a STACK tag and not `Tags.of(app).add(...)`
 *
 * Measured, not assumed (probe run against `aws-cdk-lib` 2.x before this was written):
 *
 * | how                      | stack artifact `tags` | synthesized template          |
 * | ------------------------ | --------------------- | ----------------------------- |
 * | `Tags.of(app).add(…)`    | set                   | every taggable resource MOVES |
 * | `stack.tags.setTag(…)`   | set                   | BYTE-IDENTICAL                |
 *
 * A value that changes on every commit, applied the first way, would rewrite every prod resource's `Tags`
 * property on every deploy — breaching the no-prod-diff line ADR-0002 and ADR-0008 both rest on, for a fact
 * that has nothing to do with any resource's configuration. The stack tag is carried in the cloud assembly
 * manifest, passed to CloudFormation as a STACK tag by the CLI, and propagated by CloudFormation itself to
 * the resources that support tagging. It is also exactly the field `teardown-sandbox-pr.sh` already reads
 * (`describe-stacks … Stacks[0].Tags[?Key=='Environment']`), so the drift check reads it the same way.
 *
 * ## Why an Aspect and not a loop at the end of `bin/app.ts`
 *
 * A loop over `app.node.findAll()` only sees the stacks that exist WHEN IT RUNS, so it must be the last
 * statement of every entrypoint — an ordering rule a reviewer has to enforce by eye, and one whose breach is
 * silent (it stamps nothing and every test that only checks "the call is present" still passes). An Aspect
 * visits at synth time, after the whole tree is built, so the call site is order-immune and can sit beside
 * `attachSecurityChecks(app)` where every app already has one.
 *
 * ## ADR-0005 — why this tag cannot widen the teardown blast radius
 *
 * The per-PR teardown matches `pr-{N}` by tag OR name with NO denylist. A new tag whose value could ever
 * read as a scope token would be a security regression, so `resolveCommitSha` accepts ONLY lowercase hex and
 * otherwise answers `unknown`: the value space and `pr_scope_is_token`'s are disjoint by construction, and
 * the case below asserts that against the real predicate's regex rather than by inspection.
 */
import { App, Stack, Tags, aws_sqs as sqs } from 'aws-cdk-lib';
import { describe, expect, it } from 'vitest';

import { COMMIT_TAG_KEY, UNKNOWN_COMMIT, resolveCommitSha, stampCommitProvenance } from '../commitProvenance.js';

/** `pr_scope_is_token`'s rule, from `.github/scripts/pr-scope.sh`, as a JS regex. */
const PR_SCOPE_TOKEN = /^pr-[0-9]+$/u;

describe('resolveCommitSha', () => {
    it('reads the sha CI publishes', () => {
        expect(resolveCommitSha({ GITHUB_SHA: 'a'.repeat(40) })).toBe('a'.repeat(40));
    });

    it('prefers an explicit COMMIT_SHA over the CI-provided one', () => {
        // The explicit variable is what a manual `cdk deploy` sets; when both are present the deliberate one
        // wins, because a workflow that re-deploys an older tree passes the tree's sha, not the run's.
        expect(resolveCommitSha({ COMMIT_SHA: 'b'.repeat(40), GITHUB_SHA: 'a'.repeat(40) })).toBe('b'.repeat(40));
    });

    it('accepts an abbreviated sha', () => {
        expect(resolveCommitSha({ COMMIT_SHA: 'abc1234' })).toBe('abc1234');
    });

    it.each([
        ['no variable at all', {}],
        ['an empty value', { GITHUB_SHA: '' }],
        ['whitespace', { GITHUB_SHA: '   ' }],
        ['too short to be a sha', { GITHUB_SHA: 'abc12' }],
        ['longer than a sha', { GITHUB_SHA: `${'a'.repeat(40)}0` }],
        ['uppercase hex', { GITHUB_SHA: 'A'.repeat(40) }],
        ['a branch name', { GITHUB_SHA: 'main' }],
        ['a ref', { GITHUB_SHA: 'refs/heads/main' }],
        ['a scope token', { GITHUB_SHA: 'pr-73' }],
        ['a value carrying tag-illegal characters', { GITHUB_SHA: 'abc123; rm -rf /' }],
    ])('answers `unknown` for %s rather than inventing one', (_case, environment) => {
        // ⛔ The permissive direction is the dangerous one. A fabricated or malformed sha is WORSE than no
        // sha: the drift check would compare it against HEAD, find a difference, and report a stale deploy
        // that is not stale — or worse, match by accident and report a current deploy that is not current.
        expect(resolveCommitSha(environment)).toBe(UNKNOWN_COMMIT);
    });

    it('trims surrounding whitespace before judging', () => {
        expect(resolveCommitSha({ GITHUB_SHA: ` ${'c'.repeat(40)}\n` })).toBe('c'.repeat(40));
    });

    it('never produces a value the per-PR teardown could read as a scope token (ADR-0005)', () => {
        const answers = [
            resolveCommitSha({}),
            resolveCommitSha({ GITHUB_SHA: 'pr-73' }),
            resolveCommitSha({ COMMIT_SHA: 'pr-1' }),
            resolveCommitSha({ COMMIT_SHA: 'deadbeef' }),
        ];

        for (const answer of answers) {
            expect(PR_SCOPE_TOKEN.test(answer), `${answer} would match pr_scope_is_token`).toBe(false);
        }
    });
});

/** Synthesize a one-queue app, optionally stamped, and return both halves of the artifact. */
function synthesize(environment?: NodeJS.ProcessEnv): { readonly tags: Record<string, string>; readonly json: string } {
    const app = new App();

    if (environment !== undefined) {
        stampCommitProvenance(app, environment);
    }

    const stack = new Stack(app, 'Probe', { stackName: 'probe' });

    new sqs.Queue(stack, 'Queue');

    const artifact = app.synth().getStackByName('probe');

    return { tags: artifact.tags, json: JSON.stringify(artifact.template) };
}

describe('stampCommitProvenance', () => {
    it('records the sha as a CloudFormation STACK tag', () => {
        expect(synthesize({ GITHUB_SHA: 'd'.repeat(40) }).tags).toStrictEqual({ [COMMIT_TAG_KEY]: 'd'.repeat(40) });
    });

    it('leaves the synthesized template byte-identical', () => {
        // ⛔ THE ACCEPTANCE CRITERION. `Tags.of(app).add()` fails this — it writes a `Tags` property onto
        // every taggable resource — which is why this stamp is a stack tag. ADR-0002 / ADR-0008 no-prod-diff.
        expect(synthesize({ GITHUB_SHA: 'd'.repeat(40) }).json).toBe(synthesize().json);
    });

    it('detects a stamp that DOES move the template', () => {
        // Negative control for the assertion above: prove the comparison can fail. `Tags.of` is the exact
        // shape a future reader would reach for, so it is the right mutant.
        const app = new App();
        const stack = new Stack(app, 'Probe', { stackName: 'probe' });

        new sqs.Queue(stack, 'Queue');
        Tags.of(app).add(COMMIT_TAG_KEY, 'd'.repeat(40));

        expect(JSON.stringify(app.synth().getStackByName('probe').template)).not.toBe(synthesize().json);
    });

    it('stamps `unknown` rather than nothing when no sha is available', () => {
        // A local `cdk synth`. The tag must still be PRESENT: an absent tag and an unknown one are different
        // states, and the drift check reports them differently — absent means "deployed before this stamp
        // existed", unknown means "deployed by something that did not know its own commit".
        expect(synthesize({}).tags).toStrictEqual({ [COMMIT_TAG_KEY]: UNKNOWN_COMMIT });
    });

    it('stamps every stack in the app, nested ones included', () => {
        const app = new App();

        stampCommitProvenance(app, { GITHUB_SHA: 'e'.repeat(40) });

        const parent = new Stack(app, 'Parent', { stackName: 'parent' });

        new Stack(parent, 'Child', { stackName: 'child' });

        const assembly = app.synth();

        // A child stack constructed INSIDE another is the shape `GlobalStack` uses for the five platform
        // stacks; a stamp that only reached the app's direct children would miss all of them.
        expect(assembly.getStackByName('parent').tags).toStrictEqual({ [COMMIT_TAG_KEY]: 'e'.repeat(40) });
        expect(assembly.getStackByName('child').tags).toStrictEqual({ [COMMIT_TAG_KEY]: 'e'.repeat(40) });
    });

    it('stamps a stack constructed AFTER the call, so the call site is order-immune', () => {
        // The whole reason this is an Aspect. A loop would have to be the last statement of every entrypoint.
        expect(synthesize({ GITHUB_SHA: 'f'.repeat(40) }).tags[COMMIT_TAG_KEY]).toBe('f'.repeat(40));
    });

    it('leaves the Environment tag alone (ADR-0005)', () => {
        const app = new App();

        stampCommitProvenance(app, { GITHUB_SHA: '0'.repeat(40) });

        const stack = new Stack(app, 'Probe', { stackName: 'probe', tags: { Environment: 'pr-73' } });

        new sqs.Queue(stack, 'Queue');

        expect(app.synth().getStackByName('probe').tags).toStrictEqual({
            Environment: 'pr-73',
            [COMMIT_TAG_KEY]: '0'.repeat(40),
        });
    });
});
