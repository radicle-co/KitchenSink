import { describe, expect, it } from 'vitest';

import { DesignArtifactError, isDesignArtifactError } from '../errors.js';

describe('DesignArtifactError', () => {
    it('carries its code and message and is an Error', () => {
        const error = new DesignArtifactError('duplicate-name', 'Button is exported twice');

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(DesignArtifactError);
        expect(error.code).toBe('duplicate-name');
        expect(error.message).toBe('Button is exported twice');
        expect(error.name).toBe('DesignArtifactError');
    });

    it.each([
        [new DesignArtifactError('unknown-colour', 'x'), true],
        [new Error('x'), false],
        [{ code: 'duplicate-name', message: 'x' }, false],
        [undefined, false],
    ])('isDesignArtifactError(%o) is %s', (value, expected) => {
        expect(isDesignArtifactError(value)).toBe(expected);
    });
});
