/**
 * {@link useRecipeEditor} — the one-page editor's lifecycle (slice 7; owner decisions D1, D7, D9; blueprint A3/A4;
 * ADR-0057, ADR-0058).
 *
 * REWRITTEN for slice 7. The wizard's step state, Save Draft, the five-minute auto-save and the direct `useUpdateRecipe`
 * write are gone; their coverage moved here as follows: seed-once and the version a write names (§ seed), the 409 →
 * conflict invariant and its resolutions (§ conflict), the rebind command queue (§ rebind). Every server write now goes
 * through the outbox port, so the port is a fake that records what was submitted and lets the test answer it — the
 * settlement bus is the only way the editor learns anything, which is the contract.
 */
import { act, renderHook } from '@testing-library/react';
import {
    RecipeStatus,
    type RecipeDetail,
    type RecipeSnapshot,
    type VersionConflictSide,
} from '@kitchensink/recipe-core';
import { makeRecipeVersion } from '@kitchensink/recipe-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeFakeEditorWritePort as fakePort } from '../../__fixtures__/editorWritePort.js';
import { makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import { DEVICE_SAVE_IDLE_MS, SERVER_CHECKPOINT_IDLE_MS } from '../../editor/checkpointPolicy.js';
import { createPasteHold, type PasteHold } from '../../editor/pasteHold.js';
import type { DraftMemento, DraftStore } from '../../editor/draftStore.js';
import type { IngredientLineKey } from '../../form/lineKey.js';
import { toDraftValues } from '../../editor/draftStore.js';
import { toRecipeFormValues } from '../../form/wire.js';
import { draftToSnapshot } from '../../versions/merge.js';
import type { RebindLineSend } from '../lineCommit.js';
import { useRecipeEditor, type EditorExit, type EditorSeed, type UseRecipeEditorResult } from '../useRecipeEditor.js';

/** A device draft store that records what it was asked. */
function fakeDrafts(): DraftStore & {
    readonly saved: DraftMemento[];
    readonly discarded: string[];
    readonly adopted: unknown[];
} {
    const saved: DraftMemento[] = [];
    const discarded: string[] = [];
    const adopted: unknown[] = [];

    return {
        saved,
        discarded,
        adopted,
        load: vi.fn(async () => undefined),
        save: vi.fn(async (memento: DraftMemento) => {
            saved.push(memento);
        }),
        discard: vi.fn(async (ref: string) => {
            discarded.push(ref);
        }),
        adopt: vi.fn(async (ref: string, answer: unknown) => {
            adopted.push([ref, answer]);
        }),
        clear: vi.fn(async () => undefined),
    };
}

/** A version-conflict side at `versionNumber`, holding `snapshot`. */
function sideAt(
    versionNumber: number,
    snapshot: RecipeSnapshot = makeRecipeVersion({ versionNumber }).snapshot,
): VersionConflictSide {
    return { versionNumber, updatedAt: '2026-10-09T10:00:00.000Z', snapshot };
}

const PUBLISHED = makeRecipeDetail({ id: 'rec_1', currentVersion: 3, status: RecipeStatus.PUBLISHED });
const NEVER_PUBLISHED = makeRecipeDetail({ id: 'rec_1', currentVersion: 3, status: RecipeStatus.DRAFT });

function mount(seed: EditorSeed = {}, pasteHold?: PasteHold) {
    const port = fakePort();
    const drafts = fakeDrafts();
    const onExit = vi.fn<(exit: EditorExit) => void>();
    const onRecipeRef = vi.fn<(ref: string) => void>();
    const rebindLine = vi.fn<RebindLineSend>(async () => {
        throw new Error('rebindLine: not expected in this test');
    });
    const view = renderHook(
        (props: { readonly seed: EditorSeed; readonly pastePending?: boolean }) =>
            useRecipeEditor(props.seed, {
                locale: 'en',
                port,
                drafts,
                keep: 'disk',
                onExit,
                onRecipeRef,
                rebindLine,
                pastePending: props.pastePending ?? false,
                ...(pasteHold === undefined ? {} : { pasteHold }),
                now: () => new Date('2026-10-09T12:00:00.000Z'),
            }),
        { initialProps: { seed } as { readonly seed: EditorSeed; readonly pastePending?: boolean } },
    );

    return { ...view, port, drafts, onExit, onRecipeRef, rebindLine };
}

/** Type a title (the draft floor's one requirement). */
function typeTitle(result: { readonly current: UseRecipeEditorResult }, title = 'Soup'): void {
    act(() => {
        result.current.setField('title', title);
    });
}

/** Flush the promise callbacks of fake async ports. */
async function settle(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
    });
}

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('a new recipe', () => {
    it('opens blank, unsaved, with nothing stored and paste available (D10)', () => {
        const { result, drafts, port } = mount();

        expect(result.current.lifecycle).toBe('unsaved');
        expect(result.current.recipeId).toBeUndefined();
        expect(result.current.saveStatus).toEqual({ kind: 'unsaved' });
        expect(result.current.pasteAvailable).toBe(true);
        expect(drafts.save).not.toHaveBeenCalled();
        expect(port.submitExclusive).not.toHaveBeenCalled();
    });

    it('⛔ stores nothing for an opened-and-left New recipe: no draft, no server write (A4)', async () => {
        const { result, drafts, port } = mount();

        act(() => {
            result.current.checkpoint('editorExit');
        });
        await settle();

        expect(drafts.save).not.toHaveBeenCalled();
        expect(port.submitExclusive).not.toHaveBeenCalled();
    });

    it('keeps the device draft one second after typing stops, under a local ref minted at the first input', async () => {
        const { result, drafts, onRecipeRef } = mount();

        act(() => {
            result.current.setField('description', 'Creamy.');
        });
        act(() => {
            vi.advanceTimersByTime(DEVICE_SAVE_IDLE_MS - 1);
        });
        expect(drafts.save).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(1);
        });
        await settle();

        expect(drafts.saved).toHaveLength(1);
        expect(drafts.saved[0]).toMatchObject({ baseVersion: null, values: { description: 'Creamy.' } });
        expect(drafts.saved[0]?.recipeRef).toMatch(/^local:recipe:/);
        expect(onRecipeRef).toHaveBeenCalledWith(drafts.saved[0]?.recipeRef);
        expect(result.current.saveStatus).toEqual({ kind: 'keptOnDevice', store: 'disk', awaiting: 'checkpoint' });
    });

    it('⛔ does not reach the server below the draft floor (no title), whatever the checkpoint', async () => {
        const { result, port } = mount();

        act(() => {
            result.current.setField('description', 'Creamy.');
        });
        act(() => {
            result.current.checkpoint('sectionChange');
            vi.advanceTimersByTime(SERVER_CHECKPOINT_IDLE_MS);
        });
        await settle();

        expect(port.submitExclusive).not.toHaveBeenCalled();
    });

    it('creates the recipe at the first checkpoint past the floor, as a draft, keyed by its local ref', async () => {
        const { result, port } = mount();

        typeTitle(result);
        act(() => {
            result.current.checkpoint('sectionChange');
        });
        await settle();

        const [create] = port.submitted;
        expect(create).toMatchObject({ entity: 'recipe', intentKind: 'create', dependsOn: [] });
        expect(create?.localId).toMatch(/^local:recipe:/);
        expect(create?.produces).toBe(create?.localId);
        expect(create?.payload).toMatchObject({ input: { title: 'Soup', status: RecipeStatus.DRAFT } });
        expect(result.current.saveStatus).toEqual({ kind: 'syncing' });
    });

    it('checkpoints by itself ten seconds after typing stops', async () => {
        const { result, port } = mount();

        typeTitle(result);
        act(() => {
            vi.advanceTimersByTime(SERVER_CHECKPOINT_IDLE_MS - 1);
        });
        await settle();
        expect(port.submitExclusive).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(1);
        });
        await settle();

        expect(port.submitted.map((intent) => intent.intentKind)).toEqual(['create']);
    });

    it('adopts the create`s answer: the server id, its version, the draft moved to the id; paste stays (D10)', async () => {
        const { result, port, drafts, onRecipeRef } = mount();

        typeTitle(result);
        act(() => {
            result.current.checkpoint('sectionChange');
        });
        await settle();

        const localRef = port.submitted[0]?.localId ?? '';
        const created = makeRecipeDetail({
            id: 'rec_new',
            currentVersion: 1,
            status: RecipeStatus.DRAFT,
            title: 'Soup',
        });

        act(() => {
            port.sync(port.lastSeq(), created);
        });
        await settle();

        expect(result.current.recipeId).toBe('rec_new');
        expect(result.current.lifecycle).toBe('neverPublished');
        // REWRITTEN (owner D10, 2026-10-09): paste lasts until the first PUBLISH, not the first server save.
        expect(result.current.pasteAvailable).toBe(true);
        expect(drafts.adopt).toHaveBeenCalledWith(localRef, { serverId: 'rec_new', version: 1 });
        expect(onRecipeRef).toHaveBeenLastCalledWith('rec_new');

        // ⛔ The next write is an update naming the version the create returned (ADR-0057: the editor owns the token).
        act(() => {
            result.current.setField('description', 'Creamy.');
        });
        act(() => {
            result.current.checkpoint('sectionChange');
        });
        await settle();

        expect(port.submitted.at(-1)).toMatchObject({
            intentKind: 'update',
            localId: 'rec_new',
            payload: { id: 'rec_new', input: { description: 'Creamy.', expectedVersion: 1 } },
        });
        expect(port.submitted.at(-1)?.payload).not.toHaveProperty('input.status');
    });

    it('⛔ never sends a second write beside one on the wire: the checkpoint waits for the answer, then runs', async () => {
        const { result, port } = mount();

        typeTitle(result);
        act(() => {
            result.current.checkpoint('sectionChange');
        });
        await settle();
        const createSeq = port.lastSeq();
        port.claim(createSeq);

        act(() => {
            result.current.setField('description', 'Creamy.');
        });
        act(() => {
            result.current.checkpoint('sectionChange');
        });
        await settle();
        expect(port.submitted).toHaveLength(1);

        act(() => {
            port.sync(createSeq, makeRecipeDetail({ id: 'rec_new', currentVersion: 1, status: RecipeStatus.DRAFT }));
        });
        await settle();
        await settle();

        expect(port.submitted.map((intent) => intent.intentKind)).toEqual(['create', 'update']);
        expect(port.submitted[1]?.payload).toMatchObject({ input: { description: 'Creamy.', expectedVersion: 1 } });
    });
});

