import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isDesignArtifactError } from '../src/errors.js';
import { fsArtifactWriter } from '../src/write/artifactWriter.js';
import type { WriterFs } from '../src/write/artifactWriter.js';

let sandbox: string;

beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'writer-'));
});

afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
});

describe('fsArtifactWriter over a real directory', () => {
    it('writes text and bytes, creating nested directories and the missing parent', async () => {
        const root = join(sandbox, 'deep/er/project');

        await fsArtifactWriter().write(
            root,
            new Map<string, string | Uint8Array>([
                ['README.md', '# hi\n'],
                ['fonts/a.ttf', new Uint8Array([0, 1, 2, 255])],
            ]),
        );

        expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('# hi\n');
        expect([...(await readFile(join(root, 'fonts/a.ttf')))]).toEqual([0, 1, 2, 255]);
    });

    it('replaces the previous payload wholesale: a file the new build no longer makes is gone', async () => {
        const root = join(sandbox, 'project');

        await mkdir(root);
        await writeFile(join(root, 'stale.txt'), 'old');
        await fsArtifactWriter().write(root, new Map([['fresh.txt', 'new']]));

        expect(await readdir(root)).toEqual(['fresh.txt']);
    });

    it('leaves the old directory intact and no temp directory behind when a file cannot be written', async () => {
        const root = join(sandbox, 'project');

        await mkdir(root);
        await writeFile(join(root, 'keep.txt'), 'old');

        // "a" is a file and "a/b" needs "a" to be a directory: the second write fails after the first succeeded.
        const failure = await fsArtifactWriter()
            .write(
                root,
                new Map([
                    ['a', 'file'],
                    ['a/b', 'conflict'],
                ]),
            )
            .catch((error: unknown) => error);

        expect(isDesignArtifactError(failure) && failure.code).toBe('write-failed');
        expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('old');
        expect(await readdir(root)).toEqual(['keep.txt']);
        expect(await readdir(sandbox)).toEqual(['project']);
    });

    it.each(['../escape.txt', '/abs.txt', 'a/../../escape.txt', ''])(
        'refuses the path %j before touching disk',
        async (path) => {
            const root = join(sandbox, 'project');
            const failure = await fsArtifactWriter()
                .write(root, new Map([[path, 'x']]))
                .catch((error: unknown) => error);

            expect(isDesignArtifactError(failure) && failure.code).toBe('unsafe-path');
            expect(existsSync(root)).toBe(false);
            expect(await readdir(sandbox)).toEqual([]);
        },
    );
});

/** Real disk, except for the one call a test wants to fail. */
function faulty(fail: (call: number, from: string, to: string) => Error | undefined): WriterFs & { calls: string[] } {
    const calls: string[] = [];
    let count = 0;

    return {
        calls,
        async rename(from, to) {
            count += 1;
            calls.push(`rename ${from.split('/').pop() ?? ''} -> ${to.split('/').pop() ?? ''}`);

            const error = fail(count, from, to);

            if (error !== undefined) {
                throw error;
            }

            await rename(from, to);
        },
        rm: (path, options) => rm(path, options),
    };
}

describe('fsArtifactWriter when the swap goes wrong', () => {
    it('restores the previous payload when the swap fails, and removes the staging directory', async () => {
        const root = join(sandbox, 'project');

        await mkdir(root);
        await writeFile(join(root, 'keep.txt'), 'old');

        // Rename 1 parks the previous payload; rename 2 (staging -> root) fails; rename 3 is the rollback.
        const fs = faulty((call) => (call === 2 ? new Error('EXDEV swap') : undefined));
        const failure = await fsArtifactWriter(fs)
            .write(root, new Map([['fresh.txt', 'new']]))
            .catch((error: unknown) => error);

        expect(isDesignArtifactError(failure) && failure.code).toBe('write-failed');
        expect(failure).toHaveProperty('message', expect.stringContaining('EXDEV swap'));
        expect(failure).toHaveProperty('message', expect.stringContaining('previous payload'));
        expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('old');
        expect(await readdir(sandbox)).toEqual(['project']);
        expect(fs.calls).toHaveLength(3);
    });

    it('names the parked directory when the rollback fails too, and keeps it', async () => {
        const root = join(sandbox, 'project');

        await mkdir(root);
        await writeFile(join(root, 'keep.txt'), 'old');

        const fs = faulty((call) =>
            call >= 2 ? new Error(call === 2 ? 'swap failed' : 'rollback failed') : undefined,
        );
        const failure = await fsArtifactWriter(fs)
            .write(root, new Map([['fresh.txt', 'new']]))
            .catch((error: unknown) => error);

        expect(isDesignArtifactError(failure) && failure.code).toBe('write-failed');

        const parked = (await readdir(sandbox)).filter((name) => name.startsWith('project.old-'));

        expect(parked).toHaveLength(1);
        expect(failure).toHaveProperty('message', expect.stringContaining(join(sandbox, parked[0] ?? '')));
        expect(failure).toHaveProperty('message', expect.stringContaining('swap failed'));
        expect(failure).toHaveProperty('message', expect.stringContaining('rollback failed'));
        expect(await readFile(join(sandbox, parked[0] ?? '', 'keep.txt'), 'utf8')).toBe('old');
        expect((await readdir(sandbox)).filter((name) => name.includes('.new-'))).toEqual([]);
    });

    it('reports a warning, not an error, when the old payload cannot be deleted after a good swap', async () => {
        const root = join(sandbox, 'project');

        await mkdir(root);
        await writeFile(join(root, 'old.txt'), 'old');

        const outcome = await fsArtifactWriter({
            rename,
            rm: (path, options) => (path.includes('.old-') ? Promise.reject(new Error('EBUSY')) : rm(path, options)),
        }).write(root, new Map([['fresh.txt', 'new']]));

        expect(await readdir(root)).toEqual(['fresh.txt']);
        expect(outcome.warnings).toHaveLength(1);
        expect(outcome.warnings[0]).toContain('EBUSY');
        expect(outcome.warnings[0]).toContain('.old-');
    });

    it('reports no warnings on a clean write', async () => {
        const outcome = await fsArtifactWriter().write(join(sandbox, 'project'), new Map([['a', 'b']]));

        expect(outcome.warnings).toEqual([]);
    });
});
