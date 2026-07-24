/**
 * Tests for {@link useRecipeEditor} — the shared recipe-edit lifecycle statechart (CP-6/P1, B2) that
 * resolves the web-vs-mobile reseed incompatibility described in `.superpowers/sdd/cp6-current-state.md`
 * §2. Pins the invariants the two platform containers depended on before the extraction: seed-once (a
 * background refetch of the SAME recipe never clobbers an in-progress edit); a 409 — and ONLY a 409 — opens
 * `status: 'conflict'`, never surfacing as `submitError`; a resubmit (via `keepMine`) carries
 * `theirs.currentVersion`, not the stale version that lost the race; `useTheirs` reseeds `values` through
 * the SAME transition the initial seed uses (no remount/override, closing the reseed incompatibility);
 * `merge(selections)` composes via `composeMergedRecipe` and submits; and validation blocks a `submit()` on
 * an invalid draft. The `@kitchensink/recipe-service-client/hooks` module is mocked (its own behavior is
 * covered by that package's tests); `VersionConflictError`/`isVersionConflictError` are the REAL
 * implementations, so the 409-detection path is exercised for real, not stubbed.
 */
import { act, renderHook } from '@testing-library/react';
import { VersionConflictError } from '@kitchensink/recipe-service-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeRecipeDetail } from '../../__fixtures__/index.js';
import { validateRecipeForm } from '../../form/model.js';

const { useRecipeMock, useUpdateRecipeMock } = vi.hoisted(() => ({
    useRecipeMock: vi.fn(),
    useUpdateRecipeMock: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipe: useRecipeMock,
    useUpdateRecipe: useUpdateRecipeMock,
}));

import { useRecipeEditor } from '../useRecipeEditor.js';

/** A `useRecipe` double. `refetch` defaults to resolving with the SAME `data` (a plain background refetch). */
function recipeQuery(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const data = 'data' in overrides ? overrides['data'] : makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });

    return {
        isLoading: false,
        isError: false,
        error: undefined,
        data,
        refetch: vi.fn().mockResolvedValue({ data }),
        ...overrides,
    };
}

type MutateVars = { readonly id: string; readonly input: { readonly expectedVersion: number } };
type MutateOptions = { onSuccess?: (recipe: unknown) => void; onError?: (err: unknown) => void };

/** One scripted outcome the mocked update mutation replays, in order, per `mutate` call. */
type Outcome =
    | { readonly type: 'success'; readonly recipe: unknown }
    | { readonly type: 'conflict'; readonly error: unknown };

/** Build a `useUpdateRecipe` double whose `mutate` replays `outcomes` in order via the caller's callbacks. */
function updateMutation(outcomes: readonly Outcome[] = []): {
    mutate: ReturnType<typeof vi.fn>;
    isPending: boolean;
    isError: boolean;
    error: unknown;
} {
    const queue = [...outcomes];
    let isError = false;
    let error: unknown;

    const mutate = vi.fn((_vars: MutateVars, options?: MutateOptions) => {
        const outcome = queue.shift();

        if (outcome?.type === 'success') {
            isError = false;
            options?.onSuccess?.(outcome.recipe);
        } else if (outcome?.type === 'conflict') {
            isError = true;
            error = outcome.error;
            options?.onError?.(outcome.error);
        }
    });

    return {
        mutate,
        isPending: false,
        get isError() {
            return isError;
        },
        get error() {
            return error;
        },
    };
}

afterEach(() => {
    vi.clearAllMocks();
});

beforeEach(() => {
    useUpdateRecipeMock.mockReturnValue(updateMutation());
});

describe('useRecipeEditor — seed-once (no clobber on background refetch)', () => {
    it('is "loading" until the recipe seeds, then seeds values once', () => {
        useRecipeMock.mockReturnValue(recipeQuery({ data: undefined, isLoading: true }));
        const { result, rerender } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        expect(result.current.state).toEqual({ status: 'loading' });

        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        rerender();

        expect(result.current.state).toEqual({ status: 'editing' });
        expect(result.current.values.title).toBe('Weeknight Pasta');
    });

    it('does NOT clobber an in-progress edit when the SAME recipe re-renders with fresh (background-refetched) data', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const { result, rerender } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.setValues({ ...result.current.values, title: 'My Unsaved Edit' }));
        expect(result.current.values.title).toBe('My Unsaved Edit');

        // A background refetch of the SAME id returns a NEW object reference but the same id — must not reseed.
        const backgroundRefetch = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: backgroundRefetch }));
        rerender();

        expect(result.current.values.title).toBe('My Unsaved Edit');
    });

    it('DOES reseed when the id changes (a real navigation to a different recipe)', () => {
        const first = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: first }));
        const { result, rerender } = renderHook(({ id }) => useRecipeEditor(id, { onSaved: vi.fn() }), {
            initialProps: { id: 'rec_1' },
        });

        act(() => result.current.setValues({ ...result.current.values, title: 'My Unsaved Edit' }));

        const second = makeRecipeDetail({ id: 'rec_2', title: 'Sunday Roast', currentVersion: 1 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: second }));
        rerender({ id: 'rec_2' });

        expect(result.current.values.title).toBe('Sunday Roast');
    });
});

