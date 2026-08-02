/**
 * e2e: the global `ValidationPipe` actually runs (S-I1), and the dead `POST /api/v1/users/upsert` route is
 * gone (S-I2). Boots the REAL identity Nest app over HTTP via {@link bootIdentityApp} with a dev-auth
 * bypass, so requests reach the routing + validation pipeline. `pg`/SQS are mocked because these
 * assertions short-circuit (pipe reject / route 404) before any DB or queue call — no real infra needed.
 *
 * @module
 */
import 'reflect-metadata';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// The identity DatabaseModule builds a `pg` Pool at init (`import pg from 'pg'; new pg.Pool(...)`), and
// QueueModule constructs an SQS client. Mock both so the app boots with no real Postgres / LocalStack.
vi.mock('pg', () => {
    // A class (not an arrow-returning factory) so `new Pool(...)` in DatabaseModule is a real
    // construction; the no-op methods are enough for drizzle to wrap it (no query runs on the paths
    // under test — the pipe rejects / routing 404s before any handler touches the DB).
    class Pool {
        connect = vi.fn();
        query = vi.fn();
        end = vi.fn();
        on = vi.fn();
    }

    return { default: { Pool } };
});

vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(),
    SendMessageCommand: vi.fn(),
}));

import { bootIdentityApp } from './harness.js';
import type { BootedServiceApp } from './service-harness.js';

const DEV_USER = '01HZZE2EVALIDATIONUSER0000';

describe('identity e2e — request validation + route surface', () => {
    let booted: BootedServiceApp;

    beforeAll(async () => {
        booted = await bootIdentityApp({ devAuthUserId: DEV_USER });
    });

    afterAll(async () => {
        await booted?.close();
    });

    /** Smoke: the harness boots and the public health route answers without auth. */
    it('serves GET /health without auth (harness smoke)', async () => {
        const res = await fetch(`${booted.baseUrl}/health`);

        expect(res.status).toBe(200);
    });

    // ---- S-I1: the global ValidationPipe rejects invalid bodies (was inert; PATCH used to 200/500) ----

    it('rejects a PATCH /api/v1/users/me displayName over 100 chars with 400', async () => {
        const res = await fetch(`${booted.baseUrl}/api/v1/users/me`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ displayName: 'x'.repeat(101) }),
        });

        expect(res.status).toBe(400);
    });

    it('rejects a PATCH /api/v1/users/me avatarUrl that is not a URL with 400', async () => {
        const res = await fetch(`${booted.baseUrl}/api/v1/users/me`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ avatarUrl: 'not-a-url' }),
        });

        expect(res.status).toBe(400);
    });

    it('rejects a PATCH /api/v1/users/me with an unknown field with 400 (forbidNonWhitelisted)', async () => {
        const res = await fetch(`${booted.baseUrl}/api/v1/users/me`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ displayName: 'Valid Name', hacker: 'extra' }),
        });

        expect(res.status).toBe(400);
    });

    // ---- S-I2: the dead upsert endpoint is removed (route no longer exists → 404, not handled) ----

    it('returns 404 for POST /api/v1/users/upsert (endpoint deleted)', async () => {
        const res = await fetch(`${booted.baseUrl}/api/v1/users/upsert`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identityId: 'x', email: 'a@b.com' }),
        });

        expect(res.status).toBe(404);
    });
});
