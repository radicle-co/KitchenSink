/**
 * The host lock: one lane orchestrator per machine.
 *
 * Two orchestrators on one host share the queue consumers, the local database and the Clerk pool lanes, and the second
 * one's exit trap killed the first one's consumer (the "queued reset" defect). So the lock file holds the owner's pid; a
 * second orchestrator is refused and told that pid, and a lock whose pid is dead is reclaimed.
 *
 * ⛔ The pid is written to a private file which is then LINKED into place: `link` fails with `EEXIST` atomically and
 * the lock is never seen half-written, so an unreadable lock is damage, never a holder mid-write, and is refused. A
 * dead lock is reclaimed by RENAMING it aside first: only one process can rename that file, and one that renamed a
 * fresh lock instead (a race it lost) puts it back and refuses.
 */
import { linkSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';

/** A second orchestrator found the lock held by a live process. */
export class HostLockHeldError extends Error {
    readonly holderPid: number;

    constructor(file: string, holderPid: number) {
        super(`another maestro:lanes run (pid ${holderPid}) holds ${file} - wait for it, or stop it`);
        this.name = 'HostLockHeldError';
        this.holderPid = holderPid;
        Object.setPrototypeOf(this, HostLockHeldError.prototype);
    }
}

export const isHostLockHeldError = (value: unknown): value is HostLockHeldError => value instanceof HostLockHeldError;

export interface HostLock {
    /** Removes the lock if it still holds this pid. */
    release(): void;
}

/**
 * Whether a pid is a live process. `EPERM` means it exists under another user, so it is alive.
 *
 * @sideEffect Signals the process with signal 0.
 */
export function pidIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);

        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

const readPid = (file: string): number | undefined => {
    const text = readFileSync(file, 'utf8').trim();

    return /^[1-9]\d*$/u.test(text) ? Number(text) : undefined;
};

const isCode = (error: unknown, code: string): boolean => (error as NodeJS.ErrnoException | undefined)?.code === code;

/**
 * Take the host lock, or throw.
 *
 * @sideEffect Creates, renames and deletes files beside `file`.
 * @param file - The lock file.
 * @param pid - This process's pid.
 * @param isAlive - Whether a pid is live (injected; {@link pidIsAlive} in production).
 * @throws {HostLockHeldError} When a live process holds it; an `Error` when the lock holds no pid.
 */
export function acquireHostLock(file: string, pid: number, isAlive: (pid: number) => boolean): HostLock {
    const mine = `${file}.${pid}`;
    writeFileSync(mine, `${pid}\n`);

    try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                linkSync(mine, file);

                return {
                    release: () => {
                        try {
                            if (readPid(file) === pid) {
                                unlinkSync(file);
                            }
                        } catch (error) {
                            if (!isCode(error, 'ENOENT')) {
                                throw error;
                            }
                        }
                    },
                };
            } catch (error) {
                if (!isCode(error, 'EEXIST')) {
                    throw error;
                }
            }

            const holder = readPid(file);

            if (holder === undefined) {
                throw new Error(`${file} holds no pid - remove it by hand if no maestro:lanes run is going`);
            }

            if (isAlive(holder)) {
                throw new HostLockHeldError(file, holder);
            }

            const aside = `${file}.stale.${pid}`;
            renameSync(file, aside);

            if (readPid(aside) !== holder) {
                // Another reclaimer took the lock between the read and the rename: give its lock back.
                renameSync(aside, file);
                throw new HostLockHeldError(file, readPid(file) ?? holder);
            }

            unlinkSync(aside);
        }

        throw new Error(`could not take ${file}`);
    } finally {
        rmSync(mine, { force: true });
    }
}
