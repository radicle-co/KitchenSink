/**
 * `ImportQuotaExceededError` and its guard (004 FR-022): the typed form of `429 IMPORT_QUOTA_EXCEEDED`.
 *
 * It is NOT a `BadRequestError` and NOT a generic response: its status is 429 (so anything keyed on the status alone
 * still sees a refusal), its `code` is the published string, and it carries the instant the allowance reopens as the
 * ISO string the wire sends — a surface localises the date, so the class keeps it as written.
 */
import { describe, expect, it } from 'vitest';

import {
    BadRequestError,
    ImportQuotaExceededError,
    RecipeServiceClientError,
    UnexpectedResponseError,
    isImportQuotaExceededError,
} from '../errors.js';

const RESETS_AT = '2026-10-27T03:30:00.000Z';

describe('ImportQuotaExceededError', () => {
    it('carries the status, the published code and when the allowance reopens', () => {
        const error = new ImportQuotaExceededError(RESETS_AT, 'Spent.');

        expect(error).toBeInstanceOf(RecipeServiceClientError);
        expect(error).not.toBeInstanceOf(BadRequestError);
        expect(error.status).toBe(429);
        expect(error.code).toBe('IMPORT_QUOTA_EXCEEDED');
        expect(error.resetsAt).toBe(RESETS_AT);
        expect(error.message).toBe('Spent.');
        expect(error.name).toBe('ImportQuotaExceededError');
    });

    it('survives the prototype chain across a transpile boundary', () => {
        expect(Object.getPrototypeOf(new ImportQuotaExceededError(RESETS_AT))).toBe(ImportQuotaExceededError.prototype);
    });
});

describe('isImportQuotaExceededError', () => {
    it('accepts the class and nothing that merely looks like it', () => {
        expect(isImportQuotaExceededError(new ImportQuotaExceededError(RESETS_AT))).toBe(true);
        expect(isImportQuotaExceededError(new UnexpectedResponseError(429))).toBe(false);
        expect(isImportQuotaExceededError(new RecipeServiceClientError('x', 429, 'IMPORT_QUOTA_EXCEEDED'))).toBe(false);
        expect(isImportQuotaExceededError({ status: 429, code: 'IMPORT_QUOTA_EXCEEDED', resetsAt: RESETS_AT })).toBe(
            false,
        );
        expect(isImportQuotaExceededError(undefined)).toBe(false);
    });
});
