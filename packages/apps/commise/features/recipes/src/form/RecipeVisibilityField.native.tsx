/**
 * @module @commise/features-recipes/form — `RecipeVisibilityField` (native): "Who can see it"
 * (`docs/design/uiOverhaul/buildSpec.md` §7.7 item 2), the React Native leaf of `./RecipeVisibilityField.tsx`, on the
 * same props and the same rule (`visibilityChoice`): a radio group of two 56 pt cards; under `upsell` Private asks for
 * the upsell instead of changing the value, and under `hidden` a private recipe's Public card says that choosing it is
 * final (plan 2026-10-14-009 D14). The host renders `RecipeVisibilityStatement` instead when Private is not offered.
 *
 * A card is named by its whole text, so the Premium badge is read with it (an `aria-label` would replace it).
 *
 * Colours come from the theme at render, so both colour schemes paint (owner D15).
 *
 * @pattern Policy — `visibilityChoice` decides what a choice does; the paid-feature state only derives the badge, the
 *     note and that decision's input, it selects no second mode of the field
 */
import { useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { StatusBadge } from '@commise/ui/status-badge';
import { useTheme } from '@commise/ui/theme';
import type { RecipeVisibility } from '@kitchensink/recipe-core';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { privateIsFinal, showsPremiumBadge } from '../actions/privateGate.js';
import { editorMessages } from '../editor/messages.js';
import { recipeFormMessages } from './messages.js';
import { visibilityChoice, type RecipeVisibilityFieldProps } from './props.js';

/** "Who can see it": Public or Private. */
export const RecipeVisibilityField: FC<RecipeVisibilityFieldProps> = ({
    values,
    onChange,
    paidFeatures,
    savedVisibility,
    onPremiumRequired,
}) => {
    const m = useMessages(recipeFormMessages);
    const { visibility: v } = useMessages(editorMessages);
    const { colors } = useTheme();

    const choose = (chosen: RecipeVisibility): void => {
        const next = visibilityChoice(values.visibility, chosen, savedVisibility, paidFeatures);

        if (next === 'premiumRequired') {
            onPremiumRequired?.();
        } else if (next !== undefined) {
            onChange({ ...values, ...next });
        }
    };

    const options: readonly {
        value: RecipeVisibility;
        title: string;
        hint: string;
        note: string | undefined;
        premium: boolean;
    }[] = [
        {
            value: 'public',
            title: v.public,
            hint: v.publicHint,
            note: privateIsFinal(paidFeatures, savedVisibility) ? v.publicIsFinal : undefined,
            premium: false,
        },
        {
            value: 'private',
            title: v.private,
            hint: v.privateHint,
            note: undefined,
            premium: showsPremiumBadge(paidFeatures, savedVisibility),
        },
    ];

    return (
        <View style={styles.field}>
            {/* The group is named by the same words; the visible legend is not read twice. */}
            <Text aria-hidden style={[styles.legend, { color: colors.inkMuted }]}>
                {v.legend}
            </Text>
            <View collapsable={false} role="radiogroup" aria-label={v.legend} style={styles.cards}>
                {options.map((option) => {
                    const chosen = values.visibility === option.value;

                    return (
                        <Pressable
                            key={option.value}
                            role="radio"
                            aria-checked={chosen}
                            onPress={() => choose(option.value)}
                            style={[
                                styles.card,
                                {
                                    backgroundColor: chosen ? colors.selectedFill : colors.paper,
                                    borderColor: chosen ? colors.selectedEdge : colors.lineControl,
                                },
                            ]}
                        >
                            <View style={styles.words}>
                                <Text style={[styles.title, { color: colors.ink }]}>{option.title}</Text>
                                <Text style={[styles.hint, { color: colors.inkMuted }]}>{option.hint}</Text>
                                {option.note === undefined ? null : (
                                    <Text style={[styles.hint, { color: colors.inkMuted }]}>{option.note}</Text>
                                )}
                            </View>
                            {option.premium ? <StatusBadge status="pro">{m.premiumBadge}</StatusBadge> : null}
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    field: { gap: nativeTokens.spacing[2] },
    legend: nativeTokens.type.label,
    cards: { gap: nativeTokens.spacing[2] },
    card: {
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[3],
        borderWidth: 1,
        borderRadius: nativeTokens.radius.md,
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[2],
    },
    words: { flex: 1, minWidth: 0 },
    title: nativeTokens.type.cardTitle,
    hint: nativeTokens.type.meta,
});
