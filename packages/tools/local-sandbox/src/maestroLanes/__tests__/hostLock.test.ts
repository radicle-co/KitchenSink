import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { acquireHostLock, isHostLockHeldError } from '../hostLock.js';

const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function lockPath(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'hostLock-'));
    dirs.push(dir);

    return path.join(dir, 'maestroLanes.lock');
}

const alive = (pids: readonly number[]) => (pid: number) => pids.includes(pid);

describe('acquireHostLock — one orchestrator per host', () => {
    it('takes a free lock and writes its pid into it', () => {
        const file = lockPath();
        const lock = acquireHostLock(file, 101, alive([101]));

        expect(readFileSync(file, 'utf8').trim()).toBe('101');
        lock.release();
        expect(existsSync(file)).toBe(false);
    });

    it('refuses a second acquire while the holder lives, and names the holder', () => {
        const file = lockPath();
        acquireHostLock(file, 101, alive([101, 202]));

        let caught: unknown;

        try {
            acquireHostLock(file, 202, alive([101, 202]));
        } catch (error) {
            caught = error;
        }

        expect(isHostLockHeldError(caught)).toBe(true);
        expect(isHostLockHeldError(caught) ? caught.holderPid : 0).toBe(101);
        expect(String(caught)).toMatch(/101/u);
        expect(readFileSync(file, 'utf8').trim()).toBe('101');
    });

    it('reclaims a lock whose holder is dead', () => {
        const file = lockPath();
        writeFileSync(file, '999\n');

        acquireHostLock(file, 202, alive([202]));

        expect(readFileSync(file, 'utf8').trim()).toBe('202');
    });

    it('refuses a lock it cannot read a pid from, rather than guessing it stale', () => {
        const file = lockPath();
        writeFileSync(file, 'not a pid\n');

        expect(() => acquireHostLock(file, 202, alive([202]))).toThrow(/maestroLanes\.lock/u);
        expect(readFileSync(file, 'utf8')).toBe('not a pid\n');
    });

    it('releases only its own lock, never one another process now holds', () => {
        const file = lockPath();
        const lock = acquireHostLock(file, 101, alive([101]));
        writeFileSync(file, '303\n');

        lock.release();

        expect(readFileSync(file, 'utf8').trim()).toBe('303');
    });

    it('lets exactly one of two reclaimers win a dead lock', () => {
        const file = lockPath();
        writeFileSync(file, '999\n');
        // The second reclaimer read the same dead pid, but runs after the first has already taken the lock.
        acquireHostLock(file, 202, alive([202, 303]));

        expect(() => acquireHostLock(file, 303, alive([202, 303]))).toThrow(/202/u);
        expect(readFileSync(file, 'utf8').trim()).toBe('202');
    });
});
