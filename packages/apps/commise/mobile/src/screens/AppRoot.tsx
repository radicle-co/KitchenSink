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
 * B13 — this app deliberately does NOT depend on `@react-navigation/*`: with exactly three flat
 * destinations and no deep-linking/history requirements, a `useState` switch is the simplest correct
 * design (KISS) and the unused react-navigation packages (+ their `react-native-screens` peer) were
 * removed from `package.json` as dead weight. Adopting react-navigation for richer stack/tab navigation
 * is a legitimate future need but is a separate, feature-sized task — not a drop-in here.
 */
import { resolveErrorReporter } from '@commise/features-core';
import type { JSX } from 'react';
import { useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { RootErrorFallback } from '../components/RootErrorFallback.js';
import { homeContainer } from '../components/home/homeContainer.js';
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

    let content: JSX.Element;

    if (destination.id === 'recipes') {
        // Keyed by the target recipe so entering the surface aimed at a DIFFERENT recipe remounts it: the
        // seeded stack is mount-time state, so without the key a second Home tap would re-render the surface
        // with a stale stack and appear to do nothing.
        content = <RecipesScreen key={destination.recipeId ?? 'list'} initialRecipeId={destination.recipeId} />;
    } else if (destination.id === 'profile') {
        content = <ProfileScreen onOpenAccountSettings={() => setDestination({ id: 'account' })} />;
    } else if (destination.id === 'account') {
        content = <AccountSettingsScreen onBack={() => setDestination({ id: 'profile' })} />;
    } else {
        content = (
            <HomeScreen
                onOpenRecipes={() => setDestination({ id: 'recipes' })}
                onOpenRecipe={(recipeId) => setDestination({ id: 'recipes', recipeId })}
                onOpenProfile={() => setDestination({ id: 'profile' })}
            />
        );
    }

    return (
        <ErrorBoundary
            FallbackComponent={RootErrorFallback}
            onError={(error) => reportRootError(error, { boundary: 'root' })}
        >
            {content}
        </ErrorBoundary>
    );
}
