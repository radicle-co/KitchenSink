/**
 * The house custom-error convention for `VisibilityNotHeldError`: it extends `Error`, survives `instanceof`, and has a
 * matching `is*` guard that is true for it alone.
 */
import { describe, expect, it } from 'vitest';

import { VisibilityNotHeldError, isVisibilityNotHeldError } from '../visibilityNotHeldError.js';

describe('VisibilityNotHeldError', () => {
    it('is an Error that names the recipe and keeps its own prototype', () => {
        const error = new VisibilityNotHeldError('rec_1');

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(VisibilityNotHeldError);
        expect(error.name).toBe('VisibilityNotHeldError');
        expect(error.message).toContain('rec_1');
    });

    it('isVisibilityNotHeldError is true for it and false for any other value', () => {
        expect(isVisibilityNotHeldError(new VisibilityNotHeldError('rec_1'))).toBe(true);
        expect(isVisibilityNotHeldError(new Error('The server did not hold the visibility'))).toBe(false);
        expect(isVisibilityNotHeldError({ name: 'VisibilityNotHeldError' })).toBe(false);
        expect(isVisibilityNotHeldError(undefined)).toBe(false);
    });
});
