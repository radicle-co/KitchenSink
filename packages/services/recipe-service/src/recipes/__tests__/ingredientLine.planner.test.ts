/**
 * `IngredientLinePlanner` — the I/O a recipe write does BEFORE its transaction (plan 002 U4, R9, R10).
 *
 * A write's lines name bindings; the planner loads them, asks food for the bound ones' names, and returns what
 * the transaction persists plus each line's identity (for the search text, the version snapshot and the
 * verification producer). It never holds a transaction: ADR-0034 forbids a network call inside one.
 */
import { describe, expect, it, vi } from 'vitest';
import { RecipeErrorCode } from '@kitchensink/recipe-core';

import type { FoodLookupArm } from '../../database/schema/foodLookupArm.js';
import type { FoodLookupsDal } from '../../ingredients/dal/foodLookups.dal.js';
import { canonicalIngredientName } from '../../ingredients/domain/ingredientName.js';
import type { FoodRefsGateway } from '../../ingredients/foodRefs.gateway.js';
import { LineIdentityReader } from '../../ingredients/lineIdentity.reader.js';
import { IngredientLinePlanner } from '../ingredientLine.planner.js';
import { isRecipeDomainError } from '../recipe.error.js';

const AT = new Date('2026-09-30T00:00:00.000Z');
const ROOT: FoodLookupArm = { kind: 'root', lookupId: 'l-root', foodId: 'food-1', foodOwnerId: null, createdAt: AT };
const DECLARED: FoodLookupArm = {
    kind: 'unresolved',
    lookupId: 'l-declared',
    createdAt: AT,
    failure: {
        unresolvedFoodId: 'f1',
        name: 'grandma’s spice mix',
        normalizedKey: 'grandma’s spice mix',
        reasonCode: 'author_declared',
        status: 'UNRESOLVED',
        foodHandleId: null,
        tiersConsulted: [],
        tiersUnavailable: [],
        attempts: 1,
        settledLookupId: null,
    },
};

/** A shared failure a food-service answer settled: every line on it was moved to ROOT (plan 002 R13). */
const SETTLED: FoodLookupArm = {
    kind: 'unresolved',
    lookupId: 'l-settled',
    createdAt: AT,
    failure: {
        unresolvedFoodId: 'f2',
        name: 'za’atar',
        normalizedKey: 'za’atar',
        reasonCode: 'awaiting_source',
        status: 'PENDING',
        foodHandleId: 'handle-1',
        tiersConsulted: [],
        tiersUnavailable: [],
        attempts: 1,
        settledLookupId: 'l-root',
    },
};

function build(arms: readonly FoodLookupArm[], names: Record<string, string | undefined> = {}) {
    const byId = new Map(arms.map((arm) => [arm.lookupId, arm]));
    const findByIds = vi.fn((ids: readonly string[]) =>
        Promise.resolve(
            new Map(
                ids.flatMap((id): [string, FoodLookupArm][] => {
                    const arm = byId.get(id);

                    return arm === undefined ? [] : [[id, arm]];
                }),
            ),
        ),
    );
    const resolve = vi.fn(async (_caller: unknown, refs: readonly { kind: string; id: string }[]) => ({
        answers: new Map(
            refs.map((ref) => {
                const name = names[ref.id];

                return [
                    `${ref.kind}:${ref.id}`,
                    name === undefined
                        ? { outcome: 'unreachable' }
                        : {
                              outcome: 'found',
                              name: canonicalIngredientName(name),
                              status: 'RESOLVED',
                              isPrivate: false,
                              rootId: ref.id,
                          },
                ];
            }),
        ),
        degraded: false,
    }));

    const lookups = { findByIds } as unknown as FoodLookupsDal;

    return {
        planner: new IngredientLinePlanner(
            lookups,
            new LineIdentityReader(lookups, { resolve } as unknown as FoodRefsGateway),
        ),
        findByIds,
        resolve,
    };
}

const line = (ingredientId: string, extra: Record<string, unknown> = {}) => ({
    ingredientId,
    quantity: { kind: 'exact' as const, value: 2 },
    unit: 'cup',
    ...extra,
});

