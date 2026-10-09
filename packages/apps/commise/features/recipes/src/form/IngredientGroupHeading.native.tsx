/**
 * @module @commise/features-recipes/form — `IngredientGroupHeading` (native): a group's heading (build spec §7.5.5), a
 * level-3 header in `label`, `inkMuted`, with its own `⋯` (a sheet of menu items). The React Native leaf of
 * `./IngredientGroupHeading.tsx`; while the group is renamed, its name field takes the heading's place.
 *
 * Presentational: `props → JSX` over the heading's view (`GroupHeadingView`).
 *
 * @pattern Strategy — the heading or its rename field, chosen by the view's `renaming`
 */
import { ActionMenu } from '@commise/ui/action-menu';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GroupNameField } from './GroupNameField.native.js';
import type { GroupHeadingView } from './useIngredientGroups.js';

/** A group's heading, or its rename field. */
export const IngredientGroupHeading: FC<{ readonly id: string; readonly group: GroupHeadingView }> = ({
    id,
    group,
}) => {
    const { colors } = useTheme();

    return group.renaming === undefined ? (
        <View style={styles.row}>
            <Text
                nativeID={id}
                accessibilityRole="header"
                aria-level={3}
                style={[styles.heading, { color: colors.inkMuted }]}
            >
                {group.label}
            </Text>
            <ActionMenu
                triggerLabel={group.actionsLabel}
                title={group.label}
                closeLabel={group.closeLabel}
                items={group.actions}
                destructiveItem={group.destructiveAction}
                focusRequested={group.actionsFocus.requested}
                onFocusRequestHandled={group.actionsFocus.onHandled}
            />
        </View>
    ) : (
        <GroupNameField field={group.renaming} />
    );
};

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: nativeTokens.spacing[2],
        minHeight: 48,
    },
    heading: { ...nativeTokens.type.label, flexShrink: 1 },
});
