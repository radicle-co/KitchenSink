'use client';

/**
 * Container for the recipe-edit route (CP-6/P1: rewired onto the shared `useRecipeEditor` headless hook,
 * `@commise/features-recipes/hooks`). The hook owns the whole edit lifecycle — seed-once, validation,
 * submit-with-`expectedVersion`, the 409-to-conflict transition, and the three FR-007c resolutions — as a
 * discriminated-union statechart (`EditorState`); this container is now a thin renderer that switches on
 * `state.status` and wires the shared presentational `RecipeForm`/`RecipeConflictView` building blocks plus
 * the app-owned {@link IngredientPicker}/{@link RecipePhotoUploaderContainer}. See the hook's module doc for
 * the full statechart, the seed-once guard, and the reseed-incompatibility fix it resolves (web previously
 * reseeded in place; mobile previously remounted via a `seedNonce`/`seedOverride` hack — both platforms now
 * drive the SAME `setValues` transition).
 */
import {
    pendingIngredientIds,
    RecipeConflictView,
    RecipeForm,
    setIngredientStatusById,
    toRecipeFormValues,
    type RecipeFormIngredient,
} from '@commise/features-recipes';
import { useRecipeEditor } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import { isNotFoundError } from '@kitchensink/recipe-service-client';
import type { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type { FC } from 'react';

import { IngredientPicker } from '@/components/recipes/IngredientPicker';
import { IngredientStatusPoller } from '@/components/recipes/IngredientStatusPoller';
import { RecipePhotoUploaderContainer } from '@/components/recipes/RecipePhotoUploaderContainer';
import { webMessages } from '@/i18n/messages';

/** Props for {@link RecipeEditContainer}. */
export interface RecipeEditContainerProps {
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
    /** The recipe id from the `[id]` route segment. */
    readonly recipeId: string;
}

/**
 * The live recipe-edit container.
 *
 * @param props - The active locale and the recipe id to edit.
 * @returns The wired edit form, a conflict resolver, or a localized loading / not-found / error affordance.
 */
export const RecipeEditContainer: FC<RecipeEditContainerProps> = ({ locale, recipeId }) => {
    const router = useRouter();
    const { recipes } = useMessages(webMessages);
    const detailRoute = `/${locale}/recipes/${recipeId}` as Route;
    const editor = useRecipeEditor(recipeId, { onSaved: () => router.push(detailRoute) });

    if (editor.query.isError) {
        const notFound = isNotFoundError(editor.query.error);

        return (
            <div role="alert">
                <p>{notFound ? recipes.detail.notFoundTitle : recipes.detail.errorTitle}</p>
                {!notFound && (
                    <button type="button" onClick={() => void editor.query.refetch()}>
                        {recipes.detail.retry}
                    </button>
                )}
            </div>
        );
    }

    if (editor.state.status === 'loading') {
        return <div role="status" aria-label={recipes.detail.loadingLabel} />;
    }

    const addIngredient = (line: RecipeFormIngredient): void => {
        editor.setValues({ ...editor.values, ingredients: [...editor.values.ingredients, line] });
    };

    const applyLineStatus = (ingredientId: string, status: FoodResolutionStatus): void => {
        editor.setValues(setIngredientStatusById(editor.values, ingredientId, status));
    };

    if (editor.state.status === 'conflict') {
        const { theirs, mine, draft, mergeSelections } = editor.state;

        return (
            <RecipeConflictView
                mineTitle={draft.title}
                mine={mine}
                theirs={theirs}
                mineValues={draft}
                theirsValues={toRecipeFormValues(theirs)}
                selections={mergeSelections}
                onSelectionsChange={editor.resolutions.setMergeSelections}
                onKeepMine={editor.resolutions.keepMine}
                onUseTheirs={editor.resolutions.useTheirs}
                onMerge={editor.resolutions.merge}
            />
        );
    }

    return (
        <div>
            <IngredientPicker onSelect={addIngredient} />
            {pendingIngredientIds(editor.values).map((id) => (
                <IngredientStatusPoller key={id} ingredientId={id} onStatus={applyLineStatus} />
            ))}
            <RecipeForm
                mode="edit"
                values={editor.values}
                errors={editor.errors}
                submitting={editor.state.status === 'submitting'}
                onChange={editor.setValues}
                onSubmit={editor.submit}
                onCancel={() => router.push(detailRoute)}
            />
            {editor.submitError && <p role="alert">{recipes.form.submitError}</p>}
            <RecipePhotoUploaderContainer recipeId={recipeId} />
        </div>
    );
};
