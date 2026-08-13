/**
 * @module @commise/features-recipes — native "More" overflow menu (C4 wireframe parity).
 *
 * The React Native leaf of `MoreActionsMenu` — same controlled-by-
 * nothing, self-contained disclosure contract: a `[More]` trigger that reveals its `children` (the secondary
 * owner actions — version history, delete, visibility) in an inline panel below it, mirroring the wireframe's
 * `[Edit] [More]` header pattern. There is no on-device analog to a pointer "outside click", so dismissal here
 * is simply re-pressing the trigger (the web leaf additionally supports Escape + outside-click, both web-only
 * affordances). Open/close is local, ephemeral UI state owned by this headless menu primitive — not business
 * logic — so it stays here rather than in the composing screen.
 */
import { useMessages } from '@commise/i18n/react';
import { palette, semantic } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { useState, type FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeActionMessages } from './messages.js';
import type { MoreActionsMenuProps } from './model.js';

export const MoreActionsMenu: FC<MoreActionsMenuProps> = ({ children }) => {
    const { moreMenu } = useMessages(recipeActionMessages);
    const [open, setOpen] = useState(false);

    return (
        <View style={styles.wrap}>
            {/*
             * NOT the design-system `Button`, deliberately. This is a DISCLOSURE trigger: it must publish
             * `accessibilityState.expanded` so a screen reader announces "collapsed"/"expanded" and a user knows
             * the press revealed something. `ButtonProps` models `disabled` and `busy` but not `expanded`, and
             * `PressScale` (which owns the DS Button's `Pressable`) forwards only those two — so routing this
             * control through `Button` would silently DROP the state that makes a disclosure comprehensible.
             *
             * Widening the DS Button with an `expanded` flag was considered and rejected: expansion belongs to
             * the disclosure pattern, not to a generic action button, so the right DS answer is a dedicated
             * disclosure primitive (a real, but separate, design-system task) rather than a flag on `Button`.
             *
             * What the Button WOULD have supplied is supplied here instead — the DS secondary surface, the
             * shared radius/spacing scale, and the 44pt touch floor — and it is pinned by tests, so "kept the
             * Pressable for a good reason" cannot decay into "kept an off-palette, under-sized control".
             */}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={moreMenu.trigger}
                // `aria-expanded` is React Native's own first-class ALIAS for `accessibilityState.expanded`
                // (declared in `ViewAccessibility.d.ts`), so device semantics are identical to the object form
                // this previously used — but react-native-web surfaces the alias in the DOM while it does NOT
                // map `accessibilityState.expanded`. The object form was therefore UNASSERTABLE, and nothing
                // guaranteed the disclosure state at all; this form is both device-correct and pinned by a test.
                aria-expanded={open}
                onPress={() => setOpen((prev) => !prev)}
                style={styles.trigger}
            >
                <Text style={styles.triggerLabel}>{moreMenu.trigger}</Text>
            </Pressable>
            {open && (
                <View accessibilityRole="menu" accessibilityLabel={moreMenu.trigger} style={styles.panel}>
                    {children}
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    wrap: { gap: nativeTokens.spacing[2], alignItems: 'flex-start' },
    // The DS `secondary` surface, reproduced from the same tokens `Button.native`'s own `secondary` tier uses
    // (white fill + `semantic.border` hairline + `radius.full`), plus the 44pt touch floor. Contrast note: the
    // previous `palette.mist` hairline was an ad-hoc off-tier colour, not the shared border token.
    trigger: {
        alignSelf: 'flex-start',
        minHeight: 44,
        justifyContent: 'center',
        backgroundColor: palette.white,
        borderRadius: nativeTokens.radius.full,
        borderWidth: 1,
        borderColor: semantic.border,
        paddingVertical: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[5],
    },
    triggerLabel: { color: palette.charcoal, fontWeight: '600', fontSize: nativeTokens.fontSize.bodySm },
    panel: {
        gap: nativeTokens.spacing[3],
        alignSelf: 'stretch',
        borderRadius: nativeTokens.radius.lg,
        borderWidth: 1,
        borderColor: nativeTokens.borderSubtle,
        backgroundColor: palette.white,
        padding: nativeTokens.spacing[4],
    },
});
