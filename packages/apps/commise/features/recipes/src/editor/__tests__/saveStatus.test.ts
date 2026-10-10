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

import { defaultRecipeFormValues } from '../../form/values.js';
import { closingTabLosesWork, saveStatusOf, type SaveStatus, type SaveStatusInput } from '../saveStatus.js';

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

/**
 * When closing the tab loses work (finding 1 of the 2026-10-09 review). The web keeps its outbox journal and its draft in
 * the tab's session storage (D7), so whatever the server does not hold yet ends with the tab — for EVERY recipe, not
 * only a published one awaiting Save changes. The one state that loses nothing besides `saved` is a new recipe nobody
 * typed in; a typed draft whose device copy is not written yet (`unsaved`, the first second) does.
 */
describe('closingTabLosesWork', () => {
    const blank = defaultRecipeFormValues();
    const typed = { ...blank, title: 'Soup' };
    const ALL: readonly SaveStatus[] = [
        { kind: 'saved' },
        { kind: 'syncing' },
        { kind: 'syncFailed', failure: 'unknown' },
        { kind: 'keptOnDevice', store: 'tabSession', awaiting: 'checkpoint' },
        { kind: 'keptOnDevice', store: 'tabSession', awaiting: 'saveChanges' },
        { kind: 'savingOnDevice' },
        { kind: 'deviceFailed' },
        { kind: 'unsaved' },
    ];

    it.each(ALL.map((status) => [status, status.kind !== 'saved'] as const))(
        'a typed never-published draft in a tab, %o → %s',
        (status, expected) => {
            expect(
                closingTabLosesWork({ keep: 'tabSession', status, lifecycle: 'neverPublished', values: typed }),
            ).toBe(expected);
        },
    );

    it.each<[string, Parameters<typeof closingTabLosesWork>[0], boolean]>([
        [
            'a new recipe nobody typed in loses nothing',
            { keep: 'tabSession', status: { kind: 'unsaved' }, lifecycle: 'unsaved', values: blank },
            false,
        ],
        [
            '⛔ a new recipe typed in the last second, before its device copy is written, loses it',
            { keep: 'tabSession', status: { kind: 'unsaved' }, lifecycle: 'unsaved', values: typed },
            true,
        ],
        [
            'a new recipe kept in the tab, waiting for its checkpoint',
            {
                keep: 'tabSession',
                status: { kind: 'keptOnDevice', store: 'tabSession', awaiting: 'checkpoint' },
                lifecycle: 'unsaved',
                values: typed,
            },
            true,
        ],
        [
            'a published recipe`s changes kept in the tab',
            {
                keep: 'tabSession',
                status: { kind: 'keptOnDevice', store: 'tabSession', awaiting: 'saveChanges' },
                lifecycle: 'published',
                values: typed,
            },
            true,
        ],
        [
            'on disk (mobile) nothing ends with a tab',
            { keep: 'disk', status: { kind: 'syncing' }, lifecycle: 'neverPublished', values: typed },
            false,
        ],
    ])('%s', (_label, input, expected) => {
        expect(closingTabLosesWork(input)).toBe(expected);
    });
});
