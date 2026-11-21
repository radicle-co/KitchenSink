/**
 * @module @commise/ui/radio-list — the native design-system {@link RadioList}.
 *
 * A `radiogroup` of whole-row `Pressable` radios with `aria-checked`. Each row is named by its label and hands its hint
 * to the platform as `accessibilityHint`, read after the name as the web leaf's `aria-describedby` is. Each row keeps
 * the native touch floor and is its own bordered card: the radio circle (`RadioMark`, which owns its size and rings),
 * the label that wraps, then the hint under it. Label and hint draw on the design-system `Text` (roles `cardTitle` and
 * `meta`), so they honour the 2x cap and the iOS leading snap (ADR-0080 §8, react-native#58970). The circle sits in a
 * slot one label line tall, so it stays beside the label's first line. A pressed row takes the theme's press wash, as
 * `ChipRow` does. Colours come from the theme at render, so it repaints in the dark scheme. Nothing animates.
 *
 * Controlled with no default: `value` `undefined` checks nothing, and a press reports to `onChange` only.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../text/Text.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import { dimmedOpacity } from '../tokens/scale.js';
import { touchFloor } from '../layout/touchFloor.native.js';
import type { RadioListProps } from './props.js';
import { RadioMark, RadioRowContent } from './RadioRowContent.native.js';
import { usePressFill } from '../surfaceTone/usePressFill.native.js';

/** The native design-system option list. */
export function RadioList<Id extends string>({
    label,
    options,
    value,
    onChange,
    disabled = false,
}: RadioListProps<Id>) {
    const { colors } = useTheme();
    const wash = usePressFill();

    return (
        <View collapsable={false} role="radiogroup" aria-label={label} style={styles.group}>
            {options.map((option) => {
                const checked = option.id === value;

                return (
                    <Pressable
                        key={option.id}
                        role="radio"
                        aria-checked={checked}
                        aria-disabled={disabled}
                        disabled={disabled}
                        accessibilityLabel={option.label}
                        accessibilityHint={option.hint}
                        onPress={() => {
                            onChange(option.id);
                        }}
                        style={({ pressed }) => [
                            styles.row,
                            { minHeight: touchFloor(), borderColor: colors.lineDivider, backgroundColor: colors.paper },
                            pressed ? { backgroundColor: wash } : null,
                            // An unavailable list LOOKS it, at the one dim every unavailable native control takes.
                            disabled ? { opacity: dimmedOpacity } : null,
                        ]}
                    >
                        {/* One top-aligned group the row centres: a lone label line then keeps the circle on it. */}
                        <RadioRowContent>
                            <RadioMark checked={checked} />
                            <View style={styles.words}>
                                <Text typeRole="cardTitle" color="$ink">
                                    {option.label}
                                </Text>
                                {option.hint === undefined ? null : (
                                    <Text typeRole="meta" color="$inkMuted">
                                        {option.hint}
                                    </Text>
                                )}
                            </View>
                        </RadioRowContent>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    group: { gap: nativeTokens.spacing[3] },
    // Each row its own bordered card on the paper, with a bolder label.
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[4],
        borderWidth: 1,
        borderRadius: nativeTokens.radius.md,
    },
    words: { flex: 1, minWidth: 0 },
});
