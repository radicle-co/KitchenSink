/**
 * @module @commise/ui/popover — the native `Popover`: a trigger that opens the design-system `Sheet`. A presentational
 * design-system primitive: it holds only its own open state, and its content and actions come from the caller.
 *
 * A phone has no room to anchor a panel beside a row, so the job is kept and the mechanism moves to a bottom sheet
 * (`ingredientStatusExplanation.md` §8e "moved"). Opened by a tap, never a long-press or hover (plan 002 R32).
 *
 * - The trigger is a `button` with `aria-expanded` (RN's alias for `accessibilityState.expanded`), 48 × 48 dp (spec §3, 2.5.8); its glyph is hidden
 *   from assistive tech, so `triggerLabel` alone names it.
 * - The `Sheet` moves the screen-reader cursor to its title when it shows, and leaves the return to its host because
 *   React Native cannot read where the cursor was. This leaf is that host: each close advances a counter, and
 *   `useScreenReaderFocusOnSignal` moves the cursor back to the trigger.
 * - A host's focus request (`focusRequested`) moves the screen-reader cursor to the trigger through the same node
 *   handle, and is acknowledged once taken.
 *
 * @pattern Adapter over `@commise/ui/sheet`, with the trigger owned so its state cannot drift from the sheet
 */
import { useState, type FC } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { moveScreenReaderFocus } from '../screenReaderFocus/moveScreenReaderFocus.native.js';
import { useScreenReaderFocusOnSignal } from '../screenReaderFocus/useScreenReaderFocusOnSignal.native.js';
import { Sheet } from '../sheet/Sheet.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { Icon } from '../icon/Icon.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { PopoverProps } from './props.js';
import { useFocusRequest } from '../focusRequest/useFocusRequest.js';

/** The native target floor the spec sets (§3, 2.5.8: 48 × 48 dp). */
const TARGET_DP = 48;

/** The popover: a named trigger and the sheet it opens. */
export const Popover: FC<PopoverProps> = ({
    triggerLabel,
    triggerIcon,
    triggerText,
    title,
    closeLabel,
    children,
    busy = false,
    focusRequested = false,
    onFocusRequestHandled,
    onDismissed,
}) => {
    const { colors, wash } = useTheme();
    const [open, setOpen] = useState(false);
    const [closes, setCloses] = useState(0);
    const triggerFocus = useScreenReaderFocusOnSignal<View>(closes);
    useFocusRequest(focusRequested, () => moveScreenReaderFocus(triggerFocus.current), onFocusRequestHandled);

    const onOpenChange = (next: boolean): void => {
        setOpen(next);

        if (!next) {
            setCloses((count) => count + 1);
        }
    };

    return (
        <>
            <Pressable
                ref={triggerFocus}
                accessibilityRole="button"
                accessibilityLabel={triggerLabel}
                // React Native's own alias for `accessibilityState.expanded`; react-native-web also renders it.
                aria-expanded={open}
                aria-busy={busy}
                onPress={() => {
                    onOpenChange(true);
                }}
                style={({ pressed }) => [
                    triggerText === undefined ? styles.trigger : styles.textTrigger,
                    pressed && { backgroundColor: wash },
                ]}
            >
                <View aria-hidden style={styles.glyph}>
                    {busy ? (
                        <ActivityIndicator color={colors.ink} />
                    ) : (
                        <Icon
                            name={triggerIcon}
                            size={triggerText === undefined ? 20 : 16}
                            tone={triggerText === undefined ? 'ink' : 'attention'}
                        />
                    )}
                </View>
                {triggerText !== undefined && (
                    <Text style={[styles.triggerText, { color: colors.attention }]}>{triggerText}</Text>
                )}
            </Pressable>
            <Sheet
                open={open}
                onOpenChange={onOpenChange}
                onDismissed={onDismissed}
                title={title}
                closeLabel={closeLabel}
                size="content"
            >
                {typeof children === 'function'
                    ? children(() => {
                          onOpenChange(false);
                      })
                    : children}
            </Sheet>
        </>
    );
};

const styles = StyleSheet.create({
    trigger: {
        minWidth: TARGET_DP,
        minHeight: TARGET_DP,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: TARGET_DP / 2,
    },
    // The attention line: the full 48 dp target, its words beside the glyph (build spec §7.5.1).
    textTrigger: {
        minHeight: TARGET_DP,
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: nativeTokens.spacing[1],
        borderRadius: nativeTokens.radius.sm,
    },
    // The caption role's face already carries its medium weight.
    triggerText: { ...nativeTokens.type.caption },
    glyph: { alignItems: 'center', justifyContent: 'center' },
});
