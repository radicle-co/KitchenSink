'use client';

/**
 * Container for the recipe-edit route (CP-6/P1: rewired onto the shared `useRecipeEditor` headless hook,
 * `@commise/features-recipes/hooks`; w3/e1,e2: rewired again onto the 4-step `Wizard` shell). The hook owns
 * the whole edit lifecycle — seed-once, validation, submit-with-`expectedVersion`, the 409-to-conflict
 * transition, the three FR-007c resolutions, AND (w3) the step/draft/publish extensions — as a
 * discriminated-union statechart (`EditorState`) plus orthogonal step-navigation state; this container is a
 * thin renderer that switches on `state.status` and, once past loading/conflict, wires the `Wizard` compound
 * shell — `Wizard.Rail`/`Wizard.TopBar`/`Wizard.Controls` plus one `Wizard.Step` per step, each hosting the
 * SAME extracted `RecipeBasicsFields`/`RecipeIngredientsFields`/`RecipeInstructionsFields`/
 * `RecipeVisibilityField` leaves (`@commise/features-recipes`) — no field is duplicated or rewritten. The
 * app-owned {@link IngredientPicker} composes into step 2 and {@link RecipePhotoUploaderContainer} into step
 * 4, exactly where they rendered before, just now step-scoped. See the hook's module doc for the full
 * statechart and the reseed-incompatibility fix it resolves (web previously reseeded in place; mobile
 * previously remounted via a `seedNonce`/`seedOverride` hack — both platforms now drive the SAME `setValues`
 * transition).
 */
import {
    pendingIngredientIds,
    RecipeBasicsFields,
    RecipeConflictView,
    RecipeIngredientsFields,
    RecipeInstructionsFields,
    RecipeVisibilityField,
    setIngredientStatusById,
    toRecipeFormValues,
    useDiscardGuard,
    Wizard,
    type RecipeFormIngredient,
} from '@commise/features-recipes';
import { useRecipeEditor } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import { isNotFoundError } from '@kitchensink/recipe-service-client';
import type { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
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

    // `editor.setValues` takes the next full value (no functional-updater form, unlike `useState`'s setter), so
    // this callback must close over `editor.values` and is only as stable as the draft itself — it still avoids
    // rebuilding an identical function on every unrelated re-render (e.g. `submitting`/conflict-selection churn).
    // Declared before the early returns below (Rules of Hooks: no conditional hook calls).
    const applyLineStatus = useCallback(
        (ingredientId: string, status: FoodResolutionStatus): void => {
            editor.setValues(setIngredientStatusById(editor.values, ingredientId, status));
        },
        [editor.setValues, editor.values],
    );

    // The discard guard's "unsaved edits" baseline: captured once the recipe has seeded (past `'loading'`),
    // re-captured on every successful save (`'saved'`) — see `useDiscardGuard`'s module doc. Also declared
    // before the early returns (Rules of Hooks).
    const isDirty = useDiscardGuard(editor.values, {
        ready: editor.state.status !== 'loading',
        justSaved: editor.state.status === 'saved',
    });

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
            <Wizard
                mode="edit"
                step={editor.step}
                values={editor.values}
                canAdvanceFrom={editor.canAdvanceFrom}
                stepErrors={editor.stepErrors}
                goNext={editor.goNext}
                goPrev={editor.goPrev}
                goToStep={editor.goToStep}
                saveDraft={editor.saveDraft}
                publish={editor.publish}
                onCancel={() => router.push(detailRoute)}
                isDirty={isDirty}
                submitting={editor.state.status === 'submitting'}
            >
                <Wizard.Rail />
                <Wizard.TopBar />
                <Wizard.Step step={1}>
                    <RecipeBasicsFields values={editor.values} errors={editor.errors} onChange={editor.setValues} />
                    <RecipeVisibilityField values={editor.values} onChange={editor.setValues} />
                </Wizard.Step>
                <Wizard.Step step={2}>
                    <IngredientPicker onSelect={addIngredient} />
                    {pendingIngredientIds(editor.values).map((id) => (
                        <IngredientStatusPoller key={id} ingredientId={id} onStatus={applyLineStatus} />
                    ))}
                    <RecipeIngredientsFields
                        values={editor.values}
                        errors={editor.errors}
                        onChange={editor.setValues}
                    />
                </Wizard.Step>
                <Wizard.Step step={3}>
                    <RecipeInstructionsFields
                        values={editor.values}
                        errors={editor.errors}
                        onChange={editor.setValues}
                    />
                </Wizard.Step>
                <Wizard.Step step={4}>
                    <RecipePhotoUploaderContainer recipeId={recipeId} />
                </Wizard.Step>
                <Wizard.Controls />
            </Wizard>
            {editor.submitError && <p role="alert">{recipes.form.submitError}</p>}
        </div>
    );
};
