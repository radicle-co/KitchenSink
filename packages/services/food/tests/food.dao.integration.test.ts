/**
 * Integration suite for {@link FoodDao} (T-105) against a real Postgres. Covers golden-record
 * aggregate read, `createByName` normalized-name dedup + terminal-row reactivation, and the guarded
 * legal status-transition set (FR-005, FR-013, FR-025, FR-028, FR-028a, FR-IDN-1).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';

import { FoodDao } from '../src/foods/dao/food.dao.js';
import { isIllegalStatusTransitionError } from '../src/foods/dao/dao.errors.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

describe.skipIf(!DATABASE_URL)('FoodDao (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let dao: FoodDao;

    beforeAll(async () => {
        pool = makePool();
        db = makeDb(pool);
        dao = new FoodDao(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
    });

    describe('createByName — normalized-name dedup (FR-005)', () => {
        it('creates a PENDING row and returns created=true on first add', async () => {
            const result = await dao.createByName({ normalizedName: 'broccoli, raw', displayName: 'Broccoli, raw' });

            expect(result.created).toBe(true);
            expect(result.reactivated).toBe(false);

            const row = await dao.getById(result.id);
            expect(row?.status).toBe('PENDING');
            expect(row?.normalizedName).toBe('broccoli, raw');
            expect(row?.name).toBe('Broccoli, raw');
        });

        it('is idempotent on normalized name — a second add returns the SAME id, created=false', async () => {
            const first = await dao.createByName({ normalizedName: 'apple', displayName: 'Apple' });
            const second = await dao.createByName({ normalizedName: 'apple', displayName: 'Apple (dup)' });

            expect(second.id).toBe(first.id);
            expect(second.created).toBe(false);
            expect(second.reactivated).toBe(false);

            const { rows } = await pool.query<{ count: string }>(
                `SELECT count(*) AS count FROM food WHERE normalized_name = 'apple'`,
            );
            expect(rows[0]?.count).toBe('1');
        });

        it('does NOT reactivate a terminal row still within its 30-day TTL', async () => {
            const created = await dao.createByName({ normalizedName: 'kale', displayName: 'Kale' });
            await pool.query(
                `UPDATE food SET status='NOT_FOUND', tombstoned_at = now() - interval '5 days' WHERE id = $1`,
                [created.id],
            );

            const again = await dao.createByName({ normalizedName: 'kale', displayName: 'Kale' });

            expect(again.id).toBe(created.id);
            expect(again.reactivated).toBe(false);
            const row = await dao.getById(created.id);
            expect(row?.status).toBe('NOT_FOUND');
        });

        it('reactivates a terminal (NOT_FOUND) row PAST its 30-day TTL → PENDING (no 23505, FR-028a)', async () => {
            const created = await dao.createByName({ normalizedName: 'quince', displayName: 'Quince' });
            await pool.query(
                `UPDATE food SET status='NOT_FOUND', tombstoned_at = now() - interval '31 days' WHERE id = $1`,
                [created.id],
            );

            const reactivated = await dao.createByName({ normalizedName: 'quince', displayName: 'Quince' });

            expect(reactivated.id).toBe(created.id);
            expect(reactivated.created).toBe(false);
            expect(reactivated.reactivated).toBe(true);
            const row = await dao.getById(created.id);
            expect(row?.status).toBe('PENDING');
            expect(row?.tombstonedAt).toBeNull();
        });

        it('reactivates a terminal (FAILED) row PAST its 30-day TTL → PENDING', async () => {
            const created = await dao.createByName({ normalizedName: 'durian', displayName: 'Durian' });
            await pool.query(
                `UPDATE food SET status='FAILED', tombstoned_at = now() - interval '60 days' WHERE id = $1`,
                [created.id],
            );

            const reactivated = await dao.createByName({ normalizedName: 'durian', displayName: 'Durian' });

            expect(reactivated.reactivated).toBe(true);
            const row = await dao.getById(created.id);
            expect(row?.status).toBe('PENDING');
        });
    });

    describe('setStatus — guarded legal transitions (FR-028a)', () => {
        it('allows PENDING → RESOLVED', async () => {
            const { id } = await dao.createByName({ normalizedName: 'pear' });
            const row = await dao.setStatus({ id, status: 'RESOLVED' });
            expect(row.status).toBe('RESOLVED');
        });

        it('sets tombstoned_at when transitioning PENDING → NOT_FOUND (TTL anchor, FR-025)', async () => {
            const { id } = await dao.createByName({ normalizedName: 'plum' });
            const row = await dao.setStatus({ id, status: 'NOT_FOUND' });
            expect(row.status).toBe('NOT_FOUND');
            expect(row.tombstonedAt).not.toBeNull();
        });

        it('clears tombstoned_at on NOT_FOUND → PENDING reactivation transition', async () => {
            const { id } = await dao.createByName({ normalizedName: 'fig' });
            await dao.setStatus({ id, status: 'NOT_FOUND' });
            const row = await dao.setStatus({ id, status: 'PENDING' });
            expect(row.status).toBe('PENDING');
            expect(row.tombstonedAt).toBeNull();
        });

        it('REJECTS an illegal transition (RESOLVED → UNRESOLVED) with rowCount=0 → IllegalStatusTransitionError', async () => {
            const { id } = await dao.createByName({ normalizedName: 'grape' });
            await dao.setStatus({ id, status: 'RESOLVED' });

            await expect(dao.setStatus({ id, status: 'UNRESOLVED' })).rejects.toSatisfy(isIllegalStatusTransitionError);
            // status unchanged after the rejected transition
            const row = await dao.getById(id);
            expect(row?.status).toBe('RESOLVED');
        });

        it('REJECTS RESOLVED → FAILED (terminal-from-resolved is not legal)', async () => {
            const { id } = await dao.createByName({ normalizedName: 'mango' });
            await dao.setStatus({ id, status: 'RESOLVED' });
            await expect(dao.setStatus({ id, status: 'FAILED' })).rejects.toSatisfy(isIllegalStatusTransitionError);
        });
    });

    describe('readGoldenRecord — aggregate assembly (FR-028, SC-013)', () => {
        it('assembles food + sources + nutrients + portions + field provenance with NO fdcId anywhere', async () => {
            const { id } = await dao.createByName({ normalizedName: 'spinach', displayName: 'Spinach, raw' });
            await pool.query(
                `INSERT INTO food_sources (id, food_id, source, external_key, item_version)
                 VALUES ('src_sp', $1, 'usda', '11457', 'v1')`,
                [id],
            );
            await pool.query(`INSERT INTO nutrient (id, name, unit) VALUES ('nut_p', 'Protein', 'g')`);
            await pool.query(
                `INSERT INTO food_nutrients (id, food_id, nutrient_id, amount, source_id)
                 VALUES ('fn_sp', $1, 'nut_p', '2.86', 'src_sp')`,
                [id],
            );
            await pool.query(
                `INSERT INTO food_portions (id, food_id, label, gram_weight, source_id)
                 VALUES ('fp_sp', $1, '1 cup', '30', 'src_sp')`,
                [id],
            );
            await pool.query(
                `INSERT INTO food_field_provenance (food_id, field, source_id) VALUES ($1, 'name', 'src_sp')`,
                [id],
            );

            const record = await dao.readGoldenRecord(id);

            expect(record).not.toBeNull();
            expect(record?.id).toBe(id);
            expect(record?.sources).toHaveLength(1);
            expect(record?.sources[0]?.externalKey).toBe('11457');
            expect(record?.nutrients).toHaveLength(1);
            expect(record?.nutrients[0]?.amount).toBe('2.86');
            expect(record?.nutrients[0]?.name).toBe('Protein');
            expect(record?.portions).toHaveLength(1);
            expect(record?.fieldProvenance).toHaveLength(1);
            // ISO-8601 string dates, never Date objects (CODING_STANDARDS).
            expect(typeof record?.createdAt).toBe('string');
            expect(JSON.stringify(record)).not.toContain('fdcId');
            expect(JSON.stringify(record)).not.toContain('fdc_id');
        });

        it('returns null for an unknown id', async () => {
            expect(await dao.readGoldenRecord('food_missing')).toBeNull();
        });
    });
});
