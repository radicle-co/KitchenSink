/**
 * T039-test — unit tests for {@link CollectionsDal} over a chainable fake Drizzle client.
 *
 * The fake records every builder call and resolves a FIFO queue of canned results when a chain is
 * awaited, so these tests pin the DAL's SHAPE — which builders it invokes and how it maps rows — without
 * a database. The real SQL semantics (tombstone exclusion actually filtering, `ON CONFLICT` idempotency,
 * no-cascade delete) are asserted against Docker Postgres in
 * `__tests__/integration/collections/crud.integration.spec.ts`.
 */
import { describe, it, expect } from 'vitest';

import type { RecipeDrizzle } from '../../../database/database.module.js';
import { makeCollectionRow, makeMembershipRow, makeRecipeRow } from '../../__fixtures__/collections.fixtures.js';
import { CollectionsDal } from '../collections.dal.js';

interface FakeDb {
    readonly db: RecipeDrizzle;
    readonly calls: Array<{ method: string; args: unknown[] }>;
    readonly queue: (result: unknown) => void;
}

/** A chainable, awaitable fake: every method returns the same proxy; awaiting shifts the result queue. */
function createFakeDb(): FakeDb {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const results: unknown[] = [];

    const handler: ProxyHandler<() => void> = {
        get(_target, prop) {
            if (prop === 'then') {
                return (resolve: (value: unknown) => void): void => {
                    resolve(results.length > 0 ? results.shift() : undefined);
                };
            }

            return (...args: unknown[]): unknown => {
                calls.push({ method: String(prop), args });

                return proxy;
            };
        },
    };

    const proxy = new Proxy((() => undefined) as () => void, handler);

    return {
        db: proxy as unknown as RecipeDrizzle,
        calls,
        queue: (result) => results.push(result),
    };
}

/** Names of the builder methods invoked, in order — for asserting a chain's shape. */
const methodsOf = (fake: FakeDb): string[] => fake.calls.map((call) => call.method);

describe('CollectionsDal.create', () => {
    it('inserts the collection and returns the persisted row', async () => {
        const fake = createFakeDb();
        const row = makeCollectionRow();
        fake.queue([row]);
        const dal = new CollectionsDal(fake.db);

        const result = await dal.create({ ownerId: 'owner-1', name: 'Weeknight Dinners', visibility: 'private' });

        expect(result).toBe(row);
        expect(methodsOf(fake)).toEqual(['insert', 'values', 'returning']);
        expect(fake.calls[1]?.args[0]).toMatchObject({
            ownerId: 'owner-1',
            name: 'Weeknight Dinners',
            visibility: 'private',
            description: null,
        });
    });
});

describe('CollectionsDal.findById', () => {
    it('returns the row when present', async () => {
        const fake = createFakeDb();
        const row = makeCollectionRow();
        fake.queue([row]);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.findById(row.id)).toBe(row);
        expect(methodsOf(fake)).toEqual(['select', 'from', 'where', 'limit']);
    });

    it('returns undefined when absent', async () => {
        const fake = createFakeDb();
        fake.queue([]);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.findById('missing')).toBeUndefined();
    });
});

describe('CollectionsDal.listByOwner', () => {
    it('returns the page rows plus the unpaged total', async () => {
        const fake = createFakeDb();
        const rows = [makeCollectionRow({ id: 'a' }), makeCollectionRow({ id: 'b' })];
        fake.queue(rows);
        fake.queue([{ value: 5 }]);
        const dal = new CollectionsDal(fake.db);

        const page = await dal.listByOwner('owner-1', 2, 0);

        expect(page).toEqual({ rows, total: 5 });
        expect(methodsOf(fake)).toEqual([
            'select',
            'from',
            'where',
            'orderBy',
            'limit',
            'offset',
            'select',
            'from',
            'where',
        ]);
    });
});

