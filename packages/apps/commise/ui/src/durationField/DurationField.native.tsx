/**
 * @module @commise/ui/duration-field — the native `DurationField`: the React Native leaf of `DurationField.tsx`, with
 * the same contract (a duration stored in seconds, entered as hours and minutes in one labelled group, never showing
 * a "0"). The arithmetic is `./duration.ts`, shared with the web leaf.
 *
 * A caller's `error` is each box's `accessibilityHint` (React Native has no `aria-describedby` or `aria-invalid`) and
 * paints the `danger` edge.
 *
 * Presentational and controlled: it owns no state; the caller holds the seconds.
 *
 * @pattern Adapter — presents a value stored in seconds as an hours/minutes pair, and converts each edit back.
 */
import type { FC } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { TextInput } from '../textInput/TextInput.native.js';
import { FIELD_EDGE, fieldGeometry, fieldPaint } from '../input/fieldStyle.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import { typeRole } from '../tokens/typography.js';
import { durationBoxMinWidth } from './boxWidth.js';
import { durationBoxes, durationFromBoxes } from './duration.js';
import type { DurationFieldProps } from './props.js';

export const DurationField: FC<DurationFieldProps> = ({
    label,
    hoursLabel,
    minutesLabel,
    hoursUnit,
    minutesUnit,
    value,
    onChange,
    error,
}) => {
    const shown = durationBoxes(value);
    const theme = useTheme();
    const { colors } = theme;
    // Two digits at the system text size (Android font scale, iOS Dynamic Type), which the box's own text follows.
    const { fontScale } = useWindowDimensions();
    const least = {
        minWidth: durationBoxMinWidth({
            fontSize: typeRole.body.size * fontScale,
            padding: BOX_PADDING,
            edge: FIELD_EDGE,
        }),
    };

    return (
        // No group name: the label Text below already says it, and each box's own name carries the field
        // (docs/design/nativeContainerNames.md N1).
        <View style={styles.group}>
            <Text style={[styles.label, { color: colors.inkMuted }]}>{label}</Text>
            <View style={styles.row}>
                <View style={styles.pair}>
                    <TextInput
                        accessibilityLabel={hoursLabel}
                        accessibilityHint={error}
                        keyboardType="number-pad"
                        inputMode="numeric"
                        value={shown.hours}
                        onChangeText={(text) => onChange(durationFromBoxes(text, shown.minutes))}
                        style={[styles.box, least, fieldPaint(theme, error !== undefined)]}
                    />
                    <Text aria-hidden style={[styles.unit, { color: colors.inkMuted }]}>
                        {hoursUnit}
                    </Text>
                </View>
                <View style={styles.pair}>
                    <TextInput
                        accessibilityLabel={minutesLabel}
                        accessibilityHint={error}
                        keyboardType="number-pad"
                        inputMode="numeric"
                        value={shown.minutes}
                        onChangeText={(text) => onChange(durationFromBoxes(shown.hours, text))}
                        style={[styles.box, least, fieldPaint(theme, error !== undefined)]}
                    />
                    <Text aria-hidden style={[styles.unit, { color: colors.inkMuted }]}>
                        {minutesUnit}
                    </Text>
                </View>
            </View>
        </View>
    );
};

/** Half the field's side padding, so two digits fit a 136 dp cell at 320 (build spec §7.4). */
const BOX_PADDING = nativeTokens.spacing[2];

const styles = StyleSheet.create({
    group: { gap: nativeTokens.spacing[1] },
    label: nativeTokens.type.label,
    // The row wraps between the two pairs at large text sizes; a box and its unit stay on one line together.
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[2] },
    pair: { flexDirection: 'row', flexGrow: 1, alignItems: 'center', gap: nativeTokens.spacing[1] },
    // The shared field geometry (the Input rules, spec §1.11), narrowed to a number's width: an equal share of its pair
    // rather than a fixed width, never below two digits (`./boxWidth.ts`).
    box: { ...fieldGeometry, flex: 1, paddingHorizontal: BOX_PADDING },
    unit: { ...nativeTokens.type.meta, flexShrink: 0 },
});
