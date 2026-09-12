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
 * (the hook is handed a settled recipe and holds no query, so it structurally cannot refetch); a diff-empty ("phantom") 409 resubmits instead of interrupting
 * the user; `versionsBehind`/an absent `base` expose the staleness signal; `keepServer` (Option A) discards
 * the draft and exits via a NEW, distinct `'discarded'` terminal state (never `'saved'`, so a container can
 * never show a misleading "Saved!" for a discard); `overwrite` (Option B) and `merge` (Option C, now
 * PER-ELEMENT via `steps[N]`/`ingredients:<id>` keys) both resolve against `server.versionNumber`; and a
 * second 409 during a resolve resubmit re-enters conflict from THAT error's own `server`/`base`, never a
 * refetch. W7 Task 6: the pre-Task-2 `keepMine`/`useTheirs` names are gone from `resolutions` — every test
 * below drives the CURRENT `overwrite`/`keepServer` names, now that both platform containers are wired onto
 * them.
 */
import { act, render, renderHook, screen } from '@testing-library/react';
import { Suspense, useEffect, useRef, type JSX } from 'react';
import { RecipeStatus } from '@kitchensink/recipe-core';
import type {
    RecipeDetail,
    RecipeIngredient,
    RecipeSnapshot,
    RecipeStep,
    VersionConflictSide,
} from '@kitchensink/recipe-core';
import { VersionConflictError } from '@kitchensink/recipe-service-client';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { makeIngredientView, makeRecipeDetail, makeStepView } from '../../__fixtures__/index.js';
import { validateRecipeForm } from '../../form/validate.js';

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
    ingredientId: '00000000-0000-4000-8000-000000000001',
    quantity: { kind: 'exact', value: 2 },
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

const { useUpdateRecipeMock } = vi.hoisted(() => ({ useUpdateRecipeMock: vi.fn() }));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    // U5 — the analytics emitter's context read; a resolved stub keeps emission inert in leaf tests.
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
    useUpdateRecipe: useUpdateRecipeMock,
}));

/**
 * The settled recipe each render hands the hook — what a container's suspense read returns. A test swaps it and
 * re-renders to model a background refetch (a NEW object for the SAME recipe).
 */
const recipeSource = vi.fn<(id: string) => { readonly data: RecipeDetail }>();

/** The recipe the source currently returns for `id`. */
function currentRecipe(id = 'rec_1'): RecipeDetail {
    return recipeSource(id).data;
}

import { useDiscardGuard } from '../../wizard/useDiscardGuard.js';
import { AUTO_SAVE_INTERVAL_MS, useRecipeAutoSave } from '../useRecipeAutoSave.js';
import { useRecipeEditor, type EditorState } from '../useRecipeEditor.js';

/** A settled read of `data` (a recipe at version 3 by default). */
function recipeQuery(overrides: { readonly data?: RecipeDetail } = {}): { readonly data: RecipeDetail } {
    return { data: overrides.data ?? makeRecipeDetail({ id: 'rec_1', currentVersion: 3 }) };
}

type MutateVars = { readonly id: string; readonly input: { readonly expectedVersion: number } };
type MutateOptions = { onSuccess?: (recipe: unknown) => void; onError?: (err: unknown) => void };

/** One scripted outcome the mocked update mutation replays, in order, per `mutate` call. */
type Outcome =
    { readonly type: 'success'; readonly recipe: unknown } | { readonly type: 'conflict'; readonly error: unknown };

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
    /**
     * REWRITTEN (was "is loading until the recipe seeds"). The hook is handed the SETTLED recipe — the container's
     * suspense read owns pending and failed — so it is editing from its first render and has no loading state.
     */
    it('edits the recipe it is handed from the first render, with no loading state to represent', () => {
        expectTypeOf<EditorState['status']>().toEqualTypeOf<
            'editing' | 'submitting' | 'conflict' | 'saved' | 'discarded'
        >();
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        expect(result.current.state).toEqual({ status: 'editing' });
        expect(result.current.values.title).toBe('Weeknight Pasta');
    });

    it('does NOT clobber an in-progress edit when the SAME recipe re-renders with fresh (background-refetched) data', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        const { result, rerender } = renderHook(() =>
            useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }),
        );

        act(() => result.current.setValues({ ...result.current.values, title: 'My Unsaved Edit' }));
        expect(result.current.values.title).toBe('My Unsaved Edit');

        // A background refetch of the SAME id returns a NEW object reference but the same id — must not reseed.
        const backgroundRefetch = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: backgroundRefetch }));
        rerender();

        expect(result.current.values.title).toBe('My Unsaved Edit');
    });

    /**
     * REWRITTEN (was "DOES reseed when the id changes"). Editing another recipe is a NEW editor — both containers key
     * the settled editor on the recipe id, so a navigation remounts it (their suites pin that). The hook binds the
     * draft, its base version and the recipe its writes go to at ONE seed, so a different recipe handed to a mounted
     * editor can never pair this draft with another recipe's id.
     */
    it('keeps its draft and its writes on the recipe it was seeded from when handed a different recipe', () => {
        recipeSource.mockReturnValue(
            recipeQuery({ data: makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 }) }),
        );
        const mutation = updateMutation();
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result, rerender } = renderHook(() =>
            useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }),
        );

        act(() => result.current.setField('title', 'My Unsaved Edit'));
        recipeSource.mockReturnValue(
            recipeQuery({ data: makeRecipeDetail({ id: 'rec_2', title: 'Sunday Roast', currentVersion: 7 }) }),
        );
        rerender();
        act(() => result.current.submit());

        expect(result.current.values.title).toBe('My Unsaved Edit');
        expect(mutation.mutate.mock.calls[0]?.[0]).toMatchObject({ id: 'rec_1', input: { expectedVersion: 3 } });
    });

    it("reads the recipe's status from the SEED, not from another recipe it is handed", () => {
        recipeSource.mockReturnValue(
            recipeQuery({ data: makeRecipeDetail({ id: 'rec_1', currentVersion: 3, status: RecipeStatus.DRAFT }) }),
        );
        const mutation = updateMutation();
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result, rerender } = renderHook(() =>
            useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }),
        );

        recipeSource.mockReturnValue(
            recipeQuery({ data: makeRecipeDetail({ id: 'rec_2', currentVersion: 7, status: RecipeStatus.PUBLISHED }) }),
        );
        rerender();
        act(() => result.current.saveDraft());

        expect(mutation.mutate.mock.calls[0]?.[0]).toMatchObject({
            id: 'rec_1',
            input: { status: RecipeStatus.DRAFT },
        });
    });

    it('⛔ takes the status from a REFETCH of the same recipe — one published elsewhere is never saved back to draft', () => {
        recipeSource.mockReturnValue(
            recipeQuery({ data: makeRecipeDetail({ id: 'rec_1', currentVersion: 3, status: RecipeStatus.DRAFT }) }),
        );
        const mutation = updateMutation();
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result, rerender } = renderHook(() =>
            useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }),
        );

        recipeSource.mockReturnValue(
            recipeQuery({ data: makeRecipeDetail({ id: 'rec_1', currentVersion: 4, status: RecipeStatus.PUBLISHED }) }),
        );
        rerender();
        act(() => result.current.saveDraft());

        expect(mutation.mutate.mock.calls[0]?.[0]).toMatchObject({
            id: 'rec_1',
            input: { status: RecipeStatus.PUBLISHED },
        });
    });
});

describe('useRecipeEditor — validation blocks submit', () => {
    it('does not call mutate and records field errors for an invalid draft', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation();
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

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
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4 });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const onSaved = vi.fn();
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved, locale: 'en' }));

        act(() => result.current.submit());

        const [vars] = mutation.mutate.mock.calls[0] as [MutateVars];
        expect(vars.id).toBe('rec_1');
        expect(vars.input.expectedVersion).toBe(3);
        expect(result.current.state).toEqual({ status: 'saved' });
        expect(onSaved).toHaveBeenCalledWith(saved);
    });
});

