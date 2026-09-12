// @vitest-environment node
/**
 * A job that restores the `node_modules` cache runs AFTER the job that saves it, or the restore is a lie.
 *
 * ## The defect this was written for
 *
 * `install` seeds one `actions/cache` entry that every other job restores instead of installing. Measured on
 * run 34078228894:
 *
 *     install       start +3s   end +127s     ← saves the entry at +127
 *     deploy-food   start +124s               ← three seconds BEFORE it exists
 *
 * `deploy-preview` needs only `sandbox-status` and `resolve-sandbox`, so it starts while `install` is still
 * running. Its callee therefore cannot restore the entry for the CURRENT lockfile — on a PR that changes
 * `package-lock.json`, the key is new, nothing has written it yet, and the restore misses. The deploy jobs
 * papered over that by always running `npm ci` (97-106s each), which is correct but pays full price forever.
 *
 * The subtle half is that the miss is INVISIBLE: a restore-then-fallback job that misses still goes green,
 * just slowly, and on a branch whose lockfile is stable it would hit often enough to look like it works. The
 * ordering is what makes the hit reliable rather than lucky.
 *
 * ## Why the edge, and not a longer `restore-keys` chain
 *
 * A fallback key would serve the PREVIOUS lockfile's `node_modules` — the wrong dependency set, silently, to
 * a job that then deploys the result to AWS. Ordering costs three seconds and cannot be wrong.
 *
 * ⚠️ This gate does not require a restore. A job may legitimately install from scratch; what it may not do is
 * claim a cache that its own start time proves cannot be there.
 *
 * DESIGN PATTERN: Specification module over a pure predicate — {@link restoresBeforeSave} is a verdict over a
 * plain job graph, fired at a deliberately-unordered fake as well as at the working tree.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import yaml from 'yaml';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

const CI_WORKFLOW = '.github/workflows/_ci.yml';
const PREVIEW_WORKFLOW = '.github/workflows/_sandbox-preview.yml';

/** One workflow step, as this gate reads it. */
interface Step {
    readonly uses?: string;
    readonly with?: Record<string, unknown>;
}

/** One workflow job, as this gate reads it. */
interface Job {
    readonly needs?: string | string[];
    readonly uses?: string;
    readonly steps?: readonly Step[];
}

/** A job reduced to what this verdict needs. */
export interface CacheJob {
    /** The job's key in the workflow. */
    readonly name: string;
    /** Jobs it declares `needs:` on. */
    readonly needs: readonly string[];
    /** Whether it (or the reusable workflow it calls) saves the deps cache. */
    readonly savesDeps: boolean;
    /** Whether it (or the reusable workflow it calls) restores the deps cache. */
    readonly restoresDeps: boolean;
}

/**
 * Whether `from` can reach `target` by following `needs` edges.
 *
 * @param from - Starting job name.
 * @param target - Job that must be reachable.
 * @param byName - Every job, keyed by name.
 * @returns True when an ordering edge exists.
 */
function dependsOn(from: string, target: string, byName: ReadonlyMap<string, CacheJob>): boolean {
    const seen = new Set<string>();
    const stack = [...(byName.get(from)?.needs ?? [])];

    while (stack.length > 0) {
        const next = stack.pop() as string;

        if (next === target) {
            return true;
        }

        if (seen.has(next)) {
            continue;
        }

        seen.add(next);
        stack.push(...(byName.get(next)?.needs ?? []));
    }

    return false;
}

/**
 * The jobs that restore the deps cache without being ordered after the job that saves it.
 *
 * @param jobs - Every job in the pipeline.
 * @returns One explanatory line per unordered restorer, empty when all are ordered.
 */
