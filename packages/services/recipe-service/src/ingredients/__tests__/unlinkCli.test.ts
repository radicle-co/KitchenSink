/**
 * Unit suite for the recipe-side UNLINK half of U12a (plan
 * `docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md`, requirements R44–R46).
 *
 * This is the step that runs FIRST in the two-service catalog reset. It nulls `ingredients.food_id` and
 * `ingredients.food_resolution_status` IN PLACE and deletes nothing, because
 * `recipe_ingredients.ingredient_id` is `NOT NULL REFERENCES ingredients(id)` with no `ON DELETE` — a
 * delete would raise a foreign-key violation and, if it were made to succeed, would take user recipes with
 * it. The suite therefore asserts the row-preserving property as hard as the unlinking one.
 *
 * Under test here:
 *
 *  1. **The destructive-operation guard** (R45) — the same three mechanisms the food-side clear carries: a
 *     stage the operator must NAME back, a production stage that refuses without an explicit flag, and a
 *     dry run that reports without writing. A refusal is asserted to have touched the database at all.
 *  2. **The post-condition IS the guarantee.** A run that reports success having left even one linked row,
 *     or having changed the number of `recipe_ingredients` lines, is a failure — not a partial success.
 *     `assertUnlinkComplete` is the one authority for that, called by this command AND inside the
 *     adapter's transaction so a violation rolls back rather than commits (the shape ADR-0009 uses for
 *     sign-out: do the thing, then prove it happened).
 *
 * The unlink's exit code is what the food-side clear's precondition is ultimately protecting: reversed or
 * half-finished, every recipe carries a `food_id` pointing at a deleted row and `ingredients.food_id` has
 * NO foreign key to catch it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    PRODUCTION_STAGE,
    assertUnlinkComplete,
    decideUnlink,
    parseUnlinkArgs,
    runIngredientUnlink,
    describeTargetToken,
    refuseUnboundTarget,
    type DatabaseTarget,
    type IngredientLinkStore,
    type UnlinkCliOptions,
    type UnlinkFacts,
} from '../unlinkCli.js';
import { isIngredientUnlinkIncompleteError, isUnlinkRefusedError } from '../unlinkCli.errors.js';

/** Where the fake store reports its connection landed — the descriptor the binding guard judges against. */
const TARGET: DatabaseTarget = { host: '10.1.4.7', port: 5432, database: 'kitchensink_recipes', user: 'recipe_app' };

/** A complete, valid options object; each test overrides only the field it is about. */
function makeOptions(overrides: Partial<UnlinkCliOptions> = {}): UnlinkCliOptions {
    return {
        stage: 'sandbox',
        confirm: 'sandbox',
        allowProd: false,
        dryRun: false,
        // PR #91 review: a writing run must name the database it actually opened.
        confirmTarget: 'kitchensink_recipes@10.1.4.7:5432',
        ...overrides,
    };
}

/** A clean set of post-unlink facts; each test breaks exactly one invariant. */
function makeFacts(overrides: Partial<UnlinkFacts> = {}): UnlinkFacts {
    return { unlinked: 415, remainingLinked: 0, linesBefore: 3_106, linesAfter: 3_106, ...overrides };
}

/** Recorded port invocations, in the order they happened. */
interface Recorder {
    readonly calls: string[];
    readonly store: IngredientLinkStore;
}

/**
 * Build the store port over a shared call log.
 *
 * @param linked - How many ingredient rows still carry a food link before the run.
 * @param facts - What the transaction reports afterwards.
 */
function makeStore(linked: number, facts: UnlinkFacts = makeFacts()): Recorder {
    const calls: string[] = [];

    return {
        calls,
        store: {
            describeTarget: async (): Promise<DatabaseTarget> => TARGET,
            countLinked: async (): Promise<number> => {
                calls.push('countLinked');

                return linked;
            },
            countRecipeIngredientLines: async (): Promise<number> => {
                calls.push('countLines');

                return facts.linesBefore;
            },
            unlinkAll: async (): Promise<UnlinkFacts> => {
                calls.push('unlink');

                return facts;
            },
        },
    };
}