/**
 * ⛔ THE LOST UPDATE. `expectedVersion` is the optimistic-concurrency token, and its whole job is to name the version
 * the cook's draft was BUILT ON. Sending the version the cache holds NOW is a different fact: a background refetch
 * after another writer's save moves the cache to their version, and a save carrying it is accepted by the server —
 * silently overwriting the other writer's change with a draft that never saw it, where §11.0 promises a 409.
 */
describe('useRecipeEditor — expectedVersion is the version the draft was seeded from', () => {
    it("sends the SEEDED version after a background refetch moved the cache to another writer's version", () => {
        recipeSource.mockReturnValue(recipeQuery({ data: makeRecipeDetail({ id: 'rec_1', currentVersion: 3 }) }));
        const mutation = updateMutation();
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result, rerender } = renderHook(() =>
            useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }),
        );

        act(() => result.current.setField('title', 'My Unsaved Edit'));
        recipeSource.mockReturnValue(recipeQuery({ data: makeRecipeDetail({ id: 'rec_1', currentVersion: 4 }) }));
        rerender();
        act(() => result.current.submit());

        const [vars] = mutation.mutate.mock.calls[0] as [MutateVars];
        expect(vars.input.expectedVersion).toBe(3);
    });

    it('the unattended autosave sends the SEEDED version too', () => {
        recipeSource.mockReturnValue(recipeQuery({ data: makeRecipeDetail({ id: 'rec_1', currentVersion: 3 }) }));
        const mutation = updateMutation();
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result, rerender } = renderHook(() =>
            useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }),
        );

        act(() => result.current.setField('title', 'My Unsaved Edit'));
        recipeSource.mockReturnValue(recipeQuery({ data: makeRecipeDetail({ id: 'rec_1', currentVersion: 4 }) }));
        rerender();
        act(() => result.current.autoSaveDraft());

        const [vars] = mutation.mutate.mock.calls[0] as [MutateVars];
        expect(vars.input.expectedVersion).toBe(3);
    });

    it('a successful save ADVANCES the base, so the next save names the version that save produced', () => {
        recipeSource.mockReturnValue(recipeQuery({ data: makeRecipeDetail({ id: 'rec_1', currentVersion: 3 }) }));
        const mutation = updateMutation([
            { type: 'success', recipe: makeRecipeDetail({ id: 'rec_1', currentVersion: 4 }) },
            { type: 'success', recipe: makeRecipeDetail({ id: 'rec_1', currentVersion: 5 }) },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());
        act(() => result.current.setField('title', 'A second edit'));
        act(() => result.current.submit());

        const [, second] = mutation.mutate.mock.calls as [[MutateVars], [MutateVars]];
        expect(second[0].input.expectedVersion).toBe(4);
    });
});

