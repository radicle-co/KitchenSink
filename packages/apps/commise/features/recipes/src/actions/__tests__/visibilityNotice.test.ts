/**
 * {@link visibilityNoticeOf}: the ONE answer to "what does the recipe page say about visibility?" (buildSpec §6.4, plan
 * 2026-10-14-009 T3). It serves three ways a Private is refused: the editor withheld it (a CLAIM carried in
 * `?privateRefused=` on
 * web or a route param on native), the editor's follow-up was refused after it left, and the page's own Make private was
 * refused.
 *
 * ⛔ The finish claim is a URL, which is the reader's to forge, and case (1) has no server answer to carry: the client
 * withheld the Private, so the server never saw it. So the sentence is confirmed against facts the page holds from the
 * server: the viewer owns the recipe, the recipe is public, and Private is KNOWN to be refused for this viewer on this
 * recipe (`knownRefusal`: every slot used). The
 * words come from that reason, never from the link.
 *
 * REWRITTEN for ADR-0073: the input was the profile's paid-feature state (`known`); a free cook's own recipe is no longer
 * refused for want of Pro, so the page now passes the refusal it holds (`recipePrivateRefusalOf`).
 */
import { describe, expect, it } from 'vitest';

import { recipeActionMessages } from '../messages.js';
import { visibilityNoticeOf, type VisibilityNoticeInput } from '../visibilityNotice.js';

const copy = { ...recipeActionMessages.en.visibility, publicRefusal: recipeActionMessages.en.publicRefusal };
const FINAL = copy.privateRefused.final;
// The slots sentence is filled with the SERVER's limit; this package states no number of its own.
const SLOTS = 'Not available. All 50 of your private slots are in use.';

const base: VisibilityNoticeInput = {
    viewerIsOwner: true,
    isPublic: true,
    serverRefusal: undefined,
    finishRefused: false,
    knownRefusal: 'final',
    writeFailed: false,
    slotLimit: 50,
    standing: 'none',
};
const noticeOf = (overrides: Partial<VisibilityNoticeInput>): ReturnType<typeof visibilityNoticeOf> =>
    visibilityNoticeOf({ ...base, ...overrides }, copy);
/** What the slot says as a MOMENT (needs action now). The whole result is compared, so a standing line of the same words fails. */
const moment = (text: string) => ({ kind: 'moment', text }) as const;

describe('visibilityNoticeOf — the finish claim (a link or route param the reader may forge)', () => {
    it.each([
        ['final', FINAL],
        // REWRITTEN for ADR-0077 section 6: there is no premium sentence; any non-slots refusal says `final`.
        ['premium', FINAL],
        ['slots', SLOTS],
    ] as const)('⛔ says the %s refusal in its own words for an owner of a public recipe', (knownRefusal, words) => {
        expect(noticeOf({ finishRefused: true, knownRefusal })).toEqual(moment(words));
    });

    it('is silent without a claim, whatever the page knows', () => {
        expect(noticeOf({ finishRefused: false, knownRefusal: 'final' })).toBeUndefined();
    });

    it.each([
        ['a non-owner', { viewerIsOwner: false }],
        ['an owner of a private recipe', { isPublic: false }],
        [
            'an owner for whom no refusal is known (entitled, a slot free, still loading, or a failed read)',
            { knownRefusal: undefined },
        ],
    ] as const)('⛔ ignores a forged claim for %s', (_name, overrides) => {
        expect(noticeOf({ finishRefused: true, ...overrides })).toBeUndefined();
    });
});

describe('visibilityNoticeOf — a refusal the server gave', () => {
    it.each(['final', 'premium', 'slots'] as const)(
        'says the %s reason for an owner of a public recipe',
        (serverRefusal) => {
            expect(noticeOf({ serverRefusal, knownRefusal: undefined })).toEqual(
                moment(serverRefusal === 'slots' ? SLOTS : FINAL),
            );
        },
    );

    it('is silent once the recipe is no longer public', () => {
        expect(noticeOf({ serverRefusal: 'final', isPublic: false })).toBeUndefined();
    });
});

describe('visibilityNoticeOf — precedence', () => {
    it('lets the latest server answer win over the finish claim', () => {
        expect(noticeOf({ serverRefusal: 'slots', finishRefused: true, knownRefusal: 'final' })).toEqual(moment(SLOTS));
    });

    it('lets a later generic failure of the page’s own write win over the finish claim: it is the more recent word', () => {
        expect(noticeOf({ writeFailed: true, finishRefused: true, knownRefusal: 'final' })).toEqual(moment(copy.error));
    });

    it('lets a server refusal win over the generic failure it caused', () => {
        expect(noticeOf({ serverRefusal: 'final', writeFailed: true })).toEqual(moment(FINAL));
    });
});

