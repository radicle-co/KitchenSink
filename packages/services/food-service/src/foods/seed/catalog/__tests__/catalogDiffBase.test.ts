/**
 * `readDiffBase` (curated catalog plan U5): the base a CI seed diff plans against. A base with no seed, or one that
 * does not compose, is an empty catalog with a note saying why; a base that is present but broken is an error, so a
 * reviewer is never shown every root as "added" for a reason the note does not state.
 */
import { describe, expect, it, vi } from 'vitest';

import { makeContent, makeContentRoot, makeSnapshot } from '../__fixtures__/catalogContent.fixtures.js';
import { readDiffBase } from '../catalogDiffBase.js';
import { EMPTY_SNAPSHOT } from '../catalogSnapshot.js';
import { SeedRefusedError } from '../curatedSeedFormat.errors.js';

/**
 * A missing-file error as `node:fs` raises it.
 *
 * @returns The error.
 */
function enoent(): Error {
    return Object.assign(new Error("ENOENT: no such file or directory, open 'usda/srLegacy201804.zip'"), {
        code: 'ENOENT',
    });
}

describe('readDiffBase', () => {
    it('a base directory that does not exist is an empty catalog, said so, and is never loaded', async () => {
        const project = vi.fn();
        const base = await readDiffBase('/base', { exists: () => Promise.resolve(false), project });

        expect(base.snapshot).toBe(EMPTY_SNAPSHOT);
        expect(base.note).toBe('The base holds no seed yet, so the head is diffed against an empty catalog.');
        expect(project).not.toHaveBeenCalled();
    });

    it('a base that does not compose is an empty catalog, with its issue count', async () => {
        const refusal = new SeedRefusedError([{ where: 'fdc:1', rule: 'duplicateName', detail: 'x' }]);
        const base = await readDiffBase('/base', {
            exists: () => Promise.resolve(true),
            project: () => Promise.reject(refusal),
        });

        expect(base).toEqual({
            snapshot: EMPTY_SNAPSHOT,
            note: 'The base seed does not compose (1 issue(s)), so the head is diffed against an empty catalog.',
        });
    });

    it('a base that is present but missing a file is an error, never an empty catalog', async () => {
        await expect(
            readDiffBase('/base', { exists: () => Promise.resolve(true), project: () => Promise.reject(enoent()) }),
        ).rejects.toThrow(/ENOENT/u);
    });

    it('any other failure is an error', async () => {
        await expect(
            readDiffBase('/base', {
                exists: () => Promise.resolve(true),
                project: () => Promise.reject(new TypeError('boom')),
            }),
        ).rejects.toThrow('boom');
    });

    it('a base that composes is its projection, with no note', async () => {
        const snapshot = makeSnapshot(makeContent([makeContentRoot()]));
        const base = await readDiffBase('/base', {
            exists: () => Promise.resolve(true),
            project: () => Promise.resolve(snapshot),
        });

        expect(base).toEqual({ snapshot });
    });
});
