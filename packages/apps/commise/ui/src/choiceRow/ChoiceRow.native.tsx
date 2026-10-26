/**
 * @module @commise/ui/choice-row — the native design-system {@link ChoiceRow}: the React Native leaf of
 * `./ChoiceRow.tsx`, on the same props. A `button`-role `Pressable` at the native touch floor, its label then a check
 * when it is chosen, or a spinner while its send is in flight.
 *
 * Busy and refused rows are disabled — a disabled `Pressable` keeps the screen-reader cursor on device — and dimmed to
 * the Combobox's busy option's 60 % (web's `BUSY_CONTROL_CLASS`); only the busy row reads busy. The chosen row takes the
 * selected fill; a pressed row the muted surface. Colours come from the theme at render.
 *
 * Presentational: props → JSX; the focus request is the one effect, and the one reason this leaf holds a ref.
 *
 * @pattern Slot — the caller hands in the label, so a tagged food and the quiet keep row share one row
 * @pattern Adapter over the screen-reader focus API — a level-triggered focus request moves the cursor to the row
 *     (`moveScreenReaderFocus`), which has no declarative form
 */
import { useRef, type FC } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { useFocusRequest } from '../focusRequest/useFocusRequest.js';
import { Icon } from '../icon/Icon.native.js';
import { moveScreenReaderFocus } from '../screenReaderFocus/moveScreenReaderFocus.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { ChoiceRowProps } from './props.js';

/** The native choice row. */
export const ChoiceRow: FC<ChoiceRowProps> = ({
    children,
    accessibilityLabel,
    chosen,
    busy,
    refused,
    onPress,
    focusRequested = false,
    onFocusRequestHandled,
}) => {
    const { colors } = useTheme();
    const node = useRef<View>(null);
    useFocusRequest(focusRequested, () => moveScreenReaderFocus(node.current), onFocusRequestHandled);
    const inactive = busy || refused;

    return (
        <Pressable
            ref={node}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            aria-busy={busy}
            disabled={inactive}
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                chosen && { backgroundColor: colors.selectedFill },
                pressed && { backgroundColor: colors.surfaceMuted },
                inactive && styles.inactive,
            ]}
        >
            <View style={styles.label}>{children}</View>
            {busy ? <ActivityIndicator color={colors.actionText} /> : null}
            {!busy && chosen ? <Icon name="check" size={20} tone="actionText" /> : null}
        </Pressable>
    );
};

const styles = StyleSheet.create({
    row: {
        minHeight: nativeTokens.touchTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
    },
    // `minWidth: 0`: a label that cannot shrink below its longest word is how a row comes to scroll sideways.
    label: { flex: 1, minWidth: 0 },
    // The Combobox's busy option's dim (`combobox/Combobox.native.tsx`), as web's `BUSY_CONTROL_CLASS` dims to 60 %.
    inactive: { opacity: 0.6 },
});
