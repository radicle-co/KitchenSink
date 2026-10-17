// @vitest-environment node
/**
 * Repo-wide guard: while the sandbox is up, every PR push moves the preview address to the pushed commit, and the
 * deployed web tier waits for that move (owner ruling 2026-10-16: "Make pushes move the preview address").
 *
 * ## The defect this pins
 *
 * ADR-0060 took the address out of the push path: only Sandbox Up created or re-pointed it. After every push the
 * hostname kept serving the commit Sandbox Up last named, so `previewCurrency` failed the deployed web tier on every
 * run that was not preceded by a button press. Sandbox Up is still the ONLY thing that STARTS the sandbox; what
 * changed is that a push to a PR whose sandbox is ALREADY up also publishes the address.
 *
 * ## What is asserted
 *
 *   1. `_ci.yml` has a `preview-address` job that calls `previewDomain.yml` with the PR's stage, the PR's HEAD sha
 *      (the only sha a Vercel build carries) and the Vercel token, with the same permissions every other caller grants.
 *   2. It runs only when the deploy gate runs (`sandbox-status` says `run`), for a pull request, and for a resolved
 *      stage. `ci-main.yml` and `ci-full.yml` call `_ci.yml` too; a named stage owns no preview address.
 *   3. It can NEVER start the sandbox: it needs only the status probe and the stage resolution, and nothing it
 *      calls is a sandbox start.
 *   4. `deployed-tiers` waits for it and requires it to have SUCCEEDED, so the web shards cannot test a stale address.
 *   5. `previewDomain.yml` takes the commit, resolves the deployment from it (not from "the latest of the
 *      branch"), keeps the by-hand door working without one, and serialises runs of one stage without cancelling.
 *   6. The ADR and CLAUDE.md state the new rule and no longer claim a push leaves the alias alone.
 *
 * Every rule is a pure analyzer run over the real tree and over a fixture that breaks it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { repoRoot } from './serviceSources.js';
import { scalarText } from './workflowScalar.js';

const WORKFLOWS = join(repoRoot, '.github', 'workflows');
const PR_PIPELINE = '_ci.yml';
const CALLEE = 'previewDomain.yml';
const CALLEE_USES = `./.github/workflows/${CALLEE}`;
const JOB = 'preview-address';
const TIERS_JOB = 'deployed-tiers';

interface Step {
    readonly name?: string;
    readonly if?: unknown;
    readonly uses?: string;
    readonly env?: Readonly<Record<string, unknown>>;
}

interface Job {
    readonly uses?: string;
    readonly needs?: string | readonly string[];
    readonly if?: unknown;
    readonly permissions?: Readonly<Record<string, string>>;
    readonly with?: Readonly<Record<string, unknown>>;
    readonly secrets?: Readonly<Record<string, unknown>>;
    readonly concurrency?: unknown;
    readonly steps?: readonly Step[];
}

interface Workflow {
    readonly on?: Readonly<Record<string, unknown>>;
    readonly jobs?: Readonly<Record<string, Job>>;
}

const load = (file: string): Workflow => parse(readFileSync(join(WORKFLOWS, file), 'utf8')) as Workflow;

const asList = (needs: Job['needs']): readonly string[] =>
    needs === undefined ? [] : typeof needs === 'string' ? [needs] : needs;

const condition = (job: Job | undefined): string => (job?.if === undefined ? '' : scalarText(job.if));

/** Collapse whitespace so a folded `>-` scalar and a one-line scalar compare equal. */
const squash = (text: string): string => text.replace(/\s+/gu, ' ').trim();

/** Rule 1 + 3: the caller job's wiring. Returns one message per breach. */
function breachesOfCaller(job: Job | undefined): readonly string[] {
    if (job === undefined) {
        return [`${PR_PIPELINE} has no \`${JOB}\` job`];
    }

    const found: string[] = [];
    const stage = '${{ needs.resolve-sandbox.outputs.stage }}';

    if (job.uses !== CALLEE_USES) {
        found.push(`must call ${CALLEE_USES}, calls '${job.uses ?? ''}'`);
    }

    if (job.with?.['stage'] !== stage) {
        found.push(`must pass stage: ${stage}`);
    }

    if (job.with?.['commit_sha'] !== '${{ github.event.pull_request.head.sha }}') {
        found.push(
            'must pass commit_sha: the PR HEAD sha (a Vercel build carries the branch head, never the merge ref)',
        );
    }

    if (job.secrets?.['VERCEL_TOKEN'] !== '${{ secrets.VERCEL_TOKEN }}') {
        found.push('must forward secrets.VERCEL_TOKEN');
    }

    if (job.permissions?.['contents'] !== 'read' || job.permissions['id-token'] !== 'write') {
        found.push('must grant contents: read and id-token: write (a callee can only downgrade)');
    }

    const needs = asList(job.needs);

    for (const required of ['sandbox-status', 'resolve-sandbox']) {
        if (!needs.includes(required)) {
            found.push(`must need ${required}`);
        }
    }

    // ⛔ It must not be able to START the sandbox: its only dependencies are the two read-only questions.
    for (const other of needs.filter((n) => !['sandbox-status', 'resolve-sandbox', 'install'].includes(n))) {
        found.push(`needs ${other}, which is not a read-only question about the sandbox`);
    }

    return found;
}

