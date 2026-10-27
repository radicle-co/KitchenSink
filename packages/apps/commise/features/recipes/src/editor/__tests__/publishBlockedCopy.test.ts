/**
 * Unit tests for `publishBlockedCopy.ts`: the words of the blocked-publish dialog under BOTH positions of the one
 * subscription-entry-point switch (spec 010 T-035). Off, nothing sells Pro and the web-import case reads in its
 * paid-features-hidden words; on, the Pro line returns, and a `final` refusal still sells nothing.
 */
import { describe, expect, it } from 'vitest';

import { editorMessages } from '../messages.js';
import { publishBlockedCopyOf } from '../publishBlockedCopy.js';

const m = editorMessages.en.publishBlocked;
const FEATURES = 'the AI helper';

describe('publishBlockedCopyOf', () => {
    describe('switch off', () => {
        it('noSlot: states the fact and sells nothing', () => {
            const copy = publishBlockedCopyOf({ kind: 'noSlot' }, 50, m, false, FEATURES);

            expect(copy.body).toContain('50');
            expect(copy.upsell).toBeUndefined();
        });

        it.each(['premium', 'final'] as const)('webImport (%s): the hidden words, no upsell', (refusal) => {
            const copy = publishBlockedCopyOf({ kind: 'webImport', refusal }, 50, m, false, FEATURES);

            expect(copy.body).toBe(m.webImport.bodyNoPaid);
            expect(copy.upsell).toBeUndefined();
        });
    });

    describe('switch on', () => {
        it('noSlot: adds the Pro line with the feature list', () => {
            const copy = publishBlockedCopyOf({ kind: 'noSlot' }, 50, m, true, FEATURES);

            expect(copy.upsell).toContain(FEATURES);
        });

        it('webImport under a premium refusal: the Pro body and line', () => {
            const copy = publishBlockedCopyOf({ kind: 'webImport', refusal: 'premium' }, 50, m, true, FEATURES);

            expect(copy.body).toBe(m.webImport.body);
            expect(copy.upsell).toContain(FEATURES);
        });

        it('webImport under a final refusal: sells nothing even with the switch on', () => {
            const copy = publishBlockedCopyOf({ kind: 'webImport', refusal: 'final' }, 50, m, true, FEATURES);

            expect(copy.body).toBe(m.webImport.bodyNoPaid);
            expect(copy.upsell).toBeUndefined();
        });
    });
});
