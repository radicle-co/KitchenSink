/**
 * @module @commise/ui/scroll-host — the native design-system {@link ScrollHost} (`docs/architecture/uiOverhaulBlueprint.md`
 * A7). It holds the screen's ONE vertical scroller, hands the screen `bind` for it, and publishes the scroll state its
 * chrome reads (see `props.ts`).
 *
 * The scroller arrives through a callback ref into STATE (`bind.ref`), so the host holds its imperative handle without a
 * `useRef`: `scrollTo`/`scrollToOffset` is the only way to move a React Native scroller (the precedent is
 * `mobile/src/hooks/useScrollResetOnChange.ts`). `handle` wraps that same scroller for React Navigation's
 * `useScrollToTop`, so the one scroller has one handle.
 *
 * ⚠️ It holds TWO refs, sanctioned in `patternRegister.test.ts`'s `REF_MODULES`. `last` is a previous-value latch (the last
 * y, and the scroll spy's last section) read and advanced ONLY inside the scroll handler, never during render. The
 * section half is what lets the handler raise a section change (`onCurrentChange`) as an event, once per change.
 * `lastScroller` is an identity latch, written ONLY in the `bind.ref` callback and never during render: it tells a DIFFERENT
 * scroller replacing the old one (the screen's list remounted) from the same one re-attaching, and only the first resets the
 * offset, the scroll state, a held section and a waiting jump.
 *
 * A jump asked for before its section has reported its layout (a deep link, on mount) lands when that layout arrives.
 * A jump holds `current` on the section it named, even when the page is too short for that section to reach the line,
 * until the cook leaves it: a drag, `scrollToTop`, or any scroll once the jump's own scroll has ended. The jump's
 * scroll ends at its momentum end (Android reports one for a programmatic `scrollTo`) or, for a jump that moved
 * nothing, after {@link JUMP_SETTLE_MS} — the web host's rule, so a screen reader's scroll releases it too.
 *
 * State updates only when a derived fact flips (`nextScrollState` returns the same object otherwise), so a scroll does
 * not re-render the screen every frame.
 *
 * ORCHESTRATION of the screen's scroll: it holds the state its chrome reads and moves the scroller.
 *
 * @pattern Mediator over the screen's one native scroller — the chrome reads, nothing else moves it
 * @pattern Observer — the scroll spy, through the one `currentSectionOf` algorithm
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FC, type ReactNode } from 'react';
import { Animated } from 'react-native';

import { useReduceMotion } from '../motion/useReduceMotion.native.js';
import type { LayoutReport, ScrollBind, ScrollHostApi, ScrollHostProps, ScrollReport, ScrollTarget } from './props.js';
import { createCurrentChangeSubject } from './currentChange.js';
import { currentSectionOf } from './currentSection.js';
import { FieldTargetContext } from './fieldTarget.js';
import { ScrollHostContext } from './scrollHostContext.js';
import { INITIAL_SCROLL_STATE, nextScrollState } from './scrollState.js';

/** How close to the end counts as the end, px: a fractional content height never quite reaches it. */
const END_SLOP_PX = 1;

/** How long a jump's own scroll is given to end when it reports no momentum end (a jump that did not move). */
const JUMP_SETTLE_MS = 1_000;

/** The default section list: one array, so an omitted `sections` does not rebuild the scroll handler every render. */
const NO_SECTIONS: readonly string[] = [];

/** A jump's hold: the section it named, and whether the jump's own scroll has ended (so the next scroll releases). */
interface Hold {
    readonly id: string;
    readonly settled: boolean;
}

/** Move a scroller to a y, whichever kind it is. */
function scrollTargetTo(target: ScrollTarget, y: number, animated: boolean): void {
    if ('scrollTo' in target) {
        target.scrollTo({ y, animated });
    } else {
        target.scrollToOffset({ offset: y, animated });
    }
}

/**
 * Calls the screen's render prop with `bind` from a CHILD component, so the host's own render never invokes a function
 * holding its handler (which closes over the `last` latch): the handler runs only when the scroller fires it.
 */
const BoundScreen: FC<{ readonly render: (bind: ScrollBind) => ReactNode; readonly bind: ScrollBind }> = ({
    render,
    bind,
}) => render(bind);

