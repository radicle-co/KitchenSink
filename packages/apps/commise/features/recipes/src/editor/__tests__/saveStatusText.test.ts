/**
 * The header's save status in words (build spec §7.3, with `staff-ux-engineer`'s slice 7 copy): the words say where the
 * draft actually is — "on this device" on disk (mobile), "in this tab" in the tab's session storage (web, owner D7) —
 * and which statuses are announced.
 */
import { describe, expect, it } from 'vitest';

import { editorMessages } from '../messages.js';
import type { SaveStatus } from '../saveStatus.js';
import { saveStatusText } from '../saveStatusText.js';

const m = editorMessages.en;

describe('saveStatusText', () => {
    it.each<[SaveStatus, string | undefined, boolean]>([
        [{ kind: 'unsaved' }, undefined, false],
        [{ kind: 'savingOnDevice' }, 'Saving…', false],
        [{ kind: 'syncing' }, 'Saved on this device', false],
        [{ kind: 'saved' }, 'Saved', false],
        [{ kind: 'keptOnDevice', store: 'disk', awaiting: 'checkpoint' }, 'Saved on this device', false],
        [{ kind: 'keptOnDevice', store: 'disk', awaiting: 'saveChanges' }, 'Changes saved on this device', false],
        // UX: on web a draft's device copy lasts only until the next checkpoint, so it reads as saving, not as kept.
        [{ kind: 'keptOnDevice', store: 'tabSession', awaiting: 'checkpoint' }, 'Saving…', false],
        [{ kind: 'keptOnDevice', store: 'tabSession', awaiting: 'saveChanges' }, 'Changes kept in this tab', false],
        [{ kind: 'syncFailed', failure: 'transient' }, "Couldn't save. Retrying.", true],
        [{ kind: 'syncFailed', failure: 'conflict' }, 'Not saved. Choose a version.', false],
        [{ kind: 'syncFailed', failure: 'terminal' }, "Couldn't save", true],
        [{ kind: 'syncFailed', failure: 'unknown' }, "Couldn't confirm your save", true],
    ])('%j → %j (announced: %s)', (status, text, announced) => {
        expect(saveStatusText(status, 'disk', m)).toEqual({ text, announced });
    });

    it('a failed device write names where it failed', () => {
        expect(saveStatusText({ kind: 'deviceFailed' }, 'disk', m)).toEqual({
            text: "Couldn't save on this device",
            announced: true,
        });
        expect(saveStatusText({ kind: 'deviceFailed' }, 'tabSession', m)).toEqual({
            text: "Couldn't save in this tab",
            announced: true,
        });
    });

    it('a write queued to the server reads as kept where the draft is: on this device, or in this tab', () => {
        expect(saveStatusText({ kind: 'syncing' }, 'disk', m).text).toBe('Saved on this device');
        expect(saveStatusText({ kind: 'syncing' }, 'tabSession', m).text).toBe('Saved in this tab');
    });
});
