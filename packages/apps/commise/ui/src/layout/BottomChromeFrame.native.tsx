/**
 * @module @commise/ui/layout — `BottomChromeFrame` and `useBottomEdge`: who owns a screen's bottom edge, and how far
 * above the window's foot the screen's own content ends (M1, `docs/design/uiOverhaul/specShellAndLists.md` §S.3).
 *
 * The rule is that whatever is bottom-most owns the safe-area inset. With no footer the frame pads the inset itself;
 * with a footer (the bottom tab bar, which pads the inset itself) the frame adds nothing. Either way it publishes the
 * distance from the window's foot to the content's foot, so a control that lives in a different coordinate space —
 * the create menu, which opens in a modal WINDOW and positions itself from the window's foot — lines up with the
 * content rather than opening on top of the bar. The footer's height is MEASURED, not assumed: the bar's height
 * depends on the text size.
 *
 * The content is always the frame's first child, so it keeps its node (and a focused field its keyboard) when the
 * footer comes and goes. Presentational: the only state it holds is the footer's measured height. Native only, like
 * the rest of this export.
 *
 * @pattern Slot — the caller hands the footer in; the frame decides where it sits and who owns the inset.
 * @pattern Service Locator — React context publishes the bottom edge, resolved by any descendant through
 *     `useBottomEdge`, with the bare safe-area inset as the answer when no frame is above (react-navigation's
 *     `BottomTabBarHeightContext` is the same shape).
 */
import { createContext, useContext, useState, type FC, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** The bottom edge a frame publishes; `null` when no frame is above. */
const BottomEdgeContext = createContext<number | null>(null);

/**
 * How far above the window's foot the current screen's content ends, in dp.
 *
 * @returns The footer's measured height inside a frame with a footer, otherwise the bottom safe-area inset.
 */
export function useBottomEdge(): number {
    const framed = useContext(BottomEdgeContext);
    const inset = useSafeAreaInsets().bottom;

    return framed ?? inset;
}

/** Props for {@link BottomChromeFrame}. */
export interface BottomChromeFrameProps {
    /** The screen content. It should fill the frame (`flex: 1`). */
    readonly children: ReactNode;
    /** Chrome pinned under the content, such as the bottom tab bar. It owns the bottom inset when present. */
    readonly footer?: ReactElement;
}

/** A screen frame that owns the bottom edge: the content, then an optional footer. */
export const BottomChromeFrame: FC<BottomChromeFrameProps> = ({ children, footer }) => {
    const insets = useSafeAreaInsets();
    const inset = insets.bottom;
    const [footerHeight, setFooterHeight] = useState(0);
    const hasFooter = footer !== undefined;

    return (
        <BottomEdgeContext.Provider value={hasFooter ? footerHeight : inset}>
            <View style={[styles.frame, { paddingBottom: hasFooter ? 0 : inset }]}>
                {children}
                {hasFooter ? (
                    // The footer spans the window's width, so on a phone held sideways it clears a side cutout or
                    // navigation bar itself; the content above it pads its own sides.
                    <View
                        onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
                        style={{ paddingLeft: insets.left, paddingRight: insets.right }}
                    >
                        {footer}
                    </View>
                ) : null}
            </View>
        </BottomEdgeContext.Provider>
    );
};

const styles = StyleSheet.create({
    frame: { flex: 1 },
});
