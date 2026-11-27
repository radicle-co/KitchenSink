/**
 * @module @commise/ui/snackbar — the native {@link UndoSnackbar}: what the host draws for the snackbar on screen (spec
 * §1.11).
 *
 * `inverse` with an `inverseInk` message (12.68:1) that always wraps by words and is never clamped or cut, and its
 * action in `inverseAction` (4.56:1 on `inverse`) at a 44 pt target (48 dp on Android) that never wraps; all three from
 * `useTheme()`, so the bar inverts in either theme. The row wraps: the message asks for 8 text units of room, which
 * grow with the system text size up to the cap, so when it has no room beside the action the action drops to its own
 * row under it, at the end (the web bar's rule, owner ruling for issue 409). At most 36 rem (576 pt) wide. Native has
 * no hover and cannot see the screen-reader cursor, so `onPause`/`onResume` are not wired here: the host pauses
 * while a screen reader runs.
 *
 * @pattern Command (invoker) — its action is the `{ label, onAction }` command the queue carries; pressing it invokes
 *     that command and nothing else.
 */
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';

import { cappedFontScale } from '../text/fontScaleCap.js';
import { usePressFill } from '../surfaceTone/usePressFill.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { SnackbarAction, UndoSnackbarProps } from './props.js';
import { touchFloor } from '../layout/touchFloor.native.js';
import { Surface } from '../surfaceTone/Surface.native.js';

/**
 * The Undo action. A component of its own so it reads the press fill from INSIDE the bar's inverse surface: a hook called
 * in `UndoSnackbar` itself would read the surface the bar floats over.
 */
const UndoAction: FC<{ readonly action: SnackbarAction }> = ({ action }) => {
    const { colors } = useTheme();
    const press = usePressFill();

    return (
        <Pressable
            role="button"
            aria-label={action.label}
            onPress={action.onAction}
            style={({ pressed }) => [
                styles.action,
                { minHeight: touchFloor(), minWidth: touchFloor() },
                pressed && { backgroundColor: press },
            ]}
        >
            <Text style={[styles.actionLabel, { color: colors.inverseAction }]}>{action.label}</Text>
        </Pressable>
    );
};

/** The room the message asks for beside Undo at the default text size, in pt: 8 rem on the web bar. */
const MESSAGE_BASIS = 128;

/** The native snackbar. */
export const UndoSnackbar: FC<UndoSnackbarProps> = ({ message, action }) => {
    const { colors } = useTheme();
    const basis = MESSAGE_BASIS * cappedFontScale(useWindowDimensions().fontScale);

    return (
        <Surface tone="inverse" style={[styles.bar]}>
            <Text style={[styles.message, { flexBasis: basis, color: colors.inverseInk }]}>{message}</Text>
            {action === undefined ? null : <UndoAction action={action} />}
        </Surface>
    );
};

const styles = StyleSheet.create({
    bar: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: nativeTokens.spacing[3],
        width: '100%',
        maxWidth: 576,
        borderRadius: nativeTokens.radius.md,
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[2],
        ...nativeTokens.elevation.lg,
    },
    message: { ...nativeTokens.type.body, flexGrow: 1, flexShrink: 1, minWidth: 0 },
    action: {
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 'auto',
        paddingHorizontal: nativeTokens.spacing[2],
    },
    actionLabel: nativeTokens.type.label,
});
