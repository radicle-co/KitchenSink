/**
 * @module @commise/ui/field-reveal — the scroller host's side of the field reveal
 * (`docs/design/rowEditorOpenDecisions.md` E1, item 7 condition 2).
 *
 * A field's request arms the host. While armed, the host measures the field when the request arrives and again each
 * time the visible area changes size (on R7's path the keyboard rises after the request), and never on a change of the
 * content's size, so later list frames move nothing (P2). When the field and the room it needs do not fit, the host
 * lays out the space (`RevealSpacer`) as its scroller's last child; once the content is long enough, it scrolls the
 * field to the top of the visible area, once, animated unless reduce motion is on (or not yet known). The space then
 * follows the rows that arrive above it, so nothing jumps. The list closes, and the space goes.
 *
 * The visible area is the scroller's own `onLayout` height. With the keyboard avoider's `padding`, the scroller ends at
 * the pinned bar or the keyboard's top, so no keyboard metric is read and the keyboard is never counted twice.
 *
 * An ARRIVAL (`kind: 'arrival'`, `docs/design/uiOverhaul/ingredientArrival.md`) is the other request: a row has just
 * arrived straight above the field, and the host shows the row and the field together by the smallest scroll
 * (`spanTarget`). It needs no blank space, so it never lays any out and never touches the list's opening. It is checked
 * when it arrives and on each change of the visible area's size, and it scrolls at most once: the check that scrolls
 * disarms it, and a release (the key went, the cook typed, the field unmounted) cancels a check still measuring.
 *
 * A FOCUS (`kind: 'focus'`, `docs/design/uiOverhaul/specSharedSystem.md` §16.3) is a field the cook is typing in. The
 * host holds it until the field blurs and keeps it inside the visible area by the same smallest scroll, with no blank
 * space. It re-checks each time the visible area gets SHORTER (the keyboard rising, then the pinned footer) and never
 * on a taller area or a change of the content, so the cook's own scrolling is not undone. An arrival pending on the
 * same host wins (a focus is dropped while one waits, and an arrival replaces a held focus), and a list that is open
 * shows its own rows, so the focus waits for it to close.
 *
 * A TARGET (`kind: 'target'`) is a field a refused Publish named: the host centres it in the visible area (`centreTarget`),
 * once, and then calls `onShown`, where the field moves the screen-reader cursor to itself. `onShown` runs whether or
 * not anything moved and whether or not the field could be measured. A target waits for the visible area to be laid
 * out, replaces an older target, and clears a held focus, so the focus check cannot undo the centring.
 *
 * It holds no ref of its own: it reads the host's scroller ref inside effects and event handlers, never in render.
 *
 * @pattern Facade — one headless hook over the `fitsBelow` Specification, the `revealReducer` State and the
 *     `measureField` Adapter
 */
import { useEffect, useEffectEvent, useReducer, useState, type RefObject } from 'react';
import type { LayoutChangeEvent } from 'react-native';

import { useReduceMotion } from '../motion/useReduceMotion.native.js';
import { TARGET_GAP_DP, centreTarget } from './centreReveal.js';
import {
    REVEAL_CLOSED,
    REVEAL_GAP_DP,
    fitsBelow,
    revealReducer,
    revealTarget,
    spacerHasRoom,
    spacerHeight,
} from './fieldReveal.js';
import type { FieldRevealer, ListRequest, RevealRequest } from './fieldRevealContext.js';
import { measureField, scrollContentTo, type RevealScroller } from './measureField.native.js';
import type { RevealSpacerProps } from './RevealSpacer.native.js';
import { spanTarget } from './spanReveal.js';

/** What the host renders with. */
export interface FieldRevealHost {
    /** For `FieldRevealContext`. Its identity never changes. */
    readonly revealer: FieldRevealer;
    /** For the scroller's `onLayout`: the visible area. */
    readonly onViewportLayout: (event: LayoutChangeEvent) => void;
    /** For the `RevealSpacer` after the scroller's other children; `null` while no reveal needs it. */
    readonly spacer: RevealSpacerProps | null;
}

/** The two requests the host holds in one slot: an arrival waits for a scroll, a focus waits for a blur. */
type PendingRequest = Extract<RevealRequest, { readonly kind: 'arrival' | 'focus' }>;

/**
 * Host field reveals for one scroller.
 *
 * @param scroller - The host's ref to its `ScrollView`.
 * @returns The revealer, the scroller's layout handler and the space's props.
 * @sideEffect Measures a requesting field against the scroller, and scrolls it.
 */