/**
 * ⛔ AN ANSWER CAN ARRIVE BEFORE THE EDITOR HAS RECORDED WHAT IT ASKED. The outbox drains as soon as a write is queued,
 * so on a fast network the settlement is published before the promise of `submitExclusive` has resolved in the editor:
 * the editor must still recognise it as its own, or the create's id and version are lost and every later update names
 * the wrong version.
 */
describe('an answer that lands before the editor recorded the write', () => {
    it('is still adopted as the outstanding write`s answer', async () => {
        const { result, port, drafts } = mount();
        const created = makeRecipeDetail({ id: 'rec_fast', currentVersion: 1, status: RecipeStatus.DRAFT });
        const queue = port.submitExclusive.getMockImplementation();
        port.submitExclusive.mockImplementationOnce(async (intent) => {
            const outcome = await queue!(intent);
            // The drain answers before the editor sees `queued`.
            port.sync(outcome.seq, created);

            return outcome;
        });

        typeTitle(result);
        act(() => {
            result.current.checkpoint('sectionChange');
        });
        await settle();
        await settle();

        expect(result.current.recipeId).toBe('rec_fast');
        expect(drafts.adopt).toHaveBeenCalledWith(expect.stringMatching(/^local:recipe:/u), {
            serverId: 'rec_fast',
            version: 1,
        });
    });
});

describe('Publish', () => {
    it('refuses an incomplete recipe: field errors, the first section, Fix statuses — and sends nothing', async () => {
        const { result, port } = mount();

        typeTitle(result);
        let outcome: unknown;
        act(() => {
            outcome = result.current.publish('');
        });
        await settle();

        expect(outcome).toMatchObject({ kind: 'refused', section: 'ingredients' });
        expect(result.current.errors).toMatchObject({ ingredients: 'ingredientsEmpty', steps: 'stepsRequired' });
        expect(result.current.publishAttempted).toBe(true);
        expect(port.submitExclusive).not.toHaveBeenCalled();
    });

    it('creates a complete new recipe as published, waits for the answer, then hands off as a first publish', async () => {
        const recipe = makeRecipeDetail({ id: 'rec_x', currentVersion: 1, status: RecipeStatus.PUBLISHED });
        const { result, port, drafts, onExit } = mount();

        act(() => {
            result.current.setValues({ ...toRecipeFormValues(recipe), photos: [] });
        });
        act(() => {
            result.current.publish('');
        });
        await settle();

        expect(port.submitted[0]).toMatchObject({ intentKind: 'create', payload: { input: { status: 'published' } } });
        expect(result.current.state.status).toBe('finishing');
        expect(onExit).not.toHaveBeenCalled();

        act(() => {
            port.sync(port.lastSeq(), recipe);
        });
        await settle();

        expect(onExit).toHaveBeenCalledWith({ kind: 'published', recipe, firstPublish: true });
        expect(drafts.discard).toHaveBeenCalledWith('rec_x');
        expect(result.current.state.status).toBe('done');
    });

    it('publishes a never-published draft with an update that names its version', async () => {
        const { result, port, onExit } = mount({ recipe: NEVER_PUBLISHED });

        act(() => {
            result.current.publish('');
        });
        await settle();

        expect(port.submitted[0]).toMatchObject({
            intentKind: 'update',
            localId: 'rec_1',
            payload: { input: { status: 'published', expectedVersion: 3 } },
        });

        act(() => {
            port.sync(port.lastSeq(), { ...NEVER_PUBLISHED, currentVersion: 4, status: RecipeStatus.PUBLISHED });
        });
        await settle();

        expect(onExit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'published', firstPublish: true }));
    });
});

describe('a published recipe (D1: changes stay on the device until Save changes)', () => {
    it('keeps every change on the device, and no checkpoint reaches the server', async () => {
        const { result, port, drafts } = mount({ recipe: PUBLISHED });

        expect(result.current.hasUnsavedChanges).toBe(false);

        act(() => {
            result.current.setField('description', 'Creamier.');
        });
        act(() => {
            result.current.checkpoint('sectionChange');
            vi.advanceTimersByTime(SERVER_CHECKPOINT_IDLE_MS);
        });
        await settle();

        expect(port.submitExclusive).not.toHaveBeenCalled();
        expect(drafts.saved.at(-1)).toMatchObject({ recipeRef: 'rec_1', baseVersion: 3 });
        expect(result.current.hasUnsavedChanges).toBe(true);
        expect(result.current.saveStatus).toEqual({ kind: 'keptOnDevice', store: 'disk', awaiting: 'saveChanges' });
    });

    it('Save changes sends one update with no status change, then hands off', async () => {
        const { result, port, drafts, onExit } = mount({ recipe: PUBLISHED });

        act(() => {
            result.current.setField('description', 'Creamier.');
        });
        act(() => {
            result.current.saveChanges('');
        });
        await settle();

        expect(port.submitted).toHaveLength(1);
        expect(port.submitted[0]).toMatchObject({ intentKind: 'update', payload: { input: { expectedVersion: 3 } } });
        expect(port.submitted[0]?.payload).not.toHaveProperty('input.status');

        const saved = { ...PUBLISHED, currentVersion: 4 };
        act(() => {
            port.sync(port.lastSeq(), saved);
        });
        await settle();

        expect(onExit).toHaveBeenCalledWith({ kind: 'changesSaved', recipe: saved });
        expect(drafts.discard).toHaveBeenCalledWith('rec_1');
    });

    it('reopens from the device draft with the resume notice; a draft equal to the server shows none', () => {
        const changed = { ...toRecipeFormValues(PUBLISHED), description: 'Creamier.' };
        const memento: DraftMemento = {
            recipeRef: 'rec_1',
            baseVersion: 3,
            values: toDraftValues(changed),
            pendingRebinds: [],
            savedAt: '2026-10-08T09:00:00.000Z',
        };

        expect(mount({ recipe: PUBLISHED, memento }).result.current).toMatchObject({
            resume: { savedAt: '2026-10-08T09:00:00.000Z' },
            values: { description: 'Creamier.' },
        });

        const same = { ...memento, values: toDraftValues(toRecipeFormValues(PUBLISHED)) };
        expect(mount({ recipe: PUBLISHED, memento: same }).result.current.resume).toBeUndefined();
    });

    /** ADR-0058 rule 1: a recipe set back to draft through the API was published, so its device changes resume too. */
    it('a published recipe set back to draft is still published to the editor: its changes wait, and resume', () => {
        const redrafted = { ...PUBLISHED, status: RecipeStatus.DRAFT, firstPublishedAt: '2026-10-01T09:00:00.000Z' };
        const memento: DraftMemento = {
            recipeRef: 'rec_1',
            baseVersion: 3,
            values: toDraftValues({ ...toRecipeFormValues(redrafted), description: 'Creamier.' }),
            pendingRebinds: [],
            savedAt: '2026-10-08T09:00:00.000Z',
        };

        expect(mount({ recipe: redrafted, memento }).result.current).toMatchObject({
            lifecycle: 'published',
            pasteAvailable: false,
            resume: { savedAt: '2026-10-08T09:00:00.000Z' },
        });
    });

    it('⛔ a draft edited from an older version names THAT version, so another device`s save meets a 409', async () => {
        const memento: DraftMemento = {
            recipeRef: 'rec_1',
            baseVersion: 2,
            values: toDraftValues({ ...toRecipeFormValues(PUBLISHED), description: 'Mine.' }),
            pendingRebinds: [],
            savedAt: '2026-10-08T09:00:00.000Z',
        };
        const { result, port } = mount({ recipe: PUBLISHED, memento });

        act(() => {
            result.current.saveChanges('');
        });
        await settle();

        expect(port.submitted[0]).toMatchObject({ payload: { input: { expectedVersion: 2 } } });
    });

    it('takes the status from a newer read of the SAME recipe, and never its content', () => {
        const { result, rerender } = mount({ recipe: NEVER_PUBLISHED });

        act(() => {
            result.current.setField('description', 'Mine.');
        });
        rerender({ seed: { recipe: { ...PUBLISHED, currentVersion: 5, description: 'Theirs.' } } });

        expect(result.current.lifecycle).toBe('published');
        expect(result.current.values.description).toBe('Mine.');
    });
});

