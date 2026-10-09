/**
 * @module @commise/features-recipes — the native "More actions" overflow on the recipe detail (C4 wireframe parity).
 *
 * The React Native leaf of `MoreActionsMenu`: a `⋯` trigger named for the recipe (44 pt on iOS, 48 dp on Android)
 * that reveals its actions in an INLINE panel below it, and announces collapsed and expanded. The destructive action
 * is a structural slot drawn last, after a divider. There is no pointer "outside" on device, so the panel closes when
 * the trigger is pressed again. Open/close is local, ephemeral UI state, so it stays here.
 *
 * @pattern Composite — the panel lays out the caller's actions and owns where the destructive one goes
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { role } from '@commise/ui/colors';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { useState, type FC } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { fillTemplate } from '../list/model.js';
import { recipeActionMessages } from './messages.js';
import type { MoreActionsMenuProps } from './model.js';

/** The trigger's target: 44 pt on iOS, 48 dp on Android (`docs/design/uiOverhaul/buildSpec.md` §1.6). */
const triggerTarget = (): number => (Platform.OS === 'android' ? 48 : 44);

export const MoreActionsMenu: FC<MoreActionsMenuProps> = ({ recipeTitle, children, destructive }) => {
    const { moreMenu } = useMessages(recipeActionMessages);
    const [open, setOpen] = useState(false);
    const target = triggerTarget();

    return (
        <View style={styles.wrap}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={fillTemplate(moreMenu.triggerFor, { title: recipeTitle })}
                // `aria-expanded` is React Native's own alias for `accessibilityState.expanded`, which
                // react-native-web surfaces in the DOM; device semantics are identical.
                aria-expanded={open}
                onPress={() => setOpen((previous) => !previous)}
                style={({ pressed }) => [
                    styles.trigger,
                    { minWidth: target, minHeight: target, borderRadius: target / 2 },
                    pressed ? styles.pressed : null,
                ]}
            >
                <Icon name="ellipsis" size={24} />
            </Pressable>
            {open && (
                <View collapsable={false} role="group" aria-label={moreMenu.title} style={styles.panel}>
                    {children}
                    {destructive === undefined ? null : (
                        <>
                            <View collapsable={false} role="separator" style={styles.divider} />
                            {destructive}
                        </>
                    )}
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    wrap: { gap: nativeTokens.spacing[2], alignItems: 'flex-start' },
    trigger: { alignItems: 'center', justifyContent: 'center' },
    pressed: { backgroundColor: palette.pearl },
    panel: {
        gap: nativeTokens.spacing[3],
        alignSelf: 'stretch',
        borderRadius: nativeTokens.radius.lg,
        borderWidth: 1,
        borderColor: role.lineDivider,
        backgroundColor: role.paper,
        padding: nativeTokens.spacing[4],
    },
    divider: { height: 1, alignSelf: 'stretch', backgroundColor: role.lineDivider },
});
