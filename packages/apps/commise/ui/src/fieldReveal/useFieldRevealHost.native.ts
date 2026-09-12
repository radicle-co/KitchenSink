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
 * It holds no ref of its own: it reads the host's scroller ref inside effects and event handlers, never in render.
 *
 * @pattern Facade — one headless hook over the `fitsBelow` Specification, the `revealReducer` State and the
 *     `measureField` Adapter
 */
import { useEffect, useEffectEvent, useReducer, useState, type RefObject } from 'react';
import type { LayoutChangeEvent } from 'react-native';

import { useReduceMotion } from '../motion/useReduceMotion.native.js';
import { REVEAL_CLOSED, fitsBelow, revealReducer, revealTarget, spacerHasRoom, spacerHeight } from './fieldReveal.js';
import type { FieldRevealer, RevealRequest } from './fieldRevealContext.js';
import { measureField, scrollContentTo, type RevealScroller } from './measureField.native.js';
import type { RevealSpacerProps } from './RevealSpacer.native.js';

/** What the host renders with. */
export interface FieldRevealHost {
    /** For `FieldRevealContext`. Its identity never changes. */
    readonly revealer: FieldRevealer;
    /** For the scroller's `onLayout`: the visible area. */
    readonly onViewportLayout: (event: LayoutChangeEvent) => void;
    /** For the `RevealSpacer` after the scroller's other children; `null` while no reveal needs it. */
    readonly spacer: RevealSpacerProps | null;
}

/**
 * Host field reveals for one scroller.
 *
 * @param scroller - The host's ref to its `ScrollView`.
 * @returns The revealer, the scroller's layout handler and the space's props.
 * @sideEffect Measures a requesting field against the scroller, and scrolls it.
 */
export function useFieldRevealHost(scroller: RefObject<RevealScroller | null>): FieldRevealHost {
    const [state, dispatch] = useReducer(revealReducer, REVEAL_CLOSED);
    const [viewport, setViewport] = useState(0);
    const reduceMotion = useReduceMotion();
    const [revealer] = useState(() => {
        const reveal: FieldRevealer = (request) => {
            dispatch({ kind: 'requested', request });

            return () => {
                dispatch({ kind: 'released', field: request.field });
            };
        };

        return reveal;
    });
    // Reads the visible area as it is when the check runs; only the request and a change of size run one.
    const check = useEffectEvent((request: RevealRequest): void => {
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
            setViewport(event.nativeEvent.layout.height);
        },
        spacer:
            state.kind === 'revealing' || state.kind === 'revealed'
                ? { height: spacerHeight(state.target, viewport, state.spacerTop), onLayout: onSpacerLayout }
                : null,
    };
}