describe('useRecipeEditor — the "saved" latch resets on resumed editing', () => {
    // Regression: `saved` used to be a one-way latch (`setSaved(true)` on submit-success, never cleared), and
    // the state derivation read `saved ? 'saved' : ...` ABOVE `editing`. A consumer that does NOT unmount on
    // `onSaved` (e.g. a multi-step wizard) could resume editing after a save, hit a later conflict, resolve it,
    // and have the machine wrongly re-derive `'saved'` instead of `'editing'`.
    it('returns to "editing" when the user resumes editing via setField after a successful save', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', servings: 4, currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4 });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());
        expect(result.current.state).toEqual({ status: 'saved' });

        act(() => result.current.setField('servings', 6));

        expect(result.current.state).toEqual({ status: 'editing' });
    });

    it('returns to "editing" when the user resumes editing via setValues after a successful save', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4 });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());
        expect(result.current.state).toEqual({ status: 'saved' });

        act(() => result.current.setValues({ ...result.current.values, title: 'Sunday Roast' }));

        expect(result.current.state).toEqual({ status: 'editing' });
    });

    it('does not resurrect "saved" after a post-save conflict is resolved via keepServer (the exact trap: save -> resume editing -> 409 -> keepServer)', async () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        const saved = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 4 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
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
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

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
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
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
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());

        expect(result.current.state).toMatchObject({
            status: 'conflict',
            theirs: expect.objectContaining({ title: 'Server Title', currentVersion: 5 }),
            draft: expect.objectContaining({ title: 'My Draft' }),
        });
        // The handled-409 invariant: it must NEVER surface as the generic submit-error flag.
        expect(result.current.submitError).toBe(false);
    });

    it('carries the enriched server/base + precomputed diff + versionsBehind on the conflict state', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        const server = makeSide({
            versionNumber: 5,
            snapshot: makeSnapshot({ version: 5, title: 'Server Title', servings: 6 }),
        });
        const base = makeSide({ versionNumber: 3, snapshot: makeSnapshot({ version: 3 }) });
        const mutation = updateMutation([
            { type: 'conflict', error: new VersionConflictError(5, 3, undefined, { server, base }) },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

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
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        const server = makeSide({
            versionNumber: 25,
            snapshot: makeSnapshot({ version: 25, title: 'Server Title' }),
        });
        const mutation = updateMutation([
            { type: 'conflict', error: new VersionConflictError(25, 3, undefined, { server }) },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

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
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
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
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

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
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation([{ type: 'conflict', error: new Error('network down') }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

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
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation([
            { type: 'conflict', error: new VersionConflictError(undefined, 3, 'Recipe version conflict') },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());

        // No server snapshot to diff/display -> never enters `conflict`.
        expect(result.current.state).toEqual({ status: 'editing' });
        // The new, distinct feedback flag -> the user is NOT left staring at an unchanged form.
        expect(result.current.conflictDataUnavailable).toBe(true);
        // Still a handled VersionConflictError -> the generic submitError flag stays false (unchanged
        // semantics: submitError deliberately excludes EVERY VersionConflictError).
        expect(result.current.submitError).toBe(false);
    });

    // Regression guard: a normal, enriched 409 (the contract-guaranteed shape) must NOT trip the new flag.
    it('a normal enriched 409 (server present) leaves conflictDataUnavailable false and enters "conflict" as before', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
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
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());

        expect(result.current.state.status).toBe('conflict');
        expect(result.current.conflictDataUnavailable).toBe(false);
    });

    it('a resubmit via overwrite carries theirs.currentVersion as expectedVersion, not the stale version', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
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
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved, locale: 'en' }));

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
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
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
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());
        expect(result.current.state).toMatchObject({ status: 'conflict', server: firstServer });

        act(() => result.current.resolutions.overwrite());

        const [secondVars] = mutation.mutate.mock.calls[1] as [MutateVars];
        expect(secondVars.input.expectedVersion).toBe(5);
        expect(result.current.state).toMatchObject({ status: 'conflict', server: secondServer });
    });

    it('keepServer discards the draft and exits WITHOUT saving — the discard signal, distinct from "saved"', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
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
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());
        expect(result.current.state.status).toBe('conflict');

        act(() => result.current.resolutions.keepServer());

        // No resolve write — the server already holds the winning version.
        expect(mutation.mutate).toHaveBeenCalledTimes(1);
        expect(result.current.state).toEqual({ status: 'discarded' });
    });

    it('overwrite, keepServer, merge, and discardAndClose are all no-ops outside conflict state', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation();
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.resolutions.overwrite());
        act(() => result.current.resolutions.keepServer());
        act(() => result.current.resolutions.merge({}));
        act(() => result.current.discardAndClose());

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
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
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
        const { result, rerender } = renderHook(() =>
            useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }),
        );

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
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
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
        const { result, rerender } = renderHook(() =>
            useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }),
        );

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
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
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
        const { result, rerender } = renderHook(() =>
            useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }),
        );

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

    it('discardAndClose exits to "discarded" WHILE a resolve is hung in flight — the escape hatch stays available even though the option cards are disabled by isResolving', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
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
            // No outcome queued for the resolve itself — it hangs, exactly like the double-submit guard's own
            // in-flight tests above.
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result, rerender } = renderHook(() =>
            useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }),
        );

        act(() => result.current.submit());
        act(() => result.current.resolutions.overwrite());

        // The resolve is now in flight — mirror `isPending: true` exactly as the other in-flight tests do.
        useUpdateRecipeMock.mockReturnValue({ ...mutation, isPending: true });
        rerender();
        expect(result.current.state).toMatchObject({ status: 'conflict', isResolving: true });

        // `discardAndClose` is NOT gated on `isPending` — unlike `resolutions.keepServer` (covered above),
        // which declines here.
        act(() => result.current.discardAndClose());

        expect(result.current.state).toEqual({ status: 'discarded' });
    });

    it('the hung-request escape hatch (regression): a late onSuccess for the discarded resolve does NOT resurrect "saved" after discardAndClose already exited', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
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
            // The resolve's own outcome is deliberately NOT queued — `mutate` is called but never settles
            // synchronously, mirroring a real PATCH still awaiting its response. This test settles it MANUALLY,
            // late, via the captured `onSuccess` callback, AFTER `discardAndClose` has already fired.
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const onSaved = vi.fn();
        const { result, rerender } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved, locale: 'en' }));

        act(() => result.current.submit());
        act(() => result.current.resolutions.overwrite());

        useUpdateRecipeMock.mockReturnValue({ ...mutation, isPending: true });
        rerender();

        // The user bails via the escape hatch WHILE the overwrite is still hung.
        act(() => result.current.discardAndClose());
        expect(result.current.state).toEqual({ status: 'discarded' });

        // The hung request FINALLY settles — successfully — well after the user already left. Invoke the
        // SAME `onSuccess` callback `useUpdateRecipe.mutate` was given for that (second) call.
        const [, resolveOptions] = mutation.mutate.mock.calls[1] as [MutateVars, MutateOptions];
        const savedRecipe = makeRecipeDetail({ id: 'rec_1', currentVersion: 6 });
        act(() => resolveOptions.onSuccess?.(savedRecipe));

        // Neutralized: the machine stays on the discarded terminal the user actually saw, never flips to a
        // bogus "Saved!" the user never asked for and cannot see (they already navigated away) — exactly the
        // hung-request trap the escape hatch exists to prevent.
        expect(result.current.state).toEqual({ status: 'discarded' });
        expect(onSaved).not.toHaveBeenCalled();
    });

    it('exposes isResolving on the conflict state, true only while a resolve mutation is in flight', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
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
        const { result, rerender } = renderHook(() =>
            useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }),
        );

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
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
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
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved, locale: 'en' }));

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
            ingredients: [
                makeIngredientView({
                    ingredientId: '00000000-0000-4000-8000-000000000001',
                    name: 'Olive oil',
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'tbsp',
                }),
            ],
        });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
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
                        ingredientId: '00000000-0000-4000-8000-000000000001',
                        ingredientName: 'Olive oil',
                        quantity: { kind: 'exact', value: 2 },
                        unit: 'tbsp',
                        sortOrder: 0,
                    }),
                    makeIngredient({
                        id: 'ri_2',
                        ingredientId: '00000000-0000-4000-8000-000000000002',
                        ingredientName: 'Butter',
                        quantity: { kind: 'exact', value: 1 },
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
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved, locale: 'en' }));

        act(() => result.current.submit());
        act(() =>
            result.current.resolutions.merge({
                'steps[1]': 'theirs',
                'ingredients:00000000-0000-4000-8000-000000000002': 'theirs',
            }),
        );

        expect(mutation.mutate).toHaveBeenCalledTimes(2);
        const [secondVars] = mutation.mutate.mock.calls[1] as [{ id: string; input: Record<string, unknown> }];
        expect((secondVars.input as { expectedVersion: number }).expectedVersion).toBe(5);
        const steps = secondVars.input['steps'] as ReadonlyArray<{ instruction: string }>;
        expect(steps.map((step) => step.instruction)).toEqual(['Mine step one', 'Their step two']);
        const ingredients = secondVars.input['ingredients'] as ReadonlyArray<{ ingredientId: string }>;
        expect(ingredients.map((ingredient) => ingredient.ingredientId).sort()).toEqual([
            '00000000-0000-4000-8000-000000000001',
            '00000000-0000-4000-8000-000000000002',
        ]);
        expect(onSaved).toHaveBeenCalledWith(saved);
    });

    it('setMergeSelections updates conflict.mergeSelections; a no-op outside conflict', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        // Outside conflict: a no-op, state stays 'editing'.
        act(() => result.current.resolutions.setMergeSelections({ title: 'theirs' }));
        expect(result.current.state).toEqual({ status: 'editing' });
    });
});

describe('useRecipeEditor — setField patches a single field', () => {
    it('patches only the given field, leaving the rest of the draft untouched', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', servings: 4, currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.setField('servings', 6));

        expect(result.current.values.servings).toBe(6);
        expect(result.current.values.title).toBe('Weeknight Pasta');
    });
});

// --- w3: wizard step state, step-scoped validation, draft/publish -------------------------------------

describe('useRecipeEditor — wizard step state (w3, orthogonal to EditorState)', () => {
    it('defaults to step 1', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        expect(result.current.step).toBe(1);
        // Orthogonal: the step dimension never appears on `state`.
        expect(result.current.state).toEqual({ status: 'editing' });
    });

    it('goToStep jumps directly to any step (no gating — the free step-rail navigation)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.goToStep(3));
        expect(result.current.step).toBe(3);
        act(() => result.current.goToStep(1));
        expect(result.current.step).toBe(1);
    });

    it('goNext advances one step when the current step is valid', () => {
        // The default fixture seeds a fully valid recipe, so step 1 is valid.
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.goNext());
        expect(result.current.step).toBe(2);
    });

    it('goNext is BLOCKED when the current step is invalid (an empty title)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.setField('title', ''));
        act(() => result.current.goNext());

        expect(result.current.step).toBe(1);
    });

    it('goPrev decrements, floored at step 1', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.goToStep(2));
        act(() => result.current.goPrev());
        expect(result.current.step).toBe(1);

        act(() => result.current.goPrev());
        expect(result.current.step).toBe(1);
    });

    it('goNext does not advance past step 4 (ceiling)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.goToStep(4));
        act(() => result.current.goNext());
        expect(result.current.step).toBe(4);
    });
});

describe('useRecipeEditor — canAdvanceFrom / stepErrors (w3, filters the ONE validator by field->step map)', () => {
    it('canAdvanceFrom(1) is false when title is blank, true once filled', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.setField('title', ''));
        expect(result.current.canAdvanceFrom(1)).toBe(false);

        act(() => result.current.setField('title', 'Weeknight Pasta'));
        expect(result.current.canAdvanceFrom(1)).toBe(true);
    });

    it('stepErrors(2) reflects only the ingredients error, never title (even when title is also blank)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.setValues({ ...result.current.values, title: '', ingredients: [] }));

        expect(result.current.stepErrors(2)).toEqual({ ingredients: 'ingredientsEmpty' });
        expect(result.current.canAdvanceFrom(2)).toBe(false);
    });

    it('stepErrors(4) (photos) is always empty — decoupled from form validation', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.setValues({ ...result.current.values, title: '', ingredients: [], steps: [] }));

        expect(result.current.stepErrors(4)).toEqual({});
        expect(result.current.canAdvanceFrom(4)).toBe(true);
    });
});

