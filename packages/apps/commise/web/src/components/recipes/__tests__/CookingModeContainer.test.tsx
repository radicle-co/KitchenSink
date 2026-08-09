// @vitest-environment jsdom
/**
 * Component tests for `CookingModeContainer` — the client half of the web Cooking Mode route (T-011).
 *
 * The container's ONE responsibility is the boundary: it turns a TanStack Query result into the
 * `CookingRecipeState` discriminated union `CookingModeScreen` consumes, injects the web session store,
 * and owns the two navigations (retry, and leaving for the recipe). The screen and its leaves are
 * covered where they are defined (`@commise/features-cooking`), so they are used REAL here rather than
 * mocked — that is what makes these assertions prove the wiring instead of restating it.
 *
 * Every state the route can present is covered, per the UI testing policy:
 *  - loading — the query is in flight;
 *  - error — the query failed, and the retry the screen surfaces reaches `refetch`;
 *  - settled-but-absent — stopped loading, no error, no data: a FAILURE, not a permanent spinner (B21);
 *  - ready — the first step renders and forward navigation advances it;
 *  - empty — a recipe that loaded but has no steps at all;
 *  - exit / finish — both leave for the recipe's detail page, so the session's two endings are wired.
 *
 * `useRecipe` is replaced with a double (the network is not this unit's responsibility) and
 * `next/navigation` is stubbed for `useParams`/`useRouter`, which have no App Router context under vitest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UseQueryResult } from '@tanstack/react-query';
import type { RecipeDetail } from '@kitchensink/recipe-core';
import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';

const { useRecipeMock, pushMock } = vi.hoisted(() => ({ useRecipeMock: vi.fn(), pushMock: vi.fn() }));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({ useRecipe: useRecipeMock }));
vi.mock('next/navigation', () => ({
    useParams: () => ({ locale: 'en', id: 'rec_1' }),
    useRouter: () => ({ push: pushMock }),
}));

const { CookingModeContainer } = await import('../CookingModeContainer');

/** A recipe with three steps, the second of which carries a one-minute timer. */
const threeStepRecipe = (): RecipeDetail =>
    makeRecipeDetail({
        id: 'rec_1',
        title: 'Weeknight Pasta',
        ingredients: [
            { ingredientId: 'ing_salt', name: 'Salt', quantity: 1, unit: 'tsp', isUserEntered: false },
            { ingredientId: 'ing_pasta', name: 'Pasta', quantity: 200, unit: 'g', isUserEntered: false },
        ],
        steps: [
            { stepNumber: 1, instruction: 'Boil the water.' },
            { stepNumber: 2, instruction: 'Cook the pasta.', timerSeconds: 60 },
            { stepNumber: 3, instruction: 'Drain and serve.' },
        ],
    });

/** Resolve `useRecipe` as an in-flight query. */
function mockLoading(): void {
    useRecipeMock.mockReturnValue({ isLoading: true, isError: false, data: undefined } as unknown as UseQueryResult);
}

/** Resolve `useRecipe` as a failed query, returning its `refetch` spy. */
function mockError(): ReturnType<typeof vi.fn> {
    const refetch = vi.fn().mockResolvedValue(undefined);
    useRecipeMock.mockReturnValue({
        isLoading: false,
        isError: true,
        data: undefined,
        error: new Error('network down'),
        refetch,
    } as unknown as UseQueryResult);

    return refetch;
}

/** Resolve `useRecipe` as a settled query carrying `recipe`. */
function mockReady(recipe: RecipeDetail): void {
    useRecipeMock.mockReturnValue({
        isLoading: false,
        isError: false,
        data: recipe,
        refetch: vi.fn(),
    } as unknown as UseQueryResult);
}

beforeEach(() => {
    window.localStorage.clear();
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
});

describe('CookingModeContainer', () => {
    it('renders the loading surface while the recipe is in flight', () => {
        mockLoading();

        render(<CookingModeContainer recipeId="rec_1" />);

        expect(screen.getByRole('status', { name: 'Loading recipe' })).toBeInTheDocument();
        // Nothing cookable is offered while the recipe is unknown.
        expect(screen.queryByRole('button', { name: 'Next step' })).not.toBeInTheDocument();
    });

    it('renders the error surface and retries the recipe query from it', async () => {
        const refetch = mockError();
        const user = userEvent.setup();

        render(<CookingModeContainer recipeId="rec_1" />);

        expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load this recipe.");

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('treats a settled-but-absent recipe as a FAILURE, never a permanent spinner (B21)', () => {
        useRecipeMock.mockReturnValue({
            isLoading: false,
            isError: false,
            data: undefined,
            refetch: vi.fn(),
        } as unknown as UseQueryResult);

        render(<CookingModeContainer recipeId="rec_1" />);

        expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load this recipe.");
        expect(screen.queryByRole('status', { name: 'Loading recipe' })).not.toBeInTheDocument();
    });

    it('opens on the first step and advances through the recipe', async () => {
        mockReady(threeStepRecipe());
        const user = userEvent.setup();

        render(<CookingModeContainer recipeId="rec_1" />);

        expect(await screen.findByRole('heading', { name: 'Step 1 of 3' })).toBeInTheDocument();
        expect(screen.getByText('Boil the water.')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Next step' }));

        expect(await screen.findByRole('heading', { name: 'Step 2 of 3' })).toBeInTheDocument();
        expect(screen.getByText('Cook the pasta.')).toBeInTheDocument();
    });

    it('feeds the recipe’s ingredients to the checklist', async () => {
        mockReady(threeStepRecipe());
        const user = userEvent.setup();

        render(<CookingModeContainer recipeId="rec_1" />);
        await screen.findByRole('heading', { name: 'Step 1 of 3' });

        await user.click(screen.getByRole('button', { name: 'Ingredients' }));

        expect(await screen.findByRole('checkbox', { name: '1 tsp Salt' })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: '200 g Pasta' })).toBeInTheDocument();
    });

    it('renders the empty surface for a recipe that has no steps', async () => {
        mockReady(makeRecipeDetail({ id: 'rec_1', steps: [] }));

        render(<CookingModeContainer recipeId="rec_1" />);

        expect(await screen.findByRole('heading', { name: 'This recipe has no steps yet' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Next step' })).not.toBeInTheDocument();
    });

    it('leaves for the recipe’s detail page when the cook exits mid-session', async () => {
        mockReady(threeStepRecipe());
        const user = userEvent.setup();

        render(<CookingModeContainer recipeId="rec_1" />);
        await screen.findByRole('heading', { name: 'Step 1 of 3' });

        await user.click(screen.getByRole('button', { name: 'Exit cooking mode' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1');
    });

    it('leaves for the recipe’s detail page when the cook finishes the last step', async () => {
        mockReady(makeRecipeDetail({ id: 'rec_1', steps: [{ stepNumber: 1, instruction: 'Serve.' }] }));
        const user = userEvent.setup();

        render(<CookingModeContainer recipeId="rec_1" />);
        await screen.findByRole('heading', { name: 'Step 1 of 1' });

        await user.click(screen.getByRole('button', { name: 'Finish cooking' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1');
    });
});
