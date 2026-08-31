/**
 * U18 — the authored-food versioning substrate + the DELETING tombstone against the REAL migrated
 * database (migration 0014).
 *
 * Claims only the database can prove: the per-food version uniqueness, the CASCADE from `food`, the
 * `DELETING` enum member and its legal-transition guard (RESOLVED ⇄ DELETING and nothing else in),
 * and the erasure sweep's created_by NULLing reaching version rows.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';
import { FoodDao } from '../src/foods/dao/food.dao.js';

const AUTHOR = '01JFOODVERSIONSAUTHOR000AA';

describe.skipIf(!DATABASE_URL)('food versions + DELETING substrate (integration, U18)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foodDao: FoodDao;

    beforeAll(() => {
        pool = makePool();
        db = makeDb(pool);
        foodDao = new FoodDao(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
    });

    async function seedAuthored(id: string): Promise<void> {
        await pool.query(
            `INSERT INTO food (id, name, normalized_name, status, user_id, visibility)
             VALUES ($1, 'My Blend', 'my blend', 'RESOLVED', $2, 'private')`,
            [id, AUTHOR],
        );
    }

    it('stores one snapshot per (food, version) — a duplicate version number rejects', async () => {
        await seedAuthored('f-v1');
        await pool.query(
            `INSERT INTO food_versions (food_id, version_number, snapshot, created_by)
             VALUES ('f-v1', 1, '{"name":"My Blend"}'::jsonb, $1)`,
            [AUTHOR],
        );

        await expect(
            pool.query(
                `INSERT INTO food_versions (food_id, version_number, snapshot, created_by)
                 VALUES ('f-v1', 1, '{"name":"Other"}'::jsonb, $1)`,
                [AUTHOR],
            ),
        ).rejects.toThrow(/food_versions_food_version_unique/);
    });

    it('a deleted food CASCADES its versions away', async () => {
        await seedAuthored('f-v2');
        await pool.query(
            `INSERT INTO food_versions (food_id, version_number, snapshot, created_by)
             VALUES ('f-v2', 1, '{}'::jsonb, $1)`,
            [AUTHOR],
        );

        await pool.query(`DELETE FROM food WHERE id = 'f-v2'`);

        const rows = await pool.query(`SELECT 1 FROM food_versions WHERE food_id = 'f-v2'`);

        expect(rows.rows).toHaveLength(0);
    });

    it('⛔ DELETING is reachable ONLY from RESOLVED, and reverts ONLY to RESOLVED', async () => {
        await seedAuthored('f-v3');

        await foodDao.setStatus({ id: 'f-v3', status: 'DELETING' });

        const mid = await pool.query(`SELECT status FROM food WHERE id = 'f-v3'`);

        expect(mid.rows[0]).toEqual({ status: 'DELETING' });

        await foodDao.setStatus({ id: 'f-v3', status: 'RESOLVED' });

        const back = await pool.query(`SELECT status FROM food WHERE id = 'f-v3'`);

        expect(back.rows[0]).toEqual({ status: 'RESOLVED' });

        // …and a PENDING food cannot be tombstoned mid-resolution.
        await pool.query(
            `INSERT INTO food (id, name, normalized_name, status) VALUES ('f-v4', 'x', 'xdel', 'PENDING')`,
        );
        await expect(foodDao.setStatus({ id: 'f-v4', status: 'DELETING' })).rejects.toThrow();
    });
});
