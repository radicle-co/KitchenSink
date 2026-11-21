/** The custom error of the house convention: extends Error, sets the prototype, has an `is*` guard. */
import { describe, expect, it } from 'vitest';

import { DifferenceCheckError, isDifferenceCheckError } from '../differenceCheckError.js';

describe('DifferenceCheckError', () => {
    it('is an Error that the guard recognises, after the prototype is set', () => {
        const error = new DifferenceCheckError(
            'runtime-unicode',
            'v1 was frozen at Unicode 17.0, this runtime has 16.0',
        );

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(DifferenceCheckError);
        expect(error.name).toBe('DifferenceCheckError');
        expect(error.reason).toBe('runtime-unicode');
        expect(isDifferenceCheckError(error)).toBe(true);
    });

    it('is not any other error', () => {
        expect(isDifferenceCheckError(new Error('x'))).toBe(false);
        expect(isDifferenceCheckError(undefined)).toBe(false);
        expect(isDifferenceCheckError({ name: 'DifferenceCheckError' })).toBe(false);
    });
});
