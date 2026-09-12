/**
 * Unit tests for {@link FoodServiceErasureAuthService} — the food service-principal token verifier
 * (CR-002 / U4b / R11). Drives the REAL `jose` verification against genuinely-signed Ed25519 tokens (no
 * mocks), exactly as production will.
 *
 * The negative cases are the security GATE: a forged, unsigned/alg-confused, expired, over-window,
 * wrong-issuer, wrong-audience (incl. a RECIPE-audience token — cross-service replay), or malformed token
 * MUST be rejected (→ `UnauthorizedException`). The positive case proves a correctly-bound token yields the
 * bound owner from the token, never a request value.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { SERVICE_ERASURE_TOKEN_AUDIENCE, SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS } from '@kitchensink/recipe-core';

import { FoodServiceErasureAuthService } from '../foodServiceErasureAuth.service.js';
import {
    generateServiceKeypair,
    signServiceErasureToken,
    type ServiceKeypair,
} from '../../../tests/support/serviceToken.js';

const KEY_ENV = 'FOOD_SERVICE_PRINCIPAL_JWT_KEY';
const OWNER = '01JOWNER00000000000000000A';

let trusted: ServiceKeypair;
let untrusted: ServiceKeypair;

const NO_KEY = Symbol('no-key');

function makeService(publicKeyPem: string | typeof NO_KEY = trusted.publicKeyPem): FoodServiceErasureAuthService {
    if (publicKeyPem === NO_KEY) {
        delete process.env[KEY_ENV];
    } else {
        process.env[KEY_ENV] = publicKeyPem;
    }

    return new FoodServiceErasureAuthService();
}

beforeAll(async () => {
    [trusted, untrusted] = await Promise.all([generateServiceKeypair(), generateServiceKeypair()]);
});

afterEach(() => {
    delete process.env[KEY_ENV];
});

describe('a valid, correctly-bound food token', () => {
    it('yields the bound target owner, event id, and actor read from the SIGNED token', async () => {
        const service = makeService();
        const token = await signServiceErasureToken(trusted.privateKeyPem, {
            ownerId: OWNER,
            eventId: 'evt_del_9',
            actor: 'identity-deletion-worker',
        });

        await expect(service.verify(token)).resolves.toEqual({
            ownerId: OWNER,
            eventId: 'evt_del_9',
            actor: 'identity-deletion-worker',
        });
    });
});

describe('the rejection GATE (a leaked/crafted credential must never verify)', () => {
    it('rejects a token signed by a DIFFERENT key than the trusted one (forged)', async () => {
        const service = makeService();
        const forged = await signServiceErasureToken(untrusted.privateKeyPem, { ownerId: OWNER });

        await expect(service.verify(forged)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token whose signature has been stripped', async () => {
        const service = makeService();
        const valid = await signServiceErasureToken(trusted.privateKeyPem, { ownerId: OWNER });
        const [header, payload] = valid.split('.');

        await expect(service.verify(`${header}.${payload}.`)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an `alg: none` token (algorithm-confusion) even with the right claims', async () => {
        const service = makeService();
        const b64 = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');
        const noneToken = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
            sub: OWNER,
            evt: 'e',
            act: 'w',
            iss: 'urn:commise:identity:deletion-worker',
            aud: 'urn:commise:food-service:account-erasure',
        })}.`;

        await expect(service.verify(noneToken)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an EXPIRED token', async () => {
        const service = makeService();
        const expired = await signServiceErasureToken(trusted.privateKeyPem, { ownerId: OWNER, expiresInSeconds: -60 });

        await expect(service.verify(expired)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token whose lifetime window exceeds the max TTL, even if not yet expired', async () => {
        const service = makeService();
        const overWindow = await signServiceErasureToken(trusted.privateKeyPem, {
            ownerId: OWNER,
            expiresInSeconds: SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS + 600,
        });

        await expect(service.verify(overWindow)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token from the WRONG issuer', async () => {
        const service = makeService();
        const wrongIssuer = await signServiceErasureToken(trusted.privateKeyPem, {
            ownerId: OWNER,
            issuer: 'urn:commise:some-other-service',
        });

        await expect(service.verify(wrongIssuer)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token minted for the RECIPE audience — cross-service replay is impossible', async () => {
        const service = makeService();
        const recipeAudienceToken = await signServiceErasureToken(trusted.privateKeyPem, {
            ownerId: OWNER,
            audience: SERVICE_ERASURE_TOKEN_AUDIENCE,
        });

        await expect(service.verify(recipeAudienceToken)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a cryptographically-valid token missing a required custom claim (evt)', async () => {
        const service = makeService();
        const noEvt = await signServiceErasureToken(trusted.privateKeyPem, { ownerId: OWNER, omitClaims: ['evt'] });

        await expect(service.verify(noEvt)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('FAILS CLOSED when no verification key is configured — every token is rejected', async () => {
        const service = makeService(NO_KEY);
        const token = await signServiceErasureToken(trusted.privateKeyPem, { ownerId: OWNER });

        await expect(service.verify(token)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a structurally-invalid bearer string', async () => {
        const service = makeService();

        await expect(service.verify('not-a-jwt')).rejects.toBeInstanceOf(UnauthorizedException);
    });
});
