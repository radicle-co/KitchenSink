/**
 * @module @commise/features-recipes/list — the native sort control of My recipes: a ghost `sm` button "Sort: {choice}"
 * that opens a content-height sheet of radio rows, the chosen one checked — the native form of the web leaf's menu
 * (`docs/design/uiOverhaul/buildSpec.md` §4.5 gives menus a native sheet). Choosing a sort closes the sheet.
 *
 * @pattern Adapter over the design-system `Sheet`, carrying a radio group
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { nativeTokens } from '@commise/ui/native';
import { Sheet } from '@commise/ui/sheet';
import { useTheme } from '@commise/ui/theme';
import { useState, type FC } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import { LIBRARY_SORTS, sortLabelOf } from './library.js';
import { fillTemplate, type RecipeListSortControl } from './model.js';

/**
 * The sort control.
 *
 * @param props - The sort in use and how to change it.
 * @returns The trigger and its sheet.
 */
export const LibrarySortMenu: FC<RecipeListSortControl> = ({ value, onChange }) => {
    const { list } = useMessages(recipeMessages);
    const { colors } = useTheme();
    const [open, setOpen] = useState(false);

    return (
        <>
            <Button variant="ghost" size="sm" icon="chevronDown" onPress={() => setOpen(true)}>
                {fillTemplate(list.sortButton, { choice: sortLabelOf(value, list) })}
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
                            <Pressable
                                key={sort}
                                role="radio"
                                aria-checked={chosen}
                                aria-label={sortLabelOf(sort, list)}
                                onPress={() => {
                                    onChange(sort);
                                    setOpen(false);
                                }}
                                style={({ pressed }) => [
                                    styles.row,
                                    pressed ? { backgroundColor: colors.surfaceMuted } : null,
                                ]}
                            >
                                <View style={styles.check}>
                                    {chosen ? <Icon name="check" size={20} tone="ink" /> : null}
                                </View>
                                <Text style={[styles.label, { color: colors.ink }]}>{sortLabelOf(sort, list)}</Text>
                            </Pressable>
                        );
                    })}
                </View>
            </Sheet>
        </>
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
