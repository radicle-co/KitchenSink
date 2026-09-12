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
 *
 * @pattern Adapter over `@commise/ui/sheet`, with the trigger owned so its state cannot drift from the sheet
 */
import { useState, type FC } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { useScreenReaderFocusOnSignal } from '../screenReaderFocus/useScreenReaderFocusOnSignal.native.js';
import { Sheet } from '../sheet/Sheet.native.js';
import { palette } from '../tokens/colors.js';
import type { PopoverProps } from './props.js';

/** The native target floor the spec sets (§3, 2.5.8: 48 × 48 dp). */
const TARGET_DP = 48;

/** The popover: a named trigger and the sheet it opens. */
export const Popover: FC<PopoverProps> = ({ triggerLabel, triggerIcon, title, closeLabel, children, busy = false }) => {
    const [open, setOpen] = useState(false);
    const [closes, setCloses] = useState(0);
    const triggerFocus = useScreenReaderFocusOnSignal<View>(closes);

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
                style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}
            >
                <View aria-hidden style={styles.glyph}>
                    {busy ? <ActivityIndicator color={palette.charcoal} /> : triggerIcon}
                </View>
            </Pressable>
            <Sheet open={open} onOpenChange={onOpenChange} title={title} closeLabel={closeLabel} size="content">
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
    triggerPressed: { backgroundColor: palette.pearl },
    glyph: { alignItems: 'center', justifyContent: 'center' },
});
