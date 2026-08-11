/**
 * e2e: the global `ValidationPipe` actually runs (S-I1), and the dead `POST /api/v1/users/upsert` route is
 * gone (S-I2). Boots the REAL identity Nest app over HTTP via {@link bootIdentityApp} with a dev-auth
 * bypass, so requests reach the routing + validation pipeline. `pg`/SQS are mocked because these
 * assertions short-circuit (pipe reject / route 404) before any DB or queue call — no real infra needed.
 *
 * ⚠️ EVERY REJECTION ASSERTS THE BODY, not just the status. Asserting `res.status === 400` alone is
 * structurally blind to the failure this tier exists to catch: when the DTOs moved to `nestjs-zod`, the
 * global exception filter stopped recognising the new exception shape and this route began answering
 * `{"code":"BAD_REQUEST","message":"Validation failed"}` — no field names, no `details.fields` — while
 * `contract/openapi.ts` and `src/common/api-error.schema.ts` both promised the opposite, and the profile
 * form's only user-facing feedback became that bare string. Every case below therefore pins the
 * PUBLISHED contract: the `code`, the field named in `message`, and `details.fields`.
 *
 * DECISION (recorded here because this file is where the behaviour is observable): a `PATCH` with NO BODY
 * AT ALL is a `400`, where it used to be a `200` no-op. Nest's `ValidationPipe` coerced a nil body to `{}`
 * (`toEmptyIfNil`); `ZodValidationPipe` parses `undefined` against `z.strictObject` and rejects it. The
 * `400` is kept as the more correct answer — a write request that carries nothing is malformed, and
 * answering `200` tells a broken client it succeeded. `{}` remains an accepted, explicit no-op, so a
 * caller that means "change nothing" still has a way to say so. No shipped caller is affected:
 * `ProfileServiceClient` always sends a JSON object body.
 *
 * @module
 */
import 'reflect-metadata';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
// The PUBLISHED envelope type, from the generated leaf a client actually compiles against — so these
// assertions are written in the same vocabulary the caller has, not the service's internal copy.
import type { ApiErrorBody } from '@kitchensink/schema-identity';

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

    /** PATCH the viewer's profile with a raw body, returning the status and the parsed error envelope. */
    const patchMe = async (body: string): Promise<{ status: number; envelope: ApiErrorBody }> => {
        const res = await fetch(`${booted.baseUrl}/api/v1/users/me`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body,
        });

        return { status: res.status, envelope: (await res.json()) as ApiErrorBody };
    };

    it('rejects a PATCH /api/v1/users/me displayName over 100 chars with 400 naming the field', async () => {
        const { status, envelope } = await patchMe(JSON.stringify({ displayName: 'x'.repeat(101) }));

        expect(status).toBe(400);
        expect(envelope.code).toBe('BAD_REQUEST');
        expect(envelope.message).toContain('displayName');
        expect(envelope.details?.['fields']).toEqual([
            'displayName: Too big: expected string to have <=100 characters',
        ]);
    });

    it('rejects a PATCH /api/v1/users/me avatarUrl that is not a URL with 400 naming the field', async () => {
        const { status, envelope } = await patchMe(JSON.stringify({ avatarUrl: 'not-a-url' }));

        expect(status).toBe(400);
        expect(envelope.code).toBe('BAD_REQUEST');
        expect(envelope.message).toContain('avatarUrl');
        expect(envelope.details?.['fields']).toEqual(['avatarUrl: Invalid URL']);
    });

    // Both fields wrong in one request: the client gets BOTH messages, which is the whole reason
    // `details.fields` is an array rather than a single string.
    it('reports EVERY invalid field of one PATCH, not just the first', async () => {
        const { status, envelope } = await patchMe(
            JSON.stringify({ displayName: 'x'.repeat(101), avatarUrl: 'not-a-url' }),
        );

        expect(status).toBe(400);
        expect(envelope.details?.['fields']).toEqual([
            'displayName: Too big: expected string to have <=100 characters',
            'avatarUrl: Invalid URL',
        ]);
        expect(envelope.message).toBe(
            'displayName: Too big: expected string to have <=100 characters, avatarUrl: Invalid URL',
        );
    });

    it('rejects a PATCH /api/v1/users/me with an unknown field with 400 naming the key', async () => {
        const { status, envelope } = await patchMe(JSON.stringify({ displayName: 'Valid Name', hacker: 'extra' }));

        expect(status).toBe(400);
        expect(envelope.code).toBe('BAD_REQUEST');
        expect(envelope.message).toContain('hacker');
        expect(envelope.details?.['fields']).toEqual(['Unrecognized key: "hacker"']);
    });

    // The recorded behaviour change (see the module doc): no body at all is a 400, not a 200 no-op.
    it('rejects a PATCH /api/v1/users/me with NO body at all with 400 (was a 200 no-op)', async () => {
        const res = await fetch(`${booted.baseUrl}/api/v1/users/me`, { method: 'PATCH' });
        const envelope = (await res.json()) as ApiErrorBody;

        expect(res.status).toBe(400);
        expect(envelope.code).toBe('BAD_REQUEST');
        expect(envelope.message).toContain('expected object');
    });

    // A leak check on the same envelope: a rejection reports the CALLER's mistake and nothing about the
    // service — no stack, no `statusCode`/`error` remnants of Nest's internal body, no DB detail.
    it('leaks nothing internal in a validation rejection body', async () => {
        const { envelope } = await patchMe(JSON.stringify({ avatarUrl: 'not-a-url' }));
        const serialized = JSON.stringify(envelope);

        expect(Object.keys(envelope).sort()).toEqual(['code', 'details', 'message']);
        expect(serialized).not.toContain('statusCode');
        expect(serialized).not.toContain('ZodError');
        expect(serialized).not.toMatch(/\bat \S+ \(/);
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