export function restoresBeforeSave(jobs: readonly CacheJob[]): readonly string[] {
    const byName = new Map(jobs.map((job) => [job.name, job]));
    const savers = jobs.filter((job) => job.savesDeps).map((job) => job.name);

    return jobs
        .filter((job) => job.restoresDeps && !job.savesDeps)
        .filter((job) => !savers.some((saver) => dependsOn(job.name, saver, byName)))
        .map(
            (job) =>
                `${job.name}: restores the node_modules cache but is not ordered after ${savers.join(' or ') || '(no saver)'}, so on a new lockfile the entry cannot exist yet`,
        );
}

/**
 * Whether any step touches the `node_modules` cache with the given action suffix.
 *
 * @param steps - The job's steps.
 * @param action - `cache/save`, `cache/restore`, or `cache` for the read-write form.
 * @returns True when such a step exists.
 */
function touchesDepsCache(steps: readonly Step[], action: 'cache/save' | 'cache/restore'): boolean {
    return steps.some((step) => {
        const uses = step.uses ?? '';
        const readWrite = /actions\/cache@/.test(uses);
        const matches = uses.includes(`actions/${action}@`) || readWrite;

        return matches && /(^|\n|\s)node_modules/.test(String((step.with ?? {})['path'] ?? ''));
    });
}

/**
 * Read both workflows and reduce every job to its cache facts, folding a called workflow's steps into the
 * caller's job — a reusable workflow has no `needs` of its own, so the caller's edge is the only ordering
 * that exists.
 *
 * @returns The jobs, in workflow order.
 * @sideEffect Reads the working tree.
 */
function pipelineJobs(): readonly CacheJob[] {
    const read = (file: string): Record<string, Job> =>
        (yaml.parse(readFileSync(`${REPO_ROOT}/${file}`, 'utf8')) as { jobs?: Record<string, Job> }).jobs ?? {};
    const ci = read(CI_WORKFLOW);
    const calleeSteps = Object.values(read(PREVIEW_WORKFLOW)).flatMap((job) => job.steps ?? []);

    return Object.entries(ci).map(([name, job]) => {
        const own = job.steps ?? [];
        const steps = job.uses?.includes('_sandbox-preview.yml') ? [...own, ...calleeSteps] : own;
        const needs = job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];

        return {
            name,
            needs,
            savesDeps: touchesDepsCache(steps, 'cache/save'),
            restoresDeps: touchesDepsCache(steps, 'cache/restore'),
        };
    });
}

describe('restoresBeforeSave', () => {
    it('names a restorer that is not ordered after the saver', () => {
        expect(
            restoresBeforeSave([
                { name: 'install', needs: [], savesDeps: true, restoresDeps: false },
                { name: 'deploy', needs: ['probe'], savesDeps: false, restoresDeps: true },
                { name: 'probe', needs: [], savesDeps: false, restoresDeps: false },
            ]),
        ).toEqual([expect.stringContaining('deploy')]);
    });

    it('accepts an ordering reached transitively', () => {
        expect(
            restoresBeforeSave([
                { name: 'install', needs: [], savesDeps: true, restoresDeps: false },
                { name: 'build', needs: ['install'], savesDeps: false, restoresDeps: true },
                { name: 'deploy', needs: ['build'], savesDeps: false, restoresDeps: true },
            ]),
        ).toEqual([]);
    });

    it('ignores a job that never restores the cache', () => {
        expect(
            restoresBeforeSave([
                { name: 'install', needs: [], savesDeps: true, restoresDeps: false },
                { name: 'probe', needs: [], savesDeps: false, restoresDeps: false },
            ]),
        ).toEqual([]);
    });
});

describe('the PR pipeline never restores a deps cache before it is written', () => {
    it('is not vacuous: some job saves the deps cache and some job restores it', () => {
        const jobs = pipelineJobs();

        expect(jobs.some((job) => job.savesDeps)).toBe(true);
        expect(jobs.some((job) => job.restoresDeps)).toBe(true);
    });

    it('orders every deps-cache restorer after the install that seeds it', () => {
        expect(restoresBeforeSave(pipelineJobs())).toEqual([]);
    });
});
