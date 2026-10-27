/**
 * @module @commise/features-recipes/common — one radio row of a native sort sheet, shared by the Discover and My recipes
 * menus, which each carried a byte-identical copy. A `radio` named for its label, with a check on the sort in use and
 * the platform touch floor under it.
 *
 * It is a feature-package row and not a design-system one: the web menus are Radix menus with their own item, so a
 * `@commise/ui` row would owe a web leaf nothing would use. It MUST be rendered inside the sheet: `usePressFill` reads
 * the surface the SHEET states (`paperOverlay`), not the one the menu was opened from.
 *
 * Presentational: props → JSX.
 */
import { Icon } from '@commise/ui/icon';
import { touchFloor } from '@commise/ui/layout';
import { nativeTokens } from '@commise/ui/native';
import { usePressFill } from '@commise/ui/surface-tone';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/** What a sort option needs. */
export interface SortOptionRowProps {
    /** The option's localised name. */
    readonly label: string;
    /** Whether it is the sort in use. */
    readonly chosen: boolean;
    /** Choose it. */
    readonly onChoose: () => void;
}

/**
 * One radio row of a sort sheet.
 *
 * @param props - The option and whether it is in use.
 * @returns The row.
 */
export const SortOptionRow: FC<SortOptionRowProps> = ({ label, chosen, onChoose }) => {
    const { colors } = useTheme();
    const pressFill = usePressFill();

    return (
        <Pressable
            role="radio"
            aria-checked={chosen}
            aria-label={label}
            onPress={onChoose}
            style={({ pressed }) => [
                styles.row,
                { minHeight: touchFloor() },
                pressed ? { backgroundColor: pressFill } : null,
            ]}
        >
            <View style={styles.check}>{chosen ? <Icon name="check" size={20} tone="ink" /> : null}</View>
            <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
        </Pressable>
    );
};

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[3],
        paddingHorizontal: nativeTokens.spacing[4],
        borderRadius: nativeTokens.radius.md,
    },
    check: { width: 20, alignItems: 'center' },
    label: { ...nativeTokens.type.body },
});
