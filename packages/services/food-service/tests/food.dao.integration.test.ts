/**
 * Integration suite for {@link FoodDao} (T-105) against a real Postgres. Covers golden-record
 * aggregate read, `createByName` normalized-name dedup + terminal-row reactivation, and the guarded
 * legal status-transition set (FR-005, FR-013, FR-025, FR-028, FR-028a, FR-IDN-1).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { FoodDao } from '../src/foods/dao/food.dao.js';
import { isIllegalStatusTransitionError } from '../src/foods/dao/dao.errors.js';
import { withTransaction } from '../src/database/unitOfWork.js';
import { makeDb, makePool, type TestDb } from './support/db.js';
import { foodDb, hasTestDatabase } from './support/roleDb.js';

describe.skipIf(!hasTestDatabase)('FoodDao (integration)', () => {
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
        await foodDb().truncate();
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

        /**
         * T-150 — the tombstone TTL is CONFIGURED (`FOOD_NOT_FOUND_TTL_DAYS`), not the literal 30 days the
         * statement used to carry. Lowering it is the lever an operator pulls to let a batch that failed
         * against a broken upstream be re-attempted sooner; before this it did nothing at all, silently.
         *
         * A fresh `FoodDao` is built per case because the TTL is resolved at construction.
         */
        describe('the configured tombstone TTL (FR-025)', () => {
            afterEach(() => {
                vi.unstubAllEnvs();
            });

            it('reactivates a 10-day-old tombstone under a 5-day TTL (the default 30 would not)', async () => {
                const created = await dao.createByName({ normalizedName: 'loquat' });
                await pool.query(
                    `UPDATE food SET status='NOT_FOUND', tombstoned_at = now() - interval '10 days' WHERE id = $1`,
                    [created.id],
                );

                vi.stubEnv('FOOD_NOT_FOUND_TTL_DAYS', '5');
                const result = await new FoodDao(db).createByName({ normalizedName: 'loquat' });

                expect(result.id).toBe(created.id);
                expect(result.reactivated).toBe(true);

                const row = await dao.getById(created.id);
                expect(row?.status).toBe('PENDING');
                // The TTL gates every arm of the upsert, so the anchor is cleared with the status.
                expect(row?.tombstonedAt).toBeNull();
            });

            it('holds a 40-day-old tombstone under a 90-day TTL (the default 30 would release it)', async () => {
                const created = await dao.createByName({ normalizedName: 'medlar' });
                await pool.query(
                    `UPDATE food SET status='NOT_FOUND', tombstoned_at = now() - interval '40 days' WHERE id = $1`,
                    [created.id],
                );

                vi.stubEnv('FOOD_NOT_FOUND_TTL_DAYS', '90');
                const result = await new FoodDao(db).createByName({ normalizedName: 'medlar' });

                expect(result.reactivated).toBe(false);
                expect((await dao.getById(created.id))?.status).toBe('NOT_FOUND');
            });
        });
    });

    describe('the Unit-of-Work seam — a DAO enlists in a transaction', () => {
        it('⛔ takes an open transaction with NO cast, and rolls back with it', async () => {
            // ⛔ THE PROPERTY THE CAST WAS HIDING. A DAO used to take the concrete client, so enlisting one in
            // a transaction meant `tx as unknown as FoodDrizzle` — a claim the type system could no longer
            // check, duplicated in two files, one of which called itself "the single, documented narrowing
            // point" while the other performed the same cast inline. `FoodWriter` is structural, so the
            // transaction satisfies it outright and this test compiles only because the seam exists.
            //
            // ⚠️ Rollback is the ASSERTION, not decoration: a DAO that was handed the base client instead of
            // the transaction would write through and survive the rollback, which is precisely the bug a cast
            // between the two can cause and cannot detect.
            const { id } = await dao.createByName({ normalizedName: 'tarragon' });

            await expect(
                withTransaction(db, async (tx) => {
                    await new FoodDao(tx).setStatus({ id, status: 'RESOLVED' });

                    throw new Error('roll back');
                }),
            ).rejects.toThrow('roll back');

            const after = await dao.readGoldenRecord(id);

            expect(after?.status).toBe('PENDING');
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

        it('⛔ `from` NARROWS the prior set — a row that left the observed status is refused', async () => {
            // ⛔ The reason this exists: `corroborateFood` READS the row, sees `PENDING`, and then writes
            // `RESOLVED`. `LEGAL_PRIORS.RESOLVED` contains `UNRESOLVED`, so a row that moved PENDING →
            // UNRESOLVED between those two statements — a legal move the disambiguation path makes — was
            // completed anyway: the food is published as resolved having never been disambiguated, and
            // nothing downstream can tell. `from` turns that check-then-act into a compare-and-set by
            // carrying the status the caller actually OBSERVED into the guarded UPDATE.
            const { id } = await dao.createByName({ normalizedName: 'chicory' });

            await dao.setStatus({ id, status: 'UNRESOLVED' });

            // `UNRESOLVED` is a legal prior for `RESOLVED`, so WITHOUT `from` this write would succeed.
            await expect(dao.setStatus({ id, status: 'RESOLVED', from: ['PENDING'] })).rejects.toSatisfy(
                isIllegalStatusTransitionError,
            );

            const after = await dao.readGoldenRecord(id);

            expect(after?.status).toBe('UNRESOLVED');
        });

        it('`from` can only NARROW — it never admits a transition the legal matrix forbids', async () => {
            // Otherwise `from` would be a bypass for FR-028a rather than a tightening of it: a caller could
            // name any prior it liked and reach a target the matrix does not allow from there.
            const { id } = await dao.createByName({ normalizedName: 'salsify' });

            await dao.setStatus({ id, status: 'RESOLVED' });

            await expect(dao.setStatus({ id, status: 'UNRESOLVED', from: ['RESOLVED'] })).rejects.toSatisfy(
                isIllegalStatusTransitionError,
            );
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
