// @vitest-environment node
/**
 * Repo-wide guard: `_ci.yml`'s `ci-verdict` job is the ONE aggregate check a branch ruleset requires (owner
 * ruling 2026-10-16), so it must be COMPLETE and it must not lie.
 *
 * - COMPLETE: its `needs` is every other job of the workflow, DISCOVERED here. A job added tomorrow and left
 *   out of `needs` would be a red check the ruleset never sees.
 * - NOT SKIPPED: `if: always()`. A needed job that failed would otherwise skip the verdict, and a skipped
 *   required check reads as "not run", which some rulesets treat as passing.
 * - HONEST ABOUT SKIPS (owner rule 2026-10-03: a check may skip only when it depends on the sandbox): the
 *   list of jobs allowed to skip is DERIVED from the workflow — the jobs whose own `if:` reads the sandbox
 *   gate — and the step's list must equal it. Nothing here is a hand-kept roster.
 * - SAFE: the decision lives in `.github/scripts/ciVerdict.sh` (unit-tested by `ciVerdict.test.ts`) and the
 *   `needs` context reaches it through `env:`, never interpolated into the `run:` body (zizmor template
 *   injection).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import yaml from 'yaml';

import { repoRoot } from './serviceSources.js';

interface Step {
    readonly uses?: string;
    readonly run?: string;
    readonly env?: Record<string, string>;
}

interface Job {
    readonly name?: string;
    readonly needs?: string | string[];
    readonly if?: string | boolean;
    readonly permissions?: Record<string, string>;
    readonly steps?: readonly Step[];
}

const VERDICT_ID = 'ci-verdict';

/**
 * Parse `_ci.yml`'s jobs. Impure.
 *
 * @returns The job map.
 * @sideEffect Reads the working tree.
 */
const loadJobs = (): Record<string, Job> =>
    (
        yaml.parse(readFileSync(path.join(repoRoot, '.github/workflows/_ci.yml'), 'utf8')) as {
            jobs: Record<string, Job>;
        }
    ).jobs;

const needsOf = (job: Job): readonly string[] => (typeof job.needs === 'string' ? [job.needs] : (job.needs ?? []));

/** The sandbox gate's two jobs: a job whose own `if:` reads either one depends on the sandbox. */
const SANDBOX_GATE = /needs\.(?:sandbox-status|resolve-sandbox)\b/;

/**
 * The jobs allowed to skip: those whose `if:` reads the sandbox gate. Pure.
 *
 * @param jobs - The workflow's jobs.
 * @returns Sorted job ids.
 */
export function sandboxDependentJobs(jobs: Record<string, Job>): readonly string[] {
    return Object.entries(jobs)
        .filter(([id, job]) => id !== VERDICT_ID && SANDBOX_GATE.test(String(job.if ?? '')))
        .map(([id]) => id)
        .sort();
}

/**
 * Every job id except the verdict. Pure.
 *
 * @param jobs - The workflow's jobs.
 * @returns Sorted job ids.
 */
export function aggregatedJobs(jobs: Record<string, Job>): readonly string[] {
    return Object.keys(jobs)
        .filter((id) => id !== VERDICT_ID)
        .sort();
}

describe('_ci.yml ci-verdict', () => {
    const jobs = loadJobs();
    const verdict = jobs[VERDICT_ID];

    it('exists, under the stable name the ruleset requires', () => {
        expect(verdict?.name).toBe('CI verdict');
    });

    it('needs EVERY other job — discovered, so a new job cannot be left out', () => {
        expect([...needsOf(verdict ?? {})].sort()).toStrictEqual(aggregatedJobs(jobs));
        expect(aggregatedJobs(jobs).length).toBeGreaterThan(20);
    });

    it('runs always, so a failed or skipped dependency cannot skip the verdict itself', () => {
        expect(
            String(verdict?.if ?? '')
                .replace(/\$\{\{|\}\}/g, '')
                .trim(),
        ).toBe('always()');
    });

    it('nothing needs the verdict (it is the last node of the graph)', () => {
        const dependents = Object.entries(jobs).filter(([, job]) => needsOf(job).includes(VERDICT_ID));

        expect(dependents).toStrictEqual([]);
    });

    it('the list of jobs allowed to skip is exactly the jobs that read the sandbox gate', () => {
        const step = verdict?.steps?.find((candidate) => candidate.env?.['SANDBOX_MAY_SKIP'] !== undefined);
        const listed = (step?.env?.['SANDBOX_MAY_SKIP'] ?? '')
            .split(/\s+/)
            .filter((id) => id !== '')
            .sort();

        expect(listed).toStrictEqual(sandboxDependentJobs(jobs));
        expect(listed.length).toBeGreaterThan(0);

        // a listed job must be aggregated, or the entry is dead
        for (const id of listed) {
            expect(needsOf(verdict ?? {})).toContain(id);
        }
    });

    it('passes the needs context through env and runs the script, never interpolating into run:', () => {
        const step = verdict?.steps?.find((candidate) => (candidate.run ?? '').includes('ciVerdict.sh'));

        expect(step?.env?.['NEEDS_JSON']).toBe('${{ toJSON(needs) }}');
        expect(step?.run).not.toContain('${{');
        expect(step?.run?.trim()).toBe('bash .github/scripts/ciVerdict.sh');
    });

    it('checks the repo out before it runs the script, with read-only contents', () => {
        const steps = verdict?.steps ?? [];
        const checkout = steps.findIndex((step) => (step.uses ?? '').startsWith('actions/checkout@'));
        const script = steps.findIndex((step) => (step.run ?? '').includes('ciVerdict.sh'));

        expect(checkout).toBeGreaterThanOrEqual(0);
        expect(checkout).toBeLessThan(script);
        expect(verdict?.permissions).toStrictEqual({ contents: 'read' });
    });

    describe('the derivation itself (mutation lens)', () => {
        it.each([
            [
                'a job reading the gate is sandbox-dependent',
                { a: { if: "${{ needs.sandbox-status.outputs.branch == 'run' }}" } },
                ['a'],
            ],
            ['resolve-sandbox counts too', { a: { if: "${{ needs.resolve-sandbox.outputs.stage != '' }}" } }, ['a']],
            ['a job with no if is not', { a: {} }, []],
            ['`!cancelled()` alone is not', { a: { if: '${{ !cancelled() }}' } }, []],
            ['a near-miss job name is not', { a: { if: '${{ needs.sandbox-statusX.result }}' } }, []],
        ] as const)('%s', (_name, fixture, expected) => {
            expect(sandboxDependentJobs(fixture as Record<string, Job>)).toStrictEqual(expected);
        });
    });
});
