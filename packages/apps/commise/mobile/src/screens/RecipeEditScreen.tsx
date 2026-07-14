/**
 * Recipe-edit screen (mobile, T067). Loads the recipe via `useRecipe`, seeds the {@link RecipeEditor} from
 * the loaded read model ({@link toRecipeFormValues}), and wires submit to the `useUpdateRecipe` mutation —
 * carrying the loaded `currentVersion` as `expectedVersion` for the service's optimistic-concurrency check
 * (a concurrent edit surfaces as a conflict, T070, handled separately). Renders localized loading and error
 * states until the recipe resolves; a failed save is surfaced as an inline alert inside the editor.
 */
import { toCreateRecipeInput, type RecipeFormValues } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { useRecipe, useUpdateRecipe } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { mobileMessages } from '../i18n/messages.js';
import { RecipeEditor } from './RecipeEditor.js';
import { toRecipeFormValues } from './toRecipeFormValues.js';

/** Props for {@link RecipeEditScreen}. */
export interface RecipeEditScreenProps {
    /** The id of the recipe to edit. */
    readonly recipeId: string;
    /** Invoked with the recipe's id after a successful save. */
    readonly onSaved: (recipeId: string) => void;
    /** Invoked when the user cancels the editor. */
    readonly onCancel: () => void;
}

/**
 * The recipe-edit screen.
 *
 * @param props - The recipe id and the save/cancel callbacks the navigator wires.
 * @returns The loading, error, or populated editor.
 */
export function RecipeEditScreen({ recipeId, onSaved, onCancel }: RecipeEditScreenProps): JSX.Element {
    const { recipes: t } = useMessages(mobileMessages);
    const query = useRecipe(recipeId);
    const update = useUpdateRecipe();

    if (query.isLoading) {
        return (
            <View accessibilityLabel={t.detailLoading} style={styles.center}>
                <ActivityIndicator />
            </View>
        );
    }

    if (query.isError || query.data === undefined) {
        return (
            <View style={styles.center}>
                <Pressable accessibilityRole="button" accessibilityLabel={t.back} onPress={onCancel}>
                    <Text>{t.back}</Text>
                </Pressable>
                <Text accessibilityRole="alert">{t.detailError}</Text>
            </View>
        );
    }

    const recipe = query.data;

    const handleSubmit = (values: RecipeFormValues): void => {
        update.mutate(
            { id: recipeId, input: { ...toCreateRecipeInput(values), expectedVersion: recipe.currentVersion } },
            { onSuccess: (updated) => onSaved(updated.id) },
        );
    };

    return (
        <RecipeEditor
            mode="edit"
            initialValues={toRecipeFormValues(recipe)}
            submitting={update.isPending}
            submitError={update.isError ? t.saveError : undefined}
            onSubmit={handleSubmit}
            onCancel={onCancel}
        />
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
