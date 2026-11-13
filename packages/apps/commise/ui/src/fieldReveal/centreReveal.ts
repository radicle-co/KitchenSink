/**
 * @module @commise/ui/field-reveal — where a scroller goes so ONE field shows in the middle of the visible area
 * (`docs/design/uiOverhaul/specSharedSystem.md` §16.3): the field a refused Publish named. Pure, and the sibling of
 * `spanReveal.ts`, which shows a span with the smallest scroll; a named field is centred instead, because the cook is
 * being taken to it and nothing else on the screen says where it is.
 *
 * A field too tall to centre with a gap each side puts its top one gap below the visible area's top, so its start and
 * its label show (WCAG 2.2 SC 2.4.11, Focus Not Obscured).
 *
 * @pattern Specification — `centreTarget`, a pure rule over the field's measured edges
 */
import { spacing } from '../tokens/scale.js';

/** The dp held above a field too tall to centre. */
export const TARGET_GAP_DP = spacing[4];

/** The field and the scroller it is shown in, all in dp of one unit. */
export interface CentrePlace {
    /** The field's top in the visible area; negative when it is above the visible area's top edge. */
    readonly top: number;
    /** The field's height. */
    readonly height: number;
    /** The scroll offset now. */
    readonly offset: number;
    /** The visible area's height; 0 until laid out, which fits nothing. */
    readonly viewport: number;
    /** The gap held between a field too tall to centre and the visible area's top edge. */
    readonly keep: number;
}

/**
 * The scroll offset that puts the field in the middle of the visible area. Pure.
 *
 * @param place - Where the field and the scroller are.
 * @returns The offset, never below 0 and not clamped above (the platform clamps to the content's end); `null` when the
 *     visible area is not laid out or the field is already where it would go.
 */
export function centreTarget({ top, height, offset, viewport, keep }: CentrePlace): number | null {
    if (viewport <= 0) {
        return null;
    }

    const delta = height + 2 * keep > viewport ? top - keep : top + height / 2 - viewport / 2;
    const target = Math.max(0, offset + delta);

    return target === offset ? null : target;
}
