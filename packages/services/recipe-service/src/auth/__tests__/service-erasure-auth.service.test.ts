/**
 * Unit tests for {@link ServiceErasureAuthService} — the GREENFIELD service-principal token verifier
 * (CR-002 / U4a). Drives the REAL `jose` verification against genuinely-signed Ed25519 tokens (no mocks),
 * exactly as production will.
 *
 * The negative cases here are the security GATE: a forged, unsigned/alg-confused, expired, over-window,
 * wrong-issuer, wrong-audience, or malformed token MUST be rejected (→ `UnauthorizedException`), so a
 * leaked or crafted credential can never reach the erasure path. The single positive case proves a
 * correctly-signed, correctly-bound token yields the bound target owner from the token — never a
 * request-supplied value.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS } from '@kitchensink/recipe-core';

import { ServiceErasureAuthService } from '../service-erasure-auth.service.js';
import {
    generateServiceKeypair,
    signServiceErasureToken,
    type ServiceKeypair,
} from '../../../tests/support/service-token.js';

const KEY_ENV = 'RECIPE_SERVICE_PRINCIPAL_JWT_KEY';
const OWNER = '01JOWNER00000000000000000A';

/** The keypair the SERVICE trusts, and a SEPARATE untrusted pair used to forge a wrong-key token. */
let trusted: ServiceKeypair;
let untrusted: ServiceKeypair;

/**
 * Build a service configured to trust a key (reads env at construction, like the real one). Pass the
 * sentinel `NO_KEY` to construct with NO key configured — a plain `undefined` cannot be used because it
 * would select the default, so the fail-closed case needs an explicit marker.
 */
const NO_KEY = Symbol('no-key');

function makeService(publicKeyPem: string | typeof NO_KEY = trusted.publicKeyPem): ServiceErasureAuthService {
    if (publicKeyPem === NO_KEY) {
        delete process.env[KEY_ENV];
    } else {
        process.env[KEY_ENV] = publicKeyPem;
    }

    return new ServiceErasureAuthService();
}

beforeAll(async () => {
    [trusted, untrusted] = await Promise.all([generateServiceKeypair(), generateServiceKeypair()]);
});

afterEach(() => {
    delete process.env[KEY_ENV];
});

describe('a valid, correctly-bound token', () => {
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
    it('rejects a token signed by a DIFFERENT key than the trusted one (forged — cryptographic rejection)', async () => {
        const service = makeService();
        const forged = await signServiceErasureToken(untrusted.privateKeyPem, { ownerId: OWNER });

        await expect(service.verify(forged)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token whose signature has been stripped (unsigned/tampered)', async () => {
        const service = makeService();
        const valid = await signServiceErasureToken(trusted.privateKeyPem, { ownerId: OWNER });
        const [header, payload] = valid.split('.');
        const unsigned = `${header}.${payload}.`;

        await expect(service.verify(unsigned)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an `alg: none` token (algorithm-confusion) even with the right claims', async () => {
        const service = makeService();
        const b64 = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');
        const noneToken = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
            sub: OWNER,
            evt: 'e',
            act: 'w',
            iss: 'urn:commise:identity:deletion-worker',
            aud: 'urn:commise:recipe-service:account-erasure',
        })}.`;

        await expect(service.verify(noneToken)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an EXPIRED token', async () => {
        const service = makeService();
        const expired = await signServiceErasureToken(trusted.privateKeyPem, {
            ownerId: OWNER,
            expiresInSeconds: -60,
        });

        await expect(service.verify(expired)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token whose lifetime window exceeds the max TTL, even if not yet expired (defense-in-depth)', async () => {
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

    it('rejects a token for the WRONG audience (minted for a different endpoint)', async () => {
        const service = makeService();
        const wrongAudience = await signServiceErasureToken(trusted.privateKeyPem, {
            ownerId: OWNER,
            audience: 'urn:commise:food-service:something',
        });

        await expect(service.verify(wrongAudience)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a cryptographically-valid token missing a required custom claim (evt) rather than yielding a partial principal', async () => {
        const service = makeService();
        const noEvt = await signServiceErasureToken(trusted.privateKeyPem, {
            ownerId: OWNER,
            omitClaims: ['evt'],
        });

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
