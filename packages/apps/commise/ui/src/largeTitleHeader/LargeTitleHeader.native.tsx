/**
 * @module @commise/ui/large-title-header — the native design-system {@link LargeTitleHeader} (see `props.ts`): the
 * transparent 44 pt row (back at the start, the action at the end) over the H1 in `largeTitle`, sized by the screen's
 * container class. Native shows it at every size, as iOS's large title and Material's collapsing bar do.
 *
 * The accessibility tree reads back → title → subtitle → action → `afterTitle` → segments, whatever is drawn where, so
 * the title comes before the avatar and the floating button (§4.2). The back control and the action are laid over the
 * row by absolute position for that reason.
 *
 * Inside a `ScrollHost` the title block reports its layout, so the host knows when the title has scrolled under the top
 * and the screen's `CondensedTitleBar` shows. That needs this header to be the scroller's FIRST child.
 *
 * The H1's ref is `useScreenReaderFocusOnSignal`'s, sanctioned in the ref register: moving the screen-reader cursor has
 * no declarative form.
 *
 * Presentational: props → JSX.
 *
 * @pattern Visitor — an exhaustive switch over the `HeaderAction` union
 */
import { useContext, type FC, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '../icon/Icon.native.js';
import { useContainerClass } from '../layout/useContainerClass.native.js';
import { ScrollHostContext } from '../scrollHost/scrollHostContext.js';
import { useScreenReaderFocusOnSignal } from '../screenReaderFocus/useScreenReaderFocusOnSignal.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { HeaderAction, LargeTitleHeaderProps } from './props.js';

/** The height of the row that holds the back control and the action, pt (§3.3). */
const ROW_HEIGHT = 44;

/** The action group, at the end of the row. */
function actionOf(action: HeaderAction): ReactNode {
    switch (action.kind) {
        case 'avatar':
            return <View style={styles.action}>{action.avatar}</View>;
        case 'controls':
            return (
                <View style={[styles.action, styles.controls]}>
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
    back,
    action,
    afterTitle,
    segments,
    focusSignal = 0,
}) => {
    const { colors } = useTheme();
    const containerClass = useContainerClass();
    const heading = useScreenReaderFocusOnSignal<Text>(focusSignal);
    // Read without throwing: a header outside a host (a sheet, a test) simply reports nowhere.
    const host = useContext(ScrollHostContext);
    const hasRow = back !== undefined || action !== undefined;

    return (
        <View style={styles.header}>
            {back === undefined ? null : (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={back.label}
                    onPress={back.onPress}
                    hitSlop={4}
                    style={styles.back}
                >
                    <Icon name="chevronLeft" size={24} tone="actionText" />
                </Pressable>
            )}
            <View onLayout={host?.headingLayout} style={[styles.titleBlock, hasRow ? styles.underRow : null]}>
                <Text
                    ref={heading}
                    accessibilityRole="header"
                    style={[nativeTokens.type.largeTitle[containerClass], { color: colors.ink }]}
                >
                    {title}
                </Text>
                {subtitle === undefined ? null : (
                    <Text numberOfLines={1} style={[nativeTokens.type.meta, { color: colors.inkMuted }]}>
                        {subtitle}
                    </Text>
                )}
            </View>
            {action === undefined ? null : actionOf(action)}
            {afterTitle}
            {segments === undefined ? null : <View style={styles.segments}>{segments}</View>}
        </View>
    );
};

const styles = StyleSheet.create({
    header: { position: 'relative', paddingBottom: nativeTokens.spacing[2] },
    back: {
        position: 'absolute',
        top: 0,
        start: 0,
        width: ROW_HEIGHT,
        height: ROW_HEIGHT,
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 1,
    },
    titleBlock: { gap: nativeTokens.spacing[1] },
    underRow: { paddingTop: ROW_HEIGHT },
    action: {
        position: 'absolute',
        top: 0,
        end: 0,
        height: ROW_HEIGHT,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1,
    },
    controls: { flexDirection: 'row', gap: nativeTokens.spacing[2] },
    segments: { marginTop: nativeTokens.spacing[3] },
});