describe('useRecipeEditor — publish (w3: whole-form validate, then submit with status "published")', () => {
    it('validates the WHOLE form (not just the current step) and blocks with field errors when invalid', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation();
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.setValues({ ...result.current.values, ingredients: [] }));
        act(() => result.current.publish());

        expect(mutation.mutate).not.toHaveBeenCalled();
        expect(result.current.errors.ingredients).toBe('ingredientsEmpty');
    });

    it('submits with status: "published" when the whole form is valid', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4 });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const onSaved = vi.fn();
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved, locale: 'en' }));

        act(() => result.current.publish());

        const [vars] = mutation.mutate.mock.calls[0] as [{ id: string; input: Record<string, unknown> }];
        expect(vars.input['status']).toBe('published');
        expect(result.current.state).toEqual({ status: 'saved' });
        expect(onSaved).toHaveBeenCalledWith(saved);
    });
});

/**
 * A resubmit the hook makes on the cook's behalf — the phantom 409 fast-path, and the overwrite/merge resolutions — must
 * carry the intent of the submission that met the 409. Dropping it had two effects: an unattended save that met a phantom
 * 409 called `onSaved` (both containers navigate on it, closing the editor under a cook who was typing), and Publish →
 * 409 → Overwrite reported "saved" while the recipe stayed a draft.
 */
describe('useRecipeEditor — a resubmit keeps the intent of the submission that met the 409', () => {
    type Vars = { readonly id: string; readonly input: Record<string, unknown> };

    /** A 409 whose server side changed the title — a real conflict, not a phantom. */
    const realConflict = (): VersionConflictError =>
        new VersionConflictError(6, 3, undefined, {
            server: makeSide({ versionNumber: 6, snapshot: makeSnapshot({ version: 6, title: 'Server Title' }) }),
            base: makeSide({ versionNumber: 3 }),
        });

    /** A 409 whose server side matches the draft — the phantom fast-path. */
    const phantomConflict = (): VersionConflictError =>
        new VersionConflictError(6, 3, undefined, {
            server: makeSide({ versionNumber: 6 }),
            base: makeSide({ versionNumber: 3 }),
        });

    it('a phantom 409 on the UNATTENDED save resubmits silently — it never calls onSaved', () => {
        recipeSource.mockReturnValue(
            recipeQuery({ data: makeRecipeDetail({ id: 'rec_1', currentVersion: 3, status: RecipeStatus.DRAFT }) }),
        );
        const mutation = updateMutation([
            { type: 'conflict', error: phantomConflict() },
            { type: 'success', recipe: makeRecipeDetail({ id: 'rec_1', currentVersion: 7 }) },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const onSaved = vi.fn();
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved, locale: 'en' }));

        act(() => result.current.autoSaveDraft());

        expect(mutation.mutate).toHaveBeenCalledTimes(2);
        const [, [resubmit]] = mutation.mutate.mock.calls as [[Vars], [Vars]];
        expect(resubmit.input['status']).toBe(RecipeStatus.DRAFT);
        expect(resubmit.input['expectedVersion']).toBe(6);
        expect(onSaved).not.toHaveBeenCalled();
    });

    it('a phantom 409 on Publish resubmits as a publish', () => {
        recipeSource.mockReturnValue(recipeQuery({ data: makeRecipeDetail({ id: 'rec_1', currentVersion: 3 }) }));
        const mutation = updateMutation([
            { type: 'conflict', error: phantomConflict() },
            { type: 'success', recipe: makeRecipeDetail({ id: 'rec_1', currentVersion: 7 }) },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.publish());

        const [, [resubmit]] = mutation.mutate.mock.calls as [[Vars], [Vars]];
        expect(resubmit.input['status']).toBe(RecipeStatus.PUBLISHED);
    });

    it.each([
        ['overwrite', (editor: ReturnType<typeof useRecipeEditor>) => editor.resolutions.overwrite()],
        ['merge', (editor: ReturnType<typeof useRecipeEditor>) => editor.resolutions.merge({})],
    ] as const)('Publish → 409 → %s still publishes, and still reports the save', (_name, resolve) => {
        recipeSource.mockReturnValue(recipeQuery({ data: makeRecipeDetail({ id: 'rec_1', currentVersion: 3 }) }));
        const mutation = updateMutation([
            { type: 'conflict', error: realConflict() },
            { type: 'success', recipe: makeRecipeDetail({ id: 'rec_1', currentVersion: 7 }) },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const onSaved = vi.fn();
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved, locale: 'en' }));

        act(() => result.current.publish());
        expect(result.current.state.status).toBe('conflict');
        act(() => resolve(result.current));

        const [, [resubmit]] = mutation.mutate.mock.calls as [[Vars], [Vars]];
        expect(resubmit.input['status']).toBe(RecipeStatus.PUBLISHED);
        // A resolution is the cook's own deliberate action, so it reports the save even when the 409 met a timer.
        expect(onSaved).toHaveBeenCalledTimes(1);
    });

    it('a resolution of a 409 an UNATTENDED save met reports the save — the cook chose it', () => {
        recipeSource.mockReturnValue(
            recipeQuery({ data: makeRecipeDetail({ id: 'rec_1', currentVersion: 3, status: RecipeStatus.DRAFT }) }),
        );
        const mutation = updateMutation([
            { type: 'conflict', error: realConflict() },
            { type: 'success', recipe: makeRecipeDetail({ id: 'rec_1', currentVersion: 7 }) },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const onSaved = vi.fn();
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved, locale: 'en' }));

        act(() => result.current.autoSaveDraft());
        act(() => result.current.resolutions.overwrite());

        const [, [resubmit]] = mutation.mutate.mock.calls as [[Vars], [Vars]];
        expect(resubmit.input['status']).toBe(RecipeStatus.DRAFT);
        expect(onSaved).toHaveBeenCalledTimes(1);
    });
});

describe('useRecipeEditor — saveDraft (w3: relaxed floor — title only, ingredients/steps may be empty)', () => {
    it('blocks when the draft floor fails (a blank title, which the wire schema itself would reject)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3, status: RecipeStatus.DRAFT });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        const mutation = updateMutation();
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.setField('title', ''));
        act(() => result.current.saveDraft());

        expect(mutation.mutate).not.toHaveBeenCalled();
        expect(result.current.errors.title).toBe('titleRequired');
    });

    it('when editing a recipe seeded as "draft", submits status: "draft" even when ingredients/steps are empty (the relaxed floor)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3, status: RecipeStatus.DRAFT });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4, status: RecipeStatus.DRAFT });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const onSaved = vi.fn();
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved, locale: 'en' }));

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
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4, status: RecipeStatus.PUBLISHED });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const onSaved = vi.fn();
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved, locale: 'en' }));

        act(() => result.current.saveDraft());

        const [vars] = mutation.mutate.mock.calls[0] as [{ id: string; input: Record<string, unknown> }];
        // The recipe stays published — this is the crux of the regression: never 'draft' here.
        expect(vars.input['status']).toBe('published');
        expect(vars.input['status']).not.toBe('draft');
        expect(onSaved).toHaveBeenCalledWith(saved);
    });

    it('does not carry a status onto the plain submit() path (never a side-effecting publication flip)', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', currentVersion: 3, status: RecipeStatus.PUBLISHED });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4 });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());

        const [vars] = mutation.mutate.mock.calls[0] as [{ id: string; input: Record<string, unknown> }];
        expect('status' in vars.input).toBe(false);
    });
});

