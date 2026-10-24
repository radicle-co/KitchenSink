/** The editor's projections (`editorView.ts`): what its containers read, from the core, the lane and the outbox. */
import { RecipeStatus } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { makeRecipeDetail } from '../../__fixtures__/index.js';
import { defaultRecipeFormValues } from '../../form/values.js';
import { seedEditorCore } from '../editorCore.js';
import {
    earlierParkedOf,
    editorStatusOf,
    editorViewOf,
    liveRecipeOf,
    outboxSlotOf,
    outstandingOf,
    parkedOf,
    type ParkedRecord,
} from '../editorView.js';
import type { OutstandingWrite } from '../writeLane.js';

const record = (over: Partial<ParkedRecord> = {}): ParkedRecord => ({
    seq: 41,
    entity: 'recipe',
    intentKind: 'update',
    localId: 'rec_1',
    status: 503,
    ...over,
});
const write = (over: Partial<OutstandingWrite> = {}): OutstandingWrite => ({
    seq: 7,
    kind: 'update',
    sent: defaultRecipeFormValues(),
    finishing: false,
    parked: false,
    ...over,
});
const server = seedEditorCore({ recipe: makeRecipeDetail({ id: 'rec_1', currentVersion: 3 }) }).core.server;

describe('liveRecipeOf', () => {
    it('reads a newer read of the SAME recipe, and never an older one or another recipe', () => {
        const newer = makeRecipeDetail({ id: 'rec_1', currentVersion: 5, status: RecipeStatus.PUBLISHED });

        expect(liveRecipeOf(server, newer)).toBe(newer);
        expect(liveRecipeOf(server, makeRecipeDetail({ id: 'rec_1', currentVersion: 2 }))?.currentVersion).toBe(3);
        expect(liveRecipeOf(server, makeRecipeDetail({ id: 'rec_2', currentVersion: 9 }))?.id).toBe('rec_1');
        expect(liveRecipeOf(seedEditorCore({}).core.server, newer)).toBeUndefined();
    });
});

describe('earlierParkedOf', () => {
    it('finds this recipe`s parked record while the lane holds nothing', () => {
        expect(earlierParkedOf({ failures: [record({ localId: 'rec_2' }), record()], lane: {}, ref: 'rec_1' })).toEqual(
            record(),
        );
    });

    it('ignores a record the caller has just withdrawn, while the outbox still lists it', () => {
        expect(earlierParkedOf({ failures: [record()], lane: {}, ref: 'rec_1', withdrawn: 41 })).toBeUndefined();
    });

    it('stands aside while the lane has its own write, and has nothing without a ref', () => {
        expect(earlierParkedOf({ failures: [record()], lane: { outstanding: write() }, ref: 'rec_1' })).toBeUndefined();
        expect(earlierParkedOf({ failures: [record()], lane: {}, ref: undefined })).toBeUndefined();
    });
});

describe('outstandingOf, parkedOf and outboxSlotOf', () => {
    it('an earlier parked record stands in the lane as a parked, non-finishing write of its kind', () => {
        const draft = defaultRecipeFormValues();

        expect(outstandingOf({}, record({ intentKind: 'create' }), draft)).toEqual({
            seq: 41,
            kind: 'create',
            sent: draft,
            finishing: false,
            parked: true,
        });
        expect(outstandingOf({ outstanding: write() }, record(), draft)).toEqual(write());
    });

    it('a parked write reads its class from the outbox, unknown when the outbox no longer lists it', () => {
        expect(parkedOf(write({ parked: true, seq: 41 }), [record()], false)).toEqual({
            failure: 'transient',
            kind: 'update',
        });
        expect(parkedOf(write({ parked: true }), [], false)).toEqual({ failure: 'unknown', kind: 'update' });
    });

    it('a stopped drain reads as a transient update; nothing parked reads as nothing', () => {
        expect(parkedOf(undefined, [], true)).toEqual({ failure: 'transient', kind: 'update' });
        expect(parkedOf(write(), [], false)).toBeUndefined();
    });

    it('the outbox slot: parked, pending, or none', () => {
        expect(outboxSlotOf({ failure: 'unknown', kind: 'create' }, write())).toEqual({
            kind: 'parked',
            failure: 'unknown',
        });
        expect(outboxSlotOf(undefined, write())).toEqual({ kind: 'pending' });
        expect(outboxSlotOf(undefined, undefined)).toEqual({ kind: 'none' });
    });
});

describe('editorStatusOf', () => {
    const base = { done: false, conflictOpen: false, outstanding: undefined, deferredFinishing: false };

    it.each([
        ['done wins over everything', { ...base, done: true, conflictOpen: true }, 'done'],
        ['an open conflict', { ...base, conflictOpen: true }, 'conflict'],
        ['a finishing write on the wire', { ...base, outstanding: write({ finishing: true }) }, 'finishing'],
        ['a finish deferred behind a write', { ...base, outstanding: write(), deferredFinishing: true }, 'finishing'],
        [
            'a finishing write that parked: the cook decides',
            { ...base, outstanding: write({ finishing: true, parked: true }) },
            'editing',
        ],
        [
            'a deferred finish behind a parked write',
            { ...base, outstanding: write({ parked: true }), deferredFinishing: true },
            'editing',
        ],
        ['nothing in flight', base, 'editing'],
    ] as const)('%s', (_, input, expected) => {
        expect(editorStatusOf(input)).toBe(expected);
    });
});

describe('editorViewOf', () => {
    it('a stored draft equal to the server with nothing in flight reads saved and unchanged', () => {
        const { core } = seedEditorCore({
            recipe: makeRecipeDetail({ id: 'rec_1', currentVersion: 3, status: RecipeStatus.DRAFT }),
        });
        const view = editorViewOf({
            core,
            lane: {},
            failures: [],
            seedRecipe: undefined,
            keep: 'disk',
            memento: 'none',
        });

        expect(view).toMatchObject({
            lifecycle: 'neverPublished',
            serverId: 'rec_1',
            changedFromServer: false,
            saveStatus: { kind: 'saved' },
            status: 'editing',
        });
    });

    it('an earlier session`s parked create is what a Discard would warn of when its outcome is unknown', () => {
        const { core } = seedEditorCore({
            memento: {
                recipeRef: 'local:recipe:a',
                baseVersion: null,
                values: { ...defaultRecipeFormValues(), title: 'Soup' },
                pendingRebinds: [],
                savedAt: '2026-10-09T11:00:00.000Z',
            },
        });
        const failures = [record({ intentKind: 'create', localId: 'local:recipe:a', status: undefined })];
        const view = editorViewOf({
            core,
            lane: {},
            failures,
            seedRecipe: undefined,
            keep: 'disk',
            memento: 'written',
        });

        expect(view.parked).toEqual({ failure: 'unknown', kind: 'create' });
        expect(view.discard).toMatchObject({ withdraw: 41, remove: undefined, mayLeaveServerCopy: true });
    });
});
