/**
 * The save status — the one fact the editor's status line shows, derived from the device draft, the outbox and the
 * server (blueprint Part C, slice 7).
 *
 * The precedence is the contract, and each row below is a case where a weaker rule shows the wrong thing:
 *
 * 1. a parked server write wins over everything — the cook has to act, and the draft is still kept;
 * 2. a server that holds the current draft is "saved", whatever the device did;
 * 3. a queued write is "syncing";
 * 4. otherwise the device draft speaks: failed, writing, written (and what it waits for), or nothing yet.
 *
 * The copy is not here. The status carries WHERE the draft is kept (`disk` on mobile, `tabSession` on web,
 * owner ruling D7), because "saved on this device" is true on one and false on the other.
 */
import { describe, expect, it } from 'vitest';

import { saveStatusOf, type SaveStatus, type SaveStatusInput } from '../saveStatus.js';

const BASE: SaveStatusInput = {
    lifecycle: 'neverPublished',
    durableDevice: 'disk',
    memento: 'written',
    outbox: { kind: 'none' },
    serverCurrent: false,
};

describe('saveStatusOf', () => {
    it.each<[string, Partial<SaveStatusInput>, SaveStatus]>([
        [
            '⛔ a parked write wins, even over a current server copy',
            { outbox: { kind: 'parked', failure: 'conflict' }, serverCurrent: true },
            { kind: 'syncFailed', failure: 'conflict' },
        ],
        ['the server holds the current draft', { serverCurrent: true, memento: 'failed' }, { kind: 'saved' }],
        ['a write is queued', { outbox: { kind: 'pending' } }, { kind: 'syncing' }],
        [
            '⛔ a queued write outranks a failed device save',
            { outbox: { kind: 'pending' }, memento: 'failed' },
            {
                kind: 'syncing',
            },
        ],
        [
            '⛔ the device save failed and nothing else holds the change',
            { memento: 'failed' },
            { kind: 'deviceFailed' },
        ],
        ['the device save is in progress', { memento: 'writing' }, { kind: 'savingOnDevice' }],
        [
            'a never-published draft waits for its next checkpoint',
            { memento: 'written' },
            { kind: 'keptOnDevice', store: 'disk', awaiting: 'checkpoint' },
        ],
        [
            '⛔ a published recipe waits for Save changes',
            { lifecycle: 'published', memento: 'written' },
            { kind: 'keptOnDevice', store: 'disk', awaiting: 'saveChanges' },
        ],
        [
            '⛔ on web the draft is kept for this tab only',
            { durableDevice: 'tabSession', memento: 'written' },
            { kind: 'keptOnDevice', store: 'tabSession', awaiting: 'checkpoint' },
        ],
        ['a change written nowhere yet', { memento: 'none' }, { kind: 'unsaved' }],
    ])('%s', (_label, over, expected) => {
        expect(saveStatusOf({ ...BASE, ...over })).toStrictEqual(expected);
    });

    it('an unsaved recipe kept on the device waits for its first checkpoint', () => {
        expect(saveStatusOf({ ...BASE, lifecycle: 'unsaved' })).toStrictEqual({
            kind: 'keptOnDevice',
            store: 'disk',
            awaiting: 'checkpoint',
        });
    });
});