describe('useRecipeEditor — validation blocks submit', () => {
    it('does not call mutate and records field errors for an invalid draft', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation();
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.setValues({ ...result.current.values, title: '' }));
        act(() => result.current.submit());

        expect(mutation.mutate).not.toHaveBeenCalled();
        expect(result.current.errors).toEqual(validateRecipeForm(result.current.values));
        expect(Object.keys(result.current.errors).length).toBeGreaterThan(0);
    });
});

describe('useRecipeEditor — submit success', () => {
    it('carries the loaded currentVersion as expectedVersion, transitions to "saved", and calls onSaved', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4 });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const onSaved = vi.fn();
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved }));

        act(() => result.current.submit());

        const [vars] = mutation.mutate.mock.calls[0] as [MutateVars];
        expect(vars.id).toBe('rec_1');
        expect(vars.input.expectedVersion).toBe(3);
        expect(result.current.state).toEqual({ status: 'saved' });
        expect(onSaved).toHaveBeenCalledWith(saved);
    });
});

describe('useRecipeEditor — the "saved" latch resets on resumed editing', () => {
    // Regression: `saved` used to be a one-way latch (`setSaved(true)` on submit-success, never cleared), and
    // the state derivation read `saved ? 'saved' : ...` ABOVE `editing`. A consumer that does NOT unmount on
    // `onSaved` (e.g. a multi-step wizard) could resume editing after a save, hit a later conflict, resolve it,
    // and have the machine wrongly re-derive `'saved'` instead of `'editing'`.
    it('returns to "editing" when the user resumes editing via setField after a successful save', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', servings: 4, currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4 });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.submit());
        expect(result.current.state).toEqual({ status: 'saved' });

        act(() => result.current.setField('servings', 6));

        expect(result.current.state).toEqual({ status: 'editing' });
    });

    it('returns to "editing" when the user resumes editing via setValues after a successful save', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4 });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.submit());
        expect(result.current.state).toEqual({ status: 'saved' });

        act(() => result.current.setValues({ ...result.current.values, title: 'Sunday Roast' }));

        expect(result.current.state).toEqual({ status: 'editing' });
    });

    it('does not resurrect "saved" after a post-save conflict is resolved via useTheirs (the exact trap: save -> resume editing -> 409 -> useTheirs)', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        const saved = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 4 });
        const theirs = makeRecipeDetail({ id: 'rec_1', title: 'Server Title', currentVersion: 5 });
        const refetch = vi.fn().mockResolvedValue({ data: theirs });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded, refetch }));
        const mutation = updateMutation([
            { type: 'success', recipe: saved },
            { type: 'conflict', error: new VersionConflictError(5, 4) },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.submit());
        expect(result.current.state).toEqual({ status: 'saved' });

        // Resume editing WITHOUT unmounting (the wizard case) and hit a conflict on the next save.
        act(() => result.current.setField('title', 'My Second Draft'));
        await act(async () => {
            result.current.submit();
            await Promise.resolve();
        });
        expect(result.current.state.status).toBe('conflict');

        act(() => result.current.resolutions.useTheirs());

        // The stale `saved` latch must NOT resurface once the conflict clears — the machine is editing again.
        expect(result.current.state).toEqual({ status: 'editing' });
    });
});

