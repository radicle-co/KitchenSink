/**
 * The typed forms of the bulk-import 409s and the 404 (ADR-0072), mapped by the client off the published code.
 *
 * Written before the classes existed. Each mapping is its own case because the surfaces act differently: a moved cursor
 * is adopted (`cursorOrdinal`, `null` when done), an already-saved item is treated as done, and a stranger's import is the
 * generic not-found. None is a retry, and none may be mistaken for the other 409s (`PARSE_JOB_EXPIRED`, a version conflict).
 */
import { describe, expect, it } from 'vitest';

import { RecipeServiceClient } from '../client.js';
import {
    ImportCursorMovedError,
    ImportItemAlreadySavedError,
    NotFoundError,
    ParseJobExpiredError,
    RecipeServiceClientError,
    UnexpectedResponseError,
    isImportCursorMovedError,
    isImportItemAlreadySavedError,
} from '../errors.js';
import { shouldRetryRecipeServiceFailure } from '../retryPolicy.js';
import { stubFetch } from './utils/fetchDouble.js';

function clientAnswering(status: number, body: unknown): RecipeServiceClient {
    return new RecipeServiceClient({
        baseUrl: 'https://recipes.example.test',
        token: 'tok',
        fetch: stubFetch(status, body),
    });
}

async function failureOf(status: number, body: unknown): Promise<unknown> {
    return clientAnswering(status, body)
        .createParseJob({ text: '2 cups flour' })
        .catch((thrown: unknown) => thrown);
}

describe('ImportCursorMovedError', () => {
    it('carries the status, the code and where the cursor is now', () => {
        const error = new ImportCursorMovedError(4);

        expect(error).toBeInstanceOf(RecipeServiceClientError);
        expect(error).toMatchObject({ status: 409, code: 'IMPORT_CURSOR_MOVED', cursorOrdinal: 4 });
        expect(Object.getPrototypeOf(error)).toBe(ImportCursorMovedError.prototype);
    });

    it('is mapped from the wire, with null kept as null when the cursor is done', async () => {
        const moved = await failureOf(409, {
            code: 'IMPORT_CURSOR_MOVED',
            message: 'moved',
            details: { cursorOrdinal: 7 },
        });
        const done = await failureOf(409, {
            code: 'IMPORT_CURSOR_MOVED',
            message: 'moved',
            details: { cursorOrdinal: null },
        });

        expect(moved).toBeInstanceOf(ImportCursorMovedError);
        expect((moved as ImportCursorMovedError).cursorOrdinal).toBe(7);
        expect((done as ImportCursorMovedError).cursorOrdinal).toBeNull();
    });

    it('is not retried, and not mistaken for another 409', async () => {
        const error = await failureOf(409, {
            code: 'IMPORT_CURSOR_MOVED',
            message: 'moved',
            details: { cursorOrdinal: 1 },
        });

        expect(shouldRetryRecipeServiceFailure(error)).toBe(false);
        expect(error).not.toBeInstanceOf(ParseJobExpiredError);
        expect(isImportCursorMovedError(error)).toBe(true);
        expect(isImportCursorMovedError(new UnexpectedResponseError(409, 'x', 'IMPORT_CURSOR_MOVED'))).toBe(false);
    });
});

describe('ImportItemAlreadySavedError', () => {
    it('carries the status, the code and the item', () => {
        expect(new ImportItemAlreadySavedError(2)).toMatchObject({
            status: 409,
            code: 'IMPORT_ITEM_ALREADY_SAVED',
            ordinal: 2,
        });
    });

    it('is mapped from the wire and is not retried', async () => {
        const error = await failureOf(409, {
            code: 'IMPORT_ITEM_ALREADY_SAVED',
            message: 'saved',
            details: { ordinal: 2 },
        });

        expect(error).toBeInstanceOf(ImportItemAlreadySavedError);
        expect((error as ImportItemAlreadySavedError).ordinal).toBe(2);
        expect(shouldRetryRecipeServiceFailure(error)).toBe(false);
        expect(isImportItemAlreadySavedError(error)).toBe(true);
        expect(isImportItemAlreadySavedError(new ImportCursorMovedError(2))).toBe(false);
    });
});

describe('IMPORT_NOT_FOUND', () => {
    it('is the generic NotFoundError carrying its own code', async () => {
        const error = await failureOf(404, { code: 'IMPORT_NOT_FOUND', message: 'no such import' });

        expect(error).toBeInstanceOf(NotFoundError);
        expect(error).toMatchObject({ status: 404, code: 'IMPORT_NOT_FOUND' });
    });
});
