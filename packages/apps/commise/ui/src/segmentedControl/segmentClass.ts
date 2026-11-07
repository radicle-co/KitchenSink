/**
 * @module @commise/ui/segmented-control — the web class recipes for the segmented control (spec §1.11): a `pearl`
 * track 44 px tall, pill segments that share it equally (`room`: no label is cut or wrapped to fit a neighbour), the
 * current segment `paper` with `shadow-sm`, a 1 px `lineControl` edge and an `ink` 600 label, the others `inkMuted` and
 * `ink` on hover, with a transparent edge of the same width.
 *
 * A segment's pill is 36 px inside the track's 4 px padding, so it TAPS across the track's whole 44 px through a
 * transparent overlay (the chip's mechanism, `chipClass.ts`): the padding is part of the target, not a dead band.
 */
import { FOCUS_RING_CLASS } from '../focusRing/focusRingClass.js';
import { surfaceToneClass } from '../surfaceTone/surfaceToneClass.js';

/**
 * How a control takes the row: `share` (labelled segments split the whole row equally) or `content` (an icon-only
 * switch takes its glyphs' width and sits at the end of a result bar, `buildSpec.md` §4.3). An icon-only switch at full
 * width spanned 1,120 px for two glyphs and squeezed its neighbours (`evaluateFinal.md` F5).
 *
 * `adaptive` is a ROUTE control's own rule (W-25): it fills the row in a narrow container and takes its content's width
 * from a 600 container, where two labels spanning the whole main column read as a bar and not as a switch. The
 * threshold is the container's (`@regular/main:`), never the viewport's.
 */
export type SegmentWidth = 'share' | 'content' | 'adaptive';

/**
 * The track paints `surfaceMuted` and holds the segments, so it states that surface once (`componentFixes.md` §10): a
 * segment's focus-ring gap and press read it, instead of the canvas.
 */
const MUTED = surfaceToneClass('muted');

/** The track, per width. */
const TRACK: Readonly<Record<SegmentWidth, string>> = {
    share: `flex min-h-11 w-full items-stretch gap-1 rounded-full ${MUTED} p-1`,
    content: `inline-flex shrink-0 min-h-11 items-stretch gap-1 rounded-full ${MUTED} p-1`,
    adaptive: `flex min-h-11 w-full items-stretch gap-1 rounded-full ${MUTED} p-1 @regular/main:inline-flex @regular/main:w-auto @regular/main:shrink-0`,
};

/** How a segment takes its share of the track, per width. */
const SEGMENT_FLEX: Readonly<Record<SegmentWidth, string>> = {
    share: 'flex-1 basis-0',
    content: 'min-w-11',
    adaptive: 'min-w-11',
};

/** A route segment's share, per width: a place's label is a word, so a content-width segment keeps a 136 px floor. */
const ROUTE_SEGMENT_FLEX: Readonly<Record<SegmentWidth, string>> = {
    share: 'flex-1 basis-0',
    content: 'min-w-[8.5rem]',
    adaptive: 'flex-1 basis-0 @regular/main:flex-none @regular/main:min-w-[8.5rem]',
};

/**
 * The current segment: `paper` with its shadow, an `ink` 600 label and a 1 px `lineControl` edge. Steel is an accent, not
 * a fill, so it stays paper; but paper on the `surfaceMuted` track is about 1.18:1, which fails SC 1.4.11, and the edge
 * (3.09:1 light, 3.93:1 dark) is what makes the segment findable (`componentFixes.md` §8).
 */
const CURRENT_TONE = 'border-line-control bg-paper font-semibold text-ink shadow-sm';

/** Every other segment: `inkMuted`, and a TRANSPARENT edge of the same width, so selecting one moves nothing. */
const OTHER_TONE = 'border-transparent text-ink-muted hover:text-ink';

/**
 * Every segment. The overlay is `-inset-y-[5px]`: 4 px of track padding plus the pill's own 1 px border, because an
 * absolutely placed box is offset from the padding box, inside the border (`segmentClass.test.ts`).
 */
const SEGMENT_BASE =
    'relative inline-flex items-center justify-center gap-2 rounded-full border px-3 text-label transition ' +
    "before:absolute before:inset-x-0 before:-inset-y-[5px] before:content-[''] " +
    FOCUS_RING_CLASS.offset;

/**
 * The track's classes. Pure.
 *
 * @param width - How the control takes the row. Defaults to `share`.
 * @returns The `className`.
 */
export function trackClass(width: SegmentWidth = 'share'): string {
    return TRACK[width];
}

/**
 * A segment's classes. Pure.
 *
 * @param current - Whether it is the current place, or the presentation in use.
 * @param width - How the control takes the row. Defaults to `share`.
 * @returns The `className`.
 */
export function segmentClass(current: boolean, width: SegmentWidth = 'share'): string {
    const tone = current ? CURRENT_TONE : OTHER_TONE;

    return `${SEGMENT_BASE} ${SEGMENT_FLEX[width]} ${tone}`;
}

/**
 * A ROUTE segment's classes. Pure.
 *
 * @param current - Whether it is the current place.
 * @param width - How the control takes the row. Defaults to `share`.
 * @returns The `className`.
 */
export function routeSegmentClass(current: boolean, width: SegmentWidth = 'share'): string {
    const tone = current ? CURRENT_TONE : OTHER_TONE;

    return `${SEGMENT_BASE} ${ROUTE_SEGMENT_FLEX[width]} ${tone}`;
}
