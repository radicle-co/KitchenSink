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

    describe('switch on', () => {
        it('adds the Pro line with the feature list', () => {
            const copy = publishBlockedCopyOf(50, m, true, FEATURES);

            expect(copy.upsell).toContain(FEATURES);
        });
    });
});
