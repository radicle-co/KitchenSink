/**
 * Tests for {@link useRecipeEditor} — the shared recipe-edit lifecycle statechart (CP-6/P1, B2) that
 * resolves the web-vs-mobile reseed incompatibility described in `.superpowers/sdd/cp6-current-state.md`
 * §2. Pins the invariants the two platform containers depended on before the extraction: seed-once (a
 * background refetch of the SAME recipe never clobbers an in-progress edit); a 409 — and ONLY a 409 — opens
 * `status: 'conflict'`, never surfacing as `submitError`; a resubmit (via `overwrite`) carries
 * `server.versionNumber`, not the stale version that lost the race; `merge(selections)` composes via
 * `composeConflictMerge` and submits; and validation blocks a `submit()`
 * on an invalid draft. The `@kitchensink/recipe-service-client/hooks` module is mocked (its own behavior is
 * covered by that package's tests); `VersionConflictError`/`isVersionConflictError` are the REAL
 * implementations, so the 409-detection path is exercised for real, not stubbed.
 *
 * W7 Task 2 additions: the 409's enriched `server`/`base` sides thread into `conflict` WITHOUT a refetch
 * (asserted directly via a `refetch` spy); a diff-empty ("phantom") 409 resubmits instead of interrupting
 * the user; `versionsBehind`/an absent `base` expose the staleness signal; `keepServer` (Option A) discards
 * the draft and exits via a NEW, distinct `'discarded'` terminal state (never `'saved'`, so a container can
 * never show a misleading "Saved!" for a discard); `overwrite` (Option B) and `merge` (Option C, now
 * PER-ELEMENT via `steps[N]`/`ingredients:<id>` keys) both resolve against `server.versionNumber`; and a
 * second 409 during a resolve resubmit re-enters conflict from THAT error's own `server`/`base`, never a
 * refetch. W7 Task 6: the pre-Task-2 `keepMine`/`useTheirs` names are gone from `resolutions` — every test
 * below drives the CURRENT `overwrite`/`keepServer` names, now that both platform containers are wired onto
 * them.
 */
import { act, renderHook } from '@testing-library/react';
import { RecipeStatus } from '@kitchensink/recipe-core';
import type { RecipeIngredient, RecipeSnapshot, RecipeStep, VersionConflictSide } from '@kitchensink/recipe-core';
import { VersionConflictError } from '@kitchensink/recipe-service-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeIngredientView, makeRecipeDetail, makeStepView } from '../../__fixtures__/index.js';
import { validateRecipeForm } from '../../form/model.js';

/** Build a {@link RecipeStep} with sensible defaults, overridable per field — mirrors `conflictDiff.test.ts`'s
 *  local fixture, kept local here too rather than shared (single consumer per file, per DAMP-in-tests). */
const makeStep = (overrides: Partial<RecipeStep> = {}): RecipeStep => ({
    id: 'step_1',
    recipeId: 'rec_1',
    stepNumber: 1,
    instruction: 'Combine the ingredients.',
    ...overrides,
});

/** Build a {@link RecipeIngredient} with sensible defaults, overridable per field. `sortOrder` defaults to
 *  `0` (NOT `1`) to match `useRecipeEditor`'s own `draftToSnapshot` projection, which numbers a draft's
 *  ingredients from array index `0` — keeping the two aligned is what lets the phantom-fast-path tests below
 *  construct a server/base snapshot that is content-IDENTICAL to a freshly-seeded draft. */
const makeIngredient = (overrides: Partial<RecipeIngredient> = {}): RecipeIngredient => ({
    id: 'ri_1',
    recipeId: 'rec_1',
    ingredientId: 'ing_1',
    quantity: 2,
    unit: 'tbsp',
    sortOrder: 0,
    ingredientName: 'Olive oil',
    isUserEntered: false,
    ...overrides,
});

/** Build a {@link RecipeSnapshot} with sensible defaults ALIGNED to `makeRecipeDetail`'s own defaults (same
 *  title/description/servings/times/ingredient/step content), overridable per field — so a snapshot built
 *  from this factory content-matches a `RecipeDetail` built from `makeRecipeDetail()` with no overrides. */
