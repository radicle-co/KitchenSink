import { MAX_RECENT_RECIPES } from '../components/props.js';

/**
 * How many recent recipes the Home widget reads, and the page size every reader of that page must use: the widget
 * itself, and Home's first-run check, which finds the same cache entry by this key (`recipeServiceKeys.recipeList`).
 * A mismatched size is a different key, so the first-run check would silently read nothing.
 *
 * It is the widget's own cap (FR-046: up to four), not a second number that happens to equal it.
 */
export const RECENT_RECIPE_LIMIT = MAX_RECENT_RECIPES;
