/**
 * Analytics plan U4 — e2e proof of the ingest door (`POST /ingest/v1/events`) through the fully
 * ASSEMBLED recipe app (origin R1/R13; AE1/AE3).
 *
 * The integration tier exhausts the door's branches; this pins what a CLIENT actually receives through
 * the assembled app: the 202 + `{accepted, landed}` shape end-to-end (row verifiably in the store), the
 * 400 for a non-batch, the 401 with no bearer on the non-`api/` mount, and — the off-contract proof in
 * its runtime form — the route answering while the domain contract suites (`contract/__tests__`) stay
 * green without ever seeing it. Skips cleanly without a database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const OWNER = '01JU4INGESTE2E0OWNER00000A';

describe.skipIf(!hasDatabaseUrl)('analytics ingest door (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
    });

    afterAll(async () => {
        await pool.query('DELETE FROM analytics_events WHERE user_id = $1', [OWNER]);
        await pool.end();
        await booted.close();
    });

    function event(): Record<string, unknown> {
        return {
            type: 'query_outcome',
            eventId: crypto.randomUUID(),
            occurredAt: new Date().toISOString(),
            query: 'e2e thyme',
            served: [{ group: 'catalog', label: 'Thyme, fresh', foodId: 'food-e2e-1' }],
            outcome: { kind: 'pick', group: 'catalog', positionInGroup: 1, foodId: 'food-e2e-1' },
        };
    }

    it('accepts a batch end-to-end: 202, {accepted, landed}, and the row is IN the store', async () => {
        const res = await fetch(`${booted.baseUrl}/ingest/v1/events`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ events: [event()] }),
        });

        expect(res.status).toBe(202);
        expect(await res.json()).toEqual({ accepted: 1, landed: 1 });

        const { rows } = await pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM analytics_events WHERE user_id = $1 AND query_text = 'e2e thyme'`,
            [OWNER],
        );
        expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
    });

    it('answers 400 for a non-batch body', async () => {
        const res = await fetch(`${booted.baseUrl}/ingest/v1/events`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ hello: 'world' }),
        });

        expect(res.status).toBe(400);
    });

    it('answers 401 with no bearer — the non-api mount sits behind the same AuthMiddleware', async () => {
        const previous = process.env['RECIPE_DEV_AUTH_USER_ID'];
        delete process.env['RECIPE_DEV_AUTH_USER_ID'];

        try {
            const res = await fetch(`${booted.baseUrl}/ingest/v1/events`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ events: [event()] }),
            });

            expect(res.status).toBe(401);
        } finally {
            if (previous !== undefined) {
                process.env['RECIPE_DEV_AUTH_USER_ID'] = previous;
            }
        }
    });
});
