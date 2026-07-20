/**
 * @module @commise/features-recipes — session-scoped cooking-progress store (W2 Task 2.4, D4/D5).
 *
 * Tracks which ingredients a cook has gathered and which steps they've completed, **per recipe**, for the
 * duration of the SPA session. This is deliberately a module-level singleton, NOT React state on the detail
 * view: a cook's checklist must survive navigating away from the recipe and back (tap a tag → browse
 * results → return) — component-local state resets on unmount and would read as broken mid-cook. It is
 * equally NOT server-persisted (owner decision, W2 Open Questions): a full reload starts a fresh checklist.
 *
 * The store is platform-agnostic (pure TS, shared by web + native leaves). It exposes an
 * external-store contract (`subscribe` + `getProgress`) so React binds to it via `useSyncExternalStore`
 * (see {@link import('./useCookingProgress.js').useCookingProgress}); `getProgress` returns a
 * reference-stable snapshot while unchanged (a shared frozen empty for untouched recipes), as that hook
 * requires.
 */

/** An immutable snapshot of one recipe's cooking progress. */
export interface RecipeProgress {
    /** Ids of the ingredients the cook has checked off. */
    readonly ingredients: ReadonlySet<string>;
    /** 1-based step numbers the cook has marked done. */
    readonly steps: ReadonlySet<number>;
}

type Listener = () => void;

/** The reference-stable snapshot returned for any recipe with no progress yet. */
const EMPTY_PROGRESS: RecipeProgress = { ingredients: new Set(), steps: new Set() };

const store = new Map<string, RecipeProgress>();
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
 * Read one recipe's progress snapshot. Reference-stable while unchanged (the shared empty for an untouched
 * recipe; the same object until its next toggle), as `useSyncExternalStore` requires.
 *
 * @param recipeId - The recipe whose progress to read.
 * @returns The current {@link RecipeProgress} snapshot.
 */
export function getProgress(recipeId: string): RecipeProgress {
    return store.get(recipeId) ?? EMPTY_PROGRESS;
}

/** Toggle membership of `value` in a set, returning a NEW set (never mutates the snapshot's set). */
function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
    const next = new Set(set);

    if (next.has(value)) {
        next.delete(value);
    } else {
        next.add(value);
    }

    return next;
}

/**
 * @sideEffect Toggle an ingredient's gathered state for a recipe and notify subscribers.
 * @param recipeId - The recipe.
 * @param ingredientId - The ingredient to toggle.
 */
export function toggleIngredient(recipeId: string, ingredientId: string): void {
    const current = getProgress(recipeId);
    store.set(recipeId, { ingredients: toggled(current.ingredients, ingredientId), steps: current.steps });
    emit();
}

/**
 * @sideEffect Toggle a step's completed state for a recipe and notify subscribers.
 * @param recipeId - The recipe.
 * @param stepNumber - The 1-based step number to toggle.
 */
export function toggleStep(recipeId: string, stepNumber: number): void {
    const current = getProgress(recipeId);
    store.set(recipeId, { ingredients: current.ingredients, steps: toggled(current.steps, stepNumber) });
    emit();
}

/**
 * @sideEffect Clear ALL recipes' progress. Test-only seam so suites don't leak session state into one
 * another (production never resets mid-session — a reload drops the module singleton instead).
 */
export function resetCookingProgress(): void {
    store.clear();
    emit();
}
