/**
 * {@link visibilityNoticeOf}: the ONE answer to "what does the recipe page say about visibility?" (buildSpec §6.4, plan
 * 2026-10-14-009 T3). It serves three ways a Private is refused: the editor withheld it (a CLAIM carried in `?done=` on
 * web or a route param on native), the editor's follow-up was refused after it left, and the page's own Make private was
 * refused.
 *
 * ⛔ The finish claim is a URL, which is the reader's to forge, and case (1) has no server answer to carry: the client
 * withheld the Private, so the server never saw it. So the sentence is confirmed against facts the page holds from the
 * server: the viewer owns the recipe, the recipe is public, and the profile says Private is refused for this viewer. The
 * words come from the profile's reason, never from the link.
 */
import { describe, expect, it } from 'vitest';

import { recipeActionMessages } from '../messages.js';
import { visibilityNoticeOf, type VisibilityNoticeInput } from '../visibilityNotice.js';

const copy = recipeActionMessages.en.visibility;
const FINAL = copy.privateRefused.final;
const PREMIUM = copy.privateRefused.premium;

const base: VisibilityNoticeInput = {
    viewerIsOwner: true,
    isPublic: true,
    serverRefusal: undefined,
    finishRefused: false,
    known: 'hidden',
    writeFailed: false,
};
const noticeOf = (overrides: Partial<VisibilityNoticeInput>): string | undefined =>
    visibilityNoticeOf({ ...base, ...overrides }, copy);

describe('visibilityNoticeOf — the finish claim (a link or route param the reader may forge)', () => {
    it.each([
        ['hidden', FINAL],
        ['upsell', PREMIUM],
    ] as const)('⛔ says the %s refusal in the profile’s words for an owner of a public recipe', (known, words) => {
        expect(noticeOf({ finishRefused: true, known })).toBe(words);
    });

    it('is silent without a claim, whatever the profile says', () => {
        expect(noticeOf({ finishRefused: false, known: 'hidden' })).toBeUndefined();
    });

    it.each([
        ['a non-owner', { viewerIsOwner: false }],
        ['an owner of a private recipe', { isPublic: false }],
        ['an entitled (granted) owner', { known: 'granted' as const }],
        ['an owner whose profile has not settled', { known: 'loading' as const }],
        ['an owner whose profile read failed', { known: undefined }],
    ])('⛔ ignores a forged claim for %s', (_name, overrides) => {
        expect(noticeOf({ finishRefused: true, ...overrides })).toBeUndefined();
    });
});

describe('visibilityNoticeOf — a refusal the server gave', () => {
    it.each(['final', 'premium'] as const)('says the %s reason for an owner of a public recipe', (serverRefusal) => {
        expect(noticeOf({ serverRefusal, known: 'granted' })).toBe(copy.privateRefused[serverRefusal]);
    });

    it('is silent once the recipe is no longer public', () => {
        expect(noticeOf({ serverRefusal: 'final', isPublic: false, writeFailed: true })).toBeUndefined();
    });
});

describe('visibilityNoticeOf — precedence', () => {
    it('lets the latest server answer win over the finish claim', () => {
        expect(noticeOf({ serverRefusal: 'premium', finishRefused: true, known: 'hidden' })).toBe(PREMIUM);
    });

    it('lets a later generic failure of the page’s own write win over the finish claim: it is the more recent word', () => {
        expect(noticeOf({ writeFailed: true, finishRefused: true, known: 'hidden' })).toBe(copy.error);
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
