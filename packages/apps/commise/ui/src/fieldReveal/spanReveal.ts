/**
 * @module @commise/ui/field-reveal — where a scroller goes so a span of content shows whole, with the smallest scroll
 * (`docs/design/uiOverhaul/ingredientArrival.md`): a new row and the field under it. Pure, and shared by the native
 * host (`useFieldRevealHost.native.ts`) and the web `ScrollHost`, so the two platforms cannot disagree on the rule.
 *
 * The span is the area from the row's top to the field's bottom, with a gap held at each edge. When it fits it moves
 * only as far as it must. When it is taller than the visible area the field wins (WCAG 2.2 SC 2.4.11, Focus Not
 * Obscured): the field's bottom goes one gap above the bottom edge, and as much of the row as fits shows above it.
 *
 * @pattern Specification — `spanTarget`, a pure rule over the span's measured edges
 */

/** The span and the scroller it is shown in, all in dp or px of one unit. */
export interface SpanPlace {
    /** The span's top in the visible area; negative when it is above the visible area's top edge. */
    readonly top: number;
    /** The span's bottom in the visible area. */
    readonly bottom: number;
    /** The scroll offset now. */
    readonly offset: number;
    /** The visible area's height; 0 until laid out, which fits nothing. */
    readonly viewport: number;
    /** The gap held between the span and each edge of the visible area. */
    readonly keep: number;
}

/**
 * The scroll offset that shows the span with the smallest movement. Pure.
 *
 * @param place - Where the span and the scroller are.
 * @returns The offset, never below 0; `null` when the span already shows, when the visible area is not laid out, or when
 *     the offset cannot move any closer (the content's start).
 */
export function spanTarget({ top, bottom, offset, viewport, keep }: SpanPlace): number | null {
    if (viewport <= 0) {
        return null;
    }

    const areaTop = top - keep;
    const areaBottom = bottom + keep;
    const tooTall = areaBottom - areaTop > viewport;
    let delta = 0;

    // A span that fits and starts above the top edge ends inside the bottom one, so the first branch never moves it up.
    if (tooTall || areaBottom > viewport) {
        // The field's bottom lands one gap above the bottom edge.
        delta = areaBottom - viewport;
    } else if (areaTop < 0) {
        // The row's top lands one gap below the top edge.
        delta = areaTop;
    }

    const target = Math.max(0, offset + delta);

    return target === offset ? null : target;
}

/**
 * The scroll offset for a deep link to one element that ends in what the cook must reach (an ingredient row and its
 * editor's Done and Cancel): the element's top one gap below the visible area's top, unless it and its end do not both
 * fit between the edges. Then the END wins, as in {@link spanTarget}: its bottom goes one gap above the bottom edge and
 * as much of the element as fits shows above it. One offset from both edges, so a caller scrolls once. Pure.
 *
 * @param place - Where the element's top and bottom and the scroller are.
 * @returns The offset, never below 0; `null` when it is already there or the visible area is not laid out.
 */
export function startSpanTarget({ top, bottom, offset, viewport, keep }: SpanPlace): number | null {
    if (viewport <= 0) {
        return null;
    }

    const fits = bottom - top + 2 * keep <= viewport;
    const delta = fits ? top - keep : bottom + keep - viewport;
    const target = Math.max(0, offset + delta);

    return target === offset ? null : target;
}
