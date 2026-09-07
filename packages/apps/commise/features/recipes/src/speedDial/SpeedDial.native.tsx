/**
 * @module @commise/features-recipes — the native SpeedDial FAB (U34, owner ruling 2026-08-25).
 *
 * The React Native leaf of `SpeedDial`: the same pinned create control, which now DISCLOSES the creation
 * destinations instead of running the only one. Exactly one is wired today; Scan / Import / AI belong to
 * features 004 and 005 and are **not rendered at all** — not disabled, not "coming soon".
 *
 * PATTERN — Menu Button (disclosure) implemented as an **Adapter** over the React Native `Modal`, the web
 * leaf's counterpart to its `@radix-ui/react-dialog` adapter. The two exist for the same reason: the
 * containment a menu owes its user is owned by platform machinery, not hand-rolled here.
 *
 * Three platform differences are deliberate, not drift:
 *
 *  - **The focus trap is the modal WINDOW.** iOS presents a separate window and Android a Dialog, so
 *    VoiceOver/TalkBack are already scoped to it; `aria-modal` (React Native's own first-class alias for
 *    `accessibilityViewIsModal`) states it, and is also the ONE form react-native-web surfaces in the DOM,
 *    so it is both device-correct and assertable. The sibling `MoreActionsMenu.native` renders an INLINE
 *    panel and deliberately gets none of this — that is why this leaf is not modelled on it.
 *  - **The backdrop is a real, labelled control.** A tap on it dismisses, so it is announced as one. Its web
 *    counterpart cannot be: everything outside the dialog content is `aria-hidden` while the dial is open,
 *    so on that platform the scrim is decorative and dismissal is owned by the dismissable layer.
 *  - **Motion-free by construction**, so no reduce-motion gate is needed here (the same reasoning the recipe
 *    list's loading skeletons carry). The web leaf animates because CSS makes the `motion-safe:` gate
 *    declarative and free; React Native would need an async preference read to suppress a gesture worth two
 *    frames on a one-item dial.
 *
 * ⚠️ The FAB and the menu are laid out in DIFFERENT coordinate spaces, and the two offsets are reconciled
 * deliberately. The FAB is an absolute child of the recipe list, which sits inside a screen already padded by
 * the device's bottom inset; the menu escapes into a modal WINDOW, which spans the whole display and inherits
 * none of that. So the menu re-adds `insets.bottom` and then composes the FAB's own offsets from the SAME
 * exported constants, which is what stops the pair drifting when one of them is tuned.
 *
 * ⚠️ **Unverified on a device, and stated rather than assumed:** the horizontal reconciliation assumes CSS /
 * Yoga-3 semantics, under which an absolutely positioned child is offset from its parent's PADDING BOX — so
 * the FAB's `right` is measured from the screen edge and NOT from inside the list's own horizontal padding.
 * React Native 0.86's Yoga and react-native-web both behave that way, which is why the menu uses the same
 * `right` value verbatim. If a device shows the menu overhanging the FAB by exactly the list's gutter, that
 * assumption is what is wrong — add the gutter here rather than nudging either value by eye.
 *
 * @pattern Menu Button (disclosure) as an Adapter over the React Native `Modal`, mirroring the web leaf's contract
 *     with the platform primitive.
 */
import { palette, tint } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { Feather } from '@expo/vector-icons';
import { useState, type FC } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { SpeedDialNativeProps } from './model.js';

/** The FAB's diameter in dp — also the vertical distance the menu must clear to sit above it. */
export const FAB_SIZE = 56;

/** The FAB's offset from the bottom of its (already inset-padded) screen, in dp. */
export const FAB_BOTTOM = nativeTokens.spacing[5];

/** The gap between the top of the FAB and the foot of the open menu, in dp. */
export const MENU_GAP = nativeTokens.spacing[3];

export const SpeedDial: FC<SpeedDialNativeProps> = ({ triggerLabel, menuLabel, dismissLabel, actions }) => {
    const [open, setOpen] = useState(false);
    const insets = useSafeAreaInsets();

    return (
        <>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={triggerLabel}
                // Both state forms, and neither is redundant: `accessibilityState` is the DEVICE channel,
                // while `aria-expanded` is the alias react-native-web actually projects into the DOM — the
                // object form alone left the disclosure state unannounced on the web build and unassertable
                // everywhere.
                accessibilityState={{ expanded: open }}
                aria-expanded={open}
                onPress={() => setOpen((previous) => !previous)}
                style={styles.fab}
            >
                {/* An icon, not a "+" character: flex centres the line box but ink is placed by the baseline,
                    so the glyph paints low — and the off-token leading that used to accompany it compounded
                    the offset on both platforms. */}
                <Feather name="plus" size={24} color={palette.white} />
            </Pressable>
            {open && (
                // Gating the whole `Modal` on `open` — not just its `visible` prop: react-native-web keeps a
                // Modal's portal content mounted across a `visible` toggle, so a closed menu would stay
                // findable, and tappable, in the tree.
                <Modal visible transparent animationType="none" onRequestClose={() => setOpen(false)}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={dismissLabel}
                        onPress={() => setOpen(false)}
                        style={styles.backdrop}
                    />
                    <View
                        accessibilityRole="menu"
                        accessibilityLabel={menuLabel}
                        aria-modal
                        style={[styles.menu, { bottom: insets.bottom + FAB_BOTTOM + FAB_SIZE + MENU_GAP }]}
                    >
                        {actions.map((action) => (
                            <Pressable
                                key={action.id}
                                accessibilityRole="menuitem"
                                accessibilityLabel={action.label}
                                onPress={() => {
                                    setOpen(false);
                                    action.onSelect();
                                }}
                                style={styles.item}
                            >
                                <Text style={styles.itemLabel}>{action.label}</Text>
                            </Pressable>
                        ))}
                    </View>
                </Modal>
            )}
        </>
    );
};

const styles = StyleSheet.create({
    fab: {
        position: 'absolute',
        right: nativeTokens.spacing[4],
        bottom: FAB_BOTTOM,
        width: FAB_SIZE,
        height: FAB_SIZE,
        borderRadius: nativeTokens.radius.full,
        backgroundColor: palette.seafoam,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: palette.charcoal,
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 4,
    },
    // `tint(...)`, never a decimal `rgba(...)` literal: React Native has no alpha-suffix colour syntax, and a
    // hand-written literal is a second representation of a palette colour that stops moving when the token does.
    backdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: tint(palette.charcoal, 0.2),
    },
    menu: {
        position: 'absolute',
        right: nativeTokens.spacing[4],
        minWidth: 192,
        gap: nativeTokens.spacing[1],
        borderRadius: nativeTokens.radius.lg,
        borderWidth: 1,
        borderColor: nativeTokens.borderSubtle,
        backgroundColor: palette.white,
        padding: nativeTokens.spacing[2],
    },
    // The 44pt touch floor every tappable row in this package carries.
    item: {
        minHeight: 44,
        justifyContent: 'center',
        borderRadius: nativeTokens.radius.md,
        paddingHorizontal: nativeTokens.spacing[4],
        paddingVertical: nativeTokens.spacing[2],
    },
    itemLabel: { color: palette.charcoal, fontWeight: '500', fontSize: nativeTokens.fontSize.bodySm },
});