describe('409 → conflict (the handled-409 invariant)', () => {
    async function conflicted(serverSnapshot: RecipeSnapshot) {
        const view = mount({ recipe: NEVER_PUBLISHED });

        act(() => {
            view.result.current.setField('description', 'Mine.');
        });
        act(() => {
            view.result.current.checkpoint('sectionChange');
        });
        await settle();
        const seq = view.port.lastSeq();

        act(() => {
            view.port.park(seq, 409, { kind: 'recipeConflict', server: sideAt(6, serverSnapshot) });
        });
        await settle();

        return { ...view, seq };
    }

    it('opens the conflict view from the parked write`s own sides; a draft has no base, and says so', async () => {
        const { result } = await conflicted({
            ...makeRecipeVersion({ versionNumber: 6 }).snapshot,
            description: 'Theirs.',
        });

        expect(result.current.state).toMatchObject({ status: 'conflict', neverPublished: true, versionsBehind: 6 });
        expect(result.current.state).not.toHaveProperty('base');
        expect(result.current.saveStatus).toEqual({ kind: 'syncFailed', failure: 'conflict' });
    });

    it('overwrite withdraws the parked write and resends the draft at the server`s version', async () => {
        const { result, port, seq } = await conflicted({
            ...makeRecipeVersion({ versionNumber: 6 }).snapshot,
            description: 'Theirs.',
        });

        act(() => {
            result.current.resolutions.overwrite();
        });
        await settle();
        await settle();

        expect(port.withdrawn).toEqual([seq]);
        expect(port.submitted.at(-1)).toMatchObject({
            payload: { input: { description: 'Mine.', expectedVersion: 6 } },
        });
        expect(result.current.state.status).toBe('editing');
    });

    it('keepServer withdraws it, drops the device draft and hands off to the recipe, writing nothing', async () => {
        const { result, port, drafts, onExit, seq } = await conflicted({
            ...makeRecipeVersion({ versionNumber: 6 }).snapshot,
            description: 'Theirs.',
        });
        const before = port.submitted.length;

        act(() => {
            result.current.resolutions.keepServer();
        });
        await settle();

        expect(port.withdrawn).toEqual([seq]);
        expect(port.submitted).toHaveLength(before);
        expect(drafts.discard).toHaveBeenCalledWith('rec_1');
        expect(onExit).toHaveBeenCalledWith({ kind: 'leftForRecipe', recipeId: 'rec_1' });
    });

    it('a phantom 409 (the two sides already agree) is withdrawn and resent at the server version, with no view', async () => {
        const draft = { ...toRecipeFormValues(NEVER_PUBLISHED), description: 'Mine.' };
        const view = mount({ recipe: NEVER_PUBLISHED });

        act(() => {
            view.result.current.setValues(draft);
        });
        act(() => {
            view.result.current.checkpoint('sectionChange');
        });
        await settle();
        const seq = view.port.lastSeq();

        act(() => {
            view.port.park(seq, 409, {
                kind: 'recipeConflict',
                // The server already holds exactly the draft.
                server: sideAt(6, draftToSnapshot(view.result.current.values, 6)),
            });
        });
        await settle();
        await settle();

        expect(view.result.current.state.status).not.toBe('conflict');
        expect(view.port.withdrawn).toEqual([seq]);
        expect(view.port.submitted.at(-1)).toMatchObject({ payload: { input: { expectedVersion: 6 } } });
    });
});

describe('a parked write the cook has to decide on', () => {
    it('reports an unknown create as such, and Retry withdraws it and sends the draft again', async () => {
        const { result, port } = mount();

        typeTitle(result);
        act(() => {
            result.current.checkpoint('sectionChange');
        });
        await settle();
        const seq = port.lastSeq();

        act(() => {
            port.park(seq);
        });
        await settle();

        expect(result.current.parked).toEqual({ failure: 'unknown', kind: 'create' });
        expect(result.current.saveStatus).toEqual({ kind: 'syncFailed', failure: 'unknown' });

        act(() => {
            result.current.retry();
        });
        await settle();
        await settle();

        expect(port.withdrawn).toEqual([seq]);
        expect(port.submitted.map((intent) => intent.intentKind)).toEqual(['create', 'create']);
        expect(result.current.parked).toBeUndefined();
    });
});

describe('discard', () => {
    it('a new recipe: drops the device draft and writes nothing', async () => {
        const { result, port, drafts, onExit } = mount();

        act(() => {
            result.current.setField('description', 'x');
        });
        act(() => {
            vi.advanceTimersByTime(DEVICE_SAVE_IDLE_MS);
        });
        await settle();
        const ref = drafts.saved[0]?.recipeRef;

        act(() => {
            result.current.discard();
        });
        await settle();

        expect(drafts.discard).toHaveBeenCalledWith(ref);
        expect(port.submit).not.toHaveBeenCalled();
        expect(onExit).toHaveBeenCalledWith({ kind: 'discarded' });
    });

    it('a stored draft: deletes it through the outbox, and drops the device draft', async () => {
        const { result, port, drafts, onExit } = mount({ recipe: NEVER_PUBLISHED });

        act(() => {
            result.current.discard();
        });
        await settle();

        expect(port.submitted).toEqual([
            { entity: 'recipe', intentKind: 'delete', localId: 'rec_1', dependsOn: [], payload: { id: 'rec_1' } },
        ]);
        expect(drafts.discard).toHaveBeenCalledWith('rec_1');
        expect(onExit).toHaveBeenCalledWith({ kind: 'discarded' });
    });

    it('a published recipe: drops only the device changes and returns to the recipe', async () => {
        const { result, port, drafts, onExit } = mount({ recipe: PUBLISHED });

        act(() => {
            result.current.discard();
        });
        await settle();

        expect(port.submit).not.toHaveBeenCalled();
        expect(drafts.discard).toHaveBeenCalledWith('rec_1');
        expect(onExit).toHaveBeenCalledWith({ kind: 'leftForRecipe', recipeId: 'rec_1' });
    });
});

/**
 * Navigation tells the screen it is leaving synchronously, inside the exit it was handed (React Navigation's
 * `beforeRemove`), and the native screen answers a system Back with the exit checkpoint. That checkpoint reads the
 * hook from the render BEFORE the discard, so the hand-off must close the editor synchronously: otherwise it writes the
 * discarded draft back to the device, and sends a create for a recipe the cook threw away.
 */
describe('after the editor hands off', () => {
    it('a checkpoint from the same tick as Discard writes nothing, to the device or the server', async () => {
        const { result, port, drafts, onExit } = mount();
        onExit.mockImplementation(() => result.current.checkpoint('editorExit'));

        act(() => {
            result.current.setField('title', 'Thrown away');
        });
        act(() => {
            result.current.discard();
        });
        await settle();

        expect(onExit).toHaveBeenCalledWith({ kind: 'discarded' });
        expect(drafts.saved).toEqual([]);
        expect(port.submitted).toEqual([]);
    });
});

