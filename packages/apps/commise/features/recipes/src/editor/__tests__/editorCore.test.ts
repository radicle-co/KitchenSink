/**
 * The editor's state core (`editorCore.ts`): one test per transition, and one per combination the union makes
 * unrepresentable — a transition that would produce it leaves the state as it was.
 */
import { RecipeStatus, type RecipeDetail } from '@kitchensink/recipe-core';
import { makeRecipeVersion } from '@kitchensink/recipe-core/testing';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import type { IngredientLineKey } from '../../form/lineKey.js';
import { defaultRecipeFormValues } from '../../form/values.js';
import { toRecipeFormValues } from '../../form/wire.js';
import type { PendingRebind, QueuedLineCommand } from '../../hooks/lineCommit.js';
import { toDraftValues, type DraftMemento } from '../draftStore.js';
import {
    commandAddressOf,
    createEditorCoreStore,
    editorCoreReducer,
    heldOf,
    liveHeldRebinds,
    persistedKeysOf,
    seedEditorCore,
    serverIdOf,
    serverValuesOf,
    type ConflictInfo,
    type EditorCoreState,
    type ServerFacts,
} from '../editorCore.js';

const IDS = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'] as const;
const REBOUND = '00000000-0000-4000-8000-00000000000f';
const NEWER = '00000000-0000-4000-8000-00000000000e';
const TARGET = { kind: 'catalogFood', foodId: '00000000-0000-4000-8000-0000000000aa' } as const;
const BINDING = { ingredientId: REBOUND, name: 'Chickpeas', isUserEntered: false } as const;

const recipeAt = (
    version: number,
    status: RecipeStatus = RecipeStatus.PUBLISHED,
    second: string = IDS[1],
): RecipeDetail =>
    makeRecipeDetail({
        id: 'rec_1',
        currentVersion: version,
        status,
        ingredients: [
            makeIngredientView({ ingredientId: IDS[0], name: 'Olive oil' }),
            makeIngredientView({ ingredientId: second, name: 'chick' }),
        ],
    });

const stored = (version = 3): EditorCoreState => seedEditorCore({ recipe: recipeAt(version) }).core;
const unsaved = (): EditorCoreState => seedEditorCore({}).core;
const secondKey = (state: EditorCoreState): IngredientLineKey => state.draft.ingredients[1]!.key;

function command(key: IngredientLineKey, held?: PendingRebind): QueuedLineCommand {
    return {
        key,
        send: vi.fn(),
        claim: () => true,
        settle: vi.fn(),
        ...(held === undefined ? {} : { held }),
    };
}

function memento(over: Partial<DraftMemento> = {}): DraftMemento {
    return {
        recipeRef: 'rec_1',
        baseVersion: 3,
        values: toDraftValues(toRecipeFormValues(recipeAt(3))),
        pendingRebinds: [],
        savedAt: '2026-10-09T11:00:00.000Z',
        ...over,
    };
}

const CONFLICT: ConflictInfo = {
    theirs: recipeAt(6),
    draft: toRecipeFormValues(recipeAt(3)),
    mergeSelections: {},
    server: {
        versionNumber: 6,
        updatedAt: '2026-10-09T10:00:00.000Z',
        snapshot: makeRecipeVersion({ versionNumber: 6 }).snapshot,
    },
    mineSnapshot: makeRecipeVersion({ versionNumber: 3 }).snapshot,
    diff: { rows: [], hasConflict: false, isEmpty: true },
    versionsBehind: 6,
    neverPublished: false,
    parkedSeq: 4,
    trigger: 'sectionChange',
};

describe('the union makes impossible server facts unrepresentable', () => {
    it('an unsaved recipe has no server values, recipe, held re-picks or drain failure; a stored one has them all', () => {
        type Unsaved = Extract<ServerFacts, { kind: 'unsaved' }>;
        type Stored = Extract<ServerFacts, { kind: 'stored' }>;

        expectTypeOf<keyof Unsaved>().toEqualTypeOf<'kind' | 'ref' | 'baseVersion'>();
        expectTypeOf<Stored['baseVersion']>().toEqualTypeOf<number>();
        expectTypeOf<Stored['ref']>().toEqualTypeOf<string>();
        expectTypeOf<Stored['recipe']>().toEqualTypeOf<RecipeDetail>();
    });
});

