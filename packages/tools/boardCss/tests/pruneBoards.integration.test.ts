/**
 * The `prune` command over real files. Each case runs the CLI in a child process against a folder of its own, removed
 * afterwards.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeBoard } from '../__tests__/__fixtures__/makeBoard.js';

const run = promisify(execFile);
const packageRoot = resolve(fileURLToPath(import.meta.url), '../..');
const tsx = resolve(packageRoot, '../../../node_modules/.bin/tsx');
const bin = resolve(packageRoot, 'bin/pruneBoards.ts');

const DEAD = makeBoard({ css: '.used{a:b}\n.ghost{c:d}\n' });
const PRUNED = makeBoard({ css: '.used{a:b}\n' });
const RESIDUE = makeBoard({ css: '.used:not(.ghost){a:b}\n.ghost{c:d}\n' });

interface Result {
    readonly code: number;
    readonly stdout: string;
}

let folder = '';

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'boardCss-'));
});

afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
});

/** Runs the command with `args`, with `INIT_CWD` set to `initCwd` as npm sets it. */
async function prune(args: readonly string[], initCwd = folder): Promise<Result> {
    try {
        const done = await run(tsx, [bin, ...args], { cwd: folder, env: { ...process.env, INIT_CWD: initCwd } });

        return { code: 0, stdout: done.stdout };
    } catch (error) {
        const failed = error as { code: number; stdout: string };

        return { code: failed.code, stdout: failed.stdout };
    }
}

async function board(name: string, html: string): Promise<string> {
    const path = join(folder, name);

    await writeFile(path, html);

    return path;
}

describe('prune', () => {
    it('writes the pruned board in place and exits 0 when no dead class remains', async () => {
        const path = await board('a.dc.html', DEAD);

        expect(await prune([path])).toEqual({ code: 0, stdout: `${path}: removed 1 selectors\n` });
        expect(await readFile(path, 'utf8')).toBe(PRUNED);
    });

    it('writes nothing under --check and exits 1 when the board would change', async () => {
        const path = await board('a.dc.html', DEAD);

        expect(await prune(['--check', path])).toEqual({ code: 1, stdout: `${path}: removed 1 selectors\n` });
        expect(await readFile(path, 'utf8')).toBe(DEAD);
    });

    it('exits 1 under --check for a board that keeps a dead class, and leaves the file as it was', async () => {
        const path = await board('a.dc.html', RESIDUE);

        expect((await prune(['--check', path])).code).toBe(1);
        expect(await readFile(path, 'utf8')).toBe(RESIDUE);
    });

    it('exits 0 under --check for a board with nothing to remove', async () => {
        const path = await board('a.dc.html', PRUNED);

        expect(await prune(['--check', path])).toEqual({ code: 0, stdout: '' });
    });

    it('does nothing the second time', async () => {
        const path = await board('a.dc.html', DEAD);

        await prune([path]);

        expect(await prune([path])).toEqual({ code: 0, stdout: '' });
        expect(await readFile(path, 'utf8')).toBe(PRUNED);
    });

    it('names the classes it had to keep, exits 1, and still writes the board', async () => {
        const path = await board('a.dc.html', RESIDUE);

        expect(await prune([path])).toEqual({
            code: 1,
            stdout: `${path}: removed 1 selectors\n${path}: 1 dead classes kept: ghost\n`,
        });
        expect(await readFile(path, 'utf8')).toBe(makeBoard({ css: '.used:not(.ghost){a:b}\n' }));
    });

    it.each([[[]], [['--nope', 'a.dc.html']], [['missing.dc.html']], [['a.dc.html', 'missing.dc.html']]])(
        'exits 2 for %j and writes nothing',
        async (args) => {
            const path = await board('a.dc.html', DEAD);

            expect((await prune(args)).code).toBe(2);
            expect(await readFile(path, 'utf8')).toBe(DEAD);
        },
    );

    it('resolves a relative path against INIT_CWD, not the working directory', async () => {
        const path = await board('a.dc.html', DEAD);
        const elsewhere = await mkdtemp(join(tmpdir(), 'boardCssElsewhere-'));

        try {
            expect(await prune(['a.dc.html'], folder)).toEqual({ code: 0, stdout: `${path}: removed 1 selectors\n` });
            expect((await prune(['a.dc.html'], elsewhere)).code).toBe(2);
        } finally {
            await rm(elsewhere, { recursive: true, force: true });
        }
    });
});