describe('the rebind command (ADR-0045), in the lane', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    const IDS = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'] as const;
    const REBOUND = '00000000-0000-4000-8000-00000000000f';
    const twoLines = (version: number): RecipeDetail =>
        makeRecipeDetail({
            id: 'rec_1',
            currentVersion: version,
            status: RecipeStatus.DRAFT,
            ingredients: [
                makeIngredientView({ ingredientId: IDS[0], name: 'Olive oil' }),
                makeIngredientView({ ingredientId: IDS[1], name: 'chick', resolutionStatus: 'NEEDS_REVIEW' }),
            ],
        });

    const rebound = (version: number): RecipeDetail => {
        const detail = twoLines(version);

        return {
            ...detail,
            ingredients: [
                detail.ingredients[0]!,
                makeIngredientView({ ingredientId: REBOUND, name: 'Chickpeas', resolutionStatus: 'RESOLVED' }),
            ],
        };
    };

    it('sends to the stored position with the version the draft is built on, and adopts the version it returns', async () => {
        const { result, port } = mount({ recipe: twoLines(3) });
        const send = vi.fn(async () => rebound(4));
        const key = result.current.values.ingredients[1]!.key;

        // ⚠️ Not awaited inside `act`: the command runs from an effect, and `act` holds rendering until its callback ends.
        act(() => {
            void result.current.lineCommand.run(key, send);
        });
        await settle();
        await settle();

        expect(send).toHaveBeenCalledWith({ recipeId: 'rec_1', position: 1, expectedVersion: 3 });
        expect(result.current.values.ingredients[1]).toMatchObject({ key, ingredientId: REBOUND });

        act(() => {
            result.current.setField('description', 'After.');
        });
        act(() => {
            result.current.checkpoint('sectionChange');
        });
        await settle();

        expect(port.submitted.at(-1)).toMatchObject({ payload: { input: { expectedVersion: 4 } } });
    });

    it('⛔ waits while a server write is outstanding, then sends at the version that write returned', async () => {
        const { result, port } = mount({ recipe: twoLines(3) });
        const send = vi.fn(async () => rebound(5));

        act(() => {
            result.current.setField('description', 'First.');
        });
        act(() => {
            result.current.checkpoint('sectionChange');
        });
        await settle();

        let done = false;
        act(() => {
            void result.current.lineCommand.run(result.current.values.ingredients[1]!.key, send).then(() => {
                done = true;
            });
        });
        await settle();
        expect(send).not.toHaveBeenCalled();

        act(() => {
            port.sync(port.lastSeq(), { ...twoLines(4), description: 'First.' });
        });
        await settle();
        await settle();

        expect(send).toHaveBeenCalledWith({ recipeId: 'rec_1', position: 1, expectedVersion: 4 });
        await settle();
        expect(done).toBe(true);
    });

    it('a command`s 409 opens the conflict view and resends nothing', async () => {
        const { VersionConflictError } = await import('@kitchensink/recipe-service-client');
        const { result, port } = mount({ recipe: twoLines(3) });
        const { snapshot } = makeRecipeVersion({ versionNumber: 6 });
        const send = vi.fn(async () => {
            throw new VersionConflictError(6, 3, 'conflict', {
                server: sideAt(6, { ...snapshot, description: 'Theirs.' }),
            });
        });
        let outcome: unknown;

        act(() => {
            void result.current.lineCommand.run(result.current.values.ingredients[1]!.key, send).then((answer) => {
                outcome = answer;
            });
        });
        await settle();
        await settle();

        expect(outcome).toEqual({ kind: 'conflict' });
        expect(result.current.state.status).toBe('conflict');
        expect(port.submitExclusive).not.toHaveBeenCalled();
    });
});

/**
 * Discard while the create is on the wire (finding 4): the delete names the create's local ref as its dependency, so it
 * drains after the create and is sent with the id the create returns. The editor states it itself rather than relying
 * on the outbox's supersession to add it, and names it only while the ref is local (`appendIntent` refuses a server id).
 */
describe('discard while the create is on the wire', () => {
    it('submits a delete that depends on the create`s local ref', async () => {
        const { result, port } = mount();

        typeTitle(result);
        act(() => {
            result.current.checkpoint('sectionChange');
        });
        await settle();
        const localRef = port.submitted[0]?.localId ?? '';
        port.claim(port.lastSeq());

        act(() => {
            result.current.discard();
        });
        await settle();

        expect(localRef).toMatch(/^local:recipe:/u);
        expect(port.submitted.at(-1)).toEqual({
            entity: 'recipe',
            intentKind: 'delete',
            localId: localRef,
            dependsOn: [localRef],
            payload: { id: localRef },
        });
    });
});

/** A complete recipe's values, so Publish passes the gate. */
function complete(): ReturnType<typeof toRecipeFormValues> {
    return { ...toRecipeFormValues(makeRecipeDetail({ id: 'rec_c', status: RecipeStatus.DRAFT })), photos: [] };
}

/**
 * Publish pressed while a checkpoint's write is on the wire (finding 3). The editor keeps one write in flight, so the
 * Publish waits for the answer. It must not wait INVISIBLY — the bar reads finishing — and it must not publish a draft
 * the cook changed in the meantime without checking it again.
 */
describe('Publish while a checkpoint is on the wire', () => {
    async function publishBehindTheCreate() {
        const view = mount();

        act(() => {
            view.result.current.setValues(complete());
        });
        act(() => {
            view.result.current.checkpoint('sectionChange');
        });
        await settle();
        const createSeq = view.port.lastSeq();
        view.port.claim(createSeq);

        let outcome: unknown;
        act(() => {
            outcome = view.result.current.publish('');
        });
        await settle();

        return { ...view, createSeq, outcome };
    }

    const created = (): RecipeDetail =>
        makeRecipeDetail({ id: 'rec_c', currentVersion: 1, status: RecipeStatus.DRAFT });

    it('shows the bar as finishing while the Publish waits, and a second press is busy', async () => {
        const { result, port } = await publishBehindTheCreate();

        expect(port.submitted.map((intent) => intent.intentKind)).toEqual(['create']);
        expect(result.current.state.status).toBe('finishing');

        let again: unknown;
        act(() => {
            again = result.current.publish('');
        });

        expect(again).toEqual({ kind: 'busy' });
    });

    it('publishes once the create answers, with an update that names the create`s version', async () => {
        const { result, port, createSeq } = await publishBehindTheCreate();

        act(() => {
            port.sync(createSeq, created());
        });
        await settle();
        await settle();

        expect(port.submitted.at(-1)).toMatchObject({
            intentKind: 'update',
            payload: { input: { status: 'published', expectedVersion: 1 } },
        });
        expect(result.current.state.status).toBe('finishing');
    });

    it('⛔ checks the draft again when it runs: a draft emptied meanwhile is refused like any Publish', async () => {
        const { result, port, createSeq } = await publishBehindTheCreate();

        act(() => {
            result.current.setField('steps', []);
        });
        act(() => {
            port.sync(createSeq, created());
        });
        await settle();
        await settle();

        expect(port.submitted.map((intent) => intent.intentKind)).toEqual(['create']);
        expect(result.current.errors).toMatchObject({ steps: 'stepsRequired' });
        expect(result.current.publishAttempted).toBe(true);
        expect(result.current.state.status).toBe('editing');
    });

    it('stops finishing when the write it waits for parks: the cook decides, and nothing publishes behind them', async () => {
        const { result, port, createSeq } = await publishBehindTheCreate();

        act(() => {
            port.park(createSeq);
        });
        await settle();

        expect(result.current.state.status).toBe('editing');
        expect(result.current.parked).toEqual({ failure: 'unknown', kind: 'create' });
        expect(port.submitted.map((intent) => intent.intentKind)).toEqual(['create']);

        // The cook's Retry sends the draft again; the Publish that waited behind the parked write does not come back.
        act(() => {
            result.current.retry();
        });
        await settle();
        await settle();
        act(() => {
            port.sync(port.lastSeq(), created());
        });
        await settle();
        await settle();

        expect(port.submitted.map((intent) => intent.intentKind)).toEqual(['create', 'create']);
        expect(result.current.state.status).toBe('editing');
    });
});

/**
 * Paste and the create (findings 7 and 8; owner D10 as amended 2026-10-09). Paste is offered until the first publish.
 * A pasted line keeps its source only while the create has not been SUBMITTED, and a paste still joining holds the
 * create, so no line joins a draft whose create already went out.
 */
describe('paste and the create', () => {
    it('a pasted line keeps its source until the create is submitted, not until it answers', async () => {
        const { result, port } = mount();

        typeTitle(result);
        expect(result.current.pasteKeepsSource).toBe(true);

        act(() => {
            result.current.checkpoint('sectionChange');
        });
        await settle();
        port.claim(port.lastSeq());

        expect(result.current.recipeId).toBeUndefined();
        expect(result.current.pasteKeepsSource).toBe(false);
        expect(result.current.pasteAvailable).toBe(true);
    });

    it('holds the create while a paste is joining, and sends it at the next checkpoint once the paste is done', async () => {
        const { result, port, rerender } = mount();

        rerender({ seed: {}, pastePending: true });
        typeTitle(result);
        act(() => {
            result.current.checkpoint('sectionChange');
        });
        await settle();
        expect(port.submitExclusive).not.toHaveBeenCalled();

        rerender({ seed: {}, pastePending: false });
        act(() => {
            result.current.checkpoint('sectionChange');
        });
        await settle();
        expect(port.submitted.map((intent) => intent.intentKind)).toEqual(['create']);
    });

    it('holds the create while the shared paste hold says a paste is joining, read when the checkpoint runs', async () => {
        const hold = createPasteHold();
        const { result, port } = mount({}, hold);

        hold.set(true);
        typeTitle(result);
        act(() => {
            result.current.checkpoint('sectionChange');
        });
        await settle();
        expect(port.submitExclusive).not.toHaveBeenCalled();

        // No render in between: the hold is read when the checkpoint runs, not copied into the editor's state.
        hold.set(false);
        act(() => {
            result.current.checkpoint('sectionChange');
        });
        await settle();
        expect(port.submitted.map((intent) => intent.intentKind)).toEqual(['create']);
    });

    it('a published recipe offers no paste', () => {
        const { result } = mount({ recipe: PUBLISHED });

        expect(result.current.pasteAvailable).toBe(false);
    });
});

