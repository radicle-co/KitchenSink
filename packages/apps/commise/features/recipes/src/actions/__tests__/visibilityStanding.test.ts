/**
 * The recipe page's visibility slot, with the STANDING reason line (board P6, plan makePublicRefusalNotice U2, KTD-3).
 * Written before the slot's contract changed: `visibilityNoticeOf` returns a tagged result, a MOMENT (something just
 * happened and needs action) or a STANDING line (why a private recipe stays private), and takes the reason from
 * `publicRefusalOf` instead of a `held` flag.
 *
 * The slot's order, top wins: nothing for a non-owner; a server refusal of a Private (while public); the page's own
 * failed write; the confirmed finish claim; then, while the recipe is not public, the standing reason's line (E5: a
 * moment line needs action now, so it comes first and the standing line returns once it clears).
 */
import { describe, expect, it } from 'vitest';

import { PUBLIC_REFUSALS, publicRefusalLineOf, type PublicRefusal } from '../publicRefusal.js';
import { recipeActionMessages } from '../messages.js';
import { visibilityNoticeOf, type VisibilityNoticeInput } from '../visibilityNotice.js';

const copy = { ...recipeActionMessages.en.visibility, publicRefusal: recipeActionMessages.en.publicRefusal };
const REASONS = PUBLIC_REFUSALS.filter((reason): reason is Exclude<PublicRefusal, 'none'> => reason !== 'none');

const base: VisibilityNoticeInput = {
    viewerIsOwner: true,
    isPublic: false,
    serverRefusal: undefined,
    finishRefused: false,
    knownRefusal: undefined,
    writeFailed: false,
    slotLimit: 50,
    standing: 'none',
};
const noticeOf = (overrides: Partial<VisibilityNoticeInput>): ReturnType<typeof visibilityNoticeOf> =>
    visibilityNoticeOf({ ...base, ...overrides }, copy);

describe('visibilityNoticeOf: the standing reason', () => {
    it.each(REASONS)('says the %s line, as a standing line, to the owner of a private recipe', (standing) => {
        expect(noticeOf({ standing })).toEqual({
            kind: 'standing',
            reason: standing,
            text: publicRefusalLineOf(standing, copy.publicRefusal),
        });
    });

    it('says nothing when nothing stops Public (I wrote this)', () => {
        expect(noticeOf({ standing: 'none' })).toBeUndefined();
    });

    it.each(REASONS)('says nothing of %s to a viewer who is not the owner', (standing) => {
        expect(noticeOf({ standing, viewerIsOwner: false })).toBeUndefined();
    });

    it.each(REASONS)('says nothing of %s to the owner of a public recipe', (standing) => {
        expect(noticeOf({ standing, isPublic: true })).toBeUndefined();
    });
});

describe('visibilityNoticeOf: a moment line comes before the standing line (E5)', () => {
    it('says the generic failure of the page’s own write, as a moment, over a standing reason', () => {
        expect(noticeOf({ standing: 'policy.webPage', writeFailed: true })).toEqual({
            kind: 'moment',
            text: copy.error,
        });
    });

    it('brings the standing line back once the failure clears', () => {
        expect(noticeOf({ standing: 'policy.webPage', writeFailed: false })).toMatchObject({
            kind: 'standing',
            reason: 'policy.webPage',
        });
    });

    // Staff review of 65ad26cbe: base returned nothing for a server refusal on a recipe that is no longer public. Now the
    // refusal speaks only while public, and what follows is the rest of the order: a failed write, else the standing line.
    it('a stale server refusal on a private recipe: a failed write is the error moment, else the standing line', () => {
        const stale = { standing: 'policy.webPage', isPublic: false, serverRefusal: 'final' } as const;

        expect(noticeOf({ ...stale, writeFailed: true })).toEqual({ kind: 'moment', text: copy.error });
        expect(noticeOf({ ...stale, writeFailed: false })).toMatchObject({
            kind: 'standing',
            reason: 'policy.webPage',
        });
    });

    it('says a refusal the server gave of a Private, as a moment, over a standing reason', () => {
        expect(noticeOf({ standing: 'fromPerson', isPublic: true, serverRefusal: 'final' })).toEqual({
            kind: 'moment',
            text: copy.privateRefused.final,
        });
    });

    it('says the confirmed finish claim, as a moment', () => {
        expect(noticeOf({ isPublic: true, finishRefused: true, knownRefusal: 'final' })).toEqual({
            kind: 'moment',
            text: copy.privateRefused.final,
        });
    });

    it('ignores a finish claim for a private recipe, and says the standing line instead', () => {
        expect(noticeOf({ standing: 'fromPerson', finishRefused: true, knownRefusal: 'final' })).toMatchObject({
            kind: 'standing',
        });
    });

    it('says the generic failure as a moment when a server refusal of a Private is stale and the write failed (the recipe is private now)', () => {
        // The old early return silenced this input; a failed write now speaks over a standing reason (E5).
        expect(noticeOf({ serverRefusal: 'final', isPublic: false, writeFailed: true })).toEqual({
            kind: 'moment',
            text: copy.error,
        });
    });

    it('says the standing line when a server refusal of a Private is stale (the recipe is private now)', () => {
        expect(noticeOf({ standing: 'policy.book', serverRefusal: 'final' })).toMatchObject({ kind: 'standing' });
    });
});
