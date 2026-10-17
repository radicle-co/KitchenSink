/**
 * `/[locale]/collections/[id]` reads the cook's grid/list choice, which is an account setting (ADR-0059, owner ruling
 * 2026-10-17) and no longer a cookie. The page is called directly as the plain async function it is; only the returned
 * element tree is inspected, so the client container behind `HydrationBoundary` is never mounted.
 *
 * The collection itself is NOT prefetched (its read is hydration-gated on the client), so the settings are the page's only
 * dehydrated query. Reading them on the server means the choice is in the cache before the collection resolves, so the
 * members never draw in the width's default first and then flip.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DehydratedState, HydrationBoundaryProps } from '@tanstack/react-query';
import { HydrationBoundary } from '@tanstack/react-query';

import { ProfileServiceClient, profileServiceKeys } from '@commise/features-account';
import { SETTINGS_DEFAULTS } from '@kitchensink/schema-identity';

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

const { default: CollectionDetailPage } = await import('../[locale]/collections/[id]/page');

const COLLECTION_ID = '0a6c2f4e-8b1d-4c3a-9e2f-1d2c3b4a5f60';
const params = Promise.resolve({ locale: 'en', id: COLLECTION_ID });

function mockAuthed(): void {
    mockedAuth.mockResolvedValue({
        userId: 'usr_1',
        getToken: async () => 'tok_1',
    } as unknown as Awaited<ReturnType<typeof auth>>);
}

function dehydratedQueries(element: React.ReactElement): DehydratedState['queries'] {
    expect(element.type).toBe(HydrationBoundary);

    return ((element.props as HydrationBoundaryProps).state as DehydratedState).queries;
}

afterEach(() => {
    vi.clearAllMocks();
});

describe('[locale]/collections/[id]/page.tsx', () => {
    it('prefetches the viewer’s settings and dehydrates them under the shared settings key', async () => {
        mockAuthed();
        const chosen = { ...SETTINGS_DEFAULTS, recipeViewMode: 'list' } as const;
        const settingsSpy = vi.spyOn(ProfileServiceClient.prototype, 'getSettings').mockResolvedValue(chosen);

        const queries = dehydratedQueries(await CollectionDetailPage({ params }));

        expect(settingsSpy).toHaveBeenCalledTimes(1);
        expect(queries.map((query) => query.queryKey)).toEqual([profileServiceKeys.settings]);
        expect(queries[0]?.state.data).toEqual(chosen);
    });

    it('hands the container no view of its own: the cache carries the choice', async () => {
        mockAuthed();
        vi.spyOn(ProfileServiceClient.prototype, 'getSettings').mockResolvedValue(SETTINGS_DEFAULTS);

        const element = await CollectionDetailPage({ params });

        expect(JSON.stringify(element.props)).not.toContain('storedViewMode');
    });

    it('dehydrates to an empty state (no throw) when the settings read fails', async () => {
        mockAuthed();
        vi.spyOn(ProfileServiceClient.prototype, 'getSettings').mockRejectedValue(new Error('identity down'));

        expect(dehydratedQueries(await CollectionDetailPage({ params }))).toHaveLength(0);
    });

    it('redirects to sign-in and reads nothing when signed out', async () => {
        mockedAuth.mockResolvedValue({
            userId: null,
            getToken: async () => null,
        } as unknown as Awaited<ReturnType<typeof auth>>);
        const settingsSpy = vi.spyOn(ProfileServiceClient.prototype, 'getSettings');

        await expect(CollectionDetailPage({ params })).rejects.toThrow('NEXT_REDIRECT:');
        expect(settingsSpy).not.toHaveBeenCalled();
    });
});