/** Rule 2: the `if:`. Returns one message per missing term. */
function breachesOfCondition(text: string): readonly string[] {
    const flat = squash(text);
    const terms: readonly [string, RegExp][] = [
        ["the deploy gate (branch == 'run')", /needs\.sandbox-status\.outputs\.branch == 'run'/u],
        ['a pull request event', /github\.event_name == 'pull_request'/u],
        ['a resolved stage', /needs\.resolve-sandbox\.outputs\.stage != ''/u],
    ];

    return terms.filter(([, re]) => !re.test(flat)).map(([label]) => `\`if:\` is missing ${label}`);
}

/** Rule 4: `deployed-tiers` waits for the address and requires its success. */
function breachesOfTiers(job: Job | undefined): readonly string[] {
    if (job === undefined) {
        return [`${PR_PIPELINE} has no \`${TIERS_JOB}\` job`];
    }

    const found: string[] = [];

    if (!asList(job.needs).includes(JOB)) {
        found.push(`${TIERS_JOB} must need ${JOB}`);
    }

    if (!squash(condition(job)).includes(`needs.${JOB}.result == 'success'`)) {
        found.push(`${TIERS_JOB}'s \`if:\` must require needs.${JOB}.result == 'success'`);
    }

    return found;
}

describe('a push moves the preview address while the sandbox is up', () => {
    const jobs = load(PR_PIPELINE).jobs ?? {};

    it('the caller job is wired to the stage, the head commit, the token and the permissions', () => {
        expect(breachesOfCaller(jobs[JOB])).toEqual([]);
    });

    it('runs only when the deploy gate runs, for a pull request, with a resolved stage', () => {
        expect(breachesOfCondition(condition(jobs[JOB]))).toEqual([]);
    });

    it('the deployed tiers wait for the address and need it to have succeeded', () => {
        expect(breachesOfTiers(jobs[TIERS_JOB])).toEqual([]);
    });

    it('the callee takes the commit as an optional input and still takes a stage', () => {
        const call = load(CALLEE).on?.['workflow_call'] as
            { inputs?: Record<string, { required?: boolean }> } | undefined;
        const inputs = call?.inputs;

        expect(inputs?.['commit_sha']?.required).toBe(false);
        expect(inputs?.['stage']?.required).toBe(true);
    });

    it('the callee resolves the deployment from the commit and only falls back to the branch lookup without one', () => {
        const steps = load(CALLEE).jobs?.['preview-domain']?.steps ?? [];
        const lookup = steps.find((s) => (s.uses ?? '').startsWith('zentered/vercel-preview-url'));
        const create = steps.find((s) => (s.name ?? '').startsWith('Create this PR'));

        expect(squash(scalarText(lookup?.if))).toBe("${{ inputs.commit_sha == '' }}");
        expect(scalarText(create?.env?.['PREVIEW_COMMIT_SHA'])).toBe('${{ inputs.commit_sha }}');
    });

    it('the callee serialises runs of one stage and never cancels one mid-sequence', () => {
        const concurrency = load(CALLEE).jobs?.['preview-domain']?.concurrency as
            { group?: string; 'cancel-in-progress'?: boolean } | undefined;

        expect(concurrency?.group).toBe('preview-address-${{ inputs.stage }}');
        expect(concurrency?.['cancel-in-progress']).toBe(false);
    });

    it('ADR-0060 and CLAUDE.md state the new rule and no longer say a push leaves the alias alone', () => {
        const adr = readFileSync(
            join(repoRoot, 'docs/architecture/decisions/0060-sandbox-starts-only-by-hand.md'),
            'utf8',
        );
        const claude = readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8');
        const stale = /does not move the alias|no longer moves the alias/iu;

        expect(adr).not.toMatch(stale);
        expect(claude).not.toMatch(stale);
        expect(squash(adr)).toMatch(/every PR push moves the (preview )?address/iu);
        expect(squash(claude)).toMatch(/every PR push moves the (preview )?address/iu);
    });

    describe('each rule can fail', () => {
        const good = jobs[JOB];

        it('catches a caller with the wrong commit', () => {
            expect(
                breachesOfCaller({ ...good, with: { ...good?.with, commit_sha: '${{ github.sha }}' } }),
            ).toHaveLength(1);
        });

        it('catches a caller that could start the sandbox', () => {
            expect(breachesOfCaller({ ...good, needs: [...asList(good?.needs), 'deploy-preview'] })).toHaveLength(1);
        });

        it('catches a condition that lost the deploy gate, the event or the stage', () => {
            expect(breachesOfCondition("${{ github.event_name == 'pull_request' }}")).toHaveLength(2);
            expect(breachesOfCondition("${{ needs.sandbox-status.outputs.branch == 'run' }}")).toHaveLength(2);
        });

        it('catches deployed-tiers that does not wait for the address', () => {
            const tiers = jobs[TIERS_JOB];

            expect(breachesOfTiers({ ...tiers, needs: asList(tiers?.needs).filter((n) => n !== JOB) })).toHaveLength(1);
            expect(breachesOfTiers({ ...tiers, if: '${{ !cancelled() }}' })).toHaveLength(1);
        });
    });
});