describe('parseUnlinkArgs', () => {
    beforeEach(() => {
        Reflect.deleteProperty(process.env, 'STAGE');
    });

    afterEach(() => {
        Reflect.deleteProperty(process.env, 'STAGE');
    });

    it('reads every flag from the argument vector', () => {
        expect(parseUnlinkArgs(['--stage', 'pr-7', '--confirm', 'pr-7', '--dry-run', '--allow-prod'])).toEqual({
            stage: 'pr-7',
            confirm: 'pr-7',
            allowProd: true,
            dryRun: true,
        });
    });

    it('defaults the booleans to false', () => {
        expect(parseUnlinkArgs(['--stage', 'dev'])).toEqual({
            stage: 'dev',
            confirm: undefined,
            allowProd: false,
            dryRun: false,
        });
    });

    it('falls back to STAGE from the environment', () => {
        process.env['STAGE'] = 'sandbox';

        expect(parseUnlinkArgs([])).toMatchObject({ stage: 'sandbox' });
    });

    it('prefers an explicit --stage over the environment', () => {
        process.env['STAGE'] = 'sandbox';

        expect(parseUnlinkArgs(['--stage', 'dev'])).toMatchObject({ stage: 'dev' });
    });

    it('refuses to infer a stage — an unnamed stage is the whole hazard', () => {
        expect(() => parseUnlinkArgs([])).toThrow(/--stage/);
    });

    it.each([[''], ['   ']])('rejects a blank stage (%j)', (stage) => {
        expect(() => parseUnlinkArgs(['--stage', stage])).toThrow(/--stage/);
    });

    it('rejects an unknown flag rather than silently ignoring it', () => {
        expect(() => parseUnlinkArgs(['--stage', 'dev', '--force'])).toThrow();
    });

    it('rejects a positional argument', () => {
        expect(() => parseUnlinkArgs(['--stage', 'dev', 'everything'])).toThrow();
    });
});

describe('decideUnlink', () => {
    it('unlinks when the operator names the stage they are on', () => {
        expect(decideUnlink(makeOptions())).toEqual({ kind: 'unlink' });
    });

    it('reports without confirmation when --dry-run is set', () => {
        expect(decideUnlink(makeOptions({ confirm: undefined, dryRun: true }))).toEqual({ kind: 'report' });
    });

    it('refuses a destructive run with no confirmation at all', () => {
        expect(decideUnlink(makeOptions({ confirm: undefined }))).toEqual({
            kind: 'refused',
            reason: 'confirmation-missing',
        });
    });

    it('refuses when the confirmed stage is not the stage being unlinked', () => {
        expect(decideUnlink(makeOptions({ stage: 'sandbox', confirm: 'pr-7' }))).toEqual({
            kind: 'refused',
            reason: 'confirmation-mismatch',
        });
    });

    it('refuses production without the explicit flag', () => {
        expect(decideUnlink(makeOptions({ stage: PRODUCTION_STAGE, confirm: PRODUCTION_STAGE }))).toEqual({
            kind: 'refused',
            reason: 'production-requires-flag',
        });
    });

    it('unlinks production only when the stage is named AND the flag is given', () => {
        expect(
            decideUnlink(makeOptions({ stage: PRODUCTION_STAGE, confirm: PRODUCTION_STAGE, allowProd: true })),
        ).toEqual({ kind: 'unlink' });
    });

    it('refuses --allow-prod on a stage that is not production, so the flag cannot become habit', () => {
        expect(decideUnlink(makeOptions({ allowProd: true }))).toEqual({
            kind: 'refused',
            reason: 'production-flag-off-production',
        });
    });

    it('still reports on a production dry run — reading counts writes nothing', () => {
        expect(decideUnlink(makeOptions({ stage: PRODUCTION_STAGE, confirm: undefined, dryRun: true }))).toEqual({
            kind: 'report',
        });
    });
});

