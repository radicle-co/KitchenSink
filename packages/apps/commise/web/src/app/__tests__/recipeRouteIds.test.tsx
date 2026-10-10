/**
 * The recipe routes answer only for a recipe id (`/recipes/[id]`, `/edit`, `/versions`). A recipe id is a UUID — the
 * recipe-service contract's own shape (`addRecipeToCollectionRequestSchema.recipeId`, the service's `ParseUUIDPipe`) —
 * so anything else in that segment is not a recipe: `/recipes/parse`, the paste page's deleted route, used to resolve
 * to the detail page and answer 200 with an in-app not-found. The 404 status is the middleware's
 * (`tests/middleware.test.ts`); these pin the page's half — it calls `notFound()` BEFORE auth and before any prefetch,
 * so no request ever leaves for a segment that is not an id.
 *
 * A local reference (`local:recipe:…`) never reaches these URLs — an unsynced recipe opens at `/recipes/new?draft=…`
 * (`RecipeEditorContainer`'s `replaceUrlFor`) — and it is refused here too, since it is not a UUID.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecipeServiceClient } from '@kitchensink/recipe-service-client';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));
vi.mock('next/navigation', () => ({
    redirect: vi.fn((url: string) => {
        throw new Error(`NEXT_REDIRECT:${url}`);
    }),
    // Next's `notFound()` never returns; the pages rely on it throwing.
    notFound: vi.fn(() => {
        throw new Error('NEXT_NOT_FOUND');
    }),
}));

const { auth } = await import('@clerk/nextjs/server');
const mockedAuth = vi.mocked(auth);

const pages = [
    ['/recipes/[id]', (await import('../[locale]/recipes/[id]/page')).default],
    ['/recipes/[id]/edit', (await import('../[locale]/recipes/[id]/edit/page')).default],
    ['/recipes/[id]/versions', (await import('../[locale]/recipes/[id]/versions/page')).default],
] as const;

afterEach(() => {
    vi.clearAllMocks();
});

describe.each(pages)('%s — the id boundary', (_route, Page) => {
    it.each(['parse', 'rec_1', 'local:recipe:abc123', 'new-ish', '11111111-1111-1111-1111-11111111111'])(
        'answers not-found for %s, before auth and before any request',
        async (id) => {
            mockedAuth.mockResolvedValue({ userId: 'usr_1', getToken: async () => 'tok_1' } as unknown as Awaited<
                ReturnType<typeof auth>
            >);
            const detailSpy = vi.spyOn(RecipeServiceClient.prototype, 'getRecipeById');

            await expect(Page({ params: Promise.resolve({ locale: 'en', id }) })).rejects.toThrow('NEXT_NOT_FOUND');
            expect(mockedAuth).not.toHaveBeenCalled();
            expect(detailSpy).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['a v4 id (the database default)', '0a6c2f4e-8b1d-4c3a-9e2f-1d2c3b4a5f60'],
        ['a v7 id (a client-minted one)', '01928f3a-7b2c-7d4e-8f5a-6b7c8d9e0f1a'],
    ])('passes %s through to the page', async (_label, id) => {
        mockedAuth.mockResolvedValue({ userId: null, getToken: async () => null } as unknown as Awaited<
            ReturnType<typeof auth>
        >);

        // Past the id boundary, a signed-out caller meets the existing auth gate.
        await expect(Page({ params: Promise.resolve({ locale: 'en', id }) })).rejects.toThrow(
            'NEXT_REDIRECT:/en/sign-in',
        );
    });
});
