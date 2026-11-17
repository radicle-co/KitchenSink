/**
 * Integration: the publish age claim through the REAL verifier.
 *
 * Publishing needs age 16 or over; the claim is written by identity's age assurance. `verifyClerkToken` runs over the
 * real `@clerk/backend` `verifyToken`, against tokens RS256-signed here with a throwaway key.
 */
import crypto from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyClerkToken } from '../src/clerkVerify.js';

const AZP = 'https://age.example.com';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const config = { jwtKey: publicKey, authorizedParties: [AZP] };

/** @sideEffect Reads the clock and signs with the private key. */
function sign(claims: Record<string, unknown>): string {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    const input = `${encode({ alg: 'RS256', typ: 'JWT', kid: 'local' })}.${encode({
        sub: 'user_age',
        azp: AZP,
        iat: now,
        nbf: now - 5,
        exp: now + 600,
        ...claims,
    })}`;

    return `${input}.${crypto.sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

describe('verifyClerkToken: publishAgeMet from a really signed token', () => {
    it.each([
        [16, true],
        [18, true],
        [15, false],
        ['16', false],
    ])('public_metadata.ageFloorMet %j gives publishAgeMet %s', async (ageFloorMet, expected) => {
        const claims = await verifyClerkToken(sign({ public_metadata: { ageFloorMet } }), config);

        expect(claims.publishAgeMet).toBe(expected);
    });

    it('is false when the claim is absent, or sits outside public_metadata', async () => {
        expect((await verifyClerkToken(sign({}), config)).publishAgeMet).toBe(false);
        expect((await verifyClerkToken(sign({ ageFloorMet: 18 }), config)).publishAgeMet).toBe(false);
        expect((await verifyClerkToken(sign({ unsafe_metadata: { ageFloorMet: 18 } }), config)).publishAgeMet).toBe(
            false,
        );
    });
});
