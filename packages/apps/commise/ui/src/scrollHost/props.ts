/**
 * @module @commise/ui/scroll-host — the shared contract of the design-system `ScrollHost`
 * (`docs/architecture/uiOverhaulBlueprint.md` A7): ONE host per screen over the screen's ONE vertical scroller. It
 * reports what the chrome reacts to — whether the large title has scrolled under the top row (`condensed`), the scroll
 * direction and the top (the floating button), the current section (slices 6-7) — and moves the scroller (`scrollToTop`,
 * `scrollToSection`). Consumers only read; nothing else holds the scroller.
 *
 * - **Native:** the screen's scroller takes `bind` (a render prop), so `ScrollView`, `FlatList` and `FlashList` all
 *   work the same; the heading and each section report their layout through `headingLayout`/`sectionLayout`, so they
 *   must be DIRECT children of the content container (`onLayout` `y` is relative to the parent). `handle` is the same
 *   scroller, for React Navigation's `useScrollToTop`, so the one scroller has one ref.
 * - **Web:** the document scrolls. The heading and sections are found by their element ids, which the accessibility
 *   contract already requires, so the web leaf holds no ref; `bind`, `headingLayout`, `sectionLayout` and `handle` are
 *   inert there.
 */
import type { ReactNode, RefObject } from 'react';

import type { CurrentChangeListener } from './currentChange.js';

/** A scroller this host can move: a `ScrollView`, or a `FlatList`/`FlashList`. */
export type ScrollTarget =
    | { scrollTo(options: { x?: number; y?: number; animated?: boolean }): void }
    | { scrollToOffset(options: { offset: number; animated?: boolean }): void };

/** The layout event a heading or section reports (React Native's `onLayout`, structurally). */
export interface LayoutReport {
    readonly nativeEvent: { readonly layout: { readonly y: number; readonly height: number } };
}

/** The scroll event the native scroller reports (React Native's `onScroll`, structurally). */
export interface ScrollReport {
    readonly nativeEvent: {
        readonly contentOffset: { readonly y: number };
        readonly layoutMeasurement: { readonly height: number };
        readonly contentSize: { readonly height: number };
    };
}

/** What the screen's one scroller spreads onto itself (native). */
export interface ScrollBind {
    readonly ref: (node: ScrollTarget | null) => void;
    readonly onScroll: (event: ScrollReport) => void;
    /** The cook began a drag: it releases a section a jump is holding (a programmatic scroll never drags). */
    readonly onScrollBeginDrag: () => void;
    /**
     * A scroll's momentum ended. It never releases a held section by itself (Android reports one for the jump's own
     * `scrollTo`); it arms the release, which the next scroll performs.
     */
    readonly onMomentumScrollEnd: () => void;
    readonly scrollEventThrottle: 16;
}

/** What a screen's chrome reads from its host. */
export interface ScrollHostApi {
    /** Whether the large title's heading has scrolled under the top row: the condensed bar shows. */
    readonly condensed: boolean;
    /** Whether the last scroll moved down the page. */
    readonly scrollingDown: boolean;
    /** Whether the scroller is at its top. */
    readonly atTop: boolean;
    /** The section the reader is in, if the screen has sections. */
    readonly current: string | undefined;
    /**
     * Subscribes to the scroll spy's section changes, raised from the scroll handler. For a consumer that ACTS on a
     * change; one that draws the section reads {@link current}. The function is stable for the host's life.
     *
     * @returns The unsubscribe.
     */
    readonly onCurrentChange: (listener: CurrentChangeListener) => () => void;
    /** How many viewports down the reader is, to the quarter: "Back to top" waits for four. */
    readonly viewportsDown: number;
    /** How many viewports tall the page is, to the quarter. */
    readonly pageViewports: number;
    /** Scroll to the top: instant under reduced motion. */
    readonly scrollToTop: () => void;
    /**
     * Scroll a section to the activation line: instant under reduced motion. The ONE section jump; `SectionSwitch`
     * calls it. Web also moves focus to the element (it carries `tabIndex={-1}`) and records the hash in place. The
     * section is then {@link current} until the cook scrolls again, even when the page is too short for it to reach the
     * line.
     */
    readonly scrollToSection: (id: string) => void;
    /** The heading's layout report (native). Inert on web, which finds the heading by `headingId`. */
    readonly headingLayout: (event: LayoutReport) => void;
    /** A section's layout report (native). Inert on web, which finds sections by id. */
    readonly sectionLayout: (id: string) => (event: LayoutReport) => void;
    /** The scroller, for React Navigation's `useScrollToTop` (native). Always empty on web. */
    readonly handle: RefObject<ScrollTarget | null>;
}

/** The cross-platform `ScrollHost` contract. */
export interface ScrollHostProps {
    /** The page's H1 id. Web watches it to decide `condensed`; native reads `headingLayout` instead. */
    readonly headingId?: string;
    /** The section ids, in page order, for `current` and `scrollToSection`. */
    readonly sections?: readonly string[];
    /** How far below the scroller's top the activation line sits, px: under a sticky bar, say. Defaults to 0. */
    readonly activationOffset?: number;
    /** The screen. On native, a function of the scroller's `bind`; on web the document scrolls and `bind` is unused. */
    readonly children: ReactNode | ((bind: ScrollBind) => ReactNode);
}

/** The scroll state the host derives from one position. */
export interface ScrollState {
    readonly condensed: boolean;
    readonly scrollingDown: boolean;
    readonly atTop: boolean;
    readonly current: string | undefined;
    readonly viewportsDown: number;
    readonly pageViewports: number;
}

/** A position, the one before it, and the page's geometry. */
export interface ScrollSample {
    readonly y: number;
    readonly previousY: number;
    /** The y at which the heading has fully scrolled away, or undefined before it reports. */
    readonly headingBottom: number | undefined;
    readonly atEnd: boolean;
    /** The scroller's visible height. */
    readonly viewportHeight: number;
    /** The scroller's content height. */
    readonly contentHeight: number;
}

/**
 * The movement under which a position change does not flip the direction: a rubber-band bounce or a sub-pixel jitter
 * must not make the floating button flicker.
 */
export const DIRECTION_DEAD_ZONE_PX = 4;

/**
 * The step depth is reported in, in viewports. Coarse on purpose: a finer depth would re-render the screen on every
 * frame of a scroll, and nothing reads depth more finely than "four screens down".
 */
export const DEPTH_STEP_VIEWPORTS = 0.25;
