/**
 * @module @commise/ui/large-title-header — the native design-system {@link LargeTitleHeader} (see `props.ts`): the
 * H1 in `largeTitle`, sized by the screen's container class, under a transparent row the touch floor tall (44 pt; 48 dp on Android) that holds the `action` at the
 * end. Native shows it at every size, as iOS's large title and Material's collapsing bar do.
 *
 * ⛔ It draws NO Back control, though it keeps the `back` prop (web uses it for the 840+ eyebrow). On native Back is the
 * pinned `CondensedTitleBar`'s, in every state and at every scroll position (`docs/design/uiRefreshWorkshop5/
 * pinnedBackBar.md` §4): a second one here would be an off-screen duplicate with the same accessible name, and a dead band
 * above the title. The 44 pt row is therefore drawn for an `action` and for nothing else.
 *
 * The accessibility tree reads title → subtitle → action → `afterTitle` → segments, whatever is drawn where, so the title
 * comes before the avatar and the floating button (§4.2). The action is laid over the row by absolute position for that
 * reason.
 *
 * Inside a `ScrollHost` the title block reports its layout, so the host knows when the title has scrolled under the top
 * and the screen's `CondensedTitleBar` shows. That needs this header to be the scroller's FIRST child.
 *
 * The H1's ref is `useScreenReaderFocusOnSignal`'s, sanctioned in the ref register: moving the screen-reader cursor has
 * no declarative form.
 *
 * The header insets itself {@link SIDE_INSET} on both sides; the action, placed absolutely, carries the same inset.
 *
 * Presentational: props → JSX.
 *
 * @pattern Visitor — an exhaustive switch over the `HeaderAction` union
 */
import { useContext, type ComponentRef, type FC, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { touchFloor } from '../layout/touchFloor.native.js';
import { ScrollHostContext } from '../scrollHost/scrollHostContext.js';
import { useScreenReaderFocusOnSignal } from '../screenReaderFocus/useScreenReaderFocusOnSignal.native.js';
import { Text as DesignText } from '../text/Text.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { HeaderAction, LargeTitleHeaderProps } from './props.js';

/**
 * The header's own side inset, pt. The header owns it so a screen cannot forget it and leave the title on the screen
 * edge (bug sweep, B11). A screen that wraps the header in its own side padding must not also keep that padding for the
 * header, or the title moves in twice.
 */
const SIDE_INSET = nativeTokens.spacing[4];

/** The action group, at the end of the row. */
function actionOf(action: HeaderAction, rowHeight: number): ReactNode {
    switch (action.kind) {
        case 'avatar':
            return <View style={[styles.action, { height: rowHeight }]}>{action.avatar}</View>;
        case 'controls':
            return (
                <View style={[styles.action, styles.controls, { height: rowHeight }]}>
                    {action.button}
                    {action.menu}
                </View>
            );
    }
}

/** The native design-system large title header. */
export const LargeTitleHeader: FC<LargeTitleHeaderProps> = ({
    title,
    subtitle,
    action,
    afterTitle,
    segments,
    focusSignal = 0,
}) => {
    const heading = useScreenReaderFocusOnSignal<ComponentRef<typeof DesignText>>(focusSignal);
    // Read without throwing: a header outside a host (a sheet, a test) simply reports nowhere.
    const host = useContext(ScrollHostContext);
    const hasRow = action !== undefined;
    // The row is the touch floor tall (44 pt; 48 dp on Android), so an action's target is not cut to the row.
    const rowHeight = touchFloor();

    return (
        <View style={styles.header}>
            <View onLayout={host?.headingLayout} style={[styles.titleBlock, hasRow ? { paddingTop: rowHeight } : null]}>
                {/* The design-system Text, so the title stops at 1.5x and wraps at word boundaries instead of drawing at
                    about 3x and breaking inside its word (designer finding C-1, reviews/mergedUiIos1.md). */}
                <DesignText ref={heading} role="heading" aria-level={1} typeRole="largeTitle" color="$ink">
                    {title}
                </DesignText>
                {subtitle === undefined ? null : (
                    // Wraps, never cut off: Home's date is a fact the cook reads, at every text size. The design-system
                    // Text grows its leading with its size, so the wrapped lines never overlap on Android (ADR-0080 §8).
                    <DesignText typeRole="meta" color="$inkMuted">
                        {subtitle}
                    </DesignText>
                )}
            </View>
            {action === undefined ? null : actionOf(action, rowHeight)}
            {afterTitle}
            {segments === undefined ? null : <View style={styles.segments}>{segments}</View>}
        </View>
    );
};

const styles = StyleSheet.create({
    header: { position: 'relative', paddingBottom: nativeTokens.spacing[2], paddingHorizontal: SIDE_INSET },
    titleBlock: { gap: nativeTokens.spacing[1] },
    action: {
        position: 'absolute',
        top: 0,
        // An absolute child is placed from the parent's edge, not its padding edge, so it carries the inset itself.
        end: SIDE_INSET,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1,
    },
    controls: { flexDirection: 'row', gap: nativeTokens.spacing[2] },
    segments: { marginTop: nativeTokens.spacing[3] },
});
