/**
 * Starting one shared service and stopping it again: wait until it is ready, then stop its whole process group.
 */
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import { pidIsAlive } from './hostLock.js';
import type { RunningService, ServiceSpec } from './sharedServices.js';
import { processGroup, stopTargets, type StopTimes } from './stopGroups.js';

export interface ServiceStart {
    /** Starts the service in its own process group, writing its output to the log. */
    readonly spawn: (spec: ServiceSpec) => { readonly pid: number };
    readonly log: string;
    /** How often readiness is checked. Defaults to one second. */
    readonly pollMs?: number;
    /** The stop escalation's times; the defaults in production. */
    readonly stop?: StopTimes;
}

const READY_POLLS = 60;
const WORKER_READY_POLLS = 8;

/**
 * Start one service and wait until it is ready: a consumer prints `draining`, the worker is alive after 8 polls.
 *
 * @throws When the service exits or is not ready in 60 polls; a service that never got ready is stopped first.
 * @sideEffect Spawns the service, reads its log and signals its group.
 */
export async function startService(spec: ServiceSpec, start: ServiceStart): Promise<RunningService> {
    const { pid } = start.spawn(spec);
    const group = processGroup(pid);
    const consumer = spec.name !== 'parseWorker';

    for (let waited = 0; waited < READY_POLLS; waited += 1) {
        await delay(start.pollMs ?? 1_000);

        if (!pidIsAlive(pid)) {
            throw new Error(`maestro:lanes: ${spec.name} exited - log: ${start.log}`);
        }

        if (consumer ? readFileSync(start.log, 'utf8').includes('draining') : waited >= WORKER_READY_POLLS) {
            return {
                pid,
                stop: async () => {
                    await stopTargets([group], start.stop);
                },
            };
        }
    }

    await stopTargets([group], start.stop);

    throw new Error(`maestro:lanes: ${spec.name} was not ready in 60 s - log: ${start.log}`);
}
