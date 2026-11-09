/**
 * {@link visibilityNoticeOf}: the ONE answer to "what does the recipe page say about visibility?" (buildSpec §6.4, plan
 * 2026-10-14-009 T3). It serves three ways a Private is refused: the editor withheld it (a CLAIM carried in `?done=` on
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

const copy = recipeActionMessages.en.visibility;
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
};
const noticeOf = (overrides: Partial<VisibilityNoticeInput>): string | undefined =>
    visibilityNoticeOf({ ...base, ...overrides }, copy);

describe('visibilityNoticeOf — the finish claim (a link or route param the reader may forge)', () => {
    it.each([
        ['final', FINAL],
        // REWRITTEN for ADR-0077 section 6: there is no premium sentence; any non-slots refusal says `final`.
        ['premium', FINAL],
        ['slots', SLOTS],
    ] as const)('⛔ says the %s refusal in its own words for an owner of a public recipe', (knownRefusal, words) => {
        expect(noticeOf({ finishRefused: true, knownRefusal })).toBe(words);
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
            expect(noticeOf({ serverRefusal, knownRefusal: undefined })).toBe(
                serverRefusal === 'slots' ? SLOTS : FINAL,
            );
        },
    );

    it('is silent once the recipe is no longer public', () => {
        expect(noticeOf({ serverRefusal: 'final', isPublic: false, writeFailed: true })).toBeUndefined();
    });
});

describe('visibilityNoticeOf — precedence', () => {
    it('lets the latest server answer win over the finish claim', () => {
        expect(noticeOf({ serverRefusal: 'slots', finishRefused: true, knownRefusal: 'final' })).toBe(SLOTS);
    });

    it('lets a later generic failure of the page’s own write win over the finish claim: it is the more recent word', () => {
        expect(noticeOf({ writeFailed: true, finishRefused: true, knownRefusal: 'final' })).toBe(copy.error);
    });

    it('lets a server refusal win over the generic failure it caused', () => {
        expect(noticeOf({ serverRefusal: 'final', writeFailed: true })).toBe(FINAL);
    });
});

describe('visibilityNoticeOf — the generic failure', () => {
    it('says the generic error for the owner, public or private', () => {
        expect(noticeOf({ writeFailed: true })).toBe(copy.error);
        expect(noticeOf({ writeFailed: true, isPublic: false })).toBe(copy.error);
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
        expect(noticeOf({ serverRefusal: 'slots' })).toBe('Not available. All 50 of your private slots are in use.');
    });

    it('states the limit it is given, whatever it is', () => {
        expect(noticeOf({ serverRefusal: 'slots', slotLimit: 75 })).toBe(
            'Not available. All 75 of your private slots are in use.',
        );
    });

    it('⛔ with no limit to state, says the generic failure rather than a number it made up', () => {
        expect(noticeOf({ serverRefusal: 'slots', slotLimit: undefined })).toBe(copy.error);
        expect(noticeOf({ finishRefused: true, knownRefusal: 'slots', slotLimit: undefined })).toBe(copy.error);
    });
});
