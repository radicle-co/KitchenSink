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
    buildTransitionAzpPattern,
    hasExactlyOneAzpMode,
    isClerkVerificationError,
    isNativeClientToken,
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

    // ── R10 regression: a native (@clerk/expo) token has NO azp; list mode must still accept it ──
    // In list mode we delegate the azp decision to @clerk/backend, whose assertAuthorizedPartiesClaim
    // RETURNS EARLY when azp is absent (`if (!azp || !authorizedParties...) return`) — so an azp-less
    // token passes even with a non-empty allowlist. That is why mobile (which mints azp-less native
    // tokens and calls the list-mode identity service) is NOT affected by the sandbox-web pattern-mode
    // migration. This test pins that our wrapper adds NO azp rejection of its own in list mode; if it
    // ever did, every mobile request would 401. Absent-azp is only rejected in self-owned PATTERN mode.
    it('accepts an azp-less (native) token in list mode — delegates the skip-on-absent-azp to Clerk', async () => {
        mockVerify.mockResolvedValue({ sub: 'mobile_user', scopes: [], permissions: [] } as never);

        const claims = await verifyClerkToken('tok', {
            jwtKey: 'PEM',
            authorizedParties: ['https://commise.app', 'https://app.commise.app'],
        });

        expect(claims.sub).toBe('mobile_user');
        expect(claims.azp).toBeUndefined();
        // We forwarded the allowlist to Clerk (which owns the azp decision) and did NOT add our own check.
        expect(mockVerify).toHaveBeenCalledWith('tok', {
            jwtKey: 'PEM',
            authorizedParties: ['https://commise.app', 'https://app.commise.app'],
        });
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

    it.each([
        ['path-routed apex origin (pre-cutover previews)', 'https://sandbox.commise.app'],
        ['per-PR subdomain (post-cutover previews)', 'https://pr-42.sandbox.commise.app'],
    ])('under a TRANSITION pattern, accepts %s so no in-flight preview 401s during cutover', async (_label, azp) => {
        mockVerify.mockResolvedValue({ sub: 'u1', azp } as never);

        const claims = await verifyClerkToken('tok', {
            jwtKey: 'PEM',
            authorizedParties: [],
            authorizedPartyPattern: buildTransitionAzpPattern('sandbox.commise.app'),
        });

        expect(claims.azp).toBe(azp);
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

    it('wires the shared native gate when admitNativeClient is set (pattern mode)', () => {
        const cfg = resolveAzpEnforcement({
            authorizedPartiesRaw: '',
            previewBaseDomain: 'sandbox.commise.app',
            admitNativeClient: true,
        });

        // The wired gate is the shared native-client signal — admits ONLY `client_type: 'native'`.
        expect(cfg.admitAzplessToken?.({ client_type: 'native' })).toBe(true);
        expect(cfg.admitAzplessToken?.({ client_type: 'web' })).toBe(false);
        expect(cfg.admitAzplessToken?.({})).toBe(false);
    });

    it('does NOT wire a native gate when admitNativeClient is unset/false', () => {
        expect(
            resolveAzpEnforcement({ authorizedPartiesRaw: '', previewBaseDomain: 'sandbox.commise.app' })
                .admitAzplessToken,
        ).toBeUndefined();
        expect(
            resolveAzpEnforcement({
                authorizedPartiesRaw: '',
                previewBaseDomain: 'sandbox.commise.app',
                admitNativeClient: false,
            }).admitAzplessToken,
        ).toBeUndefined();
    });

    it('an explicit admitAzplessToken overrides the admitNativeClient shortcut', () => {
        const gate = (): boolean => true;
        const cfg = resolveAzpEnforcement({
            authorizedPartiesRaw: '',
            previewBaseDomain: 'sandbox.commise.app',
            admitNativeClient: true,
            admitAzplessToken: gate,
        });

        expect(cfg.admitAzplessToken).toBe(gate);
    });

    it('builds a STRICT (subdomain-only) pattern by default', () => {
        const cfg = resolveAzpEnforcement({ authorizedPartiesRaw: '', previewBaseDomain: 'sandbox.commise.app' });

        expect(cfg.authorizedPartyPattern?.test('https://pr-7.sandbox.commise.app')).toBe(true);
        // Default (strict) rejects the base apex — only subdomains are admitted.
        expect(cfg.authorizedPartyPattern?.test('https://sandbox.commise.app')).toBe(false);
    });

    it("builds a TRANSITION pattern (base apex + subdomains) when previewMode is 'transition'", () => {
        const cfg = resolveAzpEnforcement({
            authorizedPartiesRaw: '',
            previewBaseDomain: 'sandbox.commise.app',
            previewMode: 'transition',
        });

        // Cutover window: both the path-routed apex origin and the new subdomains are accepted.
        expect(cfg.authorizedPartyPattern?.test('https://sandbox.commise.app')).toBe(true);
        expect(cfg.authorizedPartyPattern?.test('https://pr-7.sandbox.commise.app')).toBe(true);
        expect(cfg.authorizedPartyPattern?.test('https://pr-7.evil.commise.app')).toBe(false);
    });

    it.each([['strict'], ['STRICT'], ['transitional'], ['  '], ['true']])(
        'fails safe to the STRICT pattern for any previewMode value other than exactly "transition" (%j)',
        (previewMode) => {
            const cfg = resolveAzpEnforcement({
                authorizedPartiesRaw: '',
                previewBaseDomain: 'sandbox.commise.app',
                previewMode,
            });

            // A mistyped/unknown mode must NOT widen the boundary — the apex stays rejected.
            expect(cfg.authorizedPartyPattern?.test('https://sandbox.commise.app')).toBe(false);
            expect(cfg.authorizedPartyPattern?.test('https://pr-7.sandbox.commise.app')).toBe(true);
        },
    );
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

    it('rejects the bare base origin — strict mode is subdomains ONLY', () => {
        const re = buildPreviewAzpPattern('sandbox.commise.app');

        // The apex (path-routed) origin is NOT a preview subdomain; strict mode must reject it.
        expect(re.test('https://sandbox.commise.app')).toBe(false);
    });
});

describe('buildTransitionAzpPattern (cutover)', () => {
    it('accepts BOTH the bare base origin and pr-{N} subdomains', () => {
        const re = buildTransitionAzpPattern('sandbox.commise.app');

        // During cutover, path-routed previews still mint azp=base while new previews mint azp=subdomain.
        expect(re.test('https://sandbox.commise.app')).toBe(true);
        expect(re.test('https://pr-1.sandbox.commise.app')).toBe(true);
        expect(re.test('https://pr-4242.sandbox.commise.app')).toBe(true);
    });

    it('rejects the same near-misses strict mode rejects (the optional pr- label is the only relaxation)', () => {
        const re = buildTransitionAzpPattern('sandbox.commise.app');

        expect(re.test('https://pr-1.evil.commise.app')).toBe(false); // sibling look-alike
        expect(re.test('https://evil.sandbox.commise.app')).toBe(false); // arbitrary non-pr subdomain
        expect(re.test('https://pr-4x.sandbox.commise.app')).toBe(false); // non-digit label
        expect(re.test('https://sandbox.commise.app.evil.com')).toBe(false); // trailing content
        expect(re.test('http://sandbox.commise.app')).toBe(false); // http scheme
        expect(re.test(' https://sandbox.commise.app')).toBe(false); // leading junk
        expect(re.test('https://sandbox.commise.app/')).toBe(false); // trailing slash
        expect(re.source.startsWith('^')).toBe(true);
        expect(re.source.endsWith('$')).toBe(true);
    });

    it('does not admit a bare non-pr subdomain — only the exact apex or a pr-{N} label', () => {
        const re = buildTransitionAzpPattern('sandbox.commise.app');

        // "staging.sandbox.commise.app" is neither the apex nor a pr-{N} label.
        expect(re.test('https://staging.sandbox.commise.app')).toBe(false);
    });
});

describe('isNativeClientToken', () => {
    it('admits ONLY a token whose client_type claim is exactly "native"', () => {
        expect(isNativeClientToken({ client_type: 'native' })).toBe(true);
        expect(isNativeClientToken({ client_type: 'web' })).toBe(false);
        expect(isNativeClientToken({ client_type: 'Native' })).toBe(false);
        expect(isNativeClientToken({})).toBe(false);
        expect(isNativeClientToken({ client_type: 123 })).toBe(false);
    });
});
