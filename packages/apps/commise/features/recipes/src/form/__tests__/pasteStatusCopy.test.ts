/**
 * The words and marks of a paste's statuses (`form/pasteStatusCopy.ts`, UX spec in plan 2026-10-15-011). Tables over
 * every row state, every block status and every milestone, so a state that lost its words, its action or its mark — or
 * a stalled line that took the alert mark, which would tell the cook it failed — is a red row.
 */
import { describe, expect, it } from 'vitest';

import { recipeFormMessages } from '../messages.js';
import { pasteAnnouncementTextOf, pasteProgressViewOf, pasteRowViewOf } from '../pasteStatusCopy.js';
import type { PasteProgress, PasteRowState } from '../props.js';

const m = recipeFormMessages.en;

describe('pasteRowViewOf', () => {
    it.each<[PasteRowState, string, string, string, string | undefined]>([
        ['queued', 'Waiting to be read', 'clock', 'inkMuted', undefined],
        ['reading', 'Reading…', 'refreshCw', 'inkMuted', undefined],
        ['retrying', 'Reading again…', 'refreshCw', 'inkMuted', undefined],
        ['delayed', 'Waiting to try again', 'clock', 'inkMuted', undefined],
        ['stalled', 'Taking longer than usual', 'clock', 'inkMuted', 'addAsWritten'],
        ['retryable', 'Couldn’t read this line', 'triangleAlert', 'attention', 'addAsWritten'],
        ['ready', 'Read. Joins in paste order.', 'check', 'inkMuted', undefined],
        ['joining', 'Looking it up…', 'refreshCw', 'inkMuted', undefined],
        ['waiting', 'Reads when you’re back online', 'clock', 'inkMuted', undefined],
        ['lookupFailed', 'Couldn’t look up', 'triangleAlert', 'attention', 'retryLookup'],
    ])('%s says “%s”, marked %s/%s, with action %s', (state, stateText, icon, tone, action) => {
        expect(pasteRowViewOf(state, m)).toEqual({ stateText, icon, tone, action });
    });
});

describe('pasteProgressViewOf', () => {
    const progress = (over: Partial<PasteProgress>): PasteProgress => ({
        done: 2,
        count: 5,
        status: { kind: 'step', step: 'reading', position: 3 },
        retryCount: 0,
        restCount: 0,
        ...over,
    });

    it('counts the lines in the recipe against the paste, with the plural the count asks for', () => {
        expect(pasteProgressViewOf(progress({}), m, 'en').title).toBe('Added 2 of 5 lines');
        expect(pasteProgressViewOf(progress({ done: 0, count: 1 }), m, 'en').title).toBe('Added 0 of 1 line');
    });

    it.each<[PasteProgress['status'], string, string | undefined, string]>([
        [{ kind: 'needsYou', count: 1 }, '1 line needs you', undefined, 'attention'],
        [{ kind: 'needsYou', count: 3 }, '3 lines need you', undefined, 'attention'],
        [{ kind: 'offline' }, 'Paused until you’re back online', undefined, 'inkMuted'],
        [
            { kind: 'stalled' },
            'Taking longer than usual',
            'You can keep waiting, or add the lines as written.',
            'inkMuted',
        ],
        [{ kind: 'step', step: 'reading', position: 3 }, 'Reading line 3', undefined, 'inkMuted'],
        [{ kind: 'step', step: 'retrying', position: 3 }, 'Reading line 3 again', undefined, 'inkMuted'],
        [{ kind: 'step', step: 'delayed', position: 3 }, 'Waiting to try line 3 again', undefined, 'inkMuted'],
        [{ kind: 'step', step: 'queued', position: 3 }, 'Waiting to read line 3', undefined, 'inkMuted'],
        [{ kind: 'step', step: 'joining', position: 3 }, 'Looking up line 3', undefined, 'inkMuted'],
    ])('%o says “%s”', (status, text, hint, tone) => {
        expect(pasteProgressViewOf(progress({ status }), m, 'en')).toMatchObject({ status: text, hint, tone });
    });

    it('offers Try again once any line is retryable, named for how many it covers', () => {
        expect(pasteProgressViewOf(progress({}), m, 'en').retryLabel).toBeUndefined();
        expect(pasteProgressViewOf(progress({ retryCount: 2 }), m, 'en').retryLabel).toBe('Try again for 2 lines');
    });

    it('offers Add the rest as written only for two lines or more: one line has its own button', () => {
        expect(pasteProgressViewOf(progress({ restCount: 1 }), m, 'en').addRestLabel).toBeUndefined();
        expect(pasteProgressViewOf(progress({ restCount: 2 }), m, 'en').addRestLabel).toBe(
            'Add the rest as written: 2 lines',
        );
    });
});

describe('pasteAnnouncementTextOf', () => {
    it.each<[Parameters<typeof pasteAnnouncementTextOf>[0], string]>([
        [{ milestone: 'started', count: 4 }, 'Reading 4 pasted lines.'],
        [{ milestone: 'needsYou', count: 1 }, '1 line needs you'],
        [
            { milestone: 'stalled', count: 4 },
            'Taking longer than usual. You can keep waiting, or add the lines as written.',
        ],
        [{ milestone: 'resumed', count: 4 }, 'Reading again.'],
        [{ milestone: 'offline', count: 4 }, 'Paused until you’re back online'],
    ])('%o says “%s”', (announcement, text) => {
        expect(pasteAnnouncementTextOf(announcement, m, 'en')).toBe(text);
    });
});