const makeSnapshot = (overrides: Partial<RecipeSnapshot> = {}): RecipeSnapshot => ({
    version: 1,
    title: 'Weeknight Pasta',
    description: 'A fast, comforting weeknight dinner.',
    steps: [makeStep()],
    ingredients: [makeIngredient()],
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    ...overrides,
});

/** Build a {@link VersionConflictSide} (a 409's `server`/`base`) with sensible defaults, overridable per
 *  field. */
const makeSide = (overrides: Partial<VersionConflictSide> = {}): VersionConflictSide => ({
    versionNumber: 5,
    updatedAt: '2026-04-19T09:30:00.000Z',
    snapshot: makeSnapshot(),
    ...overrides,
});

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
        const { result, rerender } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

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
        const { result, rerender } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

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
        const { result, rerender } = renderHook(({ id }) => useRecipeEditor(id, { onSaved: vi.fn(), locale: 'en' }), {
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
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

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
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved, locale: 'en' }));

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
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

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
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());
        expect(result.current.state).toEqual({ status: 'saved' });

        act(() => result.current.setValues({ ...result.current.values, title: 'Sunday Roast' }));

        expect(result.current.state).toEqual({ status: 'editing' });
    });

    it('does not resurrect "saved" after a post-save conflict is resolved via keepServer (the exact trap: save -> resume editing -> 409 -> keepServer)', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        const saved = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 4 });
        const refetch = vi.fn();
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded, refetch }));
        const mutation = updateMutation([
            { type: 'success', recipe: saved },
            {
                type: 'conflict',
                error: new VersionConflictError(5, 4, undefined, {
                    server: makeSide({
                        versionNumber: 5,
                        snapshot: makeSnapshot({ version: 5, title: 'Server Title' }),
                    }),
                    base: makeSide({
                        versionNumber: 4,
                        snapshot: makeSnapshot({ version: 4, title: 'My Second Draft' }),
                    }),
                }),
            },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());
        expect(result.current.state).toEqual({ status: 'saved' });

        // Resume editing WITHOUT unmounting (the wizard case) and hit a conflict on the next save.
        act(() => result.current.setField('title', 'My Second Draft'));
        await act(async () => {
            result.current.submit();
            await Promise.resolve();
        });
        expect(result.current.state.status).toBe('conflict');

        act(() => result.current.resolutions.keepServer());

        // The stale `saved` latch must NOT resurface once the conflict clears — the machine lands on the
        // discard terminal it actually resolved to, never a leftover `saved` from before this conflict.
        expect(result.current.state).toEqual({ status: 'discarded' });
    });
});