describe('seedEditorCore', () => {
    it('a new recipe: a blank draft, unsaved with no ref, nothing to resume', () => {
        expect(seedEditorCore({})).toEqual({
            core: {
                draft: defaultRecipeFormValues(),
                touched: false,
                server: { kind: 'unsaved', ref: undefined, baseVersion: null },
                commands: [],
                conflict: undefined,
            },
            resumeSavedAt: undefined,
        });
    });

    it('a stored recipe: the draft is what the server holds, every fact at once', () => {
        const recipe = recipeAt(3);
        const { core } = seedEditorCore({ recipe });

        expect(core.server).toEqual({
            kind: 'stored',
            ref: 'rec_1',
            recipe,
            values: toRecipeFormValues(recipe),
            baseVersion: 3,
            held: [],
            drainFailed: false,
        });
        expect(core.draft).toEqual(toRecipeFormValues(recipe));
    });

    it('a device draft wins over the server`s copy, names its own version and keeps its held re-picks', () => {
        const key = toRecipeFormValues(recipeAt(3)).ingredients[1]!.key;
        const held = [{ lineKey: key, target: TARGET }];
        const changed = { ...toRecipeFormValues(recipeAt(3)), description: 'Mine.' };
        const { core, resumeSavedAt } = seedEditorCore({
            recipe: recipeAt(3),
            memento: memento({ baseVersion: 2, values: toDraftValues(changed), pendingRebinds: held }),
        });

        expect(core.draft.description).toBe('Mine.');
        expect(core.server).toMatchObject({ kind: 'stored', baseVersion: 2, held });
        expect(resumeSavedAt).toBe('2026-10-09T11:00:00.000Z');
    });

    it('a device draft of a recipe never stored is unsaved under its ref, and drops held re-picks it cannot have', () => {
        const key = toRecipeFormValues(recipeAt(3)).ingredients[1]!.key;
        const { core } = seedEditorCore({
            memento: memento({
                recipeRef: 'local:recipe:x',
                baseVersion: null,
                pendingRebinds: [{ lineKey: key, target: TARGET }],
            }),
        });

        expect(core.server).toEqual({ kind: 'unsaved', ref: 'local:recipe:x', baseVersion: null });
        expect(heldOf(core.server)).toEqual([]);
    });

    it('keys what a newer server read holds at the draft`s version, so the same lines are found', () => {
        const { core } = seedEditorCore({ recipe: recipeAt(4), memento: memento({ baseVersion: 3 }) });

        expect(serverValuesOf(core.server)?.ingredients.map((line) => line.key)).toEqual(
            core.draft.ingredients.map((line) => line.key),
        );
        expect(persistedKeysOf(core.server)).toEqual(['v3.0', 'v3.1']);
    });

    it('a draft equal to the server shows no resume notice, and a never-published one never does', () => {
        expect(seedEditorCore({ recipe: recipeAt(3), memento: memento() }).resumeSavedAt).toBeUndefined();

        const draft = recipeAt(3, RecipeStatus.DRAFT);
        const changed = toDraftValues({ ...toRecipeFormValues(draft), description: 'Mine.' });

        expect(seedEditorCore({ recipe: draft, memento: memento({ values: changed }) }).resumeSavedAt).toBeUndefined();
    });
});

describe('draft transitions', () => {
    it('draftReplaced replaces the draft and marks it touched', () => {
        const next = { ...defaultRecipeFormValues(), title: 'Soup' };

        expect(editorCoreReducer(unsaved(), { type: 'draftReplaced', draft: next })).toMatchObject({
            draft: next,
            touched: true,
        });
    });

    it('draftActed applies a draft transition to the draft as it is now, and marks it touched', () => {
        const state = editorCoreReducer(unsaved(), {
            type: 'draftActed',
            action: { kind: 'appendSteps', instructions: ['Boil.'] },
        });

        expect(state.draft.steps.at(-1)).toMatchObject({ instruction: 'Boil.' });
        expect(state.touched).toBe(true);
    });

    it('draftRestored puts a draft back without marking an edit', () => {
        const next = { ...defaultRecipeFormValues(), title: 'Soup' };

        expect(editorCoreReducer(unsaved(), { type: 'draftRestored', draft: next })).toMatchObject({
            draft: next,
            touched: false,
        });
    });
});

