/**
 * Shell coverage for EVERY authenticated route (L9 / FR-044 / FR-046).
 *
 * `AppShell`'s own docblock states that "Every authenticated route … renders inside this ONE shell". That was
 * false: only five routes were wrapped, so opening a recipe, a collection, or discovery on mobile web left the
 * viewer with no bottom tab bar and no way out — the loudest navigation defect on the web app. This suite is
 * the invariant behind that sentence, and it is table-driven so a NEW authenticated route cannot quietly ship
 * chrome-less: add the page, add its row.
 *
 * Each page is invoked as the plain async function a Next server-component page is (the `dataPagePrefetch`
 * precedent — no framework runtime needed) and the returned ELEMENT TREE is inspected, so no client container
 * is mounted and no provider stack is required. Two things are asserted per route:
 *
 *  1. It renders its content inside `AppShell`, with the `activeId` that highlights the right destination.
 *  2. It is `dynamic = 'force-dynamic'`. The shell's Clerk-backed hooks need a live session, so a
 *     statically-prerendered shell route fails `next build` — the trap already hit on `/account`,
 *     `/settings`, and `/profile`. Asserting the flag here catches it before the build does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { isValidElement } from 'react';

import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import type { HomeNavItemId } from '@commise/features-core';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('next/navigation', () => ({
    redirect: vi.fn((url: string) => {
        // Mirrors Next's real `redirect()`: typed `never`, aborts the page by throwing.
        throw new Error(`NEXT_REDIRECT:${url}`);
    }),
}));

const { auth } = await import('@clerk/nextjs/server');
const mockedAuth = vi.mocked(auth);

const { AppShell } = await import('@/components/app/AppShell');

/** One authenticated route: how to invoke it, and which destination its shell must mark active. */
interface ShellRoute {
    /** The route path, for test names. */
    readonly path: string;
    /** Import the page module (its default export is the server page; `dynamic` is its route flag). */
    readonly load: () => Promise<{ default: (props: never) => Promise<ReactElement>; dynamic?: string }>;
    /** The page's own arguments (Next passes promises). */
    readonly props: () => unknown;
    /** The destination the shell must highlight. */
    readonly activeId: HomeNavItemId;
}

const localeParams = () => ({ params: Promise.resolve({ locale: 'en' }) });
const idParams = () => ({ params: Promise.resolve({ locale: 'en', id: 'rec_1' }) });

/**
 * Every route whose page wraps the shell itself. `/profile`, `/account`, and `/settings` wrap inside their own
 * `*Content` component instead (their suites assert the shell there), so they appear only in the
 * `force-dynamic` table below.
 */
const shellRoutes: readonly ShellRoute[] = [
    {
        path: '/[locale]/recipes',
        load: () => import('../[locale]/recipes/page'),
        props: localeParams,
        activeId: 'recipes',
    },
    {
        path: '/[locale]/recipes/new',
        load: () => import('../[locale]/recipes/new/page'),
        props: localeParams,
        activeId: 'recipes',
    },
    {
        path: '/[locale]/recipes/[id]',
        load: () => import('../[locale]/recipes/[id]/page'),
        props: idParams,
        activeId: 'recipes',
    },
    {
        path: '/[locale]/recipes/[id]/edit',
        load: () => import('../[locale]/recipes/[id]/edit/page'),
        props: idParams,
        activeId: 'recipes',
    },
    {
        path: '/[locale]/recipes/[id]/versions',
        load: () => import('../[locale]/recipes/[id]/versions/page'),
        props: idParams,
        activeId: 'recipes',
    },
    {
        path: '/[locale]/discover',
        load: () => import('../[locale]/discover/page'),
        props: () => ({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
        activeId: 'recipes',
    },
    {
        path: '/[locale]/collections',
        load: () => import('../[locale]/collections/page'),
        props: localeParams,
        activeId: 'recipes',
    },
    {
        path: '/[locale]/collections/new',
        load: () => import('../[locale]/collections/new/page'),
        props: localeParams,
        activeId: 'recipes',
    },
    {
        path: '/[locale]/collections/[id]',
        load: () => import('../[locale]/collections/[id]/page'),
        props: idParams,
        activeId: 'recipes',
    },
    {
        path: '/[locale]/collections/[id]/add',
        load: () => import('../[locale]/collections/[id]/add/page'),
        props: idParams,
        activeId: 'recipes',
    },
    {
        path: '/[locale]/collections/[id]/rename',
        load: () => import('../[locale]/collections/[id]/rename/page'),
        props: idParams,
        activeId: 'recipes',
    },
];

/** The remaining authenticated routes — shell-hosted, so they carry the same prerender constraint. */
const contentSplitRoutes: readonly { readonly path: string; readonly load: () => Promise<{ dynamic?: string }> }[] = [
    { path: '/[locale]', load: () => import('../[locale]/page') },
    { path: '/[locale]/profile', load: () => import('../[locale]/profile/page') },
    { path: '/[locale]/account', load: () => import('../[locale]/account/page') },
    { path: '/[locale]/settings', load: () => import('../[locale]/settings/page') },
];

/** Resolve `auth()` as an authenticated caller with a fixed session token. */
function mockAuthed(): void {
    mockedAuth.mockResolvedValue({
        userId: 'usr_1',
        getToken: async () => 'tok_1',
    } as unknown as Awaited<ReturnType<typeof auth>>);
}

/**
 * The FIRST element of the given component type in `node`'s tree, searched depth-first through `children`.
 * Pure.
 */
function findElementByType(node: ReactNode, type: unknown): ReactElement | undefined {
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = findElementByType(child as ReactNode, type);

            if (found !== undefined) {
                return found;
            }
        }

        return undefined;
    }

    if (!isValidElement(node)) {
        return undefined;
    }

    if (node.type === type) {
        return node;
    }

    return findElementByType((node.props as { children?: ReactNode }).children, type);
}

/**
 * Stop the SSR prefetches from reaching the network. `prefetchQuery`/`prefetchInfiniteQuery` catch their
 * query's error, so a rejection dehydrates to an empty state and the page still returns its full tree — which
 * is all this suite reads. (The prefetch contract itself is covered by `dataPagePrefetch.test.tsx`.)
 */
function stubDataMethods(): void {
    for (const method of ['listRecipes', 'getRecipeById', 'searchRecipes', 'listCollections'] as const) {
        vi.spyOn(RecipeServiceClient.prototype, method).mockRejectedValue(new Error('not exercised here'));
    }
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('every authenticated route renders inside the app navigation shell', () => {
    for (const route of shellRoutes) {
        it(`${route.path} wraps its surface in AppShell (activeId: ${route.activeId})`, async () => {
            mockAuthed();
            stubDataMethods();

            const { default: Page } = await route.load();
            const element = await Page(route.props() as never);
            const shell = findElementByType(element, AppShell);

            expect(shell, `${route.path} renders no AppShell`).toBeDefined();
            expect((shell?.props as { activeId?: string }).activeId).toBe(route.activeId);
            // The shell wraps the surface — it is never rendered empty beside it.
            expect((shell?.props as { children?: ReactNode }).children).toBeDefined();
        });
    }
});

describe('every shell-hosted route is per-request dynamic', () => {
    // The shell reads the live Clerk session, so a statically prerendered shell route fails `next build`.
    for (const route of [...shellRoutes, ...contentSplitRoutes]) {
        it(`${route.path} declares force-dynamic`, async () => {
            const module = await route.load();

            expect(module.dynamic).toBe('force-dynamic');
        });
    }
});
