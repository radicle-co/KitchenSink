/**
 * `requireSignedIn` is the ONE auth gate of every protected page. Three answers, in this order, and the order is the
 * point: refuse an address that is not a page (404) BEFORE `auth()`, send a signed-out visitor to sign-in, and hand a
 * signed-in one their session.
 *
 * Why the refusal comes first: the middleware matcher skips a path that names a static file, so `clerkMiddleware`
 * never ran for it, and `auth()` throws without it. `/en/collections/cover.png` reached the page and answered 500.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('next/navigation', () => ({
    redirect: vi.fn((url: string) => {
        throw new Error(`NEXT_REDIRECT:${url}`);
    }),
    notFound: vi.fn(() => {
        throw new Error('NEXT_NOT_FOUND');
    }),
}));

const { auth } = await import('@clerk/nextjs/server');
const mockedAuth = vi.mocked(auth);
const { requireSignedIn } = await import('@/lib/requireSignedIn');

beforeEach(() => {
    mockedAuth.mockReset();
});

function signedOut(): void {
    mockedAuth.mockResolvedValue({ userId: null } as unknown as Awaited<ReturnType<typeof auth>>);
}

function signedIn(): void {
    mockedAuth.mockResolvedValue({ userId: 'usr_1', getToken: async () => 'tok_1' } as unknown as Awaited<
        ReturnType<typeof auth>
    >);
}

describe('requireSignedIn — refuses an address that is not a page, before auth()', () => {
    it.each([
        ['a static-file name in an id segment', 'en', '/en/collections/cover.png'],
        ['a static-file name with a path after it', 'en', '/en/collections/cover.png/more'],
        ['a static-file name where the locale goes', 'x.png', '/x.png/profile'],
        ['a locale this build does not route', 'zz', '/zz/profile'],
    ])('%s', async (_what, locale, returnPath) => {
        await expect(requireSignedIn(locale, returnPath)).rejects.toThrow('NEXT_NOT_FOUND');
        expect(mockedAuth).not.toHaveBeenCalled();
    });

    it('does not mistake a file name in the QUERY for a file request', async () => {
        signedIn();

        await expect(requireSignedIn('en', '/en/discover?q=cover.png')).resolves.toMatchObject({ userId: 'usr_1' });
    });
});

describe('requireSignedIn — the visitor', () => {
    it('sends a signed-out visitor to sign-in, carrying where they were going', async () => {
        signedOut();

        await expect(requireSignedIn('en', '/en/collections/abc')).rejects.toThrow(
            'NEXT_REDIRECT:/en/sign-in?redirect_url=%2Fen%2Fcollections%2Fabc',
        );
    });

    it('hands a signed-in visitor their id and their session token reader', async () => {
        signedIn();

        const session = await requireSignedIn('en', '/en/recipes');

        expect(session.userId).toBe('usr_1');
        await expect(session.getToken()).resolves.toBe('tok_1');
    });
});
