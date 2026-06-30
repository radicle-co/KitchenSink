/**
 * Unit tests for the shared networkless Clerk verification (T-046).
 *
 * `@clerk/backend`'s `verifyToken` is mocked so the suite proves the wrapper's contract — claims
 * extraction, fail-closed behaviour, and the public-metadata-only authorization grant — WITHOUT a
 * real key or any network call (the networkless guarantee is structural: `verifyToken` is passed a
 * `jwtKey`, never a `secretKey`).
 *
 * IMPORTANT (regression guard): `@clerk/backend` (>= 1.34) `verifyToken` RESOLVES THE BARE JWT PAYLOAD
 * on success (and throws on failure) — its declared `{ data, errors }` return type lags the runtime.
 * The success-path mocks below therefore use the bare-payload shape (the real runtime); one case keeps
 * the legacy `{ data }` envelope to prove the wrapper still accepts it. A wrapper that only reads
 * `result.data` (the original bug — it 401'd every valid token) fails these tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/backend', () => ({ verifyToken: vi.fn() }));

import { verifyToken } from '@clerk/backend';

import { isClerkVerificationError, verifyClerkToken } from '../clerk-verify.js';

const mockVerify = vi.mocked(verifyToken);

const CONFIG = { jwtKey: 'PEM', authorizedParties: ['https://app.example.com'] };

beforeEach(() => {
    mockVerify.mockReset();
});

describe('verifyClerkToken', () => {
    it('returns the verified claims from the BARE payload @clerk/backend resolves (sub + azp + grants)', async () => {
        mockVerify.mockResolvedValue({
            sub: 'user_123',
            azp: 'https://app.example.com',
            public_metadata: { scopes: ['food:admin'], permissions: ['p1'] },
        } as never);

        const claims = await verifyClerkToken('tok', CONFIG);

        expect(claims.sub).toBe('user_123');
        expect(claims.azp).toBe('https://app.example.com');
        expect(claims.scopes).toEqual(['food:admin']);
        expect(claims.permissions).toEqual(['p1']);
    });

    it('also accepts the legacy { data } envelope (back-compat across @clerk/backend versions)', async () => {
        mockVerify.mockResolvedValue({
            data: { sub: 'user_legacy', azp: 'https://app.example.com', public_metadata: { scopes: ['s1'] } },
            errors: undefined,
        } as never);

        const claims = await verifyClerkToken('tok', CONFIG);

        expect(claims.sub).toBe('user_legacy');
        expect(claims.scopes).toEqual(['s1']);
    });

    it('passes the configured jwtKey + authorizedParties to verifyToken (networkless, azp-enforced)', async () => {
        mockVerify.mockResolvedValue({ sub: 'user_1' } as never);

        await verifyClerkToken('tok', CONFIG);

        expect(mockVerify).toHaveBeenCalledWith('tok', {
            jwtKey: 'PEM',
            authorizedParties: ['https://app.example.com'],
        });
    });

    it('reads authorization grants ONLY from public_metadata, never a top-level scopes claim', async () => {
        mockVerify.mockResolvedValue({ sub: 'user_1', scopes: ['forged:admin'], public_metadata: {} } as never);

        const claims = await verifyClerkToken('tok', CONFIG);

        expect(claims.scopes).toEqual([]);
        expect(claims.permissions).toEqual([]);
    });

    it('fails closed (throws ClerkVerificationError) and never calls verifyToken when the key is absent', async () => {
        await expect(verifyClerkToken('tok', { jwtKey: undefined, authorizedParties: [] })).rejects.toSatisfy(
            isClerkVerificationError,
        );
        expect(mockVerify).not.toHaveBeenCalled();
    });

    it('throws ClerkVerificationError when verifyToken rejects (bad signature / expiry / wrong azp)', async () => {
        mockVerify.mockRejectedValue(new Error('jwt expired'));

        await expect(verifyClerkToken('tok', CONFIG)).rejects.toSatisfy(isClerkVerificationError);
    });

    it('throws ClerkVerificationError on a legacy failure envelope that carries errors', async () => {
        mockVerify.mockResolvedValue({ data: undefined, errors: [{ message: 'bad' }] } as never);

        await expect(verifyClerkToken('tok', CONFIG)).rejects.toSatisfy(isClerkVerificationError);
    });

    it('throws ClerkVerificationError when the verified payload carries no sub', async () => {
        mockVerify.mockResolvedValue({ public_metadata: {} } as never);

        await expect(verifyClerkToken('tok', CONFIG)).rejects.toSatisfy(isClerkVerificationError);
    });

    it('omits the azp check when no authorized parties are configured (passes undefined, never [])', async () => {
        mockVerify.mockResolvedValue({ sub: 'user_1' } as never);

        await verifyClerkToken('tok', { jwtKey: 'PEM', authorizedParties: [] });

        expect(mockVerify).toHaveBeenCalledWith('tok', { jwtKey: 'PEM', authorizedParties: undefined });
    });
});