/**
 * A food re-picked on a PUBLISHED recipe waits for Save changes (owner D1; blueprint A3's `pendingRebinds`; finding 6).
 * Sending it at once made a version before the cook said they were done, and Discard could not take it back. Held, it
 * is shown on the line at once, kept in the device draft, drained through the rebind command (which teaches, ADR-0045)
 * when the cook presses Save changes — and only then is the Save changes update sent.
 */
describe('a re-pick on a published recipe waits for Save changes', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    const IDS = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'] as const;
    const REBOUND = '00000000-0000-4000-8000-00000000000f';
    const TARGET = { kind: 'catalogFood', foodId: '00000000-0000-4000-8000-0000000000aa' } as const;
    const BINDING = {
        ingredientId: REBOUND,
        name: 'Chickpeas',
        isUserEntered: false,
        resolutionStatus: 'RESOLVED',
    } as const;
    const published = (version: number, second: string = IDS[1]): RecipeDetail =>
        makeRecipeDetail({
            id: 'rec_1',
            currentVersion: version,
            status: RecipeStatus.PUBLISHED,
            ingredients: [
                makeIngredientView({ ingredientId: IDS[0], name: 'Olive oil' }),
                makeIngredientView({ ingredientId: second, name: second === REBOUND ? 'Chickpeas' : 'chick' }),
            ],
        });

    function holdOnSecondLine(view: ReturnType<typeof mount>): IngredientLineKey {
        const key = view.result.current.values.ingredients[1]!.key;

        act(() => {
            view.result.current.lineCommand.hold({ lineKey: key, target: TARGET }, BINDING);
        });

        return key;
    }

    it('holds it: the line shows the new food, nothing is sent, and the device draft keeps it', async () => {
        const view = mount({ recipe: published(3) });

        expect(view.result.current.lineCommand.holdsRebinds).toBe(true);
        const key = holdOnSecondLine(view);
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, DEVICE_SAVE_IDLE_MS + 20));
        });

        expect(view.result.current.values.ingredients[1]).toMatchObject({ key, ingredientId: REBOUND });
        expect(view.rebindLine).not.toHaveBeenCalled();
        expect(view.port.submitExclusive).not.toHaveBeenCalled();
        expect(view.drafts.saved.at(-1)?.pendingRebinds).toEqual([{ lineKey: key, target: TARGET }]);
        expect(view.result.current.hasUnsavedChanges).toBe(true);
    });

    it('a second re-pick of the same line replaces the first', async () => {
        const view = mount({ recipe: published(3) });
        const key = holdOnSecondLine(view);
        const other = { kind: 'name', name: 'garbanzo beans' } as const;

        act(() => {
            view.result.current.lineCommand.hold({ lineKey: key, target: other }, BINDING);
        });
        act(() => {
            view.result.current.checkpoint('fieldBlur');
        });
        await settle();

        expect(view.drafts.saved.at(-1)?.pendingRebinds).toEqual([{ lineKey: key, target: other }]);
    });

    it('Discard takes it back: no rebind, no recipe write', async () => {
        const view = mount({ recipe: published(3) });
        holdOnSecondLine(view);

        act(() => {
            view.result.current.discard();
        });
        await settle();

        expect(view.rebindLine).not.toHaveBeenCalled();
        expect(view.port.submit).not.toHaveBeenCalled();
        expect(view.port.submitExclusive).not.toHaveBeenCalled();
        expect(view.onExit).toHaveBeenCalledWith({ kind: 'leftForRecipe', recipeId: 'rec_1' });
    });

    it('Save changes drains it through the rebind command, then sends ONE update at the version it returned', async () => {
        const view = mount({ recipe: published(3) });
        const key = holdOnSecondLine(view);
        view.rebindLine.mockImplementation(async () => published(4, REBOUND));
        act(() => {
            view.result.current.setField('description', 'Smokier.');
        });

        act(() => {
            view.result.current.saveChanges('');
        });
        await settle();
        await settle();

        expect(view.rebindLine).toHaveBeenCalledTimes(1);
        expect(view.rebindLine).toHaveBeenCalledWith({ recipeId: 'rec_1', position: 1, expectedVersion: 3 }, TARGET);
        expect(view.port.submitted).toHaveLength(1);
        expect(view.port.submitted[0]).toMatchObject({
            intentKind: 'update',
            payload: { input: { description: 'Smokier.', expectedVersion: 4 } },
        });
        expect(view.result.current.state.status).toBe('finishing');
        expect(view.result.current.values.ingredients[1]).toMatchObject({ key, ingredientId: REBOUND });

        const saved = { ...published(5, REBOUND), description: 'Smokier.' };
        act(() => {
            view.port.sync(view.port.lastSeq(), saved);
        });
        await settle();

        expect(view.onExit).toHaveBeenCalledWith({ kind: 'changesSaved', recipe: saved });
    });

    it('Save changes with only a re-pick sends the rebind and no update, then hands off', async () => {
        const view = mount({ recipe: published(3) });
        holdOnSecondLine(view);
        view.rebindLine.mockImplementation(async () => published(4, REBOUND));

        act(() => {
            view.result.current.saveChanges('');
        });
        await settle();
        await settle();

        expect(view.rebindLine).toHaveBeenCalledTimes(1);
        expect(view.port.submitExclusive).not.toHaveBeenCalled();
        expect(view.onExit).toHaveBeenCalledWith({ kind: 'changesSaved', recipe: published(4, REBOUND) });
    });

    it('a held re-pick whose line the cook removed is never sent', async () => {
        const view = mount({ recipe: published(3) });
        const key = holdOnSecondLine(view);
        act(() => {
            view.result.current.setValues({
                ...view.result.current.values,
                ingredients: view.result.current.values.ingredients.filter((line) => line.key !== key),
            });
        });

        act(() => {
            view.result.current.saveChanges('');
        });
        await settle();
        await settle();

        expect(view.rebindLine).not.toHaveBeenCalled();
        expect(view.port.submitted).toHaveLength(1);
    });

    it('⛔ a re-pick stays in the device draft until its rebind answers: a leave mid-drain keeps it', async () => {
        const view = mount({ recipe: published(3) });
        const key = holdOnSecondLine(view);
        view.rebindLine.mockReturnValue(new Promise(() => undefined));

        act(() => {
            view.result.current.saveChanges('');
        });
        await settle();
        expect(view.rebindLine).toHaveBeenCalledTimes(1);

        act(() => {
            view.result.current.checkpoint('editorExit');
        });
        await settle();

        expect(view.drafts.saved.at(-1)?.pendingRebinds).toEqual([{ lineKey: key, target: TARGET }]);
    });

    it('a re-pick back to the food the server holds is dropped: it would make a version that changes nothing', async () => {
        const view = mount({ recipe: published(3) });
        const key = holdOnSecondLine(view);
        const original = view.result.current.values.ingredients[1];
        act(() => {
            view.result.current.lineCommand.hold(
                { lineKey: key, target: { kind: 'name', name: 'chick' } },
                { ingredientId: IDS[1], name: 'chick', isUserEntered: false },
            );
        });
        act(() => {
            view.result.current.setField('description', 'Other change.');
        });

        act(() => {
            view.result.current.saveChanges('');
        });
        await settle();
        await settle();

        expect(original).toBeDefined();
        expect(view.rebindLine).not.toHaveBeenCalled();
        expect(view.port.submitted).toHaveLength(1);
    });

    it('a rebind that fails stops the save: no update is sent, the re-pick is kept, and Retry runs the save again', async () => {
        const view = mount({ recipe: published(3) });
        holdOnSecondLine(view);
        view.rebindLine.mockRejectedValueOnce(new Error('offline'));

        act(() => {
            view.result.current.saveChanges('');
        });
        await settle();
        await settle();

        expect(view.port.submitExclusive).not.toHaveBeenCalled();
        expect(view.result.current.state.status).toBe('editing');
        expect(view.result.current.parked).toEqual({ failure: 'transient', kind: 'update' });

        view.rebindLine.mockImplementation(async () => published(4, REBOUND));
        act(() => {
            view.result.current.retry();
        });
        await settle();
        await settle();

        expect(view.rebindLine).toHaveBeenCalledTimes(2);
        expect(view.onExit).toHaveBeenCalledWith({ kind: 'changesSaved', recipe: published(4, REBOUND) });
    });

    it('reopens with the re-picks the device draft kept, and Save changes sends them', async () => {
        const recipe = published(3);
        const values = toRecipeFormValues(recipe);
        const key = values.ingredients[1]!.key;
        const memento: DraftMemento = {
            recipeRef: 'rec_1',
            baseVersion: 3,
            values: toDraftValues({
                ...values,
                ingredients: values.ingredients.map((line) => (line.key === key ? { ...line, ...BINDING } : line)),
            }),
            pendingRebinds: [{ lineKey: key, target: TARGET }],
            savedAt: '2026-10-09T11:00:00.000Z',
        };
        const view = mount({ recipe, memento });
        view.rebindLine.mockImplementation(async () => published(4, REBOUND));

        act(() => {
            view.result.current.saveChanges('');
        });
        await settle();
        await settle();

        expect(view.rebindLine).toHaveBeenCalledWith({ recipeId: 'rec_1', position: 1, expectedVersion: 3 }, TARGET);
    });

    it('a never-published draft does not hold: its re-pick runs at once (it makes no version, ADR-0058)', () => {
        const { result } = mount({ recipe: { ...published(3), status: RecipeStatus.DRAFT } });

        expect(result.current.lineCommand.holdsRebinds).toBe(false);
    });
});

