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
import type { DraftMemento, DraftStore } from '../../editor/draftStore.js';
import type { IngredientLineKey } from '../../form/lineKey.js';
import { toDraftValues } from '../../editor/draftStore.js';
import { toRecipeFormValues } from '../../form/wire.js';
import { draftToSnapshot } from '../../versions/merge.js';
import type { RebindLineSend } from '../lineCommit.js';
import {
    useRecipeEditor,
    type EditorExit,
    type EditorSeed,
    type EditorWritePort,
    type UseRecipeEditorResult,
} from '../useRecipeEditor.js';

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

function mount(seed: EditorSeed = {}) {
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
                port: port as unknown as EditorWritePort,
                drafts,
                keep: 'disk',
                onExit,
                onRecipeRef,
                rebindLine,
                pastePending: props.pastePending ?? false,
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
