'use client';

/**
 * @module @commise/features-recipes/wizard — the discard guard's dirty tracking (w3/e1,e2). Platform-agnostic
 * (pure React, no DOM/native APIs), so both `Wizard.tsx` and `Wizard.native.tsx` import the SAME hook.
 *
 * The BASELINE is the first draft the guard sees:
 * - **create**: the blank `defaultRecipeFormValues()` the create flow starts from.
 * - **edit**: the draft `useRecipeEditor` seeded from the settled recipe — the container's suspense read owns the load,
 *   so the editor's first draft is already the seeded one.
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
import { useState } from 'react';

import { recipeFormValuesEqual } from './model.js';
import type { RecipeFormValues } from '../form/values.js';

/** Options for {@link useDiscardGuard}. */
export interface UseDiscardGuardOptions {
    /** True for the render(s) immediately after a successful save — re-captures the baseline. */
    readonly justSaved: boolean;
}

/**
 * Track whether `values` has unsaved edits relative to its baseline.
 *
 * @param values - The editor's current draft.
 * @param opts - `justSaved` (when to re-capture the baseline).
 * @returns Whether `values` currently differs from the baseline.
 */
export function useDiscardGuard(values: RecipeFormValues, opts: UseDiscardGuardOptions): boolean {
    const [baseline, setBaseline] = useState<RecipeFormValues>(values);

    // Re-captured DURING RENDER — React's documented form for state that follows a prop — not in an effect. The
    // effect form committed one render with the old baseline first, so the frame right after a save reported the
    // just-persisted draft as dirty. It settles once `baseline === values`, so the update cannot loop.
    if (opts.justSaved && baseline !== values) {
        setBaseline(values);
    }

    return !recipeFormValuesEqual(values, baseline);
}
