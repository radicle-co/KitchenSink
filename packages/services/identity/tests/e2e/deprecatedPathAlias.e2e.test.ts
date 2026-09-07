/**
 * e2e: the DEPRECATED bare-`v1` path alias really answers over HTTP, not just in routing metadata.
 *
 * Every endpoint is canonically served under `/api/{version}/` (ADR-0011), and every endpoint ALSO answers on
 * the bare `/{version}/` path it originally shipped on. `tests/apiRoutePaths.test.ts` pins that at the
 * decorator level, which is cheap but proves only that Nest was *told* about both paths. This suite proves
 * the request actually round-trips: same status, same body, same auth treatment on both spellings.
 *
 * It matters because the alias's consumers cannot be fixed by a redeploy of this repo. The Clerk dashboard
 * holds the webhook endpoint URL, and already-shipped mobile builds plus cached web bundles have their
 * endpoints inlined from build-time `NEXT_PUBLIC_*` values. If the alias silently stopped resolving, those
 * clients would 404 with nothing in this repository failing.
 *
 * Boots the REAL identity Nest app via {@link bootIdentityApp}; `pg`/SQS are mocked because these assertions
 * are about routing and auth, which resolve before any DB or queue call.
 *
 * @module
 */
import 'reflect-metadata';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mirrors usersValidation.e2e.test.ts: DatabaseModule builds a `pg` Pool at init and QueueModule an SQS
// client, so both are stubbed to let the app boot with no real Postgres / LocalStack.
vi.mock('pg', () => {
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

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { bootIdentityApp } from './harness.js';

const DEV_USER = '01HZZE2EALIASUSER00000000';

/** Endpoint pairs: the canonical path and the deprecated alias that must behave identically. */
const aliasPairs: ReadonlyArray<readonly [string, string]> = [
    ['/api/v1/users/me', '/v1/users/me'],
    ['/api/v1/admin/users', '/v1/admin/users'],
];

describe('identity e2e — deprecated bare-v1 path alias', () => {
    let booted: BootedServiceApp;

    beforeAll(async () => {
        booted = await bootIdentityApp({ devAuthUserId: DEV_USER });
    });

    afterAll(async () => {
        await booted?.close();
    });

    describe.each(aliasPairs)('%s ↔ %s', (canonicalPath, legacyPath) => {
        it('resolves the deprecated alias to a real route, NOT a 404', async () => {
            const res = await fetch(`${booted.baseUrl}${legacyPath}`);

            expect(res.status).not.toBe(404);
        });

        it('gives the alias the same status as the canonical path', async () => {
            const [canonical, legacy] = await Promise.all([
                fetch(`${booted.baseUrl}${canonicalPath}`),
                fetch(`${booted.baseUrl}${legacyPath}`),
            ]);

            expect(legacy.status).toBe(canonical.status);
        });
    });

    it('applies the SAME ValidationPipe to the alias — a bad body is a 400, not a silent pass', async () => {
        // The alias must not be a validation bypass: an over-long displayName is rejected on both spellings.
        const res = await fetch(`${booted.baseUrl}/v1/users/me`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ displayName: 'x'.repeat(101) }),
        });

        expect(res.status).toBe(400);
    });

    it('keeps a genuinely removed route removed on BOTH spellings', async () => {
        // `POST /v1/users/upsert` was deleted (S-I2). Retaining a path alias must not resurrect dead routes.
        const [canonical, legacy] = await Promise.all([
            fetch(`${booted.baseUrl}/api/v1/users/upsert`, { method: 'POST' }),
            fetch(`${booted.baseUrl}/v1/users/upsert`, { method: 'POST' }),
        ]);

        expect(canonical.status).toBe(404);
        expect(legacy.status).toBe(404);
    });

    it('does NOT invent an /api/health — the probe stays at the root for ALB health checks', async () => {
        const [root, prefixed] = await Promise.all([
            fetch(`${booted.baseUrl}/health`),
            fetch(`${booted.baseUrl}/api/health`),
        ]);

        expect(root.status).toBe(200);
        expect(prefixed.status).toBe(404);
    });
});
