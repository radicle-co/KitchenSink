/**
 * Analytics plan U6 — the retention sweeper against a REAL Postgres (origin R10; AE5).
 *
 * The property only this tier can prove is AE5's invariant THROUGH THE REAL PARTS: after the real
 * sweeper deletes real aged rows, every folded count is byte-identical — which holds only because 0043
 * ships a DELTA fold and NO DELETE trigger. The decisive scenario is U1's recompute-catcher rerun
 * through the REAL sweeper (fold → real retention pass → new save = old + 1): a recompute fold, or a
 * "helpful" DELETE trigger added later, fails HERE with a corrupted lifetime count, not in production.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { sweepExpiredEvents } from '../../../src/handlers/retentionSweeper.js';
import { disposableDatabaseUrl } from '../disposableDatabaseUrl.js';

const DATABASE_URL = disposableDatabaseUrl();
const canRun = Boolean(DATABASE_URL);

const USER = '01JU6RETENTIONSWEEPUSER00A';
const RECIPE = '88888888-8888-4888-8888-000000000d01';

describe.skipIf(!canRun)('analytics U6 — retention deletes aged rows, counts survive (AE5)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = drizzle(pool);
    });

    afterEach(async () => {
        await db.execute(sql`DELETE FROM analytics_events WHERE user_id = ${USER}`);
        await db.execute(sql`DELETE FROM recipe_impact_signals WHERE recipe_id = ${RECIPE}`);
    });

    afterAll(async () => {
        await pool.end();
    });

    async function insertSave(agedMonths: number): Promise<void> {
        await db.execute(sql`
            INSERT INTO analytics_events (event_type, user_id, recipe_id, payload, occurred_at, created_at)
            VALUES ('recipe_saved', ${USER}, ${RECIPE}, '{}'::jsonb, now(),
                    now() - ${`${agedMonths} months`}::interval)
        `);
    }

    async function saveCount(): Promise<number | null> {
        const result = await db.execute<{ save_count: string }>(
            sql`SELECT save_count FROM recipe_impact_signals WHERE recipe_id = ${RECIPE}`,
        );

        return result.rows[0] === undefined ? null : Number(result.rows[0].save_count);
    }

    async function rawRows(): Promise<number> {
        const result = await db.execute<{ n: number }>(
            sql`SELECT count(*)::int AS n FROM analytics_events WHERE user_id = ${USER}`,
        );

        return Number(result.rows[0]?.n);
    }

    it('AE5 through the REAL sweeper: aged rows go, in-window rows stay, counts are byte-identical', async () => {
        await insertSave(8);
        await insertSave(7);
        await insertSave(0);
        expect(await saveCount()).toBe(3);

        const deleted = await sweepExpiredEvents(db);

        expect(deleted).toBeGreaterThanOrEqual(2);
        expect(await rawRows()).toBe(1);
        expect(await saveCount()).toBe(3);
    });

    it('⛔ THE RECOMPUTE-CATCHER through the real sweeper: fold → retention → a new save is old + 1', async () => {
        await insertSave(8);
        await insertSave(8);
        await insertSave(7);
        expect(await saveCount()).toBe(3);

        await sweepExpiredEvents(db);
        expect(await saveCount()).toBe(3);

        await insertSave(0);
        // A recompute implementation answers 2 here (the survivor + the new save); the delta answers 4.
        expect(await saveCount()).toBe(4);
    });
});
