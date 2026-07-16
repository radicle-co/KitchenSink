/**
 * Root navigator (mobile). The post-login landing is **Home**; from the Home chrome the caller crosses into
 * the full recipes surface (the recipe widget's "see all" entry or the Recipes tab) or the account/profile
 * surface (the avatar or the Profile tab). A lightweight `useState` state machine (no navigation library)
 * mirrors the style already used INSIDE {@link RecipesScreen} — the top-level destinations are a single piece
 * of local state, so this drops straight into a real stack navigator when one is introduced app-wide. It is
 * deliberately thin: each destination screen owns its own internal navigation.
 */
import type { JSX } from 'react';
import { useState } from 'react';

import { HomeScreen } from './HomeScreen.js';
import { ProfileScreen } from './profile.js';
import { RecipesScreen } from './RecipesScreen.js';

/** The top-level destinations reachable from the post-login landing. */
type RootDestination = 'home' | 'recipes' | 'profile';

/**
 * The app's post-login root: starts on Home and switches to the recipes or account/profile surface when the
 * corresponding Home chrome entry is activated.
 *
 * @returns The current top-level destination.
 */
export function AppRoot(): JSX.Element {
    const [destination, setDestination] = useState<RootDestination>('home');

    if (destination === 'recipes') {
        return <RecipesScreen />;
    }

    if (destination === 'profile') {
        return <ProfileScreen />;
    }

    return (
        <HomeScreen onOpenRecipes={() => setDestination('recipes')} onOpenProfile={() => setDestination('profile')} />
    );
}