/**
 * CHARACTERIZATION, written before the editor was split into a pure state core (staff-code-quality REACT-26/REACT-18):
 * behaviour no test above pinned, recorded as it was so the refactor provably keeps it.
 */
describe('characterization: the conflict view`s other exits', () => {
    async function conflictedOver(description: string) {
        const view = mount({ recipe: NEVER_PUBLISHED });

        act(() => {
            view.result.current.setField('description', 'Mine.');
        });
        act(() => {
            view.result.current.checkpoint('sectionChange');
        });
        await settle();
        const seq = view.port.lastSeq();

        act(() => {
            view.port.park(seq, 409, {
                kind: 'recipeConflict',
                server: sideAt(6, { ...makeRecipeVersion({ versionNumber: 6 }).snapshot, description }),
            });
        });
        await settle();

        return { ...view, seq };
    }

    it('Discard and close withdraws the parked write, drops the device draft and returns to the recipe', async () => {
        const { result, port, drafts, onExit, seq } = await conflictedOver('Theirs.');
        const before = port.submitted.length;

        act(() => {
            result.current.discardAndClose();
        });
        await settle();

        expect(port.withdrawn).toEqual([seq]);
        expect(port.submitted).toHaveLength(before);
        expect(drafts.discard).toHaveBeenCalledWith('rec_1');
        expect(onExit).toHaveBeenCalledWith({ kind: 'leftForRecipe', recipeId: 'rec_1' });
        expect(result.current.state.status).toBe('done');
    });

    it('setMergeSelections records the choice, and merge resends the composed draft at the server version', async () => {
        const { result, port, seq } = await conflictedOver('Theirs.');

        act(() => {
            result.current.resolutions.setMergeSelections({ description: 'theirs' });
        });
        expect(result.current.state).toMatchObject({ status: 'conflict', mergeSelections: { description: 'theirs' } });

        act(() => {
            result.current.resolutions.merge({ description: 'theirs' });
        });
        await settle();
        await settle();

        expect(port.withdrawn).toEqual([seq]);
        expect(port.submitted.at(-1)).toMatchObject({
            payload: { input: { description: 'Theirs.', expectedVersion: 6 } },
        });
        expect(result.current.values.description).toBe('Theirs.');
        expect(result.current.state.status).toBe('editing');
    });

    it('a resolution pressed while another is on its way is ignored, and the view says it is resolving', async () => {
        const { result, port } = await conflictedOver('Theirs.');
        port.withdraw.mockImplementationOnce(() => new Promise(() => undefined));

        act(() => {
            result.current.resolutions.overwrite();
        });
        expect(result.current.state).toMatchObject({ status: 'conflict', isResolving: true });

        act(() => {
            result.current.resolutions.keepServer();
        });
        await settle();

        expect(port.withdraw).toHaveBeenCalledTimes(1);
    });

    it('a withdrawal that fails leaves the conflict open and no longer resolving', async () => {
        const { result, port } = await conflictedOver('Theirs.');
        port.withdraw.mockRejectedValueOnce(new Error('storage'));

        act(() => {
            result.current.resolutions.overwrite();
        });
        await settle();
        await settle();

        expect(result.current.state).toMatchObject({ status: 'conflict', isResolving: false });
    });

    it('a conflict from a Publish keeps publishing when the cook overwrites', async () => {
        const view = mount({ recipe: NEVER_PUBLISHED });

        act(() => {
            view.result.current.setValues({ ...complete(), description: 'Mine.' });
        });
        act(() => {
            view.result.current.publish('');
        });
        await settle();
        act(() => {
            view.port.park(view.port.lastSeq(), 409, {
                kind: 'recipeConflict',
                server: sideAt(6, { ...makeRecipeVersion({ versionNumber: 6 }).snapshot, description: 'Theirs.' }),
            });
        });
        await settle();
        expect(view.result.current.state.status).toBe('conflict');

        act(() => {
            view.result.current.resolutions.overwrite();
        });
        await settle();
        await settle();

        expect(view.port.submitted.at(-1)).toMatchObject({
            payload: { input: { status: 'published', expectedVersion: 6 } },
        });
        expect(view.result.current.state.status).toBe('finishing');
    });
});

describe('characterization: a write parked in an earlier session', () => {
    function withEarlierParked(status?: number) {
        const view = mount({ recipe: NEVER_PUBLISHED });

        view.port.failures.push({
            seq: 41,
            entity: 'recipe',
            intentKind: 'update',
            localId: 'rec_1',
            ...(status === undefined ? {} : { status }),
        });
        view.rerender({ seed: { recipe: NEVER_PUBLISHED } });

        return view;
    }

    it('stands in the lane: it shows as parked, and a checkpoint writes the device draft but sends nothing', async () => {
        const { result, port, drafts } = withEarlierParked(503);

        expect(result.current.parked).toEqual({ failure: 'transient', kind: 'update' });

        act(() => {
            result.current.setField('description', 'Mine.');
        });
        act(() => {
            result.current.checkpoint('sectionChange');
        });
        await settle();

        expect(port.submitExclusive).not.toHaveBeenCalled();
        expect(drafts.saved.at(-1)).toMatchObject({ recipeRef: 'rec_1', values: { description: 'Mine.' } });
        expect(result.current.saveStatus).toEqual({ kind: 'syncFailed', failure: 'transient' });
    });

    it('Retry withdraws it and sends the draft again', async () => {
        const { result, port } = withEarlierParked(503);

        act(() => {
            result.current.setField('description', 'Mine.');
        });
        act(() => {
            result.current.retry();
        });
        await settle();
        await settle();

        expect(port.withdrawn).toEqual([41]);
        expect(port.submitted.at(-1)).toMatchObject({
            intentKind: 'update',
            payload: { input: { description: 'Mine.', expectedVersion: 3 } },
        });
    });

    it('Retry with nothing parked does nothing', async () => {
        const { result, port } = mount({ recipe: NEVER_PUBLISHED });

        act(() => {
            result.current.retry();
        });
        await settle();

        expect(port.withdraw).not.toHaveBeenCalled();
        expect(port.submitExclusive).not.toHaveBeenCalled();
    });
});

describe('characterization: the device draft', () => {
    it('a device write that fails says so', async () => {
        const { result, drafts } = mount();
        vi.mocked(drafts.save).mockRejectedValueOnce(new Error('disk full'));

        act(() => {
            result.current.setField('description', 'Creamy.');
        });
        act(() => {
            vi.advanceTimersByTime(DEVICE_SAVE_IDLE_MS);
        });
        await settle();
        await settle();

        expect(result.current.saveStatus).toEqual({ kind: 'deviceFailed' });
    });

    it('a submit the outbox refuses to take marks the device copy failed', async () => {
        const { result, port } = mount();
        port.submitExclusive.mockRejectedValueOnce(new Error('journal'));

        typeTitle(result);
        act(() => {
            result.current.checkpoint('sectionChange');
        });
        await settle();
        await settle();

        expect(result.current.saveStatus).toEqual({ kind: 'deviceFailed' });
    });

    it('a published recipe edited back to what the server holds drops its device draft and reads saved', async () => {
        const { result, drafts } = mount({ recipe: PUBLISHED });
        const original = result.current.values.description;

        act(() => {
            result.current.setField('description', 'Creamier.');
        });
        act(() => {
            result.current.checkpoint('fieldBlur');
        });
        await settle();
        act(() => {
            result.current.setField('description', original);
        });
        act(() => {
            result.current.checkpoint('fieldBlur');
        });
        await settle();

        expect(drafts.discard).toHaveBeenCalledWith('rec_1');
        expect(result.current.saveStatus).toEqual({ kind: 'saved' });
        expect(result.current.hasUnsavedChanges).toBe(false);
    });

    it('Save changes on a published recipe with nothing changed sends nothing and stays open', async () => {
        const { result, port, onExit } = mount({ recipe: PUBLISHED });

        let outcome: unknown;
        act(() => {
            outcome = result.current.saveChanges('');
        });
        await settle();

        expect(outcome).toEqual({ kind: 'send' });
        expect(port.submitExclusive).not.toHaveBeenCalled();
        expect(onExit).not.toHaveBeenCalled();
        expect(result.current.state.status).toBe('editing');
    });

    it('a parked update that is not a conflict shows its class, and a Publish behind it does not run', async () => {
        const { result, port } = mount({ recipe: NEVER_PUBLISHED });

        act(() => {
            result.current.setValues({ ...complete(), description: 'Mine.' });
        });
        act(() => {
            result.current.checkpoint('sectionChange');
        });
        await settle();
        const seq = port.lastSeq();
        port.claim(seq);
        act(() => {
            result.current.publish('');
        });
        await settle();
        act(() => {
            port.park(seq, 400);
        });
        await settle();

        expect(result.current.parked).toEqual({ failure: 'terminal', kind: 'update' });
        expect(result.current.state.status).toBe('editing');
        expect(port.submitted).toHaveLength(1);
    });
});

