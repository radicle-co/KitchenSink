'use client';

/**
 * @module @commise/features-recipes — web browse-rail TRACK: the one horizontal scroll container a rail's cards sit
 * in, whether they are loaded cards or loading placeholders (`docs/design/uiOverhaul/buildSpec.md` §4.4).
 *
 * Both rail bodies render through this element so the pending strip and the loaded strip cannot drift apart. They
 * did once (E1, `docs/design/uiOverhaul/evaluateShellAndLists.md`): the skeleton strip had no overflow rule, so its
 * tiles widened the whole page at 320 px while only the loaded strip scrolled inside itself. The overflow belongs to
 * the track, and every tile inside it is a `shrink-0` item.
 *
 * The loaded track is the design-system `HorizontalScroller`: a focusable `region` named "{rail} recipes", whose arrow keys
 * scroll it by one card, and each card is a tab stop of its own (SC 2.1.1). It snaps card by card, the next card peeks at
 * the edge — the swipe cue on touch — and a chevron hints at the cards beyond while it rests at its start. Its element and
 * its position are handed to the rail through `RailContext`, so the rail's Previous and Next move it and read the same
 * facts. A placeholder track is `aria-hidden` and does not scroll: its tiles carry no content, its rail's live region
 * speaks for it, and it has nothing to promise.
 *
 * Presentational: the scrolling track of one rail; the scroll position is read from the host's context.
 *
 * @pattern Adapter over `HorizontalScroller` — the rail's contract (a named region, card snapping, a position report) over the design-system scroller
 */
import { useMessages } from '@commise/i18n/react';
import { HorizontalScroller } from '@commise/ui/horizontal-scroller';
import { useContext, type FC, type ReactNode } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { discoveryMessages } from './messages.js';
import { RailContext } from './railContext.js';
import { RAIL_CARD_MAX_PX, RAIL_GAP_PX } from './railScroll.js';

/** Props for {@link RailTrack}. */
export interface RailTrackProps {
    /** The track's items, each an `<li>` sized with `w-[clamp(240px,78%,256px)] shrink-0 snap-start`. */
    readonly children: ReactNode;
    /** Hide the track from assistive technology — set for the loading placeholders, whose region speaks for them. */
    readonly decorative?: boolean;
}

/**
 * The list inside the track: the same for the placeholders and the cards, so they lay out identically. The room below
 * is the scroller's own, so it is the list's.
 */
const LIST = 'flex gap-4 pb-2';

/**
 * The loaded track snaps card by card. Web snaps to the cards themselves and ignores the interval; it is the nominal card
 * pitch, which is the distance native snaps by in `RecipeBrowseRailResults.native.tsx`.
 */
const SNAP_TO_CARDS = { kind: 'card', interval: RAIL_CARD_MAX_PX + RAIL_GAP_PX } as const;

/** The horizontal, snap-scrolling list every browse rail lays its tiles out in. */
export const RailTrack: FC<RailTrackProps> = ({ children, decorative = false }) => {
    const rail = useContext(RailContext);
    const discovery = useMessages(discoveryMessages);

    // Placeholders have nothing to scroll to and nothing to promise: the box holds them at 320 px, with no hint.
    if (decorative) {
        return (
            <div aria-hidden="true" className="overflow-x-hidden">
                <ul className={LIST}>{children}</ul>
            </div>
        );
    }

    return (
        <HorizontalScroller
            snap={SNAP_TO_CARDS}
            {...(rail === undefined
                ? {}
                : {
                      regionLabel: fillTemplate(discovery.railRegion, { rail: rail.title }),
                      ...(rail.trackRef === undefined ? {} : { onScroller: rail.trackRef }),
                      ...(rail.onPosition === undefined ? {} : { onPosition: rail.onPosition }),
                  })}
        >
            <ul role="list" className={LIST}>
                {children}
            </ul>
        </HorizontalScroller>
    );
};
