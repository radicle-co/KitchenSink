/**
 * Root navigator (mobile). The post-login landing is **Home**; from the Home chrome the caller crosses into
 * the full recipes surface — at the LIST (the recipe widget's "see all" entry or the Recipes tab) or straight
 * at one recipe's DETAIL (a "Recent recipes" card tap, which carries the recipe id through the destination) —
 * or into the account/profile surface (the avatar or the Profile tab). A lightweight `useState` state machine
 * mirrors the style already used INSIDE {@link RecipesScreen} — the top-level destinations are a single piece
 * of local state, so this drops straight into a real stack navigator when one is introduced app-wide. It is
 * deliberately thin: each destination screen owns its own internal navigation.
 *
 * B18 — wrapped in a root `ErrorBoundary`: the app-level safety net. The per-widget Home boundaries
 * (`HomeWidgetSurface`, DA9) already contain a crash inside ONE widget; this is the layer above them,
 * catching a render crash ANYWHERE under the current destination screen so the app shows a localized,
 * recoverable fallback instead of a white screen. Reports through the SAME `errorReporterToken` seam
 * (resolved from `homeContainer`, the one bound instance on mobile — mirroring the web root boundary's reuse
 * of its own `homeContainer`) rather than a second Sentry binding path.
 *
 * M1 (`docs/design/uiOverhaul/specShellAndLists.md` §S.3) — this root OWNS the bottom tab bar, and shows it on every
 * top-level destination (Home, Recipes, Profile). It used to render only inside Home, so Recipes and Profile had no way
 * back: Android's Back left the app from them, and iOS has no system Back at all. Recipes gets the bar as a `footer`
 * and shows it only on its own top-level tabs, because only it knows when a detail is pushed. The account hub is a
 * pushed task with its own Back, so it has no bar. The root is also the last link in the hardware-back chain: a press
 * nothing else took goes Home from Recipes or Profile, back to Profile from the account hub, and on Home is declined
 * so Android leaves the app.
 *
 * B13 — this app deliberately does NOT depend on `@react-navigation/*`: with exactly three flat
 * destinations and no deep-linking/history requirements, a `useState` switch is the simplest correct
 * design (KISS) and the unused react-navigation packages (+ their `react-native-screens` peer) were
 * removed from `package.json` as dead weight. Adopting react-navigation for richer stack/tab navigation
 * is a legitimate future need but is a separate, feature-sized task — not a drop-in here.
 */
import { resolveErrorReporter, type HomeNavItemId } from '@commise/features-core';
import { useMessages } from '@commise/i18n/react';
import { BackInterceptProvider } from '@commise/ui/back-intercept';
import { BottomChromeFrame } from '@commise/ui/layout';
import { useQueryErrorResetBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RootErrorFallback } from '../components/RootErrorFallback.js';
import { HomeTabBar } from '../components/home/chrome/HomeTabBar.js';
import { homeContainer } from '../components/home/homeContainer.js';
import { LIVE_CAPABILITIES } from '../components/home/liveCapabilities.js';
import { mobileMessages } from '../i18n/messages.js';
import { AccountSettingsScreen } from './AccountSettings.js';
import { HomeScreen } from './HomeScreen.js';
import { ProfileScreen } from './profile.js';
import { RecipesScreen } from './RecipesScreen.js';

/**
 * The top-level destinations reachable from the post-login landing. `account` is the account hub
 * (security + sign-out + danger zone); it is entered from the profile surface's "Account settings" action —
 * WITHOUT it, `AccountSettingsScreen` (and the only sign-out control) would be unreachable (audit L2).
 *
 * A discriminated union rather than a bare string union, because `recipes` carries a PARAMETER: a Home
 * "Recent recipes" card tap enters the recipes surface aimed at one recipe's detail, while the Recipes tab
 * enters it at the list. Mirrors the `Surface` union `RecipesScreen` uses internally for the same reason.
 */
