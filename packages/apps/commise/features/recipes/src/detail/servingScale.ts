/**
 * @module @commise/features-recipes — session-scoped serving-scale store.
 *
 * Tracks the serving count a cook is viewing a recipe at, **per recipe**, for the duration of the session.
 * Deliberately a module-level singleton and NOT React state on the detail view, for the same reason
 * `cookingProgress.ts` is: a cook who doubles a recipe, taps through to a photo or a tag search, and comes
 * back must find it still doubled — component-local state resets on unmount and would read as broken
 * mid-cook. Equally NOT server-persisted: a full reload starts fresh, at the count the AUTHOR chose.
 *
 * The default is always the recipe's own `servings` (the owner's requirement), so an untouched recipe needs
 * no entry at all — absence IS the default, which is why `getServings` takes the base count.
 *
 * Platform-agnostic (pure TS, shared by the web + native leaves) and exposing the external-store contract
 * (`subscribe` + `getServings`) that `useSyncExternalStore` requires. The snapshot is a NUMBER, so
 * reference stability is free.
 */
import { clampServings } from '@kitchensink/recipe-core/scaling';

type Listener = () => void;

const store = new Map<string, number>();
const listeners = new Set<Listener>();

/** @sideEffect Notify every subscriber that the store changed. */
function emit(): void {
    for (const listener of listeners) {
        listener();
    }
}

/**
 * Subscribe to store changes.
 *
 * @sideEffect Registers `listener`; the returned function unregisters it.
 * @param listener - Called on every mutation.
 * @returns An unsubscribe function.
 */
export function subscribe(listener: Listener): () => void {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

/**
 * Read the serving count a recipe is being viewed at.
 *
 * @param recipeId - The recipe.
 * @param baseServings - The recipe's authored serving count — the default when the cook has not chosen one.
 * @returns The chosen serving count, or `baseServings`.
 */
export function getServings(recipeId: string, baseServings: number): number {
    return store.get(recipeId) ?? baseServings;
}

/**
 * @sideEffect Choose a serving count for a recipe and notify subscribers. The value is CLAMPED to the
 * recipe's supported range on the way in, so the store cannot hold a count the scaling domain would refuse.
 * @param recipeId - The recipe.
 * @param baseServings - The recipe's authored serving count (defines the range).
 * @param servings - The requested serving count.
 */
export function setServings(recipeId: string, baseServings: number, servings: number): void {
    store.set(recipeId, clampServings(servings, baseServings));
    emit();
}

/**
 * @sideEffect Clear EVERY recipe's chosen serving count. Test-only seam so suites don't leak session state
 * into one another (production never resets mid-session — a reload drops the module singleton instead).
 */
export function resetServingScale(): void {
    store.clear();
    emit();
}
