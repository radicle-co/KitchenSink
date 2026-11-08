/**
 * The machine lock of a local web run.
 *
 * Every local web run signs in as the fixed `web` Clerk pool users (slot 1..N), so two runs on one machine would sign
 * each other out and both fail with errors that read like app defects. A run takes this lock before it starts lanes.
 * It is the Maestro lanes' host lock (`acquireHostLock`: a pid and a boot id, linked into place atomically, a dead
 * holder reclaimed) with a file of its own, so a web run and a Maestro run do not wait for each other: they lease
 * different pool lanes.
 *
 * @pattern Template Method — {@link withWebLock} owns the take and the release, the caller owns the run
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { stateRoot, type Env } from '@kitchensink/e2e-plan/stampRun';
import { acquireHostLock, currentBootId, isHostLockHeldError, pidIsAlive } from '@kitchensink/local-sandbox/hostLock';

/**
 * Where the web lock lives: beside the green stamps, under the same state home.
 *
 * @param env - The caller's environment (`XDG_STATE_HOME`).
 * @returns The lock file.
 */
export const webLockFile = (env: Env): string => join(stateRoot(env), 'locks', 'webLanes.lock');

export interface WebLockOptions {
    readonly file: string;
    readonly pid: number;
    readonly isAlive: (pid: number) => boolean;
    readonly bootId: string;
}

/**
 * The lock of this process, on this machine.
 *
 * @sideEffect Reads the boot id from `/proc` where there is one.
 * @param env - The caller's environment.
 * @returns The options {@link withWebLock} takes.
 */
export const thisMachine = (env: Env): WebLockOptions => ({
    file: webLockFile(env),
    pid: process.pid,
    isAlive: pidIsAlive,
    bootId: currentBootId(),
});

/**
 * Runs `run` holding the web lock.
 *
 * @sideEffect Creates and removes the lock file.
 * @param options - The lock file, this process, how to tell a live holder, and the boot id.
 * @param run - The run; the lock is released when it settles, whichever way.
 * @returns What `run` returns.
 * @throws When a live run holds the lock: the message names the holder and why only one may run.
 */
export async function withWebLock<T>(options: WebLockOptions, run: () => Promise<T>): Promise<T> {
    mkdirSync(dirname(options.file), { recursive: true });

    let lock;

    try {
        lock = acquireHostLock(options.file, options.pid, options.isAlive, options.bootId);
    } catch (error) {
        if (isHostLockHeldError(error)) {
            throw new Error(
                `error: another local web run (pid ${error.holderPid}) holds ${options.file}. Two runs would share the same Clerk pool users and sign each other out. Wait for it, or stop it.`,
                { cause: error },
            );
        }

        throw error;
    }

    try {
        return await run();
    } finally {
        lock.release();
    }
}