type RootDestination =
    | { readonly id: 'home' }
    | { readonly id: 'recipes'; readonly recipeId?: string }
    | { readonly id: 'profile' }
    | { readonly id: 'account' };

/** The DA9 reporter resolved once from the shared appShell container (bound to Sentry in production). */
const reportRootError = resolveErrorReporter(homeContainer);

/**
 * The app's post-login root: starts on Home and switches to the recipes or account/profile surface when the
 * corresponding Home chrome entry is activated. Wrapped in the root `ErrorBoundary` (B18).
 *
 * @returns The current top-level destination, or the recoverable crash fallback.
 */
export function AppRoot(): JSX.Element {
    const [destination, setDestination] = useState<RootDestination>({ id: 'home' });
    const { reset: resetQueryErrors } = useQueryErrorResetBoundary();
    const { home } = useMessages(mobileMessages);
    const insets = useSafeAreaInsets();

    const selectTab = (id: HomeNavItemId): void => {
        if (id === 'home' || id === 'recipes' || id === 'profile') {
            setDestination({ id });
        }
        // Gated destinations are never offered to a select handler (`HomeTabBar` renders them inert).
    };

    // The bar on every top-level destination; the account hub is a pushed task with its own Back.
    const tabBar =
        destination.id === 'account' ? undefined : (
            <HomeTabBar
                chrome={home.chrome}
                liveCapabilities={LIVE_CAPABILITIES}
                activeId={destination.id}
                onSelect={selectTab}
                bottomInset={insets.bottom}
            />
        );

    let content: JSX.Element;

    if (destination.id === 'recipes') {
        // Keyed by the target recipe so entering the surface aimed at a DIFFERENT recipe remounts it: the
        // seeded stack is mount-time state, so without the key a second Home tap would re-render the surface
        // with a stale stack and appear to do nothing.
        content = (
            <RecipesScreen
                key={destination.recipeId ?? 'list'}
                initialRecipeId={destination.recipeId}
                footer={tabBar}
            />
        );
    } else if (destination.id === 'profile') {
        content = (
            <BottomChromeFrame footer={tabBar}>
                <ProfileScreen onOpenAccountSettings={() => setDestination({ id: 'account' })} />
            </BottomChromeFrame>
        );
    } else if (destination.id === 'account') {
        content = <AccountSettingsScreen onBack={() => setDestination({ id: 'profile' })} />;
    } else {
        content = (
            <BottomChromeFrame footer={tabBar}>
                <HomeScreen
                    onOpenRecipes={() => setDestination({ id: 'recipes' })}
                    onOpenRecipe={(recipeId) => setDestination({ id: 'recipes', recipeId })}
                    onOpenProfile={() => setDestination({ id: 'profile' })}
                />
            </BottomChromeFrame>
        );
    }

    // The last link in the hardware-back chain: Recipes' own provider sits inside this one and asks its surfaces and
    // its stack first (`@commise/ui/back-intercept` composes nested providers). Outside the error boundary, so a reset
    // does not remount the one platform subscription.
    return (
        <BackInterceptProvider
            onUnhandled={() => {
                if (destination.id === 'home') {
                    return false;
                }

                setDestination({ id: destination.id === 'account' ? 'profile' : 'home' });

                return true;
            }}
        >
            <ErrorBoundary
                fallbackRender={(fallback) => (
                    <RootErrorFallback
                        {...fallback}
                        {...(destination.id === 'home' ? {} : { onBackToHome: () => setDestination({ id: 'home' }) })}
                    />
                )}
                // Leaving the crashed destination clears the failure; staying and pressing Try again resets it too.
                // Either way TanStack's query errors reset with it, so a failed read refetches instead of re-throwing.
                resetKeys={[destination.id]}
                onReset={resetQueryErrors}
                onError={(error) => reportRootError(error, { boundary: 'root' })}
            >
                {content}
            </ErrorBoundary>
        </BackInterceptProvider>
    );
}
