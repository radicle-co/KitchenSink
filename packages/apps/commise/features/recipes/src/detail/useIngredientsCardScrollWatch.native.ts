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
 * shortcut: the answer is recomputed on a scroll event, not on a re-layout, so a card whose height changes while the page is
 * still (a rotation, a text-size change, a refresh that changes the ingredients, a notice above it) keeps its old answer
 * until the next scroll event. A scroll event follows any touch of the page, so the bar is wrong only until the cook next
 * moves it. Recompute on layout too, with the last offset as a latch (as `ScrollHost` keeps one), if a device finding asks.
 */
import { useCallback, useState } from 'react';

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
    const [cardBottom, setCardBottom] = useState<number | undefined>(undefined);
    const [scrolledPast, setScrolledPast] = useState(false);
    const onCardLayout = useCallback((event: CardLayoutEvent) => {
        const { y, height } = event.nativeEvent.layout;

        setCardBottom(y + height);
    }, []);
    const onScroll = useCallback(
        (event: PageScrollEvent) => {
            if (cardBottom !== undefined) {
                setScrolledPast(event.nativeEvent.contentOffset.y + topInset >= cardBottom);
            }
        },
        [cardBottom, topInset],
    );

    return { scrolledPast, onCardLayout, onScroll };
}
