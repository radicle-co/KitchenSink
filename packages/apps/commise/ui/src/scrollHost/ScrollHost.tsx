'use client';

/**
 * @module @commise/ui/scroll-host — the web design-system {@link ScrollHost} (`docs/architecture/uiOverhaulBlueprint.md`
 * A7). The document scrolls, so the host holds NO ref: it finds the heading and the sections by their element ids,
 * which the accessibility contract already requires.
 *
 * - `condensed` comes from an `IntersectionObserver` on the heading: no scroll listener for it.
 * - The direction and the top come from ONE passive `scroll` listener on `window`, throttled to a frame. It is the one
 *   permitted web scroll listener, and it exists because an `IntersectionObserver` cannot tell direction; the floating
 *   button and "Back to top" both read it from here.
 * - Jumps call `scrollIntoView` and `history.replaceState`, instant under `prefers-reduced-motion`.
 * - A jump HOLDS `current` on the section it named until the cook scrolls again, even when the page is too short for
 *   that section to reach the activation line. The jump's own scroll never releases it; the cook's own input does (a
 *   wheel, a touch, a scroll key outside a field), and so does any scroll once the jump's scroll has ended
 *   (`scrollend`, or {@link JUMP_SETTLE_MS} for a jump that did not move), which is how a scrollbar drag reads.
 *
 * ORCHESTRATION of the screen's scroll: it holds the state its chrome reads and moves the scroller.
 *
 * @pattern Mediator over the document's scroll — the chrome reads, nothing else listens
 * @pattern Observer — the heading watch and the scroll spy, through the one `currentSectionOf` algorithm
 */
import { useEffect, useMemo, useState, type FC } from 'react';

import type { ScrollBind, ScrollHostApi, ScrollHostProps, ScrollTarget } from './props.js';
import { ScrollHostContext } from './scrollHostContext.js';
import { INITIAL_SCROLL_STATE, nextScrollState } from './scrollState.js';

/** How close to the end counts as the end, px. */
const END_SLOP_PX = 1;

/** How long a jump's own scroll is given to end when the browser reports no `scrollend` (a jump that did not move). */
const JUMP_SETTLE_MS = 1_000;

/** The keys that scroll the document when focus is not in a field. */
const SCROLL_KEYS: ReadonlySet<string> = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);

/** Whether a key event belongs to a field the cook is typing in, so it scrolls nothing. */
function isTyping(target: EventTarget | null): boolean {
    return (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    );
}

/** A handle that is always empty: the document is not a React Native scroller. */
const NO_HANDLE: { readonly current: ScrollTarget | null } = { current: null };

/** The bind a shared screen's render prop receives on web, where the document scrolls and nothing binds. */
const INERT_BIND: ScrollBind = {
    ref: () => undefined,
    onScroll: () => undefined,
    onScrollBeginDrag: () => undefined,
    scrollEventThrottle: 16,
};

/** The behaviour a jump takes: smooth, or instant under reduced motion. Reads the media query. */
function jumpBehavior(): ScrollBehavior {
    // A browser without `matchMedia` reports no preference, so the jump keeps the default motion.
    const reduce =
        typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    return reduce ? 'auto' : 'smooth';
}