describe('useRecipeEditor — 409 -> conflict (the handled-409 invariant)', () => {
    it('a version-conflict submit transitions to "conflict", never to a generic submitError', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        const theirs = makeRecipeDetail({ id: 'rec_1', title: 'Server Title', currentVersion: 5 });
        useRecipeMock.mockReturnValue(
            recipeQuery({ data: loaded, refetch: vi.fn().mockResolvedValue({ data: theirs }) }),
        );
        const mutation = updateMutation([{ type: 'conflict', error: new VersionConflictError(5, 3) }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        await act(async () => {
            result.current.submit();
            await Promise.resolve();
        });

        expect(result.current.state).toMatchObject({
            status: 'conflict',
            theirs,
            draft: expect.objectContaining({ title: 'My Draft' }),
        });
        // The handled-409 invariant: it must NEVER surface as the generic submit-error flag.
        expect(result.current.submitError).toBe(false);
    });

    it('a NON-conflict submit failure leaves the machine editing and DOES set submitError', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation([{ type: 'conflict', error: new Error('network down') }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.submit());

        expect(result.current.state).toEqual({ status: 'editing' });
        expect(result.current.submitError).toBe(true);
    });

    it('a resubmit via keepMine carries theirs.currentVersion as expectedVersion, not the stale version', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        const theirs = makeRecipeDetail({ id: 'rec_1', title: 'Server Title', currentVersion: 5 });
        useRecipeMock.mockReturnValue(
            recipeQuery({ data: loaded, refetch: vi.fn().mockResolvedValue({ data: theirs }) }),
        );
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 6 });
        const mutation = updateMutation([
            { type: 'conflict', error: new VersionConflictError(5, 3) },
            { type: 'success', recipe: saved },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const onSaved = vi.fn();
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved }));

        await act(async () => {
            result.current.submit();
            await Promise.resolve();
        });
        act(() => result.current.resolutions.keepMine());

        expect(mutation.mutate).toHaveBeenCalledTimes(2);
        const [firstVars] = mutation.mutate.mock.calls[0] as [MutateVars];
        const [secondVars] = mutation.mutate.mock.calls[1] as [MutateVars];
        expect(firstVars.input.expectedVersion).toBe(3);
        expect(secondVars.input.expectedVersion).toBe(theirs.currentVersion);
        expect(secondVars.input.expectedVersion).toBe(5);
        expect(onSaved).toHaveBeenCalledWith(saved);
    });

    it('keepMine and merge are no-ops outside conflict state', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation();
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.resolutions.keepMine());
        act(() => result.current.resolutions.merge({}));

        expect(mutation.mutate).not.toHaveBeenCalled();
    });
});

describe('useRecipeEditor — useTheirs reseeds values (closes the reseed incompatibility)', () => {
    it('discards the draft and reseeds `values` from `theirs`, exiting conflict without navigating', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        const theirs = makeRecipeDetail({ id: 'rec_1', title: 'Server Title', currentVersion: 5 });
        useRecipeMock.mockReturnValue(
            recipeQuery({ data: loaded, refetch: vi.fn().mockResolvedValue({ data: theirs }) }),
        );
        const mutation = updateMutation([{ type: 'conflict', error: new VersionConflictError(5, 3) }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const onSaved = vi.fn();
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved }));

        await act(async () => {
            result.current.submit();
            await Promise.resolve();
        });
        expect(result.current.state.status).toBe('conflict');

        act(() => result.current.resolutions.useTheirs());

        expect(result.current.state).toEqual({ status: 'editing' });
        expect(result.current.values.title).toBe('Server Title');
        expect(onSaved).not.toHaveBeenCalled();
    });
});

describe('useRecipeEditor — merge(selections) composes via composeMergedRecipe and submits', () => {
    it('composes mine + theirs per the given selections and submits against theirs.currentVersion', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3, servings: 4 });
        const theirs = makeRecipeDetail({ id: 'rec_1', title: 'Server Title', currentVersion: 5, servings: 8 });
        useRecipeMock.mockReturnValue(
            recipeQuery({ data: loaded, refetch: vi.fn().mockResolvedValue({ data: theirs }) }),
        );
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 6 });
        const mutation = updateMutation([
            { type: 'conflict', error: new VersionConflictError(5, 3) },
            { type: 'success', recipe: saved },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const onSaved = vi.fn();
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved }));

        await act(async () => {
            result.current.submit();
            await Promise.resolve();
        });
        // Pull servings from theirs, keep title on mine (the default, an absent key).
        act(() => result.current.resolutions.merge({ servings: 'theirs' }));

        expect(mutation.mutate).toHaveBeenCalledTimes(2);
        const [secondVars] = mutation.mutate.mock.calls[1] as [{ id: string; input: Record<string, unknown> }];
        expect(secondVars.input['title']).toBe('My Draft');
        expect(secondVars.input['servings']).toBe(8);
        expect((secondVars.input as { expectedVersion: number }).expectedVersion).toBe(5);
        expect(onSaved).toHaveBeenCalledWith(saved);
    });

    it('setMergeSelections updates conflict.mergeSelections; a no-op outside conflict', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        // Outside conflict: a no-op, state stays 'editing'.
        act(() => result.current.resolutions.setMergeSelections({ title: 'theirs' }));
        expect(result.current.state).toEqual({ status: 'editing' });
    });
});

