/**
 * @module @commise/features-cooking/IngredientChecklist — the NATIVE ingredient-checkoff panel (FR-032a).
 *
 * The React Native leaf of the web {@link import('./IngredientChecklist').IngredientChecklist} — same
 * contract (shared props in `./sessionExtras`), same pattern: a **pure presentational (render) component**
 * in its CONTROLLED form. `props → JSX`, one responsibility, no fetching, no mutation, no state, no ref.
 * Checked ids and the open flag arrive as props; `onToggleIngredient(id)` and `onDismiss()` leave.
 *
 * Accessibility mirrors the web leaf: every line is a real `checkbox` whose accessible name is the line's
 * "quantity unit name", and checked state rides on BOTH `accessibilityState.checked` (the trait
 * VoiceOver/TalkBack read) and `aria-checked` (the only one react-native-web projects to the DOM) PLUS a ✓
 * glyph — never colour alone (NFR-004). The tap target is a 44pt wrapper around a compact 18pt box
 * (WCAG 2.5.5), matching the shipped recipe-detail checklist.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { isChecked } from '@kitchensink/cooking-core';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cookingMessages } from './messages';
import { formatCheckoffProgress, scaleIngredientLine, type IngredientChecklistProps } from './sessionExtras';

/** The ingredient-checkoff panel shown inside Cooking Mode (FR-032a), scaled for the active yield (FR-034a). */
export const IngredientChecklist: FC<IngredientChecklistProps> = ({
    ingredients,
    checkedIngredientIds,
    scaleFactor = 1,
    isOpen,
    onToggleIngredient,
    onDismiss,
}) => {
    const cooking = useMessages(cookingMessages);
    const locale = useLocale();

    if (!isOpen) {
        return null;
    }

    const checkedCount = ingredients.filter((ingredient) =>
        isChecked(checkedIngredientIds, ingredient.ingredientId),
    ).length;
    const progress = formatCheckoffProgress(checkedCount, ingredients.length, cooking.ingredientsChecked, locale);

    return (
        <View accessibilityLabel={cooking.ingredientListLabel} style={styles.panel}>
            <View style={styles.header}>
                <Text accessibilityRole="header" style={styles.heading}>
                    {cooking.ingredientsLabel}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={cooking.closeIngredientsLabel}
                    onPress={onDismiss}
                    style={styles.closeTouch}
                >
                    <Text style={styles.closeGlyph}>✕</Text>
                </Pressable>
            </View>

            {ingredients.length === 0 ? (
                <Text style={styles.empty}>{cooking.ingredientsEmptyBody}</Text>
            ) : (
                <>
                    {/* `accessibilityLabel` carries the readout for assistive tech (and makes the count
                        queryable by name), matching the web leaf's labelled status line. */}
                    <Text accessibilityLabel={progress} style={styles.progress}>
                        {progress}
                    </Text>
                    {ingredients.map((ingredient) => {
                        const { quantityText, label } = scaleIngredientLine(ingredient, scaleFactor, locale);
                        const checked = isChecked(checkedIngredientIds, ingredient.ingredientId);

                        return (
                            <View key={ingredient.ingredientId} style={styles.row}>
                                <Pressable
                                    accessibilityRole="checkbox"
                                    // Both state forms are load-bearing, neither is redundant (#123):
                                    // `accessibilityState` is the DEVICE trait, `aria-checked` is the only
                                    // one that reaches the DOM under react-native-web.
                                    accessibilityState={{ checked }}
                                    aria-checked={checked}
                                    accessibilityLabel={label}
                                    onPress={() => onToggleIngredient(ingredient.ingredientId)}
                                    style={styles.checkboxTouch}
                                >
                                    <View style={[styles.checkbox, checked ? styles.checkboxChecked : null]}>
                                        {checked && <Text style={styles.checkMark}>✓</Text>}
                                    </View>
                                </Pressable>
                                <Text style={styles.quantity}>{quantityText}</Text>
                                <Text style={[styles.name, checked ? styles.nameChecked : null]}>
                                    {ingredient.name}
                                </Text>
                            </View>
                        );
                    })}
                </>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    panel: { gap: 12, padding: 16, borderRadius: 16, backgroundColor: palette.white },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    heading: { fontSize: 18, fontWeight: '600', color: palette.charcoal },
    // A ≥44×44 touch target (WCAG 2.5.5 / Apple + Android minimums).
    closeTouch: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    closeGlyph: { fontSize: 18, color: palette.charcoal },
    empty: { fontSize: 13, color: palette.slate },
    progress: { fontSize: 13, color: palette.slate },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    checkboxTouch: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    checkbox: {
        width: 18,
        height: 18,
        borderRadius: 4,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
        // Unchecked, the outline IS the affordance — a UI component owing 3:1 under SC 1.4.11, where `mist`
        // measures 1.90:1.
        borderColor: palette.slate,
    },
    checkboxChecked: { borderColor: palette.seafoam, backgroundColor: palette.seafoam },
    checkMark: { fontSize: 12, color: palette.white },
    quantity: { fontSize: 15, fontWeight: '500', color: palette.charcoal },
    name: { flexShrink: 1, fontSize: 15, color: palette.charcoal },
    // A second, non-colour cue that this line is done (SC 1.4.1).
    nameChecked: { textDecorationLine: 'line-through' },
});
