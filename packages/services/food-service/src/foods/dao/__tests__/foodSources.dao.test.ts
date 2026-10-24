/**
 * `FoodSourcesDao.findCatalogFoodByBarcode` — the barcode crosswalk the catalog search unshifts (plan 002 S3,
 * property 2), rendered through drizzle's `PgDialect` exactly as the driver receives it.
 *
 * The catalog search's answer is shared across every caller at the edge (ADR-0020), so the crosswalk hit must be a
 * row any caller may see — a catalog row, live and `RESOLVED` — and the predicate must sit IN the query: filtered
 * after a `LIMIT 1`, an authored row with the same barcode could take the only slot from the catalog row.
 *
 * What the database does with that predicate is `tests/e2e/catalogSearchPrivacy.e2e.test.ts`'s (LOCAL).
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import type { FoodWriter } from '../../../database/unitOfWork.js';
import { FoodSourcesDao } from '../foodSources.dao.js';

const dialect = new PgDialect();

/** What one `findCatalogFoodByBarcode` or `findCatalogFoodById` call handed the query builder. */
interface Captured {
    where?: { readonly sql: string; readonly params: readonly unknown[] };
    limit?: number;
}

/**
 * A query-builder double that records the `WHERE` and the `LIMIT`, and answers `rows`.
 *
 * @param rows - What the read returns.
 * @returns The DAO over the double, and what it captured.
 */
function makeDao(rows: readonly unknown[]): { dao: FoodSourcesDao; captured: Captured } {
    const captured: Captured = {};
    const chain = {
        from: () => chain,
        where: (condition: SQL) => {
            captured.where = dialect.sqlToQuery(condition);

            return chain;
        },
        limit: (count: number) => {
            captured.limit = count;

            return Promise.resolve(rows);
        },
    };
    const db = { select: () => chain } as unknown as FoodWriter;

    return { dao: new FoodSourcesDao(db), captured };
}

describe('FoodSourcesDao.findCatalogFoodByBarcode (plan 002 S3, property 2)', () => {
    it('⛔ asks for a live, RESOLVED catalog row carrying the barcode, in ONE predicate before the LIMIT', async () => {
        const { dao, captured } = makeDao([]);

        await dao.findCatalogFoodByBarcode('0049000028911');

        expect(captured.where?.sql).toBe(
            '("food"."barcode" = $1 and "food"."user_id" is null and "food"."retired_at" is null and ' +
                '"food"."status" = $2)',
        );
        expect(captured.where?.params).toStrictEqual(['0049000028911', 'RESOLVED']);
        expect(captured.limit).toBe(1);
    });

    it('answers the food id and its name, which is all the crosswalk hit needs', async () => {
        const { dao } = makeDao([{ id: 'f1', name: 'cereal bar' }]);

        await expect(dao.findCatalogFoodByBarcode('0012000161155')).resolves.toStrictEqual({
            id: 'f1',
            name: 'cereal bar',
        });
    });

    it('answers undefined when no catalog row carries the barcode', async () => {
        const { dao } = makeDao([]);

        await expect(dao.findCatalogFoodByBarcode('9999999999999')).resolves.toBeUndefined();
    });
});

/**
 * The USDA-key crosswalk resolves a key through the owner reader, which keeps to the catalog in TypeScript. The root it
 * names is then read again under the barcode's predicate, so the shared route publishes a key's root only when the SQL
 * itself admits it (sec-aud-1 S3 review, F1).
 */
describe('FoodSourcesDao.findCatalogFoodById (plan 002 S3, the USDA-key crosswalk)', () => {
    it('⛔ asks for a live, RESOLVED catalog row with that id, under the barcode lookup’s own predicate', async () => {
        const { dao, captured } = makeDao([]);

        await dao.findCatalogFoodById('01JCATA10GF00D000000000000');

        expect(captured.where?.sql).toBe(
            '("food"."id" = $1 and "food"."user_id" is null and "food"."retired_at" is null and "food"."status" = $2)',
        );
        expect(captured.where?.params).toStrictEqual(['01JCATA10GF00D000000000000', 'RESOLVED']);
        expect(captured.limit).toBe(1);
    });

    it('answers the food id and its name', async () => {
        const { dao } = makeDao([{ id: 'f1', name: 'beef brisket' }]);

        await expect(dao.findCatalogFoodById('f1')).resolves.toStrictEqual({ id: 'f1', name: 'beef brisket' });
    });

    it('answers undefined when the id names no live, RESOLVED catalog row', async () => {
        const { dao } = makeDao([]);

        await expect(dao.findCatalogFoodById('f-authored')).resolves.toBeUndefined();
    });
});
