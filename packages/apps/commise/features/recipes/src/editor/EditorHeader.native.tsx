/**
 * @module @commise/features-recipes/editor — the native editor's header (build spec §7.1, §7.12): × "Close editor", the
 * title ("New recipe" or "Edit recipe", the screen's heading, never the recipe's own title), the save status in
 * `meta`, and ⋯ "More editor actions" holding the one destructive action (a bottom sheet on native). At least 56 pt on the
 * screen's solid surface (it grows when the status wraps): the editor's only glass is its action bar (owner D12).
 *
 * × never asks (Settled 24): the editor saves by itself, so leaving loses nothing.
 *
 * Both texts are bar chrome, capped at 1.5x like `CondensedTitleBar`'s (`chromeCap`), so the status is never larger than
 * the title. Only the title truncates (the H1 repeats it); the save status shows nowhere else, so it wraps.
 *
 * Presentational: props → JSX.
 */
import { ActionMenu } from '@commise/ui/action-menu';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import { Surface } from '@commise/ui/surface-tone';
import { touchFloor } from '@commise/ui/layout';
import type { FC } from 'react';
import { Text } from '@commise/ui/text';
import { Pressable, StyleSheet, View } from 'react-native';

import type { EditorHeaderProps } from './frameProps.js';

/** The native editor header. */
export const EditorHeader: FC<EditorHeaderProps> = ({ title, status, closeLabel, onClose, menu }) => {
    const { colors } = useTheme();

    return (
        <Surface tone="paper" style={[styles.bar, { borderBottomColor: colors.lineDivider }]}>
            <Pressable role="button" aria-label={closeLabel} onPress={onClose} hitSlop={4} style={styles.close}>
                <Icon name="x" size={24} tone="ink" />
            </Pressable>
            <View style={styles.titles}>
                <Text role="heading" typeRole="barTitle" chromeCap="1.5" color="$ink" numberOfLines={1}>
                    {title}
                </Text>
                {status === undefined ? null : (
                    <Text typeRole="meta" chromeCap="1.5" color="$inkMuted">
                        {status}
                    </Text>
                )}
            </View>
            {menu === undefined ? null : (
                <ActionMenu
                    triggerLabel={menu.triggerLabel}
                    title={title}
                    closeLabel={menu.closeLabel}
                    items={[]}
                    destructiveItem={{
                        id: 'discard',
                        label: menu.discardLabel,
                        onSelect: menu.onDiscard,
                        ...(menu.discardUnavailable === undefined ? {} : { unavailable: menu.discardUnavailable }),
                    }}
                />
            )}
        </Surface>
    );
};

const styles = StyleSheet.create({
    bar: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 56,
        gap: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[2],
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    close: { width: touchFloor(), height: touchFloor(), alignItems: 'center', justifyContent: 'center' },
    titles: { flex: 1, minWidth: 0 },
});