describe('useRecipeEditor — the four invariants re-proven WITH the step dimension (w3)', () => {
    it('seed-once no-clobber: a background refetch after a step change does not clobber in-progress edits', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        useUpdateRecipeMock.mockReturnValue(updateMutation());
        const { result, rerender } = renderHook(() =>
            useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }),
        );

        act(() => result.current.setValues({ ...result.current.values, title: 'My Unsaved Edit' }));
        act(() => result.current.goToStep(2));

        const backgroundRefetch = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: backgroundRefetch }));
        rerender();

        expect(result.current.values.title).toBe('My Unsaved Edit');
        // The step change itself must not have been reverted by the background refetch either.
        expect(result.current.step).toBe(2);
    });

    it('a 409 from a non-1 step still enters "conflict" (never submitError), and does not reset the step', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'My Draft', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
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
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

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
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
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
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.goToStep(2));
        act(() => result.current.submit());
        act(() => result.current.goToStep(4));
        act(() => result.current.resolutions.overwrite());

        const [secondVars] = mutation.mutate.mock.calls[1] as [MutateVars];
        expect(secondVars.input.expectedVersion).toBe(5);
    });

    it('a step change does NOT trip the "saved" latch and does NOT reseed', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4 });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());
        expect(result.current.state).toEqual({ status: 'saved' });

        act(() => result.current.goToStep(2));

        // Navigating steps is not an edit — the saved latch and the seeded draft both survive.
        expect(result.current.state).toEqual({ status: 'saved' });
        expect(result.current.values.title).toBe('Weeknight Pasta');
    });

    it('the "saved" latch still resets on a post-save edit even after navigating steps in between', () => {
        const loaded = makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', servings: 4, currentVersion: 3 });
        recipeSource.mockReturnValue(recipeQuery({ data: loaded }));
        const saved = makeRecipeDetail({ id: 'rec_1', currentVersion: 4 });
        const mutation = updateMutation([{ type: 'success', recipe: saved }]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result } = renderHook(() => useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }));

        act(() => result.current.submit());
        expect(result.current.state).toEqual({ status: 'saved' });

        act(() => result.current.goToStep(2));
        act(() => result.current.setField('servings', 6));

        expect(result.current.state).toEqual({ status: 'editing' });
    });
});

/**
 * AUTO-SAVE WIRED TO THE REAL EDITOR (U34) — the tier the hook's own unit tests structurally cannot reach.
 *
 * ⛔ `useRecipeAutoSave.test.tsx` proves the TIMER: when it fires, when it does not, that it calls
 * `saveDraft`. It mocks `saveDraft`, so it can say nothing at all about the thing that actually matters —
 * what goes on the wire. These cases drive the composition instead: the real `useRecipeEditor`, the real
 * `useDiscardGuard`, and the auto-save hook between them, against the same scripted mutation double every
 * other case here uses.
 *
 * The three claims, and why each is here rather than there:
 *
 *  1. **The unattended write carries `expectedVersion`.** This is THE lost-update guard. A background write
 *     with no optimistic-concurrency token silently clobbers a change made on another device, and nothing in
 *     the timer's own tests could observe the request body.
 *  2. **A 409 from an unattended write SURFACES.** It must land in the same `conflict` state a manual save's
 *     409 does — a cook who was not looking still has to be told, and the later write must not win by
 *     default.
 *  3. **It writes `status: 'draft'`.** An unattended write that published a private work-in-progress would
 *     be a disclosure, not a save.
 */
