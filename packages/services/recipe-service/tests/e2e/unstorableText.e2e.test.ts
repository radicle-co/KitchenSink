/**
 * LOCAL e2e — a NUL (U+0000) in a caller's text is the caller's `400`, not a `500`, against a REAL PostgreSQL through
 * the fully ASSEMBLED recipe app (dev-auth bypass). Target: LOCAL (§7.1a).
 *
 * ⛔ THE DEFECT: PostgreSQL refuses a NUL at the bind — SQLSTATE `22021` in a `text` parameter, `22P05` in a `jsonb`
 * one — and both answered `500` with a Sentry issue, so any signed-in caller could raise them at will. The filter now
 * answers `VALIDATION_FAILED` (`normalizeUnstorableText`). One case per SQLSTATE: a collection name lands in a `text`
 * column, and an analytics suggestion label lands only in the `jsonb` payload. The filter integration test
 * (`__tests__/integration/common/apiExceptionFilter.integration.test.ts`) proves the Sentry half with the database
 * mocked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { recipeApiErrorSchema } from '../../src/common/apiError.schema.js';
import { bootRecipeApp, type BootedRecipeApp } from './harness.js';
import { recipeDb } from '../support/roleDb.js';

const roleDb = recipeDb();

const OWNER = '01JNULTEXTE2E00000OWNER00A';

/** The caller's text around the NUL, which must never come back in an error body. */
const CALLER_TEXT = 'Weeknight dinners';

/**
 * Assert the answer is the published `VALIDATION_FAILED` and carries none of the caller's text or the SQL.
 *
 * @param response - The API's answer.
 */
async function expectRefusedText(response: Response): Promise<void> {
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(recipeApiErrorSchema.parse(JSON.parse(text))).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(text).not.toContain(CALLER_TEXT);
    expect(text).not.toContain('insert into');
}

describe('a NUL in a caller’s text answers 400 (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: OWNER });
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 2 });
    });

    afterAll(async () => {
        await pool?.query('DELETE FROM collections WHERE owner_id = $1', [OWNER]);
        await pool?.query('DELETE FROM analytics_events WHERE user_id = $1', [OWNER]);
        await pool?.end();
        await booted?.close();
    });

    /** POST a collection with this name. */
    function createCollection(name: string): Promise<Response> {
        return fetch(`${booted.baseUrl}/api/v1/collections`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
        });
    }

    it('⛔ refuses a NUL in a text column (22021), stores nothing, and the next create still succeeds', async () => {
        await expectRefusedText(await createCollection(`${CALLER_TEXT}\u0000`));

        const { rows } = await pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM collections WHERE owner_id = $1',
            [OWNER],
        );

        expect(rows[0]?.n).toBe(0);
        // The pooled connection the failed statement used must come back clean.
        expect((await createCollection(CALLER_TEXT)).status).toBe(201);
    });

    it('⛔ refuses a NUL that reaches only a jsonb column (22P05) and lands no event', async () => {
        const response = await fetch(`${booted.baseUrl}/ingest/v1/events`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                events: [
                    {
                        type: 'query_outcome',
                        eventId: crypto.randomUUID(),
                        occurredAt: new Date().toISOString(),
                        query: 'thyme',
                        served: [{ group: 'catalog', label: `${CALLER_TEXT}\u0000`, foodId: 'food-nul-1' }],
                        outcome: { kind: 'pick', group: 'catalog', positionInGroup: 1, foodId: 'food-nul-1' },
                    },
                ],
            }),
        });

        await expectRefusedText(response);

        const { rows } = await pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM analytics_events WHERE user_id = $1',
            [OWNER],
        );

        expect(rows[0]?.n).toBe(0);
    });
});
