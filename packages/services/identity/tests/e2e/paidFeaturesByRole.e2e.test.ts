/**
 * LOCAL e2e — `account.paidFeatures` by role, through the REAL chain against a REAL PostgreSQL (plan 2026-10-14-009 D3,
 * D6, D8). Target: LOCAL (§7.1a).
 *
 * No dev-auth bypass: each request carries an RS256 token signed by a throwaway key that the booted app trusts
 * (`CLERK_JWT_KEY`), so the real `AuthMiddleware` → `verifyClerkToken` (which parses `public_metadata.roles`) → the
 * read-through user resolution (real rows, as `identity_service`) → `paidFeatureAccess` → `GET /api/v1/users/me`. The
 * paid-features gate is the env var the stack sets, read once at boot, so each gate value boots its own app.
 *
 * Owner ruling 2026-10-13: an entitled role (admin, superuser, vip, premium) is `granted` under both gate values; anyone
 * else is `upsell` with the gate on and `hidden` with it off.
 */
import 'reflect-metadata';

import crypto from 'node:crypto';

import { userProfileSchema } from '@kitchensink/schema-identity';
import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { bootIdentityApp } from '../support/identityApp.js';
import { identityDb } from '../support/roleDb.js';

const AZP = 'http://localhost:3000';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

/**
 * A Clerk-shaped session token for `sub`, carrying `roles` in signed `public_metadata` (omitted = no key at all).
 *
 * @sideEffect Reads the clock and signs with the private key.
 */
function bearer(sub: string, roles: readonly string[] | undefined): string {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    const input = `${encode({ alg: 'RS256', typ: 'JWT', kid: 'local' })}.${encode({
        sub,
        azp: AZP,
        email: `${sub}@example.test`,
        iat: now,
        nbf: now - 5,
        exp: now + 600,
        public_metadata: roles === undefined ? {} : { roles },
    })}`;

    return `Bearer ${input}.${crypto.sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

/**
 * Boot the real app with the gate set as the CDK stack sets it.
 *
 * @sideEffect Sets the Clerk and gate env vars, and starts an HTTP listener.
 */
async function boot(gate: 'true' | 'false'): Promise<BootedServiceApp> {
    delete process.env['IDENTITY_DEV_AUTH_USER_ID'];
    process.env['CLERK_JWT_KEY'] = publicKey;
    process.env['CLERK_AUTHORIZED_PARTIES'] = AZP;
    process.env['PAID_FEATURES_GATE'] = gate;

    return bootIdentityApp({ databaseUrl: identityDb().appUrl });
}

describe.each([
    ['on', 'true', 'upsell'],
    ['off', 'false', 'hidden'],
] as const)('GET /api/v1/users/me by role, gate %s (LOCAL e2e, real token + real database)', (_label, gate, others) => {
    let booted: BootedServiceApp;

    beforeAll(async () => {
        booted = await boot(gate);
    });

    afterAll(async () => {
        await booted?.close();
        delete process.env['PAID_FEATURES_GATE'];
    });

    beforeEach(async () => {
        await identityDb().truncate();
    });

    async function paidFeaturesOf(sub: string, roles: readonly string[] | undefined): Promise<string> {
        const response = await fetch(`${booted.baseUrl}/api/v1/users/me`, {
            headers: { authorization: bearer(sub, roles) },
        });

        expect(response.status).toBe(200);

        return userProfileSchema.parse(await response.json()).account.paidFeatures;
    }

    it.each(['admin', 'superuser', 'vip', 'premium'])('%s is granted', async (role) => {
        expect(await paidFeaturesOf(`user_${role}_${gate}`, [role])).toBe('granted');
    });

    it(`default is ${others}`, async () => {
        expect(await paidFeaturesOf(`user_default_${gate}`, ['default'])).toBe(others);
    });

    it(`a token with no roles key is ${others} — never granted`, async () => {
        expect(await paidFeaturesOf(`user_noroles_${gate}`, undefined)).toBe(others);
    });
});