describe('useRecipeEditor — 409 -> conflict (the handled-409 invariant)', () => {
    it('a version-conflict submit transitions to "conflict", never to a generic submitError', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        const refetch = vi.fn();
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded, refetch }));
        const mutation = updateMutation([
            {
                type: 'conflict',
                error: new VersionConflictError(5, 3, undefined, {
                    server: makeSide({
                        versionNumber: 5,
                        snapshot: makeSnapshot({ version: 5, title: 'Server Title' }),
                    }),
                    base: makeSide({ versionNumber: 3, snapshot: makeSnapshot({ version: 3, title: 'My Draft' }) }),
                }),
            },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());

        expect(result.current.state).toMatchObject({
            status: 'conflict',
            theirs: expect.objectContaining({ title: 'Server Title', currentVersion: 5 }),
            draft: expect.objectContaining({ title: 'My Draft' }),
        });
        // The handled-409 invariant: it must NEVER surface as the generic submit-error flag.
        expect(result.current.submitError).toBe(false);
        // The core W7 Task 2 behavioral change: no refetch — the conflict is built from the 409's OWN
        // enriched `server`/`base`, not a follow-up round-trip to the server.
        expect(refetch).not.toHaveBeenCalled();
    });

    it('carries the enriched server/base + precomputed diff + versionsBehind on the conflict state', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const server = makeSide({
            versionNumber: 5,
            snapshot: makeSnapshot({ version: 5, title: 'Server Title', servings: 6 }),
        });
        const base = makeSide({ versionNumber: 3, snapshot: makeSnapshot({ version: 3 }) });
        const mutation = updateMutation([
            { type: 'conflict', error: new VersionConflictError(5, 3, undefined, { server, base }) },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());

        const state = result.current.state;

        if (state.status !== 'conflict') {
            throw new Error('expected conflict state');
        }

        expect(state.server).toBe(server);
        expect(state.base).toBe(base);
        // versionsBehind = server.versionNumber - base.versionNumber (X6 signal).
        expect(state.versionsBehind).toBe(2);
        expect(state.diff.isEmpty).toBe(false);
        expect(state.diff.rows.some((row) => row.key === 'title')).toBe(true);
        expect(state.mineSnapshot.title).toBe('My Draft');
    });

    it('treats an absent base (evicted from version history) as maximally stale via versionsBehind', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const server = makeSide({
            versionNumber: 25,
            snapshot: makeSnapshot({ version: 25, title: 'Server Title' }),
        });
        const mutation = updateMutation([
            { type: 'conflict', error: new VersionConflictError(25, 3, undefined, { server }) },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());

        const state = result.current.state;

        if (state.status !== 'conflict') {
            throw new Error('expected conflict state');
        }

        expect(state.base).toBeUndefined();
        // No base to subtract — versionsBehind degrades to the server's own version number, which is > 10
        // for any recipe with real history (the "treat absent base as stale" degradation).
        expect(state.versionsBehind).toBe(25);
        expect(state.versionsBehind).toBeGreaterThan(10);
    });

    it('a version-conflict whose diff is EMPTY (mine and theirs already agree) resubmits instead of entering conflict (the phantom fast-path)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation([
            {
                type: 'conflict',
                error: new VersionConflictError(6, 3, undefined, {
                    server: makeSide({ versionNumber: 6 }),
                    base: makeSide({ versionNumber: 3 }),
                }),
            },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());

        expect(mutation.mutate).toHaveBeenCalledTimes(2);
        const [, secondCall] = mutation.mutate.mock.calls;
        const [secondVars] = secondCall as [MutateVars];
        // The phantom resubmit carries the FRESH server version as its CAS token.
        expect(secondVars.input.expectedVersion).toBe(6);
        expect(result.current.state.status).not.toBe('conflict');
    });

    it('a NON-conflict submit failure leaves the machine editing and DOES set submitError', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation([{ type: 'conflict', error: new Error('network down') }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());

        expect(result.current.state).toEqual({ status: 'editing' });
        expect(result.current.submitError).toBe(true);
    });

    // Opus-review finding: a 409 that IS a VersionConflictError but carries no `server` side (a malformed/
    // un-enriched body — contract-guaranteed not to happen on the owner-update path, but possible via schema
    // drift, a proxy stripping the response body, or a serialization bug) cannot be 3-way-diffed or displayed,
    // so it can never enter `status: 'conflict'`. Before this fix, `submitError` ALSO stayed `false` for it
    // (by design — it deliberately excludes every `VersionConflictError`), so the user clicked Save, ate a
    // 409, and saw NOTHING: a silent no-op save. `conflictDataUnavailable` closes that gap without
    // reintroducing a refetch or a fabricated conflict view.
    it('an un-enriched 409 (VersionConflictError with no `server` side) sets conflictDataUnavailable, stays "editing", and never refetches', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        const refetch = vi.fn();
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded, refetch }));
        const mutation = updateMutation([
            { type: 'conflict', error: new VersionConflictError(undefined, 3, 'Recipe version conflict') },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());

        // No server snapshot to diff/display -> never enters `conflict`.
        expect(result.current.state).toEqual({ status: 'editing' });
        // The new, distinct feedback flag -> the user is NOT left staring at an unchanged form.
        expect(result.current.conflictDataUnavailable).toBe(true);
        // Still a handled VersionConflictError -> the generic submitError flag stays false (unchanged
        // semantics: submitError deliberately excludes EVERY VersionConflictError).
        expect(result.current.submitError).toBe(false);
        // No follow-up round-trip — this is a bail, not a resolution path.
        expect(refetch).not.toHaveBeenCalled();
    });

    // Regression guard: a normal, enriched 409 (the contract-guaranteed shape) must NOT trip the new flag.
    it('a normal enriched 409 (server present) leaves conflictDataUnavailable false and enters "conflict" as before', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        const refetch = vi.fn();
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded, refetch }));
        const mutation = updateMutation([
            {
                type: 'conflict',
                error: new VersionConflictError(5, 3, undefined, {
                    server: makeSide({
                        versionNumber: 5,
                        snapshot: makeSnapshot({ version: 5, title: 'Server Title' }),
                    }),
                    base: makeSide({ versionNumber: 3, snapshot: makeSnapshot({ version: 3, title: 'My Draft' }) }),
                }),
            },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());

        expect(result.current.state.status).toBe('conflict');
        expect(result.current.conflictDataUnavailable).toBe(false);
        expect(refetch).not.toHaveBeenCalled();
    });

    it('a resubmit via overwrite carries theirs.currentVersion as expectedVersion, not the stale version', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 6 });
        const mutation = updateMutation([
            {
                type: 'conflict',
                error: new VersionConflictError(5, 3, undefined, {
                    server: makeSide({
                        versionNumber: 5,
                        snapshot: makeSnapshot({ version: 5, title: 'Server Title' }),
                    }),
                    base: makeSide({ versionNumber: 3, snapshot: makeSnapshot({ version: 3, title: 'My Draft' }) }),
                }),
            },
            { type: 'success', recipe: saved },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const onSaved = vi.fn();
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved, locale: 'en' }));

        act(() => result.current.submit());
        act(() => result.current.resolutions.overwrite());

        expect(mutation.mutate).toHaveBeenCalledTimes(2);
        const [firstVars] = mutation.mutate.mock.calls[0] as [MutateVars];
        const [secondVars] = mutation.mutate.mock.calls[1] as [MutateVars];
        expect(firstVars.input.expectedVersion).toBe(3);
        expect(secondVars.input.expectedVersion).toBe(5);
        expect(onSaved).toHaveBeenCalledWith(saved);
    });

    it('overwrite (Option B, "yours win") resubmits the draft against server.versionNumber; a second 409 re-enters conflict from the NEW error, never a refetch', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        const refetch = vi.fn();
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded, refetch }));
        const firstServer = makeSide({
            versionNumber: 5,
            snapshot: makeSnapshot({ version: 5, title: 'Server Title A' }),
        });
        const secondServer = makeSide({
            versionNumber: 7,
            snapshot: makeSnapshot({ version: 7, title: 'Server Title B' }),
        });
        const mutation = updateMutation([
            { type: 'conflict', error: new VersionConflictError(5, 3, undefined, { server: firstServer }) },
            { type: 'conflict', error: new VersionConflictError(7, 5, undefined, { server: secondServer }) },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());
        expect(result.current.state).toMatchObject({ status: 'conflict', server: firstServer });

        act(() => result.current.resolutions.overwrite());

        const [secondVars] = mutation.mutate.mock.calls[1] as [MutateVars];
        expect(secondVars.input.expectedVersion).toBe(5);
        expect(result.current.state).toMatchObject({ status: 'conflict', server: secondServer });
        expect(refetch).not.toHaveBeenCalled();
    });

    it('keepServer discards the draft and exits WITHOUT saving — the discard signal, distinct from "saved"', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation([
            {
                type: 'conflict',
                error: new VersionConflictError(5, 3, undefined, {
                    server: makeSide({
                        versionNumber: 5,
                        snapshot: makeSnapshot({ version: 5, title: 'Server Title' }),
                    }),
                }),
            },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());
        expect(result.current.state.status).toBe('conflict');

        act(() => result.current.resolutions.keepServer());

        // No resolve write — the server already holds the winning version.
        expect(mutation.mutate).toHaveBeenCalledTimes(1);
        expect(result.current.state).toEqual({ status: 'discarded' });
    });

    it('overwrite, keepServer, and merge are all no-ops outside conflict state', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation();
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.resolutions.overwrite());
        act(() => result.current.resolutions.keepServer());
        act(() => result.current.resolutions.merge({}));

        expect(mutation.mutate).not.toHaveBeenCalled();
        expect(result.current.state).toEqual({ status: 'editing' });
    });
});

