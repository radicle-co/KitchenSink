/**
 * Analytics plan U2 — the erasure sweep ANONYMIZES `analytics_events`, against a REAL Postgres.
 *
 * Origin KD4/AE4: on account erasure the event rows SURVIVE — `user_id` nulled AND `query_text`
 * blanked — and every folded count in `recipe_impact_signals` is untouched. Deliberately STRICTER than
 * ADR-0027's keep-the-phrase posture, by ruling: the typed search query is the user's own words, so it
 * goes with the id (0043's pair CHECK makes the pairing structural).
 *
 * ⛔ A unit test over the emitted SQL cannot prove the two halves that matter here: that the counts
 * survive depends on 0043 shipping NO UPDATE trigger (a re-fold on the anonymizing UPDATE would corrupt
 * lifetime history invisibly), and that the CHECK admits the anonymized shape depends on the real
 * constraint. Both are only observable against the migrated database.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { eraseRecipeRows } from '../../../src/handlers/accountErasureWorker.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const canRun = Boolean(DATABASE_URL);

/** The cook whose account is erased. */
const USER_ERASED = '01JU2ANERASE00USERERASED0A';

/** A bystander cook whose events must be untouched. */
const USER_BYSTANDER = '01JU2ANERASE00USERBYSTAND0';

/** The recipe both cooks acted on — its counts must not move. */
const RECIPE_ID = '66666666-6666-4666-8666-000000000b01';

/** Payload marker cleanup keys on — anonymization strips every natural column this suite seeds. */
const PROBE = '{"probe": "u2-erasure"}';

describe.skipIf(!canRun)('analytics U2 — erasure anonymizes events, counts survive (KD4/AE4)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = drizzle(pool);
    });

    afterEach(async () => {
        // Keyed on the probe payload marker: an anonymized query row has NULL user_id, recipe_id AND
        // query_text, so no natural column reaches it after the sweep runs.
        await db.execute(sql`DELETE FROM analytics_events WHERE payload @> '{"probe": "u2-erasure"}'::jsonb`);
        await db.execute(sql`DELETE FROM recipe_impact_signals WHERE recipe_id = ${RECIPE_ID}`);
        await db.execute(sql`DELETE FROM account_erasure_jobs WHERE owner_id IN (${USER_ERASED}, ${USER_BYSTANDER})`);
    });

    afterAll(async () => {
        await pool.end();
    });

    async function seedEvents(): Promise<void> {
        await db.execute(sql`
            INSERT INTO analytics_events (event_id, event_type, user_id, recipe_id, query_text, payload, occurred_at)
            VALUES (NULL, 'recipe_saved', ${USER_ERASED}, ${RECIPE_ID}, NULL, ${PROBE}::jsonb, now()),
                   (NULL, 'recipe_viewed', ${USER_ERASED}, ${RECIPE_ID}, NULL, ${PROBE}::jsonb, now()),
                   (gen_random_uuid(), 'query_outcome', ${USER_ERASED}, NULL, 'saffron', ${PROBE}::jsonb, now()),
                   (NULL, 'recipe_saved', ${USER_BYSTANDER}, ${RECIPE_ID}, NULL, ${PROBE}::jsonb, now())
        `);
    }

    it('AE4: rows survive with null user id and blanked query text; counts and bystanders untouched', async () => {
        await seedEvents();

        // The fold ran at seed time: 2 saves (one per cook) + 1 view.
        const before = await db.execute<{ save_count: string; view_count: string }>(
            sql`SELECT save_count, view_count FROM recipe_impact_signals WHERE recipe_id = ${RECIPE_ID}`,
        );
        expect(Number(before.rows[0]?.save_count)).toBe(2);
        expect(Number(before.rows[0]?.view_count)).toBe(1);

        await eraseRecipeRows(db, USER_ERASED, []);

        // Every one of the erased cook's rows SURVIVES, anonymized — none deleted.
        const erased = await db.execute<{ n: string }>(
            sql`SELECT count(*)::int AS n FROM analytics_events
                WHERE payload @> '{"probe": "u2-erasure"}'::jsonb AND user_id IS NULL AND query_text IS NULL`,
        );
        expect(Number(erased.rows[0]?.n)).toBe(3);

        const residue = await db.execute<{ n: string }>(
            sql`SELECT count(*)::int AS n FROM analytics_events
                WHERE user_id = ${USER_ERASED} OR query_text = 'saffron'`,
        );
        expect(Number(residue.rows[0]?.n)).toBe(0);

        // The bystander's row is untouched.
        const bystander = await db.execute<{ n: string }>(
            sql`SELECT count(*)::int AS n FROM analytics_events WHERE user_id = ${USER_BYSTANDER}`,
        );
        expect(Number(bystander.rows[0]?.n)).toBe(1);

        // SC3: the recipe's folded counts are IDENTICAL — no UPDATE trigger re-folded, nothing decremented.
        const after = await db.execute<{ save_count: string; view_count: string }>(
            sql`SELECT save_count, view_count FROM recipe_impact_signals WHERE recipe_id = ${RECIPE_ID}`,
        );
        expect(Number(after.rows[0]?.save_count)).toBe(2);
        expect(Number(after.rows[0]?.view_count)).toBe(1);
    });
});
