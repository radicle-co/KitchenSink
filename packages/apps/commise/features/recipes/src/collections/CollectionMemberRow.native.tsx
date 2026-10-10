/**
 * @module @commise/features-recipes/collections — native collection member row (W5 Task 9, C3; slice 5 of the UI overhaul).
 *
 * The React Native twin of `CollectionMemberRow` (`docs/design/uiOverhaul/buildSpec.md` §5.2): the shared {@link RecipeCard}
 * as a list row or a grid card, its source label on the last line, and a trailing ⋯ menu named for the recipe — a sheet of
 * Open recipe and Remove from collection. The card's link covers the recipe; the menu sits beside it, so it stays its own
 * accessible element and one press cannot do both. Removing only ASKS: the screen hides the row and offers Undo.
 *
 * @pattern Adapter over the shared `RecipeCard`, filling its note, trailing and footer slots
 */
import { useMessages } from '@commise/i18n/react';
import { ActionMenu } from '@commise/ui/action-menu';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { RecipeCollectionAddedVia } from '@kitchensink/recipe-core';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { RecipeCard } from '../card/RecipeCard.js';
import { toRecipeCardModel } from '../card/model.js';
import { fillTemplate } from '../format/fillTemplate.js';
import type { CollectionMemberRowProps } from './detailModel.js';
import { collectionMessages } from './messages.js';

export const CollectionMemberRow: FC<CollectionMemberRowProps> = ({
    member,
    variant,
    onSelect,
    onRemove,
    nutrition,
}) => {
    const { detail, member: copy, menu: menuCopy } = useMessages(collectionMessages);
    const { colors } = useTheme();
    const recipe = toRecipeCardModel(member);
    const sourceLabel =
        member.addedVia === RecipeCollectionAddedVia.MANUAL
            ? detail.sourceIndicatorOwned
            : detail.sourceIndicatorFromSource;
    const menu = (
        <ActionMenu
            triggerLabel={fillTemplate(copy.moreActions, { title: member.title })}
            title={member.title}
            closeLabel={menuCopy.close}
            items={[
                { id: 'open', label: copy.open, onSelect: () => onSelect(member.id) },
                { id: 'remove', label: copy.remove, onSelect: () => onRemove({ id: member.id, title: member.title }) },
            ]}
        />
    );

    if (variant === 'row') {
        return (
            <RecipeCard
                variant="row"
                recipe={recipe}
                onSelect={onSelect}
                nutrition={nutrition}
                note={sourceLabel}
                trailing={menu}
            />
        );
    }

    return (
        <RecipeCard
            variant={variant}
            recipe={recipe}
            onSelect={onSelect}
            nutrition={nutrition}
            footer={
                <View style={styles.footer}>
                    <Text numberOfLines={1} style={[styles.caption, { color: colors.inkMuted }]}>
                        {sourceLabel}
                    </Text>
                    {menu}
                </View>
            }
        />
    );
};

const styles = StyleSheet.create({
    footer: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[2] },
    caption: { ...nativeTokens.type.caption, flex: 1, minWidth: 0 },
});
