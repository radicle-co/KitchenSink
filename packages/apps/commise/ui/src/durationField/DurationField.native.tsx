/**
 * @module @commise/ui/duration-field — the native `DurationField`: the React Native leaf of `DurationField.tsx`, with
 * the same contract (a duration stored in seconds, entered as hours and minutes in one labelled group, never showing
 * a "0"). The arithmetic is `./duration.ts`, shared with the web leaf.
 *
 * Presentational and controlled: it owns no state; the caller holds the seconds.
 *
 * @pattern Adapter — presents a value stored in seconds as an hours/minutes pair, and converts each edit back.
 */
import { useId, type FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { TextInput } from '../textInput/TextInput.native.js';
import { palette, semantic } from '../tokens/colors.js';
import { nativeTokens } from '../tokens/native.js';
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
}) => {
    const labelId = `${useId()}-label`;
    const shown = durationBoxes(value);

    return (
        // `collapsable={false}`: Android flattens a View that only lays out, which would drop its role and name.
        <View collapsable={false} role="group" aria-labelledby={labelId} style={styles.group}>
            <Text nativeID={labelId} style={styles.label}>
                {label}
            </Text>
            <View style={styles.row}>
                <TextInput
                    accessibilityLabel={hoursLabel}
                    keyboardType="number-pad"
                    inputMode="numeric"
                    value={shown.hours}
                    onChangeText={(text) => onChange(durationFromBoxes(text, shown.minutes))}
                    style={styles.box}
                />
                <Text aria-hidden style={styles.unit}>
                    {hoursUnit}
                </Text>
                <TextInput
                    accessibilityLabel={minutesLabel}
                    keyboardType="number-pad"
                    inputMode="numeric"
                    value={shown.minutes}
                    onChangeText={(text) => onChange(durationFromBoxes(shown.hours, text))}
                    style={styles.box}
                />
                <Text aria-hidden style={styles.unit}>
                    {minutesUnit}
                </Text>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    group: { gap: nativeTokens.spacing[1] },
    label: { fontSize: nativeTokens.fontSize.bodySm, fontWeight: '500', color: palette.slate },
    row: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[2] },
    // 48 dp: the Android touch floor, which also clears Apple's 44 pt.
    box: {
        minHeight: 48,
        width: 64,
        borderRadius: 10,
        borderWidth: 1,
        // The web leaf's `border-border`: the form inputs' one border colour.
        borderColor: semantic.border,
        paddingHorizontal: 12,
        fontSize: nativeTokens.fontSize.bodyMd,
        color: palette.charcoal,
    },
    unit: { fontSize: nativeTokens.fontSize.bodySm, color: palette.slate },
});