export function useFieldRevealHost(scroller: RefObject<RevealScroller | null>): FieldRevealHost {
    const [state, dispatch] = useReducer(revealReducer, REVEAL_CLOSED);
    // The visible area, and how many times it has got SHORTER: a held focus re-checks on each of those and on nothing
    // else, and counting them in state spares a ref to remember the last height.
    const [area, setArea] = useState({ height: 0, shrinks: 0 });
    const viewport = area.height;
    const reduceMotion = useReduceMotion();
    // The request now waiting: an arrival waits for a check that scrolls, a focus for its field to blur. Apart from the
    // list's opening, which it never shares a state with.
    const [pending, setPending] = useState<PendingRequest | null>(null);
    // The target waiting to be shown; one-shot.
    const [target, setTarget] = useState<Extract<RevealRequest, { readonly kind: 'target' }> | null>(null);
    const [revealer] = useState(() => {
        const reveal: FieldRevealer = (request) => {
            switch (request.kind) {
                case 'arrival':
                    // An arrival replaces a focus the host held.
                    setPending(request);

                    return () => {
                        setPending((current) => (current === request ? null : current));
                    };

                case 'focus':
                    // A focus is dropped while an arrival is pending: the arrival shows the field with its row.
                    setPending((current) => (current?.kind === 'arrival' ? current : request));

                    return () => {
                        setPending((current) => (current === request ? null : current));
                    };

                case 'target':
                    // The field the cook was taken to is the field to show, so nothing held earlier may move it again.
                    setPending(null);
                    setTarget(request);

                    return () => {
                        setTarget((current) => (current === request ? null : current));
                    };

                case 'list':
                    dispatch({ kind: 'requested', request });

                    return () => {
                        dispatch({ kind: 'released', field: request.field });
                    };
            }
        };

        return reveal;
    });
    // Reads the visible area as it is when the check runs; only the request and a change of size run one.
    const check = useEffectEvent((request: ListRequest): void => {
        const view = scroller.current;

        if (view === null) {
            return;
        }

        void measureField(request.field, view).then((measure) => {
            if (measure !== null && !fitsBelow(measure, request.below, viewport)) {
                dispatch({ kind: 'misfit', field: request.field, target: revealTarget(measure) });
            }
        });
    });
    const armed = state.kind === 'armed' ? state.request : null;

    useEffect(() => {
        if (armed !== null && viewport > 0) {
            check(armed);
        }
    }, [armed, viewport]);

    // Reads the reduce-motion answer as it is when the scroll runs; a change of it re-checks nothing.
    const scrollTo = useEffectEvent((view: RevealScroller, y: number): void => {
        scrollContentTo(view, y, reduceMotion === false);
    });

    // Reads the scroller as it is when the check runs: the owner may hand the host a fresh `{ current }` wrapper on
    // every render (scrolling re-renders it), and that must not re-run a check.
    const currentScroller = useEffectEvent((): RevealScroller | null => scroller.current);
    // Reads the visible area as it is when a measurement answers.
    const currentViewport = useEffectEvent((): number => viewport);

    const arrival = pending?.kind === 'arrival' ? pending : null;

    useEffect(() => {
        const view = currentScroller();

        if (arrival === null || view === null || viewport <= 0) {
            return undefined;
        }

        let released = false;

        void measureField(arrival.field, view).then((measure) => {
            if (released || measure === null) {
                return;
            }

            const place = spanTarget({
                top: measure.top - arrival.above,
                bottom: measure.top + measure.height,
                offset: measure.offset,
                viewport,
                keep: REVEAL_GAP_DP,
            });

            if (place !== null) {
                scrollTo(view, place);
                setPending((current) => (current === arrival ? null : current));
            }
        });

        return () => {
            released = true;
        };
    }, [arrival, viewport]);

    const focus = pending?.kind === 'focus' ? pending : null;
    // A list that is open shows its own rows by its own rule, and a focus waits for it to close.
    const listOpen = state.kind !== 'closed';
    const laidOut = viewport > 0;

    // A focus is checked when it is held, when the visible area gets shorter, and when a list that stood in its way
    // closes. A taller area or a change of the content checks nothing, so the cook's own scrolling is never undone.
    useEffect(() => {
        const view = currentScroller();

        if (focus === null || view === null || listOpen || !laidOut) {
            return undefined;
        }

        let released = false;

        void measureField(focus.field, view).then((measure) => {
            if (released || measure === null) {
                return;
            }

            const place = spanTarget({
                top: measure.top,
                bottom: measure.top + measure.height,
                offset: measure.offset,
                viewport: currentViewport(),
                keep: REVEAL_GAP_DP,
            });

            if (place !== null) {
                scrollTo(view, place);
            }
        });

        return () => {
            released = true;
        };
    }, [focus, listOpen, laidOut, area.shrinks]);

    // A target is shown once the visible area is laid out: centred, then told it was shown, whether or not anything
    // moved and whether or not it could be measured, because the field's screen-reader cursor depends on neither.
    useEffect(() => {
        if (target === null || !laidOut) {
            return undefined;
        }

        let released = false;
        const view = currentScroller();

        const shown = (): void => {
            if (released) {
                return;
            }

            target.onShown();
            setTarget((current) => (current === target ? null : current));
        };

        if (view === null) {
            shown();
        } else {
            void measureField(target.field, view).then((measure) => {
                const place =
                    measure === null
                        ? null
                        : centreTarget({
                              top: measure.top,
                              height: measure.height,
                              offset: measure.offset,
                              viewport: currentViewport(),
                              keep: TARGET_GAP_DP,
                          });

                if (!released && place !== null) {
                    scrollTo(view, place);
                }

                shown();
            });
        }

        return () => {
            released = true;
        };
    }, [target, laidOut]);

    const onSpacerLayout = (event: LayoutChangeEvent): void => {
        const { y, height } = event.nativeEvent.layout;
        const view = scroller.current;

        dispatch({ kind: 'spacerLaidOut', top: y });

        if (state.kind === 'revealing' && view !== null && spacerHasRoom(state.target, viewport, { y, height })) {
            scrollContentTo(view, state.target, reduceMotion === false);
            dispatch({ kind: 'scrolled', field: state.request.field });
        }
    };

    return {
        revealer,
        onViewportLayout: (event) => {
            const { height } = event.nativeEvent.layout;

            setArea((previous) =>
                previous.height === height
                    ? previous
                    : {
                          height,
                          shrinks: previous.shrinks + (previous.height > 0 && height < previous.height ? 1 : 0),
                      },
            );
        },
        spacer:
            state.kind === 'revealing' || state.kind === 'revealed'
                ? { height: spacerHeight(state.target, viewport, state.spacerTop), onLayout: onSpacerLayout }
                : null,
    };
}
