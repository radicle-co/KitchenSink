/**
 * Root navigator (mobile). The post-login landing is **Home**; from the recipe widget's "see all recipes"
 * entry the caller crosses into the full recipes surface. A lightweight `useState` state machine (no
 * navigation library) mirrors the style already used INSIDE {@link RecipesScreen} — the two top-level
 * destinations are a single piece of local state, so this drops straight into a real stack navigator when one
 * is introduced app-wide. It is deliberately thin: each destination screen owns its own internal navigation.
 */
import type { JSX } from 'react';
import { useState } from 'react';

import { HomeScreen } from './HomeScreen.js';
import { RecipesScreen } from './RecipesScreen.js';

/** The two top-level destinations reachable from the post-login landing. */
type RootDestination = 'home' | 'recipes';

/**
 * The app's post-login root: starts on Home and switches to the recipes surface when the Home recipe
 * widget's "see all recipes" entry is activated.
 *
 * @returns The current top-level destination.
 */
export function AppRoot(): JSX.Element {
    const [destination, setDestination] = useState<RootDestination>('home');

    if (destination === 'recipes') {
        return <RecipesScreen />;
    }

    return <HomeScreen onOpenRecipes={() => setDestination('recipes')} />;
}
