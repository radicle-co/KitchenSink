'use client';

/**
 * @module @commise/features-recipes — web curated browse-rails block (presentational, U7).
 *
 * The default discovery surface when nothing is searched: three fixed-sort rails (Trending/New/Quick), each a section
 * heading with a "see all" over the rail's BODY, then a row of cuisine shortcuts, plus ONE notice for a failed refresh
 * of the block. Each body is what that rail's own read boundary renders (`RecipeBrowseRailLoading`,
 * `RecipeBrowseRailLoadError` or `RecipeBrowseRailResults`), so a rail loads and fails on its own while every heading
 * stays put. It fetches nothing. Same contract as the native leaf so the two cannot drift.
 */
import { useMessages } from '@commise/i18n/react';
import { useFocusOnSignal } from '@commise/ui/dialog-focus';
import { EnterTransition } from '@commise/ui/motion';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { GradientSurface } from '@commise/ui/surface';
import type { FC, Ref } from 'react';

import { fillTemplate } from '../list/model.js';
import { discoveryMessages, type DiscoveryMessages } from './messages.js';
import type { RecipeBrowseRailId, RecipeBrowseRailsProps, RecipeBrowseRailView } from './model.js';

/**
 * A browse section heading: the Playfair title over a short brand-gradient accent bar (U8). The accent is a
 * decorative, unlabelled {@link GradientSurface} (empty + role-less ⇒ ignored by assistive tech).
 */
const SectionHeading: FC<{ readonly title: string; readonly headingRef?: Ref<HTMLHeadingElement> }> = ({
    title,
    headingRef,
}) => (
    <div className="flex flex-col gap-1.5">
        <h2 ref={headingRef} tabIndex={-1} className="font-display text-heading-md font-semibold text-charcoal">
            {title}
        </h2>
        <GradientSurface gradient="brand" className="h-1 w-10 rounded-full" />
    </div>
);

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

/** One curated rail: its heading and "see all" over its body. */
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

    return (
        <section className="flex flex-col gap-3">
            <header className="flex items-center justify-between">
                <SectionHeading title={title} headingRef={headingRef} />
                <button
                    type="button"
                    aria-label={fillTemplate(discovery.seeAllLabel, { rail: title })}
                    onClick={rail.onSeeAll}
                    className="inline-flex min-h-11 items-center rounded-full px-3 py-1 text-body-sm font-semibold text-ocean-dark transition hover:bg-mist/20 md:min-h-0"
                >
                    {discovery.seeAll}
                </button>
            </header>
            {rail.body}
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
                        <SectionHeading title={discovery.cuisinesTitle} />
                        <div className="flex flex-wrap gap-2">
                            {cuisines.map((cuisine) => (
                                <button
                                    key={cuisine.value}
                                    type="button"
                                    aria-label={fillTemplate(discovery.cuisineShortcutLabel, {
                                        cuisine: cuisine.value,
                                    })}
                                    onClick={cuisine.onSelect}
                                    className="inline-flex min-h-11 items-center rounded-full bg-pearl px-4 py-2 text-body-sm font-medium text-charcoal transition hover:bg-mist/40 md:min-h-0"
                                >
                                    {cuisine.value}
                                </button>
                            ))}
                        </div>
                    </section>
                </EnterTransition>
            )}
        </section>
    );
};
