/**
 * Recipe editor (mobile, T067; CP-6/P1 — now FULLY CONTROLLED). The presentational orchestration layer
 * shared by the create and edit screens: it wires the ingredient typeahead ({@link IngredientPicker}) and
 * poll-after-add, and hands the presentational `RecipeForm` building block its props. It performs NO data
 * fetching and runs NO mutation, and — since CP-6/P1 — it owns NO state of its own either: `values`/`errors`
 * come in from the caller and every edit reports back via `onChange`, exactly mirroring the web container's
 * direct use of `RecipeForm`. This closes the mobile-vs-web reseed incompatibility (see
 * `useRecipeEditor`'s module doc): the old `useState(initialValues)`-seeded-once-on-mount design was WHY the
 * edit screen needed a `seedNonce`/`seedOverride` remount hack to reseed after "use theirs" — a controlled
 * component has no such need, because the caller can always just call `onChange` again.
 *
 * The create screen (no seed/conflict/version concerns) owns its own local `values`/`errors` `useState` and
 * passes them down the same way the edit screen's `useRecipeEditor` hook does — same controlled contract,
 * different state owner.
 */
import {
    pendingIngredientIds,
    RecipeForm,
    setIngredientStatusById,
    type RecipeFormErrors,
    type RecipeFormMode,
    type RecipeFormValues,
} from '@commise/features-recipes';
import type { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { JSX } from 'react';
import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { IngredientPicker, type ResolvedIngredient } from '../components/IngredientPicker.js';
import { IngredientStatusPoller } from '../components/IngredientStatusPoller.js';

/** Props for {@link RecipeEditor}. */
export interface RecipeEditorProps {
    /** Create vs edit — selects the form's heading and submit copy. */
    readonly mode: RecipeFormMode;
    /** The controlled draft (blank for create, seeded from the loaded recipe for edit). */
    readonly values: RecipeFormValues;
    /** Field-level validation errors to surface; absent/empty when the form is valid. */
    readonly errors?: RecipeFormErrors;
    /** Called with the next values on every field/row edit (add, remove, or change). */
    readonly onChange: (next: RecipeFormValues) => void;
    /** Whether the composing screen's create/update mutation is in flight. */
    readonly submitting: boolean;
    /** A localized error to surface above the form when the mutation failed. */
    readonly submitError?: string;
    /** Called when the user submits the form — the caller validates (see `useRecipeEditor.submit`). */
    readonly onSubmit: () => void;
    /** Called when the user cancels the editor. */
    readonly onCancel: () => void;
}

/**
 * The recipe create/edit editor.
 *
 * @param props - Mode, the controlled draft + its change handler, submission state, and the submit/cancel callbacks.
 * @returns The typeahead + controlled recipe form.
 */
export function RecipeEditor({
    mode,
    values,
    errors,
    onChange,
    submitting,
    submitError,
    onSubmit,
    onCancel,
}: RecipeEditorProps): JSX.Element {
    // Carry the line's ACTUAL resolution status from the picker (a food added by name may be PENDING and
    // resolve later) — never assume RESOLVED, or a still-resolving line would never be polled. A line with no
    // status (a plain freeform create) simply carries none.
    const appendResolved = (ingredient: ResolvedIngredient): void => {
        onChange({
            ...values,
            ingredients: [
                ...values.ingredients,
                {
                    ingredientId: ingredient.id,
                    name: ingredient.name,
                    quantity: 1,
                    ...(ingredient.resolutionStatus === undefined
                        ? {}
                        : { resolutionStatus: ingredient.resolutionStatus }),
                },
            ],
        });
    };

    // Poll-after-add (data-model R5): a line added `PENDING` resolves in the background. `setIngredientStatusById`
    // is idempotent (returns the same reference when the status is unchanged) so the per-line pollers below
    // cannot loop. `onChange` takes the next full value (no functional-updater form), so this callback must
    // close over `values` and is only as stable as the draft itself — it still avoids rebuilding an identical
    // function on every unrelated re-render (e.g. `submitting` churn).
    const applyLineStatus = useCallback(
        (ingredientId: string, status: FoodResolutionStatus): void => {
            onChange(setIngredientStatusById(values, ingredientId, status));
        },
        [onChange, values],
    );

    return (
        // flex:1 so the child RecipeForm's ScrollView inherits a bounded height and can actually scroll — the
        // ingredient picker stays pinned above it as the form scrolls.
        <View style={styles.container}>
            {submitError !== undefined && submitError.length > 0 && (
                <Text accessibilityRole="alert">{submitError}</Text>
            )}
            <IngredientPicker onResolve={appendResolved} />
            {pendingIngredientIds(values).map((id) => (
                <IngredientStatusPoller key={id} ingredientId={id} onStatus={applyLineStatus} />
            ))}
            <RecipeForm
                values={values}
                errors={errors}
                mode={mode}
                submitting={submitting}
                onChange={onChange}
                onSubmit={onSubmit}
                onCancel={onCancel}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
});
