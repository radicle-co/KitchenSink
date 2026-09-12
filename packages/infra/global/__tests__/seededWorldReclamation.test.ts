// @vitest-environment node
/**
 * Repo-wide guard: a job that SEEDS a deployed stage's world reclaims it whenever anything may have been
 * seeded — including after the seeding step itself failed — and never when nothing ran.
 *
 * ## The defect this was written against
 *
 * `_ci-heavy.yml`'s deployed k6 job runs `provision:pool` and then `e2e-seed/src/provision.ts` in ONE step,
 * and gated its reclaim on `steps.pool.outcome == 'success'`. `provision.ts` creates three run-scoped Clerk
 * identities, an ingredient and the co-author's published recipe BEFORE it can fail (an `external_id` that
 * never arrives, a recipe-service 5xx, a Clerk refusal on the second sign-in), so a failed step is precisely
 * the run that has seeded something — and it was the one run that skipped the reclaim. The commit that moved
 * the pool to ticket sign-in recorded the gap in its own message ("the failed pool also skipped the run's
 * reclaim step; that remains true of any future pool failure").
 *
 * ## What is asserted, and why by EVALUATION rather than by string
 *
 * A seeding step's outcome is one of `success`, `failure`, `cancelled` once it has STARTED, and `skipped` when
 * its own gate held it back. "Anything may have been seeded" is exactly "it started", so the reclaim step's
 * `if:` must be TRUE in the three started worlds and FALSE in every world where the seeder's own gate was
 * false — which is also what "the target is not a live sandbox" reduces to, because each seeder is gated on
 * that fact.
 *
 * The condition is run through `workflowExpression.ts`'s interpreter with a resolver that THROWS on an atom it
 * does not model (the total-evaluation policy that file's docstring describes), so a new term added to either
 * `if:` fails here instead of silently changing who reclaims. A regex over the text could not tell `outcome == 'success'` from
 * `outcome != 'skipped'`, which is the entire difference between the defect and the fix.
 *
 * ⚠️ The model deliberately does NOT include "the job was cancelled between the secret load and the seeding
 * step". The Maestro tier gates its reclaim on the secret load, which is the seeding step's own gate, so in
 * that window it would run a teardown over nothing — harmless (the reset leases the fixed slots itself
 * and empties a world nothing seeded) and not worth a second id on a step another session is also editing.
 *
 * ## Mutation evidence
 *
 * Written against the defect: the k6 job's "seeding step FAILED" case was red while the Maestro job was green,
 * which is the finding that the Maestro tier did not share the defect. Each of these was then applied to the
 * fixed `if:` and watched to fail: restoring `== 'success'` (the failed world), dropping `always()` (the
 * implicit `success()` makes the failed world false), and reducing it to `always()` alone (every skipped
 * world turns true — a reclaim with nothing to reclaim against a stage nobody checked was live).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { WORKFLOWS_DIR } from './cdkApps.js';
import { repoRoot, trackedFiles } from './serviceSources.js';
import { evaluateCondition, isSkipTolerant, tokenize, unwrap, type Truth } from './workflowExpression.js';
import { scalarText } from './workflowScalar.js';

/** The command that seeds a deployed stage's world — what the after-run `resetPool` exists to reclaim. */
const SEEDS = /e2e-seed\/src\/provision\.ts/u;

/**
 * The command that reclaims it.
 *
 * ⛔ REWRITTEN for the fixed Clerk test pool (owner ruling 2026-09-13). The reclaim used to be `e2e-seed teardown`,
 * which deleted the run's data and then its run-minted Clerk identities. No run mints an identity any more, so the
 * reclaim is `resetPool`, which empties the leased slots' data and deletes no user. A job now runs it TWICE — a
 * fatal reset before it seeds and an `always()` reset after — so only a reset AFTER the seeding step is a reclaim;
 * the reset before is `testPoolWorkflowWiring.test.ts`'s to assert. The deployed k6 job left this guard's subject
 * set when it stopped running `e2e-seed provision` (nothing it measured read that world); its lease and resets are
 * asserted there too.
 */
const RECLAIMS = /e2e-seed\/src\/resetPool\.ts/u;

interface WorkflowStep {
    readonly id?: string;
    readonly name?: string;
    readonly if?: unknown;
    readonly run?: unknown;
    readonly 'continue-on-error'?: unknown;
}

interface SeedingJob {
    readonly label: string;
    readonly seeder: WorkflowStep;
    readonly seederIndex: number;
    readonly reclaimers: readonly { readonly step: WorkflowStep; readonly index: number }[];
}

/** Every job, in every tracked workflow, containing a step that seeds a deployed world. */
function seedingJobs(): readonly SeedingJob[] {
    return trackedFiles(WORKFLOWS_DIR)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .flatMap((file) => {
            const doc = parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
                jobs?: Record<string, { steps?: WorkflowStep[] }>;
            } | null;

            return Object.entries(doc?.jobs ?? {}).flatMap(([job, body]) => {
                const steps = body.steps ?? [];
                const seederIndex = steps.findIndex((step) => SEEDS.test(scalarText(step.run)));
                const seeder = steps[seederIndex];

                if (seeder === undefined) {
                    return [];
                }

                return [
                    {
                        label: `${path.basename(file)}:${job}`,
                        seeder,
                        seederIndex,
                        reclaimers: steps
                            .map((step, index) => ({ step, index }))
                            .filter(({ step, index }) => index > seederIndex && RECLAIMS.test(scalarText(step.run))),
                    },
                ];
            });
        });
}

type Outcome = 'success' | 'failure' | 'cancelled' | 'skipped';

