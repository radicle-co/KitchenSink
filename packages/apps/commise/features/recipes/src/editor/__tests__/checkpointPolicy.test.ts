/**
 * The checkpoint policy — when an editor change becomes a SERVER write (blueprint A3/A4, ADR-0057, ADR-0058).
 *
 * Every trigger writes the device draft; this policy decides only the server write. Its rules, in one table each:
 *
 * - **Unsaved** (no server record yet): the first checkpoint at which the draft floor passes CREATES it (A4).
 * - **Never published**: checkpoints UPDATE it in place — they make no version (ADR-0058), which is what lets the
 *   cadence be this frequent.
 * - **Published**: only Save changes writes; every other change stays on the device (owner ruling D1).
 * - Typing and blur never reach the server, a write the server would refuse (the floor) is never asked for, and a
 *   checkpoint with nothing new to say is not sent.
 */
import { describe, expect, it } from 'vitest';

import {
    DEVICE_SAVE_IDLE_MS,
    SERVER_CHECKPOINT_IDLE_MS,
    lifecycleOf,
    pasteOffered,
    pastedLineKeepsSource,
    serverWriteFor,
    type CheckpointTrigger,
    type RecipeLifecycle,
    type ServerWrite,
} from '../checkpointPolicy.js';

const NONE: ServerWrite = { kind: 'none' };

function decide(
    lifecycle: RecipeLifecycle,
    trigger: CheckpointTrigger,
    over: {
        readonly draftFloorMet?: boolean;
        readonly changedSinceServerWrite?: boolean;
        readonly pastePending?: boolean;
    } = {},
): ServerWrite {
    return serverWriteFor({
        lifecycle,
        trigger,
        draftFloorMet: over.draftFloorMet ?? true,
        changedSinceServerWrite: over.changedSinceServerWrite ?? true,
        pastePending: over.pastePending ?? false,
    });
}

describe('serverWriteFor — a recipe not yet on the server', () => {
    it.each<[CheckpointTrigger, ServerWrite]>([
        ['typingIdle', NONE],
        ['fieldBlur', NONE],
        ['sectionChange', { kind: 'create', publish: false }],
        ['editorExit', { kind: 'create', publish: false }],
        ['appHidden', { kind: 'create', publish: false }],
        ['checkpointIdle', { kind: 'create', publish: false }],
        ['saveChanges', { kind: 'create', publish: false }],
        ['publish', { kind: 'create', publish: true }],
    ])('%s → %o', (trigger, expected) => {
        expect(decide('unsaved', trigger)).toStrictEqual(expected);
    });

    /** ⛔ A4: the server create waits for the draft floor (a title), or the checkpoint would loop on a 400. */
    it.each<CheckpointTrigger>(['sectionChange', 'editorExit', 'appHidden', 'checkpointIdle', 'publish'])(
        '⛔ %s asks for nothing while the draft floor fails',
        (trigger) => {
            expect(decide('unsaved', trigger, { draftFloorMet: false })).toStrictEqual(NONE);
        },
    );
});

describe('serverWriteFor — a draft that was never published', () => {
    it.each<[CheckpointTrigger, ServerWrite]>([
        ['typingIdle', NONE],
        ['fieldBlur', NONE],
        ['sectionChange', { kind: 'update', publish: false }],
        ['editorExit', { kind: 'update', publish: false }],
        ['appHidden', { kind: 'update', publish: false }],
        ['checkpointIdle', { kind: 'update', publish: false }],
        ['saveChanges', { kind: 'update', publish: false }],
        ['publish', { kind: 'update', publish: true }],
    ])('%s → %o', (trigger, expected) => {
        expect(decide('neverPublished', trigger)).toStrictEqual(expected);
    });

    it('does not send a checkpoint with nothing new since the last server write', () => {
        expect(decide('neverPublished', 'checkpointIdle', { changedSinceServerWrite: false })).toStrictEqual(NONE);
    });

    /** Publishing changes the status even when no field moved, so it is always a write. */
    it('publishes even with nothing else changed', () => {
        expect(decide('neverPublished', 'publish', { changedSinceServerWrite: false })).toStrictEqual({
            kind: 'update',
            publish: true,
        });
    });

    it('⛔ asks for nothing while the draft floor fails — a cleared title would be refused', () => {
        expect(decide('neverPublished', 'sectionChange', { draftFloorMet: false })).toStrictEqual(NONE);
    });
});

