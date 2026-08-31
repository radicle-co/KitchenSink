/**
 * U4c — the pending re-drive substrate's READ HALF against a real PostgreSQL (migration 0037).
 *
 * ⛔ WHY THIS TIER IS MANDATORY: the aged-rows query is three claims about the DATABASE — that the
 * `($2 || ' hours')::interval` cast actually parses, that the verdict LEFT JOIN really hides a judged row,
 * and that the last-driven window keeps a freshly re-driven row out. A unit test's fake pool proves none
 * of them (`handle-sync-worker`'s lesson: the failure hides exactly at the layer the mock replaces).
 *
 * Runs against `DATABASE_URL` (a recipe database with migrations applied); skipped without it.
 */
import { afterEach, afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createRedriveReads } from '../../../src/handlers/bandDrain.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const canRun = Boolean(DATABASE_URL);

const KEY_PREFIX = 'v2:redrivetest';

describe.skipIf(!canRun)('createRedriveReads — aged verdict-less rows (integration)', () => {
    let pool: pg.Pool;
    let reads: ReturnType<typeof createRedriveReads>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        reads = createRedriveReads(pool);
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM recipe_ingredient_verifications WHERE verification_key LIKE '${KEY_PREFIX}%'`);
        await pool.query(
            `DELETE FROM recipe_ingredient_verification_redrive WHERE verification_key LIKE '${KEY_PREFIX}%'`,
        );
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Insert a redrive row with an explicit age and (optionally) a last-driven age, both in hours. */
    async function seedRow(key: string, ageHours: number, lastDrivenHoursAgo?: number): Promise<void> {
        await pool.query(
            `INSERT INTO recipe_ingredient_verification_redrive (verification_key, message, created_at, last_driven_at)
             VALUES ($1, $2::jsonb, now() - ($3 || ' hours')::interval,
                     CASE WHEN $4::text IS NULL THEN NULL ELSE now() - ($4 || ' hours')::interval END)`,
            [key, JSON.stringify({ sourceLine: key }), String(ageHours), lastDrivenHoursAgo?.toString() ?? null],
        );
    }

    it('returns aged rows oldest first, and leaves fresh rows pending quietly', async () => {
        await seedRow(`${KEY_PREFIX}-aged-older`, 200);
        await seedRow(`${KEY_PREFIX}-aged-newer`, 100);
        await seedRow(`${KEY_PREFIX}-fresh`, 1);

        const rows = await reads.agedRedrives(10);
        const keys = rows.map((row) => row.verificationKey).filter((key) => key.startsWith(KEY_PREFIX));

        expect(keys).toEqual([`${KEY_PREFIX}-aged-older`, `${KEY_PREFIX}-aged-newer`]);
    });

    it('⛔ a row whose verdict LANDED is invisible — the flip needs no write anywhere', async () => {
        await seedRow(`${KEY_PREFIX}-judged`, 200);
        await pool.query(
            `INSERT INTO recipe_ingredient_verifications
                 (verification_key, verdict, certainty, band, aspects, model_id, food_id)
             VALUES ($1, 'agree', 'high', 'verified', '{identity}', 'amazon.nova-micro-v1:0', 'food-redrive')`,
            [`${KEY_PREFIX}-judged`],
        );

        const rows = await reads.agedRedrives(10);

        expect(rows.map((row) => row.verificationKey)).not.toContain(`${KEY_PREFIX}-judged`);
    });

    it('a recently re-driven row waits out the full bound before it is asked again', async () => {
        await seedRow(`${KEY_PREFIX}-just-driven`, 200, 1);
        await seedRow(`${KEY_PREFIX}-long-driven`, 200, 100);

        const rows = await reads.agedRedrives(10);
        const keys = rows.map((row) => row.verificationKey).filter((key) => key.startsWith(KEY_PREFIX));

        expect(keys).toEqual([`${KEY_PREFIX}-long-driven`]);
    });

    it('markRedriven stamps the attempt so the next read skips the row', async () => {
        await seedRow(`${KEY_PREFIX}-marked`, 200);
        await reads.markRedriven(`${KEY_PREFIX}-marked`);

        const rows = await reads.agedRedrives(10);

        expect(rows.map((row) => row.verificationKey)).not.toContain(`${KEY_PREFIX}-marked`);
    });
});