describe('useRecipeEditor — in-flight guard against double-submit on conflict resolutions', () => {
    // Regression: a rapid double-click on Overwrite/Save-merged fired TWO PATCH requests with the SAME
    // `expectedVersion` — the loser re-entered a second conflict screen right after the user thought they had
    // resolved the first one. `updateRecipe.isPending` is react-query's own in-flight signal (mirrored here by
    // NOT queuing a settling outcome for the resolve call, so `mutate` never invokes its callbacks — exactly
    // like a real PATCH still in flight); this describes the guard that must block a SECOND resolve while the
    // first is still outstanding.
    it('overwrite (Option B) fires the underlying mutation exactly once when invoked again while the first resolve is still pending', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation([
            {
                type: 'conflict',
                error: new VersionConflictError(5, 3, undefined, {
                    server: makeSide({
                        versionNumber: 5,
                        snapshot: makeSnapshot({ version: 5, title: 'Server Title' }),
                    }),
                }),
            },
            // No outcome queued for the resolve itself — `mutate` is called but never settles, mirroring an
            // in-flight PATCH still awaiting its response.
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result, rerender } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());
        expect(result.current.state.status).toBe('conflict');

        act(() => result.current.resolutions.overwrite());
        expect(mutation.mutate).toHaveBeenCalledTimes(2);

        // The resolve mutation is now in flight — flip `isPending` exactly as react-query would once the
        // request is outstanding, then re-render so the hook's next closures observe it.
        useUpdateRecipeMock.mockReturnValue({ ...mutation, isPending: true });
        rerender();

        act(() => result.current.resolutions.overwrite());

        // The guard must block the second, in-flight resubmit — the call count stays at 2 (the original
        // submit + the FIRST overwrite only).
        expect(mutation.mutate).toHaveBeenCalledTimes(2);
    });

    it('merge (Option C) fires the underlying mutation exactly once when invoked again while the first resolve is still pending', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation([
            {
                type: 'conflict',
                error: new VersionConflictError(5, 3, undefined, {
                    server: makeSide({
                        versionNumber: 5,
                        snapshot: makeSnapshot({ version: 5, title: 'Server Title' }),
                    }),
                }),
            },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result, rerender } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());
        expect(result.current.state.status).toBe('conflict');

        act(() => result.current.resolutions.merge({ title: 'theirs' }));
        expect(mutation.mutate).toHaveBeenCalledTimes(2);

        useUpdateRecipeMock.mockReturnValue({ ...mutation, isPending: true });
        rerender();

        act(() => result.current.resolutions.merge({ title: 'theirs' }));

        expect(mutation.mutate).toHaveBeenCalledTimes(2);
    });

    it('keepServer (Option A) is a no-op while another resolution is still in flight — it must not clear the conflict out from under an outstanding overwrite/merge', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation([
            {
                type: 'conflict',
                error: new VersionConflictError(5, 3, undefined, {
                    server: makeSide({
                        versionNumber: 5,
                        snapshot: makeSnapshot({ version: 5, title: 'Server Title' }),
                    }),
                }),
            },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result, rerender } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());
        act(() => result.current.resolutions.overwrite());
        expect(mutation.mutate).toHaveBeenCalledTimes(2);

        useUpdateRecipeMock.mockReturnValue({ ...mutation, isPending: true });
        rerender();

        act(() => result.current.resolutions.keepServer());

        // keepServer never calls `mutate` itself, but while a resolve is in flight it must ALSO decline to
        // discard — otherwise the outstanding overwrite's own eventual onSuccess/onError would fire AFTER the
        // user was already navigated away on a bogus "discarded" terminal, corrupting the machine's state.
        expect(mutation.mutate).toHaveBeenCalledTimes(2);
        expect(result.current.state.status).toBe('conflict');
    });

    it('exposes isResolving on the conflict state, true only while a resolve mutation is in flight', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation([
            {
                type: 'conflict',
                error: new VersionConflictError(5, 3, undefined, {
                    server: makeSide({
                        versionNumber: 5,
                        snapshot: makeSnapshot({ version: 5, title: 'Server Title' }),
                    }),
                }),
            },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result, rerender } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());
        expect(result.current.state).toMatchObject({ status: 'conflict', isResolving: false });

        act(() => result.current.resolutions.overwrite());
        useUpdateRecipeMock.mockReturnValue({ ...mutation, isPending: true });
        rerender();

        expect(result.current.state).toMatchObject({ status: 'conflict', isResolving: true });
    });
});

