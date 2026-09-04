/**
 * Unit suite for the food-catalog CLEAR half of U12a (plan
 * `docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md`, requirements R44–R47).
 *
 * Three properties are under test, and the middle one is the reason this unit exists at all:
 *
 *  1. **The destructive-operation guard** (R45) — a stage the operator must NAME, a production stage that
 *     refuses without an explicit flag, and a dry run that reports without writing. Every refusal is
 *     asserted to have touched NEITHER database, because a guard that refuses after the delete is not a
 *     guard.
 *  2. **⛔ THE ORDER.** The recipe-side unlink runs FIRST and must have COMPLETED before one food row is
 *     deleted. `ingredients.food_id` is an opaque cross-service reference with NO foreign key (the plan's
 *     own risk list), so nothing in either database catches the reversal — every recipe would silently
 *     carry a `food_id` pointing at a deleted row for the length of the window. The clear therefore
 *     REQUIRES a non-zero-linked count of zero as its precondition, and the suite asserts both that a
 *     non-zero count aborts before any delete and that the probe is invoked before the delete on the
 *     happy path.
 *  3. **Fail CLOSED.** A probe that throws (unreachable recipe database, missing `ingredients.food_id`)
 *     must abort, never be read as "zero remaining links" — the same posture ADR-0024 takes for an
 *     unreadable spend counter.
 *
 * The ordering discipline is copied deliberately from this repository's other two-system destructive
 * operation: `packages/apps/commise/web/scripts/teardownPreviewDomain.ts` and its mirror
 * `createPreviewDomain.ts` (ADR-0001, "Teardown of the preview address"), where each reversal of the two
 * steps manufactures a subdomain-takeover window and a failure in the first step aborts before the second.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    PRODUCTION_STAGE,
    assertCatalogCleared,
    decideClear,
    parseClearArgs,
    refuseUnboundClear,
    runCatalogClear,
    type CatalogClearDeps,
    type ClearCliOptions,
    type DatabaseTarget,
} from '../clearCli.js';
import {
    isCatalogClearIncompleteError,
    isCatalogClearRefusedError,
    isRecipeLinkageRemainingError,
} from '../clearCli.errors.js';

/**
 * Where both fake connections report they landed — the descriptor the guard judges against.
 *
 * ⚠️ `10.1.x` is SANDBOX under ADR-0002's CIDR scheme, and that is load-bearing now that the guard reads the
 * environment from the address: a production case has to run against {@link PRODUCTION_TARGET} or it is
 * (correctly) refused as a stage/environment mismatch before it reaches the rule it was written for.
 */
const TARGET: DatabaseTarget = { host: '10.1.4.7', port: 5432, database: 'kitchensink_food', user: 'food_app' };

/** The same database on the PRODUCTION side of ADR-0002's CIDR scheme. */
const PRODUCTION_TARGET: DatabaseTarget = { ...TARGET, host: '10.0.4.7' };

/** Ports that report a chosen descriptor, for the cases that are about which environment was reached. */
function makeDepsAt(target: DatabaseTarget): Recorder {
    const recorder = makeDeps(0);

    return {
        calls: recorder.calls,
        deps: {
            linkage: { ...recorder.deps.linkage, describeTarget: async (): Promise<DatabaseTarget> => target },
            catalog: { ...recorder.deps.catalog, describeTarget: async (): Promise<DatabaseTarget> => target },
        },
    };
}

/** A complete, valid options object; each test overrides only the field it is about. */
function makeOptions(overrides: Partial<ClearCliOptions> = {}): ClearCliOptions {
    return {
        stage: 'sandbox',
        confirm: 'sandbox',
        allowProd: false,
        dryRun: false,
        recipeDatabaseUrl: 'postgres://localhost:5432/recipes',
        // PR #91 review: a destructive run must name the database it actually opened, so the valid options
        // every case varies from now include the target this suite's fake connections report.
        confirmTarget: 'kitchensink_food@10.1.4.7:5432',
        ...overrides,
    };
}

/** Recorded port invocations, in the order they happened — the ordering assertion's evidence. */
interface Recorder {
    readonly calls: string[];
    readonly deps: CatalogClearDeps;
}

