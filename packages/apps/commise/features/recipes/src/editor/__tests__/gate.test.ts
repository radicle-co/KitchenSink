/**
 * The publish gate's decision (build spec §7.8): any error refuses, and the refusal names the first section in page
 * order that holds one, which is where the cook is taken.
 */
import { describe, expect, it } from 'vitest';

import { gateOutcomeOf } from '../gate.js';

describe('gateOutcomeOf', () => {
    it('sends when nothing refused', () => {
        expect(gateOutcomeOf({})).toEqual({ kind: 'send' });
    });

    it('refuses with the errors and the first section holding one', () => {
        const errors = { steps: 'stepsRequired', title: 'titleTooLong' } as const;

        expect(gateOutcomeOf(errors)).toEqual({ kind: 'refused', errors, section: 'details' });
    });

    it('refuses even an error no section owns, rather than letting it through', () => {
        // A key with no code is no error; a present code always refuses.
        expect(gateOutcomeOf({ title: undefined })).toEqual({ kind: 'send' });
    });
});
