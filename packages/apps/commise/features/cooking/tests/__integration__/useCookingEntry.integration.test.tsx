import { RecipeStatus } from '@kitchensink/recipe-core';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCookingEntry } from '../../src/cookingEntry.js';
import type { CookingScreenRead } from '../../src/cookingViewProps.js';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const retry = (): void => undefined;

const recipeRead = (status: RecipeStatus, viewerIsOwner: boolean): CookingScreenRead => ({
    kind: 'ready',
    viewerIsOwner,
    recipe: { id: 'r1', title: 'Soup', status, steps: [{ stepNumber: 1, instruction: 'Chop the onion' }] },
});

/** The entry hook over the real cooking-core rules and the real loading clock; only time is faked. */
describe('useCookingEntry', () => {
    it('sends an owner of a draft to the editor exactly once, however often it renders', () => {
        const onEdit = vi.fn();
        const read = recipeRead(RecipeStatus.DRAFT, true);
        const { rerender } = renderHook(({ r }: { r: CookingScreenRead }) => useCookingEntry(r, onEdit), {
            initialProps: { r: read },
        });

        rerender({ r: { ...read } });
        rerender({ r: { ...read } });

        expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it('does not send the owner again when only the onEdit callback changes, and a later redirect calls the newest one', () => {
        const first = vi.fn();
        const second = vi.fn();
        const draft = recipeRead(RecipeStatus.DRAFT, true);
        const published = recipeRead(RecipeStatus.PUBLISHED, true);
        const { rerender } = renderHook(
            ({ r, onEdit }: { r: CookingScreenRead; onEdit: () => void }) => useCookingEntry(r, onEdit),
            { initialProps: { r: draft, onEdit: first } },
        );

        rerender({ r: draft, onEdit: second });

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).not.toHaveBeenCalled();

        rerender({ r: published, onEdit: second });
        rerender({ r: draft, onEdit: second });

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('never calls onEdit for a published recipe, or for a draft the viewer does not own', () => {
        const onEdit = vi.fn();

        renderHook(() => useCookingEntry(recipeRead(RecipeStatus.PUBLISHED, true), onEdit));
        renderHook(() => useCookingEntry(recipeRead(RecipeStatus.DRAFT, false), onEdit));

        expect(onEdit).not.toHaveBeenCalled();
    });

    it('does not call onEdit while the read is pending, and calls it once the owner draft arrives', () => {
        const onEdit = vi.fn();
        const { rerender } = renderHook(({ r }: { r: CookingScreenRead }) => useCookingEntry(r, onEdit), {
            initialProps: { r: { kind: 'pending', retry } as CookingScreenRead },
        });

        expect(onEdit).not.toHaveBeenCalled();

        rerender({ r: recipeRead(RecipeStatus.DRAFT, true) });

        expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it('keeps the loading frame blank for a quick read, then shows the skeleton at 300 ms', () => {
        const { result } = renderHook(() => useCookingEntry({ kind: 'pending', retry }, vi.fn()));

        expect(result.current).toEqual({ state: { kind: 'loading' }, phase: 'blank' });

        act(() => {
            vi.advanceTimersByTime(299);
        });
        expect(result.current.phase).toBe('blank');

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current.phase).toBe('skeleton');
    });

    it('runs the same clock while the owner is being redirected, so the frame reaches the skeleton at 300 ms', () => {
        const { result } = renderHook(() => useCookingEntry(recipeRead(RecipeStatus.DRAFT, true), vi.fn()));

        expect(result.current.state).toEqual({ kind: 'loading' });
        expect(result.current.phase).toBe('blank');

        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(result.current.phase).toBe('skeleton');
    });

    it('has no loading phase once the recipe is ready to cook', () => {
        const { result } = renderHook(() => useCookingEntry(recipeRead(RecipeStatus.PUBLISHED, false), vi.fn()));

        act(() => {
            vi.advanceTimersByTime(2000);
        });

        expect(result.current).toEqual({ state: { kind: 'ready' }, phase: 'blank' });
    });
});
