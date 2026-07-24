/**
 * Recipe-create screen (mobile, T067; CP-6/P1 — `RecipeEditor` is now a controlled component, so this
 * screen owns its own `values`/`errors` state — a create has no seed/conflict/version concerns, so it does
 * NOT use `useRecipeEditor` (that hook's seed-once/409/resolution machinery is edit-only). Validates on
 * submit exactly as `RecipeEditor` used to internally, then wires the result to the `useCreateRecipe`
 * mutation, mapping the editor's values to the `CreateRecipeInput` wire contract. On success it hands the
 * new recipe's id upward so the navigator can open its detail; a failed create is surfaced as an inline
 * alert. Mirrors the web `RecipeCreateContainer`'s direct `RecipeForm` wiring, one layer down (through the
 * shared `RecipeEditor` leaf mobile's create AND edit screens both compose).
 */
import {
    defaultRecipeFormValues,
    toCreateRecipeInput,
    validateRecipeForm,
    type RecipeFormErrors,
    type RecipeFormValues,
} from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { useCreateRecipe } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useState } from 'react';

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
    const [values, setValues] = useState<RecipeFormValues>(defaultRecipeFormValues);
    const [errors, setErrors] = useState<RecipeFormErrors>({});

    const handleSubmit = (): void => {
        const nextErrors = validateRecipeForm(values);
        setErrors(nextErrors);

        if (Object.keys(nextErrors).length > 0) {
            return;
        }

        create.mutate(toCreateRecipeInput(values), {
            onSuccess: (recipe) => onCreated(recipe.id),
        });
    };

    return (
        <RecipeEditor
            mode="create"
            values={values}
            errors={errors}
            onChange={setValues}
            submitting={create.isPending}
            submitError={create.isError ? t.createError : undefined}
            onSubmit={handleSubmit}
            onCancel={onCancel}
        />
    );
}