describe('useRecipeEditor — merge(selections) composes via composeConflictMerge and submits', () => {
    it('composes top-level field selections (composeMergedRecipe’s own scope) and submits against server.versionNumber', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3, servings: 4 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 6 });
        const mutation = updateMutation([
            {
                type: 'conflict',
                error: new VersionConflictError(5, 3, undefined, {
                    server: makeSide({
                        versionNumber: 5,
                        snapshot: makeSnapshot({ version: 5, title: 'Server Title', servings: 8 }),
                    }),
                }),
            },
            { type: 'success', recipe: saved },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const onSaved = vi.fn();
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved, locale: 'en' }));

        act(() => result.current.submit());
        // Pull servings from theirs, keep title on mine (the default, an absent key).
        act(() => result.current.resolutions.merge({ servings: 'theirs' }));

        expect(mutation.mutate).toHaveBeenCalledTimes(2);
        const [secondVars] = mutation.mutate.mock.calls[1] as [{ id: string; input: Record<string, unknown> }];
        expect(secondVars.input['title']).toBe('My Draft');
        expect(secondVars.input['servings']).toBe(8);
        expect((secondVars.input as { expectedVersion: number }).expectedVersion).toBe(5);
        expect(onSaved).toHaveBeenCalledWith(saved);
    });

    it('composes PER-ELEMENT selections (steps[N]/ingredients:<id>, W7 Task 1 row keys) and submits against server.versionNumber', () => {
        const loaded = makeRecipeDetail({
            id: 'rec_1',
            currentVersion: 3,
            steps: [
                makeStepView({ stepNumber: 1, instruction: 'Mine step one' }),
                makeStepView({ stepNumber: 2, instruction: 'Mine step two' }),
            ],
            ingredients: [makeIngredientView({ ingredientId: 'ing_1', name: 'Olive oil', quantity: 2, unit: 'tbsp' })],
        });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const server = makeSide({
            versionNumber: 5,
            snapshot: makeSnapshot({
                version: 5,
                steps: [
                    makeStep({ id: 'st_1', stepNumber: 1, instruction: 'Mine step one' }),
                    makeStep({ id: 'st_2', stepNumber: 2, instruction: 'Their step two' }),
                ],
                ingredients: [
                    makeIngredient({
                        id: 'ri_1',
                        ingredientId: 'ing_1',
                        ingredientName: 'Olive oil',
                        quantity: 2,
                        unit: 'tbsp',
                        sortOrder: 0,
                    }),
                    makeIngredient({
                        id: 'ri_2',
                        ingredientId: 'ing_2',
                        ingredientName: 'Butter',
                        quantity: 1,
                        unit: 'tbsp',
                        sortOrder: 1,
                    }),
                ],
            }),
        });
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 6 });
        const mutation = updateMutation([
            { type: 'conflict', error: new VersionConflictError(5, 3, undefined, { server }) },
            { type: 'success', recipe: saved },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const onSaved = vi.fn();
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved, locale: 'en' }));

        act(() => result.current.submit());
        act(() => result.current.resolutions.merge({ 'steps[1]': 'theirs', 'ingredients:ing_2': 'theirs' }));

        expect(mutation.mutate).toHaveBeenCalledTimes(2);
        const [secondVars] = mutation.mutate.mock.calls[1] as [{ id: string; input: Record<string, unknown> }];
        expect((secondVars.input as { expectedVersion: number }).expectedVersion).toBe(5);
        const steps = secondVars.input['steps'] as ReadonlyArray<{ instruction: string }>;
        expect(steps.map((step) => step.instruction)).toEqual(['Mine step one', 'Their step two']);
        const ingredients = secondVars.input['ingredients'] as ReadonlyArray<{ ingredientId: string }>;
        expect(ingredients.map((ingredient) => ingredient.ingredientId).sort()).toEqual(['ing_1', 'ing_2']);
        expect(onSaved).toHaveBeenCalledWith(saved);
    });

    it('setMergeSelections updates conflict.mergeSelections; a no-op outside conflict', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

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
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.setField('servings', 6));

        expect(result.current.values.servings).toBe(6);
        expect(result.current.values.title).toBe('Weeknight Pasta');
    });
});

