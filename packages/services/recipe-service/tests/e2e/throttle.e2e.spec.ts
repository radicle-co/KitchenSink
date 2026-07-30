/**
 * e2e proof of the recipe-service rate limiting, end to end through the ASSEMBLED app.
 *
 * Unlike the unit wiring test (which drives the guard in isolation), this boots the real Nest app — its
 * `ThrottlerModule.forRoot(...)` registration, the global `APP_GUARD` `ThrottlerGuard`, the auth
 * middleware, the exception filter, and real HTTP — via `bootRecipeApp`, and asserts the behaviour a
 * client actually sees:
 *
 *   - Reads are NOT capped at the photo limit (the original defect): 15 sequential `GET /v1/recipes` all
 *     succeed, where the bug returned `429` from the 11th.
 *   - A write route IS throttled: the write limit + 1 requests produce a final `429`, and none of the
 *     preceding requests are `429`. Invalid bodies are used deliberately — the guard runs BEFORE the
 *     controller's `ValidationPipe`, so each request still counts toward the limit while persisting
 *     nothing (no DB pollution for sibling specs).
 *   - Health probes are never throttled (`@SkipThrottle()`), so a load balancer / ECS probe can hammer
 *     `/health` without being rate-limited into a false "unhealthy".
 *   - The tracker is the AUTHENTICATED USER, not the ALB-shared IP: two distinct identities keep
 *     independent counters, so one user exhausting a limit does not throttle another (the headline defect).
 *
 * The tracker is the authenticated app-user ULID (every loopback `fetch` shares one source IP, so an
 * IP-keyed guard would collapse them into one bucket — which is exactly the bug we fixed). Each `it`
 * targets a DISTINCT route and/or DISTINCT identity (independent throttle keys), so ordering does not
 * matter. Skips cleanly when no test database is configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { writeLimit } from '../../src/common/throttle/throttle.config.js';
import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';
import { SEED_OWNER_FREE } from '../global-setup.js';

describe.skipIf(!hasDatabaseUrl)('recipe-service rate limiting (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: SEED_OWNER_FREE });
    });

    afterAll(async () => {
        await booted?.close();
    });

    it('does NOT cap reads at the photo limit — 15 sequential GET /v1/recipes all succeed', async () => {
        for (let i = 0; i < 15; i += 1) {
            const response = await fetch(`${booted.baseUrl}/v1/recipes?page=1&pageSize=20`);
            expect(response.status).toBe(200);
        }
    });

    it('throttles writes at the write limit (final request 429, none before it)', async () => {
        const attempts = writeLimit + 1;
        const statuses: number[] = [];

        for (let i = 0; i < attempts; i += 1) {
            // Invalid body: rejected by the controller ValidationPipe (which runs AFTER the guard), so the
            // request counts toward the limit but persists nothing.
            const response = await fetch(`${booted.baseUrl}/v1/recipes`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({}),
            });
            statuses.push(response.status);
        }

        // The first `writeLimit` requests are NOT rate-limited (they 4xx on validation);
        // only the final one crosses the limit and is throttled.
        expect(statuses.slice(0, writeLimit)).not.toContain(429);
        expect(statuses[statuses.length - 1]).toBe(429);
    });

    it('never throttles the health probe (skipped) — 40 requests all 200', async () => {
        for (let i = 0; i < 40; i += 1) {
            const response = await fetch(`${booted.baseUrl}/health`);
            expect(response.status).toBe(200);
        }
    });

    it('keys the write limit PER USER — exhausting user A does NOT throttle user B (same loopback IP)', async () => {
        // Two arbitrary, unique identities (unused elsewhere, so their counters start clean regardless of
        // sibling-test order). The dev-bypass reads RECIPE_DEV_AUTH_USER_ID per request, so flipping it
        // between batches switches the authenticated principal the write route sees. Invalid bodies are
        // rejected by the ValidationPipe AFTER the guard, so each request counts toward the limit, needs no
        // seeded user, and persists nothing.
        const userA = '01JTHROTTLEUSERAAAAAAAAAAA0';
        const userB = '01JTHROTTLEUSERBBBBBBBBBBB0';
        const previousDevUser = process.env['RECIPE_DEV_AUTH_USER_ID'];

        const postInvalidRecipe = async (): Promise<number> => {
            const response = await fetch(`${booted.baseUrl}/v1/recipes`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({}),
            });

            return response.status;
        };

        try {
            // User A spends their ENTIRE write budget: the first writeLimit requests are not throttled, and
            // only the (writeLimit + 1)th crosses the limit.
            process.env['RECIPE_DEV_AUTH_USER_ID'] = userA;
            const aStatuses: number[] = [];
            for (let i = 0; i < writeLimit + 1; i += 1) {
                aStatuses.push(await postInvalidRecipe());
            }
            expect(aStatuses.slice(0, writeLimit)).not.toContain(429);
            expect(aStatuses[aStatuses.length - 1]).toBe(429);

            // User B — different identity, SAME loopback IP — is untouched: their first write is NOT 429.
            // Under the old IP-keyed guard both users shared the loopback bucket, so this would be 429.
            process.env['RECIPE_DEV_AUTH_USER_ID'] = userB;
            expect(await postInvalidRecipe()).not.toBe(429);
        } finally {
            // Restore the suite's booted identity so sibling tests are unaffected.
            if (previousDevUser === undefined) {
                delete process.env['RECIPE_DEV_AUTH_USER_ID'];
            } else {
                process.env['RECIPE_DEV_AUTH_USER_ID'] = previousDevUser;
            }
        }
    });
});
