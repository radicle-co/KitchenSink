/**
 * HAZ-052 — e2e proof of the erasure write-lock through the fully ASSEMBLED recipe app
 * (`ThrottlerModule` + BOTH global `APP_GUARD`s in their registered order, `AuthMiddleware`,
 * `ApiExceptionFilter`, real HTTP) via `bootRecipeApp`. Mirrors `throttle.e2e.spec.ts` — another
 * cross-cutting global guard pinned at this tier — for the same reason: a guard registered as `APP_GUARD`
 * is a property of the ASSEMBLED app, not of any one controller, so the client-visible proof belongs
 * here rather than wedged into an unrelated domain's e2e spec.
 *
 * Where the integration spec (`__tests__/integration/account/erasure-lock.integration.spec.ts`) exhausts
 * the guard's branches (both in-flight statuses, both terminal statuses, per-owner isolation, that
 * nothing is written), this pins only what a REAL client sees end to end: a locked write answers `423`
 * with the contract's `ERASURE_IN_PROGRESS` body, a read is untouched, and the erasure-request endpoint
 * itself keeps answering its own idempotent `202` rather than locking itself out.
 *
 * The booted app authenticates as OWNER (dev bypass). Recipes are seeded via a direct `pg` pool, matching
 * `ratings.e2e.spec.ts`. Skips cleanly when no test database is configured.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';
import { ACCOUNT_ERASURE_CONFIRMATION_PHRASE } from '../../src/account/dto/erasure.dto.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const OWNER = '01JERASURELOCKE2EOWNER0000A';

/** The wire error envelope `ApiExceptionFilter` produces for a thrown `RecipeDomainError`. */
interface ErrorBody {
    code: string;
    message: string;
}

describe.skipIf(!hasDatabaseUrl)('erasure write-lock (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
    });

    afterEach(async () => {
        await pool.query('DELETE FROM account_erasure_jobs WHERE owner_id = $1', [OWNER]);
    });

    afterAll(async () => {
        await pool.query('DELETE FROM collections WHERE owner_id = $1', [OWNER]);
        await pool.end();
        await booted?.close();
    });

    async function seedQueuedJob(): Promise<void> {
        await pool.query("INSERT INTO account_erasure_jobs (owner_id, status) VALUES ($1, 'queued')", [OWNER]);
    }

    it('answers 423 ERASURE_IN_PROGRESS for a mutating request while erasure is queued', async () => {
        await seedQueuedJob();

        const response = await fetch(`${booted.baseUrl}/v1/collections`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'e2e erasure-lock probe' }),
        });

        expect(response.status).toBe(423);
        const body = (await response.json()) as ErrorBody;
        expect(body.code).toBe('ERASURE_IN_PROGRESS');
    });

    it('leaves reads untouched — GET /v1/collections still 200s while erasure is queued', async () => {
        await seedQueuedJob();

        const response = await fetch(`${booted.baseUrl}/v1/collections`);

        expect(response.status).toBe(200);
    });

    it('does not lock itself out — POST /v1/account/erasure still answers its own 202 while queued', async () => {
        await seedQueuedJob();

        const response = await fetch(`${booted.baseUrl}/v1/account/erasure`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE }),
        });

        expect(response.status).toBe(202);
    });
});
