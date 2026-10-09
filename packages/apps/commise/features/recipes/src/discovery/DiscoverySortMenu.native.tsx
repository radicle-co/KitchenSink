/**
 * @module @commise/features-recipes/discovery — the native sort control of Discover, the twin of the web leaf
 * (`docs/design/uiOverhaul/buildSpec.md` §4.5): a ghost `sm` button "Sort: {choice}" that opens a content-height sheet
 * of four radio rows with a check on the one in use. Choosing a sort closes the sheet.
 *
 * Presentational: it reports the chosen sort and holds only whether the menu is open.
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

import { fillTemplate } from '../list/model.js';
import { discoveryMessages } from './messages.js';
import { DISCOVERY_SORTS, discoverySortLabel, type RecipeDiscoverySortControl } from './model.js';

export const DiscoverySortMenu: FC<RecipeDiscoverySortControl> = ({ active, onChange }) => {
    const discovery = useMessages(discoveryMessages);
    const { colors } = useTheme();
    const [open, setOpen] = useState(false);

    return (
        <>
            <Button variant="ghost" size="sm" icon="chevronDown" onPress={() => setOpen(true)}>
                {fillTemplate(discovery.sortButton, { choice: discoverySortLabel(active, discovery) })}
            </Button>
            <Sheet
                open={open}
                onOpenChange={setOpen}
                title={discovery.sortMenuLabel}
                closeLabel={discovery.sortClose}
                size="content"
            >
                <View collapsable={false} role="radiogroup" aria-label={discovery.sortMenuLabel} style={styles.group}>
                    {DISCOVERY_SORTS.map((sort) => {
                        const chosen = sort === active;

                        return (
                            <Pressable
                                key={sort}
                                role="radio"
                                aria-checked={chosen}
                                aria-label={discoverySortLabel(sort, discovery)}
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
                                <Text style={[styles.label, { color: colors.ink }]}>
                                    {discoverySortLabel(sort, discovery)}
                                </Text>
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
