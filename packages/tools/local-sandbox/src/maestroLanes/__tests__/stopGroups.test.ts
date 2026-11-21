import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { processGroup, stopTargets, type StopTarget } from '../stopGroups.js';

/** A target that models a process group: it is gone after the signals in `diesOn`, `afterMs` after the signal. */
function fakeTarget(
    events: string[],
    name: string,
    behaviour: { readonly diesOn: readonly ('SIGTERM' | 'SIGKILL')[]; readonly afterMs?: number },
): StopTarget {
    let alive = true;

    return {
        stop: (signal) => {
            events.push(`${name} ${signal}`);

            if (behaviour.diesOn.includes(signal)) {
                setTimeout(() => {
                    alive = false;
                }, behaviour.afterMs ?? 0);
            }
        },
        running: () => alive,
    };
}

const TIMES = { graceMs: 40, killWaitMs: 80, pollMs: 5 } as const;

describe('stopTargets', () => {
    it('sends SIGTERM to every target once and sends no SIGKILL when all are gone within the grace', async () => {
        const events: string[] = [];

        const outcome = await stopTargets(
            [
                fakeTarget(events, 'a', { diesOn: ['SIGTERM'], afterMs: 5 }),
                fakeTarget(events, 'b', { diesOn: ['SIGTERM'] }),
            ],
            TIMES,
        );

        expect(outcome).toBe('stopped');
        expect(events).toEqual(['a SIGTERM', 'b SIGTERM']);
    });

    it('sends SIGKILL after the grace to the targets still running, and not to those already gone', async () => {
        const events: string[] = [];

        const outcome = await stopTargets(
            [fakeTarget(events, 'gone', { diesOn: ['SIGTERM'] }), fakeTarget(events, 'stuck', { diesOn: ['SIGKILL'] })],
            TIMES,
        );

        expect(outcome).toBe('killed');
        expect(events).toEqual(['gone SIGTERM', 'stuck SIGTERM', 'stuck SIGKILL']);
    });

    it('waits for a target to go after SIGKILL, as a real group takes a moment', async () => {
        const events: string[] = [];
        const slow = fakeTarget(events, 'slow', { diesOn: ['SIGKILL'], afterMs: 30 });

        const outcome = await stopTargets([slow], TIMES);

        expect(outcome).toBe('killed');
        expect(slow.running()).toBe(false);
    });

    it('gives up on a target that survives SIGKILL, after the kill wait and not before', async () => {
        const events: string[] = [];
        const startedAt = Date.now();

        const outcome = await stopTargets([fakeTarget(events, 'unkillable', { diesOn: [] })], TIMES);

        expect(outcome).toBe('stuck');
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(TIMES.graceMs + TIMES.killWaitMs - 10);
        expect(Date.now() - startedAt).toBeLessThan(TIMES.graceMs + TIMES.killWaitMs + 500);
    });

    it('returns at once for no targets', async () => {
        await expect(stopTargets([], TIMES)).resolves.toBe('stopped');
    });
});

describe('processGroup', () => {
    const pids: number[] = [];

    afterEach(() => {
        for (const pid of pids.splice(0)) {
            try {
                process.kill(-pid, 'SIGKILL');
            } catch {
                // Gone.
            }
        }
    });

    it.each([-1, 0, 1])(
        'never signals for pid %i: kill(-0) hits our own group and kill(-1) every process of the user',
        (pid) => {
            const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

            try {
                processGroup(pid).stop('SIGTERM');
                processGroup(pid).stop('SIGKILL');

                expect(kill).not.toHaveBeenCalled();
            } finally {
                kill.mockRestore();
            }
        },
    );

    /** A detached shell that exits at once while its `sleep` child keeps the group alive. */
    async function leaderGoneChildStays(): Promise<number> {
        const child = spawn('/bin/sh', ['-c', 'sleep 30 & exit 0'], { detached: true, stdio: 'ignore' });
        const { pid } = child;

        if (pid === undefined) {
            throw new Error('the shell did not start');
        }

        pids.push(pid);
        await new Promise((resolve) => child.once('exit', resolve));

        return pid;
    }

    it('reports the group running while a child stays after its leader exited, and stops it on SIGKILL', async () => {
        const group = processGroup(await leaderGoneChildStays());

        expect(group.running()).toBe(true);

        group.stop('SIGKILL');

        for (let tries = 0; tries < 100 && group.running(); tries += 1) {
            await delay(20);
        }

        expect(group.running()).toBe(false);
    });

    it('reports a group that never existed as not running and ignores a stop', () => {
        const group = processGroup(2 ** 22 + 12345);

        expect(group.running()).toBe(false);
        expect(() => {
            group.stop('SIGTERM');
        }).not.toThrow();
    });

    it('refuses a pid below 2, because kill(-1) signals every process of the user', () => {
        for (const pid of [-1, 0, 1]) {
            expect(processGroup(pid).running()).toBe(false);
        }
    });
});