/** The native design-system scroll host. */
export const ScrollHost: FC<ScrollHostProps> = ({ sections = NO_SECTIONS, activationOffset = 0, children }) => {
    const [scroller, setScroller] = useState<ScrollTarget | null>(null);
    const last = useRef<{ y: number; current: string | undefined }>({ y: 0, current: undefined });
    const [changes] = useState(createCurrentChangeSubject);
    // One value for the host's life. The host only owns it: a list that attaches a native scroll event writes the offset
    // into it, and a chrome interpolates from it on the native thread (the search pin).
    const [scrollY] = useState(() => new Animated.Value(0));
    const reduceMotion = useReduceMotion() === true;
    const [state, setState] = useState(INITIAL_SCROLL_STATE);
    const [headingBottom, setHeadingBottom] = useState<number | undefined>(undefined);
    const [tops, setTops] = useState<Readonly<Record<string, number>>>({});
    // The section a jump named, held as current until the cook leaves it.
    const [held, setHeld] = useState<Hold | undefined>(undefined);
    const settling = held !== undefined && !held.settled;
    // A jump asked for before its section reported its layout (a deep link, on mount): it lands when the layout does.
    const [pendingJump, setPendingJump] = useState<string | undefined>(undefined);
    // How many times each field was named by `scrollToField`; the fields read their own count.
    const [targets, setTargets] = useState<Readonly<Record<string, number>>>({});

    const sectionTops = useMemo(
        () => sections.flatMap((id) => (tops[id] === undefined ? [] : [{ id, top: tops[id] }])),
        [sections, tops],
    );

    const onScroll = useCallback(
        (event: ScrollReport): void => {
            const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
            const y = contentOffset.y;
            const atEnd = y + layoutMeasurement.height >= contentSize.height - END_SLOP_PX;
            const sample = {
                y,
                previousY: last.current.y,
                headingBottom,
                atEnd,
                viewportHeight: layoutMeasurement.height,
                contentHeight: contentSize.height,
            };
            const previousSection = last.current.current;
            const section = currentSectionOf(sectionTops, y, activationOffset, atEnd);
            last.current = { y, current: section };

            setState((previous) => nextScrollState(previous, sample, sectionTops, activationOffset));
            // Any scroll once a jump's own scroll has ended is the cook's: it releases the hold.
            setHeld((hold) => (hold?.settled === true ? undefined : hold));

            if (section !== previousSection) {
                changes.notify(section, previousSection);
            }
        },
        [activationOffset, changes, headingBottom, sectionTops],
    );

    // @sideEffect A jump that reports no momentum end (it moved nothing) settles on a timer, as the web host's does.
    useEffect(() => {
        if (!settling) {
            return undefined;
        }

        const timer = setTimeout(
            () => setHeld((hold) => (hold === undefined ? hold : { ...hold, settled: true })),
            JUMP_SETTLE_MS,
        );

        return () => clearTimeout(timer);
    }, [settling, held?.id]);

    const api = useMemo<ScrollHostApi>(
        () => ({
            ...state,
            current: held?.id ?? state.current,
            scrollY,
            onCurrentChange: changes.subscribe,
            scrollToTop: () => {
                setHeld(undefined);

                if (scroller !== null) {
                    scrollTargetTo(scroller, 0, !reduceMotion);
                }
            },
            scrollToSection: (id) => {
                const top = tops[id];

                setHeld({ id, settled: false });

                if (scroller !== null && top !== undefined) {
                    scrollTargetTo(scroller, Math.max(0, top - activationOffset), !reduceMotion);
                } else {
                    setPendingJump(id);
                }
            },
            // A native field is not found by id: it hears that it was named (`FieldTargetContext`) and asks the field
            // reveal host to centre it. The field's own scroll replaces the section jump's, so the jump's hold and its
            // wait for a layout both end here (§16.3).
            scrollToField: (id) => {
                setHeld(undefined);
                setPendingJump(undefined);
                setTargets((previous) => ({ ...previous, [id]: (previous[id] ?? 0) + 1 }));

                return true;
            },
            // Nor by id here: a native field asks the field reveal host (`FieldRevealContext`) to show an arrival.
            revealSpan: () => false,
            // Nor is an element's start found by id: it hears that it was named (`FieldTargetContext`, over ids no field
            // shares) and asks the field reveal host to put its top at the top (`useFieldStartReveal`). Like a named
            // field, its scroll replaces the section jump's, so the jump's hold and its wait for a layout end here. The
            // host cannot know whether an element with that id is mounted, so it always answers `true`.
            scrollToStart: (id) => {
                setHeld(undefined);
                setPendingJump(undefined);
                setTargets((previous) => ({ ...previous, [id]: (previous[id] ?? 0) + 1 }));

                return true;
            },
            headingLayout: (event: LayoutReport) => {
                const { y, height } = event.nativeEvent.layout;
                const bottom = Math.round(y + height);

                // Android re-sends a layout for float noise; a rounded, unchanged value must not cost a commit.
                setHeadingBottom((previous) => (previous === bottom ? previous : bottom));
            },
            sectionLayout: (id) => (event: LayoutReport) => {
                const y = Math.round(event.nativeEvent.layout.y);

                setTops((previous) => (previous[id] === y ? previous : { ...previous, [id]: y }));

                if (pendingJump === id && scroller !== null) {
                    scrollTargetTo(scroller, Math.max(0, y - activationOffset), !reduceMotion);
                    setPendingJump(undefined);
                }
            },
            handle: { current: scroller },
        }),
        [activationOffset, changes, held, pendingJump, reduceMotion, scrollY, scroller, state, tops],
    );

    // The last scroller that attached. A DIFFERENT one replaces it when the screen's list remounts (a layout change keys the
    // Recipes list anew): the new scroller starts at offset 0, but `scrollY` is written only by native scroll events and would
    // keep its last value, so a pin reading it stays pinned over a list at the top. The same scroller re-attaching resets nothing.
    const lastScroller = useRef<ScrollTarget | null>(null);
    const attach = useCallback(
        (node: ScrollTarget | null): void => {
            if (node !== null && lastScroller.current !== null && node !== lastScroller.current) {
                scrollY.setValue(0);
                last.current = { y: 0, current: undefined };
                setState(INITIAL_SCROLL_STATE);
                // A hold and a waiting jump belong to the old scroller's position, not the new one's.
                setHeld(undefined);
                setPendingJump(undefined);
            }

            if (node !== null) {
                lastScroller.current = node;
            }

            setScroller(node);
        },
        [scrollY],
    );

    const bind = useMemo<ScrollBind>(
        () => ({
            ref: attach,
            onScroll,
            onScrollBeginDrag: () => setHeld(undefined),
            onMomentumScrollEnd: () => setHeld((hold) => (hold === undefined ? hold : { ...hold, settled: true })),
            scrollEventThrottle: 16,
        }),
        [attach, onScroll],
    );

    return (
        <ScrollHostContext.Provider value={api}>
            <FieldTargetContext.Provider value={targets}>
                {typeof children === 'function' ? <BoundScreen render={children} bind={bind} /> : children}
            </FieldTargetContext.Provider>
        </ScrollHostContext.Provider>
    );
};
