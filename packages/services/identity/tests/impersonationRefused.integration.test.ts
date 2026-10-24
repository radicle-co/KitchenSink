/**
 * Integration: identity refuses a Clerk impersonation session token with 401 (owner ruling 2026-10-15).
 *
 * The REAL `AuthMiddleware` → `ClerkAuthService` → `@kitchensink/clerk-verify` → `@clerk/backend`'s `verifyToken`,
 * over a genuinely RS256-signed token the booted app trusts. Clerk marks an impersonation session with an `act`
 * claim and signs it like any other, so the signature check alone admits it; only the shared verifier's `act` rule
 * stops it. `pg` and SQS are mocked: the refusal happens before any database call.
 *
 * The control matters: the SAME token without `act` must get past authentication (it then meets the mocked pool and
 * fails for a different reason), otherwise a 401 could be a misconfigured key rather than the `act` rule.
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

/**
 * A Clerk-shaped session token for `user_target`, with `extra` claims on top.
 *
 * @sideEffect Reads the clock and signs with the private key.
 */
function bearer(extra: Record<string, unknown>): string {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    const input = `${encode({ alg: 'RS256', typ: 'JWT', kid: 'local' })}.${encode({
        sub: 'user_target',
        azp: AZP,
        email: 'target@example.test',
        iat: now,
        nbf: now - 5,
        exp: now + 600,
        ...extra,
    })}`;

    return `Bearer ${input}.${crypto.sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

describe('identity — impersonation session token (integration: real auth chain, mocked data access)', () => {
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

    it('⛔ answers 401 to a validly signed token carrying an act claim', async () => {
        const response = await fetch(`${booted.baseUrl}/api/v1/users/me`, {
            headers: { authorization: bearer({ act: { sub: 'user_admin' } }) },
        });

        expect(response.status).toBe(401);
    });

    it('control: the same token without act gets past authentication', async () => {
        const response = await fetch(`${booted.baseUrl}/api/v1/users/me`, {
            headers: { authorization: bearer({}) },
        });

        expect(response.status).not.toBe(401);
    });
});