/**
 * Build the two ports over a shared call log.
 *
 * @param linked - What the recipe-linkage probe reports (or an error it throws).
 * @param foods - How many food rows the catalog holds.
 */
function makeDeps(linked: number | Error, foods = 42): Recorder {
    const calls: string[] = [];

    return {
        calls,
        deps: {
            linkage: {
                describeTarget: async (): Promise<DatabaseTarget> => TARGET,
                countLinkedIngredients: async (): Promise<number> => {
                    calls.push('probe');

                    if (linked instanceof Error) {
                        throw linked;
                    }

                    return linked;
                },
            },
            catalog: {
                describeTarget: async (): Promise<DatabaseTarget> => TARGET,
                countFoods: async (): Promise<number> => {
                    calls.push('count');

                    return foods;
                },
                deleteAllFoods: async (): Promise<number> => {
                    calls.push('delete');

                    return foods;
                },
            },
        },
    };
}

describe('parseClearArgs', () => {
    beforeEach(() => {
        Reflect.deleteProperty(process.env, 'STAGE');
        Reflect.deleteProperty(process.env, 'RECIPE_DATABASE_URL');
    });

    afterEach(() => {
        Reflect.deleteProperty(process.env, 'STAGE');
        Reflect.deleteProperty(process.env, 'RECIPE_DATABASE_URL');
    });

    const url = 'postgres://localhost:5432/recipes';

    it('reads every flag from the argument vector', () => {
        expect(
            parseClearArgs([
                '--stage',
                'pr-7',
                '--confirm',
                'pr-7',
                '--dry-run',
                '--allow-prod',
                '--recipe-database-url',
                url,
            ]),
        ).toEqual({
            stage: 'pr-7',
            confirm: 'pr-7',
            allowProd: true,
            dryRun: true,
            recipeDatabaseUrl: url,
        });
    });

    it('defaults the booleans to false', () => {
        const options = parseClearArgs(['--stage', 'dev', '--recipe-database-url', url]);

        expect(options).toEqual({
            stage: 'dev',
            confirm: undefined,
            allowProd: false,
            dryRun: false,
            recipeDatabaseUrl: url,
        });
    });

    it('falls back to STAGE and RECIPE_DATABASE_URL from the environment', () => {
        process.env['STAGE'] = 'sandbox';
        process.env['RECIPE_DATABASE_URL'] = url;

        expect(parseClearArgs([])).toMatchObject({ stage: 'sandbox', recipeDatabaseUrl: url });
    });

    it('prefers the explicit flags over the environment', () => {
        process.env['STAGE'] = 'sandbox';
        process.env['RECIPE_DATABASE_URL'] = 'postgres://wrong/db';

        expect(parseClearArgs(['--stage', 'dev', '--recipe-database-url', url])).toMatchObject({
            stage: 'dev',
            recipeDatabaseUrl: url,
        });
    });

    it('refuses to infer a stage — an unnamed stage is the whole hazard', () => {
        process.env['RECIPE_DATABASE_URL'] = url;

        expect(() => parseClearArgs([])).toThrow(/--stage/);
    });

    it.each([[''], ['   ']])('rejects a blank stage (%j)', (stage) => {
        expect(() => parseClearArgs(['--stage', stage, '--recipe-database-url', url])).toThrow(/--stage/);
    });

    it('requires the recipe database even for a dry run — the unlink proof is not optional', () => {
        expect(() => parseClearArgs(['--stage', 'dev', '--dry-run'])).toThrow(/--recipe-database-url/);
    });

    it('rejects an unknown flag rather than silently ignoring it', () => {
        expect(() => parseClearArgs(['--stage', 'dev', '--recipe-database-url', url, '--force'])).toThrow();
    });

    it('rejects a positional argument', () => {
        expect(() => parseClearArgs(['--stage', 'dev', '--recipe-database-url', url, 'everything'])).toThrow();
    });
});

