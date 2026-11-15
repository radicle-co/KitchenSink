/**
 * Integration tests for the mobile cooking-mode screen (plan 0002, item 11): the REAL recipe-service hooks over a
 * network-guarded fake client, rendered through react-native-web, with only the session claims and the profile read
 * mocked. They pin what the pure policies cannot: the read hold across a REAL refetch (TanStack's `focusManager` is
 * wired to `AppState` in this app, so a return to the app refetches the recipe under a cook on a step), the cook-change
 * session boundary, and the read outcomes (404, failure, draft, no steps).
 */
import { RecipeStatus } from '@kitchensink/recipe-core';
import { NotFoundError } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { renderWithRecipeClient } from '@commise/test-utils';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionClaims } from '../../src/hooks/useSessionClaims.js';
import { CookingModeScreen } from '../../src/screens/CookingModeScreen.js';
import { makeRecipeDetail } from '../__fixtures__/recipes.js';

// Hoisted, as the web sibling's mocks are, so the profile can be answered without a cast on the real hook's type.
const { useUserProfileMock } = vi.hoisted(() => ({ useUserProfileMock: vi.fn() }));

vi.mock('../../src/hooks/useUserProfile.js', () => ({ useUserProfile: useUserProfileMock }));
vi.mock('../../src/hooks/useSessionClaims.js', () => ({ useSessionClaims: vi.fn() }));

const OWNER_ID = 'usr_1';
const FOUR = [
    { stepNumber: 1, instruction: 'Heat the oil.' },
    { stepNumber: 2, instruction: 'Add the onion.' },
    { stepNumber: 3, instruction: 'Roast for 40 min.' },
    { stepNumber: 4, instruction: 'Rest.' },
];
const settledProfile = { status: 'success', isLoading: false, data: { user: { id: 'usr_profile' } } };

/** The place line: the app writes a no-break space between its words, so a plain-space string never matches. */
const stepOf = (current: number, total: number): RegExp => new RegExp(`^Step\\s${current}\\sof\\s${total}$`, 'u');
const published = () =>
    makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, status: RecipeStatus.PUBLISHED, steps: FOUR });
const nextStep = () => screen.getByRole('button', { name: /^(Next step|Start step|Finish)/u });

const onLeave = vi.fn();
const onEdit = vi.fn();
const onHome = vi.fn();
const screenOf = () => <CookingModeScreen recipeId="rec_1" onLeave={onLeave} onEdit={onEdit} onHome={onHome} />;

beforeEach(() => {
    vi.mocked(useSessionClaims).mockReturnValue({ external_id: OWNER_ID });
    useUserProfileMock.mockReturnValue(settledProfile);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

/** Mount on a published recipe and walk to step 3, keeping the client and cache to refetch through. */
async function cookingOnStepThree() {
    const client = createFakeRecipeServiceClient();
    const read = vi.spyOn(client, 'getRecipeById').mockResolvedValue(published());
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderWithRecipeClient(screenOf(), client, { queryClient });
    await screen.findByText(stepOf(1, 4));
    fireEvent.click(nextStep());
    fireEvent.click(nextStep());
    expect(screen.getByText(stepOf(3, 4))).toBeTruthy();

    return { read, queryClient, rerender: view.rerender };
}

describe('CookingModeScreen: the read outcomes', () => {
    it('cooks a published recipe from step 1', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(published());
        renderWithRecipeClient(screenOf(), client);

        expect(await screen.findByText(stepOf(1, 4))).toBeTruthy();
    });

    it('shows a 404 as not available', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockRejectedValue(new NotFoundError('Recipe not found'));
        renderWithRecipeClient(screenOf(), client);

        expect(await screen.findByText('This recipe isn’t available any more')).toBeTruthy();
    });

    it('shows a recipe with no steps as such', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({
                id: 'rec_1',
                ownerId: OWNER_ID,
                status: RecipeStatus.PUBLISHED,
                steps: [{ stepNumber: 1, instruction: ' ' }],
            }),
        );
        renderWithRecipeClient(screenOf(), client);

        expect(await screen.findByText('This recipe has no steps yet')).toBeTruthy();
    });
});

describe('CookingModeScreen: a cook on a step is not moved by a later read', () => {
    it.each([
        ['a 404', () => Promise.reject(new NotFoundError('Recipe not found'))],
        ['another failure', () => Promise.reject(new Error('network down'))],
        [
            'a draft',
            () =>
                Promise.resolve(
                    makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, status: RecipeStatus.DRAFT, steps: FOUR }),
                ),
        ],
        [
            'blank steps',
            () =>
                Promise.resolve(
                    makeRecipeDetail({
                        id: 'rec_1',
                        ownerId: OWNER_ID,
                        status: RecipeStatus.PUBLISHED,
                        steps: [{ stepNumber: 1, instruction: ' ' }],
                    }),
                ),
        ],
    ])('stays on step 3 with no notice when a refetch returns %s, and Finish reaches Done', async (_name, next) => {
        const { read, queryClient } = await cookingOnStepThree();
        read.mockImplementation(next);

        await act(async () => {
            await queryClient.refetchQueries();
        });

        expect(screen.getByText(stepOf(3, 4))).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(onEdit).not.toHaveBeenCalled();

        fireEvent.click(nextStep());
        fireEvent.click(nextStep());
        expect(screen.getByRole('heading', { name: 'All 4 steps done' })).toBeTruthy();
    });

    it('ends the session when the cook changes', async () => {
        const { rerender } = await cookingOnStepThree();
        vi.mocked(useSessionClaims).mockReturnValue({ external_id: 'usr_other' });

        rerender(screenOf());

        expect(await screen.findByText(stepOf(1, 4))).toBeTruthy();
    });
});
