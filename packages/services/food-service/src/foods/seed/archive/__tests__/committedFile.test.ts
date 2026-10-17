import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isMissingFile, readTextIfPresent } from '../committedFile.js';

/** An error carrying a Node errno code, as `fs` throws it. */
function errnoError(code: string): Error {
    return Object.assign(new Error(code), { code });
}

describe('isMissingFile', () => {
    it('is true only for ENOENT', () => {
        expect(isMissingFile(errnoError('ENOENT'))).toBe(true);
        expect(isMissingFile(errnoError('EACCES'))).toBe(false);
        expect(isMissingFile(errnoError('EISDIR'))).toBe(false);
    });

    it('is false for a value that is not an Error, even one carrying the code', () => {
        expect(isMissingFile({ code: 'ENOENT' })).toBe(false);
        expect(isMissingFile('ENOENT')).toBe(false);
        expect(isMissingFile(undefined)).toBe(false);
    });
});

describe('readTextIfPresent', () => {
    it('reads a present file as UTF-8 and answers undefined for an absent one', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'committedFile-'));
        await writeFile(join(dir, 'present.txt'), 'é\n', 'utf8');

        await expect(readTextIfPresent(join(dir, 'present.txt'))).resolves.toBe('é\n');
        await expect(readTextIfPresent(join(dir, 'absent.txt'))).resolves.toBeUndefined();
    });

    it('rethrows any other failure, so a directory is never read as an absent file', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'committedFile-'));

        await expect(readTextIfPresent(dir)).rejects.toMatchObject({ code: 'EISDIR' });
    });
});
