/**
 * Recipe editor (mobile, T067). The controlled state layer shared by the create and edit screens: it owns
 * the in-progress {@link RecipeFormValues} and the validation errors, wires the ingredient typeahead
 * ({@link IngredientPicker}) so each resolved line carries a catalog id, and hands the presentational
 * `RecipeForm` building block its props. It performs NO data fetching and runs NO mutation — the composing
 * screen owns those and passes `submitting`/`submitError`/`onSubmit`. Submission is gated on a clean
 * validation pass so an incomplete form never reaches the network.
 */
import {
    RecipeForm,
    validateRecipeForm,
    type RecipeFormErrors,
    type RecipeFormMode,
    type RecipeFormValues,
} from '@commise/features-recipes';
import type { JSX } from 'react';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { IngredientPicker, type ResolvedIngredient } from '../components/IngredientPicker.js';

/** Props for {@link RecipeEditor}. */
export interface RecipeEditorProps {
    /** Create vs edit — selects the form's heading and submit copy. */
    readonly mode: RecipeFormMode;
    /** The seed form values (blank for create, mapped from the loaded recipe for edit). */
    readonly initialValues: RecipeFormValues;
    /** Whether the composing screen's create/update mutation is in flight. */
    readonly submitting: boolean;
    /** A localized error to surface above the form when the mutation failed. */
    readonly submitError?: string;
    /** Called with the validated values when the user submits a valid form. */
    readonly onSubmit: (values: RecipeFormValues) => void;
    /** Called when the user cancels the editor. */
    readonly onCancel: () => void;
}

/**
 * The recipe create/edit editor.
 *
 * @param props - Mode, seed values, submission state, and the submit/cancel callbacks.
 * @returns The typeahead + controlled recipe form.
 */
export function RecipeEditor({
    mode,
    initialValues,
    submitting,
    submitError,
    onSubmit,
    onCancel,
}: RecipeEditorProps): JSX.Element {
    const [values, setValues] = useState<RecipeFormValues>(initialValues);
    const [errors, setErrors] = useState<RecipeFormErrors>({});

    const handleSubmit = (): void => {
        const nextErrors = validateRecipeForm(values);
        setErrors(nextErrors);

        if (Object.keys(nextErrors).length === 0) {
            onSubmit(values);
        }
    };

    const appendResolved = (ingredient: ResolvedIngredient): void => {
        setValues((current) => ({
            ...current,
            ingredients: [
                ...current.ingredients,
                { ingredientId: ingredient.id, name: ingredient.name, quantity: 1, resolutionStatus: 'RESOLVED' },
            ],
        }));
    };

    return (
        <View>
            {submitError !== undefined && submitError.length > 0 && (
                <Text accessibilityRole="alert">{submitError}</Text>
            )}
            <IngredientPicker onResolve={appendResolved} />
            <RecipeForm
                values={values}
                errors={errors}
                mode={mode}
                submitting={submitting}
                onChange={setValues}
                onSubmit={handleSubmit}
                onCancel={onCancel}
            />
        </View>
    );
}
