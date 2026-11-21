/**
 * Unit tests for `publishBlockedCopy.ts`: the words of the blocked-publish dialog under BOTH positions of the one
 * subscription-entry-point switch (spec 010 T-035). Off, nothing sells Pro; on, the Pro line returns.
 *
 * REWRITTEN for ADR-0077 section 6: the `webImport` ask is gone (an imported public-web recipe uses a slot like any
 * other), so the function no longer takes an ask and only the slots words remain.
 */
import { describe, expect, it, vi } from 'vitest';

import { PUBLIC_REFUSALS } from '../../actions/publicRefusal.js';

import { editorMessages } from '../messages.js';
import { publicOfferOf, publishBlockedCopyOf } from '../publishBlockedCopy.js';

const m = editorMessages.en.publishBlocked;
const FEATURES = 'the AI helper';

describe('publishBlockedCopyOf', () => {
    describe('switch off', () => {
        it('states the fact and sells nothing', () => {
            const copy = publishBlockedCopyOf(50, m, false, FEATURES);

            expect(copy.body).toContain('50');
            expect(copy.upsell).toBeUndefined();
        });

        it('without a slot total, states no number', () => {
            expect(publishBlockedCopyOf(undefined, m, false, FEATURES).body).not.toMatch(/\d/u);
        });
    });

    describe('a recipe copied from a web page (ADR-0089)', () => {
        it('says it can only be private, and never offers to publish it as public', () => {
            const copy = publishBlockedCopyOf(50, m, false, FEATURES, 'policy.webPage');

            expect(copy.body).toBe(
                'All 50 of your private slots are in use. A recipe copied from a web page can only be private. Keep it as a draft for now, or free a slot. Nothing is lost.',
            );
            expect(copy.body).not.toMatch(/publish it as public/iu);
        });

        it('without a slot total, states no number', () => {
            const body = publishBlockedCopyOf(undefined, m, false, FEATURES, 'policy.webPage').body;

            expect(body).not.toMatch(/\d/u);
            expect(body).toContain('copied from a web page');
        });

        it('never offers removing the source as the way past the limit', () => {
            expect(publishBlockedCopyOf(50, m, false, FEATURES, 'policy.webPage').body).not.toMatch(
                /remove (the )?source/iu,
            );
        });
    });

    describe('a recipe whose Public is refused for another reason (designer, B6)', () => {
        it('says it can only be private, offers no public path, and asks for nothing', () => {
            const copy = publishBlockedCopyOf(50, m, false, FEATURES, 'policy.book');

            expect(copy.body).toBe(
                'All 50 of your private slots are in use. This recipe can only be private. Keep it as a draft for now, or free a slot. Nothing is lost.',
            );
            expect(copy.body).not.toMatch(/publish it as public/iu);
        });

        it('without a slot total, states no number', () => {
            expect(publishBlockedCopyOf(undefined, m, false, FEATURES, 'policy.book').body).toBe(
                'All of your private slots are in use. This recipe can only be private. Keep it as a draft for now, or free a slot. Nothing is lost.',
            );
        });

        it.each(PUBLIC_REFUSALS.filter((reason) => reason !== 'none' && reason !== 'policy.webPage'))(
            'says the refused words for %s, which is not a web copy',
            (reason) => {
                expect(publishBlockedCopyOf(50, m, false, FEATURES, reason).body).toContain(
                    'This recipe can only be private.',
                );
            },
        );

        it('says the web words for policy.webPage and not the refused words', () => {
            const body = publishBlockedCopyOf(50, m, false, FEATURES, 'policy.webPage').body;

            expect(body).toContain('copied from a web page');
            expect(body).not.toContain('This recipe can only be private.');
        });
    });

    describe('publicOfferOf', () => {
        it('offers the Public control when nothing refuses it', () => {
            const publish = vi.fn();

            expect(publicOfferOf('none', publish)).toEqual({ onPublishPublic: publish });
        });

        it.each(PUBLIC_REFUSALS.filter((reason) => reason !== 'none'))(
            'offers no control, only the reason %s',
            (reason) => {
                expect(publicOfferOf(reason, vi.fn())).toEqual({ refusal: reason });
            },
        );
    });

    describe('switch on', () => {
        it('adds the Pro line with the feature list', () => {
            const copy = publishBlockedCopyOf(50, m, true, FEATURES);

            expect(copy.upsell).toContain(FEATURES);
        });
    });
});
