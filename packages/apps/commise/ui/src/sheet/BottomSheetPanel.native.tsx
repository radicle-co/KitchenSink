/**
 * @module @commise/ui/sheet — the native sheet's skeleton, a bottom-anchored panel (native only: the web sheet's
 * panel is `SheetPanel.tsx`, a different shape with different props): the title row with Close, the toolbar, the scroll region
 * and the footer (`docs/design/ingredientSpecialization.md` §S8.1).
 *
 * It alone applies the collapse. On native, focus is not read: a sheet with a toolbar holds no other text input
 * (`SheetProps.children`), so an open keyboard in such a sheet means focus is in the toolbar's controls. Collapsed,
 * the title is visually hidden (the dialog is still named by it), the heading moves into the title row, and the
 * footer hides. ⛔ Close and the controls never change position in the tree, so the focused input never remounts.
 *
 * The footer is pinned below the scroll region until the title row and the footer together take more than half the
 * sheet (`isFooterUnpinned`, owner ruling on I7); past that it becomes the scroll region's last child and scrolls with
 * the content, while Close stays pinned in the title row. Heights come from `onLayout` (`usePinnedFooter`, `@commise/ui/layout`). ⚠️ Moving
 * the footer remounts it, so a screen-reader cursor resting on `Done` is lost when a rotation or the keyboard flips
 * the decision; React Native has no sticky footer in a plain `ScrollView` that would keep the node in place.
 *
 * It owns the device insets: the whole sheet by the part of each side inset it reaches (`sheetSideInsetPadding`); the
 * footer by the bottom inset, or, with no footer, the end of the scroll region. The top inset is the backdrop's. A downward swipe on the title row or the toolbar's
 * heading row dismisses it; the scroll region keeps its own scrolling.
 *
 * A presentational component: it reads the device's insets, width and keyboard, and holds no domain state.
 *
 * @pattern Template Method — the fixed chrome, with host-supplied steps (heading, controls, children, footer)
 */
import type { FC, ReactNode } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { visuallyHidden } from '../accessibility/visuallyHidden.native.js';
import { useScreenReaderFocusOnSignal } from '../screenReaderFocus/useScreenReaderFocusOnSignal.native.js';
import { palette } from '../tokens/colors.js';
import { displayFontFace, fontSize, radius, spacing } from '../tokens/scale.js';
import { isToolbarCollapsed } from './onScreenKeyboard.js';
import type { SheetProps } from './props.js';
import { SHEET_EDGE_PADDING_DP, sheetSideInsetPadding, sheetWidthStyle } from './sheetPresentation.js';
import { usePinnedFooter } from '../layout/usePinnedFooter.native.js';
import { useKeyboardShown } from '../layout/useKeyboardShown.native.js';
import { useSwipeToDismiss } from './useSwipeToDismiss.native.js';

export interface BottomSheetPanelProps extends Pick<
    SheetProps,
    'title' | 'closeLabel' | 'size' | 'toolbar' | 'footer'
> {
    readonly children: ReactNode;
    /** Advances each time the Modal shows; the title takes screen-reader focus on each advance. */
    readonly focusSignal: number;
    /** The platform's reduce-motion answer, for the swipe's snap-back. */
    readonly reduceMotion: boolean | undefined;
    readonly onClose: () => void;
}

export const BottomSheetPanel: FC<BottomSheetPanelProps> = ({
    title,
    closeLabel,
    size,
    toolbar,
    footer,
    children,
    focusSignal,
    reduceMotion,
    onClose,
}) => {
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const keyboardShown = useKeyboardShown();
    const collapsed = toolbar !== undefined && isToolbarCollapsed(keyboardShown, true);
    const titleRef = useScreenReaderFocusOnSignal<Text>(focusSignal);
    const { panHandlers, translateY } = useSwipeToDismiss(onClose, reduceMotion);
    const pinning = usePinnedFooter();
    // With a keyboard open, the keyboard, not the navigation bar, sits under the sheet: its inset is wasted space.
    const endPadding = { paddingBottom: SHEET_EDGE_PADDING_DP + (keyboardShown ? 0 : insets.bottom) };
    // ONE footer view, placed below the scroll region while pinned and as its last child once unpinned. It carries the
    // bottom inset in both places, and reports its height from either, so the decision reads the same footer.
    const footerView =
        footer === undefined || collapsed ? null : (
            <View style={[styles.footer, endPadding]} onLayout={pinning.onFooterLayout}>
                {footer}
            </View>
        );

    return (
        <Animated.View
            role="dialog"
            aria-modal
            style={[
                styles.sheet,
                sheetWidthStyle(width),
                size === 'full' ? styles.full : styles.content,
                {
                    paddingLeft: sheetSideInsetPadding(width, insets.left),
                    paddingRight: sheetSideInsetPadding(width, insets.right),
                    transform: [{ translateY }],
                },
            ]}
            onLayout={pinning.onFrameLayout}
        >
            <View style={styles.titleRow} {...panHandlers} onLayout={pinning.onTopLayout}>
                <View style={styles.titleBox}>
                    <Text ref={titleRef} accessibilityRole="header" style={collapsed ? visuallyHidden : styles.title}>
                        {title}
                    </Text>
                    {collapsed ? toolbar.heading : null}
                </View>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={closeLabel}
                    onPress={onClose}
                    style={styles.close}
                >
                    <Text aria-hidden style={styles.closeGlyph}>
                        ×
                    </Text>
                </Pressable>
            </View>
            {toolbar === undefined ? null : (
                <View style={styles.toolbar}>
                    <View {...panHandlers}>{collapsed ? null : toolbar.heading}</View>
                    {toolbar.controls}
                </View>
            )}
            <ScrollView keyboardShouldPersistTaps="handled">
                <View style={[styles.scrollContent, footer === undefined ? endPadding : null]}>{children}</View>
                {pinning.unpinned ? footerView : null}
            </ScrollView>
            {pinning.unpinned ? null : footerView}
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    sheet: {
        backgroundColor: palette.white,
        borderTopLeftRadius: radius.lg,
        borderTopRightRadius: radius.lg,
        overflow: 'hidden',
    },
    content: { maxHeight: '100%' },
    full: { height: '100%' },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingLeft: SHEET_EDGE_PADDING_DP,
        paddingRight: spacing[1],
        paddingTop: spacing[1],
    },
    titleBox: { flex: 1, minWidth: 0, paddingTop: spacing[3] },
    title: { fontFamily: displayFontFace.semibold, fontSize: fontSize.headingMd, color: palette.charcoal },
    close: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    closeGlyph: { fontSize: 24, lineHeight: 24, color: palette.slate },
    toolbar: { paddingHorizontal: SHEET_EDGE_PADDING_DP, paddingTop: spacing[2], gap: spacing[2] },
    scrollContent: {
        paddingHorizontal: SHEET_EDGE_PADDING_DP,
        paddingTop: spacing[2],
        paddingBottom: SHEET_EDGE_PADDING_DP,
    },
    footer: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: palette.mist,
        paddingHorizontal: SHEET_EDGE_PADDING_DP,
        paddingTop: SHEET_EDGE_PADDING_DP,
    },
});
