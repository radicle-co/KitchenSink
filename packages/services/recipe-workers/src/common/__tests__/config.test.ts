import { afterEach, beforeEach, describe, it, expect } from 'vitest';

import {
    InvalidConfigError,
    isInvalidConfigError,
    isMissingConfigError,
    MissingConfigError,
    requireEnv,
    requirePositiveEnv,
} from '../config.js';

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

describe('isInvalidConfigError', () => {
    it('is true only for InvalidConfigError instances', () => {
        expect(isInvalidConfigError(new InvalidConfigError('X', 'X is bad'))).toBe(true);
        expect(isInvalidConfigError(new MissingConfigError('X'))).toBe(false);
        expect(isInvalidConfigError(new Error('X'))).toBe(false);
        expect(isInvalidConfigError(undefined)).toBe(false);
    });
});

describe('requirePositiveEnv', () => {
    it('parses a positive integer from the given environment', () => {
        expect(requirePositiveEnv(TEST_KEY, { [TEST_KEY]: '90' })).toBe(90);
    });

    it.each([undefined, ''])('an absent variable (%j) is a MissingConfigError, like requireEnv', (value) => {
        let caught: unknown;

        try {
            requirePositiveEnv(TEST_KEY, { [TEST_KEY]: value });
        } catch (error) {
            caught = error;
        }

        expect(isMissingConfigError(caught)).toBe(true);
        expect((caught as MissingConfigError).variableName).toBe(TEST_KEY);
    });

    it.each(['0', '-3', '1.5', 'abc'])('a present but invalid value (%j) is an InvalidConfigError', (value) => {
        let caught: unknown;

        try {
            requirePositiveEnv(TEST_KEY, { [TEST_KEY]: value });
        } catch (error) {
            caught = error;
        }

        expect(isInvalidConfigError(caught)).toBe(true);
        expect(isMissingConfigError(caught)).toBe(false);
        expect((caught as InvalidConfigError).variableName).toBe(TEST_KEY);
        expect((caught as InvalidConfigError).message).toBe(`${TEST_KEY} must be a positive integer`);
    });

    it('reads process.env when no environment is given', () => {
        process.env[TEST_KEY] = '7';

        try {
            expect(requirePositiveEnv(TEST_KEY)).toBe(7);
        } finally {
            delete process.env[TEST_KEY];
        }
    });
});