describe('server transitions', () => {
    it('refMinted gives an unsaved recipe its ref, once', () => {
        const minted = editorCoreReducer(unsaved(), { type: 'refMinted', ref: 'local:recipe:a' });

        expect(minted.server).toEqual({ kind: 'unsaved', ref: 'local:recipe:a', baseVersion: null });
        expect(editorCoreReducer(minted, { type: 'refMinted', ref: 'local:recipe:b' })).toBe(minted);
    });

    it('illegal: refMinted on a stored recipe changes nothing (its ref is the server`s)', () => {
        const state = stored();

        expect(editorCoreReducer(state, { type: 'refMinted', ref: 'local:recipe:a' })).toBe(state);
    });

    it('written stores every fact of the answer at once', () => {
        const detail = recipeAt(1, RecipeStatus.DRAFT);
        const sent = toRecipeFormValues(detail);
        const state = editorCoreReducer(unsaved(), { type: 'written', detail, sent });

        expect(state.server).toEqual({
            kind: 'stored',
            ref: 'rec_1',
            recipe: detail,
            values: sent,
            baseVersion: 1,
            held: [],
            drainFailed: false,
        });
        expect(serverIdOf(state.server)).toBe('rec_1');
    });

    it('written on a stored recipe keeps its held re-picks', () => {
        const state = editorCoreReducer(stored(), {
            type: 'rebindHeld',
            rebind: { lineKey: secondKey(stored()), target: TARGET },
            binding: BINDING,
        });
        const next = editorCoreReducer(state, { type: 'written', detail: recipeAt(4), sent: state.draft });

        expect(heldOf(next.server)).toEqual(heldOf(state.server));
    });

    it('versionAdopted moves the version the next write names', () => {
        expect(editorCoreReducer(stored(), { type: 'versionAdopted', version: 7 }).server).toMatchObject({
            baseVersion: 7,
        });
    });

    it('rebound re-points the line in the draft and in what the server holds, and adopts the answer`s version', () => {
        const state = stored();
        const key = secondKey(state);
        const detail = recipeAt(4, RecipeStatus.PUBLISHED, REBOUND);
        const next = editorCoreReducer(state, { type: 'rebound', detail, key, binding: BINDING, held: undefined });

        expect(next.draft.ingredients[1]).toMatchObject({ key, ingredientId: REBOUND });
        expect(next.server).toMatchObject({ kind: 'stored', recipe: detail, baseVersion: 4 });
        expect(serverValuesOf(next.server)?.ingredients[1]).toMatchObject({ key, ingredientId: REBOUND });
    });

    it('rebound answers the held re-pick it drained: it leaves the held list', () => {
        const base = stored();
        const held = { lineKey: secondKey(base), target: TARGET };
        const state = editorCoreReducer(base, { type: 'rebindHeld', rebind: held, binding: BINDING });
        const next = editorCoreReducer(state, {
            type: 'rebound',
            detail: recipeAt(4, RecipeStatus.PUBLISHED, REBOUND),
            key: held.lineKey,
            binding: BINDING,
            held,
        });

        expect(heldOf(next.server)).toEqual([]);
    });

    it('rebound leaves a NEWER held pick of the same line on the draft (code-reviewer Medium 5)', () => {
        const base = stored();
        const key = secondKey(base);
        const older = { lineKey: key, target: TARGET };
        const newer = { lineKey: key, target: { kind: 'name', name: 'garbanzo' } } as const;
        const held = editorCoreReducer(
            editorCoreReducer(base, { type: 'rebindHeld', rebind: older, binding: BINDING }),
            {
                type: 'rebindHeld',
                rebind: newer,
                binding: { ingredientId: NEWER, name: 'Garbanzo', isUserEntered: false },
            },
        );
        const next = editorCoreReducer(held, {
            type: 'rebound',
            detail: recipeAt(4, RecipeStatus.PUBLISHED, REBOUND),
            key,
            binding: BINDING,
            held: older,
        });

        expect(next.draft.ingredients[1]).toMatchObject({ ingredientId: NEWER });
        expect(serverValuesOf(next.server)?.ingredients[1]).toMatchObject({ ingredientId: REBOUND });
        expect(heldOf(next.server)).toEqual([newer]);
    });

    it('illegal: rebound on an unsaved recipe changes nothing (no stored line to re-point)', () => {
        const state = unsaved();

        expect(
            editorCoreReducer(state, {
                type: 'rebound',
                detail: recipeAt(4),
                key: 'v1.0' as IngredientLineKey,
                binding: BINDING,
                held: undefined,
            }),
        ).toBe(state);
    });

    it('rebindHeld holds the re-pick, shows it on the line, and marks the draft touched; a later one replaces it', () => {
        const base = stored();
        const key = secondKey(base);
        const first = editorCoreReducer(base, {
            type: 'rebindHeld',
            rebind: { lineKey: key, target: TARGET },
            binding: BINDING,
        });
        const other = { lineKey: key, target: { kind: 'name', name: 'garbanzo' } } as const;
        const second = editorCoreReducer(first, { type: 'rebindHeld', rebind: other, binding: BINDING });

        expect(first.draft.ingredients[1]).toMatchObject({ ingredientId: REBOUND });
        expect(first.touched).toBe(true);
        expect(heldOf(second.server)).toEqual([other]);
    });

    it('illegal: rebindHeld on an unsaved recipe changes nothing (a held re-pick needs a stored line)', () => {
        const state = unsaved();

        expect(
            editorCoreReducer(state, {
                type: 'rebindHeld',
                rebind: { lineKey: 'v1.0' as IngredientLineKey, target: TARGET },
                binding: BINDING,
            }),
        ).toBe(state);
    });

    it('heldDropped removes exactly the dropped re-picks', () => {
        const base = stored();
        const first = { lineKey: base.draft.ingredients[0]!.key, target: TARGET };
        const second = { lineKey: secondKey(base), target: TARGET };
        const held = [first, second].reduce(
            (state, rebind) => editorCoreReducer(state, { type: 'rebindHeld', rebind, binding: BINDING }),
            base,
        );

        expect(heldOf(editorCoreReducer(held, { type: 'heldDropped', dropped: [first] }).server)).toEqual([second]);
    });

    it('drainFailed and drainReset set and clear the stopped drain', () => {
        const failed = editorCoreReducer(stored(), { type: 'drainFailed' });

        expect(failed.server).toMatchObject({ drainFailed: true });
        expect(editorCoreReducer(failed, { type: 'drainReset' }).server).toMatchObject({ drainFailed: false });
    });

    it('illegal: an unsaved recipe cannot have a stopped drain', () => {
        const state = unsaved();

        expect(editorCoreReducer(state, { type: 'drainFailed' })).toBe(state);
        expect(editorCoreReducer(state, { type: 'heldDropped', dropped: [] })).toBe(state);
        expect(editorCoreReducer(state, { type: 'drainReset' })).toBe(state);
    });
});

