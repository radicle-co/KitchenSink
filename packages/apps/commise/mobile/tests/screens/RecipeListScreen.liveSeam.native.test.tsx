/**
 * Component tests for the mobile RecipeListScreen driven through the REAL data seam — the actual
 * `useRecipes` hook over a real `RecipeServiceClient` whose transport is a `fetch` double — rather than
 * `vi.mock`ing the hooks module.
 *
 * Why a second file next to `RecipeListScreen.native.test.tsx`: that suite hand-builds the hook's return
 * value (`{ isLoading: false, isError: false, data }`), so it asserts only that the VIEW renders the right
 * branch for a status it was handed. It cannot see how `useRecipes` actually derives that status, which is
 * exactly where the reported first-run defect lived: on a hung request the query never leaves
 * `isPending && isFetching`, so `status` stays `'loading'` forever and the empty/error branches are
 * unreachable. These tests exercise the whole chain — transport → query → status → branch — the way web's
 * `RecipeListContainer.test.tsx` already does (the CP-6 T3 fake-client seam, which mobile had not adopted).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { renderWithRecipeClient } from '@commise/test-utils';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';

import { RecipeListScreen } from '../../src/screens/RecipeListScreen.js';
import { makeRecipe, makeRecipePage } from '../__fixtures__/recipes.js';

const BASE_URL = 'https://recipes.example.test';

/** A `fetch` double answering every request with one canned JSON payload. */
function answeringFetch(body: unknown, status = 200): typeof fetch {
    return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

/** A `fetch` double that NEVER answers — the hung connection the client's timeout has to bound. */
function hangingFetch(): typeof fetch {
    return (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
}

/** A real client (no network: transport is the injected double) with a short, test-scale timeout. */
function clientOver(fetchDouble: typeof fetch): RecipeServiceClient {
    return new RecipeServiceClient({ baseUrl: BASE_URL, token: 't', fetch: fetchDouble, timeoutMs: 25 });
}

const noop = (): void => undefined;

afterEach(cleanup);

describe('RecipeListScreen (live seam) — a successful load with zero recipes', () => {
    it('reaches the empty state, with the loading branch FLIPPED', async () => {
        const client = clientOver(answeringFetch(makeRecipePage([])));

        renderWithRecipeClient(<RecipeListScreen onSelectRecipe={noop} />, client);

        expect(await screen.findByText('No recipes yet')).toBeTruthy();
        // Not merely "the empty copy appeared": the skeleton region must be GONE.
        expect(screen.queryByLabelText('Loading recipes')).toBeNull();
    });

    it('offers the first-run create CTA (the FAB is suppressed on empty)', async () => {
        const client = clientOver(answeringFetch(makeRecipePage([])));

        renderWithRecipeClient(<RecipeListScreen onSelectRecipe={noop} />, client);

        expect(await screen.findByRole('button', { name: 'Create your first recipe' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
    });
});

describe('RecipeListScreen (live seam) — a HUNG request', () => {
    it('settles on the error state with a retry, never a permanent skeleton', async () => {
        const client = clientOver(hangingFetch());

        renderWithRecipeClient(<RecipeListScreen onSelectRecipe={noop} />, client);

        expect(await screen.findByRole('alert')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
        expect(screen.queryByLabelText('Loading recipes')).toBeNull();
    });
});

describe('RecipeListScreen (live seam) — a populated load', () => {
    it('renders the count and one row per recipe', async () => {
        const page = makeRecipePage([
            makeRecipe({ id: 'rec_1', title: 'Weeknight Pasta' }),
            makeRecipe({ id: 'rec_2', title: 'Fish Tacos' }),
        ]);
        const client = clientOver(answeringFetch(page));

        renderWithRecipeClient(<RecipeListScreen onSelectRecipe={noop} />, client);

        expect(await screen.findByRole('button', { name: 'Weeknight Pasta' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Fish Tacos' })).toBeTruthy();
        expect(screen.getByText('2 recipes')).toBeTruthy();
    });
});
