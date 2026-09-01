/**
 * Analytics plan U4 — the ingest door through the BOOTED app, against a real Postgres (AE1–AE3, KTD5/KTD9).
 *
 * What only this tier proves: the real partial-index dedup (a replayed event id lands ZERO rows and the
 * response SAYS so — the KTD5 dedup-rate signal), attribution under the real auth middleware (a batch
 * smuggling an actor lands nothing, and whatever lands belongs to the TOKEN's user), the real
 * `ErasureLockGuard` answering 423 mid-erasure (KTD9 — designed, not a bug), and the bearer protection
 * of the non-`api/` mount (`AuthMiddleware` is `forRoutes('*')` — proven by booting WITHOUT dev auth).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { createRecipeDrizzle, type RecipeDrizzle } from '../../../src/database/client.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const OWNER = '01JU4INGESTROUTEOWNER0000A';

function pickEvent(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        type: 'query_outcome',
        eventId: crypto.randomUUID(),
        occurredAt: '2026-09-01T12:00:00.000Z',
        query: 'salt',
        served: [
            { group: 'local', label: 'Salt' },
            { group: 'catalog', label: 'Salt, table', foodId: 'food-0001' },
        ],
        outcome: { kind: 'pick', group: 'catalog', positionInGroup: 1, foodId: 'food-0001' },
        ...over,
    };
}

describe.skipIf(!hasDatabaseUrl)('U4 ingest route (integration, booted app)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let pool: pg.Pool;
    let db: RecipeDrizzle;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        db = createRecipeDrizzle(pool);
    });

    afterAll(async () => {
        await pool.end();
        await booted.close();
    });

    beforeEach(async () => {
        await db.execute(sql`DELETE FROM analytics_events WHERE user_id = ${OWNER}`);
        await db.execute(sql`DELETE FROM account_erasure_jobs WHERE owner_id = ${OWNER}`);
    });

    async function post(body: unknown): Promise<Response> {
        return fetch(`${baseUrl}/ingest/v1/events`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    async function rowsFor(userId: string): Promise<{ query_text: string | null; payload: unknown }[]> {
        const result = await db.execute<{ query_text: string | null; payload: unknown }>(sql`
            SELECT query_text, payload FROM analytics_events
             WHERE user_id = ${userId} AND event_type = 'query_outcome'
             ORDER BY id
        `);

        return result.rows;
    }

    it('AE1: a pick lands under the TOKEN user with query, served list, group and position-in-group', async () => {
        const res = await post({ events: [pickEvent()] });

        expect(res.status).toBe(202);
        expect(await res.json()).toEqual({ accepted: 1, landed: 1 });

        const rows = await rowsFor(OWNER);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.query_text).toBe('salt');
        const payload = rows[0]?.payload as {
            served: { group: string; label: string }[];
            outcome: { kind: string; group: string; positionInGroup: number };
        };
        expect(payload.served).toHaveLength(2);
        expect(payload.outcome).toMatchObject({ kind: 'pick', group: 'catalog', positionInGroup: 1 });
    });

    it('AE2: a no-pick lands — the capture-rate denominator is a row, not an absence', async () => {
        const res = await post({ events: [pickEvent({ query: 'buckwheat honey', outcome: { kind: 'no_pick' } })] });

        expect(res.status).toBe(202);
        const rows = await rowsFor(OWNER);
        expect(rows).toHaveLength(1);
        const row = rows[0];

        if (row === undefined) {
            throw new Error('unreachable: length asserted above');
        }

        expect((row.payload as { outcome: { kind: string } }).outcome.kind).toBe('no_pick');
    });

    it('KTD5: replaying the SAME event id lands zero rows, and the response reports the dedup', async () => {
        const event = pickEvent();

        const first = await post({ events: [event] });
        expect(await first.json()).toEqual({ accepted: 1, landed: 1 });

        const replay = await post({ events: [event] });
        expect(replay.status).toBe(202);
        expect(await replay.json()).toEqual({ accepted: 1, landed: 0 });

        expect(await rowsFor(OWNER)).toHaveLength(1);
    });

    it('AE3/R12: a server-door family and a smuggled-actor event are DROPPED; the valid event beside them lands', async () => {
        const res = await post({
            events: [
                pickEvent({ type: 'recipe_saved' }),
                pickEvent({ userId: 'someone-else' }),
                pickEvent({ query: 'thyme' }),
            ],
        });

        expect(res.status).toBe(202);
        expect(await res.json()).toEqual({ accepted: 1, landed: 1 });

        const rows = await rowsFor(OWNER);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.query_text).toBe('thyme');
        // Nothing landed under the smuggled identity, and no save event exists at all.
        const strangers = await db.execute<{ n: number }>(sql`
            SELECT count(*)::int AS n FROM analytics_events WHERE user_id = 'someone-else'
        `);
        expect(Number(strangers.rows[0]?.n)).toBe(0);
        const saves = await db.execute<{ n: number }>(sql`
            SELECT count(*)::int AS n FROM analytics_events WHERE user_id = ${OWNER} AND event_type = 'recipe_saved'
        `);
        expect(Number(saves.rows[0]?.n)).toBe(0);
    });

    it('AE3: a malformed envelope answers 400 and nothing lands', async () => {
        const res = await post({ nonsense: true });

        expect(res.status).toBe(400);
        expect(await rowsFor(OWNER)).toHaveLength(0);
    });

    it('KTD9: an in-flight erasure answers 423 — DESIGNED, so no user-keyed row can land mid-sweep', async () => {
        await db.execute(sql`
            INSERT INTO account_erasure_jobs (owner_id, status) VALUES (${OWNER}, 'running')
        `);

        const res = await post({ events: [pickEvent()] });

        expect(res.status).toBe(423);
        expect(await rowsFor(OWNER)).toHaveLength(0);
    });

    it('the non-api mount is bearer-protected: without dev auth, an unauthenticated POST is refused', async () => {
        // The dev-auth bypass is an env var the middleware reads PER REQUEST (the `asPrincipal`
        // mechanism); unsetting it for one request exposes the real rule — `AuthMiddleware` is
        // `forRoutes('*')`, so this non-`api/` mount demands a bearer with zero wiring, the property
        // KTD3's off-contract seam relies on.
        const previous = process.env['RECIPE_DEV_AUTH_USER_ID'];
        delete process.env['RECIPE_DEV_AUTH_USER_ID'];

        try {
            const res = await post({ events: [pickEvent()] });

            expect(res.status).toBe(401);
        } finally {
            if (previous !== undefined) {
                process.env['RECIPE_DEV_AUTH_USER_ID'] = previous;
            }
        }

        expect(await rowsFor(OWNER)).toHaveLength(0);
    });
});