describe('serverWriteFor — a published recipe (owner ruling D1)', () => {
    /** ⛔ Every save of a published recipe makes a version, so nothing but the cook's own Save changes may write. */
    it.each<CheckpointTrigger>([
        'typingIdle',
        'fieldBlur',
        'sectionChange',
        'editorExit',
        'appHidden',
        'checkpointIdle',
    ])('⛔ %s keeps the change on the device', (trigger) => {
        expect(decide('published', trigger)).toStrictEqual(NONE);
    });

    it('Save changes writes the whole draft once', () => {
        expect(decide('published', 'saveChanges')).toStrictEqual({ kind: 'update', publish: false });
    });

    it('Save changes with nothing changed writes nothing — it would mint an empty version', () => {
        expect(decide('published', 'saveChanges', { changedSinceServerWrite: false })).toStrictEqual(NONE);
    });

    it('a Publish on an already-published recipe is a Save changes', () => {
        expect(decide('published', 'publish')).toStrictEqual({ kind: 'update', publish: false });
    });
});

describe('lifecycleOf', () => {
    const FIRST = '2026-10-01T09:00:00.000Z';

    it.each([
        ['no server record', undefined, 'unsaved'],
        ['a draft', { status: 'draft' } as const, 'neverPublished'],
        ['a published recipe', { status: 'published', firstPublishedAt: FIRST } as const, 'published'],
        /**
         * ⛔ ADR-0058 rule 1: the fact is the FIRST PUBLISH, never `status`. The API takes `PATCH { status: 'draft' }` on a
         * published recipe, and every save of it still makes a version — so its changes wait for Save changes (D1) and
         * it is never offered paste (D10), whatever its status says.
         */
        ['a published recipe set back to draft', { status: 'draft', firstPublishedAt: FIRST } as const, 'published'],
        /** A reader that predates the field: `status = published` implies a first publish (the service's own CHECK). */
        ['a published recipe read without the field', { status: 'published' } as const, 'published'],
    ] as const)('%s → %s', (_label, recipe, expected) => {
        expect(lifecycleOf(recipe)).toBe(expected);
    });
});

describe('pasteOffered — paste is offered until the first publish (owner D10, 2026-10-09)', () => {
    it.each<[RecipeLifecycle, boolean]>([
        ['unsaved', true],
        ['neverPublished', true],
        ['published', false],
    ])('%s → %s', (lifecycle, expected) => {
        expect(pasteOffered(lifecycle)).toBe(expected);
    });
});

describe('pastedLineKeepsSource — a pasted line carries its source only into the create (blueprint A5)', () => {
    it.each<[RecipeLifecycle, boolean, boolean, string]>([
        ['unsaved', false, true, 'no create sent yet: the create will carry it'],
        ['unsaved', true, false, '⛔ the create is already submitted: the line lands in an update, which strips it'],
        ['neverPublished', false, false, 'stored: a PATCH cannot carry it'],
        ['published', false, false, 'stored: a PATCH cannot carry it'],
    ])('%s, create submitted %s → %s (%s)', (lifecycle, createSubmitted, expected) => {
        expect(pastedLineKeepsSource({ lifecycle, createSubmitted })).toBe(expected);
    });
});

/**
 * A paste still joining holds the CREATE (finding 8): a line that joined after the create was sent would keep its source
 * in the draft and lose it in the next update. Publish is held by the bar; the other checkpoints are held here. Leaving
 * the editor is not held: the paste ends with the editor, and a titled recipe must still be created on the way out.
 */
describe('serverWriteFor — a paste still joining', () => {
    it.each<[CheckpointTrigger, ServerWrite]>([
        ['sectionChange', NONE],
        ['appHidden', NONE],
        ['checkpointIdle', NONE],
        ['publish', NONE],
        ['editorExit', { kind: 'create', publish: false }],
    ])('an unsaved recipe: %s → %o', (trigger, expected) => {
        expect(decide('unsaved', trigger, { pastePending: true })).toStrictEqual(expected);
    });

    it('a stored draft keeps checkpointing: its pasted lines are stored without their source either way', () => {
        expect(decide('neverPublished', 'sectionChange', { pastePending: true })).toStrictEqual({
            kind: 'update',
            publish: false,
        });
    });
});

describe('the cadence', () => {
    /** The device save is fast and the server checkpoint deliberately slower: one is cheap, the other a request. */
    it('saves to the device well before it checkpoints to the server', () => {
        expect(DEVICE_SAVE_IDLE_MS).toBeLessThan(SERVER_CHECKPOINT_IDLE_MS);
    });
});