describe('visibilityNoticeOf — the generic failure', () => {
    it('says the generic error for the owner, public or private', () => {
        expect(noticeOf({ writeFailed: true })).toEqual(moment(copy.error));
        expect(noticeOf({ writeFailed: true, isPublic: false })).toEqual(moment(copy.error));
    });

    it('is silent for a non-owner', () => {
        expect(noticeOf({ writeFailed: true, viewerIsOwner: false })).toBeUndefined();
        expect(noticeOf({ serverRefusal: 'final', viewerIsOwner: false })).toBeUndefined();
    });

    it('is silent when nothing happened', () => {
        expect(noticeOf({})).toBeUndefined();
    });
});

describe('visibilityNoticeOf — the slots sentence', () => {
    it('replaces the retired "still public" line with the editor board`s words', () => {
        expect(noticeOf({ serverRefusal: 'slots' })).toEqual(
            moment('Not available. All 50 of your private slots are in use.'),
        );
    });

    it('states the limit it is given, whatever it is', () => {
        expect(noticeOf({ serverRefusal: 'slots', slotLimit: 75 })).toEqual(
            moment('Not available. All 75 of your private slots are in use.'),
        );
    });

    it('⛔ with no limit to state, says the generic failure rather than a number it made up', () => {
        expect(noticeOf({ serverRefusal: 'slots', slotLimit: undefined })).toEqual(moment(copy.error));
        expect(noticeOf({ finishRefused: true, knownRefusal: 'slots', slotLimit: undefined })).toEqual(
            moment(copy.error),
        );
    });
});

/**
 * ADR-0095: a recorded source holds the recipe out of Public, and the page says so. REWRITTEN for board P6 (a
 * recorded test change): `held` was a flag that won over every other word; it is now the
 * standing `sourceConflict` reason, said in the designer's words and below any moment line.
 */
describe('visibilityNoticeOf — a recipe held out of Public by a recorded source', () => {
    const HELD = copy.publicRefusal.sourceConflict;

    it('says the designer’s held line to the owner of a private recipe, as a standing line', () => {
        expect(noticeOf({ standing: 'sourceConflict', isPublic: false })).toEqual({
            kind: 'standing',
            reason: 'sourceConflict',
            text: HELD,
        });
        expect(HELD).toBe('This recipe stays private because it was saved with a source.');
    });

    it('lets a failed write win over it: the generic failure is a moment', () => {
        expect(noticeOf({ standing: 'sourceConflict', isPublic: false, writeFailed: true })).toEqual(
            moment(copy.error),
        );
    });

    it('says nothing to a viewer who is not the owner', () => {
        expect(noticeOf({ standing: 'sourceConflict', viewerIsOwner: false })).toBeUndefined();
    });

    it('says nothing when nothing stops Public', () => {
        expect(noticeOf({ standing: 'none', isPublic: false })).toBeUndefined();
    });

    it('says nothing while the recipe is public', () => {
        expect(noticeOf({ standing: 'sourceConflict', isPublic: true })).toBeUndefined();
    });
});

// hiddenViews AE1/AE2/AE3c/AE4: a PUBLIC recipe the owner is told is Hidden says why in the standing slot, in the owner's
// muted words; a moment wins over it; `other`, an unknown reason and a missing one say nothing.
describe('visibilityNoticeOf — the Hidden line', () => {
    const standing = (key: 'heldSource' | 'sourceCorrected') =>
        ({ kind: 'standing', reason: 'hidden', text: copy.hiddenReason[key] }) as const;

    it.each(['heldSource', 'sourceCorrected'] as const)('says the %s line, from its own key', (reason) => {
        expect(noticeOf({ knownRefusal: undefined, hiddenReason: reason })).toEqual(standing(reason));
    });

    it('says the two lines in different words', () => {
        expect(copy.hiddenReason.heldSource).not.toBe(copy.hiddenReason.sourceCorrected);
    });

    it.each([['other'], ['aReasonFromANewerServer'], ['']])('says no line for %j: the chip alone', (hiddenReason) => {
        expect(noticeOf({ knownRefusal: undefined, hiddenReason })).toBeUndefined();
    });

    it('says nothing without a reason, or to a viewer who is not the owner', () => {
        expect(noticeOf({ knownRefusal: undefined, hiddenReason: undefined })).toBeUndefined();
        expect(noticeOf({ knownRefusal: undefined, viewerIsOwner: false, hiddenReason: 'heldSource' })).toBeUndefined();
    });

    it('lets a moment win: a refused Private and a failed write come before the line', () => {
        expect(noticeOf({ serverRefusal: 'final', hiddenReason: 'heldSource' })).toEqual(moment(FINAL));
        expect(noticeOf({ writeFailed: true, hiddenReason: 'heldSource' })).toEqual(moment(copy.error));
    });

    it('says nothing once the recipe is private, whatever reason the caller still holds', () => {
        expect(noticeOf({ isPublic: false, hiddenReason: 'heldSource' })).toBeUndefined();
    });
});
