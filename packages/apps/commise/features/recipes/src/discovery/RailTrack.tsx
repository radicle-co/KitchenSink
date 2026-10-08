/**
 * @module @commise/features-recipes — web browse-rail TRACK: the one horizontal scroll container a rail's cards sit
 * in, whether they are loaded cards or loading placeholders.
 *
 * Both rail bodies render through this element so the pending strip and the loaded strip cannot drift apart. They
 * did once (E1, `docs/design/uiOverhaul/evaluateShellAndLists.md`): the skeleton strip had no overflow rule, so its
 * tiles widened the whole page at 320 px while only the loaded strip scrolled inside itself. The overflow belongs to
 * the track, and every tile inside it is a `shrink-0` item.
 *
 * A placeholder track is `aria-hidden`: its tiles carry no content, and its rail's live region speaks for it.
 * Presentational: pure props to markup.
 */
import type { FC, ReactNode } from 'react';

/** Props for {@link RailTrack}. */
export interface RailTrackProps {
    /** The track's items, each an `<li>` sized with `w-64 shrink-0`. */
    readonly children: ReactNode;
    /** Hide the track from assistive technology — set for the loading placeholders, whose region speaks for them. */
    readonly decorative?: boolean;
}

/** The horizontal, snap-scrolling list every browse rail lays its tiles out in. */
export const RailTrack: FC<RailTrackProps> = ({ children, decorative = false }) => (
    <ul className="flex snap-x gap-4 overflow-x-auto pb-2" role="list" aria-hidden={decorative || undefined}>
        {children}
    </ul>
);
