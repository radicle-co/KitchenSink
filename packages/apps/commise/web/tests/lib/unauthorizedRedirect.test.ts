/**
 * Guard: the 401 → sign-in recovery must be a CIRCUIT BREAKER, not an unconditional bounce.
 *
 * ## The failure this pins (live production incident, 2026-08-07)
 *
 * Production's web bundle was built with the SANDBOX Clerk dev instance
 * (`pk_test_…nice-fowl-6.clerk.accounts.dev`) while `NEXT_PUBLIC_IDENTITY_API_URL` pointed at the
 * PRODUCTION identity service (`https://identity.commise.app`). Prod identity verifies networklessly against
 * `/kitchensink/prod/clerk/jwt-public-key`, which is the `clerk.commise.app` key — a different RSA modulus
 * from the sandbox instance's. So every token the browser minted failed signature verification and
 * `GET /api/v1/users/me` answered `401`, permanently.
 *
 * The 401 handler then did this, unconditionally:
 *
 *     navigateTo(`${withBasePath('/sign-in')}?redirect_url=${encodeURIComponent(location.pathname)}`)
 *
 * which produced `/sign-in?redirect_url=%2Fen` → middleware locale-redirect → `/en/sign-in?redirect_url=%2Fen`.
 * The visitor's Clerk session was perfectly VALID client-side, so `<SignIn forceRedirectUrl={`/${locale}`}>`
 * immediately sent them back to `/en`, which re-mounted Home, re-fetched the profile, got `401` again, and
 * bounced again. An infinite loop between `/en` and `/en/sign-in?redirect_url=%2Fen`.
 *
 * ## The invariant
 *
 * Bouncing to sign-in is a valid recovery for exactly ONE class of 401: "this browser has no usable
 * session". It cannot fix a 401 that persists ACROSS a sign-in round trip — a wrong-instance token, a
 * rotated verification key, an `azp` mismatch, a clock skew, a service misconfiguration. For those the
 * bounce is not a recovery, it is a loop. So: at most one bounce per originating path per browsing session;
 * after that the `ApiError` must surface to the caller's error boundary instead.
 *
 * The marker lives in `sessionStorage` because the bounce is a FULL-DOCUMENT navigation
 * (`window.location.assign`) — module state does not survive it, which is precisely why the original code
 * could not tell hop 1 from hop 100.
 *
 * ## Mutation check
 *
 * Deleting the `attempted.has` short-circuit in `redirectToSignInOnce` makes "does not bounce a second
 * time…" and "…even after a round trip through the sign-in page" fail. Widening the marker to a
 * path-independent flag makes "still bounces for a DIFFERENT path" fail. Narrowing it back to a single
 * slot makes "remembers EVERY path" fail (and its in-document twin). Reading the in-document fallback only
 * when the READ throws — rather than unioning it in unconditionally — makes "records the attempt when the
 * WRITE throws" fail, which is the asymmetric quota shape Safari private browsing actually presents.
 * Dropping `documentAttempts.clear()` from the reset makes "clears the in-document fallback too" fail.
 * Removing the bound makes "bounds the stored list" fail on length; keeping the OLDEST entries instead of
 * the newest makes the same case fail on the path it just recorded.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    MAX_ATTEMPTED_PATHS,
    buildSignInRedirectUrl,
    redirectToSignInOnce,
    resetUnauthorizedRecovery,
} from '@/lib/unauthorizedRedirect';

const mockNavigateTo = vi.fn();

vi.mock('@/lib/navigation', () => ({
    navigateTo: (url: string) => mockNavigateTo(url),
}));

describe('buildSignInRedirectUrl (pure)', () => {
    it('locates the sign-in page and carries the originating path as redirect_url', () => {
        expect(buildSignInRedirectUrl('/en')).toBe('/sign-in?redirect_url=%2Fen');
    });

    it('percent-encodes the originating path so a nested path cannot inject query structure', () => {
        expect(buildSignInRedirectUrl('/en/recipes/abc?x=1&y=2')).toBe(
            '/sign-in?redirect_url=%2Fen%2Frecipes%2Fabc%3Fx%3D1%26y%3D2',
        );
    });
});

describe('redirectToSignInOnce (circuit breaker)', () => {
    beforeEach(() => {
        // `restoreAllMocks`, not just `clearAllMocks`: the storage-unavailable cases below replace the
        // `sessionStorage` getter with a throwing double via `vi.spyOn`, and `clearAllMocks` leaves that
        // spy installed — the next case's `sessionStorage.clear()` would then throw before it ran.
        vi.restoreAllMocks();
        vi.clearAllMocks();
        resetUnauthorizedRecovery();
        window.sessionStorage.clear();
        window.history.replaceState(null, '', '/en');
    });

    it('bounces to sign-in on the FIRST 401 from a path', () => {
        expect(redirectToSignInOnce()).toBe(true);

        expect(mockNavigateTo).toHaveBeenCalledExactlyOnceWith('/sign-in?redirect_url=%2Fen');
    });

    it('does not bounce a second time for the same path — the loop breaker', () => {
        redirectToSignInOnce();
        mockNavigateTo.mockClear();

        expect(redirectToSignInOnce()).toBe(false);

        expect(mockNavigateTo).not.toHaveBeenCalled();
    });

    it('does not bounce again after a round trip THROUGH the sign-in page (the observed prod loop)', () => {
        // Hop 1: Home 401s and bounces.
        redirectToSignInOnce();

        // The browser really goes to sign-in; <SignIn> sees a valid client session and forces the visitor
        // back to Home. `sessionStorage` survives both full-document navigations — that is the point.
        window.history.replaceState(null, '', '/en/sign-in?redirect_url=%2Fen');
        window.history.replaceState(null, '', '/en');
        mockNavigateTo.mockClear();

        // Hop 2: Home 401s again. Under the old unconditional bounce this navigated and looped forever.
        expect(redirectToSignInOnce()).toBe(false);

        expect(mockNavigateTo).not.toHaveBeenCalled();
    });

    it('still bounces for a DIFFERENT path — one stuck surface must not disable recovery everywhere', () => {
        redirectToSignInOnce();
        mockNavigateTo.mockClear();

        window.history.replaceState(null, '', '/en/profile');

        expect(redirectToSignInOnce()).toBe(true);
        expect(mockNavigateTo).toHaveBeenCalledExactlyOnceWith('/sign-in?redirect_url=%2Fen%2Fprofile');
    });

    it('remembers EVERY path it has bounced from — recording a second path must not re-arm the first', () => {
        // The invariant is "once per originating path per session", which a single-slot marker cannot keep:
        // `/en` bounces (marker=/en), `/en/profile` bounces (marker OVERWRITTEN to /en/profile), and `/en`
        // 401s again — under one slot that is a fresh bounce, and with <SignIn> forcing the visitor straight
        // back it is the production loop again, just two surfaces wide instead of one.
        redirectToSignInOnce();
        window.history.replaceState(null, '', '/en/profile');
        redirectToSignInOnce();
        mockNavigateTo.mockClear();
        window.history.replaceState(null, '', '/en');

        expect(redirectToSignInOnce()).toBe(false);
        expect(mockNavigateTo).not.toHaveBeenCalled();
    });

    it('a pre-list marker from an earlier build (a bare path) is honoured as an attempted path', () => {
        // A visitor mid-session across a deploy still carries the old scalar form. Treating it as garbage
        // would re-arm the breaker for exactly the surface it had already tripped on.
        window.sessionStorage.setItem('commise.unauthorizedRecovery', '/en');

        expect(redirectToSignInOnce()).toBe(false);
        expect(mockNavigateTo).not.toHaveBeenCalled();
    });

    it('an unreadable marker degrades to one more bounce, then trips — never a loop', () => {
        // Garbage cannot say which paths were attempted, so it is read as none: ONE bounce is allowed, the
        // write that follows replaces the garbage with a well-formed list, and the next 401 trips.
        window.sessionStorage.setItem('commise.unauthorizedRecovery', '{not json');

        expect(redirectToSignInOnce()).toBe(true);
        expect(redirectToSignInOnce()).toBe(false);
        expect(mockNavigateTo).toHaveBeenCalledExactlyOnceWith('/sign-in?redirect_url=%2Fen');
    });

    it('bounces again once the recovery is reset (a genuine sign-in clears the breaker)', () => {
        redirectToSignInOnce();
        resetUnauthorizedRecovery();
        mockNavigateTo.mockClear();

        expect(redirectToSignInOnce()).toBe(true);
        expect(mockNavigateTo).toHaveBeenCalledExactlyOnceWith('/sign-in?redirect_url=%2Fen');
    });

    it('degrades to a single bounce — never a loop — when sessionStorage is unavailable', () => {
        // Safari private mode / storage-partitioned contexts throw on access. Losing the marker must not
        // resurrect the loop, so the fail-safe is to bounce at most once per DOCUMENT via module state.
        const throwing = {
            getItem: () => {
                throw new Error('SecurityError');
            },
            setItem: () => {
                throw new Error('SecurityError');
            },
            removeItem: () => {
                throw new Error('SecurityError');
            },
        };

        vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(throwing as unknown as Storage);

        expect(redirectToSignInOnce()).toBe(true);
        expect(redirectToSignInOnce()).toBe(false);
        expect(mockNavigateTo).toHaveBeenCalledExactlyOnceWith('/sign-in?redirect_url=%2Fen');
    });

    it('the in-document fallback ALSO remembers every path, not just the last one', () => {
        const throwing = {
            getItem: () => {
                throw new Error('SecurityError');
            },
            setItem: () => {
                throw new Error('SecurityError');
            },
            removeItem: () => {
                throw new Error('SecurityError');
            },
        };

        vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(throwing as unknown as Storage);

        expect(redirectToSignInOnce()).toBe(true);
        window.history.replaceState(null, '', '/en/profile');
        expect(redirectToSignInOnce()).toBe(true);
        window.history.replaceState(null, '', '/en');
        expect(redirectToSignInOnce()).toBe(false);
        expect(mockNavigateTo).toHaveBeenCalledTimes(2);
    });
    it('records the attempt when the WRITE throws even though the READ succeeds — the quota shape', () => {
        // The storage double the two cases below use throws on EVERY access, which is the EASY shape. The
        // documented one is asymmetric: Safari private browsing (and any origin that has hit its quota)
        // serves `getItem` normally and throws `QuotaExceededError` only from `setItem`. Under that shape the
        // attempt is recorded into the in-document fallback while the read consults ONLY storage — which
        // still answers "nothing attempted". The breaker never trips, and the 2026-08-07 production loop is
        // back in full, on a browser that reports storage as working.
        const readableButFull = {
            getItem: () => null,
            setItem: () => {
                throw new Error('QuotaExceededError');
            },
            removeItem: () => undefined,
        };

        vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(readableButFull as unknown as Storage);

        expect(redirectToSignInOnce()).toBe(true);

        expect(redirectToSignInOnce()).toBe(false);
        expect(mockNavigateTo).toHaveBeenCalledExactlyOnceWith('/sign-in?redirect_url=%2Fen');
    });

    it('clears the in-document fallback too when a failed write put the attempt there', () => {
        // `resetUnauthorizedRecovery` must clear EVERY store the breaker reads, not just the one it usually
        // writes. With a readable-but-full storage the whole state lives in the fallback, so a reset that
        // only issues `removeItem` leaves the breaker permanently open on that surface.
        const readableButFull = {
            getItem: () => null,
            setItem: () => {
                throw new Error('QuotaExceededError');
            },
            removeItem: () => undefined,
        };

        vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(readableButFull as unknown as Storage);

        redirectToSignInOnce();
        resetUnauthorizedRecovery();
        mockNavigateTo.mockClear();

        expect(redirectToSignInOnce()).toBe(true);
        expect(mockNavigateTo).toHaveBeenCalledExactlyOnceWith('/sign-in?redirect_url=%2Fen');
    });

    it('bounds the stored list, retaining the paths most recently bounced from', () => {
        // The list is keyed by `window.location.pathname`, which a link can make arbitrarily many distinct
        // values of. `sessionStorage` quota is shared across the WHOLE origin, so an unbounded list does not
        // merely bloat this key — it can deny storage to Clerk and to Next.js. The cap keeps the newest
        // entries because the surfaces a visitor is actively looping between are by definition the recent
        // ones; the path just recorded must always survive, or the very next 401 bounces again.
        for (let index = 0; index <= MAX_ATTEMPTED_PATHS; index += 1) {
            window.history.replaceState(null, '', `/en/surface-${index}`);
            redirectToSignInOnce();
        }

        const stored: unknown = JSON.parse(window.sessionStorage.getItem('commise.unauthorizedRecovery') ?? '[]');

        expect(Array.isArray(stored) ? stored.length : -1).toBe(MAX_ATTEMPTED_PATHS);

        // The path recorded last is still tripped...
        window.history.replaceState(null, '', `/en/surface-${MAX_ATTEMPTED_PATHS}`);
        expect(redirectToSignInOnce()).toBe(false);

        // ...and the oldest was the one evicted, so it is allowed one further bounce rather than being
        // remembered forever. Bounded eviction, never a tight loop: it takes MAX_ATTEMPTED_PATHS distinct
        // intervening surfaces to evict anything at all.
        window.history.replaceState(null, '', '/en/surface-0');
        expect(redirectToSignInOnce()).toBe(true);
    });
});
