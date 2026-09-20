// @vitest-environment node
/**
 * Repo-wide guard: every job that signs in as the fixed Clerk test pool and writes to a deployed stage holds the
 * pool's LEASE, resets the slot's data BEFORE it writes, and resets it again, `always()`, AFTER.
 *
 * Owner rulings 2026-09-13: "We should have a pool of test users for clerk so that we don't need to create ones",
 * and the tests must "guarantee that they not only clean up their data but … scope the data such that it won't
 * conflict with real data".
 *
 * ## The three obligations, and the failure each one prevents
 *
 *   1. **The lease** — a job-level (or workflow-level) `concurrency` group `test-pool-{tenant}-{tier}[-{lane}]` with
 *      `cancel-in-progress: false`. Without it two runs sign in as the same fixed users and reset each other's world
 *      mid-run. GitHub `concurrency` IS the mutex; there is no lease table. A group that interpolates the matrix
 *      shard must hand that shard to its resets, or the reset empties a slot another run holds.
 *   2. **Reset before, fatal** — a `resetPool.ts --tier {tier}` step ahead of the first step that writes, with no
 *      `always()` and no `continue-on-error`. The slots are fixed, so what they own is residue of an earlier run —
 *      possibly one cancelled before its own cleanup — and a tier driven over that world reports failures that read
 *      like app defects.
 *   3. **Reset after, always** — a `resetPool.ts --tier {tier}` step after the last write, whose `if:` carries
 *      `always()`. Playwright's `globalTeardown` and the emulator script both die with a cancelled job; a step does
 *      not (ADR-0032 §5).
 *
 * ## Derived, never enumerated
 *
 * A subject job is found by what it RUNS: the Maestro seeder, the k6 pool lease, the linkage credential mint or
 * catalog seed, the web Playwright suite in a job that points it at a deployed origin (`PLAYWRIGHT_BASE_URL`), or
 * the legacy food harness. The one exemption from the reset obligations is argued in {@link NO_RECIPE_WRITES}.
 *
 * ## The stubbed-API Playwright tier signs in as pool slots but is NOT a subject
 *
 * It holds no lease — a concurrency group there would cancel pull requests' stub runs against each other — so two
 * pull requests can drive the same `webStub` lane at once. That is safe on two invariants, not on the absence of a
 * deployed origin alone (`POOL_TIERS` in `testPool.ts` states them in full):
 *
 *   1. every session a stub-tier spec ends is its own browser context's — nothing in that tier revokes a session by
 *      id, deletes or updates the pool user, or writes its metadata, and Clerk holds concurrent sessions per user;
 *   2. it writes nothing to any stage — no deployed origin, and every `/api/v1/**` call is stubbed in the browser —
 *      so there is no data for a reset to own.
 *
 * Concurrent stub runs share only Clerk's per-user sign-in rate, which is a flake risk rather than a correctness one.
 * A change to that tier that breaks either invariant needs a lease and resets like every subject below.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { WORKFLOWS_DIR } from './cdkApps.js';
import { repoRoot, trackedFiles } from './serviceSources.js';
import { scalarText } from './workflowScalar.js';

interface Step {
    readonly name?: string;
    readonly id?: string;
    readonly if?: unknown;
    readonly run?: unknown;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly 'continue-on-error'?: unknown;
}

interface Concurrency {
    readonly group?: unknown;
    readonly 'cancel-in-progress'?: unknown;
}

interface Job {
    readonly concurrency?: Concurrency | string;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly steps?: readonly Step[];
}

interface Subject {
    readonly label: string;
    readonly concurrency: Concurrency | undefined;
    readonly steps: readonly Step[];
}

/** What makes a job lease the pool and write to a deployed stage. */
const LEASES =
    /e2e-seed\/src\/provision\.ts|provision:pool|mintLinkageCredentials\.ts|seed-catalog|npm run loadtest\b/u;

/** The web Playwright suite — a subject only where the job points it at a deployed origin. */
const WEB_SUITE = /test:e2e --workspace=@commise\/web/u;

/** A step that WRITES to the stage as a pool slot (the k6 lease alone writes nothing — the scenarios do). */
const WRITES =
    /e2e-seed\/src\/provision\.ts|seed-catalog|mintLinkageCredentials\.ts|test:e2e|runMaestroFlows\.sh|printLoadTier\.ts/u;

