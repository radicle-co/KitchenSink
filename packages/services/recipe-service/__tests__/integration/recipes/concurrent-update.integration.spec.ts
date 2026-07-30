/**
 * ADV-1 regression — optimistic concurrency is an ATOMIC compare-and-swap, not a read-then-check.
 *
 * Two clients edit the same recipe from the SAME base version at the same time. Exactly one write must
 * win (200, version bumped to 2) and the other must lose with 409 VERSION_CONFLICT — and, critically, the
 * loser's body must NOT have been persisted (no lost update). This is the mutation-killing test for the
 * lost-update race: if the DAL's UPDATE WHERE drops the `current_version = expectedVersion` predicate
 * (the original bug), BOTH requests pass the service-layer pre-check under READ COMMITTED and BOTH commit
 * (200/200, versions 2 then 3) — this test then fails on the "exactly one 409" and "winner persisted"
 * assertions. Runs against the real booted app + Docker Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';

const OWNER = '01JCONCURRENT0OWNER0000AAA';

const CREATE_PAYLOAD = {
    title: 'Concurrent Base',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    tags: [],
    dietaryFlags: [],
    ingredients: [{ ingredientId: '00000000-0000-4000-8000-0000000000aa', name: 'Flour', quantity: 1, unit: 'cup' }],
    steps: [{ instruction: 'Base step' }],
};

interface RecipeBody {
    id: string;
    title: string;
    currentVersion: number;
}

describe.skipIf(!hasDatabaseUrl)('recipe optimistic concurrency (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
    });

    afterAll(async () => {
        await booted.close();
    });

    it('lets exactly one of two same-base-version updates win; the loser gets 409 and does not persist', async () => {
        const created = (await (
            await fetch(`${baseUrl}/v1/recipes`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(CREATE_PAYLOAD),
            })
        ).json()) as RecipeBody;
        expect(created.currentVersion).toBe(1);

        // Two edits racing from version 1, each renaming to a distinguishable title.
        const patch = (title: string): Promise<Response> =>
            fetch(`${baseUrl}/v1/recipes/${created.id}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ expectedVersion: 1, title }),
            });

        const [a, b] = await Promise.all([patch('Winner A'), patch('Loser B')]);
        const statuses = [a.status, b.status].sort();

        // Exactly one 200 and one 409 — never 200/200 (which the missing-predicate bug produces).
        expect(statuses).toEqual([200, 409]);

        const okResponse = a.status === 200 ? a : b;
        const conflictResponse = a.status === 200 ? b : a;

        const winner = (await okResponse.json()) as RecipeBody;
        expect(winner.currentVersion).toBe(2);

        const conflictBody = (await conflictResponse.json()) as { code: string; details?: { currentVersion?: number } };
        expect(conflictBody.code).toBe('VERSION_CONFLICT');
        expect(conflictBody.details?.currentVersion).toBe(2); // truthful current version, not a stale 1

        // The persisted state is the WINNER's — the loser's title never clobbered it, and the version is
        // exactly 2 (a single successful bump), proving no second write slipped through.
        const finalState = (await (await fetch(`${baseUrl}/v1/recipes/${created.id}`)).json()) as RecipeBody;
        expect(finalState.title).toBe(winner.title);
        expect(finalState.currentVersion).toBe(2);
    });
});
