/**
 * Stopping process groups: SIGTERM, a grace, SIGKILL for what stayed, and a bound on the wait after SIGKILL. One
 * escalation for every caller (the lane runners, the shared services), so no caller forgets the group, the kill or the
 * bound.
 */
import { setTimeout as delay } from 'node:timers/promises';

import { pidIsAlive } from './hostLock.js';

/** The signals the escalation sends. */
export type StopSignal = 'SIGTERM' | 'SIGKILL';

/** Something that can be signalled and asked whether it is still alive. */
export interface StopTarget {
    stop(signal: StopSignal): void;
    /** True while any part of the target is alive. */
    running(): boolean;
}

/** How long a group has to be gone after SIGTERM before SIGKILL: a stuck child ignores the first. */
export const STOP_GRACE_MS = 10_000;

/** How long a group has to be gone after SIGKILL. A process in uninterruptible sleep ignores it, and must not hold teardown. */
export const KILL_WAIT_MS = 5_000;

/** How often the escalation asks whether a group is gone. */
const GROUP_POLL_MS = 25;

export interface StopTimes {
    readonly graceMs?: number;
    readonly killWaitMs?: number;
    readonly pollMs?: number;
}

/**
 * A process group by its leader's pid. The leader may exit while a child stays, so `running` asks about the group. A pid
 * below 2 names no group: `kill(-0)` would signal the caller's own group and `kill(-1)` every process of the user.
 *
 * @sideEffect `stop` signals the group; `running` sends signal 0.
 */
export function processGroup(pid: number): StopTarget {
    const named = pid > 1;

    return {
        running: () => named && pidIsAlive(-pid),
        stop: (signal) => {
            if (!named) {
                return;
            }

            try {
                process.kill(-pid, signal);
            } catch {
                // Already gone.
            }
        },
    };
}

/** Wait until no target is running or the time is over; true when none is running. */
async function goneWithin(targets: readonly StopTarget[], ms: number, pollMs: number): Promise<boolean> {
    const deadline = Date.now() + ms;

    while (targets.some((target) => target.running())) {
        if (Date.now() >= deadline) {
            return false;
        }

        await delay(pollMs);
    }

    return true;
}

/**
 * SIGTERM every target, wait the grace, SIGKILL those still running, and wait a bounded time for them to go.
 *
 * @returns `stopped` when all went within the grace, `killed` when SIGKILL was needed and ended them, `stuck` when one
 * still ran after the kill wait: the caller reports it and goes on, because teardown must not wait for ever.
 * @sideEffect Signals every target and sleeps.
 */
export async function stopTargets(
    targets: readonly StopTarget[],
    times: StopTimes = {},
): Promise<'stopped' | 'killed' | 'stuck'> {
    const { graceMs = STOP_GRACE_MS, killWaitMs = KILL_WAIT_MS, pollMs = GROUP_POLL_MS } = times;

    for (const target of targets) {
        target.stop('SIGTERM');
    }

    if (await goneWithin(targets, graceMs, pollMs)) {
        return 'stopped';
    }

    for (const target of targets.filter((candidate) => candidate.running())) {
        target.stop('SIGKILL');
    }

    return (await goneWithin(targets, killWaitMs, pollMs)) ? 'killed' : 'stuck';
}
