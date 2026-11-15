/**
 * `/[locale]/recipes/[id]/cook` (plan 0002 T3). The page is called directly as the plain async function it is; only the
 * returned element tree is inspected, so the client adapter behind `HydrationBoundary` is never mounted.
 *
 * It pins the server half of decisions/0019: the page prefetches the SAME detail key the recipe page does, and a FAILED
 * prefetch dehydrates to nothing and never throws, so the browser read takes over (its half is CookingRoute.test.tsx).
 * And R-14: a signed-out visitor goes to sign-in carrying this path back; a segment that is not a recipe id is a 404.
 */
import { RecipeServiceClient, recipeQueries } from '@kitchensink/recipe-service-client';
import type { DehydratedState, HydrationBoundaryProps } from '@tanstack/react-query';
import { HydrationBoundary } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeRecipeDetail } from '../../../tests/components/recipes/__fixtures__/recipeFixtures';

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

const { default: CookingPage } = await import('../[locale]/recipes/[id]/cook/page');
const { CookingRoute } = await import('../[locale]/recipes/[id]/cook/CookingRoute');

const RECIPE_ID = '0a6c2f4e-8b1d-4c3a-9e2f-1d2c3b4a5f60';
const paramsFor = (id: string) => ({ params: Promise.resolve({ locale: 'en', id }) });

function mockAuthed(): void {
    mockedAuth.mockResolvedValue({
        userId: 'usr_1',
        getToken: async () => 'tok_1',
    } as unknown as Awaited<ReturnType<typeof auth>>);
}

function boundary(element: React.ReactElement): HydrationBoundaryProps {
    expect(element.type).toBe(HydrationBoundary);

    return element.props as HydrationBoundaryProps;
}

const queriesOf = (element: React.ReactElement): DehydratedState['queries'] =>
    (boundary(element).state as DehydratedState).queries;

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('[locale]/recipes/[id]/cook/page.tsx', () => {
    it('prefetches the recipe under the recipe page’s own detail key, and renders the cook route for it', async () => {
        mockAuthed();
        const recipe = makeRecipeDetail({ id: RECIPE_ID });
        const read = vi.spyOn(RecipeServiceClient.prototype, 'getRecipeById').mockResolvedValue(recipe);

        const element = await CookingPage(paramsFor(RECIPE_ID));
        const queries = queriesOf(element);
        const child = boundary(element).children as React.ReactElement<{ id: string }>;

        expect(read).toHaveBeenCalledTimes(1);
        expect(queries.map((query) => query.queryKey)).toEqual([
            recipeQueries(new RecipeServiceClient({ baseUrl: 'http://x', token: '' })).detail(RECIPE_ID).queryKey,
        ]);
        expect(queries[0]?.state.data).toEqual(recipe);
        expect(child.type).toBe(CookingRoute);
        expect(child.props.id).toBe(RECIPE_ID);
    });

    it('dehydrates to an empty state (no throw) when the read fails, so the browser reads', async () => {
        mockAuthed();
        vi.spyOn(RecipeServiceClient.prototype, 'getRecipeById').mockRejectedValue(new Error('recipe service down'));

        expect(queriesOf(await CookingPage(paramsFor(RECIPE_ID)))).toHaveLength(0);
    });

    it('redirects a signed-out visitor to sign-in, carrying the cook route back, and reads nothing', async () => {
        mockedAuth.mockResolvedValue({
            userId: null,
            getToken: async () => null,
        } as unknown as Awaited<ReturnType<typeof auth>>);
        const read = vi.spyOn(RecipeServiceClient.prototype, 'getRecipeById');

        await expect(CookingPage(paramsFor(RECIPE_ID))).rejects.toThrow(
            `NEXT_REDIRECT:/en/sign-in?redirect_url=${encodeURIComponent(`/en/recipes/${RECIPE_ID}/cook`)}`,
        );
        expect(read).not.toHaveBeenCalled();
    });

    it('answers 404 for a segment that is not a recipe id, before auth', async () => {
        await expect(CookingPage(paramsFor('not-a-recipe'))).rejects.toThrow('NEXT_NOT_FOUND');
        expect(mockedAuth).not.toHaveBeenCalled();
    });
});
