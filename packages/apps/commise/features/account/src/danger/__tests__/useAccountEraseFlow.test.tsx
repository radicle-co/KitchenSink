/**
 * The erasure flow's state machine, once for both apps (it was written twice, line for line, in web's
 * `AccountEraseForm` and mobile's `AccountDangerZone`): the typed phrase, the donate election, the confirm that runs the
 * recipes -> account -> exit sequence, and which failure the dialog owns.
 *
 * The property that matters most is the SPLIT of failures: a failed recipe or account step is the dialog's own
 * `submitError` (nothing was erased, retrying is right), while a failed EXIT means the erasure WAS accepted, so it must
 * NOT read as a submit error (retrying would be a lie) and is reported upward instead.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';

import type { ErasureSteps } from '../../erasureSequence.js';
import { useAccountEraseFlow } from '../useAccountEraseFlow.js';

const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
        {children}
    </QueryClientProvider>
);

const recipe = (id: string, over: { visibility?: RecipeVisibility; status?: RecipeStatus } = {}) => ({
    id,
    title: `Recipe ${id}`,
    visibility: over.visibility ?? RecipeVisibility.PRIVATE,
    status: over.status ?? RecipeStatus.PUBLISHED,
});

function setup(
    over: {
        steps?: Partial<ErasureSteps>;
        recipes?: Partial<Parameters<typeof useAccountEraseFlow>[0]['recipes']>;
    } = {},
) {
    const steps: ErasureSteps = {
        eraseRecipes: vi.fn(async () => undefined),
        eraseAccount: vi.fn(async () => undefined),
        leave: vi.fn(async () => undefined),
        recipesAlreadyErased: () => false,
        ...over.steps,
    };
    const onExitFailed = vi.fn();
    const onCancel = vi.fn();
    const view = renderHook(
        () =>
            useAccountEraseFlow({
                recipes: {
                    recipes: [recipe('a'), recipe('b', { visibility: RecipeVisibility.PUBLIC })],
                    isLoading: false,
                    isError: false,
                    ...over.recipes,
                },
                steps,
                onExitFailed,
                onCancel,
            }),
        { wrapper },
    );

    return { ...view, steps, onExitFailed, onCancel };
}

describe('useAccountEraseFlow', () => {
    it('is an open dialog offering only the donation-eligible recipes, as id and title', () => {
        const { result } = setup();

        expect(result.current.open).toBe(true);
        expect(result.current.donatableRecipes).toEqual([{ id: 'a', title: 'Recipe a' }]);
    });

    it('passes the recipe read states through, a failed read as recipesError', () => {
        const { result } = setup({ recipes: { isLoading: true, isError: true } });

        expect(result.current.recipesLoading).toBe(true);
        expect(result.current.recipesError).toBe(true);
    });

    it('toggles a recipe in and out of the election', () => {
        const { result } = setup();

        act(() => result.current.onToggleRecipe('a'));
        expect(result.current.selectedRecipeIds).toEqual(['a']);

        act(() => result.current.onToggleRecipe('a'));
        expect(result.current.selectedRecipeIds).toEqual([]);
    });

    it('sends the typed phrase and the election to the recipe step, then the account step, then leaves', async () => {
        const { result, steps } = setup();

        act(() => result.current.onToggleRecipe('a'));
        act(() => result.current.onPhraseChange('ERASE'));
        act(() => result.current.onConfirm());

        await waitFor(() => expect(steps.leave).toHaveBeenCalledOnce());
        expect(steps.eraseRecipes).toHaveBeenCalledWith({ confirmationPhrase: 'ERASE', publishRecipeIds: ['a'] });
        expect(steps.eraseAccount).toHaveBeenCalledOnce();
    });

    it('is submitting while the sequence runs, through the sign-out', async () => {
        let finish: () => void = () => undefined;
        const { result } = setup({ steps: { leave: () => new Promise<void>((resolve) => (finish = resolve)) } });

        act(() => result.current.onConfirm());
        await waitFor(() => expect(result.current.submitting).toBe(true));

        act(() => finish());
        await waitFor(() => expect(result.current.submitting).toBe(false));
    });

    it.each([
        ['recipes', { eraseRecipes: vi.fn(async () => Promise.reject(new Error('down'))) }],
        ['account', { eraseAccount: vi.fn(async () => Promise.reject(new Error('down'))) }],
    ])('owns a failed %s step as its submit error and does not report an exit failure', async (_step, steps) => {
        const { result, onExitFailed } = setup({ steps });

        act(() => result.current.onConfirm());

        await waitFor(() => expect(result.current.submitError).toBe(true));
        expect(onExitFailed).not.toHaveBeenCalled();
    });

    it('reports a failed EXIT upward and does NOT call it a submit error (the erasure was accepted)', async () => {
        const { result, onExitFailed } = setup({
            steps: { leave: vi.fn(async () => Promise.reject(new Error('stuck'))) },
        });

        act(() => result.current.onConfirm());

        await waitFor(() => expect(onExitFailed).toHaveBeenCalledOnce());
        expect(result.current.submitError).toBe(false);
    });

    it('cancels through the caller', () => {
        const { result, onCancel } = setup();

        act(() => result.current.onCancel());

        expect(onCancel).toHaveBeenCalledOnce();
    });
});
