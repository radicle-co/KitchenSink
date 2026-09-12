'use client';

/**
 * @module @commise/features-recipes/hooks — AUTO-SAVE for the recipe editor (U34, owner ruling 2026-08-25:
 * "build auto-save for real").
 *
 * ⛔ **This is not a label.** Nothing shipped before it (`grep autosav` matched nothing), and the mockup's
 * "Auto-saved 2 minutes ago" is a hardcoded literal with no handler behind it. Shipping the sentence without
 * the write would have been worse than shipping neither: a cook who believes their work is saved stops
 * saving it.
 *
 * ⛔ **THE RISK IS THE LOST UPDATE, NOT THE TIMER — which is why this hook issues no write of its own.** It
 * calls the SAME `saveDraft` the button calls, so the write goes through `useRecipeEditor.submitDraft`,
 * carrying `expectedVersion` from `query.data.currentVersion` and landing in the SAME 409-to-`conflict`
 * transition a manual save does. An auto-save that built its own request would be the one caller able to
 * write without the optimistic-concurrency token, and an unattended background write with no token silently
 * clobbers a change made on another device. Delegation is what makes that unrepresentable rather than merely
 * untested.
 *
 * ⚠️ **`useUpdateRecipe` write-through is what makes REPEATED auto-saves safe.** Its `onSuccess` puts the
 * freshly-persisted `RecipeDetail` straight into `recipe(id)`, so the NEXT auto-save reads an already-fresh
 * `currentVersion`. Without that, the second unattended write would 409 against the first one's own result.
 *
 * ⛔ **It writes a DRAFT and never publishes.** The options carry `saveDraft` and nothing else that writes —
 * there is no `publish` in scope for it to reach. `saveDraft` itself never downgrades an already-published
 * recipe (see `useRecipeEditor`'s own doc), so an unattended write can neither publish a private draft nor
 * unpublish a live recipe.
 *
 * ⛔ **It never fires on an untouched form.** `isDirty` comes from the SAME `useDiscardGuard` the discard
 * dialog keys off — a structural comparison against a captured baseline, not a "has the editor mounted"
 * flag. Opening a recipe and reading it therefore writes nothing, which matters because every write mints a
 * version row, bumps `currentVersion`, and makes every other device's draft stale.
 *
 * ⚠️ **`enabled` is the caller's "a write would land in an unresolved race" gate**, and the caller passes
 * `false` for three distinct reasons: a save is already in flight (its token is committed to that request),
 * the editor is showing a conflict the cook has not resolved (the token is known to be stale), or the recipe
 * has not loaded (there is no token at all). Suppressed windows are DROPPED, never queued — the interval is
 * created fresh when the gate reopens, so re-enabling does not settle a backlog.
 *
 * ⛔ **Unmount CANCELS; it deliberately does not FLUSH.** A last-gasp write on the way out would issue an
 * unattended PATCH into a `useRecipeEditor` that no longer exists, so its 409 could not open the conflict
 * view and a lost update would have no error path at all. Losing the final window's edits is the lesser
 * harm, and the discard guard already warns about it at the exit the cook actually took.
 */
import { useEffect } from 'react';

/**
 * How long a draft may hold unsaved edits before an unattended write, in milliseconds.
 *
 * ⛔ An INTERVAL from the first unsaved edit, NOT a debounce from the last one — and the distinction is the
 * whole reason this is five minutes rather than five seconds. The timer is armed when the draft becomes
 * dirty and fires at that deadline whatever the cook types in between, so a cook editing continuously IS
 * protected. A debounce of the same length would protect only a cook who STOPS, which is the opposite of
 * when unsaved work is at risk.
 *
 * ⚠️ It was `AUTO_SAVE_DEBOUNCE_MS = 2000`, and both halves of that name were wrong. The rename to
 * `AUTO_SAVE_INTERVAL_MS` (2026-08-26) came with a claim that the behaviour was ALREADY an interval —
 * `isDirty` is a boolean, `saveDraft` is `useCallback`-stable, so nothing re-arms the effect. **That claim
 * was measured FALSE on 2026-09-03 and the code below is what repairs it.** `useRecipeEditor.autoSaveDraft`
 * carried `values` in its `useCallback` deps, so every keystroke minted a new function, changed this hook's
 * effect deps and started the window over: a cook typing continuously saw ZERO writes past the deadline.
 * The 2026-08-26 verification only re-rendered — which does not change a memoised callback's identity —
 * so it exercised the half that already worked. Two things closed it: `autoSaveDraft` is now genuinely
 * stable (an effect-published implementation behind an empty-dep façade), and the timer below REPEATS.
 *
 * ⛔ `setInterval`, not `setTimeout`, and that is not cosmetic. A one-shot that has already fired is never
 * re-armed while `isDirty`/`enabled` hold steady — so a write that FAILED (the draft stays dirty, the
 * machine stays `editing`) is never retried and auto-save is dead for the rest of the session, silently,
 * in exactly the flaky-network case it exists for.
 *
 * Five minutes is chosen against the write's COST, not against a feel: every auto-save is a PATCH that mints
 * a version row (FR-007b), only the last ten live in the database, and at two seconds an ordinary editing
 * session pushed a cook's own deliberate versions out of that window in under a minute. Owner ruling
 * 2026-08-26. It is deliberately NOT `INGREDIENT_SEARCH_DEBOUNCE_MS` — a search is a cheap idempotent read
 * and wants to feel instant; this is a durable, history-bearing write and wants to be rare.
 */
export const AUTO_SAVE_INTERVAL_MS = 300_000;

/** Options for {@link useRecipeAutoSave}. */
export interface UseRecipeAutoSaveOptions {
    /**
     * Whether the draft differs from its saved baseline (`useDiscardGuard`'s output). The ONLY trigger — a
     * clean draft is never written.
     */
    readonly isDirty: boolean;
    /**
     * Whether a write may be issued at all. The caller passes `false` whenever one would land in an
     * unresolved race — see the module doc's three cases.
     */
    readonly enabled: boolean;
    /**
     * Persist the draft. This is `useRecipeEditor`'s own `saveDraft`, so the write carries `expectedVersion`
     * and resolves a 409 through the editor's conflict statechart. Deliberately the ONLY write in scope.
     */
    readonly saveDraft: () => void;
}

/**
 * Write the draft every {@link AUTO_SAVE_INTERVAL_MS}, for as long as it has unsaved edits and a write would
 * not land in a race.
 *
 * @param options - `isDirty` (the trigger), `enabled` (the race gate), and the editor's `saveDraft`.
 * @sideEffect Issues a draft PATCH through the caller's `saveDraft`, on a repeating timer.
 */
export function useRecipeAutoSave(options: UseRecipeAutoSaveOptions): void {
    const { isDirty, enabled, saveDraft } = options;

    useEffect(() => {
        if (!isDirty || !enabled) {
            return undefined;
        }

        const timer = setInterval(saveDraft, AUTO_SAVE_INTERVAL_MS);

        // Cleared on unmount and whenever `isDirty`/`enabled` flip, so a draft that goes clean, a window that
        // gets suppressed, or a screen the cook has left issues no write. ⚠️ NOT re-created by ordinary
        // edits: the deps are two booleans and a genuinely stable callback (see `useRecipeEditor`'s
        // `autoSaveDraft`), so the cadence started at the first unsaved edit is the cadence that runs. Losing
        // that stability turns this straight back into a debounce, which is the defect of 2026-09-03.
        return () => clearInterval(timer);
    }, [isDirty, enabled, saveDraft]);
}