describe('useRecipeEditor — setField patches a single field', () => {
    it('patches only the given field, leaving the rest of the draft untouched', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', servings: 4, currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.setField('servings', 6));

        expect(result.current.values.servings).toBe(6);
        expect(result.current.values.title).toBe('Weeknight Pasta');
    });
});

describe('useRecipeEditor — query passthrough', () => {
    it('exposes the underlying recipe query state for the container’s own loading/error affordance', () => {
        useRecipeMock.mockReturnValue(recipeQuery({ data: undefined, isError: true, error: new Error('boom') }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        expect(result.current.query.isError).toBe(true);
        expect(result.current.query.error).toBeInstanceOf(Error);
    });
});

// --- w3: wizard step state, step-scoped validation, draft/publish -------------------------------------

describe('useRecipeEditor — wizard step state (w3, orthogonal to EditorState)', () => {
    it('defaults to step 1', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        expect(result.current.step).toBe(1);
        // Orthogonal: the step dimension never appears on `state`.
        expect(result.current.state).toEqual({ status: 'editing' });
    });

    it('goToStep jumps directly to any step (no gating — the free step-rail navigation)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.goToStep(3));
        expect(result.current.step).toBe(3);
        act(() => result.current.goToStep(1));
        expect(result.current.step).toBe(1);
    });

    it('goNext advances one step when the current step is valid', () => {
        // The default fixture seeds a fully valid recipe, so step 1 is valid.
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.goNext());
        expect(result.current.step).toBe(2);
    });

    it('goNext is BLOCKED when the current step is invalid (an empty title)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.setField('title', ''));
        act(() => result.current.goNext());

        expect(result.current.step).toBe(1);
    });

    it('goPrev decrements, floored at step 1', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.goToStep(2));
        act(() => result.current.goPrev());
        expect(result.current.step).toBe(1);

        act(() => result.current.goPrev());
        expect(result.current.step).toBe(1);
    });

    it('goNext does not advance past step 4 (ceiling)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.goToStep(4));
        act(() => result.current.goNext());
        expect(result.current.step).toBe(4);
    });
});

describe('useRecipeEditor — canAdvanceFrom / stepErrors (w3, filters the ONE validator by field->step map)', () => {
    it('canAdvanceFrom(1) is false when title is blank, true once filled', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.setField('title', ''));
        expect(result.current.canAdvanceFrom(1)).toBe(false);

        act(() => result.current.setField('title', 'Weeknight Pasta'));
        expect(result.current.canAdvanceFrom(1)).toBe(true);
    });

    it('stepErrors(2) reflects only the ingredients error, never title (even when title is also blank)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.setValues({ ...result.current.values, title: '', ingredients: [] }));

        expect(result.current.stepErrors(2)).toEqual({ ingredients: 'ingredientsEmpty' });
        expect(result.current.canAdvanceFrom(2)).toBe(false);
    });

    it('stepErrors(4) (photos) is always empty — decoupled from form validation', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.setValues({ ...result.current.values, title: '', ingredients: [], steps: [] }));

        expect(result.current.stepErrors(4)).toEqual({});
        expect(result.current.canAdvanceFrom(4)).toBe(true);
    });
});

describe('useRecipeEditor — publish (w3: whole-form validate, then submit with status "published")', () => {
    it('validates the WHOLE form (not just the current step) and blocks with field errors when invalid', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation();
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.setValues({ ...result.current.values, ingredients: [] }));
        act(() => result.current.publish());

        expect(mutation.mutate).not.toHaveBeenCalled();
        expect(result.current.errors.ingredients).toBe('ingredientsEmpty');
    });

    it('submits with status: "published" when the whole form is valid', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4 });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const onSaved = vi.fn();
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved }));

        act(() => result.current.publish());

        const [vars] = mutation.mutate.mock.calls[0] as [{ id: string; input: Record<string, unknown> }];
        expect(vars.input['status']).toBe('published');
        expect(result.current.state).toEqual({ status: 'saved' });
        expect(onSaved).toHaveBeenCalledWith(saved);
    });
});