describe('command and conflict transitions', () => {
    it('commandsQueued appends in order; an empty batch changes nothing', () => {
        const state = stored();
        const a = command(secondKey(state));
        const b = command(secondKey(state));
        const queued = editorCoreReducer(state, { type: 'commandsQueued', commands: [a, b] });

        expect(queued.commands).toEqual([a, b]);
        expect(editorCoreReducer(queued, { type: 'commandsQueued', commands: [] })).toBe(queued);
    });

    it('commandDone removes that command only', () => {
        const state = stored();
        const a = command(secondKey(state));
        const b = command(secondKey(state));
        const queued = editorCoreReducer(state, { type: 'commandsQueued', commands: [a, b] });

        expect(editorCoreReducer(queued, { type: 'commandDone', command: a }).commands).toEqual([b]);
    });

    it('drainCommandsCleared removes every drain command and keeps a command run at once', () => {
        const state = stored();
        const now = command(secondKey(state));
        const drain = command(secondKey(state), { lineKey: secondKey(state), target: TARGET });
        const queued = editorCoreReducer(state, { type: 'commandsQueued', commands: [now, drain] });

        expect(editorCoreReducer(queued, { type: 'drainCommandsCleared' }).commands).toEqual([now]);
    });

    it('conflictOpened opens it not resolving; conflictResolving and mergeSelected move it; conflictClosed closes it', () => {
        const opened = editorCoreReducer(stored(), { type: 'conflictOpened', info: CONFLICT });

        expect(opened.conflict).toEqual({ info: CONFLICT, resolving: false });
        expect(editorCoreReducer(opened, { type: 'conflictResolving', resolving: true }).conflict?.resolving).toBe(
            true,
        );
        expect(
            editorCoreReducer(opened, { type: 'mergeSelected', selections: { title: 'theirs' } }).conflict?.info
                .mergeSelections,
        ).toEqual({ title: 'theirs' });
        expect(editorCoreReducer(opened, { type: 'conflictClosed' }).conflict).toBeUndefined();
    });

    it('illegal: resolving, choosing or closing with no conflict open changes nothing', () => {
        const state = stored();

        expect(editorCoreReducer(state, { type: 'conflictResolving', resolving: true })).toBe(state);
        expect(editorCoreReducer(state, { type: 'mergeSelected', selections: {} })).toBe(state);
        expect(editorCoreReducer(state, { type: 'conflictClosed' })).toBe(state);
    });
});

