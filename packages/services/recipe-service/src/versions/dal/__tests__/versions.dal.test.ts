/**
 * T030-test — unit tests for {@link VersionsDal}.
 *
 * Exercised over the same hand-rolled fake Drizzle client used by the recipes DAL suite: every builder
 * method is chainable and each `await`ed chain shifts one preconfigured result off a FIFO queue, while
 * `.values()` / `.set()` arguments are recorded for assertion. This pins the DAL's real logic — the
 * snapshot insert payload, the newest-first `listByRecipe` ordering, and (most importantly) the
 * retention query that finds every version BEYOND the newest 10 via `ORDER BY version_number DESC OFFSET
 * 10` — without a database (that path is covered by the integration spec).
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { VersionsDal, VERSION_RETENTION_LIMIT } from '../versions.dal.js';
import type { RecipeDrizzle } from '../../../database/client.js';
import { makeVersionRow } from '../../../__fixtures__/index.js';
import type { RecipeSnapshot } from '@kitchensink/recipe-core';

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
    };

    return {
        db: db as unknown as RecipeDrizzle,
        calls,
        enqueue: (...r: unknown[]): void => {
            results.push(...r);
        },
    };
}

/** A minimal, schema-valid recipe snapshot. */
const SNAPSHOT: RecipeSnapshot = {
    version: 1,
    title: 'Soup',
    description: '',
    steps: [],
    ingredients: [],
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
};

describe('VersionsDal.createSnapshot', () => {
    let control: FakeControl;
    let dal: VersionsDal;

    beforeEach(() => {
        control = createFakeDb();
        dal = new VersionsDal(control.db);
    });

    it('inserts a recipe_versions row from the input and returns it', async () => {
        const row = makeVersionRow({ id: 'v-1', recipeId: 'r-1', versionNumber: 3 });
        control.enqueue([row]);

        const result = await dal.createSnapshot({
            recipeId: 'r-1',
            versionNumber: 3,
            snapshot: SNAPSHOT,
            createdBy: 'owner-1',
            baseVersion: 2,
            changeSummary: 'Edited title',
        });

        expect(result).toEqual(row);

        const insertPayload = control.calls.find((call) => call.method === 'values')?.args[0];
        expect(insertPayload).toMatchObject({
            recipeId: 'r-1',
            versionNumber: 3,
            snapshot: SNAPSHOT,
            baseVersion: 2,
            createdBy: 'owner-1',
            changeSummary: 'Edited title',
        });
    });

    it('defaults optional baseVersion / changeSummary / s3Key to null', async () => {
        control.enqueue([makeVersionRow()]);

        await dal.createSnapshot({ recipeId: 'r-1', versionNumber: 1, snapshot: SNAPSHOT, createdBy: 'owner-1' });

        const insertPayload = control.calls.find((call) => call.method === 'values')?.args[0] as Record<
            string,
            unknown
        >;
        expect(insertPayload['baseVersion']).toBeNull();
        expect(insertPayload['changeSummary']).toBeNull();
        expect(insertPayload['s3Key']).toBeNull();
    });

    it('throws when the insert returns no row', async () => {
        control.enqueue([]);

        await expect(
            dal.createSnapshot({ recipeId: 'r-1', versionNumber: 1, snapshot: SNAPSHOT, createdBy: 'owner-1' }),
        ).rejects.toThrow();
    });
});

describe('VersionsDal.listByRecipe', () => {
    it('returns the recipe versions newest-first', async () => {
        const control = createFakeDb();
        const dal = new VersionsDal(control.db);
        const rows = [makeVersionRow({ versionNumber: 3 }), makeVersionRow({ versionNumber: 2 })];
        control.enqueue(rows);

        const result = await dal.listByRecipe('r-1');

        expect(result).toEqual(rows);
        // A single ordered read: select → from → where → orderBy (desc version_number).
        expect(control.calls.some((call) => call.method === 'orderBy')).toBe(true);
        expect(control.calls.some((call) => call.method === 'offset')).toBe(false);
    });
});

describe('VersionsDal.findById', () => {
    it('returns the row when present', async () => {
        const control = createFakeDb();
        const dal = new VersionsDal(control.db);
        const row = makeVersionRow({ id: 'v-9' });
        control.enqueue([row]);

        expect(await dal.findById('v-9')).toEqual(row);
    });

    it('returns undefined when no version matches', async () => {
        const control = createFakeDb();
        const dal = new VersionsDal(control.db);
        control.enqueue([]);

        expect(await dal.findById('missing')).toBeUndefined();
    });
});

describe('VersionsDal.findVersionsBeyondRetention', () => {
    it('offsets past the newest 10 (the retention limit) and returns the overflow rows', async () => {
        const control = createFakeDb();
        const dal = new VersionsDal(control.db);
        const overflow = [makeVersionRow({ versionNumber: 2 }), makeVersionRow({ versionNumber: 1 })];
        control.enqueue(overflow);

        const result = await dal.findVersionsBeyondRetention('r-1');

        expect(result).toEqual(overflow);
        expect(VERSION_RETENTION_LIMIT).toBe(10);
        const offsetCall = control.calls.find((call) => call.method === 'offset');
        expect(offsetCall?.args[0]).toBe(10);
        // Newest-first ordering is required for OFFSET to skip the newest, not the oldest.
        expect(control.calls.some((call) => call.method === 'orderBy')).toBe(true);
    });

    it('honors a custom keep count', async () => {
        const control = createFakeDb();
        const dal = new VersionsDal(control.db);
        control.enqueue([]);

        await dal.findVersionsBeyondRetention('r-1', 3);

        const offsetCall = control.calls.find((call) => call.method === 'offset');
        expect(offsetCall?.args[0]).toBe(3);
    });
});

describe('VersionsDal.deleteById', () => {
    it('issues a delete scoped to the version id', async () => {
        const control = createFakeDb();
        const dal = new VersionsDal(control.db);
        control.enqueue(undefined);

        await dal.deleteById('v-1');

        expect(control.calls.some((call) => call.method === 'delete')).toBe(true);
        expect(control.calls.some((call) => call.method === 'where')).toBe(true);
    });
});