describe('decideClear', () => {
    it('clears when the operator names the stage they are on', () => {
        expect(decideClear(makeOptions())).toEqual({ kind: 'clear' });
    });

    it('reports without confirmation when --dry-run is set', () => {
        expect(decideClear(makeOptions({ confirm: undefined, dryRun: true }))).toEqual({ kind: 'report' });
    });

    it('refuses a destructive run with no confirmation at all', () => {
        expect(decideClear(makeOptions({ confirm: undefined }))).toEqual({
            kind: 'refused',
            reason: 'confirmation-missing',
        });
    });

    it('refuses when the confirmed stage is not the stage being cleared', () => {
        expect(decideClear(makeOptions({ stage: 'sandbox', confirm: 'pr-7' }))).toEqual({
            kind: 'refused',
            reason: 'confirmation-mismatch',
        });
    });

    it('refuses production without the explicit flag', () => {
        expect(decideClear(makeOptions({ stage: PRODUCTION_STAGE, confirm: PRODUCTION_STAGE }))).toEqual({
            kind: 'refused',
            reason: 'production-requires-flag',
        });
    });

    it('clears production only when the stage is named AND the flag is given', () => {
        expect(
            decideClear(makeOptions({ stage: PRODUCTION_STAGE, confirm: PRODUCTION_STAGE, allowProd: true })),
        ).toEqual({ kind: 'clear' });
    });

    it('refuses --allow-prod on a stage that is not production, so the flag cannot become habit', () => {
        expect(decideClear(makeOptions({ allowProd: true }))).toEqual({
            kind: 'refused',
            reason: 'production-flag-off-production',
        });
    });

    it('refuses --allow-prod off production even on a dry run', () => {
        expect(decideClear(makeOptions({ allowProd: true, dryRun: true }))).toEqual({
            kind: 'refused',
            reason: 'production-flag-off-production',
        });
    });

    it('still reports on a production dry run — reading counts writes nothing', () => {
        expect(decideClear(makeOptions({ stage: PRODUCTION_STAGE, confirm: undefined, dryRun: true }))).toEqual({
            kind: 'report',
        });
    });
});

describe('assertCatalogCleared', () => {
    it('accepts a catalog whose every dependent table came away with the food rows', () => {
        expect(() => assertCatalogCleared({ food: 0, food_sources: 0, food_nutrients: 0 })).not.toThrow();
    });

    it('rejects a residue in ANY dependent table — the cascade is proved, not assumed', () => {
        expect(() => assertCatalogCleared({ food: 0, food_sources: 0, food_nutrients: 4 })).toThrow(/food_nutrients/);
    });

    it('names every table that still holds rows, not just the first', () => {
        const thrown = ((): unknown => {
            try {
                assertCatalogCleared({ food: 1, food_sources: 0, food_portions: 2 });

                return undefined;
            } catch (error: unknown) {
                return error;
            }
        })();

        expect(isCatalogClearIncompleteError(thrown) && thrown.residual).toEqual({ food: 1, food_portions: 2 });
    });
});