describe('characterization: the rebind command`s other answers', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    const IDS = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'] as const;
    const twoLines = (version: number): RecipeDetail =>
        makeRecipeDetail({
            id: 'rec_1',
            currentVersion: version,
            status: RecipeStatus.DRAFT,
            ingredients: [
                makeIngredientView({ ingredientId: IDS[0], name: 'Olive oil' }),
                makeIngredientView({ ingredientId: IDS[1], name: 'chick' }),
            ],
        });

    async function run(view: ReturnType<typeof mount>, key: IngredientLineKey, send: () => Promise<RecipeDetail>) {
        let outcome: unknown;

        act(() => {
            void view.result.current.lineCommand.run(key, send).then((answer) => {
                outcome = answer;
            });
        });
        await settle();
        await settle();
        await settle();

        return outcome;
    }

    it('exposes the stored lines` keys, and none for a line added this session', () => {
        const view = mount({ recipe: twoLines(3) });

        expect(view.result.current.lineCommand.persistedKeys).toEqual(
            view.result.current.values.ingredients.map((line) => line.key),
        );
    });

    it('a line the server does not store fails without a send', async () => {
        const view = mount({ recipe: twoLines(3) });
        const send = vi.fn(async () => twoLines(4));

        const outcome = await run(view, 'n:fresh' as IngredientLineKey, send);

        expect(outcome).toEqual({ kind: 'failed' });
        expect(send).not.toHaveBeenCalled();
    });

    it('an answer more than one version on is not adopted: the draft and the version stay', async () => {
        const view = mount({ recipe: twoLines(3) });
        const key = view.result.current.values.ingredients[1]!.key;

        const outcome = await run(view, key, async () => ({ ...twoLines(5) }));

        expect(outcome).toEqual({ kind: 'failed' });
        act(() => {
            view.result.current.setField('description', 'After.');
        });
        act(() => {
            view.result.current.checkpoint('sectionChange');
        });
        await settle();
        expect(view.port.submitted.at(-1)).toMatchObject({ payload: { input: { expectedVersion: 3 } } });
    });

    it('a refusal whose sides already agree adopts the server`s version and fails, with no conflict view', async () => {
        const { VersionConflictError } = await import('@kitchensink/recipe-service-client');
        const view = mount({ recipe: twoLines(3) });
        const key = view.result.current.values.ingredients[1]!.key;
        const agreeing = sideAt(7, draftToSnapshot(view.result.current.values, 7));

        const outcome = await run(view, key, async () => {
            throw new VersionConflictError(7, 3, 'conflict', { server: agreeing });
        });

        expect(outcome).toEqual({ kind: 'failed' });
        expect(view.result.current.state.status).toBe('editing');
        act(() => {
            view.result.current.setField('description', 'After.');
        });
        act(() => {
            view.result.current.checkpoint('sectionChange');
        });
        await settle();
        expect(view.port.submitted.at(-1)).toMatchObject({ payload: { input: { expectedVersion: 7 } } });
    });

    it('a command that throws something else fails', async () => {
        const view = mount({ recipe: twoLines(3) });
        const key = view.result.current.values.ingredients[1]!.key;

        expect(await run(view, key, async () => Promise.reject(new Error('offline')))).toEqual({ kind: 'failed' });
    });

    it('a command waiting behind a write that meets a conflict is not sent while the conflict stands', async () => {
        const view = mount({ recipe: twoLines(3) });
        const key = view.result.current.values.ingredients[1]!.key;
        const send = vi.fn(async () => twoLines(4));

        act(() => {
            view.result.current.setField('description', 'Mine.');
        });
        act(() => {
            view.result.current.checkpoint('sectionChange');
        });
        await settle();
        let outcome: unknown;
        act(() => {
            void view.result.current.lineCommand.run(key, send).then((answer) => {
                outcome = answer;
            });
        });
        await settle();
        act(() => {
            view.port.park(view.port.lastSeq(), 409, {
                kind: 'recipeConflict',
                server: sideAt(6, { ...makeRecipeVersion({ versionNumber: 6 }).snapshot, description: 'Theirs.' }),
            });
        });
        await settle();
        await settle();

        // The parked write still holds the lane, so the command waits (unanswered) until a resolution clears it.
        expect(outcome).toBeUndefined();
        expect(send).not.toHaveBeenCalled();
        expect(view.result.current.state.status).toBe('conflict');
    });

    it('a pick while the conflict view is open is answered `conflict` at once', async () => {
        const view = mount({ recipe: twoLines(3) });
        const key = view.result.current.values.ingredients[1]!.key;

        act(() => {
            view.result.current.setField('description', 'Mine.');
        });
        act(() => {
            view.result.current.checkpoint('sectionChange');
        });
        await settle();
        act(() => {
            view.port.park(view.port.lastSeq(), 409, {
                kind: 'recipeConflict',
                server: sideAt(6, { ...makeRecipeVersion({ versionNumber: 6 }).snapshot, description: 'Theirs.' }),
            });
        });
        await settle();

        await expect(view.result.current.lineCommand.run(key, vi.fn())).resolves.toEqual({ kind: 'conflict' });
    });

    it('a checkpoint while a command holds the lane runs once the command answers', async () => {
        const view = mount({ recipe: twoLines(3) });
        const key = view.result.current.values.ingredients[1]!.key;
        let answer: (detail: RecipeDetail) => void = () => undefined;
        const send = vi.fn(
            () =>
                new Promise<RecipeDetail>((resolve) => {
                    answer = resolve;
                }),
        );

        act(() => {
            void view.result.current.lineCommand.run(key, send);
        });
        await settle();
        act(() => {
            view.result.current.setField('description', 'During.');
        });
        act(() => {
            view.result.current.checkpoint('sectionChange');
        });
        await settle();
        expect(view.port.submitExclusive).not.toHaveBeenCalled();

        const answered = twoLines(4);
        await act(async () => {
            answer(answered);
            await Promise.resolve();
        });
        await settle();
        await settle();

        expect(view.port.submitted.at(-1)).toMatchObject({
            intentKind: 'update',
            payload: { input: { description: 'During.', expectedVersion: 4 } },
        });
    });
});

/**
 * code-reviewer High 1: discarding a recipe whose CREATE is parked withdrew the create and then queued a delete naming
 * the create's local ref as its dependency. That create no longer existed, so the delete waited forever and "not
 * synced" never cleared (persisted in AsyncStorage on mobile). The only server state was the withdrawn create, so
 * nothing is deleted — unless the create's outcome is unknown, when it may exist, and the editor says so before the
 * cook confirms rather than guessing.
 */
