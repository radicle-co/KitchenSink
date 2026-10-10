'use client';

/**
 * @module @commise/features-recipes — the native ingredient row the cook checks off (build spec §6.3): the mirror of
 * `IngredientCheckRow.tsx`. The whole row is one `checkbox` at least 48 dp tall, named with the full line and hinted
 * with the statuses it carries (react-native-web joins a pressable's texts without spaces, so the name is stated).
 * Checked, the box fills with the signature motion and the text dims to `inkMuted`, with no strike-through. Colours
 * come from the theme at render.
 *
 * Presentational: props → JSX.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { CheckBoxGlyph } from '@commise/ui/check-box-glyph';
import { nativeTokens } from '@commise/ui/native';
import { StandIn } from '@commise/ui/stand-in';
import { StatusBadge } from '@commise/ui/status-badge';
import { useTheme } from '@commise/ui/theme';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import type { IngredientCheckRowProps } from './cookRowProps.js';
import { ingredientRowName, ingredientRowStatuses } from './detailFacts.js';
import { isStandInName, lineAmountName, lineDisplayName, variantPartTexts } from './lineName.js';
import { formatQuantity, isLineFoodRemoved } from './model.js';

/** The native checkable ingredient row. */
export const IngredientCheckRow: FC<IngredientCheckRowProps> = ({ ingredient, checked, allRemoved, onToggle }) => {
    const { detail, ingredientLineName, ingredientDetails } = useMessages(recipeMessages);
    const locale = useLocale();
    const { colors, wash } = useTheme();
    const amount = formatQuantity(ingredient.quantity, locale, ingredient.unit);
    const parts = variantPartTexts(ingredient.variant?.parts);
    const statuses = ingredientRowStatuses(ingredient, allRemoved, detail);
    const textColour = { color: checked ? colors.inkMuted : colors.ink };

    return (
        <Pressable
            role="checkbox"
            aria-checked={checked}
            accessibilityState={{ checked }}
            accessibilityLabel={ingredientRowName(
                ingredient,
                locale,
                ingredientLineName,
                ingredientDetails.checkLabelWithDetails,
            )}
            {...(statuses.length > 0 ? { accessibilityHint: statuses.map((status) => status.text).join(', ') } : {})}
            onPress={() => onToggle(ingredient.ingredientId)}
            style={({ pressed }) => [styles.row, pressed ? { backgroundColor: wash } : null]}
        >
            {/* The 24 pt box and the text's 24 pt first line start together, so the box is centred on that line. */}
            <CheckBoxGlyph checked={checked} />
            <View style={styles.text}>
                {isStandInName(ingredient) ? (
                    <>
                        {amount !== '' && <Text style={[styles.line, styles.amount, textColour]}>{amount}</Text>}
                        <StandIn tone={isLineFoodRemoved(ingredient) ? 'caution' : 'neutral'}>
                            {lineDisplayName(ingredient, ingredientLineName)}
                        </StandIn>
                    </>
                ) : (
                    <Text style={[styles.line, textColour]}>
                        {amount !== '' && (
                            <>
                                <Text style={styles.amount}>{amount}</Text>{' '}
                            </>
                        )}
                        <Text>
                            {lineAmountName(ingredient, ingredient.quantity, ingredient.unit, ingredientLineName)}
                        </Text>
                    </Text>
                )}
                {parts !== undefined && <VariantPartsLine parts={parts} tone="secondary" />}
                {ingredient.preparation !== undefined && ingredient.preparation.length > 0 && (
                    <Text style={[styles.detail, { color: colors.inkMuted }]}>{ingredient.preparation}</Text>
                )}
                {ingredient.notes !== undefined && ingredient.notes.length > 0 && (
                    <Text style={[styles.detail, { color: colors.inkMuted }]}>{ingredient.notes}</Text>
                )}
                {statuses.map((status) => (
                    <StatusBadge key={status.text} status={status.tone}>
                        {status.text}
                    </StatusBadge>
                ))}
            </View>
        </Pressable>
    );
};

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: nativeTokens.spacing[3],
        minHeight: 48,
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[3],
        borderRadius: nativeTokens.radius.md,
    },
    text: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: nativeTokens.spacing[1] },
    line: { ...nativeTokens.type.body },
    amount: { fontWeight: '600', fontVariant: ['tabular-nums', 'lining-nums'] },
    detail: { ...nativeTokens.type.meta },
});