describe('runCatalogClear', () => {
    describe('the guard', () => {
        it('throws a refusal and touches NEITHER database', async () => {
            const { calls, deps } = makeDeps(0);

            await expect(runCatalogClear(deps, makeOptions({ confirm: undefined }))).rejects.toSatisfy(
                isCatalogClearRefusedError,
            );
            expect(calls).toEqual([]);
        });

        it('carries the refusal reason on the error', async () => {
            const { deps } = makeDeps(0);
            const error = await runCatalogClear(deps, makeOptions({ stage: PRODUCTION_STAGE, confirm: 'prod' })).catch(
                (thrown: unknown) => thrown,
            );

            expect(isCatalogClearRefusedError(error) && error.reason).toBe('production-requires-flag');
        });

        it('does not delete on a production stage without the flag', async () => {
            const { calls, deps } = makeDeps(0);

            await expect(
                runCatalogClear(deps, makeOptions({ stage: PRODUCTION_STAGE, confirm: PRODUCTION_STAGE })),
            ).rejects.toThrow();
            expect(calls).not.toContain('delete');
        });
    });

    describe('⛔ the recipe-side unlink must have completed first', () => {
        it('aborts before any food row is deleted when links remain', async () => {
            const { calls, deps } = makeDeps(3);

            await expect(runCatalogClear(deps, makeOptions())).rejects.toSatisfy(isRecipeLinkageRemainingError);
            expect(calls).toEqual(['probe']);
            expect(calls).not.toContain('delete');
        });

        it('reports how many links remain, so the operator knows the unlink did not finish', async () => {
            const { deps } = makeDeps(3);
            const error = await runCatalogClear(deps, makeOptions()).catch((thrown: unknown) => thrown);

            expect(isRecipeLinkageRemainingError(error) && error.remaining).toBe(3);
        });

        it('fails CLOSED when the probe itself cannot answer — never reads a failure as zero', async () => {
            const { calls, deps } = makeDeps(new Error('recipe database unreachable'));

            await expect(runCatalogClear(deps, makeOptions())).rejects.toThrow(/unreachable/);
            expect(calls).toEqual(['probe']);
        });

        it('probes BEFORE it deletes on the happy path', async () => {
            const { calls, deps } = makeDeps(0);

            await runCatalogClear(deps, makeOptions());

            expect(calls.indexOf('probe')).toBeLessThan(calls.indexOf('delete'));
        });
    });

    describe('the dry run', () => {
        it('reports counts and deletes nothing', async () => {
            const { calls, deps } = makeDeps(0, 8_412);

            const result = await runCatalogClear(deps, makeOptions({ dryRun: true }));

            expect(result).toEqual({
                outcome: 'reported',
                stage: 'sandbox',
                remainingLinkedIngredients: 0,
                foodsBefore: 8_412,
                foodsDeleted: 0,
                wouldProceed: true,
                // PR #91 review: a dry run reports the targets, so the destructive run can name one back.
                target: 'kitchensink_food@10.1.4.7:5432',
                recipeTarget: 'kitchensink_food@10.1.4.7:5432',
            });
            expect(calls).not.toContain('delete');
        });

        it('reports that it would NOT proceed while links remain, instead of throwing', async () => {
            const { calls, deps } = makeDeps(17, 8_412);

            const result = await runCatalogClear(deps, makeOptions({ dryRun: true }));

            expect(result).toMatchObject({ outcome: 'reported', remainingLinkedIngredients: 17, wouldProceed: false });
            expect(calls).not.toContain('delete');
        });
    });

    describe('the clear', () => {
        it('deletes the catalog and reports what it removed', async () => {
            const { calls, deps } = makeDeps(0, 8_412);

            await expect(runCatalogClear(deps, makeOptions())).resolves.toEqual({
                outcome: 'cleared',
                stage: 'sandbox',
                remainingLinkedIngredients: 0,
                foodsBefore: 8_412,
                foodsDeleted: 8_412,
                wouldProceed: true,
                target: 'kitchensink_food@10.1.4.7:5432',
                recipeTarget: 'kitchensink_food@10.1.4.7:5432',
            });
            expect(calls).toEqual(['probe', 'count', 'delete']);
        });

        // ⚠️ Runs against a PRODUCTION address on purpose. The guard now reads the environment from the
        // server's own address, so a production run declared against a sandbox connection is refused — which
        // is the point of the rule, and would make this case pass for the wrong reason if left as it was.
        it('clears production when the stage is named and the flag is given', async () => {
            const { calls, deps } = makeDepsAt(PRODUCTION_TARGET);

            await expect(
                runCatalogClear(
                    deps,
                    makeOptions({
                        stage: PRODUCTION_STAGE,
                        confirm: PRODUCTION_STAGE,
                        allowProd: true,
                        confirmTarget: 'kitchensink_food@10.0.4.7:5432',
                    }),
                ),
            ).resolves.toMatchObject({ outcome: 'cleared', stage: PRODUCTION_STAGE });
            expect(calls).toContain('delete');
        });
    });
});

/**
 * ⛔ THE GUARD THE STAGE FLAGS NEVER WERE (PR #91 review). `--stage`/`--confirm` are the operator DECLARING
 * what they believe, checked only against each other — so `--stage prod --allow-prod --confirm prod` was
 * accepted with `DATABASE_URL` pointed at sandbox, and `runCatalogClear` then deleted whichever catalog the
 * URLs had really opened. This module PRINTED the real targets and called that "the honest limit of the
 * guard, made visible"; nothing consumed them. Now the command does, before it reads a single row.
 */
