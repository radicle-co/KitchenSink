/**
 * Integration: identity answers 403 to a SUSPENDED account's token, except on erasure (ADR-0081).
 *
 * The REAL `AuthMiddleware` → `ClerkAuthService` → `@kitchensink/clerk-verify` → `@clerk/backend`'s `verifyToken`, over a
 * genuinely RS256-signed token the booted app trusts. `pg` and SQS are mocked: the refusal happens before any database
 * call. The mark rides in `public_metadata`, the same object the admin scopes already come from.
 *
 * The erasure route must stay reachable for a suspended person (GDPR Art. 17): the shared verifier admits it by method
 * and path, so the check here is that it gets PAST authentication (it then meets the mocked pool and fails for another
 * reason). Both URL spellings are covered, because the bare `/v1` alias is live (ADR-0011).
 *
 * @module
 */
import 'reflect-metadata';

import crypto from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

import { bootIdentityApp } from './support/identityApp.js';

const AZP = 'http://localhost:3000';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const saved: Record<string, string | undefined> = {};

/** A Clerk-shaped session token for `user_target` with the given `public_metadata`. */
function bearer(publicMetadata: Record<string, unknown>): string {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    const input = `${encode({ alg: 'RS256', typ: 'JWT', kid: 'local' })}.${encode({
        sub: 'user_target',
        azp: AZP,
        email: 'target@example.test',
        public_metadata: publicMetadata,
        iat: now,
        nbf: now - 5,
        exp: now + 600,
    })}`;

    return `Bearer ${input}.${crypto.sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

describe('identity — suspended account token (integration: real auth chain, mocked data access)', () => {
    let booted: BootedServiceApp;

    beforeAll(async () => {
        for (const key of ['IDENTITY_DEV_AUTH_USER_ID', 'CLERK_JWT_KEY', 'CLERK_AUTHORIZED_PARTIES']) {
            saved[key] = process.env[key];
        }

        delete process.env['IDENTITY_DEV_AUTH_USER_ID'];
        process.env['CLERK_JWT_KEY'] = publicKey;
        process.env['CLERK_AUTHORIZED_PARTIES'] = AZP;
        booted = await bootIdentityApp();
    });

    afterAll(async () => {
        await booted?.close();

        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    it.each([
        ['GET', '/api/v1/users/me'],
        ['PATCH', '/api/v1/users/me'],
        ['DELETE', '/api/v1/users/me'],
        ['GET', '/api/v1/admin/users'],
    ])('⛔ answers 403 ACCOUNT_SUSPENDED to %s %s', async (method, path) => {
        const response = await fetch(`${booted.baseUrl}${path}`, {
            method,
            headers: { authorization: bearer({ suspended: true }) },
        });

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
    });

    it.each(['/api/v1/users/me/erasure', '/v1/users/me/erasure'])(
        'lets a suspended account past authentication on POST %s',
        async (path) => {
            const response = await fetch(`${booted.baseUrl}${path}`, {
                method: 'POST',
                headers: { authorization: bearer({ suspended: true }) },
            });

            expect(response.status).not.toBe(401);
            expect(response.status).not.toBe(403);
        },
    );

    it('control: the same request without the mark gets past authentication', async () => {
        const response = await fetch(`${booted.baseUrl}/api/v1/users/me`, {
            headers: { authorization: bearer({}) },
        });

        expect(response.status).not.toBe(401);
        expect(response.status).not.toBe(403);
    });
});
