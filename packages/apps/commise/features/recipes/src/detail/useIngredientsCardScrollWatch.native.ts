'use client';

/**
 * @module @commise/features-recipes — `useIngredientsCardScrollWatch`: whether the page has scrolled the ingredients card
 * wholly above the top of the screen, which is when the pinned ingredients bar is drawn (owner ruling R1,
 * `docs/plans/2026-11-08-pinnedIngredientsBar.md`). The native twin of `useIngredientsCardScrolledPast.ts`.
 *
 * The card's `onLayout` gives its bottom edge in the scroll content (it is a direct child of the content, so `y` is
 * content-relative: the editor's section index does the same), and the scroll view's `onScroll` gives the offset. The
 * answer is a boolean in state, set on every scroll event but re-rendering only when it flips.
 *
 * Both events recompute the answer from the other's last value, so a card that changes height while the page is still (a
 * rotation, a text-size change, a refresh, a notice above it) is re-read at once and the bar never shows over the card. The
 * two last values live in a ref written ONLY inside the two handlers, never during render (a previous-value latch, as
 * `ScrollHost` keeps one).
 *
 * @pattern Adapter over React Native's layout and scroll events — the handlers are the handle; the latch is the one place
 *     the two events meet.
 */
import { useCallback, useRef, useState } from 'react';

/** A layout event, with the only fields this hook reads (so `LayoutChangeEvent` fits it). */
interface CardLayoutEvent {
    readonly nativeEvent: { readonly layout: { readonly y: number; readonly height: number } };
}

/** A scroll event, with the only field this hook reads (so `NativeScrollEvent`'s event fits it). */
interface PageScrollEvent {
    readonly nativeEvent: { readonly contentOffset: { readonly y: number } };
}

/** What {@link useIngredientsCardScrollWatch} gives the shell. */
export interface IngredientsCardScrollWatch {
    /** The card's bottom edge is at or above the top inset. */
    readonly scrolledPast: boolean;
    /** The card's `onLayout`. */
    readonly onCardLayout: (event: CardLayoutEvent) => void;
    /** The scroll view's `onScroll`. */
    readonly onScroll: (event: PageScrollEvent) => void;
}

/**
 * Watch the ingredients card through the page's layout and scroll events.
 *
 * @param topInset - The top of the screen the card must clear, in points: the status bar's safe-area inset.
 * @returns Whether the card has scrolled past, and the two handlers that feed it.
 */
export function useIngredientsCardScrollWatch(topInset: number): IngredientsCardScrollWatch {
    const [scrolledPast, setScrolledPast] = useState(false);
    // The last card bottom and page offset, each written only inside its handler.
    const seen = useRef<{ cardBottom: number | undefined; offset: number }>({ cardBottom: undefined, offset: 0 });
    const settle = useCallback(() => {
        const { cardBottom, offset } = seen.current;

        setScrolledPast(cardBottom !== undefined && offset + topInset >= cardBottom);
    }, [topInset]);
    const onCardLayout = useCallback(
        (event: CardLayoutEvent) => {
            const { y, height } = event.nativeEvent.layout;

            seen.current.cardBottom = y + height;
            settle();
        },
        [settle],
    );
    const onScroll = useCallback(
        (event: PageScrollEvent) => {
            seen.current.offset = event.nativeEvent.contentOffset.y;
            settle();
        },
        [settle],
    );

    return { scrolledPast, onCardLayout, onScroll };
}
