/**
 * Unit tests for {@link AccountExportDal} over the chainable fake Drizzle client.
 *
 * These pin the DAL's SHAPE — which builders each read invokes and in what order, that the
 * recipe/collection reads are keyed on the owner while photos/versions/memberships reach the owner via an
 * INNER JOIN, and that each method returns the rows it read. That the JOINs and `owner_id` predicates
 * ACTUALLY isolate one owner's data from another's is real-Postgres semantics and belongs to the
 * integration tier (`__tests__/integration/account/account-export.integration.test.ts`).
 *
 * Requirement → test map:
 *
 *   - **FR-038 (owner scoping)** — every read is a keyed/joined query, never an unfiltered scan.
 *     → asserted per method (a `where` is always present; photos/versions/memberships also `innerJoin`).
 *   - **Art. 20 (faithful mirror)** — recipes are read with NO tombstone filter (all rows), versions
 *     select metadata only.
 *     → `describe('listRecipes')` / `describe('listVersions')`
 */
import { describe, it, expect } from 'vitest';

import type { RecipeDrizzle } from '../../../database/database.module.js';
import { makeFakeDrizzle, methodsOf } from '../../../__testing__/make-fake-drizzle.js';
import { AccountExportDal } from '../export.dal.js';
import {
    makeAuthorHandleRow,
    makeCollectionRow,
    makeMembershipRow,
    makePhotoRow,
    makeRatingRow,
    makeRecipeRow,
    makeVersionRow,
    FIXTURE_OWNER,
} from '../../__fixtures__/export.fixtures.js';

const createFakeDb = (): ReturnType<typeof makeFakeDrizzle<RecipeDrizzle>> => makeFakeDrizzle<RecipeDrizzle>();

describe('AccountExportDal.listRecipes', () => {
    it('reads the owner keyed, ordered, with NO tombstone filter, and returns the rows', async () => {
        const fake = createFakeDb();
        const rows = [makeRecipeRow(), makeRecipeRow({ id: 'r2', deletedAt: new Date() })];
        fake.enqueue(rows);
        const dal = new AccountExportDal(fake.db);

        await expect(dal.listRecipes(FIXTURE_OWNER)).resolves.toEqual(rows);
        // select→from→where→orderBy: a keyed read (`where`), deterministically ordered (`orderBy`), and
        // NOT gated by a tombstone predicate — the only extra clause would be a second `where`, absent here.
        expect(methodsOf(fake)).toEqual(['select', 'from', 'where', 'orderBy']);
    });
});

describe('AccountExportDal.listCollections', () => {
    it('reads the owner keyed and ordered', async () => {
        const fake = createFakeDb();
        const rows = [makeCollectionRow()];
        fake.enqueue(rows);
        const dal = new AccountExportDal(fake.db);

        await expect(dal.listCollections(FIXTURE_OWNER)).resolves.toEqual(rows);
        expect(methodsOf(fake)).toEqual(['select', 'from', 'where', 'orderBy']);
    });
});

describe('AccountExportDal.listCollectionMemberships', () => {
    it('scopes memberships to the owner via an INNER JOIN to collections', async () => {
        const fake = createFakeDb();
        const rows = [makeMembershipRow()];
        fake.enqueue(rows);
        const dal = new AccountExportDal(fake.db);

        await expect(dal.listCollectionMemberships(FIXTURE_OWNER)).resolves.toEqual(rows);
        expect(methodsOf(fake)).toEqual(['select', 'from', 'innerJoin', 'where']);
    });
});

describe('AccountExportDal.listRatings', () => {
    it('reads the owner (rater) keyed and ordered', async () => {
        const fake = createFakeDb();
        const rows = [makeRatingRow()];
        fake.enqueue(rows);
        const dal = new AccountExportDal(fake.db);

        await expect(dal.listRatings(FIXTURE_OWNER)).resolves.toEqual(rows);
        expect(methodsOf(fake)).toEqual(['select', 'from', 'where', 'orderBy']);
    });
});

describe('AccountExportDal.listPhotos', () => {
    it('scopes photos to the owner via an INNER JOIN to recipes', async () => {
        const fake = createFakeDb();
        const rows = [makePhotoRow()];
        fake.enqueue(rows);
        const dal = new AccountExportDal(fake.db);

        await expect(dal.listPhotos(FIXTURE_OWNER)).resolves.toEqual(rows);
        expect(methodsOf(fake)).toEqual(['select', 'from', 'innerJoin', 'where']);
    });
});

describe('AccountExportDal.listVersions', () => {
    it('scopes versions to the owner via an INNER JOIN to recipes (metadata select)', async () => {
        const fake = createFakeDb();
        const rows = [makeVersionRow()];
        fake.enqueue(rows);
        const dal = new AccountExportDal(fake.db);

        await expect(dal.listVersions(FIXTURE_OWNER)).resolves.toEqual(rows);
        expect(methodsOf(fake)).toEqual(['select', 'from', 'innerJoin', 'where']);
    });
});

describe('AccountExportDal.listAuthorHandles', () => {
    it('reads the owner keyed', async () => {
        const fake = createFakeDb();
        const rows = [makeAuthorHandleRow()];
        fake.enqueue(rows);
        const dal = new AccountExportDal(fake.db);

        await expect(dal.listAuthorHandles(FIXTURE_OWNER)).resolves.toEqual(rows);
        expect(methodsOf(fake)).toEqual(['select', 'from', 'where']);
    });
});
