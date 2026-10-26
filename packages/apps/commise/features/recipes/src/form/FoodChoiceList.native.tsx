/**
 * @module @commise/features-recipes/form — `FoodChoiceList` (native): the React Native leaf of `./FoodChoiceList.tsx`, on
 * the same props and the same words (`pasteMatchView.ts`). Search for a food first, the options in the server's order
 * with the default tagged, then Keep as written last.
 *
 * Each option is a `Pressable` with the `button` role, and the food a reopened line holds is `selected` (staff-ux ruling
 * 2026-10-25): VoiceOver and TalkBack read a radio as "not selected", which implies a confirm step that does not exist.
 * The options' group keeps its native node (`collapsable={false}`), or Android flattens it and its name is lost to
 * TalkBack and Maestro (`docs/design/nativeContainerNames.md` N1). Rows are 48 pt at least and every name wraps, so nothing is cut off or scrolls sideways at 320 pt. Painted from the
 * theme's roles, so it reads in both themes (D15).
 */
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { StatusBadge } from '@commise/ui/status-badge';
import { useTheme } from '@commise/ui/theme';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import type { FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { FoodChoiceListProps } from './foodChoiceListProps.js';

/** The native 48 dp touch floor (Android), which the 44 pt iOS floor sits under. */
const ROW_MIN_HEIGHT = 48;

/** An open line's list: search, the options, Keep as written. */
export const FoodChoiceList: FC<FoodChoiceListProps> = ({
    view,
    onSearch,
    onChoose,
    onKeepAsWritten,
    searchFocusRequested,
    onSearchFocusRequestHandled,
}) => {
    const { colors } = useTheme();

    return (
        <View style={styles.list}>
            {view.search.kind === 'available' ? (
                <Button
                    variant="ghost"
                    icon="search"
                    width="fill"
                    accessibilityLabel={view.search.name}
                    focusRequested={searchFocusRequested}
                    onFocusRequestHandled={onSearchFocusRequestHandled}
                    onPress={onSearch}
                >
                    {view.search.label}
                </Button>
            ) : (
                <Text style={[styles.meta, { color: colors.inkMuted }]}>{view.search.text}</Text>
            )}
            <View collapsable={false} aria-label={view.optionsName}>
                {view.rows.map((row) =>
                    row.kind === 'food' ? (
                        <Pressable
                            key={row.id}
                            accessibilityRole="button"
                            accessibilityLabel={row.name}
                            aria-selected={row.chosen}
                            onPress={() => onChoose(row.id)}
                            style={({ pressed }) => [
                                styles.row,
                                row.chosen && { backgroundColor: colors.selectedFill },
                                pressed && { backgroundColor: colors.surfaceMuted },
                            ]}
                        >
                            <View style={styles.text}>
                                <View style={styles.nameLine}>
                                    <Text style={[styles.name, { color: colors.ink }]}>{row.label}</Text>
                                    {row.tag !== undefined && <StatusBadge status="note">{row.tag}</StatusBadge>}
                                </View>
                                {row.detailParts !== undefined && (
                                    <VariantPartsLine parts={row.detailParts} tone="secondary" />
                                )}
                            </View>
                            {row.chosen && <Icon name="check" size={20} tone="actionText" />}
                        </Pressable>
                    ) : (
                        <Pressable
                            key="keepAsWritten"
                            accessibilityRole="button"
                            accessibilityLabel={row.name}
                            onPress={onKeepAsWritten}
                            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
                        >
                            <View style={styles.text}>
                                <Text style={[styles.name, { color: colors.ink }]}>{row.label}</Text>
                                <Text style={[styles.meta, { color: colors.inkMuted }]}>{row.hint}</Text>
                            </View>
                        </Pressable>
                    ),
                )}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    list: { gap: nativeTokens.spacing[2] },
    row: {
        minHeight: ROW_MIN_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[2],
        paddingHorizontal: nativeTokens.spacing[3],
        paddingVertical: nativeTokens.spacing[2],
        borderRadius: nativeTokens.radius.md,
    },
    // `minWidth: 0`: a column that cannot shrink below its longest word is how a row comes to scroll sideways.
    text: { flex: 1, minWidth: 0, gap: nativeTokens.spacing[1] },
    nameLine: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: nativeTokens.spacing[2],
        rowGap: nativeTokens.spacing[1],
    },
    name: { ...nativeTokens.type.body, flexShrink: 1 },
    meta: { ...nativeTokens.type.meta },
});
