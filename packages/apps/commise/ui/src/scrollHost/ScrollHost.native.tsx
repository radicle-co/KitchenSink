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
 * ⚠️ It holds ONE ref, sanctioned in `patternRegister.test.ts`'s `REF_MODULES`: `last`, a previous-value latch (the last
 * y, and the scroll spy's last section) read and advanced ONLY inside the scroll handler, never during render. The
 * section half is what lets the handler raise a section change (`onCurrentChange`) as an event, once per change.
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

import { useReduceMotion } from '../motion/useReduceMotion.native.js';
import type { LayoutReport, ScrollBind, ScrollHostApi, ScrollHostProps, ScrollReport, ScrollTarget } from './props.js';
import { createCurrentChangeSubject } from './currentChange.js';
import { currentSectionOf } from './currentSection.js';
import { ScrollHostContext } from './scrollHostContext.js';
import { INITIAL_SCROLL_STATE, nextScrollState } from './scrollState.js';

/** How close to the end counts as the end, px: a fractional content height never quite reaches it. */
const END_SLOP_PX = 1;

/** How long a jump's own scroll is given to end when it reports no momentum end (a jump that did not move). */
const JUMP_SETTLE_MS = 1_000;

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
export const ScrollHost: FC<ScrollHostProps> = ({ sections = [], activationOffset = 0, children }) => {
    const [scroller, setScroller] = useState<ScrollTarget | null>(null);
    const last = useRef<{ y: number; current: string | undefined }>({ y: 0, current: undefined });
    const [changes] = useState(createCurrentChangeSubject);
    const reduceMotion = useReduceMotion() === true;
    const [state, setState] = useState(INITIAL_SCROLL_STATE);
    const [headingBottom, setHeadingBottom] = useState<number | undefined>(undefined);
    const [tops, setTops] = useState<Readonly<Record<string, number>>>({});
    // The section a jump named, held as current until the cook leaves it.
    const [held, setHeld] = useState<Hold | undefined>(undefined);
    const settling = held !== undefined && !held.settled;
    // A jump asked for before its section reported its layout (a deep link, on mount): it lands when the layout does.
    const [pendingJump, setPendingJump] = useState<string | undefined>(undefined);

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
            headingLayout: (event: LayoutReport) => {
                const { y, height } = event.nativeEvent.layout;
                setHeadingBottom(y + height);
            },
            sectionLayout: (id) => (event: LayoutReport) => {
                const { y } = event.nativeEvent.layout;
                setTops((previous) => (previous[id] === y ? previous : { ...previous, [id]: y }));

                if (pendingJump === id && scroller !== null) {
                    scrollTargetTo(scroller, Math.max(0, y - activationOffset), !reduceMotion);
                    setPendingJump(undefined);
                }
            },
            handle: { current: scroller },
        }),
        [activationOffset, changes, held, pendingJump, reduceMotion, scroller, state, tops],
    );

    const bind = useMemo<ScrollBind>(
        () => ({
            ref: setScroller,
            onScroll,
            onScrollBeginDrag: () => setHeld(undefined),
            onMomentumScrollEnd: () => setHeld((hold) => (hold === undefined ? hold : { ...hold, settled: true })),
            scrollEventThrottle: 16,
        }),
        [onScroll],
    );

    return (
        <ScrollHostContext.Provider value={api}>
            {typeof children === 'function' ? <BoundScreen render={children} bind={bind} /> : children}
        </ScrollHostContext.Provider>
    );
};
