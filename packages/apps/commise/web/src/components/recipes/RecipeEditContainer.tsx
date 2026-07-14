'use client';

/**
 * Container for the recipe-edit route: loads the recipe via `useRecipe(id)`, seeds the editable
 * {@link RecipeFormValues} from the loaded {@link RecipeDetail} once, renders the shared presentational
 * `RecipeForm` in edit mode plus the app-owned {@link IngredientPicker}, validates with the feature's
 * `validateRecipeForm`, and persists via `useUpdateRecipe` — carrying `expectedVersion` for the server's
 * optimistic-concurrency check. On success it navigates back to the recipe's detail route. The loading /
 * not-found / error affordances mirror the detail route and are localized through the web dictionary.
 *
 * The recipe stays in TanStack Query; the form draft is local, seeded from the query exactly once (guarded
 * by the seeded id) so a background refetch never clobbers in-progress edits.
 *
 * Concurrent-edit conflict (T070): when the update is rejected for a stale `expectedVersion` (a `409` →
 * {@link isVersionConflictError}), the container refetches the recipe to obtain the latest saved version and
 * renders the shared {@link RecipeConflictView} in place of the form. "Keep mine" re-submits the draft against
 * that FRESH server version (forcing the user's edit to win) and navigates on success — or re-enters conflict
 * mode with the newer server version if it races again. "Use theirs" discards the draft, reseeds the form from
 * the latest saved recipe, and stays on the edit form.
 */
import {
    applyDraftToRecipeDetail,
    RecipeConflictView,
    RecipeForm,
    toCreateRecipeInput,
    validateRecipeForm,
    type RecipeFormErrors,
    type RecipeFormIngredient,
    type RecipeFormValues,
} from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { isNotFoundError, isVersionConflictError } from '@kitchensink/recipe-service-client';
import { useRecipe, useUpdateRecipe } from '@kitchensink/recipe-service-client/hooks';
import type { RecipeDetail, UpdateRecipeInput } from '@kitchensink/recipe-core';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { FC } from 'react';

import { IngredientPicker } from '@/components/recipes/IngredientPicker';
import { webMessages } from '@/i18n/messages';

/** Props for {@link RecipeEditContainer}. */
export interface RecipeEditContainerProps {
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
    /** The recipe id from the `[id]` route segment. */
    readonly recipeId: string;
}

/**
 * Project a loaded {@link RecipeDetail} onto the editor's {@link RecipeFormValues}. Persisted ingredient
 * lines already reference a catalog id, so they seed with their `ingredientId`; the async food-resolution
 * status is not carried on the detail projection, so no status badge is fabricated here. Pure.
 *
 * @param detail - The loaded recipe detail.
 * @returns The seeded form values.
 */
function toRecipeFormValues(detail: RecipeDetail): RecipeFormValues {
    return {
        title: detail.title,
        description: detail.description,
        cuisine: detail.cuisine ?? '',
        tags: [...detail.tags],
        dietaryFlags: [...detail.dietaryFlags],
        servings: detail.servings,
        prepTimeMinutes: detail.prepTimeMinutes,
        cookTimeMinutes: detail.cookTimeMinutes,
        visibility: detail.visibility,
        ingredients: detail.ingredients.map((line) => ({
            ingredientId: line.ingredientId,
            name: line.name,
            quantity: line.quantity,
            ...(line.unit === undefined ? {} : { unit: line.unit }),
            ...(line.notes === undefined ? {} : { notes: line.notes }),
        })),
        steps: detail.steps.map((step) => ({
            instruction: step.instruction,
            ...(step.timerSeconds === undefined ? {} : { timerSeconds: step.timerSeconds }),
        })),
    };
}

/**
 * A pending concurrent-edit conflict: the draft the user tried to save (`draft`), the latest saved recipe
 * that landed while they were editing (`theirs`, freshly refetched), and the projection of the draft onto
 * that latest recipe (`mine`) shown side-by-side by {@link RecipeConflictView}.
 */
interface ConflictState {
    /** The draft the user attempted to save (source of the re-submit and the "mine" title). */
    readonly draft: RecipeFormValues;
    /** The latest saved recipe (its `currentVersion` is the fresh optimistic-concurrency token). */
    readonly theirs: RecipeDetail;
    /** The user's draft projected onto `theirs` for display. */
    readonly mine: RecipeDetail;
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
    const query = useRecipe(recipeId);
    const updateRecipe = useUpdateRecipe();

