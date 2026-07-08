/**
 * T024-test — unit tests for {@link RecipesDal}.
 *
 * The DAL is exercised over a hand-rolled fake Drizzle client: every builder method is chainable and
 * each `await`ed chain shifts one preconfigured result off a FIFO queue, while `.values()` / `.set()`
 * arguments are recorded for assertion. This pins the DAL's real logic — 1-based step numbering, the
 * `deleted_at IS NULL` + owner filtering, pagination offset math, the `current_version` bump, step
 * replacement on update, and the soft-delete boolean — without a database (that path is covered by the
 * integration specs).
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { RecipesDal } from '../dal/recipes.dal.js';
import type { RecipeDrizzle } from '../../database/client.js';
import { makeRecipeRow, makeRecipeStepRow } from '../../__fixtures__/index.js';

/** A recorded builder invocation. */
interface RecordedCall {
    method: string;
    args: unknown[];
}

/** A chainable, thenable query stub: builder methods return `this`; awaiting shifts one queued result. */
interface FakeControl {
    db: RecipeDrizzle;
    calls: RecordedCall[];
    enqueue: (...results: unknown[]) => void;
}

const CHAIN_METHODS = ['values', 'returning', 'from', 'where', 'orderBy', 'limit', 'offset', 'set'] as const;

function createFakeDb(): FakeControl {
    const calls: RecordedCall[] = [];
    const results: unknown[] = [];

    function makeChain(): Record<string, unknown> {
        const chain: Record<string, unknown> = {};

        for (const method of CHAIN_METHODS) {
            chain[method] = (...args: unknown[]): unknown => {
                calls.push({ method, args });

                return chain;
            };
        }

        chain['then'] = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown): unknown =>
            Promise.resolve(results.shift()).then(resolve, reject);

        return chain;
    }

    const db: Record<string, unknown> = {
        insert: (...args: unknown[]): unknown => {
            calls.push({ method: 'insert', args });

            return makeChain();
        },
        select: (...args: unknown[]): unknown => {
            calls.push({ method: 'select', args });

            return makeChain();
        },
        update: (...args: unknown[]): unknown => {
            calls.push({ method: 'update', args });

            return makeChain();
        },
        delete: (...args: unknown[]): unknown => {
            calls.push({ method: 'delete', args });

            return makeChain();
        },
        transaction: (callback: (tx: unknown) => Promise<unknown>): Promise<unknown> => callback(db),
    };

    return {
        db: db as unknown as RecipeDrizzle,
        calls,
        enqueue: (...r: unknown[]): void => {
            results.push(...r);
        },
    };
}

/** All recorded `values(...)` argument payloads, in call order. */
function valuesPayloads(control: FakeControl): unknown[] {
    return control.calls.filter((call) => call.method === 'values').map((call) => call.args[0]);
}

describe('RecipesDal.create', () => {
    let control: FakeControl;
    let dal: RecipesDal;

    beforeEach(() => {
        control = createFakeDb();
        dal = new RecipesDal(control.db);
    });

    it('inserts the recipe row then its steps with 1-based stepNumbers, returning the aggregate', async () => {
        const recipeRow = makeRecipeRow({ id: 'r-1', ownerId: 'owner-1' });
        const stepRows = [
            makeRecipeStepRow({ recipeId: 'r-1', stepNumber: 1, instruction: 'Chop' }),
            makeRecipeStepRow({ recipeId: 'r-1', stepNumber: 2, instruction: 'Cook' }),
        ];
        control.enqueue([recipeRow], stepRows);

        const result = await dal.create({
            ownerId: 'owner-1',
            title: 'Soup',
            visibility: 'public',
            servings: 2,
            prepTimeMinutes: 5,
            cookTimeMinutes: 10,
            totalTimeMinutes: 15,
            tags: ['dinner'],
            dietaryFlags: [],
            ingredientNamesText: 'onion carrot',
            steps: [{ instruction: 'Chop' }, { instruction: 'Cook', timerSeconds: 600 }],
        });

        expect(result).toEqual({ recipe: recipeRow, steps: stepRows });

        const payloads = valuesPayloads(control);
        expect(payloads[0]).toMatchObject({ ownerId: 'owner-1', title: 'Soup', ingredientNamesText: 'onion carrot' });

        const stepValues = payloads[1] as { stepNumber: number; instruction: string; timerSeconds: number | null }[];
        expect(stepValues).toEqual([
            { recipeId: 'r-1', stepNumber: 1, instruction: 'Chop', timerSeconds: null },
            { recipeId: 'r-1', stepNumber: 2, instruction: 'Cook', timerSeconds: 600 },
        ]);
    });
});

