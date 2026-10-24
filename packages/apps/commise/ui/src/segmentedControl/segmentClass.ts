/**
 * @module @commise/ui/segmented-control — the web class recipes for the segmented control (spec §1.11): a `pearl`
 * track 44 px tall, pill segments that share it equally (`room`: no label is cut or wrapped to fit a neighbour), the
 * current segment `paper` with `shadow-sm` and an `ink` 600 label, the others `inkMuted` and `ink` on hover.
 *
 * A segment's pill is 36 px inside the track's 4 px padding, so it TAPS across the track's whole 44 px through a
 * transparent overlay (the chip's mechanism, `chipClass.ts`): the padding is part of the target, not a dead band.
 */

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

/** The track, per width. */
const TRACK: Readonly<Record<SegmentWidth, string>> = {
    share: 'flex min-h-11 w-full items-stretch gap-1 rounded-full bg-surface-muted p-1',
    content: 'inline-flex shrink-0 min-h-11 items-stretch gap-1 rounded-full bg-surface-muted p-1',
    adaptive:
        'flex min-h-11 w-full items-stretch gap-1 rounded-full bg-surface-muted p-1 @regular/main:inline-flex @regular/main:w-auto @regular/main:shrink-0',
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

/** Every segment. */
const SEGMENT_BASE =
    'relative inline-flex items-center justify-center gap-2 rounded-full px-3 text-label transition ' +
    "before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] " +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2';

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
    const tone = current ? 'bg-paper font-semibold text-ink shadow-sm' : 'text-ink-muted hover:text-ink';

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
    const tone = current ? 'bg-paper font-semibold text-ink shadow-sm' : 'text-ink-muted hover:text-ink';

    return `${SEGMENT_BASE} ${ROUTE_SEGMENT_FLEX[width]} ${tone}`;
}