    const [values, setValues] = useState<RecipeFormValues | null>(null);
    const [errors, setErrors] = useState<RecipeFormErrors>({});
    const [conflict, setConflict] = useState<ConflictState | null>(null);
    const seededIdRef = useRef<string | null>(null);

    // Seed the draft from the loaded recipe once; the guard keeps a background refetch from overwriting edits.
    useEffect(() => {
        if (query.data !== undefined && seededIdRef.current !== query.data.id) {
            seededIdRef.current = query.data.id;
            setValues(toRecipeFormValues(query.data));
        }
    }, [query.data]);

    if (query.isError) {
        const notFound = isNotFoundError(query.error);

        return (
            <div role="alert">
                <p>{notFound ? recipes.detail.notFoundTitle : recipes.detail.errorTitle}</p>
                {!notFound && (
                    <button type="button" onClick={() => void query.refetch()}>
                        {recipes.detail.retry}
                    </button>
                )}
            </div>
        );
    }

    if (values === null || query.data === undefined) {
        return <div role="status" aria-label={recipes.detail.loadingLabel} />;
    }

    const currentVersion = query.data.currentVersion;
    const detailRoute = `/${locale}/recipes/${recipeId}` as Route;

    const addIngredient = (line: RecipeFormIngredient): void => {
        setValues((current) =>
            current === null ? current : { ...current, ingredients: [...current.ingredients, line] },
        );
    };

    // A rejected update for a stale version enters conflict mode against the freshly-refetched server recipe;
    // any other error falls through to the generic submit-error affordance below.
    const handleUpdateError = async (err: unknown, draft: RecipeFormValues): Promise<void> => {
        if (!isVersionConflictError(err)) {
            return;
        }

        const refetched = await query.refetch();
        const theirs = refetched.data ?? query.data;

        if (theirs === undefined) {
            return;
        }

        setConflict({ draft, theirs, mine: applyDraftToRecipeDetail(theirs, draft) });
    };

    // Persist `draft` with the given optimistic-concurrency token; navigate on success, resolve conflicts on 409.
    const submitDraft = (draft: RecipeFormValues, expectedVersion: number): void => {
        const input: UpdateRecipeInput = { ...toCreateRecipeInput(draft), expectedVersion };

        updateRecipe.mutate(
            { id: recipeId, input },
            {
                onSuccess: () => router.push(detailRoute),
                onError: (err) => void handleUpdateError(err, draft),
            },
        );
    };

    const handleSubmit = (): void => {
        const nextErrors = validateRecipeForm(values);
        setErrors(nextErrors);

        if (Object.keys(nextErrors).length > 0) {
            return;
        }

        submitDraft(values, currentVersion);
    };

    // "Keep mine": re-submit the draft against the FRESH server version so the user's edit wins.
    const handleKeepMine = (): void => {
        if (conflict === null) {
            return;
        }

        submitDraft(conflict.draft, conflict.theirs.currentVersion);
    };

    // "Use theirs": abandon the draft, reseed the form from the latest saved recipe, and stay on the form.
    const handleUseTheirs = (): void => {
        if (conflict === null) {
            return;
        }

        setValues(toRecipeFormValues(conflict.theirs));
        setErrors({});
        setConflict(null);
        // The conflicting update left the mutation in an error state; clear it so the reseeded form does not
        // render the generic submit-error alert the user has just resolved.
        updateRecipe.reset();
    };

    if (conflict !== null) {
        return (
            <RecipeConflictView
                mineTitle={conflict.draft.title}
                mine={conflict.mine}
                theirs={conflict.theirs}
                onKeepMine={handleKeepMine}
                onUseTheirs={handleUseTheirs}
            />
        );
    }

    return (
        <div>
            <IngredientPicker onSelect={addIngredient} />
            <RecipeForm
                mode="edit"
                values={values}
                errors={errors}
                submitting={updateRecipe.isPending}
                onChange={setValues}
                onSubmit={handleSubmit}
                onCancel={() => router.push(detailRoute)}
            />
            {updateRecipe.isError && <p role="alert">{recipes.form.submitError}</p>}
        </div>
    );
};
