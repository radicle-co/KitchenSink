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
    notFound: vi.fn(() => {
        // Mirrors Next's real `notFound()`: typed `never`, aborts the page by throwing.
        throw new Error('NEXT_NOT_FOUND');
    }),
}));

const { auth } = await import('@clerk/nextjs/server');
const mockedAuth = vi.mocked(auth);

const { notFound, redirect } = await import('next/navigation');
const mockedRedirect = vi.mocked(redirect);
const mockedNotFound = vi.mocked(notFound);

const { HomeWidgetSurface } = await import('@/components/home/HomeWidgetSurface');
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
    mockedNotFound.mockClear();
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

    it('renders Home for a SIGNED-IN caller, without redirecting', async () => {
        mockSignedIn();

        const element = await HomePage({ params: Promise.resolve({ locale: 'en' }) });

        expect(element.type).toBe(HomeWidgetSurface);
        expect(mockedRedirect).not.toHaveBeenCalled();
    });
});

/**
 * ⛔ A path that is not a locale never reaches Clerk.
 *
 * The middleware matcher skips `/favicon.ico`, `/robots.txt` and `/sitemap.xml`, and the app ships none of the
 * three, so a browser's or crawler's request for one routed HERE with that file name as `locale`. The layout's
 * `notFound()` does not stop this page: Next renders a layout and its page concurrently, so the response was
 * the layout's 404 while `auth()` here ran with no `clerkMiddleware()` in the request and threw — a server
 * error reported to Sentry for every favicon fetch.
 */
describe('a path segment that is not a supported locale', () => {
    /**
     * `fr` is here, not a locale this app ships (`SUPPORTED_LOCALES` is `['en']`). It used to be the input of a
     * "keeps the caller in their own locale" case that expected `/fr/sign-in` — a page outcome the layout's own
     * `notFound()` already made unreachable. That case is deleted rather than kept: with one locale shipped,
     * the locale in the redirect target is proved by the `en` cases above.
     */
    it.each(['favicon.ico', 'robots.txt', 'sitemap.xml', 'fr'])(
        '⛔ answers %s with not-found and never calls auth()',
        async (segment) => {
            mockSignedIn();

            await expect(HomePage({ params: Promise.resolve({ locale: segment }) })).rejects.toThrow('NEXT_NOT_FOUND');
            expect(mockedAuth).not.toHaveBeenCalled();
            expect(mockedRedirect).not.toHaveBeenCalled();
        },
    );
});
