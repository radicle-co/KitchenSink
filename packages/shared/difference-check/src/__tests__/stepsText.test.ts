/** `stepsTextOf`: the ONE join of the steps (KTD-1), used for the baseline, the hash and the check. */
import { describe, expect, it } from 'vitest';

import { stepsTextOf } from '../stepsText.js';

describe('stepsTextOf', () => {
    it('joins the instructions with a newline, in step order', () => {
        expect(stepsTextOf([{ instruction: 'Chop.' }, { instruction: 'Fry.' }, { instruction: 'Serve.' }])).toBe(
            'Chop.\nFry.\nServe.',
        );
    });

    it('is the empty text for no steps, and one instruction alone for one step', () => {
        expect(stepsTextOf([])).toBe('');
        expect(stepsTextOf([{ instruction: 'Fry.' }])).toBe('Fry.');
    });

    it('keeps the order it is given, never sorting', () => {
        expect(stepsTextOf([{ instruction: 'b' }, { instruction: 'a' }])).toBe('b\na');
    });
});
