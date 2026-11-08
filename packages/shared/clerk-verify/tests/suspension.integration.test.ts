/**
 * Integration: a suspended account's token is refused by the REAL verifier (ADR-0081).
 *
 * `verifyClerkToken` over the real `@clerk/backend` `verifyToken`, against tokens RS256-signed here with a throwaway
 * key. The unit suite mocks the SDK; this proves the mark survives the signed round trip and is read from the SAME
 * `public_metadata` object as the scopes and roles — so the claim depends on the instance's session-token template
 * exactly as the admin scopes already do, and on nothing else.
 */
import crypto from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { isClerkAccountSuspendedError } from '../src/accountSuspension.js';
import { isClerkVerificationError, verifyClerkToken } from '../src/clerkVerify.js';

const AZP = 'https://suspension.example.com';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const config = { jwtKey: publicKey, authorizedParties: [AZP] };
const ERASE = { method: 'POST', path: '/api/v1/users/me/erasure' };
const OTHER = { method: 'GET', path: '/api/v1/users/me' };

/** A Clerk-shaped RS256 session token carrying `claims` on top of the standard time and `azp` claims. */
function sign(claims: Record<string, unknown>, signWith = privateKey): string {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    const input = `${encode({ alg: 'RS256', typ: 'JWT', kid: 'local' })}.${encode({
        sub: 'user_target',
        azp: AZP,
        iat: now,
        nbf: now - 5,
        exp: now + 600,
        ...claims,
    })}`;

    return `${input}.${crypto.sign('RSA-SHA256', Buffer.from(input), signWith).toString('base64url')}`;
}

const suspended = (extra: Record<string, unknown> = {}) => sign({ public_metadata: { suspended: true, ...extra } });

describe('verifyClerkToken — suspended accounts, over a really signed token', () => {
    it('⛔ refuses a validly signed token whose public_metadata carries the mark', async () => {
        await expect(verifyClerkToken(suspended(), config, OTHER)).rejects.toSatisfy(isClerkAccountSuspendedError);
    });

    it('⛔ refuses it when no request is named — the safe default', async () => {
        await expect(verifyClerkToken(suspended(), config)).rejects.toSatisfy(isClerkAccountSuspendedError);
    });

    it('admits a suspended token on the erasure route, with its scopes intact', async () => {
        const claims = await verifyClerkToken(suspended({ scopes: ['admin:users'] }), config, ERASE);

        expect(claims.sub).toBe('user_target');
        expect(claims.scopes).toEqual(['admin:users']);
    });

    it('admits it everywhere when the adopter takes no authorization decisions (the edge)', async () => {
        const claims = await verifyClerkToken(suspended(), { ...config, allowSuspended: true }, OTHER);

        expect(claims.sub).toBe('user_target');
    });

    it('admits a token with no mark, a null mark, and a false mark', async () => {
        for (const publicMetadata of [{}, { suspended: null }, { suspended: false }]) {
            expect((await verifyClerkToken(sign({ public_metadata: publicMetadata }), config, OTHER)).sub).toBe(
                'user_target',
            );
        }
    });

    it('⛔ reads the mark from public_metadata only — a top-level or unsafe_metadata value is ignored', async () => {
        expect((await verifyClerkToken(sign({ suspended: true }), config, OTHER)).sub).toBe('user_target');
        expect((await verifyClerkToken(sign({ unsafe_metadata: { suspended: true } }), config, OTHER)).sub).toBe(
            'user_target',
        );
    });

    // The 401-vs-403 difference must not tell a caller anything about a token it could not sign.
    it('⛔ answers a forged token with the verification error, never the suspended one', async () => {
        const other = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });
        const forged = sign({ public_metadata: { suspended: true } }, other.privateKey);

        await expect(verifyClerkToken(forged, config, OTHER)).rejects.toSatisfy(isClerkVerificationError);
    });

    it('⛔ checks azp and impersonation before the mark', async () => {
        await expect(
            verifyClerkToken(
                sign({ azp: 'https://elsewhere.example.com', public_metadata: { suspended: true } }),
                config,
                OTHER,
            ),
        ).rejects.toSatisfy(isClerkVerificationError);
        await expect(
            verifyClerkToken(sign({ act: { sub: 'user_admin' }, public_metadata: { suspended: true } }), config, OTHER),
        ).rejects.toSatisfy(isClerkVerificationError);
    });
});
