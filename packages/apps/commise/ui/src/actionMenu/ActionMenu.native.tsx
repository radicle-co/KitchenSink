/**
 * @module @commise/ui/action-menu — the native `ActionMenu`, presentational: a `⋮` button that opens the design-system `Sheet` holding
 * one `menuitem` row per action (§3a: a bottom sheet cannot obscure the row it acts on).
 *
 * - The trigger is a `button` with `aria-expanded`, 48 × 48 dp; each item is a 48 dp target too.
 * - A chosen item closes the sheet and is held by its key. It runs at the Sheet's `onDismissed`, once the sheet is off
 *   screen: the host's handler for that key at that moment, or nothing if the host no longer offers it (a handler from
 *   the opening closes over a draft that may have moved on, as on web). So whatever it presents next never meets this
 *   sheet: iOS shows one Modal at a time
 *   (`docs/design/rowEditorOpenDecisions.md` item 8, `docs/design/rowEditorBlueprint.md` decision 5).
 * - The `Sheet` moves the screen-reader cursor to its title on open and leaves the return to its host. With nothing
 *   chosen, this leaf returns it to the trigger at `onDismissed`, through `useScreenReaderFocusOnSignal`, the same
 *   mechanism as `Popover.native.tsx`. With an item chosen it does not: the cursor would announce the trigger and the
 *   next sheet back to back (item 8), and the item's own surface says where the cursor goes.
 * - A host's focus request moves the cursor to the trigger through the same node handle, and is acknowledged once taken.
 *
 * @pattern Adapter over `@commise/ui/sheet`, with the trigger owned so its state cannot drift from the sheet
 * @pattern Command — the chosen item is held and executed after the sheet's dismissal
 */
import { useEffect, useEffectEvent, useState, type FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { moveScreenReaderFocus } from '../screenReaderFocus/moveScreenReaderFocus.native.js';
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
export const ActionMenu: FC<ActionMenuProps> = ({
    triggerLabel,
    title,
    closeLabel,
    items,
    focusRequested = false,
    onFocusRequestHandled,
    unavailable = false,
}) => {
    const [open, setOpen] = useState(false);
    // The items the open sheet shows: the list as it was when the sheet opened.
    const [shown, setShown] = useState(items);
    // The chosen item's key, waiting for the sheet to go.
    const [heldKey, setHeldKey] = useState<string | undefined>(undefined);
    // The dismissals with nothing chosen: each one returns the cursor to the trigger.
    const [returns, setReturns] = useState(0);
    const triggerFocus = useScreenReaderFocusOnSignal<View>(returns);
    // The acknowledgement is not a dependency: a host's new callback must not re-run a request already taken.
    const acknowledgeFocusRequest = useEffectEvent(() => onFocusRequestHandled?.());

    useEffect(() => {
        if (!focusRequested) {
            return;
        }

        moveScreenReaderFocus(triggerFocus.current);
        acknowledgeFocusRequest();
    }, [focusRequested, triggerFocus]);

    const onDismissed = (): void => {
        if (heldKey === undefined) {
            setReturns((count) => count + 1);

            return;
        }

        setHeldKey(undefined);
        items.find((item) => item.key === heldKey)?.onSelect();
    };

    return (
        <>
            <Pressable
                ref={triggerFocus}
                accessibilityRole="button"
                accessibilityLabel={triggerLabel}
                aria-expanded={open}
                // `accessibilityState.disabled` on device; a disabled Pressable keeps the screen-reader cursor.
                disabled={unavailable}
                onPress={() => {
                    if (heldKey !== undefined) {
                        return;
                    }

                    setShown(items);
                    setOpen(true);
                }}
                style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
            >
                <Text aria-hidden style={[styles.glyph, unavailable && styles.unavailable]}>
                    {'⋮'}
                </Text>
            </Pressable>
            <Sheet
                open={open}
                onOpenChange={setOpen}
                onDismissed={onDismissed}
                title={title}
                closeLabel={closeLabel}
                size="content"
            >
                <View collapsable={false} accessibilityRole="menu">
                    {shown.map((item) => (
                        <Pressable
                            key={item.key}
                            accessibilityRole="menuitem"
                            accessibilityLabel={item.label}
                            onPress={() => {
                                // A second tap while the sheet slides out is not a second choice.
                                if (heldKey !== undefined) {
                                    return;
                                }

                                setHeldKey(item.key);
                                setOpen(false);
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
    // The web leaf's `aria-disabled:opacity-60`, so unavailable reads to the eye too.
    unavailable: { opacity: 0.6 },
    item: { minHeight: TARGET_DP, justifyContent: 'center', paddingHorizontal: nativeTokens.spacing[2] },
    itemLabel: { fontSize: nativeTokens.fontSize.bodyMd },
});