/**
 * A settle moves every line on a shared failure to the bound food and mints no version (plan 002 R13). A save built
 * from a read taken before the settle still names the failure. The planner forwards such a line to the binding the
 * settle moved the lines to, so the stale save neither undoes the settle nor reads as an ingredient edit.
 */
describe('IngredientLinePlanner.plan — a line naming a settled failure', () => {
    it('⛔ is stored on the binding the settle moved the failure’s lines to', async () => {
        const { planner } = build([SETTLED, ROOT], { 'food-1': 'za’atar' });

        const plan = await planner.plan(undefined, [line('l-settled')]);

        expect(plan.inputs.map((input) => input.foodLookupId)).toStrictEqual(['l-root']);
        expect(plan.identities.get('l-root')?.name).toBe('za’atar');
    });

    it('leaves a failure that has not settled where it is', async () => {
        const { planner } = build([DECLARED]);

        const plan = await planner.plan(undefined, [line('l-declared')]);

        expect(plan.inputs.map((input) => input.foodLookupId)).toStrictEqual(['l-declared']);
    });
});

describe('IngredientLinePlanner.plan', () => {
    it('maps each line to what the transaction persists, in author order', async () => {
        const { planner } = build([ROOT, DECLARED], { 'food-1': 'beef brisket' });

        const plan = await planner.plan(undefined, [
            line('l-root', { notes: 'trimmed', preparation: 'sliced', groupLabel: 'Meat' }),
            line('l-declared', { unit: undefined, userCalories: 40 }),
        ]);

        expect(plan.inputs).toStrictEqual([
            {
                foodLookupId: 'l-root',
                quantity: { kind: 'exact', value: 2 },
                unit: 'cup',
                displayText: 'trimmed',
                preparation: 'sliced',
                groupLabel: 'Meat',
                sortOrder: 0,
            },
            {
                foodLookupId: 'l-declared',
                quantity: { kind: 'exact', value: 2 },
                unit: '',
                sortOrder: 1,
                userCalories: 40,
            },
        ]);
    });

    it('names bound lines from food and unresolved lines from their record, and builds the search text from them', async () => {
        const { planner, resolve } = build([ROOT, DECLARED], { 'food-1': 'beef brisket' });

        const plan = await planner.plan(undefined, [line('l-root'), line('l-declared')]);

        expect(resolve).toHaveBeenCalledWith(undefined, [{ kind: 'root', id: 'food-1' }], 'postCommit');
        expect(plan.identities.get('l-root')?.name).toBe('beef brisket');
        expect(plan.identities.get('l-declared')?.name).toBe('grandma’s spice mix');
        expect(plan.namesText).toBe('beef brisket grandma’s spice mix');
    });

    it('⛔ leaves a bound line nameless — and out of the search text — when food cannot be asked', async () => {
        const { planner } = build([ROOT, DECLARED]);

        const plan = await planner.plan(undefined, [line('l-root'), line('l-declared')]);

        expect(plan.identities.get('l-root')?.name).toBeUndefined();
        expect(plan.namesText).toBe('grandma’s spice mix');
    });

    it('⛔ refuses a line naming a binding that does not exist — before any write', async () => {
        const { planner } = build([ROOT]);

        const outcome = await planner.plan(undefined, [line('l-root'), line('l-missing')]).then(
            () => 'planned',
            (error: unknown) => error,
        );

        expect(isRecipeDomainError(outcome) && outcome.code === RecipeErrorCode.UNKNOWN_INGREDIENT).toBe(true);
    });

    it('carries a create’s transcription through, and asks food nothing for no lines', async () => {
        const { planner, resolve } = build([DECLARED]);

        const plan = await planner.plan(undefined, [
            line('l-declared', { sourceLine: '2 cups spice mix', sourcePhrase: 'spice mix' }),
        ]);

        expect(plan.inputs[0]).toMatchObject({ sourceLine: '2 cups spice mix', sourcePhrase: 'spice mix' });
        expect(resolve).not.toHaveBeenCalled();

        expect((await planner.plan(undefined, [])).inputs).toStrictEqual([]);
    });
});
