/**
 * @module @commise/features-recipes — the native discovery controls group: the Filters button, the sort, the applied
 * chips and the way back to the rails.
 *
 * ONE group in every layout. In compact height it is a single wrapping row, in the same reading order; otherwise a
 * column with the button and the sort side by side. While `collapsed` it steps aside for the keyboard, and with no
 * control to hold it is not drawn either, so an empty group opens no gap in the frame.
 *
 * Presentational: props → JSX.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { nativeTokens } from '@commise/ui/native';
import type { FC, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { discoveryMessages } from './messages.js';
import type { DiscoveryFilterSlots } from './model.js';

/** Props for {@link DiscoveryControls}. */
export interface DiscoveryControlsProps {
    /** Whether the window is compact in height. */
    readonly compact: boolean;
    /** Whether the group steps aside for the keyboard. */
    readonly collapsed: boolean;
    /** The sheet presentation's slots; absent in the panel presentation or with no filters. */
    readonly sheet: Extract<DiscoveryFilterSlots, { readonly presentation: 'sheet' }> | undefined;
    /** The sort control, or `null` when the container omits it. */
    readonly sort: ReactNode;
    /** Back to the rails; absent unless a "see all" left browse. */
    readonly onExitToBrowse: (() => void) | undefined;
}

/** The native discovery controls. */
export const DiscoveryControls: FC<DiscoveryControlsProps> = ({ compact, collapsed, sheet, sort, onExitToBrowse }) => {
    const discovery = useMessages(discoveryMessages);
    const hasSort = sort !== null && sort !== undefined;

    if (collapsed || (sheet === undefined && onExitToBrowse === undefined && !hasSort)) {
        return null;
    }

    const backToBrowse =
        onExitToBrowse === undefined ? null : (
            <View style={styles.start}>
                <Button variant="ghost" size="sm" icon="chevronLeft" onPress={onExitToBrowse}>
                    {discovery.backToBrowse}
                </Button>
            </View>
        );

    if (compact) {
        return (
            <View style={styles.row}>
                {sheet?.trigger}
                {sort}
                {backToBrowse}
                {sheet?.applied}
            </View>
        );
    }

    return (
        <View style={styles.column}>
            {sheet === undefined ? (
                sort
            ) : (
                <View style={styles.spread}>
                    {sheet.trigger}
                    {sort}
                </View>
            )}
            {sheet?.applied}
            {backToBrowse}
        </View>
    );
};

const styles = StyleSheet.create({
    column: { gap: nativeTokens.spacing[3] },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[2] },
    spread: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: nativeTokens.spacing[3],
    },
    start: { alignSelf: 'flex-start' },
});
