/**
 * The food edit form's pure half (private foods spec section 6): what it starts from, which notice it carries, whether
 * anything changed, and what is said after the answer. The prefill rule is the one that loses a cook's work if wrong: an edit
 * waiting for review is edited, never the public version under it.
 */
import { describe, expect, it } from 'vitest';

import { makeFood, makeOwnState, makeRequest } from '../__fixtures__/foodPageFixtures.js';
import { editDraftOf, editNoticeOf, editOutcomeOf, isEditUnchanged } from '../foodEditForm.js';

const WAITING = makeRequest({ status: 'pending', declineReason: null });

describe('editDraftOf', () => {
    it('starts from the food’s own figures, as text', () => {
        expect(editDraftOf(makeOwnState('private', { request: undefined }))).toEqual({
            name: 'Oat milk',
            calories: '120',
            proteinG: '3',
            carbsG: '16',
            fatG: '5',
        });
    });

    it('⛔ a waiting edit is edited from the waiting version, never the public one under it', () => {
        expect(editDraftOf(makeOwnState('editWaiting', { request: WAITING }))).toMatchObject({ calories: '135' });
    });

    it.each(['notApproved', 'editNotApproved'] as const)('%s starts from the declined version', (kind) => {
        expect(editDraftOf(makeOwnState(kind))).toMatchObject({ calories: '135' });
    });

    it('a public food with no request read yet starts from the public figures', () => {
        expect(editDraftOf(makeOwnState('public', { request: undefined }))).toMatchObject({ calories: '120' });
    });
});

describe('editNoticeOf', () => {
    it.each([
        ['private', null],
        ['notApproved', null],
        ['asked', 'askReplaced'],
        ['public', 'review'],
        ['editNotApproved', 'review'],
        ['editWaiting', 'replacesWaiting'],
    ] as const)('%s carries %s', (kind, notice) => {
        expect(editNoticeOf(kind)).toBe(notice);
    });
});

describe('isEditUnchanged', () => {
    it('is true for the starting draft and false after a change', () => {
        const start = editDraftOf(makeOwnState('public', { request: undefined }));

        expect(isEditUnchanged(start, start)).toBe(true);
        expect(isEditUnchanged({ ...start, fatG: '6' }, start)).toBe(false);
    });

    it('ignores trailing whitespace in the name', () => {
        const start = editDraftOf(makeOwnState('public', { request: undefined }));

        expect(isEditUnchanged({ ...start, name: 'Oat milk ' }, start)).toBe(true);
    });
});

describe('editOutcomeOf', () => {
    it('a private food saved at once says it saved', () => {
        expect(editOutcomeOf('private', { kind: 'applied', food: makeFood() })).toBe('saved');
    });

    it('a private food with an open ask says the ask was sent again as an edit', () => {
        expect(editOutcomeOf('asked', { kind: 'applied', food: makeFood() })).toBe('askResent');
    });

    it('⛔ a 202 editPending says sent for review, not saved', () => {
        expect(editOutcomeOf('public', { kind: 'editPending', versionNumber: 3 })).toBe('sent');
    });
});
