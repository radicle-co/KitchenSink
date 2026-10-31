/**
 * @module @commise/ui/dialog-actions — the native design-system {@link DialogActions}: the action row of a dialog or
 * sheet. A presentational component: its one piece of state is the width it measured of itself.
 *
 * It measures its OWN width from layout, because the window's width is not the width of a dialog card or a sheet's
 * content box. Before the first layout it stacks, the safe shape for the narrowest phone, so a first paint can never
 * clip a button. The buttons stack full width with the main action on top (`column-reverse` over source order: dismiss
 * first), then sit end-aligned in one row from `sideBySideFrom`. Give each button `width="fill"`: in a row that keeps
 * its content width.
 *
 * @pattern Strategy chosen by measurement — a row direction picked from the box's own measured width
 */
import { useState, type FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { nativeTokens } from '../tokens/native.js';
import type { DialogActionsProps } from './props.js';

export const DialogActions: FC<DialogActionsProps> = ({ sideBySideFrom, children }) => {
    const [width, setWidth] = useState<number | null>(null);
    const sideBySide = width !== null && width >= sideBySideFrom;

    return (
        <View
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            style={sideBySide ? styles.row : styles.stacked}
        >
            {children}
        </View>
    );
};

const styles = StyleSheet.create({
    stacked: { flexDirection: 'column-reverse', alignItems: 'stretch', gap: nativeTokens.spacing[3] },
    row: { flexDirection: 'row', justifyContent: 'flex-end', gap: nativeTokens.spacing[3] },
});