describe('assertUnlinkComplete', () => {
    it('accepts a run that left no link and no missing line', () => {
        expect(() => assertUnlinkComplete(makeFacts())).not.toThrow();
    });

    it('rejects a run that left a linked row behind', () => {
        expect(() => assertUnlinkComplete(makeFacts({ remainingLinked: 1 }))).toThrow(/still carry a food link/);
    });

    it('rejects a run that lost a recipe_ingredients line', () => {
        expect(() => assertUnlinkComplete(makeFacts({ linesAfter: 3_105 }))).toThrow(/recipe_ingredients/);
    });

    it('rejects a run that GAINED a recipe_ingredients line — a concurrent writer is not quiescence', () => {
        expect(() => assertUnlinkComplete(makeFacts({ linesAfter: 3_107 }))).toThrow(/recipe_ingredients/);
    });

    it('throws the typed incomplete error, not a bare Error', () => {
        const thrown = ((): unknown => {
            try {
                assertUnlinkComplete(makeFacts({ remainingLinked: 2 }));

                return undefined;
            } catch (error: unknown) {
                return error;
            }
        })();

        expect(isIngredientUnlinkIncompleteError(thrown) && thrown.facts.remainingLinked).toBe(2);
    });
});

describe('runIngredientUnlink', () => {
    describe('the guard', () => {
        it('throws a refusal and never touches the database', async () => {
            const { calls, store } = makeStore(415);

            await expect(runIngredientUnlink(store, makeOptions({ confirm: undefined }))).rejects.toSatisfy(
                isUnlinkRefusedError,
            );
            expect(calls).toEqual([]);
        });

        it('carries the refusal reason on the error', async () => {
            const { store } = makeStore(415);
            const error = await runIngredientUnlink(
                store,
                makeOptions({ stage: PRODUCTION_STAGE, confirm: PRODUCTION_STAGE }),
            ).catch((thrown: unknown) => thrown);

            expect(isUnlinkRefusedError(error) && error.reason).toBe('production-requires-flag');
        });

        it('does not write on a production stage without the flag', async () => {
            const { calls, store } = makeStore(415);

            await expect(
                runIngredientUnlink(store, makeOptions({ stage: PRODUCTION_STAGE, confirm: PRODUCTION_STAGE })),
            ).rejects.toThrow();
            expect(calls).not.toContain('unlink');
        });
    });

    describe('the dry run', () => {
        it('reports what it would unlink and writes nothing', async () => {
            const { calls, store } = makeStore(415);

            await expect(runIngredientUnlink(store, makeOptions({ dryRun: true }))).resolves.toEqual({
                outcome: 'reported',
                stage: 'sandbox',
                linkedBefore: 415,
                unlinked: 0,
                recipeIngredientLines: 3_106,
                // PR #91 review: a dry run reports the target the destructive run must name back.
                target: 'kitchensink_recipes@10.1.4.7:5432',
            });
            expect(calls).not.toContain('unlink');
        });
    });

    describe('the unlink', () => {
        it('unlinks and reports what it changed', async () => {
            const { calls, store } = makeStore(415);

            await expect(runIngredientUnlink(store, makeOptions())).resolves.toEqual({
                outcome: 'unlinked',
                stage: 'sandbox',
                linkedBefore: 415,
                unlinked: 415,
                recipeIngredientLines: 3_106,
                target: 'kitchensink_recipes@10.1.4.7:5432',
            });
            expect(calls).toEqual(['countLinked', 'countLines', 'unlink']);
        });

        it('is a no-op that still succeeds when nothing is linked — the operation is idempotent', async () => {
            const { store } = makeStore(0, makeFacts({ unlinked: 0 }));

            await expect(runIngredientUnlink(store, makeOptions())).resolves.toMatchObject({
                outcome: 'unlinked',
                unlinked: 0,
            });
        });

        it('FAILS when the transaction reports a linked row survived', async () => {
            const { store } = makeStore(415, makeFacts({ remainingLinked: 4 }));

            await expect(runIngredientUnlink(store, makeOptions())).rejects.toSatisfy(
                isIngredientUnlinkIncompleteError,
            );
        });

        it('FAILS when the transaction reports a recipe_ingredients line went missing', async () => {
            const { store } = makeStore(415, makeFacts({ linesAfter: 3_000 }));

            await expect(runIngredientUnlink(store, makeOptions())).rejects.toSatisfy(
                isIngredientUnlinkIncompleteError,
            );
        });

        it('unlinks production when the stage is named and the flag is given', async () => {
            const { calls, store } = makeStore(415);

            await expect(
                runIngredientUnlink(
                    store,
                    makeOptions({ stage: PRODUCTION_STAGE, confirm: PRODUCTION_STAGE, allowProd: true }),
                ),
            ).resolves.toMatchObject({ outcome: 'unlinked', stage: PRODUCTION_STAGE });
            expect(calls).toContain('unlink');
        });
    });
});

