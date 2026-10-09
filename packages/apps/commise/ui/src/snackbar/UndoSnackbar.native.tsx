/**
 * @module @commise/ui/snackbar — the native {@link UndoSnackbar}: what the host draws for the snackbar on screen (spec
 * §1.11).
 *
 * `inverse` with an `inverseInk` message (12.68:1) of at most two lines, and its action in `inverseAction` (4.56:1 on
 * `inverse`) at a 44 pt target (48 dp on Android) that never wraps; all three from `useTheme()`, so the bar inverts in
 * either theme. At most 36 rem (576 pt) wide. Native has no hover and cannot see
 * the screen-reader cursor, so `onPause`/`onResume` are not wired here: the host pauses while a screen reader runs.
 *
 * @pattern Command (invoker) — its action is the `{ label, onAction }` command the queue carries; pressing it invokes
 *     that command and nothing else.
 */
import type { FC } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { UndoSnackbarProps } from './props.js';

/** The action's target: 44 pt on iOS, 48 dp on Android (spec §1.6). */
const actionTarget = (): number => (Platform.OS === 'android' ? 48 : 44);

/** The native snackbar. */
export const UndoSnackbar: FC<UndoSnackbarProps> = ({ message, action }) => {
    const { colors } = useTheme();

    return (
        <View style={[styles.bar, { backgroundColor: colors.inverse }]}>
            <Text numberOfLines={2} style={[styles.message, { color: colors.inverseInk }]}>
                {message}
            </Text>
            {action === undefined ? null : (
                <Pressable
                    role="button"
                    aria-label={action.label}
                    onPress={action.onAction}
                    style={[styles.action, { minHeight: actionTarget(), minWidth: actionTarget() }]}
                >
                    <Text style={[styles.actionLabel, { color: colors.inverseAction }]}>{action.label}</Text>
                </Pressable>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    bar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[3],
        width: '100%',
        maxWidth: 576,
        borderRadius: nativeTokens.radius.md,
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[2],
        ...nativeTokens.elevation.lg,
    },
    message: { ...nativeTokens.type.body, flex: 1 },
    action: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: nativeTokens.spacing[2] },
    actionLabel: nativeTokens.type.label,
});
