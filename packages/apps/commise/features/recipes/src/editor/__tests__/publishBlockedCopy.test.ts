/**
 * Unit tests for `publishBlockedCopy.ts`: the words of the blocked-publish dialog under BOTH positions of the one
 * subscription-entry-point switch (spec 010 T-035). Off, nothing sells Pro; on, the Pro line returns.
 *
 * REWRITTEN for ADR-0077 section 6: the `webImport` ask is gone (an imported public-web recipe uses a slot like any
 * other), so the function no longer takes an ask and only the slots words remain.
 */
import { describe, expect, it } from 'vitest';

import { editorMessages } from '../messages.js';
import { publishBlockedCopyOf } from '../publishBlockedCopy.js';

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
            const copy = publishBlockedCopyOf(50, m, false, FEATURES, true);

            expect(copy.body).toBe(
                'All 50 of your private slots are in use. A recipe copied from a web page can only be private. Keep it as a draft for now, or free a slot. Nothing is lost.',
            );
            expect(copy.body).not.toMatch(/publish it as public/iu);
        });

        it('without a slot total, states no number', () => {
            const body = publishBlockedCopyOf(undefined, m, false, FEATURES, true).body;

            expect(body).not.toMatch(/\d/u);
            expect(body).toContain('copied from a web page');
        });

        it('never offers removing the source as the way past the limit', () => {
            expect(publishBlockedCopyOf(50, m, false, FEATURES, true).body).not.toMatch(/remove (the )?source/iu);
        });
    });

    describe('switch on', () => {
        it('adds the Pro line with the feature list', () => {
            const copy = publishBlockedCopyOf(50, m, true, FEATURES);

            expect(copy.upsell).toContain(FEATURES);
        });
    });
});
