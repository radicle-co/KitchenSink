/**
 * Unit tests for the service-principal account-erasure token WIRE CONTRACT (CR-002 / U4a).
 *
 * The token's cryptographic verification lives in `@kitchensink/recipe-service`; this file pins only the
 * package-crossing contract both sides depend on — the fixed issuer/audience/algorithm/TTL, the
 * signer↔verifier claim mapping ({@link buildServiceErasureJwtClaims} ↔ {@link parseServiceErasureClaims}),
 * and the trigger-source guard — so producer (U4b signer) and consumer (U4a verifier) cannot drift.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
    SERVICE_ERASURE_TOKEN_ISSUER,
    SERVICE_ERASURE_TOKEN_AUDIENCE,
    SERVICE_ERASURE_TOKEN_ALG,
    SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS,
    ERASURE_TRIGGER_SOURCES,
    buildServiceErasureJwtClaims,
    parseServiceErasureClaims,
    isErasureTriggerSource,
    type ServiceErasureTokenClaims,
} from '../serviceErasureToken.js';

const CLAIMS: ServiceErasureTokenClaims = {
    ownerId: '01JOWNER00000000000000000A',
    eventId: 'evt_user_deleted_123',
    actor: 'identity-deletion-worker',
};

describe('service-erasure token contract constants', () => {
    it('pins an asymmetric algorithm (private key on the signer, public key on the verifier)', () => {
        expect(SERVICE_ERASURE_TOKEN_ALG).toBe('EdDSA');
    });

    it('pins a distinct issuer and audience so a token cannot be replayed across services', () => {
        expect(SERVICE_ERASURE_TOKEN_ISSUER).toBe('urn:commise:identity:deletion-worker');
        expect(SERVICE_ERASURE_TOKEN_AUDIENCE).toBe('urn:commise:recipe-service:account-erasure');
        expect(SERVICE_ERASURE_TOKEN_ISSUER).not.toBe(SERVICE_ERASURE_TOKEN_AUDIENCE);
    });

    it('bounds the token lifetime to a short, single-request window', () => {
        expect(SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS).toBeGreaterThan(0);
        expect(SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS).toBeLessThanOrEqual(300);
    });
});

describe('buildServiceErasureJwtClaims', () => {
    it('maps the app-facing fields onto the exact wire claim names the verifier reads', () => {
        expect(buildServiceErasureJwtClaims(CLAIMS)).toEqual({
            sub: CLAIMS.ownerId,
            evt: CLAIMS.eventId,
            act: CLAIMS.actor,
        });
    });

    it('round-trips through parseServiceErasureClaims — signer output is exactly what the verifier decodes', () => {
        const wire = buildServiceErasureJwtClaims(CLAIMS);

        expect(parseServiceErasureClaims({ ...wire, iss: SERVICE_ERASURE_TOKEN_ISSUER })).toEqual(CLAIMS);
    });
});

describe('parseServiceErasureClaims', () => {
    it('reads the bound owner from `sub`, never inventing one', () => {
        const claims = parseServiceErasureClaims({ sub: 'owner-x', evt: 'e', act: 'w' });

        expect(claims.ownerId).toBe('owner-x');
    });

    it.each([
        ['missing sub', { evt: 'e', act: 'w' }],
        ['empty sub', { sub: '', evt: 'e', act: 'w' }],
        ['missing evt', { sub: 'o', act: 'w' }],
        ['empty evt', { sub: 'o', evt: '', act: 'w' }],
        ['missing act', { sub: 'o', evt: 'e' }],
        ['empty act', { sub: 'o', evt: 'e', act: '' }],
    ])('rejects a cryptographically-valid token with %s rather than yielding an empty field', (_label, payload) => {
        expect(() => parseServiceErasureClaims(payload)).toThrow(z.ZodError);
    });
});

describe('isErasureTriggerSource', () => {
    it('accepts exactly the two legitimate sources', () => {
        expect(ERASURE_TRIGGER_SOURCES).toEqual(['user', 'service']);
        expect(isErasureTriggerSource('user')).toBe(true);
        expect(isErasureTriggerSource('service')).toBe(true);
    });

    it.each([['admin'], [''], [null], [undefined], [1]])('rejects the non-source %p', (value) => {
        expect(isErasureTriggerSource(value)).toBe(false);
    });
});
