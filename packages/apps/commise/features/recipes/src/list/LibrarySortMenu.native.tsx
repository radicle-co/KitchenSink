/**
 * @module @commise/features-recipes/list — the native sort control of My recipes: a ghost `sm` button showing the choice (named
 * "Sort: {choice}") that opens a content-height sheet of radio rows, the chosen one checked — the native form of the web leaf's menu
 * (`docs/design/uiOverhaul/buildSpec.md` §4.5 gives menus a native sheet). Choosing a sort closes the sheet.
 *
 * @pattern Adapter over the design-system `Sheet`, carrying a radio group
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { Sheet } from '@commise/ui/sheet';
import { usePressFill } from '@commise/ui/surface-tone';
import { useTheme } from '@commise/ui/theme';
import { useState, type FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { LIBRARY_SORTS, sortLabelOf } from './library.js';
import { type RecipeListSortControl } from './model.js';
import { fillTemplate } from '../format/fillTemplate.js';

/**
 * The sort control.
 *
 * @param props - The sort in use and how to change it.
 * @returns The trigger and its sheet.
 */
export const LibrarySortMenu: FC<RecipeListSortControl> = ({ value, onChange }) => {
    const { list } = useMessages(recipeMessages);
    const [open, setOpen] = useState(false);
    const choice = sortLabelOf(value, list);

    return (
        <>
            {/* The visible label is the choice alone, so the result bar fits a narrow phone and the largest font scale; the
                name keeps "Sort: …" and contains the visible text (SC 2.5.3). The chevron follows its word, as on web. */}
            <Button
                variant="ghost"
                size="sm"
                icon="chevronDown"
                iconPlacement="end"
                accessibilityLabel={fillTemplate(list.sortButton, { choice })}
                onPress={() => setOpen(true)}
            >
                {choice}
            </Button>
            <Sheet
                open={open}
                onOpenChange={setOpen}
                title={list.sortMenuLabel}
                closeLabel={list.sortClose}
                size="content"
            >
                <View collapsable={false} role="radiogroup" aria-label={list.sortMenuLabel} style={styles.group}>
                    {LIBRARY_SORTS.map((sort) => {
                        const chosen = sort === value;

                        return (
                            <SortOption
                                key={sort}
                                label={sortLabelOf(sort, list)}
                                chosen={chosen}
                                onChoose={() => {
                                    onChange(sort);
                                    setOpen(false);
                                }}
                            />
                        );
                    })}
                </View>
            </Sheet>
        </>
    );
};

interface SortOptionProps {
    readonly label: string;
    readonly chosen: boolean;
    readonly onChoose: () => void;
}

/**
 * One radio row of the sort sheet. Its own component, so `usePressFill` reads the surface the SHEET states
 * (`paperOverlay`), not the one the menu was opened from.
 */
const SortOption: FC<SortOptionProps> = ({ label, chosen, onChoose }) => {
    const { colors } = useTheme();
    const pressFill = usePressFill();

    return (
        <Pressable
            role="radio"
            aria-checked={chosen}
            aria-label={label}
            onPress={onChoose}
            style={({ pressed }) => [styles.row, pressed ? { backgroundColor: pressFill } : null]}
        >
            <View style={styles.check}>{chosen ? <Icon name="check" size={20} tone="ink" /> : null}</View>
            <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
        </Pressable>
    );
};

const styles = StyleSheet.create({
    group: { paddingVertical: nativeTokens.spacing[2] },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[3],
        minHeight: 48,
        paddingHorizontal: nativeTokens.spacing[4],
        borderRadius: nativeTokens.radius.md,
    },
    check: { width: 20, alignItems: 'center' },
    label: { ...nativeTokens.type.body },
});
