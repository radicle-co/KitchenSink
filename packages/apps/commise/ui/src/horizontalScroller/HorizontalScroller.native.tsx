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
 * @pattern Decorator — adds the scroll hint to a scroller that knows nothing of it
 * @pattern Observer — reports where it rests to the owner through `onPosition`
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type FC } from 'react';
import { Animated, Easing, I18nManager, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '../icon/Icon.native.js';
import { useReduceMotion } from '../motion/useReduceMotion.native.js';
import { useTheme } from '../theme/useTheme.native.js';
import type { HorizontalScrollerProps, ScrollerSurface } from './props.js';
import { scrollHintOf } from './scrollHint.js';
import { useScrollHint } from './useScrollHint.native.js';

/** The fade at the scroller's own inline-end edge, and the chevron's column. */
const FADE_WIDTH = 16;
const CHEVRON_WIDTH = 24;

/** How long the chevron takes to appear or go. */
const CHEVRON_MS = 150;

const GROUND: Readonly<Record<ScrollerSurface, 'canvas' | 'paperOverlay' | 'paper'>> = {
    canvas: 'canvas',
    overlay: 'paperOverlay',
    bar: 'paper',
};

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
    const reduceMotion = useReduceMotion();
    // Created once and never replaced, like `EnterTransition`'s progress: state is its home, not a ref.
    const [opacity] = useState(() => new Animated.Value(0));
    const rtl = I18nManager.getConstants().isRTL;
    const ground = colors[GROUND[surface]];

    useEffect(() => {
        // Nothing has been measured, so nothing has shown: the chevron is still at its initial 0.
        if (!extent.measured) {
            return undefined;
        }

        const toValue = hint.chevron ? 1 : 0;

        if (reduceMotion !== false) {
            opacity.setValue(toValue);

            return undefined;
        }

        const animation = Animated.timing(opacity, {
            toValue,
            duration: CHEVRON_MS,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: Platform.OS !== 'web',
        });

        animation.start();

        return () => animation.stop();
    }, [extent.measured, hint.chevron, reduceMotion, opacity]);

    const side = rtl ? styles.left : styles.right;

    return (
        <View style={styles.box} onLayout={onBoxLayout}>
            <View style={styles.track}>
                {/* One `scrollsToTop` per screen: a row never takes the iOS status-bar tap from the screen's scroller. */}
                <ScrollView
                    horizontal
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
                    <View aria-hidden style={[styles.edge, styles.inert, side, { width: FADE_WIDTH }]}>
                        <LinearGradient
                            colors={[`${ground}00`, ground]}
                            locations={[0, 1]}
                            start={{ x: rtl ? 1 : 0, y: 0 }}
                            end={{ x: rtl ? 0 : 1, y: 0 }}
                            style={styles.gradient}
                        />
                    </View>
                ) : null}
            </View>
            <Animated.View
                aria-hidden
                style={[styles.inert, styles.chevron, extent.overflows ? null : styles.gone, { opacity }]}
            >
                <Icon name="chevronRight" size={20} tone="inkMuted" />
            </Animated.View>
        </View>
    );
};

const styles = StyleSheet.create({
    box: { flexDirection: 'row' },
    track: { flex: 1, minWidth: 0, position: 'relative' },
    edge: { position: 'absolute', top: 0, bottom: 0 },
    right: { right: 0 },
    left: { left: 0 },
    inert: { pointerEvents: 'none' },
    gradient: { flex: 1 },
    chevron: { width: CHEVRON_WIDTH, alignItems: 'center', justifyContent: 'center' },
    gone: { display: 'none' },
});
