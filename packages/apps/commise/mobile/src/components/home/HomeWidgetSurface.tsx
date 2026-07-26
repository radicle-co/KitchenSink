/**
 * @module home/HomeWidgetSurface — the post-login Home widget-surface host (mobile; US-000 / FR-046).
 *
 * The composition root of the three-layer Home surface, mirroring the web host:
 *  - **discovery** — features register their widget descriptors into the ditox {@link homeContainer};
 *    resolved here via `resolveHomeWidgets`.
 *  - **composition** — `curateHomeWidgets` gates the resolved descriptors by live **capability** and the
 *    viewer's subscription **tier**. In Home v1 the recipe widget is the only **live** widget; the unshipped
 *    005–009 cohort is present as **skeleton placeholders** (CR-001) that gate themselves out the moment the
 *    backing service ships and the feature's live widget (same id) takes over.
 *  - **render** — each curated descriptor is drawn through a slot wrapped in a per-widget `ErrorBoundary`:
 *    a live widget with a **bespoke** slot (the recipe widget, which needs its data + nav) through
 *    `renderers`; a **placeholder** through the generic {@link RoadmapWidgetSlot} loader seam. A live id with
 *    no bespoke renderer is **skipped** (graceful version skew).
 *
 * The host also renders the chrome (top bar + bottom tab bar) and the time-of-day greeting, and threads the
 * navigation intents (`onSeeAllRecipes`, `onOpenAccount`) down to the recipe slot and the tab bar.
 * `container` and `renderers` are injectable seams for tests.
 */
import {
    curateHomeWidgets,
    isPlaceholderHomeWidget,
    resolveErrorReporter,
    resolveHomeWidgets,
    type HomeNavItemId,
    type HomeWidgetCurationContext,
    type HomeWidgetId,
} from '@commise/features-core';
import { RECIPE_HOME_WIDGET_CAPABILITY, RECIPE_HOME_WIDGET_ID } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { GradientSurface } from '@commise/ui/surface';
import { makeViewer, type Tier } from '@kitchensink/recipe-core';
import type { Container } from 'ditox';
import { useMemo, type ComponentType, type JSX } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { mobileMessages } from '../../i18n/messages.js';
import { useUserProfile } from '../../hooks/useUserProfile.js';
import { HomeGreeting } from './HomeGreeting.js';
import { HomeTabBar } from './chrome/HomeTabBar.js';
import { HomeTopBar } from './chrome/HomeTopBar.js';
import { homeContainer } from './homeContainer.js';
import { RecipeWidgetSlot } from './RecipeWidgetSlot.js';
import { RoadmapWidgetSlot } from './RoadmapWidgetSlot.js';
import { HomeNudgeContext, SubscriptionNudge, useOncePerSessionNudge } from './SubscriptionNudge.js';

/**
 * Capabilities whose backing service is live in Home v1. Only the recipe service ships now; each feature
 * (005–009) adds its capability here when it deploys, and `curateHomeWidgets` then reveals its widget.
 */
const LIVE_CAPABILITIES: readonly string[] = [RECIPE_HOME_WIDGET_CAPABILITY];

/** The active destination this surface represents in the Home navigation. */
const HOME_NAV_ACTIVE_ID: HomeNavItemId = 'home';

/**
 * Map the shared {@link Tier} authority (`@kitchensink/recipe-core`, P4 — `free` | `premium`) onto the
 * Home-widget tier ladder (`free` | `pro`). The two vocabularies differ by origin (identity/access-policy vs.
 * the widget ladder), so this mapper still exists, but it now sources `'premium'` from the ONE `Tier`
 * authority instead of re-deriving its own "is this tier premium" check against a raw string.
 *
 * @param tier - The viewer's shared `Tier`.
 * @returns The corresponding Home-widget tier.
 */
function toWidgetTier(tier: Tier): string {
    return tier === 'premium' ? 'pro' : 'free';
}

/** Props for {@link HomeWidgetSurface}. `container`/`renderers` are injectable seams for tests. */
export interface HomeWidgetSurfaceProps {
    /** Invoked when the recipe widget's "see all recipes" entry (or the Recipes tab) is activated. */
    readonly onSeeAllRecipes: () => void;
    /** Invoked when the account avatar or the Profile tab is activated. */
    readonly onOpenAccount: () => void;
    /** The appShell container to resolve widget descriptors from. Defaults to the app singleton. */
    readonly container?: Container;
    /** Map of widget id → the bespoke slot component that renders it. Defaults to the v1 renderer set. */
    readonly renderers?: Readonly<Record<HomeWidgetId, ComponentType>>;
}

/**
 * The Home widget surface (mobile).
 *
 * @param props - The navigation intents plus optional injectable `container` / `renderers` seams.
 * @returns The chrome, the greeting, the capability/tier-gated widget list, and the once-per-session nudge.
 */
