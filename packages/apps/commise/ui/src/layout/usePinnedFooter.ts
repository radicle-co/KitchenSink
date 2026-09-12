/**
 * @module @commise/ui/pinned-footer — the web measurements for the pinned-footer limit
 * (`docs/design/compactHeightLayout.md` §3.2, A1, §4.4; `ingredientSpecialization.md` §S8.1, finding I7). Read by the
 * web Sheet and by the recipe wizard, so both answer "pinned or not" with one rule.
 *
 * The rule (`isFooterUnpinned`) needs the frame's, the pinned top row's and the footer's real heights, and the browser's
 * layout engine is the only thing that knows them. A `ResizeObserver` reports them; it needs the DOM nodes, which the
 * caller hands over through CALLBACK refs held in state, the shape React documents for measuring a node. ⚠️ That is a
 * ref use the pattern register's detector cannot see (it looks for `useRef`, `createRef`, `forwardRef` and
 * `useImperativeHandle`), so it is stated here: the nodes wrap the browser's layout engine, an external system with no
 * declarative read. Without a `ResizeObserver` (a server render, an old browser) nothing is measured and the footer
 * stays pinned, as it always was, which is also what the first client render shows, so hydration agrees.
 *
 * - The frame is an element (the Sheet) or the viewport (the wizard, whose band is stuck to the page's top); a viewport
 *   frame is measured again on the window's `resize`.
 * - A footer laid out in the top row's own flow is counted there once (`pinnedFooterMeasureOf`).
 * - The last measure is KEPT while a node is unmounted (the Sheet's collapse hides the footer), so a footer that comes
 *   back is judged by its real height, never by 0.
 * - A flip that MOVES the footer remounts it, and focus on a control that unmounts falls to the page. With a focus
 *   carry, the measure that moves the footer also notes which footer control had focus, by the attribute its slot
 *   carries, and the caller hands that control a `focusRequested` level until it has taken focus (SC 2.4.3).
 *
 * @pattern Adapter over the browser's `ResizeObserver` and the window's `resize` — an Observer subscription that turns
 *     the chrome's layout into the inputs of the `isFooterUnpinned` Specification
 */
import { useCallback, useEffect, useEffectEvent, useState } from 'react';

import { isFooterUnpinned, pinnedFooterMeasureOf, type PinnedFooterMeasure } from './pinnedFooter.js';

/** A callback ref, as the caller attaches it. */
type NodeRef = (node: HTMLElement | null) => void;

/** How the footer's controls are named, so the one that had focus is found again after the footer moves. */
export interface FooterFocusCarry<Control> {
    /** The attribute each control's slot carries, with the control's name as its value. */
    readonly attribute: string;
    /** The attribute's value read back as a control; `null` for a value that names none. */
    readonly parse: (value: string | null) => Control | null;
}

/** How a leaf measures its chrome. */
export interface PinnedFooterOptions<Control> {
    /** `'viewport'` for a page whose pinned top row is stuck to the viewport; the frame node otherwise. */
    readonly frame?: 'element' | 'viewport';
    /** Name the footer's controls to carry focus across a flip. */
    readonly focusCarry?: FooterFocusCarry<Control>;
}

/** The decision, the nodes and the refs that feed it, and the control to focus again. */
export interface PinnedFooter<Control> {
    /** Whether the footer scrolls with the content instead of staying pinned. */
    readonly unpinned: boolean;
    /** The footer's last measured height, in px; 0 until measured. */
    readonly footerHeight: number;
    /** For the frame; unused with a viewport frame. */
    readonly frameRef: NodeRef;
    /** For the pinned top row (the one that holds the exit). */
    readonly topRef: NodeRef;
    /** For the footer, in whichever slot it is placed. */
    readonly footerRef: NodeRef;
    /** The top row as mounted, for a caller that measures it for something else too. */
    readonly top: HTMLElement | null;
    /** The footer as mounted, likewise. */
    readonly footer: HTMLElement | null;
    /** The footer control that had focus when the footer last moved, until it takes focus again. */
    readonly refocus: Control | null;
    /** Clears {@link refocus} once the control has taken focus. */
    readonly refocusHandled: () => void;
}

type Nodes = Readonly<Record<keyof PinnedFooterMeasure, HTMLElement | null>>;

interface PinningState<Control> {
    readonly measure: PinnedFooterMeasure;
    readonly refocus: Control | null;
}