describe('useRecipeEditor — query passthrough', () => {
    it('exposes the underlying recipe query state for the container’s own loading/error affordance', () => {
        useRecipeMock.mockReturnValue(recipeQuery({ data: undefined, isError: true, error: new Error('boom') }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

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
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        expect(result.current.step).toBe(1);
        // Orthogonal: the step dimension never appears on `state`.
        expect(result.current.state).toEqual({ status: 'editing' });
    });

    it('goToStep jumps directly to any step (no gating — the free step-rail navigation)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

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
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.goNext());
        expect(result.current.step).toBe(2);
    });

    it('goNext is BLOCKED when the current step is invalid (an empty title)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.setField('title', ''));
        act(() => result.current.goNext());

        expect(result.current.step).toBe(1);
    });

    it('goPrev decrements, floored at step 1', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

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
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

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
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.setField('title', ''));
        expect(result.current.canAdvanceFrom(1)).toBe(false);

        act(() => result.current.setField('title', 'Weeknight Pasta'));
        expect(result.current.canAdvanceFrom(1)).toBe(true);
    });

    it('stepErrors(2) reflects only the ingredients error, never title (even when title is also blank)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.setValues({ ...result.current.values, title: '', ingredients: [] }));

        expect(result.current.stepErrors(2)).toEqual({ ingredients: 'ingredientsEmpty' });
        expect(result.current.canAdvanceFrom(2)).toBe(false);
    });

    it('stepErrors(4) (photos) is always empty — decoupled from form validation', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

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
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

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
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved, locale: 'en' }));

        act(() => result.current.publish());

        const [vars] = mutation.mutate.mock.calls[0] as [{ id: string; input: Record<string, unknown> }];
        expect(vars.input['status']).toBe('published');
        expect(result.current.state).toEqual({ status: 'saved' });
        expect(onSaved).toHaveBeenCalledWith(saved);
    });
});