describe('refuseUnboundClear', () => {
    /** A second server, for the probe-off-server case. */
    const ELSEWHERE: DatabaseTarget = { ...TARGET, host: '10.0.9.2' };

    // ⚠️ STRENGTHENED: this used to be caught only by the typed token disagreeing, i.e. it depended on the
    // operator having typed something. The environment rule now refuses it from the server's address alone.
    it('⛔ refuses the exact reported case: prod declared, sandbox connected', () => {
        expect(
            refuseUnboundClear(
                makeOptions({
                    stage: PRODUCTION_STAGE,
                    confirm: PRODUCTION_STAGE,
                    allowProd: true,
                    confirmTarget: 'kitchensink_food@10.0.9.2:5432',
                }),
                TARGET,
                TARGET,
            )?.reason,
        ).toBe('stage-environment-mismatch');
    });

    /**
     * ⛔ THE DIRECTION WITH THE BLAST RADIUS, at the command's own seam: a SANDBOX declaration that reached
     * production, with the token pasted straight from the dry run so it matches. Every stage flag is
     * satisfied — `--allow-prod` is not even required, because the operator never said `prod` — and before
     * the environment rule this deleted the production catalog.
     */
    it('⛔ refuses a sandbox declaration that reached production, and deletes NOTHING', async () => {
        const { calls, deps } = makeDepsAt(PRODUCTION_TARGET);

        await expect(
            runCatalogClear(deps, makeOptions({ confirmTarget: 'kitchensink_food@10.0.4.7:5432' })),
        ).rejects.toSatisfy(isCatalogClearRefusedError);
        expect(calls).toEqual([]);
    });

    it('refuses a destructive run that named no target at all', () => {
        expect(refuseUnboundClear(makeOptions({ confirmTarget: undefined }), TARGET, TARGET)?.reason).toBe(
            'target-confirmation-missing',
        );
    });

    it('admits a run whose typed target is the one the server reported', () => {
        expect(refuseUnboundClear(makeOptions(), TARGET, TARGET)?.reason).toBeUndefined();
    });

    /**
     * ⛔ THE TWO-DATABASE HALF. The food and recipe URLs are supplied SEPARATELY, so mixing them is the
     * mistake this task is most exposed to — and a probe answering from another server reports a DIFFERENT
     * stage's linkage, where "zero links remain" reads as permission to delete this stage's whole catalog.
     */
    it('refuses a probe that reached a different server than the catalog', () => {
        expect(refuseUnboundClear(makeOptions(), TARGET, ELSEWHERE)?.reason).toBe('probe-off-server');
    });

    it('applies the stage/database rule to the PROBE as well as the catalog', () => {
        expect(
            refuseUnboundClear(makeOptions(), TARGET, { ...TARGET, database: 'kitchensink_recipes_pr_9' })?.reason,
        ).toBe('stage-database-mismatch');
    });

    it('refuses an impossible stage/database pairing before asking about a typed target', () => {
        expect(
            refuseUnboundClear(
                makeOptions({ stage: 'pr-7', confirm: 'pr-7', confirmTarget: undefined }),
                TARGET,
                TARGET,
            )?.reason,
        ).toBe('stage-database-mismatch');
    });

    it('refuses the run itself, having touched NEITHER database, when the target is unnamed', async () => {
        const { calls, deps } = makeDeps(0);

        await expect(runCatalogClear(deps, makeOptions({ confirmTarget: undefined }))).rejects.toSatisfy(
            isCatalogClearRefusedError,
        );
        // Not even the linkage probe ran: the binding is checked before the ordering precondition.
        expect(calls).toEqual([]);
    });

    it('names the target it actually reached on the refusal, so the operator knows what to paste', async () => {
        const { deps } = makeDeps(0);
        const error = await runCatalogClear(deps, makeOptions({ confirmTarget: 'wrong@host:1' })).catch(
            (caught: unknown) => caught,
        );

        expect((error as Error).message).toContain('kitchensink_food@10.1.4.7:5432');
    });
});