export function HomeWidgetSurface({
    onSeeAllRecipes,
    onOpenAccount,
    container = homeContainer,
    renderers,
}: HomeWidgetSurfaceProps): JSX.Element {
    const { home } = useMessages(mobileMessages);
    const profile = useUserProfile();
    const nudge = useOncePerSessionNudge();
    const insets = useSafeAreaInsets();

    // P4: the shared Tier authority — an absent/unrecognized subscription tier fails closed to `'free'`.
    const tier = makeViewer({ subscriptionTier: profile.data?.account.subscriptionTier }).tier;
    const displayName = profile.data?.user.displayName;

    // The v1 bespoke render map: only the recipe widget has a slot (it needs `onSeeAllRecipes` threaded in).
    // Built here (not a module const) because the slot closes over the navigation intent.
    const defaultRenderers = useMemo<Readonly<Record<HomeWidgetId, ComponentType>>>(
        () => ({ [RECIPE_HOME_WIDGET_ID]: () => <RecipeWidgetSlot onSeeAllRecipes={onSeeAllRecipes} /> }),
        [onSeeAllRecipes],
    );

    const activeRenderers = renderers ?? defaultRenderers;

    // B23/DA9 — a widget render throw must never be silent. Resolved from the injected `errorReporterToken`
    // (never a hard-coded Sentry import), mirroring the web host so both platforms share ONE reporting seam.
    const reportWidgetError = resolveErrorReporter(container);

    const curated = useMemo(() => {
        const ctx: HomeWidgetCurationContext = {
            liveCapabilities: [...LIVE_CAPABILITIES],
            tier: toWidgetTier(tier),
            // order/hidden personalization lives in the identity profile preferences (002); absent in v1.
        };

        return curateHomeWidgets(resolveHomeWidgets(container), ctx);
    }, [container, tier]);

    const onSelectNav = (id: HomeNavItemId): void => {
        if (id === 'recipes') {
            onSeeAllRecipes();
        } else if (id === 'profile') {
            onOpenAccount();
        }
        // 'home' is the active destination (already here) → no-op; gated ids never reach a select handler.
    };

    return (
        <View style={styles.screen}>
            <HomeTopBar chrome={home.chrome} displayName={displayName} onOpenAccount={onOpenAccount} />

            <HomeNudgeContext.Provider value={{ trigger: nudge.trigger }}>
                <ScrollView
                    accessibilityLabel={home.regionLabel}
                    style={styles.region}
                    contentContainerStyle={styles.regionContent}
                >
                    {/*
                     * U8 — the greeting sits on the brand beach-glow gradient hero (the shared
                     * `GradientSurface` `hero`, single-sourced with web so the two platforms cannot drift).
                     * `overflow: 'hidden'` clips the gradient to the rounded corners. No enter motion here:
                     * it is a non-essential flourish, and adding an `Animated` mount effect would push an
                     * impure, reduce-motion-gated, unmount-cancelling side effect into this render surface —
                     * not worth the risk for a device-only nicety (web carries the CSS-gated enter instead).
                     */}
                    <GradientSurface gradient="hero" style={styles.hero}>
                        <HomeGreeting />
                    </GradientSurface>

                    {curated.map((descriptor) => {
                        const Bespoke = activeRenderers[descriptor.id];

                        if (Bespoke !== undefined) {
                            return (
                                <ErrorBoundary
                                    key={descriptor.id}
                                    fallback={null}
                                    onError={(error) => reportWidgetError(error, { widget: descriptor.id })}
                                >
                                    <Bespoke />
                                </ErrorBoundary>
                            );
                        }

                        if (isPlaceholderHomeWidget(descriptor)) {
                            return (
                                <ErrorBoundary
                                    key={descriptor.id}
                                    fallback={null}
                                    onError={(error) => reportWidgetError(error, { widget: descriptor.id })}
                                >
                                    <RoadmapWidgetSlot descriptor={descriptor} />
                                </ErrorBoundary>
                            );
                        }

                        // A live widget id with no bespoke renderer on this client — skip it rather than
                        // crash, so an older client tolerates a newer personalization list (version skew).
                        return null;
                    })}
                </ScrollView>
            </HomeNudgeContext.Provider>

            <HomeTabBar
                chrome={home.chrome}
                liveCapabilities={LIVE_CAPABILITIES}
                activeId={HOME_NAV_ACTIVE_ID}
                onSelect={onSelectNav}
                bottomInset={insets.bottom}
            />

            <SubscriptionNudge open={nudge.visible} onDismiss={nudge.dismiss} />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.sand },
    region: { flex: 1 },
    regionContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 16 },
    hero: { borderRadius: nativeTokens.radius.lg, overflow: 'hidden', paddingVertical: nativeTokens.spacing[2] },
});
