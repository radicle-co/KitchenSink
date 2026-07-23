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
import { RECIPE_HOME_WIDGET_ID } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { makeViewer, type Tier } from '@kitchensink/recipe-core';
import * as Sentry from '@sentry/nextjs';
import type { Container } from 'ditox';
import { Suspense, useMemo, type ComponentType, type JSX } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { AppShell, LIVE_CAPABILITIES } from '@/components/app/AppShell';
import { useUserProfile } from '@/hooks/useUserProfile';
import { webMessages } from '@/i18n/messages';

import { HomeGreeting } from './HomeGreeting';
import { homeContainer } from './homeContainer';
import { RecipeWidgetSlot } from './RecipeWidgetSlot';
import { RoadmapWidgetSlot } from './RoadmapWidgetSlot';
import { HomeNudgeContext, SubscriptionNudge, useOncePerSessionNudge } from './SubscriptionNudge';

/**
 * Map the shared {@link Tier} authority (`@kitchensink/recipe-core`, P4 — `free` | `premium`) onto the
 * Home-widget tier ladder (`free` | `pro`). The two vocabularies differ by origin (identity/access-policy vs.
 * the widget ladder), so this mapper still exists, but it now sources `'premium'` from the ONE `Tier`
 * authority instead of re-deriving its own "is this tier premium" check against a raw string.
 */
function toWidgetTier(tier: Tier): string {
    return tier === 'premium' ? 'pro' : 'free';
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
 * Report a Home-widget render failure to Sentry (B23). A widget's `ErrorBoundary` must never swallow the
 * throw silently — an unlogged blank widget is undebuggable.
 *
 * @sideEffect Captures the error in Sentry.
 */
function captureWidgetError(error: unknown): void {
    Sentry.captureException(error);
}

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
    const nudge = useOncePerSessionNudge();

    // P4: the shared Tier authority — an absent/unrecognized subscription tier fails closed to `'free'`.
    const tier = makeViewer({ subscriptionTier: profile.data?.account.subscriptionTier }).tier;

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
        <AppShell activeId="home">
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
                            // prop wired) renders through that slot. B23 — a render throw / chunk-load reject is
                            // reported to Sentry (never swallowed) and shows a small localized fallback instead
                            // of vanishing.
                            if (Bespoke !== undefined) {
                                return (
                                    <ErrorBoundary
                                        key={descriptor.id}
                                        onError={captureWidgetError}
                                        fallback={<p className="text-body-sm text-slate">{home.surface.widgetError}</p>}
                                    >
                                        <Suspense fallback={null}>
                                            <Bespoke />
                                        </Suspense>
                                    </ErrorBoundary>
                                );
                            }

                            // A roadmap placeholder renders through its own loader seam — no bespoke slot, no
                            // second id list in the host. Its fallback stays null (nothing user-facing to lose),
                            // but a throw is still reported (B23), never silent.
                            if (isPlaceholderHomeWidget(descriptor)) {
                                return (
                                    <ErrorBoundary key={descriptor.id} onError={captureWidgetError} fallback={null}>
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
        </AppShell>
    );
}
