/**
 * @module @commise/features-recipes/form — the native REVIEW step body (U33, owner ruling 2026-08-25).
 *
 * The RN leaf of {@link RecipeReviewFields}; see the web leaf's doc for why `Preview` was deleted rather
 * than kept beside this step, and for the pure-render contract both leaves hold.
 *
 * **The rows are not decided here.** `reviewRows` (`./props.ts`) states which rows exist, in what order, and
 * how each value is formatted — one statement, consumed by both leaves, so a field cannot appear on one
 * platform and not the other. This file is the native SPELLING of that list.
 *
 * Each row carries its LABEL as the row's `accessibilityLabel`, which is what lets a screen reader (and the
 * native test) address a row by the thing it is about rather than by position.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { styles as sectionStyles } from './formSectionStyles.native.js';
import { recipeFormMessages } from './messages.js';
import type { RecipeFormValues } from './model.js';
import { reviewIngredientLabel, reviewRows } from './props.js';

/** Props for {@link RecipeReviewFields}. */
export interface RecipeReviewFieldsProps {
    /** The draft to summarise. Read-only — this step edits nothing. */
    readonly values: RecipeFormValues;
}

/** Step 4: a read-only summary of the whole draft, and the last surface before Publish. */
export const RecipeReviewFields: FC<RecipeReviewFieldsProps> = ({ values }) => {
    const m = useMessages(recipeFormMessages);

    return (
        <View accessibilityLabel={m.reviewHeading} style={sectionStyles.card}>
            <Text accessibilityRole="header" style={sectionStyles.sectionHeading}>
                {m.reviewHeading}
            </Text>
            {reviewRows(values, m).map((row) => (
                <View key={row.label} accessibilityLabel={row.label} style={styles.row}>
                    <Text style={styles.rowLabel}>{row.label}</Text>
                    <Text accessibilityRole="text" style={styles.rowValue}>
                        {row.value}
                    </Text>
                </View>
            ))}
            {values.ingredients.length === 0 ? (
                <Text style={styles.empty}>{m.reviewNoIngredients}</Text>
            ) : (
                <View accessibilityLabel={m.reviewIngredientListLabel} style={styles.list}>
                    {values.ingredients.map((line, index) => (
                        // Index-keyed deliberately — see the web leaf's note: a draft line has no stable
                        // identity, and this list is read-only, so nothing reorders, inserts or focuses.
                        <Text key={`${line.ingredientId ?? 'unresolved'}-${index}`} style={styles.listItem}>
                            {reviewIngredientLabel(line)}
                        </Text>
                    ))}
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    rowLabel: { fontSize: 13, fontWeight: '500', color: palette.slate },
    rowValue: { flexShrink: 1, fontSize: 13, color: palette.charcoal, textAlign: 'right' },
    list: { gap: 4 },
    listItem: { fontSize: 13, color: palette.charcoal },
    empty: { fontSize: 13, color: palette.slate },
});
