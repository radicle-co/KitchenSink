'use client';

/**
 * @module home/HomeWidgetSurface — the post-login Home widget-surface host (web; US-000 / FR-046).
 *
 * The composition root of the three-layer Home surface:
 *  - **discovery** — features register their widget descriptors into the ditox {@link homeContainer}
 *    ({@link import('./homeContainer.js').createHomeContainer}); resolved here via `resolveHomeWidgets`.
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
import {
    curateHomeWidgets,
    isPlaceholderHomeWidget,
    resolveHomeWidgets,
    type HomeWidgetCurationContext,
    type HomeWidgetId,
} from '@commise/features-core';
import { RECIPE_HOME_WIDGET_CAPABILITY, RECIPE_HOME_WIDGET_ID } from '@commise/features-recipes';
import { useLocale, useMessages } from '@commise/i18n/react';
import type { Container } from 'ditox';
import { Suspense, useMemo, type ComponentType, type JSX } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { useUserProfile } from '@/hooks/useUserProfile';
import { webMessages } from '@/i18n/messages';

import { HomeChrome } from './chrome/HomeChrome';
import { HomeGreeting } from './HomeGreeting';
import { homeContainer } from './homeContainer';
import { RecipeWidgetSlot } from './RecipeWidgetSlot';
import { RoadmapWidgetSlot } from './RoadmapWidgetSlot';
import { HomeNudgeContext, SubscriptionNudge, useOncePerSessionNudge } from './SubscriptionNudge';

/** The active destination this surface represents in the Home navigation. */
const HOME_NAV_ACTIVE_ID = 'home' as const;

/**
 * Capabilities whose backing service is live in Home v1. Only the recipe service ships now; each feature
 * (005–009) adds its capability here when it deploys, and `curateHomeWidgets` then reveals its widget.
 */
const LIVE_CAPABILITIES: readonly string[] = [RECIPE_HOME_WIDGET_CAPABILITY];

/**
 * Map an identity subscription tier (`free` | `premium`) onto the Home-widget tier ladder (`free` | `pro`).
 * The two vocabularies differ by origin (identity vs. the widget ladder); an absent tier is treated as free.
 */
function toWidgetTier(subscriptionTier: string | undefined): string {
    return subscriptionTier === 'premium' ? 'pro' : 'free';
}

/** Props for {@link HomeWidgetSurface}. Both are injectable seams for tests; production uses the defaults. */
export interface HomeWidgetSurfaceProps {
    /** The appShell container to resolve widget descriptors from. Defaults to the app singleton. */
    readonly container?: Container;
    /** Map of widget id → the slot component that renders it. Defaults to the v1 renderer set. */
    readonly renderers?: Readonly<Record<HomeWidgetId, ComponentType>>;
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
    const locale = useLocale();
    const profile = useUserProfile();
    const nudge = useOncePerSessionNudge();

    const tier = profile.data?.account.subscriptionTier;
    const displayName = profile.data?.user.displayName;

    const curated = useMemo(() => {
        const ctx: HomeWidgetCurationContext = {
            liveCapabilities: [...LIVE_CAPABILITIES],
            tier: toWidgetTier(tier),
            // order/hidden personalization lives in the identity profile preferences (002); absent in v1 →
            // widgets fall back to their `defaultWeight` order.
        };

        return curateHomeWidgets(resolveHomeWidgets(container), ctx);
    }, [container, tier]);

    return (
        <HomeChrome
            chrome={home.chrome}
            locale={locale}
            liveCapabilities={LIVE_CAPABILITIES}
            activeId={HOME_NAV_ACTIVE_ID}
            displayName={displayName}
        >
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
                {/*
                 * The authenticated Home's accessible page title (US-000 / FR-046). Visually hidden — the
                 * mockup leads with the personalized time-of-day greeting, not an app-name banner — but
                 * present so the page carries a proper top-level <h1> for assistive tech (the greeting is an
                 * <h2> beneath it) and so "landed on Home" is a stable, non-temporal assertion for the auth
                 * E2E (the greeting text is clock- and locale-dependent).
                 */}
                <h1 className="sr-only">{home.welcome}</h1>
                <HomeGreeting />

                <HomeNudgeContext.Provider value={{ trigger: nudge.trigger }}>
                    <section role="region" aria-label={home.surface.regionLabel} className="flex flex-col gap-6">
                        {curated.map((descriptor) => {
                            const Bespoke = renderers[descriptor.id];

                            // A widget with a bespoke host slot (the live recipe widget, which needs its data
                            // prop wired) renders through that slot.
                            if (Bespoke !== undefined) {
                                return (
                                    <ErrorBoundary key={descriptor.id} fallback={null}>
                                        <Suspense fallback={null}>
                                            <Bespoke />
                                        </Suspense>
                                    </ErrorBoundary>
                                );
                            }

                            // A roadmap placeholder renders through its own loader seam — no bespoke slot, no
                            // second id list in the host.
                            if (isPlaceholderHomeWidget(descriptor)) {
                                return (
                                    <ErrorBoundary key={descriptor.id} fallback={null}>
                                        <Suspense fallback={null}>
                                            <RoadmapWidgetSlot descriptor={descriptor} />
                                        </Suspense>
                                    </ErrorBoundary>
                                );
                            }

                            // A live widget id with no bespoke renderer on this client — skip it rather than
                            // crash, so an older client tolerates a newer personalization list (version skew).
                            return null;
                        })}
                    </section>
                </HomeNudgeContext.Provider>

                <SubscriptionNudge open={nudge.visible} onDismiss={nudge.dismiss} />
            </div>
        </HomeChrome>
    );
}