describe('auto-save, wired to the real editor (U34)', () => {
    /** The editor plus auto-save, composed exactly as a container composes them. */
    const renderAutoSaving = (mutation: ReturnType<typeof updateMutation>, onSaved = vi.fn()) => {
        useUpdateRecipeMock.mockReturnValue(mutation);

        const rendered = renderHook(() => {
            const editor = useRecipeEditor(currentRecipe(), { onSaved, locale: 'en' });
            const isDirty = useDiscardGuard(editor.values, { justSaved: editor.state.status === 'saved' });

            useRecipeAutoSave({
                isDirty,
                // The container's own race gate — see `useRecipeAutoSave`'s doc for the three cases.
                enabled: editor.state.status === 'editing',
                // ⛔ `autoSaveDraft`, exactly as both containers wire it. Using `saveDraft` here would make
                // this suite pass while production navigated the cook out of the editor.
                saveDraft: editor.autoSaveDraft,
            });

            return editor;
        });

        return { ...rendered, onSaved };
    };

    /** Let the seed effect and the discard guard's baseline settle before the draft is touched. */
    const settleBaseline = (rerender: () => void): void => {
        act(() => {
            rerender();
        });
        act(() => {
            rerender();
        });
    };

    it('carries `expectedVersion` on the unattended write — the lost-update guard', () => {
        vi.useFakeTimers();

        const mutation = updateMutation([{ type: 'success', recipe: makeRecipeDetail({ id: 'rec_1' }) }]);
        const { result, rerender } = renderAutoSaving(mutation);

        settleBaseline(rerender);
        act(() => {
            result.current.setValues({ ...result.current.values, title: 'Edited while unattended' });
        });
        act(() => {
            vi.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS);
        });

        expect(mutation.mutate).toHaveBeenCalledTimes(1);

        const vars = mutation.mutate.mock.calls[0]?.[0] as { input: { expectedVersion?: number } };

        // The loaded recipe's own `currentVersion` (3, from `recipeQuery`'s default) — not absent, not zero.
        expect(vars.input.expectedVersion).toBe(3);

        vi.useRealTimers();
    });

    it('SURFACES a 409 from an unattended write as a conflict, never letting the later write win', () => {
        vi.useFakeTimers();

        const server = makeSide({
            versionNumber: 9,
            snapshot: makeSnapshot({ version: 9, title: 'Changed on another device' }),
        });
        const mutation = updateMutation([
            { type: 'conflict', error: new VersionConflictError(9, 3, undefined, { server }) },
        ]);
        const { result, rerender } = renderAutoSaving(mutation);

        settleBaseline(rerender);
        act(() => {
            result.current.setValues({ ...result.current.values, title: 'Edited while unattended' });
        });
        act(() => {
            vi.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS);
        });

        expect(result.current.state.status).toBe('conflict');

        vi.useRealTimers();
    });

    // ⛔ REWRITTEN mid-implementation, because the first version of this case asserted the WRONG guarantee.
    // It expected `status: 'draft'` unconditionally and failed against an already-published recipe — which
    // is `saveDraft` behaving CORRECTLY: it re-asserts `published` for a live recipe, because "Save Draft
    // must never downgrade an already-published recipe" (`useRecipeEditor`'s own ruling). The guarantee auto-
    // save actually owes is stronger and simpler: an unattended write NEVER CHANGES publication state, in
    // either direction. Asserted in both directions below, which the original could not have been.
    it('never changes publication state: a draft stays a draft', () => {
        vi.useFakeTimers();

        recipeSource.mockReturnValue(
            recipeQuery({
                data: makeRecipeDetail({ id: 'rec_1', currentVersion: 3, status: RecipeStatus.DRAFT }),
            }),
        );

        const mutation = updateMutation([{ type: 'success', recipe: makeRecipeDetail({ id: 'rec_1' }) }]);
        const { result, rerender } = renderAutoSaving(mutation);

        settleBaseline(rerender);
        act(() => {
            result.current.setValues({ ...result.current.values, title: 'Edited while unattended' });
        });
        act(() => {
            vi.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS);
        });

        const vars = mutation.mutate.mock.calls[0]?.[0] as { input: { status?: string } };

        expect(vars.input.status).toBe(RecipeStatus.DRAFT);

        vi.useRealTimers();
    });

    it('never changes publication state: a PUBLISHED recipe is not quietly unpublished', () => {
        // The direction that would actually hurt: an unattended write pulling a live recipe out of public
        // listings while its author edits a typo.
        vi.useFakeTimers();

        // Stated explicitly rather than relying on the fixture default — the sibling case above points the
        // shared `useRecipe` double at a DRAFT, and a leaked mock would make this assertion pass for the
        // wrong reason (it did, until this line was added).
        recipeSource.mockReturnValue(
            recipeQuery({
                data: makeRecipeDetail({ id: 'rec_1', currentVersion: 3, status: RecipeStatus.PUBLISHED }),
            }),
        );

        const mutation = updateMutation([{ type: 'success', recipe: makeRecipeDetail({ id: 'rec_1' }) }]);
        const { result, rerender } = renderAutoSaving(mutation);

        settleBaseline(rerender);
        act(() => {
            result.current.setValues({ ...result.current.values, title: 'Edited while unattended' });
        });
        act(() => {
            vi.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS);
        });

        const vars = mutation.mutate.mock.calls[0]?.[0] as { input: { status?: string } };

        expect(vars.input.status).toBe(RecipeStatus.PUBLISHED);

        vi.useRealTimers();
    });

    it('does not navigate: the composed timer never fires the container’s onSaved', () => {
        // ⛔ The end-to-end form of the worst defect this unit had. Assert it through the COMPOSITION, not
        // just against `autoSaveDraft` directly, because the wiring is where it went wrong — the hook was
        // handed `saveDraft` and inherited its navigation.
        vi.useFakeTimers();

        const mutation = updateMutation([{ type: 'success', recipe: makeRecipeDetail({ id: 'rec_1' }) }]);
        const { result, rerender, onSaved } = renderAutoSaving(mutation);

        settleBaseline(rerender);
        act(() => {
            result.current.setValues({ ...result.current.values, title: 'Edited while unattended' });
        });
        act(() => {
            vi.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS);
        });

        expect(mutation.mutate).toHaveBeenCalledTimes(1);
        expect(onSaved).not.toHaveBeenCalled();

        vi.useRealTimers();
    });

    it('does NOT write while the draft is untouched, however long the editor sits open', () => {
        vi.useFakeTimers();

        const mutation = updateMutation([{ type: 'success', recipe: makeRecipeDetail({ id: 'rec_1' }) }]);
        const { rerender } = renderAutoSaving(mutation);

        settleBaseline(rerender);
        act(() => {
            vi.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS * 10);
        });

        expect(mutation.mutate).not.toHaveBeenCalled();

        vi.useRealTimers();
    });

    /**
     * ⛔⛔ THE HEADLINE — the ruling, through the composition that actually ships (owner, 2026-08-26;
     * defect measured 2026-09-03).
     *
     * `AUTO_SAVE_INTERVAL_MS`'s own docblock says it plainly: *"The timer is armed when the draft becomes
     * dirty and fires at that deadline whatever the cook types in between, so a cook editing continuously
     * IS protected."* The wired behaviour was the exact opposite — a DEBOUNCE from the last keystroke —
     * and no test could see it, because `useRecipeAutoSave.test.tsx` hands the hook a `vi.fn()` whose
     * identity never moves. In production the editor handed it `autoSaveDraft`, whose `useCallback` deps
     * included `values`: every keystroke minted a new function, changed the effect's deps, cleared the
     * armed timer and started the window over. Measured with a probe: after the original deadline elapsed,
     * ZERO writes.
     *
     * That inverts which cook is protected. A debounce protects the one who STOPS typing; the ruling chose
     * five minutes precisely to protect the one who does not — the cook with an hour of unsaved work who
     * never pauses long enough to trigger it.
     *
     * Types right through the deadline, then asserts BOTH halves: the write landed on the original
     * deadline (count and cadence), and it carried what the cook had typed AS OF THE TICK — a fixed
     * cadence that wrote the mount-time draft would be the mirror failure, silently persisting stale
     * content over newer edits.
     */
    it('writes on the deadline while the cook keeps typing, carrying the draft as of the tick', () => {
        vi.useFakeTimers();

        const mutation = updateMutation([{ type: 'success', recipe: makeRecipeDetail({ id: 'rec_1' }) }]);
        const { result, rerender } = renderAutoSaving(mutation);

        settleBaseline(rerender);

        // Ten edits spread evenly across ONE window — a cook who never stops. The last lands at 9/10 of the
        // window, so a debounce of the same length would not fire until 1.9 windows in.
        for (let keystroke = 1; keystroke <= 10; keystroke += 1) {
            act(() => {
                result.current.setValues({ ...result.current.values, title: `Typing ${keystroke}` });
            });
            act(() => {
                vi.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS / 10);
            });
        }

        expect(mutation.mutate).toHaveBeenCalledTimes(1);

        const vars = mutation.mutate.mock.calls[0]?.[0] as { input: { title?: string } };

        expect(vars.input.title).toBe('Typing 10');

        vi.useRealTimers();
    });

    /**
     * The other edge of the same cadence: once a tick has WRITTEN, an unchanged draft must never be
     * written again. Every auto-save mints a version row (FR-007b) and only the last ten survive, so a
     * no-op write costs a cook one of their own deliberate versions plus an `expectedVersion` round-trip,
     * for nothing.
     *
     * ⚠️ The gate is `isDirty` — the discard guard's baseline, which the editor's `saved` terminal moves
     * forward — NOT a second "did anything change" check inside the timer. This case is what stops a
     * repeating interval from becoming a repeating no-op.
     */
    it('writes ONCE and then stops, when the cook stops editing after an auto-save lands', () => {
        vi.useFakeTimers();

        const mutation = updateMutation([{ type: 'success', recipe: makeRecipeDetail({ id: 'rec_1' }) }]);
        const { result, rerender } = renderAutoSaving(mutation);

        settleBaseline(rerender);
        act(() => {
            result.current.setValues({ ...result.current.values, title: 'Edited once, then left alone' });
        });
        act(() => {
            vi.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS);
        });

        expect(mutation.mutate).toHaveBeenCalledTimes(1);

        act(() => {
            vi.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS * 10);
        });

        expect(mutation.mutate).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
    });

    /**
     * A tick that fires while the PREVIOUS write is still in flight would issue a second PATCH carrying
     * the SAME `expectedVersion` — one of the two must lose, and the loser lands in a conflict view over
     * content the cook never edited twice.
     *
     * The gate is the container's `enabled`, which both containers derive from
     * `editor.state.status === 'editing'`: an in-flight mutation puts the machine in `'submitting'`, which
     * tears the interval down. The scripted double below never settles and — unlike TanStack — does not
     * re-render on its own, so the explicit `rerender` stands in for the render TanStack's own `isPending`
     * transition would cause.
     */
    it('issues no second write while the first is still in flight', () => {
        vi.useFakeTimers();

        let pending = false;
        const mutation = {
            mutate: vi.fn(() => {
                pending = true;
            }),
            get isPending(): boolean {
                return pending;
            },
            isError: false,
            error: undefined,
        };
        const { result, rerender } = renderAutoSaving(mutation as unknown as ReturnType<typeof updateMutation>);

        settleBaseline(rerender);
        act(() => {
            result.current.setValues({ ...result.current.values, title: 'Edited while unattended' });
        });
        act(() => {
            vi.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS);
        });

        expect(mutation.mutate).toHaveBeenCalledTimes(1);

        act(() => {
            rerender();
        });
        expect(result.current.state.status).toBe('submitting');

        act(() => {
            vi.advanceTimersByTime(AUTO_SAVE_INTERVAL_MS * 5);
        });

        expect(mutation.mutate).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
    });
});

