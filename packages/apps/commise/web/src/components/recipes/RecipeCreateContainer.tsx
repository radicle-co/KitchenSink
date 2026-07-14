'use client';

/**
 * Container for the recipe-create route: owns the editable {@link RecipeFormValues} (seeded blank via
 * `defaultRecipeFormValues`), renders the shared presentational `RecipeForm` in create mode plus the
 * app-owned {@link IngredientPicker} that resolves ingredient lines to real catalog ids, validates with the
 * feature's `validateRecipeForm` before submitting, maps the values onto the `CreateRecipeInput` wire shape
 * (`toCreateRecipeInput`), and persists via `useCreateRecipe`. On success it navigates to the new recipe's
 * detail route. Remote state stays in TanStack Query; only the in-progress form draft is local.
 */
import {
    RecipeForm,
    defaultRecipeFormValues,
    toCreateRecipeInput,
    validateRecipeForm,
} from '@commise/features-recipes';
import type { RecipeFormErrors, RecipeFormIngredient, RecipeFormValues } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { useCreateRecipe } from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FC } from 'react';

import { IngredientPicker } from '@/components/recipes/IngredientPicker';
import { webMessages } from '@/i18n/messages';

/** Props for {@link RecipeCreateContainer}. */
export interface RecipeCreateContainerProps {
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
}

/**
 * The live recipe-create container.
 *
 * @param props - The active locale.
 * @returns The ingredient picker + wired create {@link RecipeForm}.
 */
export const RecipeCreateContainer: FC<RecipeCreateContainerProps> = ({ locale }) => {
    const router = useRouter();
    const { recipes } = useMessages(webMessages);
    const createRecipe = useCreateRecipe();
    const [values, setValues] = useState<RecipeFormValues>(defaultRecipeFormValues);
    const [errors, setErrors] = useState<RecipeFormErrors>({});

    const addIngredient = (line: RecipeFormIngredient): void => {
        setValues((current) => ({ ...current, ingredients: [...current.ingredients, line] }));
    };

    const handleSubmit = (): void => {
        const nextErrors = validateRecipeForm(values);
        setErrors(nextErrors);

        if (Object.keys(nextErrors).length > 0) {
            return;
        }

        createRecipe.mutate(toCreateRecipeInput(values), {
            onSuccess: (created) => router.push(`/${locale}/recipes/${created.id}` as Route),
        });
    };

    return (
        <div>
            <IngredientPicker onSelect={addIngredient} />
            <RecipeForm
                mode="create"
                values={values}
                errors={errors}
                submitting={createRecipe.isPending}
                onChange={setValues}
                onSubmit={handleSubmit}
                onCancel={() => router.push(`/${locale}/recipes` as Route)}
            />
            {createRecipe.isError && <p role="alert">{recipes.form.submitError}</p>}
        </div>
    );
};
