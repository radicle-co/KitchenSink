/**
 * W-01 — a signed-out deep link comes back to its destination after sign-in (`buildSpec.md` §8). Every protected page
 * sends its OWN path out as the sign-in URL's `redirect_url`; before this, all eleven redirected to a bare
 * `/{locale}/sign-in` and the sign-in page forced the locale root, so the destination was gone before sign-in began.
 *
 * Each page is invoked as the plain async function a server-component page is, with `redirect()` stubbed to throw the
 * way Next's real one does, so the redirect TARGET is asserted. The expected value is spelled out per page (not built
 * with `signInPathFor`), so a page that forgets the destination, sends the wrong one, or sends it unencoded fails.
 */
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `/recipes` and `/collections` read their list/grid cookie; there is no request scope under vitest.
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
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

const RECIPE_ID = '0a6c2f4e-8b1d-4c3a-9e2f-1d2c3b4a5f60';
const COLLECTION_ID = '01J9ZK3R6Q8N4W2V5X7Y1A3B5C';

type Page = (props: never) => Promise<ReactElement>;

const here = { params: Promise.resolve({ locale: 'en' }) };
const withId = (id: string) => ({ params: Promise.resolve({ locale: 'en', id }) });

/** `[page, load, props, the path the visitor was on]`. */
const PAGES: readonly (readonly [string, () => Promise<{ default: Page }>, unknown, string])[] = [
    ['/', () => import('../[locale]/page'), here, '/en'],
    ['/collections', () => import('../[locale]/collections/page'), here, '/en/collections'],
    [
        '/collections/[id]',
        () => import('../[locale]/collections/[id]/page'),
        withId(COLLECTION_ID),
        `/en/collections/${COLLECTION_ID}`,
    ],
    ['/recipes', () => import('../[locale]/recipes/page'), here, '/en/recipes'],
    ['/recipes/new', () => import('../[locale]/recipes/new/page'), here, '/en/recipes/new'],
    ['/recipes/[id]', () => import('../[locale]/recipes/[id]/page'), withId(RECIPE_ID), `/en/recipes/${RECIPE_ID}`],
    [
        '/recipes/[id]/edit',
        () => import('../[locale]/recipes/[id]/edit/page'),
        withId(RECIPE_ID),
        `/en/recipes/${RECIPE_ID}/edit`,
    ],
    [
        '/recipes/[id]/versions',
        () => import('../[locale]/recipes/[id]/versions/page'),
        withId(RECIPE_ID),
        `/en/recipes/${RECIPE_ID}/versions`,
    ],
    [
        '/discover',
        () => import('../[locale]/discover/page'),
        { ...here, searchParams: Promise.resolve({}) },
        '/en/discover',
    ],
    ['/profile', () => import('../[locale]/profile/page'), here, '/en/profile'],
    ['/legal/sources', () => import('../[locale]/legal/sources/page'), here, '/en/legal/sources'],
];

beforeEach(() => {
    mockedAuth.mockReset();
    mockedAuth.mockResolvedValue({ userId: null, getToken: async () => null } as unknown as Awaited<
        ReturnType<typeof auth>
    >);
});

describe.each(PAGES)('%s, signed out', (_route, load, props, path) => {
    it('sends the visitor to sign-in carrying the page they were on', async () => {
        const { default: page } = await load();

        await expect(page(props as never)).rejects.toThrow(
            `NEXT_REDIRECT:/en/sign-in?redirect_url=${encodeURIComponent(path)}`,
        );
    });
});

describe('/discover, signed out', () => {
    it('carries the search too, because the filters are the destination', async () => {
        const { default: page } = await import('../[locale]/discover/page');

        await expect(
            page({
                params: Promise.resolve({ locale: 'en' }),
                searchParams: Promise.resolve({ q: 'pasta', tag: ['quick', 'veg'] }),
            } as never),
        ).rejects.toThrow(
            `NEXT_REDIRECT:/en/sign-in?redirect_url=${encodeURIComponent('/en/discover?q=pasta&tag=quick&tag=veg')}`,
        );
    });
});
