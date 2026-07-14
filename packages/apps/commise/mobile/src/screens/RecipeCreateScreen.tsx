/**
 * Recipe-create screen (mobile, T067). Seeds the {@link RecipeEditor} with a blank form and wires its submit
 * to the `useCreateRecipe` mutation, mapping the editor's values to the `CreateRecipeInput` wire contract.
 * On success it hands the new recipe's id upward so the navigator can open its detail; a failed create is
 * surfaced as an inline alert. The screen holds no remote state — the mutation + query cache own it.
 */
import { defaultRecipeFormValues, toCreateRecipeInput, type RecipeFormValues } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { useCreateRecipe } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';

import { mobileMessages } from '../i18n/messages.js';
import { RecipeEditor } from './RecipeEditor.js';

/** Props for {@link RecipeCreateScreen}. */
export interface RecipeCreateScreenProps {
    /** Invoked with the created recipe's id after a successful create. */
    readonly onCreated: (recipeId: string) => void;
    /** Invoked when the user cancels the editor. */
    readonly onCancel: () => void;
}

/**
 * The recipe-create screen.
 *
 * @param props - The success + cancel callbacks the navigator wires.
 * @returns The blank editor wired to the create mutation.
 */
export function RecipeCreateScreen({ onCreated, onCancel }: RecipeCreateScreenProps): JSX.Element {
    const { recipes: t } = useMessages(mobileMessages);
    const create = useCreateRecipe();

    const handleSubmit = (values: RecipeFormValues): void => {
        create.mutate(toCreateRecipeInput(values), {
            onSuccess: (recipe) => onCreated(recipe.id),
        });
    };

    return (
        <RecipeEditor
            mode="create"
            initialValues={defaultRecipeFormValues()}
            submitting={create.isPending}
            submitError={create.isError ? t.createError : undefined}
            onSubmit={handleSubmit}
            onCancel={onCancel}
        />
    );
}