const NO_NODES: Nodes = { frame: null, pinnedTop: null, footer: null };
const UNMEASURED: PinnedFooterMeasure = { pinnedTop: 0, footer: 0, frame: 0 };

/** A node's border-box height, in px. */
const heightOf = (node: HTMLElement): number => node.getBoundingClientRect().height;

/** Whether two measures are the same heights. Pure. */
const sameMeasure = (a: PinnedFooterMeasure, b: PinnedFooterMeasure): boolean =>
    a.pinnedTop === b.pinnedTop && a.footer === b.footer && a.frame === b.frame;

/**
 * The footer control that has focus now, or `null` when focus is anywhere else.
 *
 * @param footer - The footer's node.
 * @param carry - How its controls are named.
 * @returns The focused control.
 * @sideEffect Reads the document's focused element.
 */
function focusedControl<Control>(footer: HTMLElement, carry: FooterFocusCarry<Control>): Control | null {
    const slot = document.activeElement?.closest(`[${carry.attribute}]`);

    return slot !== null && slot !== undefined && footer.contains(slot)
        ? carry.parse(slot.getAttribute(carry.attribute))
        : null;
}

/**
 * Measure a frame's pinned chrome, decide whether its footer unpins, and carry focus across a move.
 *
 * @param options - The frame, and how the footer's controls are named.
 * @returns The decision, the nodes, the refs to attach and the control to focus again.
 * @sideEffect Observes the nodes' sizes (and the window's, with a viewport frame) while they are mounted, and reads
 *     which footer control has focus when a measure moves the footer.
 */
export function usePinnedFooter<Control = never>(options: PinnedFooterOptions<Control> = {}): PinnedFooter<Control> {
    const viewport = options.frame === 'viewport';
    const [nodes, setNodes] = useState(NO_NODES);
    const [state, setState] = useState<PinningState<Control>>({ measure: UNMEASURED, refocus: null });
    // Created ONCE: a callback ref with a new identity each render is detached and re-attached on every render, and
    // each of those would set state and render again.
    const [refs] = useState(() => {
        const bind =
            (part: keyof Nodes): NodeRef =>
            (node) =>
                setNodes((current) => (current[part] === node ? current : { ...current, [part]: node }));

        return { frameRef: bind('frame'), topRef: bind('pinnedTop'), footerRef: bind('footer') };
    });
    const refocusHandled = useCallback(
        () => setState((current) => (current.refocus === null ? current : { ...current, refocus: null })),
        [],
    );
    // Reads the caller's carry as it is when a measure runs; a new carry object never re-subscribes.
    const focusedIn = useEffectEvent((footer: HTMLElement): Control | null =>
        options.focusCarry === undefined ? null : focusedControl(footer, options.focusCarry),
    );

    useEffect(() => {
        const { frame, pinnedTop, footer } = nodes;

        if ((!viewport && frame === null) || pinnedTop === null || footer === null) {
            return undefined;
        }

        if (typeof ResizeObserver === 'undefined') {
            return undefined;
        }

        const remeasure = (): void => {
            const next = pinnedFooterMeasureOf({
                topHeight: heightOf(pinnedTop),
                footerHeight: heightOf(footer),
                footerInTop: pinnedTop.contains(footer) && getComputedStyle(footer).position !== 'fixed',
                frameHeight: frame === null || viewport ? document.documentElement.clientHeight : heightOf(frame),
            });
            // Read now: once this measure moves the footer, the node that holds focus is gone.
            const focused = focusedIn(footer);

            setState((current) => {
                if (sameMeasure(current.measure, next)) {
                    return current;
                }

                const moves = isFooterUnpinned(current.measure) !== isFooterUnpinned(next);

                return { measure: next, refocus: moves ? focused : current.refocus };
            });
        };

        const observer = new ResizeObserver(remeasure);

        if (frame !== null && !viewport) {
            observer.observe(frame);
        }

        observer.observe(pinnedTop);
        observer.observe(footer);

        if (viewport) {
            window.addEventListener('resize', remeasure);
        }

        return () => {
            observer.disconnect();

            if (viewport) {
                window.removeEventListener('resize', remeasure);
            }
        };
    }, [nodes, viewport]);

    return {
        unpinned: isFooterUnpinned(state.measure),
        footerHeight: state.measure.footer,
        ...refs,
        top: nodes.pinnedTop,
        footer: nodes.footer,
        refocus: state.refocus,
        refocusHandled,
    };
}