/**
 * ⛔ WHAT AN UNATTENDED SAVE MUST **NOT** DO — the three ways delegating to `saveDraft` went wrong.
 *
 * `useRecipeAutoSave` issues no write of its own; it calls the editor. That is what makes the write carry
 * `expectedVersion` (see the suite above). But `saveDraft` is ONE command bundling three concerns —
 * validate-and-record-errors, persist, and notify-the-container — and an unattended caller wants only the
 * middle one. Inheriting the other two produced three defects, each of which a cook meets within seconds:
 *
 *  1. **It navigated them out of the editor.** `submitDraft`'s `onSuccess` calls `opts.onSaved`, which both
 *     containers wire to "go to the detail page". Type, pause two seconds, and the editor closes underneath
 *     you mid-edit.
 *  2. **It painted validation errors nobody asked for.** `validateThenSubmit` calls `setErrors` BEFORE its
 *     gate, so clearing a title to retype it put "A title is required." under the field on a timer.
 *  3. **It re-armed forever.** That `setErrors` stored a fresh object every time, so the render it caused
 *     re-armed the (then two-second) timer, which fired, which re-rendered — a permanent loop on any draft
 *     failing the floor.
 *
 * The fix is a separate `autoSaveDraft` command that persists and nothing else. It still sets the `saved`
 * terminal, deliberately: the discard guard's baseline has to move forward, or auto-save would keep writing
 * the same content forever.
 */
describe('autoSaveDraft — the unattended command, and what it deliberately does not do (U34)', () => {
    const renderEditor = (mutation: ReturnType<typeof updateMutation>, onSaved = vi.fn()) => {
        useUpdateRecipeMock.mockReturnValue(mutation);

        return { onSaved, ...renderHook(() => useRecipeEditor(currentRecipe(), { onSaved, locale: 'en' })) };
    };

    it('does NOT call onSaved — the cook is not navigated out of the editor mid-edit', () => {
        // ⛔ THE defect. Both containers wire `onSaved` to a navigation, so calling it from a background
        // timer closes the editor two seconds after the cook stops typing.
        const mutation = updateMutation([{ type: 'success', recipe: makeRecipeDetail({ id: 'rec_1' }) }]);
        const { result, onSaved } = renderEditor(mutation);

        act(() => {
            result.current.setValues({ ...result.current.values, title: 'Edited while unattended' });
        });
        act(() => {
            result.current.autoSaveDraft();
        });

        expect(mutation.mutate).toHaveBeenCalledTimes(1);
        expect(onSaved).not.toHaveBeenCalled();
    });

    it('still calls onSaved for an EXPLICIT Save Draft, so the button is unaffected', () => {
        // The other half: suppressing navigation must not suppress it for the control the cook pressed.
        const mutation = updateMutation([{ type: 'success', recipe: makeRecipeDetail({ id: 'rec_1' }) }]);
        const { result, onSaved } = renderEditor(mutation);

        act(() => {
            result.current.setValues({ ...result.current.values, title: 'Edited deliberately' });
        });
        act(() => {
            result.current.saveDraft();
        });

        expect(onSaved).toHaveBeenCalledTimes(1);
    });

    it('does NOT paint validation errors on a draft the cook is still typing', () => {
        // Clearing a title to retype it must not be answered by a timer shouting about it.
        const mutation = updateMutation([]);
        const { result } = renderEditor(mutation);

        act(() => {
            result.current.setValues({ ...result.current.values, title: '' });
        });
        act(() => {
            result.current.autoSaveDraft();
        });

        expect(result.current.errors).toEqual({});
    });

    it('issues NO write at all when the draft fails the step-1 floor', () => {
        const mutation = updateMutation([]);
        const { result } = renderEditor(mutation);

        act(() => {
            result.current.setValues({ ...result.current.values, title: '' });
        });
        act(() => {
            result.current.autoSaveDraft();
        });

        expect(mutation.mutate).not.toHaveBeenCalled();
    });

    it('DOES move the saved terminal, so the discard baseline advances and it stops re-writing', () => {
        // Deliberately NOT suppressed: without it `isDirty` stays true against the pre-save baseline and the
        // hook would write the same content on every tick, forever.
        const mutation = updateMutation([{ type: 'success', recipe: makeRecipeDetail({ id: 'rec_1' }) }]);
        const { result } = renderEditor(mutation);

        act(() => {
            result.current.setValues({ ...result.current.values, title: 'Edited while unattended' });
        });
        act(() => {
            result.current.autoSaveDraft();
        });

        expect(result.current.state.status).toBe('saved');
    });

    /**
     * ⚠️ REWRITTEN 2026-09-03 to prove the NEW behaviour, and the case it replaces is the hole the defect
     * lived in. That case rerendered WITHOUT touching the draft, so it only ever exercised the half that
     * already worked: `autoSaveDraft`'s `useCallback` deps were `[values, query.data]`, and a bare
     * `rerender()` changes neither. An EDIT changes `values`, mints a new function, changes
     * `useRecipeAutoSave`'s effect deps, and re-arms the timer — turning the ruled five-minute INTERVAL
     * into a debounce from the last keystroke, so a cook typing continuously was never written at all.
     *
     * Stability across an edit is therefore the load-bearing half, and it is asserted first-class here.
     * (`AUTO_SAVE_INTERVAL_MS`'s original 2-second value is gone; the poller-starvation reasoning the old
     * comment gave still holds at five minutes, and is the same reason.)
     */
    it('keeps a STABLE identity across re-renders AND across edits, or the interval is re-armed forever', () => {
        const mutation = updateMutation([]);
        const { result, rerender } = renderEditor(mutation);
        const first = result.current.autoSaveDraft;

        rerender();
        expect(result.current.autoSaveDraft).toBe(first);

        act(() => {
            result.current.setField('title', 'Typed one character');
        });

        expect(result.current.autoSaveDraft).toBe(first);
    });

    /**
     * REWRITTEN (was "writes the newly seeded recipe after a navigation"). A navigation remounts the editor — both
     * containers key it on the recipe id — so a tick armed under one recipe only ever writes that recipe: its content,
     * its `expectedVersion`, its id, its publication status, even if the mounted editor is handed another recipe.
     */
    it('a tick writes the recipe the draft was seeded from, never another recipe the editor is handed', () => {
        recipeSource.mockReturnValue(
            recipeQuery({
                data: makeRecipeDetail({
                    id: 'rec_1',
                    title: 'Weeknight Pasta',
                    currentVersion: 3,
                    status: RecipeStatus.DRAFT,
                }),
            }),
        );
        const mutation = updateMutation([
            { type: 'success', recipe: makeRecipeDetail({ id: 'rec_1', title: 'Weeknight Pasta', currentVersion: 4 }) },
        ]);
        useUpdateRecipeMock.mockReturnValue(mutation);
        const { result, rerender } = renderHook(() =>
            useRecipeEditor(currentRecipe(), { onSaved: vi.fn(), locale: 'en' }),
        );

        recipeSource.mockReturnValue(
            recipeQuery({
                data: makeRecipeDetail({
                    id: 'rec_2',
                    title: 'Sunday Roast',
                    currentVersion: 7,
                    status: RecipeStatus.PUBLISHED,
                }),
            }),
        );
        rerender();
        act(() => {
            result.current.autoSaveDraft();
        });

        expect(mutation.mutate).toHaveBeenCalledTimes(1);
        expect(mutation.mutate.mock.calls[0]?.[0]).toMatchObject({
            id: 'rec_1',
            input: { expectedVersion: 3, title: 'Weeknight Pasta', status: RecipeStatus.DRAFT },
        });
        expect(result.current.state).toEqual({ status: 'saved' });

        act(() => result.current.setValues({ ...result.current.values, title: 'Sunday Roast' }));

        expect(result.current.state).toEqual({ status: 'editing' });
    });
});

