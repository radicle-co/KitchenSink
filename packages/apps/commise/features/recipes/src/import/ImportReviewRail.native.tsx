/**
 * @module @commise/features-recipes/import — `ImportReviewRail` (native): the React Native leaf of
 * `./ImportReviewRail.tsx`, drawn beside the review step at the wide container class (1194). The current recipe is
 * `selected` and filled; a skipped one says so in its own words; each row keeps the 44 pt touch floor.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { pluralOf } from '../editor/messages.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { importMessages } from './messages.js';
import type { ImportReviewRailProps } from './props.js';

/** The review's recipe rail. */
export const ImportReviewRail: FC<ImportReviewRailProps> = ({
    total,
    recipes,
    currentId,
    addedWithoutStep,
    onOpenRecipe,
}) => {
    const { rail: r } = useMessages(importMessages).wizard;
    const locale = useLocale();
    const { colors } = useTheme();

    return (
        <View collapsable={false} role="navigation" aria-label={r.label} style={styles.rail}>
            <Text style={[styles.label, { color: colors.inkMuted }]}>{pluralOf(r.title, total, locale)}</Text>
            {recipes.map((recipe) => {
                const current = recipe.id === currentId;

                return (
                    <Pressable
                        key={recipe.id}
                        role="button"
                        aria-selected={current}
                        onPress={() => onOpenRecipe(recipe.id)}
                        style={[styles.row, current ? { backgroundColor: colors.selectedFill } : null]}
                    >
                        <Text style={[current ? styles.label : styles.meta, { color: colors.ink }]}>
                            {recipe.skipped ? fillTemplate(r.skipped, { recipe: recipe.title }) : recipe.title}
                        </Text>
                    </Pressable>
                );
            })}
            {addedWithoutStep > 0 ? (
                <Text style={[styles.meta, { color: colors.inkMuted }]}>
                    {pluralOf(r.rest, addedWithoutStep, locale)}
                </Text>
            ) : null}
        </View>
    );
};

const styles = StyleSheet.create({
    rail: { gap: nativeTokens.spacing[1] },
    label: nativeTokens.type.label,
    row: {
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: nativeTokens.spacing[3],
        borderRadius: nativeTokens.radius.sm,
    },
    meta: nativeTokens.type.meta,
});
