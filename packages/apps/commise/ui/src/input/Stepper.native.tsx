/**
 * @module @commise/ui/input — the native design-system {@link Stepper}: `[−] value [+]` for a small whole number.
 *
 * A named `group` holding two round buttons (44 pt on iOS, 48 dp on Android) and the value in tabular digits. A press
 * reports the stepped value and speaks the caller's `announce` sentence politely through `@commise/ui/live-region`. A
 * button at its bound is disabled and dims; a disabled `Pressable` keeps the screen-reader cursor on device.
 *
 * @pattern Controlled input — the value is the caller's; the step rule (`stepFrom`) is pure
 */
import { useState, type FC } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { visuallyHidden } from '../accessibility/visuallyHidden.native.js';
import { Icon } from '../icon/Icon.native.js';
import type { IconName } from '../icon/props.js';
import { LiveRegion } from '../liveRegion/LiveRegion.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import { stepFrom, type StepperProps } from './props.js';

/** A step button's target: 44 pt on iOS, 48 dp on Android (spec §1.6). */
const stepTarget = (): number => (Platform.OS === 'android' ? 48 : 44);

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
}) => {
    const [spoken, setSpoken] = useState({ text: '', occurrence: 0 });
    const labelId = `${id}-label`;
    const { colors, wash } = useTheme();

    const stepButton = (step: -1 | 1, name: string, glyph: IconName) => {
        const next = stepFrom(value, step, min, max);
        const target = stepTarget();

        return (
            <Pressable
                role="button"
                aria-label={name}
                disabled={next === null}
                onPress={() => {
                    if (next === null) {
                        return;
                    }

                    onChange(next);
                    setSpoken((previous) => ({ text: announce(next), occurrence: previous.occurrence + 1 }));
                }}
                style={({ pressed }) => [
                    styles.step,
                    { minWidth: target, minHeight: target, borderRadius: target / 2 },
                    { borderColor: colors.lineControl, backgroundColor: colors.paper },
                    pressed && next !== null ? { backgroundColor: wash } : null,
                    next === null ? styles.unavailable : null,
                ]}
            >
                <Icon name={glyph} size={20} />
            </Pressable>
        );
    };

    return (
        <View style={styles.stack}>
            <Text
                nativeID={labelId}
                style={labelVisibility === 'hidden' ? visuallyHidden : [styles.label, { color: colors.inkMuted }]}
            >
                {label}
            </Text>
            <View collapsable={false} role="group" aria-labelledby={labelId} style={styles.row}>
                {stepButton(-1, decreaseLabel, 'minus')}
                <Text style={[styles.value, { color: colors.ink }]}>{value}</Text>
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
    label: nativeTokens.type.label,
    row: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[3] },
    step: {
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
    },
    unavailable: { opacity: 0.4 },
    value: {
        ...nativeTokens.type.body,
        fontFamily: nativeTokens.fontFace.body.semibold,
        fontVariant: ['tabular-nums', 'lining-nums'],
        minWidth: 32,
        textAlign: 'center',
    },
});
