// @vitest-environment node
/**
 * Two local web runs on one machine would share the same fixed Clerk pool users (`web` slots 1..N): one signs the
 * other's session out and both fail with errors that read like app defects. So a web run takes a machine lock first.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { webLockFile, withWebLock } from '../e2eMachineLock';

let state: string;

beforeEach(() => {
    state = mkdtempSync(join(tmpdir(), 'webLock-'));
});

afterEach(() => {
    rmSync(state, { recursive: true, force: true });
});

const alive = (pids: readonly number[]) => (pid: number) => pids.includes(pid);

describe('webLockFile', () => {
    it('is its own file under the state root, not the Maestro lanes’ lock', () => {
        expect(webLockFile({ XDG_STATE_HOME: '/x' })).toBe('/x/kitchensink/locks/webLanes.lock');
    });
});

describe('withWebLock', () => {
    it('holds the lock while the run goes and releases it after', async () => {
        const file = join(state, 'locks', 'webLanes.lock');
        let held = '';

        await withWebLock({ file, pid: 111, isAlive: alive([111]), bootId: 'b' }, () => {
            held = readFileSync(file, 'utf8');

            return Promise.resolve();
        });

        expect(held).toBe('111 b\n');
        expect(() => readFileSync(file, 'utf8')).toThrow(/ENOENT/u);
    });

    it('releases the lock when the run throws, and passes the throw on', async () => {
        const file = join(state, 'locks', 'webLanes.lock');

        await expect(
            withWebLock({ file, pid: 111, isAlive: alive([111]), bootId: 'b' }, () =>
                Promise.reject(new Error('boom')),
            ),
        ).rejects.toThrow('boom');
        expect(() => readFileSync(file, 'utf8')).toThrow(/ENOENT/u);
    });

    it('returns what the run returns', async () => {
        const file = join(state, 'locks', 'webLanes.lock');

        expect(await withWebLock({ file, pid: 1, isAlive: alive([1]), bootId: 'b' }, () => Promise.resolve(7))).toBe(7);
    });

    it('refuses a second run while a live one holds it, naming the holder and the pool, and runs nothing', async () => {
        const file = join(state, 'locks', 'webLanes.lock');
        let ran = false;

        await withWebLock({ file, pid: 111, isAlive: alive([111, 222]), bootId: 'b' }, async () => {
            await expect(
                withWebLock({ file, pid: 222, isAlive: alive([111, 222]), bootId: 'b' }, () => {
                    ran = true;

                    return Promise.resolve();
                }),
            ).rejects.toThrow(/pid 111.*Clerk pool|Clerk pool.*pid 111/su);
        });

        expect(ran).toBe(false);
    });

    it('takes over a lock whose holder is gone', async () => {
        const file = join(state, 'locks', 'webLanes.lock');
        await withWebLock({ file, pid: 111, isAlive: alive([111]), bootId: 'b' }, () => Promise.resolve());
        writeFileSync(file, '999 b\n');

        await withWebLock({ file, pid: 222, isAlive: alive([222]), bootId: 'b' }, () => Promise.resolve());

        expect(() => readFileSync(file, 'utf8')).toThrow(/ENOENT/u);
    });
});
