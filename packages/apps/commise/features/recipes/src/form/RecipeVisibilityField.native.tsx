/**
 * @module @commise/features-recipes/form — `RecipeVisibilityField` (native): "Who can see it"
 * (`docs/design/uiOverhaul/buildSpec.md` §7.7 item 2), the React Native leaf of `./RecipeVisibilityField.tsx`, on the
 * same props and the same rule (`visibilityChoice`): a radio group of two 56 pt cards; under `upsell` Private asks for
 * the upsell instead of changing the value, and for a downgraded owner Public on a private recipe asks to confirm
 * (`onConfirmPublic`), its card saying beforehand what it costs (`visibilityFieldOf`; plan 2026-10-14-009 D14, Q5).
 *
 * Colours come from the theme at render, so both colour schemes paint (owner D15).
 *
 * @pattern Policy — `visibilityChoice` decides what a choice does; the paid-feature state only derives the badge, the
 *     note and that decision's input, it selects no second mode of the field
 */
import { useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { touchFloor } from '@commise/ui/layout';
import type { RecipeVisibility } from '@kitchensink/recipe-core';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { heldVisibility } from '../actions/privateGate.js';
import { editorMessages } from '../editor/messages.js';
import { visibilityChoice, visibilityFieldOf, type RecipeVisibilityFieldProps } from './props.js';

/** "Who can see it": Public or Private. */
export const RecipeVisibilityField: FC<RecipeVisibilityFieldProps> = ({
    values,
    onChange,
    facts,
    heldVisibility: held,
    privateRefusal,
    onPremiumRequired,
    onConfirmPublic,
    onFreeASlot,
}) => {
    const { visibility: v } = useMessages(editorMessages);
    const { colors } = useTheme();
    // Idempotent over a host that already passes the held value: the field enforces the rule rather than trusting it.
    const savedVisibility = heldVisibility(held, values.visibility);
    const { shown, options, slotsFull } = visibilityFieldOf({
        draft: values.visibility,
        saved: savedVisibility,
        facts,
        refusal: privateRefusal,
        messages: v,
    });

    const choose = (chosen: RecipeVisibility): void => {
        const next = visibilityChoice(shown, chosen, savedVisibility, facts);

        if (next === 'confirmPublic') {
            onConfirmPublic();
        } else if (next !== undefined) {
            onChange({ ...values, ...next });
        }
    };

    return (
        <View style={styles.field}>
            {/* The group is named by the same words; the visible legend is not read twice. */}
            <Text aria-hidden style={[styles.legend, { color: colors.inkMuted }]}>
                {v.legend}
            </Text>
            <View collapsable={false} role="radiogroup" aria-label={v.legend} style={styles.cards}>
                {options.map((option) => {
                    const chosen = shown === option.value;

                    return (
                        <Pressable
                            key={option.value}
                            role="radio"
                            aria-checked={chosen}
                            // Refused, NOT disabled: the `disabled` prop would take the card out of the focus order and the reason
                            // with it. A screen reader lands on it, hears it dimmed, and reads the reason as its hint; the
                            // press is a no-op (`visibilityChoice`). The label is the title alone so the reason (also drawn
                            // as text) is not read twice.
                            accessibilityState={option.refused ? { disabled: true } : undefined}
                            aria-disabled={option.refused ? true : undefined}
                            accessibilityLabel={option.refused ? option.title : undefined}
                            accessibilityHint={option.refused ? option.note : undefined}
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
                        </Pressable>
                    );
                })}
            </View>
            {slotsFull === undefined ? null : (
                // ADR-0073: the refusal's ways forward. Premium is among them only where paid features are shown.
                <View style={styles.ways}>
                    <Text accessibilityRole="header" style={[styles.legend, { color: colors.ink }]}>
                        {slotsFull.title}
                    </Text>
                    {slotsFull.overLimit === undefined ? null : (
                        <View style={styles.overLimit}>
                            <Text style={[styles.hint, { color: colors.inkMuted }]}>{slotsFull.overLimit.text}</Text>
                            {slotsFull.overLimit.premiumLink === undefined ? null : (
                                <Pressable role="button" onPress={onPremiumRequired} style={styles.link}>
                                    <Text style={[styles.linkText, { color: colors.action }]}>
                                        {slotsFull.overLimit.premiumLink}
                                    </Text>
                                </Pressable>
                            )}
                        </View>
                    )}
                    {slotsFull.ways.map((way) => (
                        <Pressable
                            key={way.id}
                            role="button"
                            onPress={way.id === 'premium' ? onPremiumRequired : onFreeASlot}
                            style={[styles.card, { backgroundColor: colors.paper, borderColor: colors.lineControl }]}
                        >
                            <View style={styles.words}>
                                <Text style={[styles.title, { color: colors.ink }]}>{way.label}</Text>
                                <Text style={[styles.hint, { color: colors.inkMuted }]}>{way.detail}</Text>
                            </View>
                        </Pressable>
                    ))}
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    field: { gap: nativeTokens.spacing[2] },
    legend: nativeTokens.type.label,
    cards: { gap: nativeTokens.spacing[2] },
    overLimit: { gap: nativeTokens.spacing[1], alignItems: 'flex-start' },
    link: { minHeight: touchFloor(), justifyContent: 'center' },
    linkText: { ...nativeTokens.type.label, textDecorationLine: 'underline' },
    ways: { gap: nativeTokens.spacing[2], marginTop: nativeTokens.spacing[1] },
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
