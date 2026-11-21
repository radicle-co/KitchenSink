/**
 * @module @commise/ui/radio-list — the native design-system {@link RadioList}.
 *
 * A `radiogroup` of whole-row `Pressable` radios with `aria-checked`. Each row is named by its label and hands its hint
 * to the platform as `accessibilityHint`, read after the name as the web leaf's `aria-describedby` is. Each row keeps
 * the native touch floor and is its own bordered card: an 18 dp circle (a 2 dp `lineControl` ring at rest, a 5 dp `action`
 * ring when checked), the label that wraps, then the hint under it. Label and hint draw on the design-system `Text` (roles
 * `cardTitle` and `meta`), so they honour the 2x cap and the iOS leading snap (ADR-0080 §8, react-native#58970), and the
 * circle is offset to centre on the label's first line. A pressed row takes the theme's press wash, as `ChipRow` does.
 * Colours come from the theme at render, so it repaints in the dark scheme. Nothing animates.
 *
 * Controlled with no default: `value` `undefined` checks nothing, and a press reports to `onChange` only.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { scaledTypeSize } from '../text/scaledType.js';
import { Text } from '../text/Text.native.js';
import { useTextScale } from '../text/useTextScale.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import { dimmedOpacity } from '../tokens/scale.js';
import { touchFloor } from '../layout/touchFloor.native.js';
import type { RadioListProps } from './props.js';
import { usePressFill } from '../surfaceTone/usePressFill.native.js';

/** The radio circle's size, dp (`ingredientMatching.md`: 18 px radios). */
const RADIO_SIZE = 18;

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
    // The circle stays 18 dp and sits on the label's FIRST line at every scale: half of what the label's leading has over it.
    // The leading is read from the same scaled, snapped metrics the label draws with (`Text`, role `cardTitle`).
    const textScale = useTextScale();
    const circleTop = (scaledTypeSize('cardTitle', textScale).lineHeight - RADIO_SIZE) / 2;

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
                        <View
                            aria-hidden
                            importantForAccessibility="no-hide-descendants"
                            style={[
                                styles.radio,
                                { marginTop: circleTop },
                                checked
                                    ? { borderWidth: 5, borderColor: colors.action }
                                    : { borderWidth: 2, borderColor: colors.lineControl },
                            ]}
                        />
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
        gap: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[4],
        borderWidth: 1,
        borderRadius: nativeTokens.radius.md,
    },
    radio: { width: RADIO_SIZE, height: RADIO_SIZE, borderRadius: RADIO_SIZE / 2, alignSelf: 'flex-start' },
    words: { flex: 1, minWidth: 0 },
});
