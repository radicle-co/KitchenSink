/**
 * T034-test — unit tests for {@link PhotosDal}.
 *
 * The DAL is exercised over the same hand-rolled fake Drizzle client the recipe DAL suite uses: every
 * builder method is chainable and each `await`ed chain shifts one preconfigured result off a FIFO queue,
 * while `.values()` / `.set()` arguments are recorded for assertion. This pins the DAL's real logic —
 * the 10-photos-per-recipe cap (COUNT before INSERT → `MAX_PHOTOS_EXCEEDED`), append-to-end
 * `sortOrder` assignment, recipe-scoped reads/deletes, and the reorder sort_order rewrite — without a
 * database (that path is covered by the integration spec).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RecipeErrorCode } from '@kitchensink/recipe-core';

import { MAX_PHOTOS_PER_RECIPE, PhotosDal } from '../photos.dal.js';
import { isRecipeDomainError } from '../../photo.error.js';
import type { RecipeDrizzle } from '../../../database/client.js';
import { makeRecipePhotoRow } from '../../../__fixtures__/index.js';

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

const CHAIN_METHODS = ['values', 'returning', 'from', 'where', 'orderBy', 'limit', 'offset', 'set', 'for'] as const;

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
        // The advisory-lock guard in create() issues `tx.execute(SELECT pg_advisory_xact_lock(...))`.
        execute: (...args: unknown[]): Promise<unknown> => {
            calls.push({ method: 'execute', args });

            return Promise.resolve({ rows: [] });
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

/** All recorded `set(...)` argument payloads, in call order. */
function setPayloads(control: FakeControl): Record<string, unknown>[] {
    return control.calls.filter((call) => call.method === 'set').map((call) => call.args[0] as Record<string, unknown>);
}

const RECIPE_ID = '00000000-0000-4000-8000-00000000a001';

describe('PhotosDal.create', () => {
    let control: FakeControl;
    let dal: PhotosDal;

    beforeEach(() => {
        control = createFakeDb();
        dal = new PhotosDal(control.db);
    });

    it('appends the photo with sortOrder = current count and returns the inserted row', async () => {
        const inserted = makeRecipePhotoRow({ recipeId: RECIPE_ID, sortOrder: 3 });
        // COUNT (3 existing) → INSERT returning
        control.enqueue([{ count: 3 }], [inserted]);

        const result = await dal.create({
            recipeId: RECIPE_ID,
            s3Key: 'recipes/o/r/photos/new',
            contentType: 'image/png',
            sizeBytes: 4096,
        });

        expect(result).toEqual(inserted);

        const payload = valuesPayloads(control)[0] as Record<string, unknown>;
        expect(payload).toMatchObject({
            recipeId: RECIPE_ID,
            s3Key: 'recipes/o/r/photos/new',
            contentType: 'image/png',
            sizeBytes: 4096,
            sortOrder: 3, // appended after the 3 existing photos
        });
    });

    it('inserts the first photo at sortOrder 0', async () => {
        const inserted = makeRecipePhotoRow({ recipeId: RECIPE_ID, sortOrder: 0 });
        control.enqueue([{ count: 0 }], [inserted]);

        await dal.create({ recipeId: RECIPE_ID, s3Key: 'k', contentType: 'image/jpeg', sizeBytes: 10 });

        expect((valuesPayloads(control)[0] as Record<string, unknown>)['sortOrder']).toBe(0);
    });

    it('throws MAX_PHOTOS_EXCEEDED (and does NOT insert) when the recipe already has 10 photos', async () => {
        control.enqueue([{ count: MAX_PHOTOS_PER_RECIPE }]);

        let caught: unknown;

        try {
            await dal.create({ recipeId: RECIPE_ID, s3Key: 'k', contentType: 'image/jpeg', sizeBytes: 10 });
        } catch (error) {
            caught = error;
        }

        expect(isRecipeDomainError(caught) && caught.code).toBe(RecipeErrorCode.MAX_PHOTOS_EXCEEDED);
        expect(control.calls.some((call) => call.method === 'insert')).toBe(false);
    });
});

describe('PhotosDal.findByRecipe', () => {
    it('returns the recipe rows (ordered by sortOrder upstream)', async () => {
        const control = createFakeDb();
        const dal = new PhotosDal(control.db);
        const rows = [makeRecipePhotoRow({ id: 'p-1', sortOrder: 0 }), makeRecipePhotoRow({ id: 'p-2', sortOrder: 1 })];
        control.enqueue(rows);

        expect(await dal.findByRecipe(RECIPE_ID)).toEqual(rows);
        expect(control.calls.some((call) => call.method === 'orderBy')).toBe(true);
    });
});

describe('PhotosDal.findById', () => {
    it('returns the row when present', async () => {
        const control = createFakeDb();
        const dal = new PhotosDal(control.db);
        const row = makeRecipePhotoRow({ id: 'p-9' });
        control.enqueue([row]);

        expect(await dal.findById('p-9')).toEqual(row);
    });

    it('returns undefined when absent', async () => {
        const control = createFakeDb();
        const dal = new PhotosDal(control.db);
        control.enqueue([]);

        expect(await dal.findById('missing')).toBeUndefined();
    });
});

describe('PhotosDal.delete', () => {
    it('returns true when a row was removed', async () => {
        const control = createFakeDb();
        const dal = new PhotosDal(control.db);
        control.enqueue([{ id: 'p-1' }]);

        expect(await dal.delete(RECIPE_ID, 'p-1')).toBe(true);
    });

    it('returns false when nothing matched', async () => {
        const control = createFakeDb();
        const dal = new PhotosDal(control.db);
        control.enqueue([]);

        expect(await dal.delete(RECIPE_ID, 'missing')).toBe(false);
    });
});

describe('PhotosDal.reorder', () => {
    it('rewrites sort_order to the given index order and returns the reordered rows', async () => {
        const control = createFakeDb();
        const dal = new PhotosDal(control.db);
        const reordered = [
            makeRecipePhotoRow({ id: 'p-2', sortOrder: 0 }),
            makeRecipePhotoRow({ id: 'p-1', sortOrder: 1 }),
        ];
        // FOR UPDATE current-ids SELECT (a permutation of the request) → two per-id UPDATEs (no result
        // read) → final ordered SELECT.
        control.enqueue([{ id: 'p-1' }, { id: 'p-2' }], undefined, undefined, reordered);

        const result = await dal.reorder(RECIPE_ID, ['p-2', 'p-1']);

        expect(result).toEqual(reordered);

        const sets = setPayloads(control);
        expect(sets[0]).toMatchObject({ sortOrder: 0 });
        expect(sets[1]).toMatchObject({ sortOrder: 1 });
    });

    it('returns null and writes NOTHING when the request is not an exact permutation', async () => {
        const control = createFakeDb();
        const dal = new PhotosDal(control.db);
        // Current photos are {p-1, p-2} but the request only lists p-1 (a partial reorder).
        control.enqueue([{ id: 'p-1' }, { id: 'p-2' }]);

        const result = await dal.reorder(RECIPE_ID, ['p-1']);

        expect(result).toBeNull();
        // No sort_order was rewritten — the corruption path is closed at the DAL.
        expect(setPayloads(control)).toHaveLength(0);
    });
});
