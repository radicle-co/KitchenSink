// @vitest-environment node
/**
 * A CI job that runs a turbo task restores the turbo cache, or it recomputes the whole monorepo from cold.
 *
 * ## The defect this was written for
 *
 * Measured on run 34078228894: `typecheck` took 199s, of which 176s was `npx turbo run typecheck` — 76 tasks,
 * zero cache hits. The same tree, warm, answers in 0.17s (`>>> FULL TURBO`). Seven jobs in `_ci.yml` invoke
 * turbo and exactly ONE of them — `test` — restored `.turbo/cache`, so `lint`, `format` and `typecheck`
 * each rebuilt every package's answer on every run, every time, for work that had already been done.
 *
 * The cost is not only time. A cold task also has no `.tsbuildinfo`, so `tsc` runs non-incrementally:
 * measured locally at 26.8s cold against 13.9s with the build info present, on the same 20 cores.
 *
 * ## Why the invariant is "every turbo job", with no exemption list
 *
 * Which tasks are SAFE to cache is already decided where it belongs — in `turbo.json`, where
 * `@kitchensink/infra-global#test`, `@kitchensink/eslint#test` and `@kitchensink/docgen-components#test` are
 * `cache: false` because their gates read files turbo does not hash into their inputs. That is a property of
 * the task, not of the job that happens to invoke it, so a job-level exemption list here would be a second
 * copy of a decision already made — and a copy that can disagree.
 *
 * ⛔ This gate therefore takes no judgement about which jobs "do enough turbo work to be worth it". A list
 * of interesting jobs is a list that rots; the eighth turbo job added next month is covered the day it lands
 * precisely because nothing had to remember it.
 *
 * ⚠️ It asserts the cache is RESTORED, not that a particular key is used. Keys are a tuning decision and
 * they differ legitimately (the `test` job keys on its matrix group); a job with no cache step at all is the
 * defect, and it is the one this can see.
 *
 * DESIGN PATTERN: Specification module over a pure predicate — {@link turboJobsWithoutCache} is a verdict
 * over plain data, fired at a deliberately-uncached fake as well as at the working tree.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import yaml from 'yaml';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** The pipeline this gate reads. Its `_sandbox-preview.yml` callee builds assets, not turbo task graphs. */
const CI_WORKFLOW = '.github/workflows/_ci.yml';

/** One workflow step, as this gate reads it. */
interface Step {
    readonly uses?: string;
    readonly run?: string;
    readonly with?: Record<string, unknown>;
}

/** One workflow job, as this gate reads it. */
interface Job {
    readonly steps?: readonly Step[];
}

/** A job paired with the two facts this verdict needs. */
export interface JobCacheFacts {
    /** The job's key in the workflow. */
    readonly name: string;
    /** Whether any step invokes a turbo task. */
    readonly runsTurbo: boolean;
    /** Whether any step restores `.turbo/cache`. */
    readonly restoresTurboCache: boolean;
}

/**
 * The jobs that run turbo without restoring its cache.
 *
 * @param jobs - The facts for every job in the workflow.
 * @returns One explanatory line per uncached turbo job, empty when all are covered.
 */
export function turboJobsWithoutCache(jobs: readonly JobCacheFacts[]): readonly string[] {
    return jobs
        .filter((job) => job.runsTurbo && !job.restoresTurboCache)
        .map((job) => `${job.name}: runs a turbo task with no .turbo/cache restore, so it recomputes from cold`);
}

/**
 * Read the CI workflow and derive each job's cache facts.
 *
 * @returns The facts, in workflow order.
 * @sideEffect Reads the working tree.
 */
function ciJobFacts(): readonly JobCacheFacts[] {
    const parsed = yaml.parse(readFileSync(`${REPO_ROOT}/${CI_WORKFLOW}`, 'utf8')) as {
        jobs?: Record<string, Job>;
    };

    return Object.entries(parsed.jobs ?? {}).map(([name, job]) => {
        const steps = job.steps ?? [];

        return {
            name,
            runsTurbo: steps.some((step) => /\bturbo run\b|\bnpx turbo\b/.test(step.run ?? '')),
            restoresTurboCache: steps.some(
                (step) =>
                    (step.uses ?? '').includes('actions/cache') &&
                    JSON.stringify(step.with ?? {}).includes('.turbo/cache'),
            ),
        };
    });
}

describe('turboJobsWithoutCache', () => {
    it('names a turbo job with no cache restore', () => {
        expect(turboJobsWithoutCache([{ name: 'typecheck', runsTurbo: true, restoresTurboCache: false }])).toEqual([
            expect.stringContaining('typecheck'),
        ]);
    });

    it('is quiet when a turbo job restores the cache', () => {
        expect(turboJobsWithoutCache([{ name: 'typecheck', runsTurbo: true, restoresTurboCache: true }])).toEqual([]);
    });

    it('ignores a job that never invokes turbo', () => {
        expect(turboJobsWithoutCache([{ name: 'install', runsTurbo: false, restoresTurboCache: false }])).toEqual([]);
    });
});

describe('every turbo job in the PR pipeline restores the turbo cache', () => {
    it('is not vacuous: the pipeline really does invoke turbo', () => {
        expect(ciJobFacts().filter((job) => job.runsTurbo).length).toBeGreaterThan(0);
    });

    it('leaves no turbo job recomputing from cold', () => {
        expect(turboJobsWithoutCache(ciJobFacts())).toEqual([]);
    });
});
