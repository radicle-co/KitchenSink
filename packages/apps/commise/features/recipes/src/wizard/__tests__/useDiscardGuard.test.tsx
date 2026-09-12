// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';

import { type RecipeFormValues, defaultRecipeFormValues } from '../../form/values.js';
import { useDiscardGuard } from '../useDiscardGuard.js';

describe('useDiscardGuard', () => {
    it('captures the first draft as the baseline; identical values stay clean (create-flow shape)', () => {
        const { result, rerender } = renderHook(
            ({ values }: { values: RecipeFormValues }) => useDiscardGuard(values, { justSaved: false }),
            { initialProps: { values: defaultRecipeFormValues() } },
        );

        expect(result.current).toBe(false);

        rerender({ values: defaultRecipeFormValues() });
        expect(result.current).toBe(false);
    });

    it('reports dirty once the draft diverges from the captured baseline', () => {
        const seed = defaultRecipeFormValues();
        const { result, rerender } = renderHook(
            ({ values }: { values: RecipeFormValues }) => useDiscardGuard(values, { justSaved: false }),
            { initialProps: { values: seed } },
        );

        expect(result.current).toBe(false);

        rerender({ values: { ...seed, title: 'Edited title' } });
        expect(result.current).toBe(true);
    });

    /**
     * REWRITTEN (was "does not capture a baseline until ready"). There is no load gap any more — the edit container's
     * suspense read hands the editor a settled recipe, so its FIRST draft is already the seeded one — and so no
     * `ready` option: the baseline is the draft the guard first sees, and a later draft is judged against it.
     */
    it('takes the first draft it sees as the baseline, whatever that draft holds (edit-flow shape)', () => {
        const seeded: RecipeFormValues = { ...defaultRecipeFormValues(), title: 'Weeknight Pasta' };

        const { result, rerender } = renderHook(
            ({ values }: { values: RecipeFormValues }) => useDiscardGuard(values, { justSaved: false }),
            { initialProps: { values: seeded } },
        );

        expect(result.current).toBe(false);

        rerender({ values: { ...seeded, title: 'Edited further' } });
        expect(result.current).toBe(true);
    });

    it('re-captures the baseline on a successful save, so the persisted state is clean again', () => {
        const seed = defaultRecipeFormValues();
        const edited: RecipeFormValues = { ...seed, title: 'Edited title' };

        const { result, rerender } = renderHook(
            ({ values, justSaved }: { values: RecipeFormValues; justSaved: boolean }) =>
                useDiscardGuard(values, { justSaved }),
            { initialProps: { values: seed, justSaved: false } },
        );

        rerender({ values: edited, justSaved: false });
        expect(result.current).toBe(true);

        // Save succeeds: `justSaved` flips true carrying the just-persisted values as the new baseline.
        rerender({ values: edited, justSaved: true });
        expect(result.current).toBe(false);

        // Back to idle; further edits are dirty again relative to the NEW baseline.
        rerender({ values: edited, justSaved: false });
        expect(result.current).toBe(false);
        rerender({ values: { ...edited, servings: 9 }, justSaved: false });
        expect(result.current).toBe(true);
    });

    it('never COMMITS a dirty frame for the draft a save just persisted', () => {
        // `result.current` shows only the settled value, so it passed for a guard that re-captured in an effect:
        // that shape committed one render still dirty, then corrected it. A consumer reading `isDirty` in its own
        // effect (a leave-page prompt, a "saved" badge) sees that frame. Every committed value is recorded here.
        const seed = defaultRecipeFormValues();
        const edited: RecipeFormValues = { ...seed, title: 'Edited title' };
        const committed: boolean[] = [];

        const { rerender } = renderHook(
            ({ values, justSaved }: { values: RecipeFormValues; justSaved: boolean }) => {
                const isDirty = useDiscardGuard(values, { justSaved });

                useEffect(() => {
                    committed.push(isDirty);
                });

                return isDirty;
            },
            { initialProps: { values: seed, justSaved: false } },
        );

        rerender({ values: edited, justSaved: false });
        committed.length = 0;

        rerender({ values: edited, justSaved: true });

        expect(committed).toEqual([false]);
    });
});
