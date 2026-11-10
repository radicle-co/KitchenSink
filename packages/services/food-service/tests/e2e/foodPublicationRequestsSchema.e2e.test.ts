/**
 * Migration 0028 against the REAL migrated database: the publication-request table (ADR-0029 §5, §7) and the removal
 * of `food_promotions`.
 *
 * Claims only the database can prove: the composite FK onto `food_versions`, the status/decision CHECK, the partial
 * unique that allows one pending request per food, the cascade from `food`, and that the old moderation queue is gone.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { makeCatalogFood } from '../__fixtures__/catalogFood.js';
import { makePool } from '../support/db.js';
import { foodDb } from '../support/roleDb.js';

const AUTHOR = '01JPUBREQAUTHOR0000000AAA';

describe('food_publication_requests (migration 0028)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = makePool();
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await foodDb().truncate();
        await makeCatalogFood(pool, { id: 'f-pr', name: 'Blend', userId: AUTHOR });

        for (const version of [1, 2]) {
            await pool.query(
                `INSERT INTO food_versions (food_id, version_number, snapshot, created_by)
                 VALUES ('f-pr', $1, '{}'::jsonb, $2)`,
                [version, AUTHOR],
            );
        }
    });

    const insert = (version: number, status: string, decided: boolean, reason: string | null): Promise<unknown> =>
        pool.query(
            `INSERT INTO food_publication_requests (food_id, food_version_number, status, decline_reason, decided_at)
             VALUES ('f-pr', $1, $2, $3, ${decided ? 'now()' : 'NULL'})`,
            [version, status, reason],
        );

    it('drops the old promotion queue', async () => {
        const rows = await pool.query(`SELECT to_regclass('public.food_promotions') AS t`);

        expect(rows.rows[0]).toEqual({ t: null });
    });

    it('has no person column: the author is derivable from food.user_id', async () => {
        const columns = await pool.query(
            `SELECT column_name FROM information_schema.columns WHERE table_name = 'food_publication_requests'`,
        );

        expect(columns.rows.map((row: { column_name: string }) => row.column_name).sort()).toEqual([
            'author_seen_at',
            'created_at',
            'decided_at',
            'decline_reason',
            'food_id',
            'food_version_number',
            'id',
            'status',
        ]);
    });

    it('accepts each coherent status/decision pairing', async () => {
        await insert(1, 'declined', true, 'Not a real food');
        await insert(1, 'approved', true, null);
        await insert(1, 'closed', true, null);
        await insert(2, 'pending', false, null);

        const rows = await pool.query(`SELECT count(*)::int AS n FROM food_publication_requests`);

        expect(rows.rows[0]).toEqual({ n: 4 });
    });

    it.each([
        ['pending that carries a decision time', 'pending', true, null],
        ['pending that carries a reason', 'pending', false, 'why'],
        ['approved with no decision time', 'approved', false, null],
        ['approved that carries a reason', 'approved', true, 'why'],
        ['declined with no reason', 'declined', true, null],
        ['closed that carries a reason', 'closed', true, 'why'],
        ['an unknown status', 'maybe', true, null],
    ])('rejects %s', async (_label, status, decided, reason) => {
        await expect(insert(1, status, decided, reason)).rejects.toThrow(/food_publication_requests_/);
    });

    it('lets only a decided request be marked seen by its author', async () => {
        await insert(1, 'closed', true, null);
        await pool.query(`UPDATE food_publication_requests SET author_seen_at = now()`);

        await insert(2, 'pending', false, null);

        await expect(
            pool.query(`UPDATE food_publication_requests SET author_seen_at = now() WHERE status = 'pending'`),
        ).rejects.toThrow(/food_publication_requests_seen_after_decision/);
    });

    it('allows one pending request per food and any number of closed ones', async () => {
        await insert(1, 'pending', false, null);

        await expect(insert(2, 'pending', false, null)).rejects.toThrow(/food_publication_requests_pending_unique/);

        await insert(2, 'closed', true, null);
        await insert(2, 'closed', true, null);
    });

    it('rejects a request for a version the food never had', async () => {
        await expect(insert(9, 'pending', false, null)).rejects.toThrow(/food_publication_requests_version_fk/);
    });

    it('cascades away with its food', async () => {
        await insert(1, 'pending', false, null);

        await pool.query(`DELETE FROM food WHERE id = 'f-pr'`);

        const rows = await pool.query(`SELECT 1 FROM food_publication_requests`);

        expect(rows.rows).toHaveLength(0);
    });
});
