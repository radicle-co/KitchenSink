/**
 * Integration: an impersonation session token is refused by the REAL verifier (owner ruling 2026-10-15).
 *
 * `verifyClerkToken` over the real `@clerk/backend` `verifyToken`, against tokens RS256-signed here with a throwaway
 * key. The unit suite mocks the SDK, so it proves the `act` rule over a payload it wrote itself; this proves the
 * signed token the SDK actually hands back still carries `act` through to the rule — a validly signed token with
 * `act` is refused, the same token without it is admitted.
 */
import crypto from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { isClerkVerificationError, verifyClerkToken } from '../src/clerkVerify.js';

const AZP = 'https://impersonation.example.com';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const config = { jwtKey: publicKey, authorizedParties: [AZP] };

/**
 * A Clerk-shaped RS256 session token carrying `claims` on top of the standard time and `azp` claims.
 *
 * @sideEffect Reads the clock and signs with the private key.
 */
function sign(claims: Record<string, unknown>): string {
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

    return `${input}.${crypto.sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

describe('verifyClerkToken — impersonation, over a really signed token', () => {
    it('⛔ refuses a validly signed token carrying an act claim', async () => {
        await expect(verifyClerkToken(sign({ act: { sub: 'user_admin' } }), config)).rejects.toSatisfy(
            isClerkVerificationError,
        );
    });

    it('admits the same token without act, and with a null act', async () => {
        expect((await verifyClerkToken(sign({}), config)).sub).toBe('user_target');
        expect((await verifyClerkToken(sign({ act: null }), config)).sub).toBe('user_target');
    });
});
