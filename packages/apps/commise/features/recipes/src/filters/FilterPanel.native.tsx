/**
 * @module @commise/features-recipes/filters — the native Discover filter panel, the twin of the web leaf
 * (`docs/design/uiOverhaul/buildSpec.md` §4.4): on a tablet held wide (a 960 container in a window that is not short) a
 * 256-point column at the start side of the results, scrolling inside itself, with Clear all at its top. Below that the
 * same groups live in the sheet, and never both.
 *
 * Presentational: it draws the facet groups in a panel and reports every change.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { FilterGroups } from './FilterGroups.native.js';
import type { FilterPanelProps } from './filtersModel.js';
import { filterMessages } from './messages.js';

export const FilterPanel: FC<FilterPanelProps> = ({ view, ingredientSearch, onFilterAction }) => {
    const m = useMessages(filterMessages);
    const { colors } = useTheme();

    return (
        <View
            collapsable={false}
            role="complementary"
            aria-label={m.panelLabel}
            style={[styles.panel, { backgroundColor: colors.paper, borderColor: colors.lineDivider }]}
        >
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
                {view.hasActive ? (
                    <Button variant="ghost" size="sm" width="fill" onPress={() => onFilterAction({ kind: 'clearAll' })}>
                        {m.clearAll}
                    </Button>
                ) : null}
                <FilterGroups
                    view={view}
                    chipOverflow="wrap"
                    ingredientSearch={ingredientSearch}
                    onFilterAction={onFilterAction}
                />
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    panel: {
        width: 256,
        flexShrink: 0,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: nativeTokens.radius.md,
    },
    content: { padding: nativeTokens.spacing[4], gap: nativeTokens.spacing[4] },
});
