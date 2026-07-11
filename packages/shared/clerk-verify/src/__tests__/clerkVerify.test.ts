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

import {
    buildPreviewAzpPattern,
    hasExactlyOneAzpMode,
    isClerkVerificationError,
    resolveAzpEnforcement,
    verifyClerkToken,
} from '../clerkVerify.js';

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

    it('surfaces the app-user ULID from the external_id claim as userId (T000-prereq)', async () => {
        mockVerify.mockResolvedValue({
            sub: 'user_123',
            external_id: '01J9ZK8N7QF3B2X4M6T0V5C1AB',
            azp: 'https://app.example.com',
        } as never);

        const claims = await verifyClerkToken('tok', CONFIG);

        expect(claims.userId).toBe('01J9ZK8N7QF3B2X4M6T0V5C1AB');
    });

    it('leaves userId undefined when external_id is absent or empty (shared verifier is backward-compatible; per-service policy fails closed)', async () => {
        // empty-string external_id
        mockVerify.mockResolvedValue({ sub: 'user_123', external_id: '' } as never);
        expect((await verifyClerkToken('tok', CONFIG)).userId).toBeUndefined();

        // external_id omitted entirely (no key on the payload)
        mockVerify.mockResolvedValue({ sub: 'user_123' } as never);
        expect((await verifyClerkToken('tok', CONFIG)).userId).toBeUndefined();
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

const PATTERN = buildPreviewAzpPattern('sandbox.commise.app');
const PATTERN_CONFIG = { jwtKey: 'PEM', authorizedParties: [], authorizedPartyPattern: PATTERN };

describe('verifyClerkToken — azp predicate mode (U1)', () => {
    it('accepts a token whose azp matches the anchored preview pattern, and validates azp itself (SDK check skipped)', async () => {
        mockVerify.mockResolvedValue({ sub: 'u1', azp: 'https://pr-42.sandbox.commise.app' } as never);

        const claims = await verifyClerkToken('tok', PATTERN_CONFIG);

        expect(claims.azp).toBe('https://pr-42.sandbox.commise.app');
        // Pattern mode validates azp itself, so the SDK azp check must be skipped (authorizedParties undefined).
        expect(mockVerify).toHaveBeenCalledWith('tok', { jwtKey: 'PEM', authorizedParties: undefined });
    });

    it.each([
        ['sibling look-alike domain', 'https://pr-42.evil.commise.app'],
        ['different base subdomain', 'https://pr-42.prod.commise.app'],
        ['trailing content after the host', 'https://pr-42.sandbox.commise.app.evil.com'],
        ['non-digit label near-miss', 'https://pr-4x.sandbox.commise.app'],
        ['missing pr- prefix', 'https://42.sandbox.commise.app'],
        ['http scheme, not https', 'http://pr-42.sandbox.commise.app'],
        ['leading junk before the scheme', ' https://pr-42.sandbox.commise.app'],
    ])('rejects a mismatched azp (%s)', async (_label, azp) => {
        mockVerify.mockResolvedValue({ sub: 'u1', azp } as never);

        await expect(verifyClerkToken('tok', PATTERN_CONFIG)).rejects.toSatisfy(isClerkVerificationError);
    });

    it('rejects an azp-less token under pattern mode when no native-admission gate is configured', async () => {
        mockVerify.mockResolvedValue({ sub: 'u1' } as never);

        await expect(verifyClerkToken('tok', PATTERN_CONFIG)).rejects.toSatisfy(isClerkVerificationError);
    });

    it('admits an azp-less token ONLY via a positive native-admission gate, never azp-absence alone', async () => {
        mockVerify.mockResolvedValue({ sub: 'u1', client_type: 'native' } as never);

        const claims = await verifyClerkToken('tok', {
            ...PATTERN_CONFIG,
            admitAzplessToken: (payload) => payload['client_type'] === 'native',
        });

        expect(claims.sub).toBe('u1');
    });

    it('does NOT consult the native-admission gate when azp IS present — the pattern still governs', async () => {
        mockVerify.mockResolvedValue({
            sub: 'u1',
            azp: 'https://pr-42.evil.commise.app',
            client_type: 'native',
        } as never);

        // azp present but mismatched → rejected even though the native gate would admit an azp-less token.
        await expect(verifyClerkToken('tok', { ...PATTERN_CONFIG, admitAzplessToken: () => true })).rejects.toSatisfy(
            isClerkVerificationError,
        );
    });
});

describe('resolveAzpEnforcement', () => {
    it('selects exact-match list mode from the comma list when no preview base domain is set', () => {
        const cfg = resolveAzpEnforcement({
            authorizedPartiesRaw: 'https://a.app, https://b.app',
            previewBaseDomain: undefined,
        });

        expect(cfg.authorizedParties).toEqual(['https://a.app', 'https://b.app']);
        expect(cfg.authorizedPartyPattern).toBeUndefined();
    });

    it('selects pattern mode when a preview base domain is set', () => {
        const cfg = resolveAzpEnforcement({ authorizedPartiesRaw: '', previewBaseDomain: 'sandbox.commise.app' });

        expect(cfg.authorizedPartyPattern?.test('https://pr-7.sandbox.commise.app')).toBe(true);
        expect(cfg.authorizedPartyPattern?.test('https://pr-7.evil.commise.app')).toBe(false);
    });

    it('treats a whitespace-only base domain as unset (falls back to list mode)', () => {
        const cfg = resolveAzpEnforcement({ authorizedPartiesRaw: 'https://a.app', previewBaseDomain: '   ' });

        expect(cfg.authorizedPartyPattern).toBeUndefined();
        expect(cfg.authorizedParties).toEqual(['https://a.app']);
    });

    it('carries the native-admission gate into pattern mode', () => {
        const gate = (): boolean => true;
        const cfg = resolveAzpEnforcement({
            authorizedPartiesRaw: '',
            previewBaseDomain: 'sandbox.commise.app',
            admitAzplessToken: gate,
        });

        expect(cfg.admitAzplessToken).toBe(gate);
    });
});

describe('hasExactlyOneAzpMode', () => {
    it('is true for exactly one mode, false for both (ambiguous) or neither (fail-open)', () => {
        expect(hasExactlyOneAzpMode(true, false)).toBe(true); // list only
        expect(hasExactlyOneAzpMode(false, true)).toBe(true); // pattern only
        expect(hasExactlyOneAzpMode(true, true)).toBe(false); // both → ambiguous
        expect(hasExactlyOneAzpMode(false, false)).toBe(false); // neither → fail-open
    });
});

describe('buildPreviewAzpPattern', () => {
    it('anchors both ends and escapes dots in the base domain', () => {
        const re = buildPreviewAzpPattern('sandbox.commise.app');

        expect(re.test('https://pr-1.sandbox.commise.app')).toBe(true);
        // Dots are escaped → a literal dot is required, not an arbitrary character.
        expect(re.test('https://pr-1xsandboxxcommisexapp')).toBe(false);
        // Anchored → no leading/trailing slop.
        expect(re.test(' https://pr-1.sandbox.commise.app')).toBe(false);
        expect(re.test('https://pr-1.sandbox.commise.app/')).toBe(false);
        expect(re.source.startsWith('^')).toBe(true);
        expect(re.source.endsWith('$')).toBe(true);
    });
});
