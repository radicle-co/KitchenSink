/**
 * @module @commise/features-recipes — the scroll view the Recipes list renders (native), with the host's scroll offset
 * attached to it natively.
 *
 * FlashList renders its scroller through `Animated.createAnimatedComponent` and lets a screen supply it with
 * `renderScrollComponent`. This is that scroller: an `Animated.ScrollView` whose `onScroll` is an `Animated.event` on the
 * `ScrollHost`'s `scrollY` (`useNativeDriver`), with FlashList's OWN handler as the listener, so recycling and viewability
 * run as before and FlashList still calls the host's plain `bind.onScroll`. The offset drives the pinned search field on the
 * native thread, with no JS per frame beyond the handlers that already ran.
 *
 * It replaces `AnimatedFlashList`: wrapping FlashList itself in `Animated.createAnimatedComponent` threw "Maximum update
 * depth exceeded" on iOS and Android (the stack started `at FlashList ... at Animated(Anonymous)`).
 *
 * A render function FlashList calls inside its own scroller component, so hooks are legal here; FlashList memoises the
 * scroller on this function's IDENTITY, so it must stay a module-level constant, never an inline function.
 *
 * @pattern Adapter — a host-fed Animated scroll view behind FlashList's `renderScrollComponent` seam
 */
import { useOptionalScrollHost } from '@commise/ui/scroll-host';
import { useMemo, type ReactElement } from 'react';
import { Animated, type ScrollViewProps } from 'react-native';

/**
 * Orchestration: reads the host's scroll offset and builds the one native-driven `Animated.event` over it (a hook and an Animated
 * node), then hands the Animated scroll view its props. It holds no ref.
 *
 * @param props - What FlashList hands its scroller: its `onScroll` handler, its ref and the host's other scroll props.
 * @returns The Animated scroll view, with the host's offset attached when a `ScrollHost` is above.
 */
export function HostAnimatedScroll(props: ScrollViewProps): ReactElement {
    const scrollY = useOptionalScrollHost()?.scrollY;
    const { onScroll } = props;
    // Built once per (offset, handler): a new event object re-attaches the native listener.
    const event = useMemo(
        () =>
            scrollY === undefined
                ? onScroll
                : Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
                      useNativeDriver: true,
                      ...(onScroll === undefined ? {} : { listener: onScroll }),
                  }),
        [scrollY, onScroll],
    );

    // `handled`: a control under the finger takes the tap while the keyboard is up (the search field is open above this list).
    return (
        <Animated.ScrollView
            keyboardShouldPersistTaps="handled"
            {...props}
            {...(event === undefined ? {} : { onScroll: event })}
        />
    );
}
