/**
 * THE MID-RUN CLERK RE-MINT, TESTED FOR BEHAVIOUR.
 *
 * ⛔ WHY THIS EXISTS SEPARATELY FROM `k6PoolFreshness.test.ts`. That guard asserts the WIRING — that every
 * k6 step is handed the sign-in handles, and that the refresher never signs in. Both are necessary and
 * neither can see the thing that actually broke: a refresher that holds a bearer forever is wired
 * identically to one that renews it. Mutating `now - mintedAt < REFRESH_AFTER_SECONDS` to `true` left the
 * wiring guard fully green, which is the definition of coverage theatre.
 *
 * So this drives the module and asserts the renewal, the reuse, the identity affinity and the loud failure.
 * The defect it stands against is measured: on run 34041143051 the pool was minted once at 15:17:37 and the
 * legs ran to 15:29:29 against a 60-second bearer, so the scenarios after the first returned zero
 * successes out of 12252, 1215 and 3996 — reported, for hours, as the recipe service failing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mintedResponse } from './support/k6HttpStub.js';
import type { StubCall, StubResponse } from './support/k6HttpStub.js';

const HANDLE = {
    sessionId: 'sess_1',
    devJwt: 'dev_1',
    fapi: 'https://example.clerk.accounts.dev/v1',
    origin: 'https://pr-91.sandbox.commise.app',
    email: 'test-alfa+clerk_test@radcile.com',
};
const SECOND_HANDLE = { ...HANDLE, sessionId: 'sess_2', email: 'test-bravo+clerk_test@radcile.com' };

/** What a test drives: the refresher plus the stub instance IT is wired to. */
interface Harness {
    readonly freshBearer: (handles: object[], fallback: string) => string;
    readonly calls: readonly StubCall[];
    readonly queueResponse: (response: StubResponse) => void;
}

/**
 * A fresh copy of the module, because the held bearer is module-level per-VU state.
 *
 * ⚠️ The STUB is re-imported from the same reset registry, not from this file's top-level import.
 * `vi.resetModules()` gives the module under test a brand-new `k6/http` instance, so a response queued
 * through a stale handle lands in an array nothing reads — which presents as "a post with no response
 * queued" and looks like a bug in the code rather than in the test.
 *
 * @returns The refresher and the stub it will actually call.
 */
async function loadHarness(): Promise<Harness> {
    vi.resetModules();

    // A k6 ES module — plain JavaScript, whose types TypeScript infers from the source. The alias in
    // `vitest.config.ts` supplies `k6/http`, which has no npm package to resolve.
    const module = await import('../../../tools/loadtest/k6/session.js');
    const stub = await import('./support/k6HttpStub.js');

    stub.reset();

    return { freshBearer: module.freshBearer, calls: stub.calls, queueResponse: stub.queueResponse };
}

beforeEach(() => {
    vi.stubGlobal('__VU', 1);
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('freshBearer', () => {
    it('mints on first use rather than trusting the pool it was handed', async () => {
        // ⛔ THE PROPERTY THAT MAKES A STALE POOL FILE HARMLESS. A leg starting twenty minutes after
        // provisioning must not present the bearer in `tokens.json` — it is long expired.
        const { freshBearer: refresher, calls, queueResponse } = await loadHarness();

        queueResponse(mintedResponse('minted-1'));

        expect(refresher([HANDLE], 'stale-from-the-pool-file')).toBe('minted-1');
        expect(calls).toHaveLength(1);
    });

    it('re-uses the held bearer inside its lifetime', async () => {
        const { freshBearer: refresher, calls, queueResponse } = await loadHarness();

        queueResponse(mintedResponse('minted-1'));
        refresher([HANDLE], 'fallback');
        vi.advanceTimersByTime(44_000);

        // No second response is queued: the stub throws if a call is made, so this asserts the ABSENCE of
        // a re-mint rather than merely the sameness of the answer.
        expect(refresher([HANDLE], 'fallback')).toBe('minted-1');
        expect(calls).toHaveLength(1);
    });

    it('renews the bearer before it expires', async () => {
        // ⛔ THE ASSERTION THE WHOLE MODULE EXISTS FOR. A Clerk token lives 60s; renewal must happen
        // strictly inside that, or the tail of every 105-second leg is unauthenticated.
        const { freshBearer: refresher, calls, queueResponse } = await loadHarness();

        queueResponse(mintedResponse('minted-1'));
        refresher([HANDLE], 'fallback');
        vi.advanceTimersByTime(46_000);
        queueResponse(mintedResponse('minted-2'));

        expect(refresher([HANDLE], 'fallback')).toBe('minted-2');
        expect(calls).toHaveLength(2);
    });

    it('keeps a VU on one identity across renewals', async () => {
        // Rotating identities mid-run would show a per-USER rate limiter a traffic pattern no real client
        // produces, which is the measurement error the pool exists to avoid in the first place.
        vi.stubGlobal('__VU', 2);

        const { freshBearer: refresher, calls, queueResponse } = await loadHarness();

        queueResponse(mintedResponse('minted-1'));
        refresher([HANDLE, SECOND_HANDLE], 'fallback');
        vi.advanceTimersByTime(46_000);
        queueResponse(mintedResponse('minted-2'));
        refresher([HANDLE, SECOND_HANDLE], 'fallback');

        expect(calls.map((call) => call.url)).toEqual([
            `${SECOND_HANDLE.fapi}/client/sessions/sess_2/tokens?__clerk_db_jwt=dev_1`,
            `${SECOND_HANDLE.fapi}/client/sessions/sess_2/tokens?__clerk_db_jwt=dev_1`,
        ]);
    });

    it('sends the Origin Clerk stamps as azp', async () => {
        // Dropping it yields a token every deployed service refuses (ADR-0033), and the refusal arrives as
        // an opaque 401 from the service rather than an error here.
        const { freshBearer: refresher, calls, queueResponse } = await loadHarness();

        queueResponse(mintedResponse('minted-1'));
        refresher([HANDLE], 'fallback');

        expect(calls[0]?.params.headers?.['Origin']).toBe(HANDLE.origin);
    });

    it('falls back to the supplied token when no handles were provided', async () => {
        // A hand run or the substrate profile has no handles, and must behave exactly as it did before.
        const { freshBearer: refresher, calls } = await loadHarness();

        expect(refresher([], 'the-single-token')).toBe('the-single-token');
        expect(calls).toHaveLength(0);
    });

    it('throws rather than carrying on with a bearer it could not renew', async () => {
        // ⛔ A revoked session and a transient HTTP failure are indistinguishable here, and treating either
        // as "keep the old token" resurrects the silent-401 run this module was written to end.
        const { freshBearer: refresher, queueResponse } = await loadHarness();

        queueResponse(mintedResponse('minted-1'));
        refresher([HANDLE], 'fallback');
        vi.advanceTimersByTime(46_000);
        queueResponse({ status: 401, json: () => undefined });

        expect(() => refresher([HANDLE], 'fallback')).toThrow(/could not re-mint/u);
    });
});
