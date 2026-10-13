/**
 * W-11 — {@link CollectionsDal.memberSummaries} over a mocked `db.execute` (no database).
 *
 * Pins the SHAPE of the two reads (compiled through the production Postgres dialect, like `search.dal.test.ts`)
 * and the row mapping. That the predicate actually EXCLUDES another cook's private/draft/deleted member is only
 * observable against a database: `tests/e2e/collections/memberSummaries.e2e.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import type { RecipeDrizzle } from '../../../database/database.module.js';
import { CollectionsDal } from '../collections.dal.js';

const dialect = new PgDialect();

/** The text and bound parameters of a statement handed to `db.execute`, via the production dialect. */
function compiled(value: unknown): { sql: string; params: unknown[] } {
    const query = dialect.sqlToQuery(value as Parameters<PgDialect['sqlToQuery']>[0]);

    return { sql: query.sql, params: query.params };
}

/** A DAL over a `db.execute` that answers the count read, then the cover read. */
function makeDal(counts: unknown[], covers: unknown[]): { dal: CollectionsDal; execute: ReturnType<typeof vi.fn> } {
    const execute = vi.fn().mockResolvedValueOnce({ rows: counts }).mockResolvedValueOnce({ rows: covers });

    return { dal: new CollectionsDal({ execute } as unknown as RecipeDrizzle), execute };
}

describe('CollectionsDal.memberSummaries', () => {
    it('issues no statement for no collections', async () => {
        const { dal, execute } = makeDal([], []);

        expect(await dal.memberSummaries([], 'viewer-1')).toEqual(new Map());
        expect(execute).not.toHaveBeenCalled();
    });

    it('counts and picks covers through the SAME viewer-scoped read predicate as the member list', async () => {
        const { dal, execute } = makeDal([], []);

        await dal.memberSummaries(['c1', 'c2'], 'viewer-1');

        for (const call of execute.mock.calls) {
            const { sql, params } = compiled(call[0]);

            // Tombstone + visibility + draft terms: another cook's private or draft member is never counted
            // or shown, even though the junction row survives.
            expect(sql).toContain('"deleted_at" is null');
            expect(sql).toContain('"visibility" =');
            expect(sql).toContain('"status" =');
            expect(sql).toContain('"recipe_collections"."collection_id" in');
            expect(params).toEqual(expect.arrayContaining(['c1', 'c2', 'viewer-1']));
        }
    });

    it('bounds the covers to four per collection, in membership order, from the shared cover rule', async () => {
        const { dal, execute } = makeDal([], []);

        await dal.memberSummaries(['c1'], 'viewer-1');

        const { sql } = compiled(execute.mock.calls[1]![0]);

        expect(sql).toMatch(/row_number\(\) OVER \(\s*PARTITION BY/u);
        expect(sql).toContain('added_at');
        expect(sql).toMatch(/member_rank <= \$\d+/u);
        expect(compiled(execute.mock.calls[1]![0]).params).toContain(4);
        // The thumbnail-else-original rule is the search read's own (one definition, `coverPhotoLateral`).
        expect(sql).toContain('COALESCE(p.thumbnail_key, p.s3_key)');
    });

    it('maps counts and ordered cover keys per collection; a collection with no members is absent', async () => {
        const { dal } = makeDal(
            [
                // node-postgres hands bigint/int8 counts back as strings.
                { collection_id: 'c1', member_count: '3' },
                { collection_id: 'c2', member_count: 1 },
            ],
            [
                { collection_id: 'c1', cover_key: 'k1' },
                { collection_id: 'c1', cover_key: 'k2' },
            ],
        );

        const summaries = await dal.memberSummaries(['c1', 'c2', 'c3'], 'viewer-1');

        expect(summaries.get('c1')).toEqual({ recipeCount: 3, coverKeys: ['k1', 'k2'] });
        expect(summaries.get('c2')).toEqual({ recipeCount: 1, coverKeys: [] });
        expect(summaries.has('c3')).toBe(false);
    });
});
