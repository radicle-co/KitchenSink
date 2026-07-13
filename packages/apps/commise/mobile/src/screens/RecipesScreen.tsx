/**
 * Recipes surface (mobile). The minimal navigator for the recipe slice: it owns the selected-recipe id and
 * composes either {@link RecipeListScreen} or {@link RecipeDetailScreen}. Kept deliberately lightweight (a
 * single piece of local UI state, no navigation library) — the two screens already expose the right seams
 * (`onSelectRecipe(id)` and `recipeId`/`onBack`), so they drop straight into a real stack navigator when
 * one is introduced app-wide.
 */
import type { JSX } from 'react';
import { useState } from 'react';

import { RecipeDetailScreen } from './RecipeDetailScreen.js';
import { RecipeListScreen } from './RecipeListScreen.js';

/**
 * The recipes surface — list by default, detail when a recipe is selected.
 *
 * @returns The list or detail screen for the current selection.
 */
export function RecipesScreen(): JSX.Element {
    const [selectedId, setSelectedId] = useState<string | null>(null);

    if (selectedId !== null) {
        return <RecipeDetailScreen recipeId={selectedId} onBack={() => setSelectedId(null)} />;
    }

    return <RecipeListScreen onSelectRecipe={setSelectedId} />;
}
