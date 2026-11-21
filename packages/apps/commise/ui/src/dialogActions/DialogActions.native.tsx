/**
 * @module @commise/ui/dialog-actions — the native design-system {@link DialogActions}: the action row of a dialog or
 * sheet. A presentational component: its one piece of state is the width it measured of itself.
 *
 * It measures its OWN width from layout, because the window's width is not the width of a dialog card or a sheet's
 * content box. Before the first layout it stacks (unless a frame's width memento seeds it, below), the safe shape for
 * the narrowest phone, so a first paint can never clip a button. The buttons stack full width with the main action on
 * top (`column-reverse` over source order: dismiss first), then sit end-aligned in one row from `sideBySideFrom` in
 * text units (`isSideBySide`: the threshold times the text scale, clamped to [1, 2]). Give each button
 * `width="fill"`: in a row that keeps its content width. `shares="equal"` gives each action an equal share of the row.
 * Direct children only, in source order; a Fragment counts as ONE action, and a `null` or `false` child gets no share.
 *
 * A frame that moves its footer (`BottomSheetPanel`, I7) remounts it: it holds the width memento
 * (`dialogActionsWidth.ts`) above the move, this seeds from it, so the first frame after a move is the decided form,
 * and its own layout still wins and is recorded back.
 *
 * @pattern Strategy chosen by measurement — a row direction picked from the box's own measured width
 * @pattern Decorator — the per-child share wrapper (`EqualShare`) for `shares="equal"`
 * @pattern Memento — the width restored from the frame's memento when a move remounts it
 */
import { Children, isValidElement, useContext, useState, type FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTextScale } from '../text/useTextScale.native.js';
import { nativeTokens } from '../tokens/native.js';
import { DialogActionsWidthContext } from './dialogActionsWidth.js';
import { EqualShare } from './EqualShare.native.js';
import { isSideBySide } from './isSideBySide.js';
import type { DialogActionsProps } from './props.js';

export const DialogActions: FC<DialogActionsProps> = ({ sideBySideFrom, shares = 'content', children }) => {
    const memento = useContext(DialogActionsWidthContext);
    const [width, setWidth] = useState<number | null>(memento?.width ?? null);
    const sideBySide = isSideBySide(width, sideBySideFrom, useTextScale());

    return (
        <View
            onLayout={(event) => {
                const measured = event.nativeEvent.layout.width;

                setWidth(measured);
                memento?.remember(measured);
            }}
            style={sideBySide ? styles.row : styles.stacked}
        >
            {shares === 'equal'
                ? Children.toArray(children).map((child, index) => (
                      // The wrapper never mounts or unmounts on a flip, only its style changes: no button remounts.
                      <EqualShare
                          key={isValidElement(child) && child.key !== null ? child.key : index}
                          inRow={sideBySide}
                      >
                          {child}
                      </EqualShare>
                  ))
                : children}
        </View>
    );
};

const styles = StyleSheet.create({
    stacked: { flexDirection: 'column-reverse', alignItems: 'stretch', gap: nativeTokens.spacing[3] },
    row: { flexDirection: 'row', justifyContent: 'flex-end', gap: nativeTokens.spacing[3] },
});
