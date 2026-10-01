/**
 * `IngredientNutritionReader` — the shell of the batch food nutrition read (plan 002 U9): the private-binding owners
 * and food's nutrition, read concurrently, then answered by the pure `foodNutritionAnswer`.
 *
 * The nutrition gateway here is the REAL one over a fake food client, so the composition under test is the one
 * that ships.
 */
import { describe, expect, it, vi } from 'vitest';

import { CALLER_TOKEN as CALLER, makeFoodClients } from '../__fixtures__/ingredients.fixtures.js';
import type { FoodLookupsDal } from '../dal/foodLookups.dal.js';
import { FoodNutritionGateway } from '../foodNutrition.gateway.js';
import { IngredientNutritionReader } from '../ingredientNutrition.reader.js';

const CALLER_ID = 'user-caller';

/** A food client that answers `getNutrition` with `foods` for the ids it knows, and every other id unknown. */
function build(options: {
    readonly foods?: readonly { readonly id: string; readonly caloriesPer100g: number }[];
    readonly owners?: ReadonlyMap<string, string>;
    readonly foodDown?: boolean;
}) {
    const known = new Map((options.foods ?? []).map((food) => [food.id, food]));
    const { clients, mocks, readClient } = makeFoodClients({ readDeadlineMs: 60_000 });

    mocks.getNutrition.mockImplementation(async (ids) => {
        if (options.foodDown === true) {
            throw new Error('food is down');
        }

        return {
            foods: ids.flatMap((id) => {
                const food = known.get(id);

                return food === undefined ? [] : [{ ...food, status: 'RESOLVED' as const, portions: [] }];
            }),
            unknownIds: ids.filter((id) => !known.has(id)),
        };
    });
    mocks.getAuthoredNutrition.mockImplementation(async (ids) => ({ foods: [], unknownIds: [...ids] }));

    const findPrivateRootOwners = vi
        .fn<FoodLookupsDal['findPrivateRootOwners']>()
        .mockResolvedValue(options.owners ?? new Map());

    return {
        reader: new IngredientNutritionReader({ findPrivateRootOwners }, new FoodNutritionGateway(clients)),
        getNutrition: mocks.getNutrition,
        readClient,
        findPrivateRootOwners,
    };
}

describe('IngredientNutritionReader', () => {
    it('asks food about an UNBOUND public food and answers it found — there is no bound-only allowlist', async () => {
        const { reader, getNutrition, findPrivateRootOwners } = build({ foods: [{ id: 'f1', caloriesPer100g: 52 }] });

        const entries = await reader.read(CALLER_ID, CALLER, [{ kind: 'root', id: 'f1' }]);

        expect(getNutrition).toHaveBeenCalledWith(['f1'], expect.anything());
        expect(findPrivateRootOwners).toHaveBeenCalledWith(['f1']);
        expect(entries).toStrictEqual([
            {
                outcome: 'found',
                ref: { kind: 'root', id: 'f1' },
                freshness: 'fresh',
                caloriesPer100g: 52,
                portions: [],
            },
        ]);
    });

    it('asks food and the bindings about root ids only, and answers a variant absent', async () => {
        const { reader, getNutrition, findPrivateRootOwners } = build({ foods: [{ id: 'f1', caloriesPer100g: 52 }] });

        const entries = await reader.read(CALLER_ID, CALLER, [
            { kind: 'variant', id: 'v1' },
            { kind: 'root', id: 'f1' },
        ]);

        expect(getNutrition).toHaveBeenCalledWith(['f1'], expect.anything());
        expect(findPrivateRootOwners).toHaveBeenCalledWith(['f1']);
        expect(entries[0]).toStrictEqual({ outcome: 'absent', ref: { kind: 'variant', id: 'v1' } });
    });

    it('reads under the read budget, as the caller', async () => {
        const { reader, readClient } = build({});

        await reader.read(CALLER_ID, CALLER, [{ kind: 'root', id: 'f1' }]);

        expect(readClient).toHaveBeenCalledWith(CALLER, 'read');
    });

    it('⛔ answers a stranger’s private food exactly as an unknown id, even when food returned numbers', async () => {
        const { reader } = build({
            foods: [{ id: 'theirs', caloriesPer100g: 300 }],
            owners: new Map([['theirs', 'user-stranger']]),
        });

        const entries = await reader.read(CALLER_ID, CALLER, [
            { kind: 'root', id: 'theirs' },
            { kind: 'root', id: 'unknown' },
        ]);

        expect(entries).toStrictEqual([
            { outcome: 'absent', ref: { kind: 'root', id: 'theirs' } },
            { outcome: 'absent', ref: { kind: 'root', id: 'unknown' } },
        ]);
    });

    it('answers every ref unavailable when food is down and nothing is cached', async () => {
        const { reader } = build({ foodDown: true, owners: new Map([['theirs', 'user-stranger']]) });

        const entries = await reader.read(CALLER_ID, CALLER, [
            { kind: 'root', id: 'public' },
            { kind: 'root', id: 'theirs' },
        ]);

        expect(entries.map((entry) => entry.outcome)).toStrictEqual(['unavailable', 'unavailable']);
    });

    it('answers every root unavailable with no caller credential, and never calls food', async () => {
        const { reader, getNutrition } = build({ foods: [{ id: 'f1', caloriesPer100g: 52 }] });

        const entries = await reader.read(CALLER_ID, undefined, [{ kind: 'root', id: 'f1' }]);

        expect(getNutrition).not.toHaveBeenCalled();
        expect(entries).toStrictEqual([{ outcome: 'unavailable', ref: { kind: 'root', id: 'f1' } }]);
    });
});
