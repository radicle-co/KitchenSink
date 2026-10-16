'use client';

/**
 * @module home/HomeWidgetSurface — the post-login Home widget-surface host (web; US-000 / FR-046).
 *
 * The composition root of the three-layer Home surface:
 *  - **discovery** — features register their widget descriptors into the ditox {@link homeContainer}
 *    (`createHomeContainer`); resolved here via `resolveHomeWidgets`.
 *  - **composition** — `curateHomeWidgets` gates the resolved descriptors by live **capability** and the
 *    viewer's subscription **tier**, applying personalization order/hidden (owned by identity 002, absent in
 *    v1). In Home v1 the recipe widget is the only **live** widget; the unshipped 005–009 cohort is present
 *    as **skeleton placeholders** (CR-001) — the real widget's shape with no invented data — which gate
 *    themselves out the moment the backing service ships and the feature's live widget (same id) takes over.
 *  - **render** — each curated descriptor is drawn through a slot wrapped in a per-widget `ErrorBoundary` +
 *    `Suspense`: a live widget with a **bespoke** host slot (the recipe widget, which needs its data prop)
 *    through `renderers`; a **placeholder** through the generic {@link RoadmapWidgetSlot} loader seam. A live
 *    id with no bespoke renderer is **skipped** (graceful version skew — an older client tolerates a newer
 *    personalization list).
 *
 * The surface is a client component: it needs the viewer's Clerk token to read the profile tier and the
 * recent recipes. `container` and `renderers` are injectable purely so the composition, skip, and nudge
 * logic can be unit-tested against fakes without loading the real widget chunks.
 */
