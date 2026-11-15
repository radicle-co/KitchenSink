/**
 * @module @commise/features-recipes/discovery — the native sort control of Discover, the twin of the web leaf
 * (`docs/design/uiOverhaul/buildSpec.md` §4.5): a ghost `sm` button showing the choice (named
 * "Sort: {choice}") that opens a content-height sheet
 * of four radio rows with a check on the one in use. Choosing a sort closes the sheet.
 *
 * Presentational: it reports the chosen sort and holds only whether the menu is open.
 *
 * @pattern Adapter over the design-system `Sheet`, carrying a radio group
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { Sheet } from '@commise/ui/sheet';
import { useState, type FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { fillTemplate } from '@commise/i18n';
import { SortOptionRow } from '../common/SortOptionRow.native.js';
import { discoveryMessages } from './messages.js';
import { DISCOVERY_SORTS, discoverySortLabel, type RecipeDiscoverySortControl } from './model.js';

export const DiscoverySortMenu: FC<RecipeDiscoverySortControl> = ({ active, onChange }) => {
    const discovery = useMessages(discoveryMessages);
    const [open, setOpen] = useState(false);
    const choice = discoverySortLabel(active, discovery);

    return (
        <>
            <Button
                variant="ghost"
                size="sm"
                icon="chevronDown"
                iconPlacement="end"
                accessibilityLabel={fillTemplate(discovery.sortButton, { choice })}
                onPress={() => setOpen(true)}
            >
                {choice}
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
                            <SortOptionRow
                                key={sort}
                                label={discoverySortLabel(sort, discovery)}
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

const styles = StyleSheet.create({
    group: { paddingVertical: nativeTokens.spacing[2] },
});
