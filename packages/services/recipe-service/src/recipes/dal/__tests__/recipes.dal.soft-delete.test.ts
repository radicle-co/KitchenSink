/**
 * T123-test — unit tests pinning the C-007 / FR-002 soft-delete (tombstone) rules on {@link RecipesDal}.
 *
 * `recipes.dal.test.ts` (T024-test) already covers the DAL's happy-path shapes, including `softDelete`'s
 * boolean return. This spec exists because those assertions are return-value-only: deleting the
 * `isNull(recipes.deletedAt)` filter from every read, or stamping `updated_at` without `deleted_at`,
 * leaves them all green. So the tombstone rules — the ones C-007 actually turns on — are pinned here by
 * RENDERING each recorded `.where(...)` to real SQL via {@link PgDialect} and asserting the predicate is
 * present. Break the filter and these fail, which is the whole point of writing them.
 *
 * Scope note (DRY — one authoritative spec per rule): the sibling "tombstones are excluded" rules for
 * OTHER verticals live with their own DALs and are NOT duplicated here — search (T124) in
 * `search/dal/__tests__/search.dal.test.ts`, collections (T125) in
 * `collections/dal/__tests__/collections.dal.test.ts`.
 *
 * Version history (FR-002/C-007): DB rows are RETAINED after a tombstone but the recipe is "no longer
 * accessible via normal APIs" — retention is not reachability. `VersionsDal` deliberately carries no
 * tombstone filter (the rows survive for the erasure worker and S3 archive), while `VersionsService.list`
 * gates on `RecipesService.getById` and therefore 404s a tombstoned recipe. That is an API-surface
 * behavior, so it is proven end-to-end in the T126 integration spec rather than asserted against a fake
 * client here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { RecipesDal } from '../recipes.dal.js';
import type { RecipeDrizzle } from '../../../database/client.js';
import { makeFakeDrizzle, type FakeDrizzle } from '../../../__testing__/makeFakeDrizzle.js';
import { makeRecipeRow, makeRecipeStepRow } from '../../../__fixtures__/index.js';

/** A chainable, thenable query stub: builder methods return `this`; awaiting shifts one queued result. */
type FakeControl = FakeDrizzle<RecipeDrizzle>;

const createFakeDb = (): FakeControl => makeFakeDrizzle<RecipeDrizzle>();

const dialect = new PgDialect();

/** The tombstone predicate as Postgres renders it — the exact text every active-row read must carry. */
const TOMBSTONE_PREDICATE = '"recipes"."deleted_at" is null';

/**
 * Render every recorded `.where(...)` argument to real SQL text + bound params.
 *
 * Rendering (rather than reaching into Drizzle's `queryChunks`) keeps the assertion about the PREDICATE
 * the database will actually evaluate, so it survives refactors of how the condition is composed.
 */
function renderedWheres(control: FakeControl): { sql: string; params: unknown[] }[] {
    return control.calls
        .filter((call) => call.method === 'where')
        .map((call) => {
            const { sql, params } = dialect.sqlToQuery(call.args[0] as SQL);

            return { sql, params };
        });
}

/** The single `.set(...)` payload recorded for a write. */
function setPayload(control: FakeControl): Record<string, unknown> {
    const call = control.calls.find((c) => c.method === 'set');

    return call?.args[0] as Record<string, unknown>;
}

