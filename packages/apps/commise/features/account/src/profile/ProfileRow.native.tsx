/**
 * @module @commise/features-account/profile/ProfileRow — a pressable Profile row (native): 56 pt, the label, its value
 * truncated to one line, an optional hint, and a chevron when it opens something (`buildSpec.md` §9.1).
 *
 * One control: the whole row is the button, its hint inside it. The danger tone changes the TEXT colour only, and sign
 * out is `ink`. Busy disables the row and exposes `busy` to a screen reader. Colour comes from the theme at render.
 * The web `href` is ignored: native has no URL for a row.
 *
 * Presentational: props → JSX, apart from one accessibility-focus adapter.
 *
 * @pattern Adapter over React Native's accessibility focus API — the row takes the reading cursor back when the host's
 *     `focusSignal` advances (`useScreenReaderFocusOnSignal`), because React Native cannot read where the cursor was
 */
import { Icon } from '@commise/ui/icon';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { useTheme } from '@commise/ui/theme';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ProfileRowProps } from './props.js';

/** The pressable row. */
export const ProfileRow: FC<ProfileRowProps> = ({
    label,
    value,
    hint,
    tone,
    chevron,
    busy = false,
    onPress,
    focusSignal = 0,
}) => {
    const { colors, wash } = useTheme();
    const row = useScreenReaderFocusOnSignal<View>(focusSignal);
    const labelColor = tone === 'danger' ? colors.dangerText : colors.ink;

    return (
        <Pressable
            ref={row}
            role="button"
            // Named by the label alone; the value and the hint are what a screen reader adds after the name.
            aria-label={label}
            accessibilityHint={[value, hint].filter((part) => part !== undefined).join('. ') || undefined}
            accessibilityState={{ busy }}
            aria-busy={busy}
            disabled={busy}
            onPress={onPress}
            style={({ pressed }) => [styles.row, pressed ? { backgroundColor: wash } : null]}
        >
            <View style={styles.text}>
                <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
                {hint === undefined ? null : <Text style={[styles.hint, { color: colors.inkMuted }]}>{hint}</Text>}
            </View>
            {value === undefined ? null : (
                <Text numberOfLines={1} style={[styles.value, { color: colors.inkMuted }]}>
                    {value}
                </Text>
            )}
            {chevron ? <Icon name="chevronRight" size={20} tone="inkMuted" /> : null}
        </Pressable>
    );
};

const styles = StyleSheet.create({
    row: {
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[2],
    },
    text: { flex: 1, minWidth: 0 },
    label: { ...nativeTokens.type.body },
    hint: { ...nativeTokens.type.caption },
    value: { ...nativeTokens.type.body, flexShrink: 1, maxWidth: '50%' },
});
