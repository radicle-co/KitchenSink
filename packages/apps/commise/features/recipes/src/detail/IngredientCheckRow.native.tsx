'use client';

/**
 * @module @commise/features-recipes — the native ingredient row the cook checks off (build spec §6.3): the mirror of
 * `IngredientCheckRow.tsx`. The whole row is one `checkbox` at least the touch floor tall (44 pt, 48 dp on Android), named with the full line and hinted
 * with the statuses it carries (react-native-web joins a pressable's texts without spaces, so the name is stated).
 * Checked, the box fills with the signature motion and the text dims to `inkMuted`, with no strike-through. Colours
 * come from the theme at render.
 *
 * Presentational: props → JSX.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { CheckBoxGlyph } from '@commise/ui/check-box-glyph';
import { touchFloor } from '@commise/ui/layout';
import { nativeTokens } from '@commise/ui/native';
import { StandIn } from '@commise/ui/stand-in';
import { StatusBadge } from '@commise/ui/status-badge';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import type { FC } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@commise/ui/text';

import { recipeMessages } from '../messages.js';
import { IngredientCheckBoxSlot, IngredientRowDivider } from './ingredientFrames.native.js';
import type { IngredientCheckRowProps } from './cookRowProps.js';
import { ingredientRowName, ingredientRowStatuses } from './detailFacts.js';
import { isStandInName, lineAmountName, lineDisplayName, variantPartTexts } from './lineName.js';
import { formatAmount, isLineFoodRemoved } from './model.js';
import { usePressFill } from '@commise/ui/surface-tone';

/** The native checkable ingredient row. */
export const IngredientCheckRow: FC<IngredientCheckRowProps> = ({
    ingredient,
    checked,
    allRemoved,
    onToggle,
    divided = false,
}) => {
    const { detail, ingredientLineName, ingredientDetails, amountWords } = useMessages(recipeMessages);
    const locale = useLocale();
    const wash = usePressFill();
    const amount = formatAmount(ingredient.quantity, locale, ingredient.unit);
    const parts = variantPartTexts(ingredient.variant?.parts);
    const statuses = ingredientRowStatuses(ingredient, allRemoved, detail);
    // The preparation, then the notes override: the board's muted note after the name.
    const notes = [ingredient.preparation, ingredient.notes].filter(
        (note): note is string => note !== undefined && note.length > 0,
    );

    return (
        <>
            {divided && <IngredientRowDivider />}
            <Pressable
                role="checkbox"
                aria-checked={checked}
                accessibilityState={{ checked }}
                accessibilityLabel={ingredientRowName(
                    ingredient,
                    locale,
                    ingredientLineName,
                    ingredientDetails.checkLabelWithDetails,
                    amountWords,
                )}
                {...(statuses.length > 0
                    ? { accessibilityHint: statuses.map((status) => status.text).join(', ') }
                    : {})}
                onPress={() => onToggle(ingredient.ingredientId)}
                // The floor is read at render: 44 pt on iOS, 48 dp on Android (`touchFloor()`, the Button's own source).
                style={({ pressed }) => [
                    styles.row,
                    { minHeight: touchFloor() },
                    pressed ? { backgroundColor: wash } : null,
                ]}
            >
                <IngredientCheckBoxSlot>
                    <CheckBoxGlyph checked={checked} />
                </IngredientCheckBoxSlot>
                <View style={styles.text}>
                    {isStandInName(ingredient) ? (
                        <>
                            {amount !== '' && (
                                <Text typeRole="figureInline" color={checked ? '$inkMuted' : '$ink'}>
                                    {amount}
                                </Text>
                            )}
                            <StandIn tone={isLineFoodRemoved(ingredient) ? 'caution' : 'neutral'}>
                                {lineDisplayName(ingredient, ingredientLineName)}
                            </StandIn>
                            {parts !== undefined && <VariantPartsLine parts={parts} tone="secondary" />}
                            {notes.map((note) => (
                                <Text key={note} typeRole="body" color="$inkMuted">
                                    {note}
                                </Text>
                            ))}
                        </>
                    ) : (
                        <>
                            {/* Amount, name and notes are ONE flow of text, as the board draws them: the amount stressed, the
                            notes muted. Each span names its own colour, so a checked line dims all of it. A variant's
                            dotted line, when there is one, sits BEFORE the notes (§S5), so the notes then take a line of
                            their own under it. */}
                            <Text typeRole="body" color={checked ? '$inkMuted' : '$ink'}>
                                {amount !== '' && (
                                    <>
                                        <Text typeRole="figureInline" color={checked ? '$inkMuted' : '$ink'}>
                                            {amount}
                                        </Text>{' '}
                                    </>
                                )}
                                <Text typeRole="body" color={checked ? '$inkMuted' : '$ink'}>
                                    {lineAmountName(
                                        ingredient,
                                        ingredient.quantity,
                                        ingredient.unit,
                                        ingredientLineName,
                                    )}
                                </Text>
                                {parts === undefined &&
                                    notes.map((note) => (
                                        <Text key={note} typeRole="body" color="$inkMuted">
                                            {' '}
                                            {note}
                                        </Text>
                                    ))}
                            </Text>
                            {parts !== undefined && <VariantPartsLine parts={parts} tone="secondary" />}
                            {parts !== undefined && notes.length > 0 && (
                                <Text typeRole="body" color="$inkMuted">
                                    {notes.map((note, index) => (
                                        <Text key={note} typeRole="body" color="$inkMuted">
                                            {index > 0 ? ' ' : ''}
                                            {note}
                                        </Text>
                                    ))}
                                </Text>
                            )}
                        </>
                    )}
                    {statuses.map((status) => (
                        <StatusBadge key={status.text} status={status.tone}>
                            {status.text}
                        </StatusBadge>
                    ))}
                </View>
            </Pressable>
        </>
    );
};

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[2],
        borderRadius: nativeTokens.radius.md,
    },
    text: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: nativeTokens.spacing[1] },
});
