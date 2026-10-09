/**
 * @module @commise/features-recipes/filters — the native Discover filter sheet, the twin of the web leaf
 * (`docs/design/uiOverhaul/buildSpec.md` §4.4), over the design-system `Sheet`: the title "Filters" with a close ×, the
 * groups in a scrolling body, and a pinned footer with "Show {count} recipes" (primary, on top) and Clear all (secondary)
 * stacked full width. Filters apply live underneath, so the primary only closes the sheet.
 *
 * Presentational: it draws the facet groups in a sheet and reports every change.
 *
 * @pattern Adapter over the design-system `Sheet`
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { FilterGroups } from './FilterGroups.native.js';
import { showResultsLabel } from './filterCopy.js';
import type { FilterSheetProps } from './filtersModel.js';
import { filterMessages } from './messages.js';

export const FilterSheet: FC<FilterSheetProps> = ({
    open,
    onOpenChange,
    view,
    chipOverflow,
    ingredientSearch,
    onFilterAction,
    resultCount,
}) => {
    const m = useMessages(filterMessages);
    const locale = useLocale();

    return (
        <Sheet
            open={open}
            onOpenChange={onOpenChange}
            title={m.panelLabel}
            closeLabel={m.filtersClose}
            size="content"
            footer={
                <View style={styles.footer}>
                    <Button icon="check" size="lg" width="fill" onPress={() => onOpenChange(false)}>
                        {showResultsLabel(resultCount, m, locale)}
                    </Button>
                    {view.hasActive ? (
                        <Button
                            variant="secondary"
                            icon="x"
                            width="fill"
                            onPress={() => onFilterAction({ kind: 'clearAll' })}
                        >
                            {m.clearAll}
                        </Button>
                    ) : null}
                </View>
            }
        >
            <FilterGroups
                view={view}
                chipOverflow={chipOverflow}
                ingredientSearch={ingredientSearch}
                onFilterAction={onFilterAction}
            />
        </Sheet>
    );
};

const styles = StyleSheet.create({ footer: { gap: nativeTokens.spacing[3] } });
