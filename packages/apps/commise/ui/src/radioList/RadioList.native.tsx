/**
 * @module @commise/ui/radio-list — the native design-system {@link RadioList}.
 *
 * A `radiogroup` of whole-row `Pressable` radios with `aria-checked`. Each row is named by its label and hands its hint
 * to the platform as `accessibilityHint`, read after the name as the web leaf's `aria-describedby` is. Each row keeps
 * the native touch floor and is its own bordered card: an 18 dp circle (a 2 dp `lineControl` ring at rest, a 5 dp `action` ring when checked), the
 * label that wraps, then the hint under it. A pressed row takes the theme's press wash, as `ChipRow` does. Colours come
 * from the theme at render, so it repaints in the dark scheme. Nothing animates.
 *
 * Controlled with no default: `value` `undefined` checks nothing, and a press reports to `onChange` only.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 */
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { RadioListProps } from './props.js';

/** The radio circle's size, dp (`ingredientMatching.md`: 18 px radios). */
const RADIO_SIZE = 18;

/** The native design-system option list. */
export const RadioList: FC<RadioListProps> = ({ label, options, value, onChange }) => {
    const { colors, wash } = useTheme();

    return (
        <View collapsable={false} role="radiogroup" aria-label={label} style={styles.group}>
            {options.map((option) => {
                const checked = option.id === value;

                return (
                    <Pressable
                        key={option.id}
                        role="radio"
                        aria-checked={checked}
                        accessibilityLabel={option.label}
                        accessibilityHint={option.hint}
                        onPress={() => {
                            onChange(option.id);
                        }}
                        style={({ pressed }) => [
                            styles.row,
                            { borderColor: colors.lineDivider, backgroundColor: colors.paper },
                            pressed ? { backgroundColor: wash } : null,
                        ]}
                    >
                        <View
                            aria-hidden
                            importantForAccessibility="no-hide-descendants"
                            style={[
                                styles.radio,
                                checked
                                    ? { borderWidth: 5, borderColor: colors.action }
                                    : { borderWidth: 2, borderColor: colors.lineControl },
                            ]}
                        />
                        <View style={styles.words}>
                            <Text style={[styles.label, { color: colors.ink }]}>{option.label}</Text>
                            {option.hint === undefined ? null : (
                                <Text style={[styles.hint, { color: colors.inkMuted }]}>{option.hint}</Text>
                            )}
                        </View>
                    </Pressable>
                );
            })}
        </View>
    );
};

const styles = StyleSheet.create({
    group: { gap: nativeTokens.spacing[3] },
    // Each row its own bordered card on the paper, with a bolder label.
    row: {
        minHeight: nativeTokens.touchTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[4],
        borderWidth: 1,
        borderRadius: nativeTokens.radius.md,
    },
    radio: { width: RADIO_SIZE, height: RADIO_SIZE, borderRadius: RADIO_SIZE / 2, alignSelf: 'flex-start' },
    words: { flex: 1, minWidth: 0 },
    label: nativeTokens.type.cardTitle,
    hint: nativeTokens.type.meta,
});
