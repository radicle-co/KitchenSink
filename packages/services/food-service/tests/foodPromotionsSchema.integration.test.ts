/**
 * U12 (0015) — the promotion moderation queue's SCHEMA, against a real migrated Postgres. A unit test
 * cannot observe a migration that did not apply; what this suite pins is the queue's own guarantees:
 *
 *   - the decision-coherence CHECK makes illegal states unrepresentable (an approved row without a
 *     canonical, a pending row with one, a decision without a timestamp);
 *   - ONE pending candidacy per normalized name (the partial unique) — a concurrent double-trigger is
 *     an ON CONFLICT no-op, never two review items for one decision;
 *   - the status CHECK admits exactly the three states the admin routes speak.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { DATABASE_URL, makePool, resetSchema } from './support/db.js';

describe.skipIf(!DATABASE_URL)('food_promotions schema (0015, integration)', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
        pool = makePool();
        await resetSchema(pool);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await pool.query('TRUNCATE food_promotions');
    });

    async function insert(overrides: Record<string, unknown> = {}): Promise<void> {
        const row = {
            normalized_name: 'quinoa blend',
            candidate_food_ids: JSON.stringify(['f_a', 'f_b']),
            data_fingerprint: 'a'.repeat(64),
            status: 'pending',
            canonical_food_id: null,
            decided_at: null,
            ...overrides,
        };

        await pool.query(
            `INSERT INTO food_promotions
                 (normalized_name, candidate_food_ids, data_fingerprint, status, canonical_food_id, decided_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                row['normalized_name'],
                row['candidate_food_ids'],
                row['data_fingerprint'],
                row['status'],
                row['canonical_food_id'],
                row['decided_at'],
            ],
        );
    }

    it('accepts the three legal shapes: pending, approved-with-canonical, rejected-without', async () => {
        await insert();
        await insert({
            normalized_name: 'approved name',
            status: 'approved',
            canonical_food_id: 'f_a',
            decided_at: new Date().toISOString(),
        });
        await insert({
            normalized_name: 'rejected name',
            status: 'rejected',
            decided_at: new Date().toISOString(),
        });

        const { rows } = await pool.query(`SELECT count(*)::int AS n FROM food_promotions`);

        expect(rows[0]?.n).toBe(3);
    });

    it('⛔ REFUSES an approved row without a canonical — the decision-coherence CHECK', async () => {
        await expect(insert({ status: 'approved', decided_at: new Date().toISOString() })).rejects.toThrow(
            /food_promotions_decision_coherent/,
        );
    });

    it('⛔ REFUSES a pending row that already names a canonical or a decision time', async () => {
        await expect(insert({ canonical_food_id: 'f_a' })).rejects.toThrow(/food_promotions_decision_coherent/);
        await expect(insert({ decided_at: new Date().toISOString() })).rejects.toThrow(
            /food_promotions_decision_coherent/,
        );
    });

    it('⛔ REFUSES a status outside the three the admin routes speak', async () => {
        // Either CHECK may report first: the coherence constraint enumerates the same three states as its
        // disjuncts, so an unknown status fails both. What is pinned is REFUSAL by a named constraint.
        await expect(insert({ status: 'published' })).rejects.toThrow(
            /food_promotions_status_valid|food_promotions_decision_coherent/,
        );
    });

    it('⛔ ONE pending candidacy per name — the partial unique; decided rows do not block a new one', async () => {
        await insert();
        await expect(insert()).rejects.toThrow(/food_promotions_pending_name_unique/);

        // A REJECTED row under the same name does not hold the slot — re-candidacy with new data may queue.
        await pool.query(
            `UPDATE food_promotions SET status = 'rejected', decided_at = now() WHERE normalized_name = $1`,
            ['quinoa blend'],
        );
        await expect(insert()).resolves.toBeUndefined();
    });
});
