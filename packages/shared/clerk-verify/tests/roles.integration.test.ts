/**
 * Integration: roles through the REAL verifier (plan 2026-10-14-009 D3).
 *
 * `verifyClerkToken` over the REAL `@clerk/backend` `verifyToken`, against tokens RS256-signed here with a throwaway
 * key (Clerk's networkless `jwtKey` path accepts a 2048-bit SPKI PEM verbatim). The unit suite mocks `verifyToken`, so
 * it proves the claim mapping over a payload it wrote itself; this proves the mapping over what the SDK actually
 * hands back from a signed token — and that a FORGED `roles` claim (wrong key, or outside `public_metadata`) grants
 * nothing.
 */
import crypto from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { isClerkVerificationError, verifyClerkToken } from '../src/clerkVerify.js';
import { ROLE_SCOPES } from '../src/roles.js';

const AZP = 'https://roles.example.com';

/** A throwaway RSA keypair: the SPKI public PEM (the `jwtKey`) and the PKCS#8 private PEM that signs. */
function keypair(): { readonly publicPem: string; readonly privatePem: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    return { publicPem: publicKey, privatePem: privateKey };
}

/**
 * A Clerk-shaped RS256 session token carrying `claims` on top of the standard time and `azp` claims.
 *
 * @sideEffect Reads the clock and signs with the private key.
 */
function sign(privatePem: string, claims: Record<string, unknown>): string {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    const input = `${encode({ alg: 'RS256', typ: 'JWT', kid: 'local' })}.${encode({
        sub: 'user_roles',
        azp: AZP,
        iat: now,
        nbf: now - 5,
        exp: now + 600,
        ...claims,
    })}`;

    return `${input}.${crypto.sign('RSA-SHA256', Buffer.from(input), privatePem).toString('base64url')}`;
}

const trusted = keypair();
const config = { jwtKey: trusted.publicPem, authorizedParties: [AZP] };

describe('verifyClerkToken — roles from a really signed token', () => {
    it('parses public_metadata.roles and expands a superuser into every scope', async () => {
        const claims = await verifyClerkToken(
            sign(trusted.privatePem, { public_metadata: { roles: ['superuser'] } }),
            config,
        );

        expect(claims.roles).toStrictEqual(['superuser']);
        expect([...claims.scopes].sort()).toStrictEqual([...ROLE_SCOPES.superuser].sort());
    });

    it('expands an admin into every scope as well (owner ruling 2026-10-15)', async () => {
        const claims = await verifyClerkToken(
            sign(trusted.privatePem, { public_metadata: { roles: ['admin'] } }),
            config,
        );

        expect(claims.roles).toStrictEqual(['admin']);
        expect([...claims.scopes].sort()).toStrictEqual([...ROLE_SCOPES.superuser].sort());
        expect([...claims.scopes].sort()).toStrictEqual([
            'admin:users',
            'food:admin',
            'recipes:import:public',
            'recipes:mappings:global',
            'recipes:parses:global',
        ]);
    });

    it('keeps an explicit scope beside the role-implied ones', async () => {
        const claims = await verifyClerkToken(
            sign(trusted.privatePem, { public_metadata: { roles: ['premium'], scopes: ['recipes:import:public'] } }),
            config,
        );

        expect(claims.roles).toStrictEqual(['premium']);
        expect(claims.scopes).toStrictEqual(['recipes:import:public']);
    });

    it('⛔ grants nothing for a top-level roles claim outside public_metadata', async () => {
        const claims = await verifyClerkToken(sign(trusted.privatePem, { roles: ['superuser'] }), config);

        expect(claims.roles).toStrictEqual([]);
        expect(claims.scopes).toStrictEqual([]);
    });

    it('⛔ grants nothing for unsafe_metadata.roles (user-writable from the browser)', async () => {
        const claims = await verifyClerkToken(
            sign(trusted.privatePem, { unsafe_metadata: { roles: ['superuser'] } }),
            config,
        );

        expect(claims.roles).toStrictEqual([]);
    });

    it('⛔ rejects a superuser token signed by any other key', async () => {
        const forged = keypair();

        await expect(
            verifyClerkToken(sign(forged.privatePem, { public_metadata: { roles: ['superuser'] } }), config),
        ).rejects.toSatisfy(isClerkVerificationError);
    });
});
