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
 * The host also renders Home's large title (the greeting, with the avatar as its action) as the scroller's first
 * child, takes the scroller's `bind` from the screen's `ScrollHost`, and threads the navigation intents down to the
 * recipe slot. The tab bar, the condensed title bar and the floating create button are NOT here: the navigator owns the
 * bar and `HomeScreen` floats the other two over this scroller. `container` and `renderers` are injectable seams.
 */
import {
    curateHomeWidgets,
    isPlaceholderHomeWidget,
    profileEntryOf,
    resolveErrorReporter,
    resolveHomeWidgets,
    splitComingSoon,
    type HomeWidgetCurationContext,
    type HomeWidgetDescriptor,
    type HomeWidgetId,
} from '@commise/features-core';
import { RECIPE_HOME_WIDGET_ID } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { makeViewer, type Tier } from '@kitchensink/recipe-core';
import { FAB_RESERVED_BOTTOM_PX } from '@commise/ui/create-fab';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { HeaderAction } from '@commise/ui/large-title-header';
import type { ScrollBind } from '@commise/ui/scroll-host';
import type { Container } from 'ditox';
import { useMemo, type ComponentType, type JSX, type ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { mobileMessages } from '../../i18n/messages.js';
import { useUserProfile } from '../../hooks/useUserProfile.js';
import { HomeGreeting } from './HomeGreeting.js';
import { HomeWidgetErrorNotice } from './HomeWidgetErrorNotice.js';
import { homeContainer } from './homeContainer.js';
import { LIVE_CAPABILITIES } from './liveCapabilities.js';
import { RecipeWidgetSlot } from './RecipeWidgetSlot.js';
import { RoadmapWidgetSlot } from './RoadmapWidgetSlot.js';
import { HomeNudgeContext } from './homeNudgeContext.js';
import { useOncePerSessionNudge } from './useOncePerSessionNudge.js';
import { SubscriptionNudge } from './SubscriptionNudge.js';

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
    /** Invoked with the activated recipe's id when a "Recent recipes" card is tapped. */
    readonly onSelectRecipe: (id: string) => void;
    /** The bind for this screen's one vertical scroller, from its `ScrollHost` (`TabRootScreen`). */
    readonly scrollBind?: ScrollBind;
    /** The large title's action: the avatar, which opens Profile. */
    readonly headerAction?: HeaderAction;
    /** The recent block's first run: open an empty editor (`buildSpec.md` §4.2). With Discover, its ways in show. */
    readonly onCreateRecipe?: () => void;
    /** The first run: paste an ingredient list. */
    readonly onPasteIngredients?: () => void;
    /** The first run: go to Discover. */
    readonly onFindOnDiscover?: () => void;
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
    onSelectRecipe,
    scrollBind,
    headerAction,
    onCreateRecipe,
    onPasteIngredients,
    onFindOnDiscover,
    container = homeContainer,
    renderers,
}: HomeWidgetSurfaceProps): JSX.Element {
    const { home } = useMessages(mobileMessages);
    const { colors } = useTheme();
    const profile = useUserProfile();
    const nudge = useOncePerSessionNudge();

    // P4: the shared Tier authority — an absent/unrecognized subscription tier fails closed to `'free'`.
    const tier = makeViewer({ subscriptionTier: profile.data?.account.subscriptionTier }).tier;
    const cookName = profileEntryOf(profile).name;

    // B23/DA9 — a widget render throw must never be silent. Resolved from the injected `errorReporterToken`
    // (never a hard-coded Sentry import), mirroring the web host so both platforms share ONE reporting seam.
    const reportWidgetError = resolveErrorReporter(container);

    // The v1 bespoke render map: only the recipe widget has a slot (it needs the navigation intents threaded
    // in). Built here (not a module const) because the slot closes over those intents.
    //
    // `onWidgetError` routes the recipe slot's OWN inner boundary through this same reporting seam: that
    // boundary exists so a failed widget body cannot take the "see all recipes" navigation entry with it, and
    // because it catches the throw before the per-widget boundary below ever sees it, the report has to be
    // threaded in explicitly or the failure would go unobserved.
    const defaultRenderers = useMemo<Readonly<Record<HomeWidgetId, ComponentType>>>(
        () => ({
            [RECIPE_HOME_WIDGET_ID]: () => (
                <RecipeWidgetSlot
                    onSeeAllRecipes={onSeeAllRecipes}
                    onSelectRecipe={onSelectRecipe}
                    {...(onCreateRecipe === undefined ? {} : { onCreateRecipe })}
                    {...(onPasteIngredients === undefined ? {} : { onPasteIngredients })}
                    {...(onFindOnDiscover === undefined ? {} : { onFindOnDiscover })}
                    onWidgetError={(error) => reportWidgetError(error, { widget: RECIPE_HOME_WIDGET_ID })}
                />
            ),
        }),
        [onSeeAllRecipes, onSelectRecipe, onCreateRecipe, onPasteIngredients, onFindOnDiscover, reportWidgetError],
    );

    const activeRenderers = renderers ?? defaultRenderers;

    const curated = useMemo(() => {
        const ctx: HomeWidgetCurationContext = {
            liveCapabilities: [...LIVE_CAPABILITIES],
            tier: toWidgetTier(tier),
            // order/hidden personalization lives in the identity profile preferences (002); absent in v1.
        };

        return splitComingSoon(curateHomeWidgets(resolveHomeWidgets(container), ctx));
    }, [container, tier]);

    /**
     * One widget: a live one through its bespoke slot, a placeholder through its loader seam.
     *
     * @param descriptor - The curated descriptor.
     * @returns Its boundary-wrapped render, or `null` for a live id this client cannot draw.
     */
    const renderWidget = (descriptor: HomeWidgetDescriptor): ReactNode => {
        const Bespoke = activeRenderers[descriptor.id];

        // A live widget with a bespoke slot. Its last-resort fallback is the localized
        // `HomeWidgetErrorNotice`, matching web: a `null` here meant a slot-level throw
        // (not just a widget-body one — the recipe slot's own inner boundary handles that)
        // erased the whole slot into unexplained blank space, with nothing announced to
        // assistive tech. Losing the content is acceptable; saying nothing about it is not.
        if (Bespoke !== undefined) {
            return (
                <ErrorBoundary
                    key={descriptor.id}
                    fallback={<HomeWidgetErrorNotice />}
                    onError={(error) => reportWidgetError(error, { widget: descriptor.id })}
                >
                    <Bespoke />
                </ErrorBoundary>
            );
        }

        // A roadmap PLACEHOLDER keeps a `null` fallback — also matching web, and deliberately
        // NOT the notice above. A skeleton is itself a stand-in for a feature that has not
        // shipped, so there is no content whose loss is worth announcing; a notice would report
        // the failure of something the viewer was never promised. The throw is still reported.
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
    };

    return (
        <View style={styles.screen}>
            <HomeNudgeContext.Provider value={{ trigger: nudge.trigger }}>
                <ScrollView
                    {...scrollBind}
                    accessibilityLabel={home.regionLabel}
                    style={styles.region}
                    contentContainerStyle={styles.regionContent}
                >
                    {/* The large title is the scroller's FIRST child, so its host knows when it has scrolled under the
                        top (`LargeTitleHeader`); it sits on the app canvas, never in a card (§1.6). */}
                    <HomeGreeting
                        {...(cookName === undefined ? {} : { name: cookName })}
                        {...(headerAction === undefined ? {} : { action: headerAction })}
                    />

                    {curated.live.map(renderWidget)}

                    {/* The placeholders sit together, AFTER the recent recipes, under one "Coming soon" heading (owner
                        ruling; `buildSpec.md` §4.2). Gone with the last placeholder. */}
                    {curated.comingSoon.length > 0 && (
                        <View style={styles.comingSoon}>
                            <Text accessibilityRole="header" style={[styles.comingSoonHeading, { color: colors.ink }]}>
                                {home.roadmap.comingSoonHeading}
                            </Text>
                            <Text style={[styles.comingSoonBody, { color: colors.inkMuted }]}>
                                {home.roadmap.comingSoonBody}
                            </Text>
                            {curated.comingSoon.map(renderWidget)}
                        </View>
                    )}
                </ScrollView>
            </HomeNudgeContext.Provider>

            <SubscriptionNudge open={nudge.visible} onDismiss={nudge.dismiss} />
        </View>
    );
}

const styles = StyleSheet.create({
    // Transparent so the root `AppCanvas` beach-glow gradient shows through (issue #145). An opaque
    // fill here occludes the whole canvas and restores the flat page the wireframes never had.
    screen: { flex: 1, backgroundColor: 'transparent' },
    region: { flex: 1 },
    // The foot clears the floating create button (its height + 32, `buildSpec.md` §3.4), which floats over it.
    regionContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: FAB_RESERVED_BOTTOM_PX, gap: 16 },
    comingSoon: { gap: nativeTokens.spacing[4] },
    comingSoonHeading: { ...nativeTokens.type.sectionTitle },
    comingSoonBody: { ...nativeTokens.type.body, marginTop: -nativeTokens.spacing[3] },
});