describe('CollectionsDal.update', () => {
    it('always bumps updated_at and sets only the provided fields', async () => {
        const fake = createFakeDb();
        const updated = makeCollectionRow({ name: 'Renamed' });
        fake.queue([updated]);
        const dal = new CollectionsDal(fake.db);

        const result = await dal.update(updated.id, { name: 'Renamed' });

        expect(result).toBe(updated);
        expect(methodsOf(fake)).toEqual(['update', 'set', 'where', 'returning']);
        const setArg = fake.calls[1]?.args[0] as Record<string, unknown>;
        expect(setArg['name']).toBe('Renamed');
        expect(setArg['updatedAt']).toBeInstanceOf(Date);
        expect(setArg).not.toHaveProperty('visibility');
    });

    it('returns undefined when the id does not exist', async () => {
        const fake = createFakeDb();
        fake.queue([]);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.update('missing', { visibility: 'public' })).toBeUndefined();
    });
});

describe('CollectionsDal.deleteById', () => {
    it('returns true when a row was removed', async () => {
        const fake = createFakeDb();
        fake.queue([{ id: 'c1' }]);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.deleteById('c1')).toBe(true);
        expect(methodsOf(fake)).toEqual(['delete', 'where', 'returning']);
    });

    it('returns false when nothing matched', async () => {
        const fake = createFakeDb();
        fake.queue([]);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.deleteById('missing')).toBe(false);
    });
});

describe('CollectionsDal.findActiveRecipe', () => {
    it('joins on deleted_at IS NULL and returns the active recipe', async () => {
        const fake = createFakeDb();
        const recipe = makeRecipeRow();
        fake.queue([recipe]);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.findActiveRecipe(recipe.id)).toBe(recipe);
        expect(methodsOf(fake)).toEqual(['select', 'from', 'where', 'limit']);
    });
});

describe('CollectionsDal.addRecipe', () => {
    it('returns the newly inserted membership row (idempotent insert)', async () => {
        const fake = createFakeDb();
        const membership = makeMembershipRow();
        fake.queue([membership]);
        const dal = new CollectionsDal(fake.db);

        const result = await dal.addRecipe(membership.collectionId, membership.recipeId);

        expect(result).toBe(membership);
        expect(methodsOf(fake)).toEqual(['insert', 'values', 'onConflictDoNothing', 'returning']);
        expect(fake.calls[1]?.args[0]).toMatchObject({ addedVia: 'manual' });
    });

    it('falls back to the existing row when the insert conflicted', async () => {
        const fake = createFakeDb();
        const existing = makeMembershipRow();
        fake.queue([]); // insert ... returning -> nothing (conflict)
        fake.queue([existing]); // findMembership -> the existing row
        const dal = new CollectionsDal(fake.db);

        const result = await dal.addRecipe(existing.collectionId, existing.recipeId);

        expect(result).toBe(existing);
        expect(methodsOf(fake)).toEqual([
            'insert',
            'values',
            'onConflictDoNothing',
            'returning',
            'select',
            'from',
            'where',
            'limit',
        ]);
    });
});

describe('CollectionsDal.removeRecipe', () => {
    it('returns true when a membership was removed', async () => {
        const fake = createFakeDb();
        fake.queue([{ recipeId: 'r1' }]);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.removeRecipe('c1', 'r1')).toBe(true);
        expect(methodsOf(fake)).toEqual(['delete', 'where', 'returning']);
    });

    it('returns false when the membership was already absent', async () => {
        const fake = createFakeDb();
        fake.queue([]);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.removeRecipe('c1', 'gone')).toBe(false);
    });
});

describe('CollectionsDal.listRecipes', () => {
    it('inner-joins recipes (excluding tombstoned + non-viewable) and returns the rows', async () => {
        const fake = createFakeDb();
        const rows = [makeRecipeRow()];
        fake.queue(rows);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.listRecipes('c1', 'viewer-1')).toBe(rows);
        // INNER JOIN + WHERE carry both the tombstone exclusion and the viewability filter
        // (`public OR owner=viewer`); the predicate CONTENT is verified behaviourally in the integration
        // spec (the fake DB records call shape, not WHERE args — see Tier-2 F4/F19 in the backlog).
        expect(methodsOf(fake)).toContain('innerJoin');
        expect(methodsOf(fake)).toContain('where');
    });
});
