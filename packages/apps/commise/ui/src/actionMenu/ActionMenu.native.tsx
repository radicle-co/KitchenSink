/**
 * @module @commise/ui/action-menu — the native `ActionMenu`, presentational: a `⋮` button that opens the design-system `Sheet` holding
 * one `menuitem` row per action (§3a: a bottom sheet cannot obscure the row it acts on).
 *
 * - The trigger is a `button` with `aria-expanded`, 48 × 48 dp; each item is a 48 dp target too.
 * - Activating an item closes the sheet, then runs it. The `Sheet` moves the screen-reader cursor to its title on
 *   open and leaves the return to its host, so each close advances a counter and `useScreenReaderFocusOnSignal`
 *   moves the cursor back to the trigger — the same mechanism as `Popover.native.tsx`.
 *
 * @pattern Adapter over `@commise/ui/sheet`, with the trigger owned so its state cannot drift from the sheet
 */
import { useState, type FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useScreenReaderFocusOnSignal } from '../screenReaderFocus/useScreenReaderFocusOnSignal.native.js';
import { Sheet } from '../sheet/Sheet.native.js';
import { palette } from '../tokens/colors.js';
import { nativeTokens } from '../tokens/native.js';
import type { ActionMenuItem, ActionMenuProps } from './props.js';

/** The native target floor the spec sets (§3a, 2.5.8: 48 × 48 dp). */
const TARGET_DP = 48;

const ITEM_TONE: Readonly<Record<NonNullable<ActionMenuItem['tone']>, string>> = {
    default: palette.charcoal,
    destructive: palette['error-dark'],
};

/** The row-actions menu. */
export const ActionMenu: FC<ActionMenuProps> = ({ triggerLabel, title, closeLabel, items }) => {
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
                aria-expanded={open}
                onPress={() => {
                    onOpenChange(true);
                }}
                style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
            >
                <Text aria-hidden style={styles.glyph}>
                    {'⋮'}
                </Text>
            </Pressable>
            <Sheet open={open} onOpenChange={onOpenChange} title={title} closeLabel={closeLabel} size="content">
                <View accessibilityRole="menu">
                    {items.map((item) => (
                        <Pressable
                            key={item.key}
                            accessibilityRole="menuitem"
                            accessibilityLabel={item.label}
                            onPress={() => {
                                onOpenChange(false);
                                item.onSelect();
                            }}
                            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
                        >
                            <Text style={[styles.itemLabel, { color: ITEM_TONE[item.tone ?? 'default'] }]}>
                                {item.label}
                            </Text>
                        </Pressable>
                    ))}
                </View>
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
    pressed: { backgroundColor: palette.pearl },
    glyph: { fontSize: nativeTokens.fontSize.bodyLg, color: palette.charcoal },
    item: { minHeight: TARGET_DP, justifyContent: 'center', paddingHorizontal: nativeTokens.spacing[2] },
    itemLabel: { fontSize: nativeTokens.fontSize.bodyMd },
});
