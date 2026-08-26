/**
 * W8-a.5 — e2e proof of the ENRICHED `409 VERSION_CONFLICT` through the fully ASSEMBLED recipe app against
 * the real Postgres harness. Two owner edits race on the same base version: the first wins (200, version
 * bumps); the second — carrying the now-stale expectedVersion — gets a 409 whose `details` carry BOTH the
 * server (current winning) snapshot and the base (edited-from) snapshot, read coherently, plus the
 * `currentVersion` concurrency token the resolve would echo. The base is present because it is still inside
 * the DB retention window.
 *
 * The booted app authenticates as the OWNER (dev bypass). Skips when no test database is configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const OWNER = '01JVERSIONE2E00OWNER00000A';

interface ConflictSide {
    versionNumber: number;
    snapshot: { title: string };
}

describe.skipIf(!hasDatabaseUrl)('enriched version conflict (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
    });

    afterAll(async () => {
        await pool.query('DELETE FROM recipes WHERE owner_id = $1', [OWNER]);
        await pool.end();
        await booted?.close();
    });

    /** Create a recipe through the API so it gets a real v1 version snapshot; returns its id. */
    async function createRecipe(): Promise<string> {
        const res = await fetch(`${booted.baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title: 'Conflict E2E',
                servings: 2,
                prepTimeMinutes: 5,
                cookTimeMinutes: 10,
                totalTimeMinutes: 15,
                ingredients: [
                    {
                        ingredientId: '00000000-0000-4000-8000-0000000000aa',
                        name: 'Flour',
                        quantity: { kind: 'exact', value: 1 },
                    },
                ],
                steps: [{ instruction: 'Mix.' }],
            }),
        });
        expect(res.status).toBe(201);

        return ((await res.json()) as { id: string }).id;
    }

    async function update(id: string, expectedVersion: number, title: string): Promise<Response> {
        return fetch(`${booted.baseUrl}/api/v1/recipes/${id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ expectedVersion, title }),
        });
    }

    it('the loser of a concurrent edit gets a 409 with server + base snapshots and the current version', async () => {
        const id = await createRecipe(); // v1

        // Two edits based on v1. The first commits and bumps to v2.
        const first = await update(id, 1, 'First winner');
        expect(first.status).toBe(200);
        expect(((await first.json()) as { currentVersion: number }).currentVersion).toBe(2);

        // The second still thinks the base is v1 → stale → enriched 409.
        const second = await update(id, 1, 'Second loser');
        expect(second.status).toBe(409);

        const body = (await second.json()) as {
            code: string;
            details: { currentVersion: number; conflictingVersion: number; server: ConflictSide; base?: ConflictSide };
        };
        expect(body.code).toBe('VERSION_CONFLICT');
        expect(body.details.currentVersion).toBe(2); // the concurrency token the resolve echoes
        expect(body.details.conflictingVersion).toBe(1);
        // Server side = the winning v2 content ("First winner"); base side = the v1 the loser edited from.
        expect(body.details.server.versionNumber).toBe(2);
        expect(body.details.server.snapshot.title).toBe('First winner');
        expect(body.details.base?.versionNumber).toBe(1);
        expect(body.details.base?.snapshot.title).toBe('Conflict E2E');
    });
});