describe('useRecipeEditor — saveDraft (w3: relaxed floor — title only, ingredients/steps may be empty)', () => {
    it('blocks when the draft floor fails (a blank title, which the wire schema itself would reject)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3, status: RecipeStatus.DRAFT });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation();
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.setField('title', ''));
        act(() => result.current.saveDraft());

        expect(mutation.mutate).not.toHaveBeenCalled();
        expect(result.current.errors.title).toBe('titleRequired');
    });

    it('when editing a recipe seeded as "draft", submits status: "draft" even when ingredients/steps are empty (the relaxed floor)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3, status: RecipeStatus.DRAFT });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4, status: RecipeStatus.DRAFT });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const onSaved = vi.fn();
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved, locale: 'en' }));

        act(() => result.current.setValues({ ...result.current.values, ingredients: [], steps: [] }));
        act(() => result.current.saveDraft());

        const [vars] = mutation.mutate.mock.calls[0] as [{ id: string; input: Record<string, unknown> }];
        expect(vars.input['status']).toBe('draft');
        expect(result.current.state).toEqual({ status: 'saved' });
        expect(onSaved).toHaveBeenCalledWith(saved);
    });

    // Regression (opus review, Important #1): `saveDraft` used to send `status: 'draft'` UNCONDITIONALLY, so a
    // user editing an ALREADY-PUBLISHED recipe who clicked Save Draft would silently unpublish it (it would
    // vanish from public listings). Save Draft must NEVER downgrade a published recipe — the wireframe's own
    // words are "saves metadata without publishing; visibility stays as-is", and "as-is" covers the recipe's
    // publication state too, not just its `visibility` field.
    it('when editing a recipe seeded as "published", does NOT downgrade — preserves status: "published"', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3, status: RecipeStatus.PUBLISHED });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4, status: RecipeStatus.PUBLISHED });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const onSaved = vi.fn();
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved, locale: 'en' }));

        act(() => result.current.saveDraft());

        const [vars] = mutation.mutate.mock.calls[0] as [{ id: string; input: Record<string, unknown> }];
        // The recipe stays published — this is the crux of the regression: never 'draft' here.
        expect(vars.input['status']).toBe('published');
        expect(vars.input['status']).not.toBe('draft');
        expect(onSaved).toHaveBeenCalledWith(saved);
    });

    it('does not carry a status onto the plain submit() path (never a side-effecting publication flip)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3, status: RecipeStatus.PUBLISHED });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4 });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

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
        const { result, rerender } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.setValues({ ...result.current.values, title: 'My Unsaved Edit' }));
        act(() => result.current.goToStep(2));

        const backgroundRefetch = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: backgroundRefetch }));
        rerender();

        expect(result.current.values.title).toBe('My Unsaved Edit');
        // The step change itself must not have been reverted by the background refetch either.
        expect(result.current.step).toBe(2);
    });

    it('a 409 from a non-1 step still enters "conflict" (never submitError), and does not reset the step', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation([
            {
                type: 'conflict',
                error: new VersionConflictError(5, 3, undefined, {
                    server: makeSide({
                        versionNumber: 5,
                        snapshot: makeSnapshot({ version: 5, title: 'Server Title' }),
                    }),
                }),
            },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.goToStep(3));
        act(() => result.current.submit());

        expect(result.current.state).toMatchObject({
            status: 'conflict',
            theirs: expect.objectContaining({ title: 'Server Title', currentVersion: 5 }),
        });
        expect(result.current.submitError).toBe(false);
        expect(result.current.step).toBe(3);
    });

    it('a resubmit via overwrite after a step change still carries theirs.currentVersion as expectedVersion', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 6 });
        const mutation = updateMutation([
            {
                type: 'conflict',
                error: new VersionConflictError(5, 3, undefined, {
                    server: makeSide({
                        versionNumber: 5,
                        snapshot: makeSnapshot({ version: 5, title: 'Server Title' }),
                    }),
                }),
            },
            { type: 'success', recipe: saved },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.goToStep(2));
        act(() => result.current.submit());
        act(() => result.current.goToStep(4));
        act(() => result.current.resolutions.overwrite());

        const [secondVars] = mutation.mutate.mock.calls[1] as [MutateVars];
        expect(secondVars.input.expectedVersion).toBe(5);
    });

    it('a step change does NOT trip the "saved" latch and does NOT reseed', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 });
        useRecipeMock.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4 });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

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
        const { result } = renderHook(() => useRecipeEditor('rec_1', { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());
        expect(result.current.state).toEqual({ status: 'saved' });

        act(() => result.current.goToStep(2));
        act(() => result.current.setField('servings', 6));

        expect(result.current.state).toEqual({ status: 'editing' });
    });
});