/** One state of the job at the moment its reclaim step is evaluated. */
interface World {
    readonly description: string;
    /** The truth of each atom in the seeder's own gate. */
    readonly gate: ReadonlyMap<string, Truth>;
    readonly seederOutcome: Outcome;
    /** What `success()` / `failure()` / `cancelled()` report. */
    readonly jobStatus: 'success' | 'failure' | 'cancelled';
}

/**
 * The atoms of a PURE CONJUNCTION. The worlds below are only sound for one — a gate with `||` or `!` would need
 * a truth-table the model does not build — so anything else is refused rather than half-modelled.
 */
function conjunctionAtoms(condition: string): readonly string[] {
    const tokens = tokenize(unwrap(condition));

    if (tokens.some((token) => token === '||' || token === '!' || token === '(' || token === ')')) {
        throw new Error(
            `the seeding step's gate is not a plain conjunction, so this model cannot reason about it: ${condition}`,
        );
    }

    return tokens.filter((token) => token !== '&&');
}

/** The worlds that matter: the seeder started (three ways), or its gate held it back (once per gate atom). */
function worldsFor(seeder: WorkflowStep): { readonly started: readonly World[]; readonly heldBack: readonly World[] } {
    const atoms = conjunctionAtoms(scalarText(seeder.if, 'success()'));
    const allTrue = new Map(atoms.map((atom) => [atom, 'true' as Truth]));
    const started = (['success', 'failure', 'cancelled'] as const).map((outcome) => ({
        description: `the seeding step STARTED and ended ${outcome}`,
        gate: allTrue,
        seederOutcome: outcome,
        jobStatus: outcome,
    }));
    const heldBack = atoms.map((atom) => ({
        description: `the seeding step was SKIPPED because \`${atom}\` was false`,
        gate: new Map([...allTrue, [atom, 'false' as Truth]]),
        seederOutcome: 'skipped' as const,
        jobStatus: 'success' as const,
    }));

    return { started, heldBack };
}

const STATUS_FUNCTION = /\b(?:always|success|failure|cancelled)\s*\(\s*\)/u;

/**
 * Evaluate a reclaim step's `if:` in one world. Throws on an atom the model does not know, so the guard can
 * never pass by guessing.
 */
function reclaimRuns(job: SeedingJob, reclaimer: WorkflowStep, world: World): Truth {
    const raw = scalarText(reclaimer.if, '');
    // GitHub prepends an implicit `success() &&` to any condition that names no status function.
    const condition = STATUS_FUNCTION.test(raw) ? raw : `success() && (${raw === '' ? 'true' : unwrap(raw)})`;
    const seederId = job.seeder.id;

    return evaluateCondition(condition, (atom) => {
        const call = /^(always|success|failure|cancelled)\(\s*\)$/u.exec(atom);

        if (call) {
            return call[1] === 'always' || call[1] === world.jobStatus ? 'true' : 'false';
        }

        if (atom === 'true') {
            return 'true';
        }

        const known = world.gate.get(atom);

        if (known !== undefined) {
            return known;
        }

        const outcome = /^steps\.([A-Za-z0-9_-]+)\.outcome\s*(==|!=)\s*'([a-z]+)'$/u.exec(atom);

        if (outcome && seederId !== undefined && outcome[1] === seederId) {
            const equal = world.seederOutcome === outcome[3];

            return (outcome[2] === '==') === equal ? 'true' : 'false';
        }

        throw new Error(
            `${job.label} » "${reclaimer.name ?? '(unnamed)'}" gates on \`${atom}\`, which this model does not know. ` +
                `A reclaim may depend only on its seeding step's own gate, that step's outcome, and status functions.`,
        );
    });
}

describe('a job that seeds a deployed world reclaims it whenever anything may have been seeded', () => {
    const jobs = seedingJobs();

    it('finds the seeding jobs (the Maestro tier)', () => {
        // Non-vacuity: every assertion below iterates this list.
        expect(jobs.map((job) => job.label).sort()).toEqual(['_ci-heavy.yml:e2e-mobile-maestro']);
    });

    for (const job of jobs) {
        describe(job.label, () => {
            it('has exactly one reclaim step, AFTER the seeding step', () => {
                expect(job.reclaimers.length, 'a seeding job with no reclaim leaks every run').toBe(1);
                expect(job.reclaimers[0]?.index ?? -1).toBeGreaterThan(job.seederIndex);
            });

            it('never lets the reclaim fail the job, and never lets a failed predecessor skip it', () => {
                const reclaimer = job.reclaimers[0]?.step;

                expect(reclaimer?.['continue-on-error']).toBe(true);
                expect(isSkipTolerant(scalarText(reclaimer?.if, ''))).toBe(true);
            });

            const { started, heldBack } = worldsFor(job.seeder);

            for (const world of started) {
                it(`RECLAIMS when ${world.description}`, () => {
                    const reclaimer = job.reclaimers[0]?.step ?? {};

                    expect(
                        reclaimRuns(job, reclaimer, world),
                        `${job.label}: the reclaim step does not run when ${world.description}, so whatever the ` +
                            'step created before it stopped is leaked',
                    ).toBe('true');
                });
            }

            for (const world of heldBack) {
                it(`does NOT reclaim when ${world.description}`, () => {
                    const reclaimer = job.reclaimers[0]?.step ?? {};

                    expect(
                        reclaimRuns(job, reclaimer, world),
                        `${job.label}: the reclaim step runs when ${world.description} — nothing was seeded, and ` +
                            'the target was never confirmed to be a live sandbox',
                    ).toBe('false');
                });
            }
        });
    }
});
