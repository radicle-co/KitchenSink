/**
 * Migration 0043 — the analytics events store and its fold trigger, asserted against a real PostgreSQL.
 *
 * ⛔ WHY THIS TIER IS MANDATORY, and one scenario above all: the RECOMPUTE-CATCHER. The fold trigger's
 * math must be a DELTA UPSERT, never migration 0010's recompute — a recompute build passes every naive
 * test and then silently collapses a lifetime count of 100 to the survivors the first time a save lands
 * AFTER retention has deleted the old rows. The sequence fold → delete → insert is the only one that
 * distinguishes the two implementations, and it lives here (plan KTD1, five-persona review F1/F5).
 *
 * Also load-bearing: exactly ONE trigger exists on `analytics_events` (an UPDATE trigger would let the
 * erasure sweep re-fold anonymized rows; a DELETE trigger would let retention decrement lifetime counts
 * — absence is the design, so absence is pinned); the idempotent landing is a true no-op on counts; and
 * the pair CHECK refuses payload-without-person rows (the erasure gate's pairing rule).
 *
 * Runs against `DATABASE_URL` (a recipe database with migrations applied); skipped without it, run in CI.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

const OWNER_ID = '01JU7ANALYTICS000000OWNER0';
const OTHER_ID = '01JU7ANALYTICS000000OTHER0';
const RECIPE_A = '55555555-5555-4555-8555-000000000a01';
const RECIPE_B = '55555555-5555-4555-8555-000000000a02';

describe.skipIf(!hasDatabaseUrl)('analytics_events + recipe_impact_signals (migration 0043)', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
    });

    afterEach(async () => {
        // The last predicate reaps rows the erasure-shaped UPDATE anonymized (NULL user AND recipe):
        // no natural key reaches them afterwards, and leaving them pollutes sibling erasure suites.
        await pool.query(
            `DELETE FROM analytics_events
              WHERE recipe_id IN ($1, $2) OR user_id IN ($3, $4)
                 OR (user_id IS NULL AND recipe_id IS NULL AND event_type = 'query_outcome')`,
            [RECIPE_A, RECIPE_B, OWNER_ID, OTHER_ID],
        );
        await pool.query(`DELETE FROM recipe_impact_signals WHERE recipe_id IN ($1, $2)`, [RECIPE_A, RECIPE_B]);
    });

    afterAll(async () => {
        await pool.end();
    });

    /** Insert one event row directly, the way the capture paths will. */
    async function insertEvent(over: {
        type: string;
        userId?: string | null;
        recipeId?: string | null;
        queryText?: string | null;
        eventId?: string | null;
        agedMonths?: number;
    }): Promise<void> {
        // The client_event_needs_id CHECK: every query_outcome row carries an event id, so the helper
        // mints one when the caller did not choose — server-door families stay NULL (out of the index).
        const eventId =
            over.eventId !== undefined ? over.eventId : over.type === 'query_outcome' ? crypto.randomUUID() : null;
        await pool.query(
            `INSERT INTO analytics_events (event_id, event_type, user_id, recipe_id, query_text, payload, occurred_at, created_at)
             VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, now(), now() - ($6 || ' months')::interval)
             ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING`,
            [
                eventId,
                over.type,
                over.userId === undefined ? OWNER_ID : over.userId,
                over.recipeId === undefined ? RECIPE_A : over.recipeId,
                over.queryText ?? null,
                String(over.agedMonths ?? 0),
            ],
        );
    }

    async function saveCount(recipeId: string): Promise<number | null> {
        const { rows } = await pool.query(`SELECT save_count FROM recipe_impact_signals WHERE recipe_id = $1`, [
            recipeId,
        ]);

        return rows[0] === undefined ? null : Number(rows[0].save_count);
    }

    it('folds a save event into save_count = 1', async () => {
        await insertEvent({ type: 'recipe_saved' });

        expect(await saveCount(RECIPE_A)).toBe(1);
    });

    it('folds a bulk insert of N views with ONE statement-level firing (+N, not +1)', async () => {
        await pool.query(
            `INSERT INTO analytics_events (event_type, user_id, recipe_id, payload, occurred_at)
             SELECT 'recipe_viewed', $1, $2, '{}'::jsonb, now() FROM generate_series(1, 5)`,
            [OWNER_ID, RECIPE_A],
        );

        const { rows } = await pool.query(`SELECT view_count FROM recipe_impact_signals WHERE recipe_id = $1`, [
            RECIPE_A,
        ]);

        expect(Number(rows[0]?.view_count)).toBe(5);
    });

    it('⛔ THE RECOMPUTE-CATCHER: fold → delete the aged rows → a new save lands as old + 1, never a recompute', async () => {
        // Covers AE5's invariant one step further than retention itself: three aged saves fold to 3,
        // retention-style deletion removes their rows, and the NEXT save must read 4 — a recompute
        // implementation answers 1 here and corrupts every lifetime count 015 will consume.
        await insertEvent({ type: 'recipe_saved', agedMonths: 8 });
        await insertEvent({ type: 'recipe_saved', agedMonths: 8 });
        await insertEvent({ type: 'recipe_saved', agedMonths: 7 });
        expect(await saveCount(RECIPE_A)).toBe(3);

        await pool.query(
            `DELETE FROM analytics_events WHERE recipe_id = $1 AND created_at < now() - interval '6 months'`,
            [RECIPE_A],
        );
        expect(await saveCount(RECIPE_A)).toBe(3);

        await insertEvent({ type: 'recipe_saved' });
        expect(await saveCount(RECIPE_A)).toBe(4);
    });

    it('⛔ pins EXACTLY ONE trigger on analytics_events — no UPDATE, no DELETE trigger, ever', async () => {
        // An UPDATE trigger would re-fold every row the erasure sweep anonymizes; a DELETE trigger would
        // decrement lifetime counts on retention. Their ABSENCE is the design (plan KTD1), so it is pinned.
        const { rows } = await pool.query(
            `SELECT tgname, pg_trigger.tgtype FROM pg_trigger
             JOIN pg_class ON pg_class.oid = pg_trigger.tgrelid
             WHERE pg_class.relname = 'analytics_events' AND NOT tgisinternal`,
        );

        expect(rows).toHaveLength(1);
    });

    it('an erasure-shaped UPDATE (null user id, blank query text) moves no counts', async () => {
        await insertEvent({ type: 'recipe_saved', queryText: null });
        await insertEvent({ type: 'query_outcome', recipeId: null, queryText: 'salt' });
        expect(await saveCount(RECIPE_A)).toBe(1);

        await pool.query(`UPDATE analytics_events SET user_id = NULL, query_text = NULL WHERE user_id = $1`, [
            OWNER_ID,
        ]);

        expect(await saveCount(RECIPE_A)).toBe(1);
    });

    it('a duplicate event_id lands zero rows AND moves no counts — including in a mixed batch', async () => {
        const dup = '99999999-9999-4999-8999-000000000001';
        await insertEvent({ type: 'recipe_saved', eventId: dup });
        expect(await saveCount(RECIPE_A)).toBe(1);

        // Mixed batch: one conflicting row, one fresh row for another recipe — only the fresh row folds.
        await pool.query(
            `INSERT INTO analytics_events (event_id, event_type, user_id, recipe_id, payload, occurred_at)
             VALUES ($1, 'recipe_saved', $2, $3, '{}'::jsonb, now()),
                    ($4, 'recipe_saved', $2, $5, '{}'::jsonb, now())
             ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING`,
            [dup, OWNER_ID, RECIPE_A, '99999999-9999-4999-8999-000000000002', RECIPE_B],
        );

        expect(await saveCount(RECIPE_A)).toBe(1);
        expect(await saveCount(RECIPE_B)).toBe(1);
    });

    it('a query_outcome event folds nothing', async () => {
        await insertEvent({ type: 'query_outcome', recipeId: null, queryText: 'salt' });

        expect(await saveCount(RECIPE_A)).toBeNull();
    });

    it('the pair CHECK refuses query text on a row with no user — payload and person together or not at all', async () => {
        await expect(
            insertEvent({ type: 'query_outcome', userId: null, recipeId: null, queryText: 'salt' }),
        ).rejects.toThrow();
    });

    it('rejects an event type outside the closed v1 set', async () => {
        await expect(insertEvent({ type: 'recipe_cooked_typo' })).rejects.toThrow();
    });

    it('accepts an actor-less row with no query text — the anonymized population', async () => {
        await insertEvent({ type: 'recipe_viewed', userId: null });

        const { rows } = await pool.query(
            `SELECT count(*)::int AS n FROM analytics_events WHERE recipe_id = $1 AND user_id IS NULL`,
            [RECIPE_A],
        );

        expect(rows[0]?.n).toBe(1);
    });
});
