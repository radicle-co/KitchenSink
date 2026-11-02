/**
 * @module @commise/ui/horizontal-scroller — the native design-system {@link HorizontalScroller}
 * (`docs/design/uiOverhaul/horizontalScrollHint.md`).
 *
 * A horizontal `ScrollView` that keeps the platform's own scroll indicator (iOS and Android show it only while the
 * reader scrolls), a 16 dp gradient over its inline-end edge into the surface colour while more lies ahead, and a
 * decorative chevron while the content overflows and the scroller rests at its start. React Native has no CSS mask, so
 * the fade is a gradient to the colour behind the scroller: say which with `surface`.
 *
 * The chevron has a 24 dp COLUMN of its own beside the scroller while the content overflows, so it never sits on the
 * chip at the edge (the old solid band drawn over the scroller hid that chip's last characters). The column stays for
 * as long as the content overflows and only the chevron's opacity changes, so nothing reflows on the first scroll.
 * Overflow is read against the box around the scroller AND the column, which the column does not move, never against
 * the scroller, which it does (`scrollHint.ts`, `outer`).
 *
 * The chevron changes opacity over 150 ms, instantly while the OS reduce-motion preference is on or not yet known.
 *
 * Presentational: props → JSX; the position is read by {@link useScrollHint}.
 *
 * The animated chevron and the gradient are the two parts Tamagui cannot draw yet; they live in `ScrollChevron.native` and `ScrollFade.native`.
 *
 * @pattern Decorator — adds the scroll hint to a scroller that knows nothing of it
 * @pattern Observer — reports where it rests to the owner through `onPosition`
 */
import { I18nManager } from 'react-native';
import type { FC } from 'react';
import { ScrollView, styled, XStack, YStack } from 'tamagui';

import { useTheme } from '../theme/useTheme.native.js';
import type { HorizontalScrollerProps, ScrollerSurface } from './props.js';
import { scrollHintOf } from './scrollHint.js';
import { ScrollChevron } from './ScrollChevron.native.js';
import { ScrollFade } from './ScrollFade.native.js';
import { useScrollHint } from './useScrollHint.native.js';

const GROUND: Readonly<Record<ScrollerSurface, 'canvas' | 'paperOverlay' | 'paper'>> = {
    canvas: 'canvas',
    overlay: 'paperOverlay',
    bar: 'paper',
};

/** The box around the scroller and the chevron's column. It does not shrink, like the React Native `View` it replaces. */
const ScrollerBox = styled(XStack, { name: 'HorizontalScrollerBox', flexShrink: 0 });

/** The scroller and its fade, which sits over its own inline-end edge. */
const ScrollerTrack = styled(YStack, { name: 'HorizontalScrollerTrack', flex: 1, minWidth: 0, position: 'relative' });

/** The 16 dp fade at the scroller's inline-end edge: inert, and on the side the writing direction ends. */
const FadeEdge = styled(YStack, {
    name: 'HorizontalScrollerFade',
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '$4',
    pointerEvents: 'none',

    variants: {
        side: {
            left: { left: 0 },
            right: { right: 0 },
        },
    } as const,
});

/** The chevron's 24 dp column. It stays while the content overflows and only goes when it fits. */
const ChevronColumn = styled(YStack, {
    name: 'HorizontalScrollerChevron',
    flexShrink: 0,
    width: '$5',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',

    variants: {
        gone: {
            true: { display: 'none' },
        },
    } as const,
});

/** The native horizontal scroller. */
export const HorizontalScroller: FC<HorizontalScrollerProps> = ({
    children,
    surface = 'canvas',
    snap,
    regionLabel,
    onPosition,
}) => {
    const { colors } = useTheme();
    const { onLayout, onBoxLayout, onContentSizeChange, onScroll, extent } = useScrollHint(onPosition);
    const hint = scrollHintOf(extent);
    const rtl = I18nManager.getConstants().isRTL;

    return (
        <ScrollerBox onLayout={onBoxLayout}>
            <ScrollerTrack>
                {/* One `scrollsToTop` per screen: a row never takes the iOS status-bar tap from the screen's scroller. */}
                <ScrollView
                    horizontal
                    collapsable={false}
                    scrollsToTop={false}
                    keyboardShouldPersistTaps="handled"
                    scrollEventThrottle={32}
                    {...(regionLabel === undefined ? {} : { role: 'region' as const, 'aria-label': regionLabel })}
                    {...(snap?.kind === 'card'
                        ? {
                              snapToInterval: snap.interval,
                              snapToAlignment: 'start' as const,
                              decelerationRate: 'fast' as const,
                          }
                        : {})}
                    onLayout={onLayout}
                    onContentSizeChange={onContentSizeChange}
                    onScroll={onScroll}
                >
                    {children}
                </ScrollView>
                {hint.fade ? (
                    <FadeEdge aria-hidden side={rtl ? 'left' : 'right'}>
                        <ScrollFade ground={colors[GROUND[surface]]} rtl={rtl} />
                    </FadeEdge>
                ) : null}
            </ScrollerTrack>
            <ChevronColumn aria-hidden gone={!extent.overflows}>
                <ScrollChevron measured={extent.measured} show={hint.chevron} />
            </ChevronColumn>
        </ScrollerBox>
    );
};
