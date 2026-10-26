/**
 * @module @commise/features-recipes/form — `PasteMatchClosedRow` (native): the React Native leaf of
 * `./PasteMatchClosedRow.tsx`. The whole row is one `button`, 48 pt at least, that opens the line; the line the side pane
 * shows at 1194 is `selected` and drawn with the selected fill. Painted from the theme's roles (D15).
 */
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PastedLine } from './PastedLine.native.js';
import type { PasteMatchClosedRowProps } from './pasteMatchClosedRowProps.js';

/** One collapsed open line. */
export const PasteMatchClosedRow: FC<PasteMatchClosedRowProps> = ({ line, view, current, onOpen }) => {
    const { colors } = useTheme();

    return (
        <Pressable
            accessibilityRole="button"
            aria-selected={current}
            onPress={onOpen}
            style={({ pressed }) => [
                styles.row,
                current && { backgroundColor: colors.selectedFill },
                pressed && { backgroundColor: colors.surfaceMuted },
            ]}
        >
            <View style={styles.text}>
                <PastedLine line={line} />
                <Text style={[styles.need, { color: colors.inkMuted }]}>{view.need}</Text>
            </View>
            <Icon name="chevronRight" size={20} tone="inkMuted" />
        </Pressable>
    );
};

const styles = StyleSheet.create({
    row: {
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[1],
        paddingVertical: nativeTokens.spacing[2],
        borderRadius: nativeTokens.radius.md,
    },
    text: { flex: 1, minWidth: 0, gap: nativeTokens.spacing[1] },
    need: { ...nativeTokens.type.meta },
});
