/**
 * @module @commise/features-recipes/wizard — the discard guard's dirty tracking (w3/e1,e2). Platform-agnostic
 * (pure React, no DOM/native APIs), so both `Wizard.tsx` and `Wizard.native.tsx` import the SAME hook.
 *
 * Captures a BASELINE snapshot of the draft the first time it is `ready`:
 * - **create**: `ready` is true from the very first render, and the draft starts at
 *   `defaultRecipeFormValues()` — so the baseline captured on that first render already IS the blank
 *   default, with no special-casing needed.
 * - **edit**: `ready` becomes true once `useRecipeEditor`'s `state.status` leaves `'loading'` (the seed-once
 *   effect has run) — the baseline captured then is the just-seeded, unedited draft.
 *
 * The baseline is RE-CAPTURED every time `justSaved` is true (the container passes
 * `editor.state.status === 'saved'`): a successful Save Draft / Publish moves the
 * "nothing to lose" line forward, so a wizard that stays mounted past a save (this is exactly that case —
 * see `useRecipeEditor`'s own module doc on why `saved` resets rather than latching forever) never reports
 * its own just-persisted state as "unsaved edits".
 *
 * `isDirty` is a pure structural compare ({@link recipeFormValuesEqual}) of the current draft against that
 * baseline — deliberately NOT derived from `editor.errors`/`state`, which track VALIDITY, not history: a
 * perfectly valid, freshly-typed edit must still be reported dirty, and an invalid-but-unedited seed must not.
 */
import { useEffect, useState } from 'react';

import { recipeFormValuesEqual } from './model.js';
import type { RecipeFormValues } from '../form/model.js';

/** Options for {@link useDiscardGuard}. */
export interface UseDiscardGuardOptions {
    /** Whether the draft has reached its first stable (post-seed, for edit) state — captures the baseline. */
    readonly ready: boolean;
    /** True for the render(s) immediately after a successful save — re-captures the baseline. */
    readonly justSaved: boolean;
}

/**
 * Track whether `values` has unsaved edits relative to its baseline.
 *
 * @param values - The editor's current draft.
 * @param opts - `ready` (when to first capture the baseline) and `justSaved` (when to re-capture it).
 * @returns Whether `values` currently differs from the baseline.
 */
export function useDiscardGuard(values: RecipeFormValues, opts: UseDiscardGuardOptions): boolean {
    const [baseline, setBaseline] = useState<RecipeFormValues | null>(null);

    useEffect(() => {
        if (opts.ready && baseline === null) {
            setBaseline(values);
        }
    }, [opts.ready, values, baseline]);

    useEffect(() => {
        if (opts.justSaved) {
            setBaseline(values);
        }
    }, [opts.justSaved, values]);

    return baseline !== null && !recipeFormValuesEqual(values, baseline);
}