/**
 * ⛔ THE GUARD THE STAGE FLAGS NEVER WERE (PR #91 review). `--stage`/`--confirm` are the operator DECLARING
 * what they believe, checked only against each other — so `--stage prod --allow-prod --confirm prod` was
 * accepted with `DATABASE_URL` pointed at sandbox and the unlink applied to whichever database was really
 * open. `describeDatabaseTarget` PRINTED the truth and nothing consumed it.
 */
describe('refuseUnboundTarget', () => {
    it('is what an operator must type back, verbatim — database@host:port', () => {
        expect(describeTargetToken(TARGET)).toBe('kitchensink_recipes@10.1.4.7:5432');
    });

    it('⛔ refuses the exact reported case: prod declared, sandbox connected', () => {
        expect(
            refuseUnboundTarget(
                makeOptions({
                    stage: PRODUCTION_STAGE,
                    confirm: PRODUCTION_STAGE,
                    allowProd: true,
                    confirmTarget: 'kitchensink_recipes@10.0.9.2:5432',
                }),
                TARGET,
            ),
        ).toBe('target-mismatch');
    });

    it('refuses a writing run that named no target at all', () => {
        expect(refuseUnboundTarget(makeOptions({ confirmTarget: undefined }), TARGET)).toBe(
            'target-confirmation-missing',
        );
    });

    it('admits a run whose typed target is the one the server reported', () => {
        expect(refuseUnboundTarget(makeOptions(), TARGET)).toBeUndefined();
    });

    it.each([
        ['a pr stage on another pr database', 'pr-7', 'kitchensink_recipes_pr_9'],
        ['a pr stage on the shared base database', 'pr-7', 'kitchensink_recipes'],
        ['production on a per-PR database', PRODUCTION_STAGE, 'kitchensink_recipes_pr_7'],
    ])('refuses %s without anyone typing anything', (_name, stage, database) => {
        expect(refuseUnboundTarget(makeOptions({ stage, confirm: stage }), { ...TARGET, database })).toBe(
            'stage-database-mismatch',
        );
    });

    it('checks the impossible pairing on a dry run, but never asks a dry run to type a target', () => {
        expect(
            refuseUnboundTarget(makeOptions({ stage: 'pr-7', dryRun: true, confirmTarget: undefined }), TARGET),
        ).toBe('stage-database-mismatch');
        expect(refuseUnboundTarget(makeOptions({ dryRun: true, confirmTarget: undefined }), TARGET)).toBeUndefined();
    });

    it('refuses the run itself, having touched NOTHING, when the target is unnamed', async () => {
        const recorder = makeStore(415);

        await expect(runIngredientUnlink(recorder.store, makeOptions({ confirmTarget: undefined }))).rejects.toSatisfy(
            isUnlinkRefusedError,
        );
        // The descriptor read is the only thing that happened: no count, and above all no unlink.
        expect(recorder.calls).toEqual([]);
    });
});
