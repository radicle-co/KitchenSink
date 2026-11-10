/**
 * The publication-request policy (ADR-0029 §5 and §7): when an edit applies and when it is proposed, when a request
 * may be opened, and when staff may approve one. Pure, so each rule is a truth-table row.
 */
import { describe, expect, it } from 'vitest';

import { decideApproval, decideEdit, decideRequest, publicationStateOf } from '../publicationRequestPolicy.js';

describe('decideEdit', () => {
    it('applies a private edit at once and opens nothing when nothing was pending', () => {
        expect(decideEdit({ visibility: 'private', hadPending: false })).toStrictEqual({
            apply: true,
            openRequest: false,
        });
    });

    it('moves a pending request to the new version when a private food is edited', () => {
        expect(decideEdit({ visibility: 'private', hadPending: true })).toStrictEqual({
            apply: true,
            openRequest: true,
        });
    });

    it.each([false, true])('only proposes a promoted edit, and always asks staff (pending=%s)', (hadPending) => {
        expect(decideEdit({ visibility: 'promoted', hadPending })).toStrictEqual({ apply: false, openRequest: true });
    });
});

describe('decideRequest', () => {
    const base = {
        visibility: 'private' as const,
        status: 'RESOLVED',
        newestVersion: 3,
        pendingVersion: undefined,
        declinedVersions: [] as readonly number[],
    };

    it('opens a request for a private food', () => {
        expect(decideRequest(base)).toStrictEqual({ kind: 'open' });
    });

    it('answers the request already pending instead of opening a second', () => {
        expect(decideRequest({ ...base, pendingVersion: 3 })).toStrictEqual({ kind: 'existing' });
    });

    it.each(['WITHDRAWN', 'DELETING'])('refuses a %s food', (status) => {
        expect(decideRequest({ ...base, status })).toStrictEqual({ kind: 'refused', reason: 'withdrawn' });
    });

    it.each(['promoted', 'public'] as const)('refuses a %s food: it is not private', (visibility) => {
        expect(decideRequest({ ...base, visibility })).toStrictEqual({ kind: 'refused', reason: 'notPrivate' });
    });

    it('refuses the version staff already declined, and allows the next one', () => {
        expect(decideRequest({ ...base, declinedVersions: [3] })).toStrictEqual({
            kind: 'refused',
            reason: 'declined',
        });
        expect(decideRequest({ ...base, declinedVersions: [2] })).toStrictEqual({ kind: 'open' });
    });

    it('reports withdrawn before not-private so a withdrawn promoted food gives one stable reason', () => {
        expect(decideRequest({ ...base, visibility: 'promoted', status: 'WITHDRAWN' })).toStrictEqual({
            kind: 'refused',
            reason: 'withdrawn',
        });
    });
});

describe('decideApproval', () => {
    const base = { requestStatus: 'pending', requestVersion: 4, newestVersion: 4, foodStatus: 'RESOLVED' };

    it('approves the newest version of a live food', () => {
        expect(decideApproval(base)).toStrictEqual({ kind: 'approve' });
    });

    it.each(['approved', 'declined', 'closed'])('refuses a %s request', (requestStatus) => {
        expect(decideApproval({ ...base, requestStatus })).toStrictEqual({ kind: 'refused', reason: 'closed' });
    });

    it('refuses a version that is no longer the newest', () => {
        expect(decideApproval({ ...base, newestVersion: 5 })).toStrictEqual({ kind: 'refused', reason: 'notNewest' });
    });

    it.each(['WITHDRAWN', 'DELETING'])('refuses a %s food', (foodStatus) => {
        expect(decideApproval({ ...base, foodStatus })).toStrictEqual({ kind: 'refused', reason: 'withdrawn' });
    });
});

describe('publicationStateOf — the one word the author reads about a food', () => {
    const food = { visibility: 'private' as const, status: 'RESOLVED', newestVersion: 3 };
    const request = (status: string, versionNumber = 3) => ({ status, versionNumber });

    it.each([
        ['private, never asked', food, undefined, 'private'],
        ['private, asked', food, request('pending'), 'asked'],
        ['private, newest version declined', food, request('declined'), 'notApproved'],
        ['private, declined version since edited', food, request('declined', 2), 'private'],
        ['private, an approved request is history', food, request('approved'), 'private'],
        ['private, a closed request is nobody’s answer', food, request('closed'), 'private'],
        ['public, no edit waiting', { ...food, visibility: 'promoted' as const }, request('approved'), 'public'],
        ['public, edit waiting', { ...food, visibility: 'promoted' as const }, request('pending'), 'editWaiting'],
        ['public, edit declined', { ...food, visibility: 'promoted' as const }, request('declined'), 'editNotApproved'],
        ['a catalog food', { ...food, visibility: 'public' as const }, undefined, 'public'],
        ['withdrawn beats everything', { ...food, status: 'WITHDRAWN' }, request('pending'), 'withdrawn'],
        ['mid-erasure reads as withdrawn', { ...food, status: 'DELETING' }, undefined, 'withdrawn'],
    ])('%s → %s', (_label, facts, newest, expected) => {
        expect(publicationStateOf({ ...facts, newestRequest: newest })).toBe(expected);
    });
});