/**
 * `autoSaveDraftRef` — the implementation `autoSaveDraft` forwards to, and the ONE thing about it that has
 * to be right: it must carry the implementation from the render that COMMITTED.
 *
 * ⛔ It used to be assigned in the render BODY, which React documents as forbidden ("do not write or read
 * `ref.current` during rendering") for a reason this hook can pay in data loss rather than a warning. A ref
 * write is not part of the render's work, so React never rolls it back: a render it DISCARDS — a sibling
 * suspends, a transition is interrupted — still advances the ref to that abandoned pass's closure, and the
 * committed tree then calls through a closure over a `recipeId` the user never landed on. The unattended
 * write goes to the WRONG RECIPE, carrying this recipe's draft and this recipe's `expectedVersion` — a
 * silent overwrite with no error path, because every guard inside reads the COMMITTED `query.data` and
 * passes.
 *
 * The repair is React's documented shape: assign in an effect, which a discarded render never runs. This
 * case is driven through Suspense for the same reason `useReturnFocusOnClose.test.tsx` is — it is the one
 * way to discard a render deterministically — and it was watched failing on the render-body assignment.
 *
 * ⚠️ UNCHANGED by the 2026-09-03 cadence repair, deliberately. What the ref publishes widened from
 * `submitDraft` to the whole unattended-save command, and this case was re-run against a render-body
 * assignment of the NEW ref and still fails on it — the guarantee it pins survived the refactor rather
 * than being quietly re-scoped.
 */
describe('autoSaveDraft — it writes to the recipe that COMMITTED, not one React discarded', () => {
    /** A Suspense gate the test opens by hand. `done` is what lets React's retry render past the throw. */
    interface Gate {
        readonly promise: Promise<void>;
        readonly open: () => void;
        done: boolean;
    }

    function makeGate(): Gate {
        let release = (): void => undefined;
        const promise = new Promise<void>((resolve) => {
            release = resolve;
        });
        const gate: Gate = { promise, open: release, done: false };

        void promise.then(() => {
            gate.done = true;
        });

        return gate;
    }

    /** Suspends the render pass it is part of until {@link Gate.open} is called. */
    function Suspender({ gate }: { readonly gate: Gate | null }): null {
        if (gate !== null && !gate.done) {
            throw gate.promise;
        }

        return null;
    }

    /** Published during render so the enclosing test can hold the COMMITTED render's own `autoSaveDraft`. */
    let published: ReturnType<typeof useRecipeEditor> | undefined;

    function Probe({ recipeId }: { readonly recipeId: string }): null {
        published = useRecipeEditor(currentRecipe(recipeId), { onSaved: vi.fn(), locale: 'en' });

        return null;
    }

    /**
     * REWRITTEN for the settled-recipe signature. The id, draft and base version are mount state now, so an abandoned
     * pass cannot change them — the one live input left is the recipe PROP, whose `status` decides what an unattended
     * save names. The discarded pass hands the SAME recipe republished; a ref assigned in the render body would carry
     * that pass's closure and send `published`, while the committed render's recipe is still a draft.
     */
    it('does not adopt the submit implementation from a render React threw away', () => {
        recipeSource.mockImplementation((id: string) =>
            recipeQuery({
                data: makeRecipeDetail({
                    id: 'rec_A',
                    currentVersion: 3,
                    status: id === 'rec_A:republished' ? RecipeStatus.PUBLISHED : RecipeStatus.DRAFT,
                }),
            }),
        );
        const mutation = updateMutation();
        useUpdateRecipeMock.mockReturnValue(mutation);

        const tree = (source: string, gate: Gate | null): JSX.Element => (
            <Suspense fallback={<p>loading</p>}>
                <Probe recipeId={source} />
                <Suspender gate={gate} />
            </Suspense>
        );

        const { rerender } = render(tree('rec_A', null));

        // The committed editor, seeded from the draft recipe, and the handle a timer already holds.
        expect(published?.state.status).toBe('editing');
        const autoSaveFromTheCommittedRender = published?.autoSaveDraft;

        // ONE update both republishes the recipe and suspends a sibling: React renders the probe, then hits the throw
        // and abandons the whole pass.
        rerender(tree('rec_A:republished', makeGate()));

        expect(screen.getByText('loading')).toBeTruthy();

        // The auto-save timer armed against the committed render fires while that pass is parked.
        act(() => autoSaveFromTheCommittedRender?.());

        expect(mutation.mutate).toHaveBeenCalledTimes(1);
        expect(mutation.mutate.mock.calls[0]?.[0]).toMatchObject({
            id: 'rec_A',
            input: { status: RecipeStatus.DRAFT },
        });
    });
});

/**
 * REWRITTEN TWICE: first when the seed moved into render (was "it refuses the commit where the query has moved on and
 * the draft has not"), now for the settled-recipe signature, where the hook no longer reseeds at all.
 *
 * The hazard is unchanged: an unattended tick must never write one recipe's CONTENT to another recipe's id. Containers
 * remount the editor per recipe id, and the hook binds the draft, its base version and its write target at ONE seed,
 * so a tick firing in the very commit that hands the mounted editor a different recipe still writes the recipe the
 * draft came from. The tick runs from a sibling's passive effect in the same flush as the editor's (`TickOnce` sits
 * after `Probe`), the earliest moment any timer could fire.
 */
describe("autoSaveDraft — the commit that hands the editor another recipe still writes the draft's own recipe", () => {
    /** Published during render so the sibling effect below can reach the CURRENT render's editor. */
    let editor: ReturnType<typeof useRecipeEditor> | undefined;

    function Probe({ recipeId }: { readonly recipeId: string }): null {
        editor = useRecipeEditor(currentRecipe(recipeId), { onSaved: vi.fn(), locale: 'en' });

        return null;
    }

    /** The draft title each tick saw, in order — proof the tick fired, and of what it fired against. */
    const titlesSeenByTick: string[] = [];

    /** Fires the auto-save exactly once, from a passive effect in the same flush as the editor's own. */
    function TickOnce({ armed }: { readonly armed: boolean }): null {
        const fired = useRef(false);

        // No dependency array, so it is ordered by the flush rather than by a dep change; the latch is what
        // keeps it to the single commit under test.
        useEffect(() => {
            if (armed && !fired.current) {
                fired.current = true;
                titlesSeenByTick.push(editor?.values.title ?? '<no editor>');
                editor?.autoSaveDraft();
            }
        });

        return null;
    }

    it("never writes the seeded recipe's content onto another recipe's id", () => {
        recipeSource.mockImplementation((id: string) =>
            recipeQuery({
                data: makeRecipeDetail({
                    id,
                    title: `Title of ${id}`,
                    currentVersion: id === 'rec_B' ? 7 : 3,
                }),
            }),
        );
        const mutation = updateMutation();
        useUpdateRecipeMock.mockReturnValue(mutation);
        titlesSeenByTick.length = 0;

        const tree = (recipeId: string, armed: boolean): JSX.Element => (
            <>
                <Probe recipeId={recipeId} />
                <TickOnce armed={armed} />
            </>
        );

        const { rerender } = render(tree('rec_A', false));

        expect(editor?.values.title).toBe('Title of rec_A');

        // ONE update hands the mounted editor rec_B and arms the tick, which fires inside that commit's own flush.
        rerender(tree('rec_B', true));

        expect(titlesSeenByTick).toEqual(['Title of rec_A']);
        expect(mutation.mutate).toHaveBeenCalledTimes(1);
        expect(mutation.mutate.mock.calls[0]?.[0]).toMatchObject({
            id: 'rec_A',
            input: { title: 'Title of rec_A', expectedVersion: 3 },
        });
    });
});
