/**
 * @module @commise/features-recipes/import — `ImportReviewRail` (native): the React Native leaf of
 * `./ImportReviewRail.tsx`, drawn beside the review step at the wide container class (1194). The current recipe is
 * `selected`, filled and ringed in the selected edge (U10); a skipped one says so in its own words; each row keeps the 44 pt touch floor.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { touchFloor } from '@commise/ui/layout';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { pluralOf } from '../format/plural.js';
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
                        style={[
                            styles.row,
                            { minHeight: touchFloor() },
                            current ? { backgroundColor: colors.selectedFill, borderColor: colors.selectedEdge } : null,
                        ]}
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
        justifyContent: 'center',
        paddingHorizontal: nativeTokens.spacing[3],
        borderRadius: nativeTokens.radius.sm,
        // The current recipe's ring (U10): the fill alone is 1.2:1, under WCAG 1.4.11's 3:1. A constant width with a
        // clear colour at rest, so marking a row never moves it.
        borderWidth: 2,
        borderColor: 'transparent',
    },
    meta: nativeTokens.type.meta,
});
