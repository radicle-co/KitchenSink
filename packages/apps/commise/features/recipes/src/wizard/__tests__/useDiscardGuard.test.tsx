// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { defaultRecipeFormValues, type RecipeFormValues } from '../../form/model.js';
import { useDiscardGuard } from '../useDiscardGuard.js';

describe('useDiscardGuard', () => {
    it('is not dirty before it is ready (baseline not yet captured)', () => {
        const { result } = renderHook(() =>
            useDiscardGuard(defaultRecipeFormValues(), { ready: false, justSaved: false }),
        );

        expect(result.current).toBe(false);
    });

    it('captures the baseline once ready; identical values stay clean (create-flow shape)', () => {
        const { result, rerender } = renderHook(
            ({ values }: { values: RecipeFormValues }) => useDiscardGuard(values, { ready: true, justSaved: false }),
            { initialProps: { values: defaultRecipeFormValues() } },
        );

        expect(result.current).toBe(false);

        rerender({ values: defaultRecipeFormValues() });
        expect(result.current).toBe(false);
    });

    it('reports dirty once the draft diverges from the captured baseline', () => {
        const seed = defaultRecipeFormValues();
        const { result, rerender } = renderHook(
            ({ values }: { values: RecipeFormValues }) => useDiscardGuard(values, { ready: true, justSaved: false }),
            { initialProps: { values: seed } },
        );

        expect(result.current).toBe(false);

        rerender({ values: { ...seed, title: 'Edited title' } });
        expect(result.current).toBe(true);
    });

    it('does not capture a baseline until ready (edit-flow load gap)', () => {
        const loadingValues = defaultRecipeFormValues();
        const seeded: RecipeFormValues = { ...loadingValues, title: 'Weeknight Pasta' };

        const { result, rerender } = renderHook(
            ({ values, ready }: { values: RecipeFormValues; ready: boolean }) =>
                useDiscardGuard(values, { ready, justSaved: false }),
            { initialProps: { values: loadingValues, ready: false } },
        );

        expect(result.current).toBe(false);

        // The recipe loads and seeds — this transition must NOT be reported as "dirty" relative to the blank
        // pre-load values; the baseline is captured fresh once `ready` flips true.
        rerender({ values: seeded, ready: true });
        expect(result.current).toBe(false);

        rerender({ values: { ...seeded, title: 'Edited further' }, ready: true });
        expect(result.current).toBe(true);
    });

    it('re-captures the baseline on a successful save, so the persisted state is clean again', () => {
        const seed = defaultRecipeFormValues();
        const edited: RecipeFormValues = { ...seed, title: 'Edited title' };

        const { result, rerender } = renderHook(
            ({ values, justSaved }: { values: RecipeFormValues; justSaved: boolean }) =>
                useDiscardGuard(values, { ready: true, justSaved }),
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
});
