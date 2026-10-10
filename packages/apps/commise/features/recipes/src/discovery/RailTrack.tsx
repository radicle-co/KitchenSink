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
 * The loaded track is a focusable `region` named "{rail} recipes", the arrow keys scroll it by one card, and each card
 * is a tab stop of its own (SC 2.1.1). It scrolls with proximity-mandatory snapping, and the next card peeks at the
 * edge — the swipe cue on touch. Its element is handed to the rail through `RailContext`, so the rail's Previous and Next
 * move it. A placeholder track is `aria-hidden`: its tiles carry no content, and its rail's live region speaks for it.
 *
 * Presentational: the scrolling track of one rail; the scroll position is read from the host's context.
 *
 * @pattern Adapter over a scroll container's keyboard model — the arrow keys call `scrollBy`
 */
import { useMessages } from '@commise/i18n/react';
import { useContext, type FC, type KeyboardEvent, type ReactNode } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { discoveryMessages } from './messages.js';
import { RailContext } from './railContext.js';
import { cardStepOf } from './railScroll.js';
import { firstCardWidthOf, scrollBehaviorOf } from './useRailScroll.js';

/** Props for {@link RailTrack}. */
export interface RailTrackProps {
    /** The track's items, each an `<li>` sized with `w-[clamp(240px,78%,256px)] shrink-0 snap-start`. */
    readonly children: ReactNode;
    /** Hide the track from assistive technology — set for the loading placeholders, whose region speaks for them. */
    readonly decorative?: boolean;
}

/** The scroll container: identical for the placeholders and the cards. */
const TRACK =
    'overflow-x-auto snap-x snap-mandatory scroll-px-4 pb-2 focus-visible:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-focus-ring';

/** The list inside it. */
const LIST = 'flex gap-4';

/**
 * Scroll the track by one card on a left or right arrow. In a right-to-left page the arrows keep their physical
 * direction, as every scroller does.
 *
 * @param event - The key press on the track.
 * @sideEffect Scrolls the track.
 */
function scrollOneCard(event: KeyboardEvent<HTMLElement>): void {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;

    if (direction === 0 || event.target !== event.currentTarget) {
        return;
    }

    event.preventDefault();
    event.currentTarget.scrollBy({
        left: direction * cardStepOf(firstCardWidthOf(event.currentTarget), event.currentTarget.clientWidth),
        behavior: scrollBehaviorOf(),
    });
}

/** The horizontal, snap-scrolling list every browse rail lays its tiles out in. */
export const RailTrack: FC<RailTrackProps> = ({ children, decorative = false }) => {
    const rail = useContext(RailContext);
    const discovery = useMessages(discoveryMessages);

    if (decorative) {
        return (
            <div aria-hidden="true" className={TRACK}>
                <ul className={LIST}>{children}</ul>
            </div>
        );
    }

    return (
        <div
            ref={rail?.trackRef}
            {...(rail === undefined
                ? {}
                : {
                      role: 'region',
                      'aria-label': fillTemplate(discovery.railRegion, { rail: rail.title }),
                      tabIndex: 0,
                  })}
            onKeyDown={scrollOneCard}
            className={TRACK}
        >
            <ul role="list" className={LIST}>
                {children}
            </ul>
        </div>
    );
};
