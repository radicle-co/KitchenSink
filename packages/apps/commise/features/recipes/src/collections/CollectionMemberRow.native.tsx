/**
 * @module @commise/features-recipes/collections — native collection member row (W5 Task 9, C3).
 *
 * The React Native leaf of `CollectionMemberRow` — same composition
 * of the shared {@link RecipeCard} compound parts (title, calories, version badge past v1, visibility/draft
 * badge) plus the row-specific source-indicator and `by @handle` attribution the card does not render. Same
 * "card without onSelect + sibling Pressables" structure as the web leaf, so Remove can never also fire
 * `onSelect` (the double-fire guard) and the two platforms cannot drift.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { RecipeCollectionAddedVia } from '@kitchensink/recipe-core';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RecipeCard } from '../card/index.js';
import { toRecipeCardModel } from '../card/model.js';
import { fillTemplate } from '../list/model.js';
import { collectionMessages } from './messages.js';
import type { CollectionMemberRowProps } from './model.js';

/**
 * A single collection member row on React Native.
 *
 * @param props - The member recipe (with its `addedVia` provenance) and the select/remove callbacks.
 */
export const CollectionMemberRow: FC<CollectionMemberRowProps> = ({ member, onSelect, onRemove, nutrition }) => {
    const { detail } = useMessages(collectionMessages);
    const cardModel = toRecipeCardModel(member);
    const sourceLabel =
        member.addedVia === RecipeCollectionAddedVia.MANUAL
            ? detail.sourceIndicatorOwned
            : detail.sourceIndicatorFromSource;
    const removeLabel = fillTemplate(detail.removeRecipe, { title: member.title });

    return (
        // The slot only reaches the meta row because this CUSTOM arrangement renders `RecipeCard.Meta` below;
        // an arrangement that drops that part loses the figure silently (see `RecipeCardProps.nutrition`).
        <RecipeCard recipe={cardModel} nutrition={nutrition}>
            <View style={styles.body}>
                <View style={styles.headerRow}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={member.title}
                        onPress={() => onSelect(member.id)}
                        style={styles.titleWrap}
                    >
                        <RecipeCard.Title />
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={removeLabel}
                        onPress={() => onRemove(member.id)}
                        style={styles.removeButton}
                    >
                        <Text style={styles.removeLabel}>{removeLabel}</Text>
                    </Pressable>
                </View>
                <Text style={styles.sourceIndicator}>{sourceLabel}</Text>
                {member.authorHandle !== undefined && (
                    <Text style={styles.attribution}>
                        {fillTemplate(detail.byAuthor, { handle: member.authorHandle })}
                    </Text>
                )}
                <RecipeCard.Meta />
                <RecipeCard.Badges />
            </View>
        </RecipeCard>
    );
};

const styles = StyleSheet.create({
    body: { padding: 16, gap: 8 },
    headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
    titleWrap: { flex: 1 },
    removeButton: { flexShrink: 0, paddingVertical: 6, paddingHorizontal: 10 },
    removeLabel: { color: palette['error-dark'], fontWeight: '500', fontSize: 14 },
    sourceIndicator: { fontSize: 12, fontWeight: '600', color: palette.slate, alignSelf: 'flex-start' },
    attribution: { fontSize: 13, color: palette.slate },
});
