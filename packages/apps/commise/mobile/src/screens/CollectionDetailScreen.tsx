/**
 * Collection-detail screen (mobile, T072). Loads the collection with its members via `useCollection` and
 * drives the shared native `CollectionDetail` building block, wiring per-member removal
 * (`useRemoveRecipeFromCollection`) and collection deletion (`useDeleteCollection`). Member selection and
 * rename are forwarded upward (rename carries the current name so the form can seed it); a successful delete
 * navigates back to the collections list. Renders localized loading and error states until the collection
 * resolves — the presentational block assumes a loaded collection.
 */
import { CollectionDetail, type CollectionDetailError } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import {
    useCollection,
    useDeleteCollection,
    useRemoveRecipeFromCollection,
} from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { mobileMessages } from '../i18n/messages.js';

/** Props for {@link CollectionDetailScreen}. */
export interface CollectionDetailScreenProps {
    /** The id of the collection to display. */
    readonly collectionId: string;
    /** Invoked with a recipe id when a member row is activated. */
    readonly onSelectRecipe: (recipeId: string) => void;
    /** Invoked when the add-a-recipe action is activated (opens the recipe picker). */
    readonly onAddRecipe: () => void;
    /** Invoked with the collection's current name when the rename action is activated. */
    readonly onRename: (currentName: string) => void;
    /** Invoked after the collection is successfully deleted. */
    readonly onDeleted: () => void;
    /** Invoked when the back affordance is activated. */
    readonly onBack: () => void;
}

/**
 * The collection-detail screen.
 *
 * @param props - The collection id and the navigation/deletion callbacks the navigator wires.
 * @returns The loading, error, or populated collection-detail view.
 */
export function CollectionDetailScreen({
    collectionId,
    onSelectRecipe,
    onAddRecipe,
    onRename,
    onDeleted,
    onBack,
}: CollectionDetailScreenProps): JSX.Element {
    const { collections: t } = useMessages(mobileMessages);
    const query = useCollection(collectionId);
    const removeRecipe = useRemoveRecipeFromCollection();
    const deleteCollection = useDeleteCollection();

    const back = (
        <Pressable accessibilityRole="button" accessibilityLabel={t.back} onPress={onBack}>
            <Text>{t.back}</Text>
        </Pressable>
    );

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

    const collection = query.data;

    // B17 — a failed delete/remove must never look frozen. Surface an honest code for whichever mutation
    // errored; delete takes precedence over remove (it is the more consequential, whole-collection action).
    // Each mutation resets its own error on the next attempt, so the banner clears when the viewer retries.
    const mutationError: CollectionDetailError | undefined =
        deleteCollection.error !== null && deleteCollection.error !== undefined
            ? 'delete'
            : removeRecipe.error !== null && removeRecipe.error !== undefined
              ? 'remove'
              : undefined;

    return (
        <View style={styles.container}>
            {back}
            <CollectionDetail
                collection={collection}
                error={mutationError}
                onSelectRecipe={onSelectRecipe}
                onRemoveRecipe={(recipeId) => removeRecipe.mutate({ id: collectionId, recipeId })}
                onAddRecipe={onAddRecipe}
                onRename={() => onRename(collection.name)}
                onDelete={() => deleteCollection.mutate(collectionId, { onSuccess: onDeleted })}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
