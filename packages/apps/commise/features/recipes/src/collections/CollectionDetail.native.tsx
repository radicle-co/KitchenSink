/**
 * @module @commise/features-recipes — native collection-detail view (T072 building block).
 *
 * The React Native leaf of {@link import('./CollectionDetail.js').CollectionDetail} — same presentational
 * contract: header (name, description, rename + delete) and member recipe rows (each selectable, each with a
 * per-row remove control), with an empty state when the collection has no members. Rendered with RN
 * primitives.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';
import { Pressable, Text, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { collectionMessages } from './messages.js';
import type { CollectionDetailViewProps } from './model.js';

export const CollectionDetail: FC<CollectionDetailViewProps> = ({
    collection,
    onSelectRecipe,
    onRemoveRecipe,
    onRename,
    onDelete,
}) => {
    const { detail } = useMessages(collectionMessages);
    const recipes = collection.recipes ?? [];

    return (
        <View accessibilityLabel={collection.name}>
            <Text accessibilityRole="header">{collection.name}</Text>
            {collection.description !== undefined && collection.description.length > 0 && (
                <Text>{collection.description}</Text>
            )}
            <Pressable accessibilityRole="button" accessibilityLabel={detail.renameCta} onPress={onRename}>
                <Text>{detail.renameCta}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={detail.deleteCta} onPress={onDelete}>
                <Text>{detail.deleteCta}</Text>
            </Pressable>

            <Text accessibilityRole="header">{detail.membersHeading}</Text>
            {recipes.length === 0 ? (
                <View>
                    <Text>{detail.emptyTitle}</Text>
                    <Text>{detail.emptyBody}</Text>
                </View>
            ) : (
                recipes.map((recipe) => {
                    const removeLabel = fillTemplate(detail.removeRecipe, { title: recipe.title });

                    return (
                        <View key={recipe.id}>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={recipe.title}
                                onPress={() => onSelectRecipe(recipe.id)}
                            >
                                <Text>{recipe.title}</Text>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={removeLabel}
                                onPress={() => onRemoveRecipe(recipe.id)}
                            >
                                <Text>{removeLabel}</Text>
                            </Pressable>
                        </View>
                    );
                })
            )}
        </View>
    );
};