describe('selectors', () => {
    it('an unsaved recipe has no id, no server values and stores no line', () => {
        const { server } = unsaved();

        expect(serverIdOf(server)).toBeUndefined();
        expect(serverValuesOf(server)).toBeUndefined();
        expect(persistedKeysOf(server)).toEqual([]);
        expect(liveHeldRebinds(server, defaultRecipeFormValues())).toEqual([]);
    });

    it('commandAddressOf names the stored position and the version the next write names; none for an unstored line', () => {
        const state = editorCoreReducer(stored(3), { type: 'versionAdopted', version: 5 });

        expect(commandAddressOf(state.server, secondKey(state))).toEqual({
            recipeId: 'rec_1',
            position: 1,
            expectedVersion: 5,
        });
        expect(commandAddressOf(state.server, 'n:fresh' as IngredientLineKey)).toBeUndefined();
        expect(commandAddressOf(unsaved().server, 'v1.0' as IngredientLineKey)).toBeUndefined();
    });

    it('liveHeldRebinds drops a re-pick whose line the server no longer stores', () => {
        // The draft was built on version 3 (three lines); the server is at version 4 with two.
        const three = makeRecipeDetail({
            id: 'rec_1',
            currentVersion: 3,
            status: RecipeStatus.PUBLISHED,
            ingredients: [IDS[0], IDS[1], NEWER].map((ingredientId) => makeIngredientView({ ingredientId })),
        });
        const values = toRecipeFormValues(three);
        const key = values.ingredients[2]!.key;
        const draft = {
            ...values,
            ingredients: values.ingredients.map((line) =>
                line.key === key ? { ...line, ingredientId: REBOUND } : line,
            ),
        };
        const { core } = seedEditorCore({
            recipe: { ...three, currentVersion: 4, ingredients: three.ingredients.slice(0, 2) },
            memento: memento({ values: toDraftValues(draft), pendingRebinds: [{ lineKey: key, target: TARGET }] }),
        });

        expect(liveHeldRebinds(core.server, core.draft)).toEqual([]);
    });

    it('liveHeldRebinds drops a re-pick whose line is gone and one back to the food the server holds', () => {
        const base = stored();
        const key = secondKey(base);
        const held = editorCoreReducer(base, {
            type: 'rebindHeld',
            rebind: { lineKey: key, target: TARGET },
            binding: BINDING,
        });

        expect(liveHeldRebinds(held.server, held.draft)).toEqual([{ lineKey: key, target: TARGET }]);
        expect(liveHeldRebinds(held.server, base.draft)).toEqual([]);
        expect(
            liveHeldRebinds(held.server, {
                ...held.draft,
                ingredients: held.draft.ingredients.filter((line) => line.key !== key),
            }),
        ).toEqual([]);
    });
});

describe('createEditorCoreStore', () => {
    it('is current the moment dispatch returns, and notifies only on a change', () => {
        const store = createEditorCoreStore(unsaved());
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);
        const before = store.get();

        store.dispatch({ type: 'conflictClosed' });
        expect(store.get()).toBe(before);
        expect(listener).not.toHaveBeenCalled();

        store.dispatch({ type: 'refMinted', ref: 'local:recipe:a' });
        expect(store.get().server).toMatchObject({ ref: 'local:recipe:a' });
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        store.dispatch({ type: 'draftReplaced', draft: defaultRecipeFormValues() });
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
