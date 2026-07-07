import { afterEach, beforeEach, describe, it, expect } from 'vitest';

import { isMissingConfigError, MissingConfigError, requireEnv } from '../config.js';

const TEST_KEY = 'RECIPE_WORKERS_TEST_VAR';

describe('requireEnv', () => {
    let original: string | undefined;

    beforeEach(() => {
        original = process.env[TEST_KEY];
        delete process.env[TEST_KEY];
    });

    afterEach(() => {
        if (original === undefined) {
            delete process.env[TEST_KEY];
        } else {
            process.env[TEST_KEY] = original;
        }
    });

    it('returns the value when the variable is present', () => {
        process.env[TEST_KEY] = 'queue-url';

        expect(requireEnv(TEST_KEY)).toBe('queue-url');
    });

    it('throws MissingConfigError when the variable is unset', () => {
        let caught: unknown;
        try {
            requireEnv(TEST_KEY);
        } catch (error) {
            caught = error;
        }

        expect(isMissingConfigError(caught)).toBe(true);
        expect(caught).toBeInstanceOf(MissingConfigError);
        expect((caught as MissingConfigError).variableName).toBe(TEST_KEY);
        expect((caught as MissingConfigError).message).toContain(TEST_KEY);
    });

    it('throws MissingConfigError when the variable is present but empty', () => {
        process.env[TEST_KEY] = '';

        expect(() => requireEnv(TEST_KEY)).toThrow(MissingConfigError);
    });
});

describe('isMissingConfigError', () => {
    it('is true only for MissingConfigError instances', () => {
        expect(isMissingConfigError(new MissingConfigError('X'))).toBe(true);
        expect(isMissingConfigError(new Error('X'))).toBe(false);
        expect(isMissingConfigError('X')).toBe(false);
        expect(isMissingConfigError(undefined)).toBe(false);
    });
});