describe('RecipesDal.softDelete — the tombstone write (C-007)', () => {
    let control: FakeControl;
    let dal: RecipesDal;

    beforeEach(() => {
        control = createFakeDb();
        dal = new RecipesDal(control.db);
    });

    it('stamps deleted_at — the tombstone itself, not merely a touched updated_at', async () => {
        control.enqueue([{ id: 'r-1' }]);

        await dal.softDelete('r-1');

        const payload = setPayload(control);
        // The load-bearing assertion: a mutation that drops `deletedAt` and leaves `updatedAt` still
        // returns true (a row matched), so only inspecting the payload catches it.
        expect(payload['deletedAt']).toBeInstanceOf(Date);
        expect(payload['updatedAt']).toBeInstanceOf(Date);
        // Both stamps come from one `now`, so a tombstone's delete/update instants never disagree.
        expect(payload['deletedAt']).toBe(payload['updatedAt']);
    });

    it('tombstones only an ACTIVE row addressed by id (never re-stamps an existing tombstone)', async () => {
        control.enqueue([{ id: 'r-1' }]);

        await dal.softDelete('r-1');

        const [where] = renderedWheres(control);
        expect(where?.sql).toContain('"recipes"."id" = $1');
        expect(where?.sql).toContain(TOMBSTONE_PREDICATE);
        expect(where?.params).toEqual(['r-1']);
    });

    it('reports true when an active row was tombstoned', async () => {
        control.enqueue([{ id: 'r-1' }]);

        expect(await dal.softDelete('r-1')).toBe(true);
    });

    it('reports false when the row is already tombstoned or absent (idempotent second delete)', async () => {
        // The `deleted_at IS NULL` guard means a second DELETE matches zero rows rather than moving the
        // original tombstone's timestamp forward — the service turns this into a 404.
        control.enqueue([]);

        expect(await dal.softDelete('r-1')).toBe(false);
    });
});

describe('RecipesDal read paths exclude tombstones (C-007 / FR-002)', () => {
    let control: FakeControl;
    let dal: RecipesDal;

    beforeEach(() => {
        control = createFakeDb();
        dal = new RecipesDal(control.db);
    });

    it('findById cannot resolve a tombstoned recipe', async () => {
        control.enqueue([makeRecipeRow({ id: 'r-9' })], [makeRecipeStepRow({ recipeId: 'r-9' })], []);

        await dal.findById('r-9');

        const [where] = renderedWheres(control);
        expect(where?.sql).toContain('"recipes"."id" = $1');
        expect(where?.sql).toContain(TOMBSTONE_PREDICATE);
    });

    it('findAll scopes to the owner AND excludes tombstones on both the page and the count query', async () => {
        control.enqueue([makeRecipeRow({ id: 'a' })], [{ count: 1 }], [], []);

        await dal.findAll({ ownerId: 'owner-1', page: 1, pageSize: 10, sortBy: 'updatedAt' });

        // Both reads share one `where`; asserting on each independently stops a refactor from silently
        // dropping the filter off the count (which would report tombstones in the pagination total).
        const wheres = renderedWheres(control).filter((w) => w.sql.includes('"recipes"."owner_id"'));
        expect(wheres).toHaveLength(2);

        for (const where of wheres) {
            expect(where.sql).toContain('"recipes"."owner_id" = $1');
            expect(where.sql).toContain(TOMBSTONE_PREDICATE);
            expect(where.params).toEqual(['owner-1']);
        }
    });

    it('update cannot edit (or resurrect) a tombstoned recipe, and keeps the version compare-and-swap', async () => {
        control.enqueue([makeRecipeRow({ id: 'r-1', currentVersion: 2 })], [], []);

        await dal.update('r-1', { expectedVersion: 1, title: 'Renamed' });

        const [where] = renderedWheres(control);
        expect(where?.sql).toContain('"recipes"."id" = $1');
        expect(where?.sql).toContain(TOMBSTONE_PREDICATE);
        // The tombstone guard sits alongside the optimistic-concurrency CAS — neither may crowd the
        // other out (dropping the CAS would reopen the lost-update race T033 closes).
        expect(where?.sql).toContain('"recipes"."current_version" = $2');
        expect(where?.params).toEqual(['r-1', 1]);
    });

    it('setVisibility cannot re-expose a tombstoned recipe', async () => {
        control.enqueue([makeRecipeRow({ id: 'r-1', visibility: 'public' })], [], []);

        await dal.setVisibility('r-1', 'public');

        const [where] = renderedWheres(control);
        expect(where?.sql).toContain('"recipes"."id" = $1');
        expect(where?.sql).toContain(TOMBSTONE_PREDICATE);
    });
});