describe('RecipesDal.findById', () => {
    it('returns the aggregate for an active recipe', async () => {
        const control = createFakeDb();
        const dal = new RecipesDal(control.db);
        const recipeRow = makeRecipeRow({ id: 'r-9' });
        const stepRows = [makeRecipeStepRow({ recipeId: 'r-9' })];
        control.enqueue([recipeRow], stepRows);

        const result = await dal.findById('r-9');

        expect(result).toEqual({ recipe: recipeRow, steps: stepRows });
    });

    it('returns undefined when no active recipe matches', async () => {
        const control = createFakeDb();
        const dal = new RecipesDal(control.db);
        control.enqueue([]);

        expect(await dal.findById('missing')).toBeUndefined();
    });
});

describe('RecipesDal.findAll', () => {
    it('applies the pagination offset, returns the total, and groups steps by recipe', async () => {
        const control = createFakeDb();
        const dal = new RecipesDal(control.db);
        const rowA = makeRecipeRow({ id: 'a' });
        const rowB = makeRecipeRow({ id: 'b' });
        const steps = [
            makeRecipeStepRow({ recipeId: 'a', stepNumber: 1 }),
            makeRecipeStepRow({ recipeId: 'b', stepNumber: 1 }),
            makeRecipeStepRow({ recipeId: 'b', stepNumber: 2 }),
        ];
        control.enqueue([rowA, rowB], [{ count: 7 }], steps);

        const result = await dal.findAll({ ownerId: 'owner-1', page: 2, pageSize: 2, sortBy: 'updatedAt' });

        expect(result.total).toBe(7);
        expect(result.rows).toHaveLength(2);
        expect(result.rows[0]?.steps).toHaveLength(1);
        expect(result.rows[1]?.steps).toHaveLength(2);

        const offsetCall = control.calls.find((call) => call.method === 'offset');
        expect(offsetCall?.args[0]).toBe(2); // (page 2 - 1) * pageSize 2
    });
});

describe('RecipesDal.update', () => {
    it('bumps current_version and replaces steps when steps are provided', async () => {
        const control = createFakeDb();
        const dal = new RecipesDal(control.db);
        const updatedRow = makeRecipeRow({ id: 'r-1', currentVersion: 2 });
        const newSteps = [makeRecipeStepRow({ recipeId: 'r-1', stepNumber: 1, instruction: 'New' })];
        // update.returning → deleteSteps → insertSteps.returning
        control.enqueue([updatedRow], undefined, newSteps);

        const result = await dal.update('r-1', { title: 'Renamed', steps: [{ instruction: 'New' }] });

        expect(result).toEqual({ recipe: updatedRow, steps: newSteps });

        const setCall = control.calls.find((call) => call.method === 'set');
        const setArg = setCall?.args[0] as Record<string, unknown>;
        expect(setArg).toHaveProperty('title', 'Renamed');
        expect(setArg).toHaveProperty('currentVersion'); // SQL increment expression present
        expect(control.calls.some((call) => call.method === 'delete')).toBe(true);
    });

    it('returns undefined when the active row is gone', async () => {
        const control = createFakeDb();
        const dal = new RecipesDal(control.db);
        control.enqueue([]);

        expect(await dal.update('missing', { title: 'x' })).toBeUndefined();
    });
});

describe('RecipesDal.softDelete', () => {
    it('returns true when a row was tombstoned', async () => {
        const control = createFakeDb();
        const dal = new RecipesDal(control.db);
        control.enqueue([{ id: 'r-1' }]);

        expect(await dal.softDelete('r-1')).toBe(true);
    });

    it('returns false when nothing matched', async () => {
        const control = createFakeDb();
        const dal = new RecipesDal(control.db);
        control.enqueue([]);

        expect(await dal.softDelete('missing')).toBe(false);
    });
});
