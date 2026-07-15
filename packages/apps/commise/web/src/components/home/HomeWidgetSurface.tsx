'use client';

/**
 * @module home/HomeWidgetSurface — the post-login Home widget-surface host (web; US-000 / FR-046).
 *
 * The composition root of the three-layer Home surface:
 *  - **discovery** — features register their widget descriptors into the ditox {@link homeContainer}
 *    ({@link import('./homeContainer.js').createHomeContainer}); resolved here via `resolveHomeWidgets`.
 *  - **composition** — `curateHomeWidgets` gates the resolved descriptors by live **capability** and the
 *    viewer's subscription **tier**, applying personalization order/hidden (owned by identity 002, absent in
 *    v1). In Home v1 only the recipe widget is registered and live; gated widgets (005–009) are **absent**,
 *    not rendered as empty tiles.
 *  - **render** — each curated descriptor is drawn through its registered slot, wrapped in a per-widget
 *    `ErrorBoundary` + `Suspense`. A curated id with **no** registered renderer is **skipped** (graceful
 *    version skew — an older client tolerates a newer personalization list).
 *
 * The surface is a client component: it needs the viewer's Clerk token to read the profile tier and the
 * recent recipes. `container` and `renderers` are injectable purely so the composition, skip, and nudge
 * logic can be unit-tested against fakes without loading the real widget chunks.
 */
import {
    curateHomeWidgets,
    resolveHomeWidgets,
    type HomeWidgetCurationContext,
    type HomeWidgetId,
} from '@commise/features-core';
import { RECIPE_HOME_WIDGET_CAPABILITY, RECIPE_HOME_WIDGET_ID } from '@commise/features-recipes';
import { useLocale, useMessages } from '@commise/i18n/react';
import type { Container } from 'ditox';
import type { Route } from 'next';
import Link from 'next/link';
import { Suspense, useMemo, type ComponentType, type JSX } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { LogoutButton } from '@/components/auth/LogoutButton';
import { useUserProfile } from '@/hooks/useUserProfile';
import { webMessages } from '@/i18n/messages';

import { homeContainer } from './homeContainer';
import { RecipeWidgetSlot } from './RecipeWidgetSlot';
import { HomeNudgeContext, SubscriptionNudge, useOncePerSessionNudge } from './SubscriptionNudge';

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
        <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 bg-[var(--color-background)] px-4 py-8">
            <header className="flex items-center justify-between gap-4">
                <h1 className="font-display text-2xl font-semibold text-charcoal">{home.surface.greeting}</h1>
                <nav aria-label={home.nav.label} className="flex items-center gap-4 text-sm">
                    <Link href={`/${locale}/recipes` as Route}>{home.nav.recipes}</Link>
                    <Link href={`/${locale}/profile` as Route}>{home.nav.profile}</Link>
                    <Link href={`/${locale}/settings` as Route}>{home.nav.settings}</Link>
                    <Link href={`/${locale}/account` as Route}>{home.nav.account}</Link>
                    <LogoutButton />
                </nav>
            </header>

            <HomeNudgeContext.Provider value={{ trigger: nudge.trigger }}>
                <section
                    role="region"
                    aria-label={home.surface.regionLabel}
                    className="grid grid-cols-1 gap-4 md:grid-cols-2"
                >
                    {curated.map((descriptor) => {
                        const Widget = renderers[descriptor.id];

                        if (Widget === undefined) {
                            // Curated (registered/personalized) but no renderer for this id on this client —
                            // skip it rather than crash, so an older client tolerates a newer widget set.
                            return null;
                        }

                        return (
                            <ErrorBoundary key={descriptor.id} fallback={null}>
                                <Suspense fallback={null}>
                                    <Widget />
                                </Suspense>
                            </ErrorBoundary>
                        );
                    })}
                </section>
            </HomeNudgeContext.Provider>

            <SubscriptionNudge open={nudge.visible} onDismiss={nudge.dismiss} />
        </main>
    );
}
