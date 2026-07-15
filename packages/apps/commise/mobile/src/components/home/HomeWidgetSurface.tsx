/**
 * @module home/HomeWidgetSurface — the post-login Home widget-surface host (mobile; US-000 / FR-046).
 *
 * The composition root of the three-layer Home surface, mirroring the web host:
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
 * `container` and `renderers` are injectable purely so the composition, skip, and nudge logic can be
 * unit-tested against fakes without loading the real widget chunks. The host reads the viewer's tier from the
 * mobile profile hook and threads `onSeeAllRecipes` down to the recipe slot's navigation affordance.
 */
import {
    curateHomeWidgets,
    resolveHomeWidgets,
    type HomeWidgetCurationContext,
    type HomeWidgetId,
} from '@commise/features-core';
import { RECIPE_HOME_WIDGET_CAPABILITY, RECIPE_HOME_WIDGET_ID } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { Container } from 'ditox';
import { Suspense, useMemo, type ComponentType, type JSX } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { mobileMessages } from '../../i18n/messages.js';
import { useUserProfile } from '../../hooks/useUserProfile.js';
import { homeContainer } from './homeContainer.js';
import { RecipeWidgetSlot } from './RecipeWidgetSlot.js';
import { HomeNudgeContext, SubscriptionNudge, useOncePerSessionNudge } from './SubscriptionNudge.js';

/**
 * Capabilities whose backing service is live in Home v1. Only the recipe service ships now; each feature
 * (005–009) adds its capability here when it deploys, and `curateHomeWidgets` then reveals its widget.
 */
const LIVE_CAPABILITIES: readonly string[] = [RECIPE_HOME_WIDGET_CAPABILITY];

/**
 * Map an identity subscription tier (`free` | `premium`) onto the Home-widget tier ladder (`free` | `pro`).
 * The two vocabularies differ by origin (identity vs. the widget ladder); an absent tier is treated as free.
 *
 * @param subscriptionTier - The identity subscription tier, if known.
 * @returns The corresponding Home-widget tier.
 */
function toWidgetTier(subscriptionTier: string | undefined): string {
    return subscriptionTier === 'premium' ? 'pro' : 'free';
}

/** Props for {@link HomeWidgetSurface}. `container`/`renderers` are injectable seams for tests. */
export interface HomeWidgetSurfaceProps {
    /** Invoked when the recipe widget's "see all recipes" entry is activated (host wires to navigation). */
    readonly onSeeAllRecipes: () => void;
    /** The appShell container to resolve widget descriptors from. Defaults to the app singleton. */
    readonly container?: Container;
    /** Map of widget id → the slot component that renders it. Defaults to the v1 renderer set. */
    readonly renderers?: Readonly<Record<HomeWidgetId, ComponentType>>;
}

/**
 * The Home widget surface.
 *
 * @param props - The `onSeeAllRecipes` callback plus optional injectable `container` / `renderers` seams.
 * @returns The greeting header, the capability/tier-gated widget list, and the once-per-session nudge.
 */
export function HomeWidgetSurface({
    onSeeAllRecipes,
    container = homeContainer,
    renderers,
}: HomeWidgetSurfaceProps): JSX.Element {
    const { home } = useMessages(mobileMessages);
    const profile = useUserProfile();
    const nudge = useOncePerSessionNudge();

    const tier = profile.data?.account.subscriptionTier;

    // The v1 render map: the recipe widget is the only one with a slot. Built here (not a module const like
    // the web host's) because the recipe slot needs `onSeeAllRecipes` threaded through the generic renderer.
    const defaultRenderers = useMemo<Readonly<Record<HomeWidgetId, ComponentType>>>(
        () => ({ [RECIPE_HOME_WIDGET_ID]: () => <RecipeWidgetSlot onSeeAllRecipes={onSeeAllRecipes} /> }),
        [onSeeAllRecipes],
    );

    const activeRenderers = renderers ?? defaultRenderers;

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
        <View style={styles.screen}>
            <Text accessibilityRole="header" style={styles.greeting}>
                {home.greeting}
            </Text>

            <HomeNudgeContext.Provider value={{ trigger: nudge.trigger }}>
                <ScrollView
                    accessibilityLabel={home.regionLabel}
                    style={styles.region}
                    contentContainerStyle={styles.regionContent}
                >
                    {curated.map((descriptor) => {
                        const Widget = activeRenderers[descriptor.id];

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
                </ScrollView>
            </HomeNudgeContext.Provider>

            <SubscriptionNudge open={nudge.visible} onDismiss={nudge.dismiss} />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.sand },
    greeting: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 12,
        fontSize: 24,
        fontWeight: '600',
        color: palette.charcoal,
    },
    region: { flex: 1 },
    regionContent: { paddingHorizontal: 16, paddingBottom: 24, gap: 16 },
});
