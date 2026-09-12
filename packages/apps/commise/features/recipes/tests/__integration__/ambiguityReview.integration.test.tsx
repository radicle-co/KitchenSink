/**
 * Integration: the recipe detail's ambiguity review, composed (plan U13; owner ruling 2026-10-02, "Fix one line at a
 * time"). The REAL web `RecipeDetailView`, `AmbiguityReview`, `useAmbiguityPick`, the client's rebind and food-search
 * hooks, TanStack Query and the real `RecipeServiceClient` and `FoodServiceClient` with their zod parsing. Only `fetch`
 * is a double (owner ruling 2026-09-20: integration tests mock their dependencies).
 *
 * What only this tier can show:
 * - a pick on one of two same-named lines crosses the wire as ONE `POST …/ingredients/{position}/rebind` for that
 *   line, at the version the detail read, and never as a `POST /ingredients/corrections` (ADR-0045: the rebind
 *   command is where a correction is taught);
 * - the rebind's answer reaches the detail read, so the line names its new food and the other line stays under
 *   review;
 * - a version conflict re-reads the recipe, and the next pick sends the version the recipe has now;
 * - a remote food picked on a row says, on that row, which source it is being added from while food adopts it
 *   (`docs/design/rowEditorOpenDecisions.md` V3-9).
 */
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { recipeQueries } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { FoodResolutionStatus, type RecipeDetail } from '@kitchensink/recipe-core';
import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';

import { idleUnreachableRetry } from '../../src/__fixtures__/index.js';
import { RecipeDetailView } from '../../src/detail/RecipeDetailView.js';
import { recipeFormMessages } from '../../src/form/messages.js';
import { recipeMessages } from '../../src/messages.js';
import { HANG, foodProgressive, foodSearches, json, ndjson, twoOrigins, type RecordedRequest } from './twoOrigins.js';

afterEach(cleanup);

const en = recipeMessages.en.detail;
/** What a row says while its remote pick is added, from a source the register does not name. */
const ADDING = recipeFormMessages.en.ingredientEntryAddingFromSource.replace(
    '{source}',
    recipeMessages.en.ingredientRemoteSearch.sourceUnnamed,
);
const RECIPE_ID = '00000000-0000-4000-8000-00000000a001';
const REBIND_PATH = `/api/v1/recipes/${RECIPE_ID}/ingredients/2/rebind`;
const CANNED = { id: 'food_canned', name: 'Apple sauce, canned', score: 0.9 };

const sauce = (ingredientId: string, value: number, unit: string) => ({
    ingredientId,
    name: 'apple sauce',
    quantity: { kind: 'exact', value } as const,
    unit,
    isUserEntered: false,
    resolutionStatus: FoodResolutionStatus.AMBIGUOUS,
});

const FLOUR = {
    ingredientId: '00000000-0000-4000-8000-0000000000f1',
    name: 'flour',
    quantity: { kind: 'exact', value: 2 } as const,
    unit: 'cup',
    isUserEntered: false,
};
const CUP = sauce('00000000-0000-4000-8000-0000000000a1', 1, 'cup');
const SPOON = sauce('00000000-0000-4000-8000-0000000000a2', 2, 'tbsp');

const recipeAt = (version: number, spoon: RecipeDetail['ingredients'][number] = SPOON): RecipeDetail =>
    makeRecipeDetail({ id: RECIPE_ID, currentVersion: version, ingredients: [FLOUR, CUP, spoon] });

/** The recipe after the rebind put the canned food on the tablespoon line. */
const repointedAt = (version: number): RecipeDetail =>
    recipeAt(version, {
        ...SPOON,
        ingredientId: '00000000-0000-4000-8000-0000000000b2',
        name: CANNED.name,
        foodId: CANNED.id,
        resolutionStatus: FoodResolutionStatus.RESOLVED,
    });

const conflict = (currentVersion: number, conflictingVersion: number): Response =>
    json(
        {
            code: 'VERSION_CONFLICT',
            message: 'conflict',
            details: {
                currentVersion,
                conflictingVersion,
                server: {
                    versionNumber: currentVersion,
                    updatedAt: '2026-10-02T09:00:00.000Z',
                    snapshot: {
                        version: currentVersion,
                        title: 'Renamed elsewhere',
                        description: '',
                        steps: [],
                        ingredients: [],
                        servings: 4,
                        prepTimeMinutes: 10,
                        cookTimeMinutes: 20,
                    },
                },
            },
        },
        409,
    );

const food = foodSearches({
    catalog: () => json({ results: [CANNED] }),
    authored: () => json({ results: [] }),
});

/** The recipe detail as an owner sees it, over the recipe read the containers make. */
function renderDetail(origins: ReturnType<typeof twoOrigins>): void {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    function Detail() {
        const { data } = useQuery(recipeQueries(origins.recipes).detail(RECIPE_ID));

        return data === undefined ? null : (
            <RecipeDetailView recipe={data} viewerIsOwner unreachableRetry={idleUnreachableRetry} />
        );
    }

    render(
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={origins.recipes}>
                <FoodServiceProvider client={origins.food} subject="user_cook">
                    <Detail />
                </FoodServiceProvider>
            </RecipeServiceProvider>
        </QueryClientProvider>,
    );
}

