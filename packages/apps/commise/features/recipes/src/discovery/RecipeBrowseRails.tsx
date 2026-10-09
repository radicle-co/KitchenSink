'use client';

/**
 * @module @commise/features-recipes — web curated browse-rails block (presentational, U7; slice 5 of the UI overhaul).
 *
 * The default discovery surface when nothing is searched: three fixed-sort rails (Trending/New/Quick), each an H2 with
 * "See all" over the rail's BODY, then "Browse by cuisine" as a scrolling row of chips, plus ONE notice for a failed
 * refresh of the block (`docs/design/uiOverhaul/buildSpec.md` §4.4). Each body is what that rail's own read boundary
 * renders (`RecipeBrowseRailLoading`, `RecipeBrowseRailLoadError` or `RecipeBrowseRailResults`), so a rail loads and fails
 * on its own while every heading stays put. It fetches nothing.
 *
 * A fine pointer also gets Previous and Next (36 px round ghost buttons before "See all"); they move the rail's track one
 * view less one card and disable at the ends. The track is inside the body's boundary and the buttons outside it, so the
 * rail hands its body a `RailContext` and the track gives the rail its element back.
 *
 * @pattern Provider — each rail carries its title and its track hook to the track its body renders
 * @pattern Adapter over a scroll container — `useRailScroll` reads and moves the track
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Chip, ChipRow } from '@commise/ui/chip';
import { useFocusOnSignal } from '@commise/ui/dialog-focus';
import { Icon } from '@commise/ui/icon';
import { EnterTransition } from '@commise/ui/motion';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { useState, type FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { discoveryMessages, type DiscoveryMessages } from './messages.js';
import type { RecipeBrowseRailId, RecipeBrowseRailsProps, RecipeBrowseRailView } from './model.js';
import { RailContext } from './railContext.js';
import { useRailScroll } from './useRailScroll.js';

/** Visible title for each rail (S). */
const railTitle = (id: RecipeBrowseRailId, m: DiscoveryMessages): string => {
    switch (id) {
        case 'trending':
            return m.railTrending;
        case 'new':
            return m.railNew;
        case 'quick':
            return m.railQuick;
    }
};

/**
 * Milliseconds each successive browse section is held back, so the surface assembles itself rather than
 * flashing four sections in at once (U8 motion pass). Applied by {@link EnterTransition}, which gates the
 * whole gesture on `motion-safe:`.
 */
const SECTION_STAGGER_MS = 80;

/** A 36 px round ghost button, for a fine pointer only (`pointer-fine:`); a touch screen has the swipe and the peek. */
const ROUND =
    'hidden size-9 shrink-0 items-center justify-center rounded-full text-ink hover:bg-ink/6 pointer-fine:inline-flex ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring aria-disabled:opacity-40 ' +
    'aria-disabled:hover:bg-transparent';

/** One curated rail: its heading, Previous and Next, and "see all" over its body. */
const Rail: FC<{
    readonly rail: RecipeBrowseRailView;
    /**
     * The block's own recoveries this rail's heading also answers to: the FIRST rail's heading is where focus lands after
     * a recovered block refresh, and every other rail passes 0. Added to the rail's own signal — both are counters that
     * only grow, so their sum changes whenever either does.
     */
    readonly blockRecoveries: number;
}> = ({ rail, blockRecoveries }) => {
    const discovery = useMessages(discoveryMessages);
    const title = railTitle(rail.id, discovery);
    const headingRef = useFocusOnSignal<HTMLHeadingElement>(rail.headingFocusSignal + blockRecoveries);
    // The track's element, handed up by the track as the body renders it. State, not a ref: the buttons must re-render
    // when the loading track gives way to the loaded one.
    const [track, setTrack] = useState<HTMLElement | null>(null);
    const scroll = useRailScroll(track);

    return (
        <section className="flex flex-col gap-3">
            <header className="flex items-center gap-2">
                <h2 ref={headingRef} tabIndex={-1} className="min-w-0 flex-1 text-section-title text-ink">
                    {title}
                </h2>
                <button
                    type="button"
                    aria-label={discovery.previous}
                    aria-disabled={scroll.atStart}
                    onClick={() => {
                        if (!scroll.atStart) {
                            scroll.by(-1);
                        }
                    }}
                    className={ROUND}
                >
                    <Icon name="chevronLeft" size={20} />
                </button>
                <button
                    type="button"
                    aria-label={discovery.next}
                    aria-disabled={scroll.atEnd}
                    onClick={() => {
                        if (!scroll.atEnd) {
                            scroll.by(1);
                        }
                    }}
                    className={ROUND}
                >
                    <Icon name="chevronRight" size={20} />
                </button>
                <Button
                    variant="ghost"
                    size="sm"
                    accessibilityLabel={fillTemplate(discovery.seeAllLabel, { rail: title })}
                    onPress={rail.onSeeAll}
                >
                    {discovery.seeAll}
                </Button>
            </header>
            <RailContext value={{ title, trackRef: setTrack }}>{rail.body}</RailContext>
        </section>
    );
};

/**
 * The curated browse rails + cuisine shortcuts (web).
 *
 * @param props - The rails with their bodies, the cuisine shortcuts, and the block's refresh notice.
 */
export const RecipeBrowseRails: FC<RecipeBrowseRailsProps> = ({ rails, cuisines, refreshNotice }) => {
    const discovery = useMessages(discoveryMessages);
    // A retry from the refresh notice that succeeds removes the button the viewer pressed, so focus goes to the first
    // rail's heading.
    const recoveries = refreshNotice?.recoveries ?? 0;

    return (
        <section aria-label={discovery.browseLabel} className="flex flex-col gap-8">
            {refreshNotice !== undefined && (
                <RefreshNotice
                    failed={refreshNotice.failed}
                    refreshing={refreshNotice.refreshing}
                    onRetry={refreshNotice.onRetry}
                    labels={{ failed: discovery.railsRefreshError, retry: discovery.retry }}
                />
            )}
            {/* U8 motion pass: each section rises + fades in, staggered, via the DS `EnterTransition` — which
                owns the `motion-safe:` gate, so a reduce-motion viewer simply gets the settled surface. */}
            {rails.map((rail, index) => (
                <EnterTransition key={rail.id} delayMs={index * SECTION_STAGGER_MS}>
                    <Rail rail={rail} blockRecoveries={index === 0 ? recoveries : 0} />
                </EnterTransition>
            ))}
            {cuisines.length > 0 && (
                <EnterTransition delayMs={rails.length * SECTION_STAGGER_MS}>
                    <section className="flex flex-col gap-3">
                        <h2 className="text-section-title text-ink">{discovery.cuisinesTitle}</h2>
                        <ChipRow mode="filter" label={discovery.cuisinesTitle} overflow="scroll">
                            {cuisines.map((cuisine) => (
                                <Chip
                                    key={cuisine.value}
                                    kind="filter"
                                    label={cuisine.value}
                                    selected={false}
                                    onPress={cuisine.onSelect}
                                />
                            ))}
                        </ChipRow>
                    </section>
                </EnterTransition>
            )}
        </section>
    );
};
