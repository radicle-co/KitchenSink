/**
 * @module @commise/features-account/danger/useAccountEraseFlow — the erasure flow's state machine, once for both apps.
 *
 * Web's `AccountEraseForm` and mobile's `AccountDangerZone` each carried the same `AccountEraseFlow` function: the typed
 * phrase, the donate election, the confirm that runs the recipes -> account -> exit sequence, and the rule for which
 * failure the dialog owns. Only the recipe read, the erasure calls and the sign-out are platform-bound, and the app
 * passes them in; everything else lives here, so a fix to the flow reaches both platforms.
 *
 * **Which failure is whose.** A failed `recipes` or `account` step erased nothing the viewer could not retry, so it is the
 * dialog's own `submitError`. A failed `exit` means the erasure WAS accepted and only leaving failed: retrying it would be
 * a lie, so it is NOT a submit error (B17) and is reported through `onExitFailed` instead, where the surface dismisses
 * the dead dialog and offers the sign-out as the recovery.
 *
 * ⛔ `recipesError` is `isError`, deliberately and not a loading error: a failed refresh blocks the donate election rather
 * than offering a list that may be stale, because erasure destroys every recipe the viewer is not shown.
 *
 * @pattern State — the dialog's phrase and election as one headless hook, with `onConfirm` as its one Command over
 *     `useErasureSequence`
 */
import type { Recipe } from '@kitchensink/recipe-core';
import { useState } from 'react';

import { selectDonatableRecipes } from '../erasure.js';
import { isErasureStepError, useErasureSequence, type ErasureSteps } from '../erasureSequence.js';
import type { AccountEraseDialogProps, DonatableRecipe } from './model.js';

/** The viewer's recipes as the app's read reports them: what the election needs, and the read's own state. */
export interface EraseFlowRecipes {
    /** The recipes the viewer owns. */
    readonly recipes: readonly (Pick<Recipe, 'visibility' | 'status'> & DonatableRecipe)[];
    /** Whether the read is still loading. */
    readonly isLoading: boolean;
    /** Whether the read FAILED. */
    readonly isError: boolean;
}

/** What the flow is given. */
export interface AccountEraseFlowInput {
    /** The viewer's recipes (the app's read). */
    readonly recipes: EraseFlowRecipes;
    /** The platform's three steps (see {@link ErasureSteps}), read when the mutation starts. */
    readonly steps: ErasureSteps;
    /** The erasure was ACCEPTED and only the exit failed. */
    readonly onExitFailed: () => void;
    /** The viewer dismissed the dialog (Cancel / Escape / backdrop). */
    readonly onCancel: () => void;
}

/**
 * The props of the open erasure dialog. The flow is mounted only while it is open, so `open` is always `true`.
 *
 * @param input - The recipes, the platform's steps and the two outcomes the surface owns.
 * @returns The props for `AccountEraseDialog`.
 * @sideEffect `onConfirm` irreversibly erases the recipes and the account, and ends the session.
 */
export function useAccountEraseFlow({
    recipes,
    steps,
    onExitFailed,
    onCancel,
}: AccountEraseFlowInput): AccountEraseDialogProps {
    const sequence = useErasureSequence(steps);
    const [phrase, setPhrase] = useState('');
    const [selectedRecipeIds, setSelectedRecipeIds] = useState<readonly string[]>([]);

    const donatableRecipes = selectDonatableRecipes(recipes.recipes).map((recipe) => ({
        id: recipe.id,
        title: recipe.title,
    }));

    const onToggleRecipe = (recipeId: string): void => {
        setSelectedRecipeIds((current) =>
            current.includes(recipeId) ? current.filter((id) => id !== recipeId) : [...current, recipeId],
        );
    };

    const onConfirm = (): void => {
        sequence.mutate(
            { confirmationPhrase: phrase, publishRecipeIds: selectedRecipeIds },
            {
                // An observer callback: if the flow has unmounted there is no surface left to report to, and the
                // sequence itself is unaffected.
                onError: (error) => {
                    if (isErasureStepError(error, 'exit')) {
                        onExitFailed();
                    }
                },
            },
        );
    };

    return {
        open: true,
        donatableRecipes,
        recipesLoading: recipes.isLoading,
        recipesError: recipes.isError,
        selectedRecipeIds,
        onToggleRecipe,
        phrase,
        onPhraseChange: setPhrase,
        submitting: sequence.isPending,
        submitError: isErasureStepError(sequence.error, 'recipes') || isErasureStepError(sequence.error, 'account'),
        onConfirm,
        onCancel,
    };
}