/** The reset command, capturing its tier. */
const RESET = /e2e-seed\/src\/resetPool\.ts --tier ([a-zA-Z0-9]+)/u;

/** The lease group: `test-pool-{tenant}-{tier}` with an optional lane suffix. */
const GROUP = /^test-pool-(sandbox|prod|\$\{\{[^}]+\}\})-([a-zA-Z0-9]+)(?:-(.+))?$/u;

/**
 * A step's shell with its COMMENT lines removed.
 *
 * ⛔ A TEXT GATE OVER A SHELL SCRIPT READS ITS COMMENTS AS COMMANDS, and that is not theoretical here: a
 * comment added to the domain-guard step explaining WHY `LINKAGE_AZP` must be checked happened to name
 * `mintLinkageCredentials.ts`, and {@link WRITES} matches that string — so a step that runs one predicate
 * was classified a stage WRITE, landed before the reset, and reddened this suite for a change that made the
 * workflow safer. It is the same failure `RecipeWorkersStack.test.ts` records for its own text gate, which
 * reported a dependency's JSDoc `@example` block as a live import.
 *
 * ⚠️ Line comments only. A `#` inside a quoted string is not a comment, and stripping from the first `#` on
 * a line would cut real commands in half — so only a line whose first non-space character is `#` is dropped.
 *
 * @param step - The step.
 * @returns Its `run` with comment lines removed. Pure.
 */
function commandsOf(step: { readonly run?: unknown }): string {
    return scalarText(step.run)
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');
}

/**
 * Subjects exempt from the RESET obligations (never from the lease), with the reason.
 *
 * `food-loadtest.yml` leases the k6 slots through `run.mjs` but its journey writes only FOODS, which the owner
 * ruled the catalog may keep ("The only thing we don't have to worry about is food").
 */
const NO_RECIPE_WRITES: Readonly<Record<string, string>> = {
    'food-loadtest.yml::loadtest': 'the food journey writes only foods, which the catalog keeps by owner ruling',
};

function subjects(): readonly Subject[] {
    return trackedFiles(WORKFLOWS_DIR)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .flatMap((file) => {
            const doc = parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
                concurrency?: Concurrency | string;
                jobs?: Record<string, Job>;
            } | null;
            const workflowConcurrency = doc?.concurrency;

            return Object.entries(doc?.jobs ?? {}).flatMap(([name, job]) => {
                const steps = job.steps ?? [];
                const runs = steps.map((step) => commandsOf(step));
                const deployedWeb =
                    job.env?.['PLAYWRIGHT_BASE_URL'] !== undefined && runs.some((run) => WEB_SUITE.test(run));

                if (!deployedWeb && !runs.some((run) => LEASES.test(run))) {
                    return [];
                }

                const concurrency = job.concurrency ?? workflowConcurrency;

                return [
                    {
                        label: `${path.basename(file)}::${name}`,
                        concurrency: typeof concurrency === 'string' ? { group: concurrency } : concurrency,
                        steps,
                    },
                ];
            });
        });
}

const found = subjects();
const byLabel = (label: string): Subject | undefined => found.find((subject) => subject.label === label);

