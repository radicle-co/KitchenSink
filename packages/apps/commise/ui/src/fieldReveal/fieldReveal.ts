/**
 * @module @commise/ui/field-reveal — the rules a scroller host applies to a reveal request
 * (`docs/design/rowEditorOpenDecisions.md` E1): whether the field and its rows already fit in the visible area, where
 * to scroll when they do not, and how tall the blank space at the end of the content is that gives that scroll room.
 * Plus the lifetime of one opening, `closed → armed → revealing → revealed → closed`. All pure.
 *
 * - Armed: a field asked, and the host checks the fit each time the visible area changes size (on R7's path the
 *   keyboard rises after the request). It never checks on a change of the content's size, so later list frames move
 *   nothing (P2).
 * - Revealing: it did not fit. The space is laid out, and once the content is long enough the host scrolls, once.
 * - Revealed: the scroll ran. The space follows the rows that arrive above it, so the content's end stays put.
 * - Closed: the list closed or the field unmounted, and the space goes.
 *
 * @pattern Specification — `fitsBelow`, a pure predicate over the field's measured box
 * @pattern State — `revealReducer`, an exhaustive switch over a discriminated union of states and events
 */
import { spacing } from '../tokens/scale.js';
import type { RevealRequest, RevealTarget } from './fieldRevealContext.js';

/** The dp left between the visible area's top and a field the host scrolled up to it (E1). */
export const REVEAL_GAP_DP = spacing[2];

/** Layout reports fractional dp; a space this close to the length it was given has room. */
const LAYOUT_TOLERANCE_DP = 1;

/** The field's box in the scroller's visible area, in dp: its top edge and its height. */
export interface FieldBox {
    readonly top: number;
    readonly height: number;
}

/** Where the field sits now: its top in the visible area, and how far the scroller has scrolled. */
export interface FieldPlace {
    readonly top: number;
    readonly offset: number;
}

/** One opening, held by the host. */
export type RevealState =
    | { readonly kind: 'closed' }
    | { readonly kind: 'armed'; readonly request: RevealRequest }
    | {
          readonly kind: 'revealing' | 'revealed';
          readonly request: RevealRequest;
          /** The scroll offset that puts the field at the top. */
          readonly target: number;
          /** Where the space was last laid out in the content; `null` until it has been. */
          readonly spacerTop: number | null;
      };

/** What happens to an opening. */
export type RevealEvent =
    | { readonly kind: 'requested'; readonly request: RevealRequest }
    | { readonly kind: 'released'; readonly field: RevealTarget }
    | { readonly kind: 'misfit'; readonly field: RevealTarget; readonly target: number }
    | { readonly kind: 'spacerLaidOut'; readonly top: number }
    | { readonly kind: 'scrolled'; readonly field: RevealTarget };

/** No opening. */
export const REVEAL_CLOSED: RevealState = { kind: 'closed' };

/**
 * Whether the field and the room it needs below it show inside the visible area. Pure.
 *
 * @param box - The field's box in the visible area.
 * @param below - The dp the field needs below it.
 * @param viewport - The visible area's height; 0 until laid out, which fits nothing.
 * @returns `true` when the field's top is in view and the room below it ends inside the visible area.
 */
export function fitsBelow(box: FieldBox, below: number, viewport: number): boolean {
    return box.top >= 0 && box.top + box.height + below <= viewport;
}

/**
 * The scroll offset that puts the field at the top of the visible area, with the gap above it. Pure.
 *
 * @param place - Where the field is now.
 * @returns The offset, never above the content's start.
 */
export function revealTarget(place: FieldPlace): number {
    return Math.max(0, place.offset + place.top - REVEAL_GAP_DP);
}

/**
 * The space's height: enough that the content ends at `target + viewport`, so a scroll to `target` is not clamped. Its
 * own top is the content above it, so its height never feeds back into that sum. Pure.
 *
 * @param target - The offset the host scrolls to.
 * @param viewport - The visible area's height.
 * @param spacerTop - Where the space was last laid out, or `null` before its first layout.
 * @returns The height in whole dp; 0 before the first layout and when the content is already long enough.
 */
export function spacerHeight(target: number, viewport: number, spacerTop: number | null): number {
    return spacerTop === null ? 0 : Math.max(0, Math.ceil(target + viewport - spacerTop));
}

/**
 * Whether the space, as laid out, makes the content long enough to scroll to `target`. Pure.
 *
 * @param target - The offset the host scrolls to.
 * @param viewport - The visible area's height.
 * @param layout - The space's laid-out top and height in the content.
 * @returns `true` once its bottom reaches `target + viewport`.
 */
export function spacerHasRoom(
    target: number,
    viewport: number,
    layout: { readonly y: number; readonly height: number },
): boolean {
    return layout.y + layout.height >= target + viewport - LAYOUT_TOLERANCE_DP;
}

/** Whether a state belongs to `field`'s opening. */
const isFor = (state: RevealState, field: RevealTarget): boolean =>
    state.kind !== 'closed' && state.request.field === field;

/**
 * The next state of an opening. Pure.
 *
 * @param state - The opening now.
 * @param event - What happened.
 * @returns The next state; the same object when the event changes nothing.
 */
export function revealReducer(state: RevealState, event: RevealEvent): RevealState {
    switch (event.kind) {
        case 'requested':
            return { kind: 'armed', request: event.request };
        case 'released':
            return isFor(state, event.field) ? REVEAL_CLOSED : state;
        case 'misfit':
            return state.kind === 'armed' && isFor(state, event.field)
                ? { kind: 'revealing', request: state.request, target: event.target, spacerTop: null }
                : state;
        case 'spacerLaidOut':
            return (state.kind === 'revealing' || state.kind === 'revealed') && state.spacerTop !== event.top
                ? { ...state, spacerTop: event.top }
                : state;
        case 'scrolled':
            return state.kind === 'revealing' && isFor(state, event.field) ? { ...state, kind: 'revealed' } : state;
    }
}
