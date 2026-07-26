/**
 * @module @commise/features-recipes — native "More" overflow menu (C4 wireframe parity).
 *
 * The React Native leaf of {@link import('./MoreActionsMenu.js').MoreActionsMenu} — same controlled-by-
 * nothing, self-contained disclosure contract: a `[More]` trigger that reveals its `children` (the secondary
 * owner actions — version history, delete, visibility) in an inline panel below it, mirroring the wireframe's
 * `[Edit] [More]` header pattern. There is no on-device analog to a pointer "outside click", so dismissal here
 * is simply re-pressing the trigger (the web leaf additionally supports Escape + outside-click, both web-only
 * affordances). Open/close is local, ephemeral UI state owned by this headless menu primitive — not business
 * logic — so it stays here rather than in the composing screen.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { useState, type FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeActionMessages } from './messages.js';
import type { MoreActionsMenuProps } from './model.js';

export const MoreActionsMenu: FC<MoreActionsMenuProps> = ({ children }) => {
    const { moreMenu } = useMessages(recipeActionMessages);
    const [open, setOpen] = useState(false);

    return (
        <View style={styles.wrap}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={moreMenu.trigger}
                accessibilityState={{ expanded: open }}
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
    wrap: { gap: 8, alignItems: 'flex-start' },
    trigger: {
        alignSelf: 'flex-start',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: palette.mist,
        paddingVertical: 8,
        paddingHorizontal: 16,
    },
    triggerLabel: { color: palette.charcoal, fontWeight: '600', fontSize: 14 },
    panel: {
        gap: 12,
        alignSelf: 'stretch',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(178, 190, 195, 0.3)',
        backgroundColor: palette.white,
        padding: 16,
    },
});