describe('every job that writes as the fixed test pool holds its lease and resets its data', () => {
    it('finds the leasing jobs (non-vacuity — discovery still sees every tier)', () => {
        expect(found.map((subject) => subject.label)).toEqual(
            expect.arrayContaining([
                '_ci-heavy.yml::e2e-mobile-maestro',
                '_ci-heavy.yml::load-test-deployed',
                'deployedE2eTiers.yml::e2e-web',
                'deployedE2eTiers.yml::e2e-cross-service-linkage',
                'food-loadtest.yml::loadtest',
            ]),
        );
    });

    it('does not treat the stubbed-API web tier as a stage writer — it has no deployed origin and ends only its own sessions', () => {
        expect(byLabel('_ci.yml::integration-web-playwright')).toBeUndefined();
    });

    it.each(found.map((subject) => [subject.label, subject] as const))(
        '⛔ %s holds a test-pool concurrency group that never cancels a run in progress',
        (_, subject) => {
            const group = scalarText(subject.concurrency?.group);

            expect(group, 'no `test-pool-{tenant}-{tier}` concurrency group').toMatch(GROUP);
            expect(subject.concurrency?.['cancel-in-progress'], 'cancel-in-progress must be stated false').toBe(false);
        },
    );

    const resetting = found.filter((subject) => NO_RECIPE_WRITES[subject.label] === undefined);

    it.each(resetting.map((subject) => [subject.label, subject] as const))(
        '⛔ %s resets its slots BEFORE its first write, fatally, and AFTER its last write, always',
        (_, subject) => {
            const steps = subject.steps;
            const tier = GROUP.exec(scalarText(subject.concurrency?.group))?.[2];
            const writes = steps.flatMap((step, index) => (WRITES.test(commandsOf(step)) ? [index] : []));
            const resets = steps.flatMap((step, index) => {
                const match = RESET.exec(commandsOf(step));

                return match ? [{ step, index, tier: match[1] }] : [];
            });
            const firstWrite = Math.min(...writes);
            const lastWrite = Math.max(...writes);
            const before = resets.find(({ index }) => index < firstWrite);
            const after = resets.find(({ index }) => index > lastWrite);

            expect(writes.length, 'the job has write steps to order the resets against').toBeGreaterThan(0);
            expect(before, 'no resetPool step precedes the first write').toBeDefined();
            expect(after, 'no resetPool step follows the last write').toBeDefined();
            expect(before?.tier, 'the reset-before addresses a different tier than the lease').toBe(tier);
            expect(after?.tier, 'the reset-after addresses a different tier than the lease').toBe(tier);
            expect(
                scalarText(before?.step.if),
                'a reset-before that runs always() would run after a failure it should stop',
            ).not.toMatch(/always\(\)/u);
            expect(
                before?.step['continue-on-error'],
                'a reset-before that may fail silently lets the tier run over an unknown world',
            ).not.toBe(true);
            expect(scalarText(after?.step.if), 'a reset-after that is not always() skips on a cancelled run').toMatch(
                /always\(\)/u,
            );
        },
    );

    it.each(resetting.map((subject) => [subject.label, subject] as const))(
        '%s hands a per-shard lease’s shard to its resets',
        (_, subject) => {
            const lane = GROUP.exec(scalarText(subject.concurrency?.group))?.[3] ?? '';

            if (!lane.includes('matrix.shard')) {
                return;
            }

            const resets = subject.steps.filter((step) => RESET.test(commandsOf(step)));

            expect(resets.length).toBeGreaterThan(1);

            for (const step of resets) {
                expect(scalarText(step.run)).toMatch(/--shard "\$\{SHARD_INDEX\}"/u);
                expect(scalarText(step.env?.['SHARD_INDEX'])).toMatch(/matrix\.shard/u);
            }
        },
    );

    it.each(resetting.map((subject) => [subject.label, subject] as const))(
        '%s names the stage’s recipe, food and web origins on every reset — the purge reaches both services',
        (_, subject) => {
            const resets = subject.steps.filter((step) => RESET.test(commandsOf(step)));

            expect(resets.length).toBeGreaterThan(0);

            for (const step of resets) {
                // `resetPool` refuses to start without them; a step that dropped one would fail only at run time,
                // on a deployed stage, instead of here.
                for (const name of ['E2E_SEED_RECIPE_URL', 'E2E_SEED_FOOD_URL', 'E2E_SEED_WEB_ORIGIN']) {
                    expect(scalarText(step.env?.[name]), `${step.name ?? '(unnamed)'} does not set ${name}`).not.toBe(
                        '',
                    );
                }
            }
        },
    );

    it('carries no stale reset exemption', () => {
        expect(Object.keys(NO_RECIPE_WRITES).filter((label) => byLabel(label) === undefined)).toStrictEqual([]);
    });

    it('the group matcher reads tier and lane, and refuses a group that is not a pool lease', () => {
        expect(GROUP.exec('test-pool-sandbox-web-${{ matrix.shard }}')?.slice(1)).toEqual([
            'sandbox',
            'web',
            '${{ matrix.shard }}',
        ]);
        expect(GROUP.exec('test-pool-sandbox-maestro')?.[2]).toBe('maestro');
        expect(GROUP.test('food-loadtest-sandbox')).toBe(false);
        expect(GROUP.test('recipe-loadtest')).toBe(false);
    });
});
