/**
 * T039-test — unit tests for {@link CollectionsDal} over a chainable fake Drizzle client.
 *
 * The fake records every builder call and resolves a FIFO queue of canned results when a chain is
 * awaited, so these tests pin the DAL's SHAPE — which builders it invokes and how it maps rows — without
 * a database. The real SQL semantics (tombstone exclusion actually filtering, `ON CONFLICT` idempotency,
 * no-cascade delete) are asserted against Docker Postgres in
 * `__tests__/integration/collections/crud.integration.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { RecipeErrorCode } from '@kitchensink/recipe-core';

import type { RecipeDrizzle } from '../../../database/database.module.js';
import { makeFakeDrizzle, methodsOf } from '../../../__testing__/makeFakeDrizzle.js';
import { isRecipeDomainError } from '../../../recipes/recipe.error.js';
import { makeCollectionRow, makeMembershipRow, makeRecipeRow } from '../../__fixtures__/collections.fixtures.js';
import { CollectionsDal } from '../collections.dal.js';

const createFakeDb = (): ReturnType<typeof makeFakeDrizzle<RecipeDrizzle>> => makeFakeDrizzle<RecipeDrizzle>();

describe('CollectionsDal.create', () => {
    it('inserts the collection and returns the persisted row', async () => {
        const fake = createFakeDb();
        const row = makeCollectionRow();
        fake.enqueue([row]);
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
        fake.enqueue([row]);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.findById(row.id)).toBe(row);
        expect(methodsOf(fake)).toEqual(['select', 'from', 'where', 'limit']);
    });

    it('returns undefined when absent', async () => {
        const fake = createFakeDb();
        fake.enqueue([]);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.findById('missing')).toBeUndefined();
    });
});

describe('CollectionsDal.listByOwner', () => {
    it('returns the page rows plus the unpaged total', async () => {
        const fake = createFakeDb();
        const rows = [makeCollectionRow({ id: 'a' }), makeCollectionRow({ id: 'b' })];
        fake.enqueue(rows);
        fake.enqueue([{ value: 5 }]);
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

describe('CollectionsDal.countByOwner (REQ-049b cap read)', () => {
    it("returns the owner's collection count", async () => {
        const fake = createFakeDb();
        fake.enqueue([{ value: 7 }]);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.countByOwner('owner-1')).toBe(7);
        expect(methodsOf(fake)).toEqual(['select', 'from', 'where']);
    });

    it('returns 0 when the owner has no collections', async () => {
        const fake = createFakeDb();
        fake.enqueue([]);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.countByOwner('owner-1')).toBe(0);
    });

    it('coerces the driver-returned count to a number', async () => {
        const fake = createFakeDb();
        // Postgres COUNT(*) comes back as a string over node-postgres; the DAL must coerce it.
        fake.enqueue([{ value: '50' }]);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.countByOwner('owner-1')).toBe(50);
    });
});

describe('CollectionsDal.createIfUnderCap (REQ-049b — atomic cap enforcement)', () => {
    it('takes the advisory lock, counts, and inserts — all inside one transaction — when under the cap', async () => {
        const fake = createFakeDb();
        const row = makeCollectionRow();
        // COUNT (7 existing) -> INSERT returning. `execute` (the advisory lock) does not consume the queue.
        fake.enqueue([{ value: 7 }], [row]);
        const dal = new CollectionsDal(fake.db);

        const result = await dal.createIfUnderCap(
            { ownerId: 'owner-1', name: 'Weeknight Dinners', visibility: 'private' },
            50,
        );

        expect(result).toBe(row);
        // The advisory lock (`execute`) runs BEFORE the COUNT, which runs BEFORE the INSERT — the exact
        // ordering that closes the TOCTOU (see the method's own doc for why order matters here).
        expect(methodsOf(fake)).toEqual(['execute', 'select', 'from', 'where', 'insert', 'values', 'returning']);
        expect(fake.calls[5]?.args[0]).toMatchObject({ ownerId: 'owner-1', name: 'Weeknight Dinners' });
    });

    it('throws COLLECTION_LIMIT_REACHED (and does NOT insert) when the owner already holds the cap', async () => {
        const fake = createFakeDb();
        fake.enqueue([{ value: 50 }]);
        const dal = new CollectionsDal(fake.db);

        let caught: unknown;

        try {
            await dal.createIfUnderCap({ ownerId: 'owner-1', name: 'Fifty-first', visibility: 'private' }, 50);
        } catch (error) {
            caught = error;
        }

        expect(isRecipeDomainError(caught) && caught.code).toBe(RecipeErrorCode.COLLECTION_LIMIT_REACHED);
        expect(fake.calls.some((call) => call.method === 'insert')).toBe(false);
    });

    it('also rejects when the count is already past the cap (defense in depth)', async () => {
        const fake = createFakeDb();
        fake.enqueue([{ value: 51 }]);
        const dal = new CollectionsDal(fake.db);

        await expect(
            dal.createIfUnderCap({ ownerId: 'owner-1', name: 'Way over', visibility: 'private' }, 50),
        ).rejects.toSatisfy(
            (err: unknown) => isRecipeDomainError(err) && err.code === RecipeErrorCode.COLLECTION_LIMIT_REACHED,
        );
    });
});

describe('CollectionsDal.update', () => {
    it('always bumps updated_at and sets only the provided fields', async () => {
        const fake = createFakeDb();
        const updated = makeCollectionRow({ name: 'Renamed' });
        fake.enqueue([updated]);
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
        fake.enqueue([]);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.update('missing', { visibility: 'public' })).toBeUndefined();
    });
});

describe('CollectionsDal.touchLastPulled', () => {
    it('sets last_pulled_at and updated_at to the current time and returns the updated row', async () => {
        const fake = createFakeDb();
        const touched = makeCollectionRow({ lastPulledAt: new Date('2026-07-24T12:00:00.000Z') });
        fake.enqueue([touched]);
        const dal = new CollectionsDal(fake.db);

        const result = await dal.touchLastPulled(touched.id);

        expect(result).toBe(touched);
        expect(methodsOf(fake)).toEqual(['update', 'set', 'where', 'returning']);
        const setArg = fake.calls[1]?.args[0] as Record<string, unknown>;
        expect(setArg['lastPulledAt']).toBeInstanceOf(Date);
        expect(setArg['updatedAt']).toBeInstanceOf(Date);
    });

    it('throws when the id does not exist (no row to update)', async () => {
        const fake = createFakeDb();
        fake.enqueue([]);
        const dal = new CollectionsDal(fake.db);

        await expect(dal.touchLastPulled('missing')).rejects.toThrow(
            'touchLastPulled: no collection row found to update.',
        );
    });
});

describe('CollectionsDal.deleteById', () => {
    it('returns true when a row was removed', async () => {
        const fake = createFakeDb();
        fake.enqueue([{ id: 'c1' }]);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.deleteById('c1')).toBe(true);
        expect(methodsOf(fake)).toEqual(['delete', 'where', 'returning']);
    });

    it('returns false when nothing matched', async () => {
        const fake = createFakeDb();
        fake.enqueue([]);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.deleteById('missing')).toBe(false);
    });
});

describe('CollectionsDal.findActiveRecipe', () => {
    it('joins on deleted_at IS NULL and returns the active recipe', async () => {
        const fake = createFakeDb();
        const recipe = makeRecipeRow();
        fake.enqueue([recipe]);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.findActiveRecipe(recipe.id)).toBe(recipe);
        expect(methodsOf(fake)).toEqual(['select', 'from', 'where', 'limit']);
    });
});

describe('CollectionsDal.addRecipe', () => {
    // REWRITTEN for analytics plan U3: the return gained `created`, because the service must fire a
    // `recipe_saved` event ONLY for a genuinely new membership — a replayed add minting save credit
    // would diverge save_count from this table permanently (R11's reconcilability).
    it('returns the newly inserted membership row with created: true (idempotent insert)', async () => {
        const fake = createFakeDb();
        const membership = makeMembershipRow();
        fake.enqueue([membership]);
        const dal = new CollectionsDal(fake.db);

        const result = await dal.addRecipe(membership.collectionId, membership.recipeId);

        expect(result.row).toBe(membership);
        expect(result.created).toBe(true);
        expect(methodsOf(fake)).toEqual(['insert', 'values', 'onConflictDoNothing', 'returning']);
        expect(fake.calls[1]?.args[0]).toMatchObject({ addedVia: 'manual' });
    });

    it('falls back to the existing row with created: false when the insert conflicted', async () => {
        const fake = createFakeDb();
        const existing = makeMembershipRow();
        fake.enqueue([]); // insert ... returning -> nothing (conflict)
        fake.enqueue([existing]); // findMembership -> the existing row
        const dal = new CollectionsDal(fake.db);

        const result = await dal.addRecipe(existing.collectionId, existing.recipeId);

        expect(result.row).toBe(existing);
        expect(result.created).toBe(false);
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

describe('CollectionsDal.addRecipes (S-R1 — bulk membership seed)', () => {
    it('inserts N membership rows in ONE insert statement, with onConflictDoNothing idempotency', async () => {
        const fake = createFakeDb();
        const rows = [
            makeMembershipRow({ recipeId: 'r1', addedVia: 'clone_seed' }),
            makeMembershipRow({ recipeId: 'r2', addedVia: 'clone_seed' }),
            makeMembershipRow({ recipeId: 'r3', addedVia: 'clone_seed' }),
        ];
        fake.enqueue(rows);
        const dal = new CollectionsDal(fake.db);

        const result = await dal.addRecipes('c1', ['r1', 'r2', 'r3'], 'clone_seed');

        expect(result).toBe(rows);
        // ONE `insert` call (not one per recipe) — the whole point of the bulk path (kills the N+1).
        expect(methodsOf(fake)).toEqual(['insert', 'values', 'onConflictDoNothing', 'returning']);
        expect(fake.calls.filter((call) => call.method === 'insert')).toHaveLength(1);
        // All N rows passed to a SINGLE `.values([...])` call, each carrying the given provenance.
        const valuesArg = fake.calls[1]?.args[0] as Array<Record<string, unknown>>;
        expect(valuesArg).toHaveLength(3);
        expect(valuesArg).toEqual([
            { collectionId: 'c1', recipeId: 'r1', addedVia: 'clone_seed' },
            { collectionId: 'c1', recipeId: 'r2', addedVia: 'clone_seed' },
            { collectionId: 'c1', recipeId: 'r3', addedVia: 'clone_seed' },
        ]);
    });

    it('is a no-op (no insert call at all) when given an empty recipe id list', async () => {
        const fake = createFakeDb();
        const dal = new CollectionsDal(fake.db);

        const result = await dal.addRecipes('c1', [], 'pull');

        expect(result).toEqual([]);
        expect(methodsOf(fake)).toEqual([]);
    });

    it('accepts an optional tx handle so it can enlist in a caller-supplied Unit-of-Work', async () => {
        const fake = createFakeDb();
        const outerFake = createFakeDb();
        const rows = [makeMembershipRow({ recipeId: 'r1', addedVia: 'pull' })];
        outerFake.enqueue(rows);
        // Construct the DAL over one (unused) db, but pass a DIFFERENT fake as the tx — proves the write
        // goes through the passed tx, not `this.db`, when one is supplied.
        const dal = new CollectionsDal(fake.db);

        const result = await dal.addRecipes('c1', ['r1'], 'pull', outerFake.db);

        expect(result).toBe(rows);
        expect(methodsOf(fake)).toEqual([]); // nothing ran against the DAL's own db
        expect(methodsOf(outerFake)).toEqual(['insert', 'values', 'onConflictDoNothing', 'returning']);
    });
});

describe('CollectionsDal.removeRecipe', () => {
    it('returns true when a membership was removed', async () => {
        const fake = createFakeDb();
        fake.enqueue([{ recipeId: 'r1' }]);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.removeRecipe('c1', 'r1')).toBe(true);
        expect(methodsOf(fake)).toEqual(['delete', 'where', 'returning']);
    });

    it('returns false when the membership was already absent', async () => {
        const fake = createFakeDb();
        fake.enqueue([]);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.removeRecipe('c1', 'gone')).toBe(false);
    });
});

describe('CollectionsDal.listRecipes', () => {
    it('inner-joins recipes (excluding tombstoned + non-viewable) and returns the rows', async () => {
        const fake = createFakeDb();
        const rows = [{ ...makeRecipeRow(), addedVia: 'manual' as const }];
        fake.enqueue(rows);
        const dal = new CollectionsDal(fake.db);

        expect(await dal.listRecipes('c1', 'viewer-1')).toEqual(rows);
        // INNER JOIN + WHERE carry both the tombstone exclusion and the viewability filter
        // (`public OR owner=viewer`); the predicate CONTENT is verified behaviourally in the integration
        // spec (the fake DB records call shape, not WHERE args — see Tier-2 F4/F19 in the backlog).
        expect(methodsOf(fake)).toContain('innerJoin');
        expect(methodsOf(fake)).toContain('where');
    });

    // W5 Task 4: the source-indicator checkbox (C3) needs each member's provenance. `listRecipes` must
    // project `recipeCollections.addedVia` alongside the recipe columns — not just the bare recipe row —
    // and hand each provenance value through untouched (manual / clone_seed / pull).
    it("selects addedVia alongside the recipe columns and returns each member's provenance untouched", async () => {
        const fake = createFakeDb();
        const rows = [
            { ...makeRecipeRow({ id: 'r-manual' }), addedVia: 'manual' as const },
            { ...makeRecipeRow({ id: 'r-clone' }), addedVia: 'clone_seed' as const },
            { ...makeRecipeRow({ id: 'r-pull' }), addedVia: 'pull' as const },
        ];
        fake.enqueue(rows);
        const dal = new CollectionsDal(fake.db);

        const result = await dal.listRecipes('c1', 'viewer-1');

        expect(result.map((row) => ({ id: row.id, addedVia: row.addedVia }))).toEqual([
            { id: 'r-manual', addedVia: 'manual' },
            { id: 'r-clone', addedVia: 'clone_seed' },
            { id: 'r-pull', addedVia: 'pull' },
        ]);
        // The select projection must carry `addedVia` through, not just the bare recipe columns — this
        // is the part that regresses if someone reverts to `select(getTableColumns(recipes))`.
        expect(fake.calls[0]).toMatchObject({ method: 'select' });
        const selectArg = fake.calls[0]?.args[0] as Record<string, unknown>;
        expect(selectArg).toHaveProperty('addedVia');
        expect(methodsOf(fake)).toContain('innerJoin');
        expect(methodsOf(fake)).toContain('where');
    });
});