describe('useRecipeEditor — saveDraft (w3: relaxed floor — title only, ingredients/steps may be empty)', () => {
    it('blocks when the draft floor fails (a blank title, which the wire schema itself would reject)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation();
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.setField('title', ''));
        act(() => result.current.saveDraft());

        expect(mutation.mutate).not.toHaveBeenCalled();
        expect(result.current.errors.title).toBe('titleRequired');
    });

    it('submits with status: "draft" even when ingredients/steps are empty (the relaxed floor)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4 });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const onSaved = vi.fn();
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved }));

        act(() => result.current.setValues({ ...result.current.values, ingredients: [], steps: [] }));
        act(() => result.current.saveDraft());

        const [vars] = mutation.mutate.mock.calls[0] as [{ id: string; input: Record<string, unknown> }];
        expect(vars.input['status']).toBe('draft');
        expect(result.current.state).toEqual({ status: 'saved' });
        expect(onSaved).toHaveBeenCalledWith(saved);
    });

    it('does not carry a status onto the plain submit() path (never a side-effecting publication flip)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4 });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.submit());

        const [vars] = mutation.mutate.mock.calls[0] as [{ id: string; input: Record<string, unknown> }];
        expect('status' in vars.input).toBe(false);
    });
});

describe('useRecipeEditor — the four invariants re-proven WITH the step dimension (w3)', () => {
    it('seed-once no-clobber: a background refetch after a step change does not clobber in-progress edits', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result, rerender } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.setValues({ ...result.current.values, title: 'My Unsaved Edit' }));
        act(() => result.current.goToStep(2));

        const backgroundRefetch = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: backgroundRefetch }));
        rerender();

        expect(result.current.values.title).toBe('My Unsaved Edit');
        // The step change itself must not have been reverted by the background refetch either.
        expect(result.current.step).toBe(2);
    });

    it('a 409 from a non-1 step still enters "conflict" (never submitError), and does not reset the step', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        const theirs = makeRecipeDetail({ id: 'rec_1', title: 'Server Title', currentVersion: 5 });
        useRecipeMock.mockReturnValue(
            recipeQuery({ data: loaded, refetch: vi.fn().mockResolvedValue({ data: theirs }) }),
        );
        const mutation = updateMutation([{ type: 'conflict', error: new VersionConflictError(5, 3) }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.goToStep(3));

        await act(async () => {
            result.current.submit();
            await Promise.resolve();
        });

        expect(result.current.state).toMatchObject({ status: 'conflict', theirs });
        expect(result.current.submitError).toBe(false);
        expect(result.current.step).toBe(3);
    });

    it('a resubmit via keepMine after a step change still carries theirs.currentVersion as expectedVersion', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        const theirs = makeRecipeDetail({ id: 'rec_1', title: 'Server Title', currentVersion: 5 });
        useRecipeMock.mockReturnValue(
            recipeQuery({ data: loaded, refetch: vi.fn().mockResolvedValue({ data: theirs }) }),
        );
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 6 });
        const mutation = updateMutation([
            { type: 'conflict', error: new VersionConflictError(5, 3) },
            { type: 'success', recipe: saved },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.goToStep(2));
        await act(async () => {
            result.current.submit();
            await Promise.resolve();
        });
        act(() => result.current.goToStep(4));
        act(() => result.current.resolutions.keepMine());

        const [secondVars] = mutation.mutate.mock.calls[1] as [MutateVars];
        expect(secondVars.input.expectedVersion).toBe(theirs.currentVersion);
        expect(secondVars.input.expectedVersion).toBe(5);
    });

    it('a step change does NOT trip the "saved" latch and does NOT reseed', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4 });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.submit());
        expect(result.current.state).toEqual({ status: 'saved' });

        act(() => result.current.goToStep(2));

        // Navigating steps is not an edit — the saved latch and the seeded draft both survive.
        expect(result.current.state).toEqual({ status: 'saved' });
        expect(result.current.values.title).toBe('Weeknight Pasta');
    });

    it('the "saved" latch still resets on a post-save edit even after navigating steps in between', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', servings: 4, currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4 });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn() }));

        act(() => result.current.submit());
        expect(result.current.state).toEqual({ status: 'saved' });

        act(() => result.current.goToStep(2));
        act(() => result.current.setField('servings', 6));

        expect(result.current.state).toEqual({ status: 'editing' });
    });
});
