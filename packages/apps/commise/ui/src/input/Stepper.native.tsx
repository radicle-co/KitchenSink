/**
 * @module @commise/ui/input — the native design-system {@link Stepper}: `[−] value [+]` for a small whole number.
 *
 * A named `group` (its `label` repeated as the `accessibilityLabel` iOS reads, since `aria-labelledby` is Android-only)
 * holding two round buttons (44 pt on iOS, 48 dp on Android) and the value in tabular digits. A press
 * reports the stepped value and speaks the caller's `announce` sentence politely through `@commise/ui/live-region`. A
 * caller's `error` is the accessibility hint of both buttons (React Native has no `aria-describedby`). A
 * button at its bound is disabled and dims; a disabled `Pressable` keeps the screen-reader cursor on device.
 *
 * @pattern Controlled input — the value is the caller's; the step rule (`stepFrom`) is pure
 */
import { useState, type FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { visuallyHidden } from '../accessibility/visuallyHidden.native.js';
import type { IconName } from '../icon/props.js';
import { LiveRegion } from '../liveRegion/LiveRegion.native.js';
import { Text } from '../text/Text.native.js';
import { nativeTokens } from '../tokens/native.js';
import { stepFrom, type StepperProps } from './props.js';
import { StepperButton } from './StepperButton.native.js';

/** The native design-system stepper. */
export const Stepper: FC<StepperProps> = ({
    id,
    label,
    labelVisibility = 'visible',
    value,
    min = 1,
    max,
    onChange,
    announce,
    decreaseLabel,
    increaseLabel,
    error,
}) => {
    const [spoken, setSpoken] = useState({ text: '', occurrence: 0 });
    const labelId = `${id}-label`;

    const stepButton = (step: -1 | 1, name: string, glyph: IconName) => {
        const next = stepFrom(value, step, min, max);

        return (
            <StepperButton
                icon={glyph}
                accessibilityLabel={name}
                {...(error === undefined ? {} : { description: error })}
                disabled={next === null}
                onPress={() => {
                    if (next === null) {
                        return;
                    }

                    onChange(next);
                    setSpoken((previous) => ({ text: announce(next), occurrence: previous.occurrence + 1 }));
                }}
            />
        );
    };

    return (
        <View style={styles.stack}>
            <Text
                typeRole="label"
                nativeID={labelId}
                color="$inkMuted"
                style={labelVisibility === 'hidden' ? visuallyHidden : undefined}
            >
                {label}
            </Text>
            <View
                collapsable={false}
                role="group"
                aria-labelledby={labelId}
                accessibilityLabel={label}
                style={styles.row}
            >
                {stepButton(-1, decreaseLabel, 'minus')}
                <Text typeRole="body" minWidth={nativeTokens.spacing[5]} textAlign="center">
                    <Text typeRole="figureInline">{value}</Text>
                </Text>
                {stepButton(1, increaseLabel, 'plus')}
            </View>
            <LiveRegion politeness="polite" visuallyHidden occurrence={spoken.occurrence}>
                {spoken.text}
            </LiveRegion>
        </View>
    );
};

const styles = StyleSheet.create({
    stack: { gap: nativeTokens.spacing[1] },
    row: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[2] },
});