/** The web design-system scroll host. */
export const ScrollHost: FC<ScrollHostProps> = ({ headingId, sections, activationOffset = 0, children }) => {
    const [state, setState] = useState(INITIAL_SCROLL_STATE);
    const [headingGone, setHeadingGone] = useState(false);
    // The section a jump named, held as current until the cook scrolls again.
    const [held, setHeld] = useState<string | undefined>(undefined);
    const holding = held !== undefined;
    const sectionKey = sections?.join('\n') ?? '';

    // @sideEffect Watches the heading leave the top of the viewport.
    useEffect(() => {
        const heading = headingId === undefined ? null : document.getElementById(headingId);

        if (heading === null || typeof IntersectionObserver !== 'function') {
            return undefined;
        }

        const observer = new IntersectionObserver(([entry]) => {
            if (entry !== undefined) {
                setHeadingGone(!entry.isIntersecting && entry.boundingClientRect.top < 0);
            }
        });
        observer.observe(heading);

        return () => observer.disconnect();
    }, [headingId]);

    // @sideEffect Subscribes to the document's scroll, passive and once per frame.
    useEffect(() => {
        const ids = sectionKey === '' ? [] : sectionKey.split('\n');
        let previousY = window.scrollY;
        let frame: number | undefined;

        const sample = (): void => {
            frame = undefined;
            const y = window.scrollY;
            const root = document.documentElement;
            const atEnd = y + window.innerHeight >= root.scrollHeight - END_SLOP_PX;
            const tops = ids.flatMap((id) => {
                const node = document.getElementById(id);

                return node === null ? [] : [{ id, top: node.getBoundingClientRect().top + y }];
            });

            // ⛔ Captured as a const BEFORE `previousY` advances: the updater may run later, during render, and would
            // otherwise read the advanced value and see no movement at all.
            const sampleOf = {
                y,
                previousY,
                headingBottom: undefined,
                atEnd,
                viewportHeight: window.innerHeight,
                contentHeight: root.scrollHeight,
            };
            previousY = y;
            setState((previous) => nextScrollState(previous, sampleOf, tops, activationOffset));
        };

        const onScroll = (): void => {
            if (frame === undefined) {
                frame = window.requestAnimationFrame(sample);
            }
        };

        window.addEventListener('scroll', onScroll, { passive: true });

        return () => {
            window.removeEventListener('scroll', onScroll);

            if (frame !== undefined) {
                window.cancelAnimationFrame(frame);
            }
        };
    }, [activationOffset, sectionKey]);

    // @sideEffect While a jump holds, listens for the cook's own scroll, which releases it.
    useEffect(() => {
        if (!holding) {
            return undefined;
        }

        let settled = false;
        const release = (): void => setHeld(undefined);

        const settle = (): void => {
            settled = true;
        };

        const onScroll = (): void => {
            if (settled) {
                release();
            }
        };

        const onKey = (event: KeyboardEvent): void => {
            if (SCROLL_KEYS.has(event.key) && !isTyping(event.target)) {
                release();
            }
        };

        const timer = window.setTimeout(settle, JUMP_SETTLE_MS);

        window.addEventListener('wheel', release, { passive: true });
        window.addEventListener('touchstart', release, { passive: true });
        window.addEventListener('keydown', onKey);
        window.addEventListener('scrollend', settle);
        window.addEventListener('scroll', onScroll, { passive: true });

        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('wheel', release);
            window.removeEventListener('touchstart', release);
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('scrollend', settle);
            window.removeEventListener('scroll', onScroll);
        };
    }, [holding]);

    const api = useMemo<ScrollHostApi>(
        () => ({
            ...state,
            current: held ?? state.current,
            condensed: headingGone,
            scrollToTop: () => window.scrollTo({ top: 0, behavior: jumpBehavior() }),
            scrollToSection: (id) => {
                const target = document.getElementById(id);

                if (target === null) {
                    return;
                }

                // The heading's own `scroll-margin-top` keeps it clear of the sticky chrome. Focus follows the jump
                // (it carries `tabIndex={-1}`), without a second scroll.
                target.scrollIntoView({ behavior: jumpBehavior(), block: 'start' });
                target.focus({ preventScroll: true });
                window.history.replaceState(window.history.state, '', `#${id}`);
                setHeld(id);
            },
            headingLayout: () => undefined,
            sectionLayout: () => () => undefined,
            handle: NO_HANDLE,
        }),
        [headingGone, held, state],
    );

    return (
        <ScrollHostContext.Provider value={api}>
            {typeof children === 'function' ? children(INERT_BIND) : children}
        </ScrollHostContext.Provider>
    );
};
