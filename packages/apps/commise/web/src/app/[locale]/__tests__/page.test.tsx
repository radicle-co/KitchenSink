/**
 * The locale root's auth gate — the app's FRONT DOOR (US-000 / FR-046).
 *
 * Owner decision, 2026-07-28: there is no welcome/landing surface. A signed-out caller on `/{locale}` goes
 * STRAIGHT to the sign-in form; a signed-in caller gets Home. Previously the signed-out branch bounced to a
 * branded `/{locale}/welcome` hero, which is now deleted on both platforms — this suite is the behavioural
 * invariant that replaced it, so a reintroduced interstitial fails here rather than in review.
 *
 * The page is invoked as the plain async function a Next server-component page is (the `appShellRoutes` /
 * `dataPagePrefetch` precedent — no framework runtime needed) and `redirect()` is stubbed to throw the way
 * Next's real one does, so the redirect TARGET is asserted rather than inferred from a rendered tree.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('next/navigation', () => ({
    redirect: vi.fn((url: string) => {
        // Mirrors Next's real `redirect()`: typed `never`, aborts the page by throwing.
        throw new Error(`NEXT_REDIRECT:${url}`);
    }),
}));

const { auth } = await import('@clerk/nextjs/server');
const mockedAuth = vi.mocked(auth);

const { redirect } = await import('next/navigation');
const mockedRedirect = vi.mocked(redirect);

const { HomeWidgetSurface } = await import('@/components/home');
const { default: HomePage } = await import('../page.js');

/** Resolve `auth()` as a signed-out caller. */
function mockSignedOut(): void {
    mockedAuth.mockResolvedValue({ userId: null } as unknown as Awaited<ReturnType<typeof auth>>);
}

/** Resolve `auth()` as a signed-in caller. */
function mockSignedIn(): void {
    mockedAuth.mockResolvedValue({
        userId: 'usr_1',
        getToken: async () => 'tok_1',
    } as unknown as Awaited<ReturnType<typeof auth>>);
}

beforeEach(() => {
    mockedAuth.mockReset();
    mockedRedirect.mockClear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('the locale root auth gate (front door)', () => {
    it('sends a SIGNED-OUT caller straight to the sign-in form', async () => {
        mockSignedOut();

        await expect(HomePage({ params: Promise.resolve({ locale: 'en' }) })).rejects.toThrow(
            'NEXT_REDIRECT:/en/sign-in',
        );
        expect(mockedRedirect).toHaveBeenCalledWith('/en/sign-in');
    });

    it('never routes a signed-out caller through an interstitial landing surface', async () => {
        // The regression this guards: the front door used to bounce through `/{locale}/welcome`. Asserting the
        // ABSENCE of any non-sign-in target keeps a reintroduced hero (under any name) from passing the test
        // above by redirecting twice.
        mockSignedOut();

        await expect(HomePage({ params: Promise.resolve({ locale: 'en' }) })).rejects.toThrow(/NEXT_REDIRECT/);

        const targets = mockedRedirect.mock.calls.map(([url]) => url);
        expect(targets).toEqual(['/en/sign-in']);
    });

    it('keeps the caller in their own locale', async () => {
        mockSignedOut();

        await expect(HomePage({ params: Promise.resolve({ locale: 'fr' }) })).rejects.toThrow(
            'NEXT_REDIRECT:/fr/sign-in',
        );
    });

    it('renders Home for a SIGNED-IN caller, without redirecting', async () => {
        mockSignedIn();

        const element = await HomePage({ params: Promise.resolve({ locale: 'en' }) });

        expect(element.type).toBe(HomeWidgetSurface);
        expect(mockedRedirect).not.toHaveBeenCalled();
    });
});