describe('discard while the create is parked', () => {
    async function parkedCreate(status?: number) {
        const view = mount();

        typeTitle(view.result);
        act(() => {
            view.result.current.checkpoint('sectionChange');
        });
        await settle();
        const seq = view.port.lastSeq();

        act(() => {
            view.port.park(seq, status);
        });
        await settle();

        return { ...view, seq };
    }

    it.each([
        ['refused', 400],
        ['transient', 503],
    ])('a %s create: withdrawn, no delete queued, and nothing is said about a server copy', async (_, status) => {
        const { result, port, onExit, seq } = await parkedCreate(status);

        expect(result.current.discardMayLeaveServerCopy).toBe(false);

        act(() => {
            result.current.discard();
        });
        await settle();
        await settle();

        expect(port.withdrawn).toEqual([seq]);
        expect(port.submit).not.toHaveBeenCalled();
        expect(onExit).toHaveBeenCalledWith({ kind: 'discarded' });
    });

    it('a create whose outcome is unknown: the cook is told it may exist, and no delete is guessed', async () => {
        const { result, port, onExit, seq } = await parkedCreate();

        expect(result.current.discardMayLeaveServerCopy).toBe(true);

        act(() => {
            result.current.discard();
        });
        await settle();
        await settle();

        expect(port.withdrawn).toEqual([seq]);
        expect(port.submit).not.toHaveBeenCalled();
        expect(onExit).toHaveBeenCalledWith({ kind: 'discarded' });
    });

    it('a create parked in an earlier session (read from the outbox): withdrawn, no delete queued', async () => {
        const ref = 'local:recipe:01J0000000000000000000000A';
        const memento: DraftMemento = {
            recipeRef: ref,
            baseVersion: null,
            values: toDraftValues({ ...toRecipeFormValues(NEVER_PUBLISHED), title: 'Soup' }),
            pendingRebinds: [],
            savedAt: '2026-10-08T09:00:00.000Z',
        };
        const view = mount({ memento });
        view.port.failures.push({ seq: 41, entity: 'recipe', intentKind: 'create', localId: ref, status: 503 });
        view.rerender({ seed: { memento } });

        expect(view.result.current.parked).toEqual({ failure: 'transient', kind: 'create' });

        act(() => {
            view.result.current.discard();
        });
        await settle();
        await settle();

        expect(view.port.withdrawn).toEqual([41]);
        expect(view.port.submit).not.toHaveBeenCalled();
    });

    it('a stored draft whose UPDATE is parked: withdrawn, and the recipe is still deleted by its id', async () => {
        const { result, port } = mount({ recipe: NEVER_PUBLISHED });

        expect(result.current.discardMayLeaveServerCopy).toBe(false);
        act(() => {
            result.current.setField('description', 'Mine.');
        });
        act(() => {
            result.current.checkpoint('sectionChange');
        });
        await settle();
        const seq = port.lastSeq();
        act(() => {
            port.park(seq);
        });
        await settle();

        expect(result.current.discardMayLeaveServerCopy).toBe(false);
        act(() => {
            result.current.discard();
        });
        await settle();
        await settle();

        expect(port.withdrawn).toEqual([seq]);
        expect(port.submitted.at(-1)).toEqual({
            entity: 'recipe',
            intentKind: 'delete',
            localId: 'rec_1',
            dependsOn: [],
            payload: { id: 'rec_1' },
        });
    });
});

describe('held re-picks: what the server already holds (code-reviewer Medium 5, staff-architect)', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    const IDS = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'] as const;
    const REBOUND = '00000000-0000-4000-8000-00000000000f';
    const NEWER = '00000000-0000-4000-8000-00000000000e';
    const TARGET = { kind: 'catalogFood', foodId: '00000000-0000-4000-8000-0000000000aa' } as const;
    const NEWER_TARGET = { kind: 'catalogFood', foodId: '00000000-0000-4000-8000-0000000000bb' } as const;
    const published = (version: number, second: string = IDS[1]): RecipeDetail =>
        makeRecipeDetail({
            id: 'rec_1',
            currentVersion: version,
            status: RecipeStatus.PUBLISHED,
            ingredients: [
                makeIngredientView({ ingredientId: IDS[0], name: 'Olive oil' }),
                makeIngredientView({ ingredientId: second, name: 'chick' }),
            ],
        });

    it('a rebind answer does not overwrite a newer pick of the same line held meanwhile, and the newer one is sent next', async () => {
        const view = mount({ recipe: published(3) });
        const key = view.result.current.values.ingredients[1]!.key;
        let answerFirst: (detail: RecipeDetail) => void = () => undefined;
        view.rebindLine
            .mockImplementationOnce(
                () =>
                    new Promise<RecipeDetail>((resolve) => {
                        answerFirst = resolve;
                    }),
            )
            .mockImplementationOnce(async () => published(5, NEWER));

        act(() => {
            view.result.current.lineCommand.hold(
                { lineKey: key, target: TARGET },
                { ingredientId: REBOUND, name: 'Chickpeas', isUserEntered: false },
            );
        });
        act(() => {
            view.result.current.saveChanges('');
        });
        await settle();
        expect(view.rebindLine).toHaveBeenCalledTimes(1);

        act(() => {
            view.result.current.lineCommand.hold(
                { lineKey: key, target: NEWER_TARGET },
                { ingredientId: NEWER, name: 'Garbanzo', isUserEntered: false },
            );
        });
        await act(async () => {
            answerFirst(published(4, REBOUND));
            await Promise.resolve();
        });
        await settle();
        await settle();

        expect(view.rebindLine).toHaveBeenCalledTimes(2);
        expect(view.rebindLine).toHaveBeenLastCalledWith(
            { recipeId: 'rec_1', position: 1, expectedVersion: 4 },
            NEWER_TARGET,
        );
        expect(view.result.current.values.ingredients[1]).toMatchObject({ key, ingredientId: NEWER });
    });

    it('a reload after a rebind that landed but was never recorded sends no second rebind, and saves', async () => {
        // The device draft was built on version 3 and still holds the re-pick; the server is at version 4 because the
        // rebind landed before the editor could record it.
        const base = published(3);
        const values = toRecipeFormValues(base);
        const key = values.ingredients[1]!.key;
        const memento: DraftMemento = {
            recipeRef: 'rec_1',
            baseVersion: 3,
            values: toDraftValues({
                ...values,
                description: 'Smokier.',
                ingredients: values.ingredients.map((line) =>
                    line.key === key
                        ? { ...line, ingredientId: REBOUND, name: 'Chickpeas', isUserEntered: false }
                        : line,
                ),
            }),
            pendingRebinds: [{ lineKey: key, target: TARGET }],
            savedAt: '2026-10-09T11:00:00.000Z',
        };
        const view = mount({ recipe: published(4, REBOUND), memento });

        act(() => {
            view.result.current.saveChanges('');
        });
        await settle();
        await settle();

        expect(view.rebindLine).not.toHaveBeenCalled();
        expect(view.port.submitted).toHaveLength(1);
        expect(view.port.submitted[0]).toMatchObject({
            intentKind: 'update',
            payload: { input: { description: 'Smokier.', expectedVersion: 3 } },
        });
    });

    it('a reload whose only change was that landed rebind reads as saved, with no resume notice', () => {
        const base = published(3);
        const values = toRecipeFormValues(base);
        const key = values.ingredients[1]!.key;
        const memento: DraftMemento = {
            recipeRef: 'rec_1',
            baseVersion: 3,
            values: toDraftValues({
                ...values,
                ingredients: values.ingredients.map((line) =>
                    line.key === key ? { ...line, ingredientId: REBOUND, name: 'chick', isUserEntered: false } : line,
                ),
            }),
            pendingRebinds: [{ lineKey: key, target: TARGET }],
            savedAt: '2026-10-09T11:00:00.000Z',
        };
        const view = mount({ recipe: published(4, REBOUND), memento });

        expect(view.result.current.hasUnsavedChanges).toBe(false);
        expect(view.result.current.resume).toBeUndefined();
    });
});

describe('held re-picks on a line the server no longer stores', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    it('a reload whose held re-pick names a line another device removed sends no rebind and one update, once', async () => {
        const IDS3 = [
            '00000000-0000-4000-8000-000000000001',
            '00000000-0000-4000-8000-000000000002',
            '00000000-0000-4000-8000-000000000003',
        ] as const;
        const REBOUND = '00000000-0000-4000-8000-00000000000f';
        const threeLines = makeRecipeDetail({
            id: 'rec_1',
            currentVersion: 3,
            status: RecipeStatus.PUBLISHED,
            ingredients: IDS3.map((ingredientId) => makeIngredientView({ ingredientId })),
        });
        // Another device removed the third line: the server is at version 4 with two.
        const twoLines = {
            ...threeLines,
            currentVersion: 4,
            ingredients: threeLines.ingredients.slice(0, 2),
        };
        const values = toRecipeFormValues(threeLines);
        const key = values.ingredients[2]!.key;
        const memento: DraftMemento = {
            recipeRef: 'rec_1',
            baseVersion: 3,
            values: toDraftValues({
                ...values,
                ingredients: values.ingredients.map((line) =>
                    line.key === key ? { ...line, ingredientId: REBOUND, isUserEntered: false } : line,
                ),
            }),
            pendingRebinds: [{ lineKey: key, target: { kind: 'name', name: 'chickpeas' } }],
            savedAt: '2026-10-09T11:00:00.000Z',
        };
        const view = mount({ recipe: twoLines, memento });

        act(() => {
            view.result.current.saveChanges('');
        });
        await settle();
        await settle();
        await settle();

        expect(view.rebindLine).not.toHaveBeenCalled();
        expect(view.port.submitted).toHaveLength(1);
        expect(view.port.submitted[0]).toMatchObject({
            intentKind: 'update',
            payload: { input: { expectedVersion: 3 } },
        });
        expect(vi.mocked(view.drafts.save).mock.calls.length).toBeLessThanOrEqual(1);
    });
});