import { profileEntryOf, resolveErrorReporter, type HomeWidgetId, type RoadmapWidgetId } from '@commise/features-core';
import {
    HomeNudgeContext,
    useHomeWidgets,
    useOncePerSessionNudge,
    type HomeWidgetSlot,
} from '@commise/features-core/home';
import { RECIPE_HOME_WIDGET_ID, RecipeCreateButton } from '@commise/features-recipes';
import { useLibraryEmpty } from '@commise/features-recipes/hooks';
import { LIVE_CAPABILITIES } from '@commise/features-recipes/widget';
import { useLocale, useMessages } from '@commise/i18n/react';
import { paidFeatureStateOf } from '@commise/features-account';
import { recipeServiceKeys } from '@kitchensink/recipe-service-client';
import type { Container } from 'ditox';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { Suspense, useId, type ComponentType, type JSX, type ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { AppShell } from '@/components/app/AppShell';
import { useUserProfile } from '@/hooks/useUserProfile';
import { webMessages } from '@/i18n/messages';

import { ProfileAvatarEntry } from './chrome/ProfileAvatarEntry';
import { HomeGreeting } from './HomeGreeting';
import { homeContainer } from './homeContainer';
import { HomeWidgetErrorNotice } from './HomeWidgetErrorNotice';
import { RECENT_RECIPE_LIMIT, RecipeWidgetSlot } from './RecipeWidgetSlot';
import { RoadmapWidgetSlot } from './RoadmapWidgetSlot';
import { SubscriptionNudge } from './SubscriptionNudge';

/** Props for {@link HomeWidgetSurface}. Both are injectable seams for tests; production uses the defaults. */
export interface HomeWidgetSurfaceProps {
    /** The appShell container to resolve widget descriptors from. Defaults to the app singleton. */
    readonly container?: Container;
    /** Map of widget id → the slot component that renders it. Defaults to the v1 renderer set. */
    readonly renderers?: Readonly<Record<HomeWidgetId, ComponentType>>;
}

/**
 * Where each placeholder sits in the Coming soon group at `@wide`: nutrition and resume side by side 1 : 2, the week
 * strip full width under them (`buildSpec.md` §4.2). Below `@wide` the group stacks. A total `Record`, so a roadmap
 * widget added without a place does not compile.
 */
const COMING_SOON_SPAN: Readonly<Record<RoadmapWidgetId, string>> = {
    nutrition: '@wide/main:col-span-1',
    'resume-cooking': '@wide/main:col-span-2',
    'meal-plan': '@wide/main:col-span-3',
};

/**
 * The `@wide` span of a placeholder, by its id. An id outside the roadmap registry spans the whole row.
 *
 * @param id - The placeholder's widget id.
 * @returns Its grid-column class. Pure.
 */
function comingSoonSpanOf(id: string): string {
    return Object.entries(COMING_SOON_SPAN).find(([key]) => key === id)?.[1] ?? '@wide/main:col-span-3';
}

/** The v1 render map: the recipe widget is the only one with a slot. */
const DEFAULT_RENDERERS: Readonly<Record<HomeWidgetId, ComponentType>> = {
    [RECIPE_HOME_WIDGET_ID]: RecipeWidgetSlot,
};

/**
 * The Home widget surface.
 *
 * @param props - Optional injectable `container` / `renderers` seams (tests only).
 * @returns The greeting header, the capability/tier-gated widget grid, and the once-per-session nudge.
 */
export function HomeWidgetSurface({
    container = homeContainer,
    renderers = DEFAULT_RENDERERS,
}: HomeWidgetSurfaceProps = {}): JSX.Element {
    const { home } = useMessages(webMessages);
    const profile = useUserProfile();
    const locale = useLocale();
    const router = useRouter();
    const cookName = profileEntryOf(profile).name;

    // Plan 2026-10-14-009 D13: the viewer's paid features alone decide the widget tier and whether the upsell nudge is
    // offered (owner ruling 2026-10-13). While the profile loads, or if it failed, neither is.
    const paidFeatures = paidFeatureStateOf(profile);
    const nudge = useOncePerSessionNudge(paidFeatures === 'upsell');

    // B23/DA9 — a widget render throw must never be silent. Resolved from the injected `errorReporterToken`
    // (never a hard-coded Sentry import), mirroring the mobile host so both platforms share ONE seam.
    const reportWidgetError = resolveErrorReporter(container);

    // The recent-recipes page the widget reads, from the cache: settled empty is Home's first run (§3.4).
    const firstRun = useLibraryEmpty(recipeServiceKeys.recipeList({ pageSize: RECENT_RECIPE_LIMIT }));

    const curated = useHomeWidgets({ container, renderers, liveCapabilities: LIVE_CAPABILITIES, paidFeatures });
    const comingSoonHeadingId = useId();

    /**
     * One widget: a live one through its bespoke slot, a placeholder through its loader seam. Which of the two (and
     * whether a live id can be drawn at all) is `useHomeWidgets`' decision, shared with mobile; the boundary is ours.
     *
     * @param slot - The curated slot.
     * @returns Its boundary-wrapped render.
     */
    const renderWidget = (slot: HomeWidgetSlot): ReactNode => {
        const { descriptor } = slot;

        // A widget with a bespoke host slot (the live recipe widget, which needs its data
        // prop wired) renders through that slot. B23/DA9 — a render throw / chunk-load
        // reject is reported through the injected reporter (never swallowed) and shows the
        // localized `HomeWidgetErrorNotice` instead of vanishing. That notice is a
        // component, not inline JSX, because the recipe slot's inner boundary renders the
        // SAME stand-in: one piece of knowledge ("what a broken widget looks and sounds
        // like"), so it gets one representation — and it is ANNOUNCED (`role="status"`),
        // matching mobile, since a failure arriving mid-session is otherwise silent to
        // assistive tech.
        if (slot.kind === 'bespoke') {
            const { Widget } = slot;

            return (
                <ErrorBoundary
                    key={descriptor.id}
                    onError={(error) => reportWidgetError(error, { widget: descriptor.id })}
                    fallback={<HomeWidgetErrorNotice />}
                >
                    <Suspense fallback={null}>
                        <Widget />
                    </Suspense>
                </ErrorBoundary>
            );
        }

        // A roadmap placeholder renders through its own loader seam — no bespoke slot, no
        // second id list in the host. Its fallback stays `null` — deliberately NOT the
        // notice above, and matched by mobile: a skeleton is itself a stand-in for a
        // feature that has not shipped, so a notice here would announce the failure of
        // something the viewer was never promised. The asymmetry is pinned by a test on
        // both platforms. A throw is still reported (B23/DA9), never silent.
        return (
            <ErrorBoundary
                key={descriptor.id}
                onError={(error) => reportWidgetError(error, { widget: descriptor.id })}
                fallback={null}
            >
                <Suspense fallback={null}>
                    <RoadmapWidgetSlot descriptor={descriptor} />
                </Suspense>
            </ErrorBoundary>
        );
    };

    return (
        <AppShell activeId="home" titleId="home">
            {/* Left-aligned to the gutter at `content-page` (1440), never centred (`buildSpec.md` §1.3, F21). */}
            <div className="flex w-full max-w-page flex-col gap-6">
                {/* The large title: the greeting is the page's H1 (`buildSpec.md` §4.2), the avatar its action below 840,
                    and the floating create button right after it in DOM order — drawn at the bottom corner. One tap
                    opens the empty editor (§3.4, slice 8). First run hides it (§3.4): the recent-recipes page the widget
                    reads, settled empty. */}
                <HomeGreeting
                    {...(cookName === undefined ? {} : { name: cookName })}
                    action={{ kind: 'avatar', avatar: <ProfileAvatarEntry /> }}
                    afterTitle={
                        <RecipeCreateButton
                            firstRun={firstRun}
                            onCreateRecipe={() => router.push(`/${locale}/recipes/new` as Route)}
                        />
                    }
                />

                <HomeNudgeContext.Provider value={{ trigger: nudge.trigger }}>
                    <section role="region" aria-label={home.surface.regionLabel} className="flex flex-col gap-6">
                        {curated.live.map(renderWidget)}

                        {/* The placeholders sit together, AFTER the recent recipes, under one "Coming soon" heading
                            (owner ruling; `buildSpec.md` §4.2). Gone with the last placeholder. */}
                        {curated.comingSoon.length > 0 && (
                            <section aria-labelledby={comingSoonHeadingId} className="flex flex-col gap-4">
                                <div className="flex flex-col gap-1">
                                    <h2 id={comingSoonHeadingId} className="text-section-title text-ink">
                                        {home.roadmap.comingSoonHeading}
                                    </h2>
                                    <p className="max-w-[62ch] text-body text-ink-muted">
                                        {home.roadmap.comingSoonBody}
                                    </p>
                                </div>
                                <div className="grid gap-4 @wide/main:grid-cols-3 @wide/main:gap-6">
                                    {curated.comingSoon.map((slot) => (
                                        <div key={slot.descriptor.id} className={comingSoonSpanOf(slot.descriptor.id)}>
                                            {renderWidget(slot)}
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}
                    </section>
                </HomeNudgeContext.Provider>

                <SubscriptionNudge open={nudge.visible} onDismiss={nudge.dismiss} />
            </div>
        </AppShell>
    );
}
