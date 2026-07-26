/**
 * Unit tests for the deletion-worker's service-erasure token MINTER (CR-002 / U4b — the producer side of
 * the {@link import('@kitchensink/recipe-core').buildServiceErasureJwtClaims} wire contract).
 *
 * These prove the minted token is EXACTLY what the U4a verifier (recipe-service) and its food-service
 * mirror accept: the pinned algorithm/issuer, the caller-chosen audience, the bound `sub`/`evt`/`act`
 * claims, and a short `iat`/`exp` window inside the contract's max TTL. The verification side is exercised
 * here with `jose` directly (the same primitive both services use) so a drift between minter and verifier
 * fails this test, not production.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { exportPKCS8, exportSPKI, generateKeyPair, jwtVerify, importSPKI } from 'jose';
import {
    SERVICE_ERASURE_TOKEN_ALG,
    SERVICE_ERASURE_TOKEN_AUDIENCE,
    SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD,
    SERVICE_ERASURE_TOKEN_ISSUER,
    SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS,
} from '@kitchensink/recipe-core';

import { mintServiceErasureToken, SERVICE_ERASURE_TOKEN_DEFAULT_TTL_SECONDS } from '../service-erasure-token.js';

let privateKeyPem: string;
let publicKeyPem: string;

beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair(SERVICE_ERASURE_TOKEN_ALG, { extractable: true });
    privateKeyPem = await exportPKCS8(privateKey);
    publicKeyPem = await exportSPKI(publicKey);
});

const OWNER = '01JOWNER00000000000000000A';

describe('mintServiceErasureToken', () => {
    it('mints a token the recipe verifier accepts, with the bound sub/evt/act claims', async () => {
        const token = await mintServiceErasureToken({
            privateKeyPem,
            audience: SERVICE_ERASURE_TOKEN_AUDIENCE,
            ownerId: OWNER,
            eventId: 'evt_123',
            actor: 'identity-deletion-worker',
        });

        const key = await importSPKI(publicKeyPem, SERVICE_ERASURE_TOKEN_ALG);
        const { payload, protectedHeader } = await jwtVerify(token, key, {
            algorithms: [SERVICE_ERASURE_TOKEN_ALG],
            issuer: SERVICE_ERASURE_TOKEN_ISSUER,
            audience: SERVICE_ERASURE_TOKEN_AUDIENCE,
        });

        expect(protectedHeader.alg).toBe(SERVICE_ERASURE_TOKEN_ALG);
        expect(payload.sub).toBe(OWNER);
        expect(payload['evt']).toBe('evt_123');
        expect(payload['act']).toBe('identity-deletion-worker');
        expect(payload.iss).toBe(SERVICE_ERASURE_TOKEN_ISSUER);
        expect(payload.aud).toBe(SERVICE_ERASURE_TOKEN_AUDIENCE);
    });

    it('binds the audience: a recipe-audience token is REJECTED when verified against the food audience', async () => {
        const token = await mintServiceErasureToken({
            privateKeyPem,
            audience: SERVICE_ERASURE_TOKEN_AUDIENCE,
            ownerId: OWNER,
            eventId: 'e',
            actor: 'w',
        });

        const key = await importSPKI(publicKeyPem, SERVICE_ERASURE_TOKEN_ALG);

        await expect(
            jwtVerify(token, key, {
                algorithms: [SERVICE_ERASURE_TOKEN_ALG],
                issuer: SERVICE_ERASURE_TOKEN_ISSUER,
                audience: SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD,
            }),
        ).rejects.toThrow();
    });

    it('can mint for the food audience (the R11 leg)', async () => {
        const token = await mintServiceErasureToken({
            privateKeyPem,
            audience: SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD,
            ownerId: OWNER,
            eventId: 'e',
            actor: 'w',
        });

        const key = await importSPKI(publicKeyPem, SERVICE_ERASURE_TOKEN_ALG);
        const { payload } = await jwtVerify(token, key, {
            algorithms: [SERVICE_ERASURE_TOKEN_ALG],
            issuer: SERVICE_ERASURE_TOKEN_ISSUER,
            audience: SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD,
        });

        expect(payload.aud).toBe(SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD);
    });

    it('sets a short window: exp - iat equals the default TTL and is well inside the contract cap', async () => {
        const now = new Date('2026-07-26T00:00:00.000Z');
        const token = await mintServiceErasureToken({
            privateKeyPem,
            audience: SERVICE_ERASURE_TOKEN_AUDIENCE,
            ownerId: OWNER,
            eventId: 'e',
            actor: 'w',
            now,
        });

        const key = await importSPKI(publicKeyPem, SERVICE_ERASURE_TOKEN_ALG);
        const { payload } = await jwtVerify(token, key, {
            algorithms: [SERVICE_ERASURE_TOKEN_ALG],
            issuer: SERVICE_ERASURE_TOKEN_ISSUER,
            audience: SERVICE_ERASURE_TOKEN_AUDIENCE,
            currentDate: now,
        });

        const iat = payload.iat as number;
        const exp = payload.exp as number;
        expect(iat).toBe(Math.floor(now.getTime() / 1000));
        expect(exp - iat).toBe(SERVICE_ERASURE_TOKEN_DEFAULT_TTL_SECONDS);
        expect(exp - iat).toBeLessThanOrEqual(SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS);
    });

    it('CAPS an over-large requested TTL at the contract max (a mis-minted far-future exp is impossible)', async () => {
        const now = new Date('2026-07-26T00:00:00.000Z');
        const token = await mintServiceErasureToken({
            privateKeyPem,
            audience: SERVICE_ERASURE_TOKEN_AUDIENCE,
            ownerId: OWNER,
            eventId: 'e',
            actor: 'w',
            ttlSeconds: 100_000,
            now,
        });

        const key = await importSPKI(publicKeyPem, SERVICE_ERASURE_TOKEN_ALG);
        const { payload } = await jwtVerify(token, key, {
            algorithms: [SERVICE_ERASURE_TOKEN_ALG],
            issuer: SERVICE_ERASURE_TOKEN_ISSUER,
            audience: SERVICE_ERASURE_TOKEN_AUDIENCE,
            currentDate: now,
        });

        expect((payload.exp as number) - (payload.iat as number)).toBe(SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS);
    });
});
