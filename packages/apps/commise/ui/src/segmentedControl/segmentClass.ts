/**
 * @module @commise/ui/segmented-control — the web class recipes for the segmented control (spec §1.11): a `pearl`
 * track 44 px tall, pill segments that share it equally (`room`: no label is cut or wrapped to fit a neighbour), the
 * current segment `paper` with `shadow-sm` and an `ink` 600 label, the others `inkMuted` and `ink` on hover.
 */

/** The track. */
export const TRACK_CLASS = 'flex min-h-11 w-full items-stretch gap-1 rounded-full bg-surface-muted p-1';

/** Every segment. */
const SEGMENT_BASE =
    'inline-flex flex-1 basis-0 items-center justify-center gap-2 rounded-full px-3 text-label transition ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2';

/**
 * A segment's classes. Pure.
 *
 * @param current - Whether it is the current place, or the presentation in use.
 * @returns The `className`.
 */
export function segmentClass(current: boolean): string {
    return `${SEGMENT_BASE} ${current ? 'bg-paper font-semibold text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`;
}
