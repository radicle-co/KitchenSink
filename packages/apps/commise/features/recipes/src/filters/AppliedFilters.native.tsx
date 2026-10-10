/**
 * @module @commise/features-recipes/filters — the native applied-filter chips, the twin of the web leaf
 * (`docs/design/uiOverhaul/buildSpec.md` §4.4): each filter in force as a removable input chip named "Remove {filter}
 * filter", in a scrolling row, then Clear all (ghost) once two or more apply. With nothing applied it draws nothing.
 *
 * Presentational: it draws the applied-filter chips and reports removals.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Chip, ChipRow } from '@commise/ui/chip';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import type { AppliedFiltersProps } from './filtersModel.js';
import { filterMessages } from './messages.js';

/** From this many applied filters, Clear all earns its place. */
const CLEAR_ALL_FROM = 2;

export const AppliedFilters: FC<AppliedFiltersProps> = ({ view, chipOverflow, onFilterAction }) => {
    const m = useMessages(filterMessages);

    if (view.applied.length === 0) {
        return null;
    }

    return (
        <View style={styles.row}>
            <ChipRow mode="input" label={m.appliedLabel} overflow={chipOverflow}>
                {view.applied.map((entry) => (
                    <Chip
                        key={entry.key}
                        kind="input"
                        label={entry.label}
                        removeLabel={entry.removeLabel}
                        onRemove={() => onFilterAction(entry.action)}
                    />
                ))}
            </ChipRow>
            {view.applied.length >= CLEAR_ALL_FROM ? (
                <Button variant="ghost" size="sm" onPress={() => onFilterAction({ kind: 'clearAll' })}>
                    {m.clearAll}
                </Button>
            ) : null}
        </View>
    );
};

const styles = StyleSheet.create({
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[2] },
});
