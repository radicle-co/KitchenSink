/**
 * Recipe-detail screen (mobile). Drives the shared, presentational native `RecipeDetailView` building block
 * from the typed `useRecipe` query, rendering localized loading and error states until the recipe resolves.
 * The read model (`RecipeDetail`) is handed straight to the view; this screen owns only the fetch state and
 * the optional back affordance.
 */
import { RecipeDetailView } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { useRecipe } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { mobileMessages } from '../i18n/messages.js';

/** Props for {@link RecipeDetailScreen}. */
export interface RecipeDetailScreenProps {
    /** The id of the recipe to display. */
    readonly recipeId: string;
    /** Invoked when the back affordance is activated; the affordance is hidden when omitted. */
    readonly onBack?: () => void;
}

/**
 * The recipe-detail screen.
 *
 * @param props - The recipe id and optional back callback.
 * @returns The loading, error, or populated detail view.
 */
export function RecipeDetailScreen({ recipeId, onBack }: RecipeDetailScreenProps): JSX.Element {
    const { recipes: t } = useMessages(mobileMessages);
    const query = useRecipe(recipeId);

    const back =
        onBack !== undefined ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t.back} onPress={onBack}>
                <Text>{t.back}</Text>
            </Pressable>
        ) : null;

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
                {back}
                <Text accessibilityRole="alert">{t.detailError}</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {back}
            <RecipeDetailView recipe={query.data} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
