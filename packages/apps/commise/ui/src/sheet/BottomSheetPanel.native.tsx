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
import { useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { TamaguiTextElement } from 'tamagui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { visuallyHidden } from '../accessibility/visuallyHidden.native.js';
import { Icon } from '../icon/Icon.native.js';
import { useScreenReaderFocusOnSignal } from '../screenReaderFocus/useScreenReaderFocusOnSignal.native.js';
import { Text } from '../text/Text.native.js';
import { surfaceFill } from '../surfaceTone/surfaceFill.js';
import { ToneScope } from '../surfaceTone/ToneScope.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import { radius, spacing } from '../tokens/scale.js';
import { isToolbarCollapsed } from './onScreenKeyboard.js';
import type { SheetProps } from './props.js';
import {
    SHEET_EDGE_PADDING_DP,
    SHEET_HANDLE,
    sheetIsCentred,
    sheetSideInsetPadding,
    sheetWidthStyle,
} from './sheetPresentation.js';
import { usePinnedFooter } from '../layout/usePinnedFooter.native.js';
import { useKeyboardShown } from '../layout/useKeyboardShown.native.js';
import { SheetScrollRegion } from './SheetScrollRegion.native.js';
import { useSwipeToDismiss } from './useSwipeToDismiss.native.js';

export interface BottomSheetPanelProps extends Pick<
    SheetProps,
    'title' | 'closeLabel' | 'size' | 'presentation' | 'toolbar' | 'footer'
> {
    readonly children: ReactNode;
    /** Advances each time the Modal shows; the title takes screen-reader focus on each advance. */
    readonly focusSignal: number;
    /** The platform's reduce-motion answer, for the swipe's snap-back. */
    readonly reduceMotion: boolean | undefined;
    /** Where the scroll region starts, in dp: the position the cook left it at when the sheet was set aside. 0: the top. */
    readonly restoreScrollY: number;
    /** The cook let go of the scroll region at `y`. */
    readonly onScrollSettled: (y: number) => void;
    /** The Close control. */
    readonly onClose: () => void;
    /** A swipe down on the handle and the title row went past its threshold. */
    readonly onSwipeDismiss: () => void;
}

export const BottomSheetPanel: FC<BottomSheetPanelProps> = ({
    title,
    closeLabel,
    size,
    presentation = 'sheet',
    toolbar,
    footer,
    children,
    focusSignal,
    reduceMotion,
    restoreScrollY,
    onScrollSettled,
    onClose,
    onSwipeDismiss,
}) => {
    const insets = useSafeAreaInsets();
    const theme = useTheme();
    const { colors } = theme;
    const { width } = useWindowDimensions();
    const keyboardShown = useKeyboardShown();
    const collapsed = toolbar !== undefined && isToolbarCollapsed(keyboardShown, true);
    const titleRef = useScreenReaderFocusOnSignal<TamaguiTextElement>(focusSignal);
    const { panHandlers, translateY } = useSwipeToDismiss(onSwipeDismiss, reduceMotion);
    const pinning = usePinnedFooter();
    // The one node handle: putting a scroll position back has no declarative form.
    const scroller = useRef<ScrollView>(null);

    // The position the panel opened with. Held in state so a later change of the prop (the cook's own scrolling is reported
    // back as it settles) is not read again: it must not be fought.
    const [initialScrollY] = useState(restoreScrollY);

    // @sideEffect Puts the scroll region back where the cook left it, once, when the panel appears.
    useEffect(() => {
        if (initialScrollY > 0) {
            scroller.current?.scrollTo({ y: initialScrollY, animated: false });
        }
    }, [initialScrollY]);
    // With a keyboard open, the keyboard, not the navigation bar, sits under the sheet: its inset is wasted space.
    const endPadding = { paddingBottom: SHEET_EDGE_PADDING_DP + (keyboardShown ? 0 : insets.bottom) };
    // ONE footer view, placed below the scroll region while pinned and as its last child once unpinned. It carries the
    // bottom inset in both places, and reports its height from either, so the decision reads the same footer.
    const footerView =
        footer === undefined || collapsed ? null : (
            <View
                style={[styles.footer, endPadding, { borderTopColor: colors.lineDivider }]}
                onLayout={pinning.onFooterLayout}
            >
                {footer}
            </View>
        );

    return (
        <ToneScope tone="paperOverlay">
            <Animated.View
                role="dialog"
                aria-modal
                style={[
                    styles.sheet,
                    { backgroundColor: surfaceFill(theme, 'paperOverlay') },
                    sheetWidthStyle(width, presentation),
                    sheetIsCentred(presentation, width) ? styles.centredCard : null,
                    size === 'content' ? styles.content : styles.full,
                    {
                        paddingLeft: sheetSideInsetPadding(width, insets.left, presentation),
                        paddingRight: sheetSideInsetPadding(width, insets.right, presentation),
                        transform: [{ translateY }],
                    },
                ]}
                onLayout={pinning.onFrameLayout}
            >
                {/* The swipe zone: the grab handle and the title row, so a drag that starts on the handle dismisses with the
                same thresholds. The handle is decorative; the labelled Close button stays the accessible way out
                (WCAG 2.5.7). */}
                <View {...panHandlers} onLayout={pinning.onTopLayout}>
                    <View
                        aria-hidden
                        importantForAccessibility="no-hide-descendants"
                        style={[styles.handle, { backgroundColor: colors.lineDivider }]}
                    />
                    <View style={styles.titleRow}>
                        <View style={styles.titleBox}>
                            <Text
                                ref={titleRef}
                                role="heading"
                                typeRole="barTitle"
                                {...(collapsed ? { style: visuallyHidden } : {})}
                            >
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
                            <Icon name="x" size={24} tone="inkMuted" />
                        </Pressable>
                    </View>
                </View>
                {toolbar === undefined ? null : (
                    <View style={styles.toolbar}>
                        <View {...panHandlers}>{collapsed ? null : toolbar.heading}</View>
                        {toolbar.controls}
                    </View>
                )}
                <SheetScrollRegion>
                    <ScrollView
                        ref={scroller}
                        keyboardShouldPersistTaps="handled"
                        onScrollEndDrag={(event) => onScrollSettled(event.nativeEvent.contentOffset.y)}
                        onMomentumScrollEnd={(event) => onScrollSettled(event.nativeEvent.contentOffset.y)}
                    >
                        <View style={[styles.scrollContent, footer === undefined ? endPadding : null]}>{children}</View>
                        {pinning.unpinned ? footerView : null}
                    </ScrollView>
                </SheetScrollRegion>
                {pinning.unpinned ? null : footerView}
            </Animated.View>
        </ToneScope>
    );
};

const styles = StyleSheet.create({
    sheet: {
        borderTopLeftRadius: radius.xl,
        borderTopRightRadius: radius.xl,
        overflow: 'hidden',
    },
    content: { maxHeight: '100%' },
    // A centred dialog rounds all four corners: it floats clear of the screen's foot.
    centredCard: { borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl },
    full: { height: '100%' },
    // `radius.full` draws the same pill the owner's 3 pt radius draws on a 5 pt bar, and stays on the radius scale.
    handle: { ...SHEET_HANDLE, alignSelf: 'center', borderRadius: radius.full },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingLeft: SHEET_EDGE_PADDING_DP,
        paddingRight: spacing[1],
    },
    titleBox: { flex: 1, minWidth: 0, paddingTop: spacing[3] },
    close: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    toolbar: { paddingHorizontal: SHEET_EDGE_PADDING_DP, paddingTop: spacing[2], gap: spacing[2] },
    scrollContent: {
        paddingHorizontal: SHEET_EDGE_PADDING_DP,
        paddingTop: spacing[2],
        paddingBottom: SHEET_EDGE_PADDING_DP,
    },
    footer: {
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: SHEET_EDGE_PADDING_DP,
        paddingTop: SHEET_EDGE_PADDING_DP,
    },
});
