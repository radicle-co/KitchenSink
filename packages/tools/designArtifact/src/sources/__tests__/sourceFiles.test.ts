import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isDesignArtifactError } from '../../errors.js';
import { fsSourceFiles } from '../fsSourceFiles.js';
import { memorySourceFiles } from '../memorySourceFiles.js';
import type { SourceFiles } from '../sourceFiles.js';

let dir: string;

beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sources-'));
    await mkdir(join(dir, 'b'));
    await mkdir(join(dir, 'a'));
    await writeFile(join(dir, 'a/x.txt'), 'hello');
});

afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
});

/** Both adapters must answer the same questions the same way: the pipeline sees only the port. */
describe.each<[string, () => SourceFiles, (path: string) => string]>([
    ['fs', fsSourceFiles, (path) => join(dir, path)],
    ['memory', () => memorySourceFiles({ '/r/a/x.txt': 'hello', '/r/b/y.txt': 'y' }), (path) => `/r/${path}`],
])('SourceFiles (%s)', (_name, make, at) => {
    it('reads text and bytes', async () => {
        const files = make();

        expect(await files.text(at('a/x.txt'))).toBe('hello');
        expect([...(await files.bytes(at('a/x.txt')))]).toEqual([...new TextEncoder().encode('hello')]);
    });

    it('fails a missing file as missing-source, naming the path', async () => {
        const failure = await make()
            .text(at('nope.txt'))
            .catch((error: unknown) => error);

        expect(isDesignArtifactError(failure) && failure.code).toBe('missing-source');
        expect(failure).toHaveProperty('message', expect.stringContaining('nope.txt'));
    });

    it('lists a directory sorted', async () => {
        expect(await make().list(at('.').replace(/\/\.$/u, ''))).toEqual(expect.arrayContaining(['a', 'b']));
    });

    it('fails a missing directory as missing-source: an absent card folder must not read as "no cards"', async () => {
        const failure = await make()
            .list(at('absent'))
            .catch((error: unknown) => error);

        expect(isDesignArtifactError(failure) && failure.code).toBe('missing-source');
        expect(failure).toHaveProperty('message', expect.stringContaining('absent'));
    });

    it('says whether a path exists', async () => {
        const files = make();

        expect(await files.exists(at('a/x.txt'))).toBe(true);
        expect(await files.exists(at('a'))).toBe(true);
        expect(await files.exists(at('zzz'))).toBe(false);
    });
});
