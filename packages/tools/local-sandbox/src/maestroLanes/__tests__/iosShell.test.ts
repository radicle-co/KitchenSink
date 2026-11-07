import { mkdtempSync, readFileSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createIosShell } from '../iosShell.js';

describe('createIosShell', () => {
    it('returns the stdout of a command that succeeds', async () => {
        await expect(createIosShell().run('printf', ['%s', 'a b'])).resolves.toBe('a b');
    });

    it('passes the extra environment to the command', async () => {
        await expect(createIosShell().run('sh', ['-c', 'printf %s "$KS_TEST"'], { KS_TEST: 'v' })).resolves.toBe('v');
    });

    it('rejects with the command and its stderr when the exit is non-zero', async () => {
        await expect(createIosShell().run('sh', ['-c', 'echo boom >&2; exit 3'])).rejects.toThrow(/boom/);
    });

    it('writes a file, creating its folder', async () => {
        const file = path.join(mkdtempSync(path.join(tmpdir(), 'iosShell-')), 'a', 'b.txt');
        await createIosShell().writeFile(file, 'x');
        expect(readFileSync(file, 'utf8')).toBe('x');
    });

    it('links a file, replacing an old link', async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'iosShell-'));
        const shell = createIosShell();
        await shell.linkFile('/one', path.join(dir, 'l', 'maestro'));
        await shell.linkFile('/two', path.join(dir, 'l', 'maestro'));
        expect(readlinkSync(path.join(dir, 'l', 'maestro'))).toBe('/two');
    });

    it('stops a background command', async () => {
        const task = createIosShell().background('sleep', ['30']);
        await expect(task.stop()).resolves.toBeUndefined();
    });
});
