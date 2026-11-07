/**
 * The shared services a lane run needs (the queue consumers and the parse worker), owned for the run's whole life.
 *
 * ⛔ The cause of the "queued reset" defect was OWNERSHIP: run B reused run A's consumer, run A's exit killed it, and B's
 * purge sat queued with nobody draining it. So a run never adopts a service it did not start: one already running is
 * refused by pid. Lanes own no services. The pool resets run one lane at a time, before the lanes start and again after
 * they finish, while the services that complete a purge are still up; only then do the services stop.
 *
 * @pattern Supervisor — starts, owns and stops the shared processes, with the resets ordered inside its lifetime
 */
import type { LaneSpec } from './laneTypes.js';
import { ServiceUnusableError } from './serviceUnusableError.js';

export interface ServiceSpec {
    readonly name: string;
    /** Matches the command line of a running copy of this service. */
    readonly pattern: RegExp;
    readonly command: string;
    readonly args: readonly string[];
    /** The queue a consumer drains, which must exist before it starts. */
    readonly queueUrl?: string;
}

export interface RunningService {
    readonly pid: number;
    stop(): Promise<void>;
}

export interface ServicePorts {
    listProcesses(): Promise<readonly { readonly pid: number; readonly command: string }[]>;
    /** Why the service cannot work right now (a queue it drains does not exist), or `undefined` when it can. */
    unusableBecause(spec: ServiceSpec): Promise<string | undefined>;
    /** Spawn the service and resolve once it is ready; reject if it never is. */
    start(spec: ServiceSpec): Promise<RunningService>;
    resetPool(lane: LaneSpec): Promise<void>;
}

/** A service is already running, and this run did not start it. */
export class ForeignServiceError extends Error {
    constructor(name: string, pid: number) {
        super(
            `maestro:lanes: ${name} is already running as pid ${pid}, and this run did not start it - a run never adopts ` +
                'a service another run owns. Stop that run (or that process) first.',
        );
        this.name = 'ForeignServiceError';
        Object.setPrototypeOf(this, ForeignServiceError.prototype);
    }
}

export const isForeignServiceError = (value: unknown): value is ForeignServiceError =>
    value instanceof ForeignServiceError;

export interface SharedServices {
    /** `resetPool` for each lane, one after another. Throws the first failure, after trying every lane. */
    resetLanes(lanes: readonly LaneSpec[]): Promise<void>;
    /** Reset every lane, then stop every service (last started first). Idempotent. */
    stop(lanes: readonly LaneSpec[]): Promise<void>;
}

async function resetEach(lanes: readonly LaneSpec[], ports: ServicePorts): Promise<void> {
    const failures: unknown[] = [];

    for (const lane of lanes) {
        try {
            await ports.resetPool(lane);
        } catch (error) {
            failures.push(error);
        }
    }

    if (failures.length > 0) {
        throw failures[0];
    }
}

async function stopAll(started: readonly RunningService[]): Promise<void> {
    for (const service of [...started].reverse()) {
        await service.stop();
    }
}

/**
 * Refuse any service already running or unable to work, then start each one.
 *
 * @sideEffect Lists and spawns processes through the ports.
 * @throws {ForeignServiceError} When a service is already running.
 * @throws {ServiceUnusableError} When a service's dependencies are missing; nothing is started.
 * @throws The start failure, after stopping what started.
 */
export async function startSharedServices(specs: readonly ServiceSpec[], ports: ServicePorts): Promise<SharedServices> {
    const running = await ports.listProcesses();

    for (const spec of specs) {
        const foreign = running.find((process) => spec.pattern.test(process.command));

        if (foreign !== undefined) {
            throw new ForeignServiceError(spec.name, foreign.pid);
        }
    }

    const unusable: string[] = [];

    for (const spec of specs) {
        const reason = await ports.unusableBecause(spec);

        if (reason !== undefined) {
            unusable.push(`${spec.name}: ${reason}`);
        }
    }

    if (unusable.length > 0) {
        throw new ServiceUnusableError(unusable);
    }

    const started: RunningService[] = [];

    try {
        for (const spec of specs) {
            started.push(await ports.start(spec));
        }
    } catch (error) {
        await stopAll(started);
        throw error;
    }

    let stopped = false;

    return {
        resetLanes: (lanes) => resetEach(lanes, ports),
        stop: async (lanes) => {
            if (stopped) {
                return;
            }

            stopped = true;

            try {
                await resetEach(lanes, ports);
            } finally {
                await stopAll(started);
            }
        },
    };
}