/** The recipe-origin requests a test cares about: the reads, the rebinds and any correction. */
const recipeWrites = (requests: readonly RecordedRequest[]) =>
    requests.filter((request) => request.origin === 'recipe' && request.method === 'POST');

describe('the recipe detail ambiguity review, composed over the real clients (integration)', () => {
    it('⛔ a pick on one of two same-named lines sends ONE rebind for THAT line, and no correction', async () => {
        const user = userEvent.setup();
        const origins = twoOrigins({
            recipe: (request) => (request.method === 'POST' ? json(repointedAt(5)) : json(recipeAt(4))),
            food,
        });

        renderDetail(origins);
        await user.click(await screen.findByRole('button', { name: en.ambiguousReviewToggle }));
        await user.click(
            await within(screen.getByRole('group', { name: '2 tbsp apple sauce' })).findByRole('button', {
                name: CANNED.name,
            }),
        );

        // The detail now names the tablespoon line's new food, and only the cup line is still under review.
        expect(await screen.findByRole('checkbox', { name: `2 tbsp ${CANNED.name}` })).toBeTruthy();
        expect(screen.queryByRole('group', { name: '2 tbsp apple sauce' })).toBeNull();
        expect(
            within(screen.getByRole('group', { name: '1 cup apple sauce' })).getByRole('button', { name: CANNED.name }),
        ).toBeTruthy();
        expect(screen.getByText(en.ambiguousReviewSaved)).toBeTruthy();

        expect(recipeWrites(origins.requests).map(({ path, body }) => ({ path, body }))).toEqual([
            { path: REBIND_PATH, body: { expectedVersion: 4, target: { kind: 'catalogFood', foodId: CANNED.id } } },
        ]);
        expect(origins.sentTo('food').map((request) => request.query.get('query'))).toContain('apple sauce');
    });

    it('⛔ a version conflict re-reads the recipe, and the next pick sends the version it has now', async () => {
        const user = userEvent.setup();
        let reads = 0;
        let rebinds = 0;
        const origins = twoOrigins({
            recipe: (request) => {
                if (request.method === 'GET') {
                    reads += 1;

                    // The second read is the re-read the conflict asked for: the recipe moved to version 6 elsewhere.
                    return json(recipeAt(reads === 1 ? 4 : 6));
                }

                rebinds += 1;

                return rebinds === 1 ? conflict(6, 4) : json(repointedAt(7));
            },
            food,
        });

        renderDetail(origins);
        await user.click(await screen.findByRole('button', { name: en.ambiguousReviewToggle }));

        const spoonRow = (): HTMLElement => screen.getByRole('group', { name: '2 tbsp apple sauce' });

        await user.click(await within(spoonRow()).findByRole('button', { name: CANNED.name }));
        // The row's refusal, said in its assertive region (`LiveRegion` keeps two, so the text is what is found).
        expect((await within(spoonRow()).findByText(en.ambiguousReviewFailed)).getAttribute('role')).toBe('alert');
        await waitFor(() => expect(reads).toBe(2));

        await user.click(within(spoonRow()).getByRole('button', { name: CANNED.name }));

        await waitFor(() =>
            expect(recipeWrites(origins.requests).map(({ body }) => body)).toEqual([
                { expectedVersion: 4, target: { kind: 'catalogFood', foodId: CANNED.id } },
                { expectedVersion: 6, target: { kind: 'catalogFood', foodId: CANNED.id } },
            ]),
        );
        expect(await screen.findByRole('checkbox', { name: `2 tbsp ${CANNED.name}` })).toBeTruthy();
    });

    it('a remote food picked on a row says, on that row alone, which source it is added from while food adopts it', async () => {
        const user = userEvent.setup();
        const remote = foodProgressive({
            search: () =>
                ndjson(
                    {
                        type: 'database',
                        catalog: { outcome: 'answered', results: [] },
                        authored: { outcome: 'answered', results: [] },
                    },
                    {
                        type: 'source',
                        source: 'usda',
                        outcome: 'answered',
                        items: [{ name: 'Apples, stewed', reference: 'sealed.s' }],
                    },
                    { type: 'complete' },
                ),
            // The adopt never answers, so the pick stays in flight for the caption to be read.
            adopt: () => HANG,
        });
        // The harness's source register names no source, so the row names it as `sourceUnnamed`.
        const origins = twoOrigins({ recipe: () => json(recipeAt(4)), food: remote });

        renderDetail(origins);
        await user.click(await screen.findByRole('button', { name: en.ambiguousReviewToggle }));
        const spoonRow = screen.getByRole('group', { name: '2 tbsp apple sauce' });

        await user.click(
            await within(spoonRow).findByRole('button', { name: 'Apples, stewed, from another food database' }),
        );

        expect(await within(spoonRow).findByText(ADDING)).toBeTruthy();
        expect(within(screen.getByRole('group', { name: '1 cup apple sauce' })).queryByText(ADDING)).toBeNull();
        expect(origins.sentTo('food').filter((request) => request.path === '/api/v1/foods/remote/adopt')).toHaveLength(
            1,
        );
        expect(recipeWrites(origins.requests)).toEqual([]);
    });
});
