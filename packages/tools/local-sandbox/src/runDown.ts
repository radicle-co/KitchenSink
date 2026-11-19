/**
 * @module runDown — `local:down`, in the same safe order as `runUp`.
 *
 * It finds the project through `LOCAL_SANDBOX_PORT`, takes the project lock, and refuses unless this checkout runs the
 * project. It runs `docker compose -p <project> down`, which needs no file, and never reads `compose.yml`: an old or
 * foreign file cannot steer it. It keeps the Postgres volume, as before.
 *
 * @pattern Command over injected reads and one state-changing call, sharing the predicates of `local:up`.
 */
import path from 'node:path';

import { isHostLockHeldError, type HostLock } from './maestroLanes/hostLock.js';
import { dockerReadRefusal, isDockerReadError } from './dockerReadError.js';
import { isInvalidStackPortError, labelRefusal, refusalLine, stackFrom, type ComposeContainer } from './stackPorts.js';

const DOOR = 'local:down';

/** Everything `runDown` touches outside itself. */
export interface DownPorts {
    readonly env: Readonly<Record<string, string | undefined>>;
    /** This checkout. */
    readonly checkout: string;
    /** Resolves a path to its real path. */
    readonly canon: (value: string) => string;
    /** `<state root>/localSandbox`. */
    readonly stateDir: string;
    /** Every Compose container on the host, stopped ones included. Read only. */
    readonly containers: () => readonly ComposeContainer[];
    /** Takes the project lock, or throws `HostLockHeldError`. */
    readonly acquireLock: (file: string) => HostLock;
    /** Runs `docker compose -p <project> down`. Returns the exit code. */
    readonly down: (project: string) => number;
    /** Prints one stdout line. */
    readonly out: (line: string) => void;
    /** Prints one stderr line. */
    readonly err: (line: string) => void;
}

/**
 * Stop the stack the variable names.
 *
 * @param ports - The reads and the one state-changing call.
 * @returns The exit code. A refusal is one R9 line on stderr and `1`.
 * @sideEffect Takes and releases the project lock, and stops the project's containers.
 */
export function runDown(ports: DownPorts): number {
    let project: string;

    try {
        ({ project } = stackFrom(ports.env));
    } catch (error) {
        if (isInvalidStackPortError(error)) {
            ports.err(refusalLine(DOOR, error.refused, error.why, error.fix));

            return 1;
        }

        throw error;
    }

    let lock: HostLock;

    try {
        lock = ports.acquireLock(path.join(ports.stateDir, `${project}.lock`));
    } catch (error) {
        if (isHostLockHeldError(error)) {
            ports.err(
                refusalLine(
                    DOOR,
                    `project ${project}`,
                    `is being started or stopped by pid ${String(error.holderPid)}`,
                    'Wait for it to finish.',
                ),
            );

            return 1;
        }

        throw error;
    }

    try {
        const containers = ports.containers();
        const refusal = labelRefusal({
            door: DOOR,
            project,
            checkout: ports.checkout,
            containers,
            canon: ports.canon,
            fixes: {
                foreign: 'Run local:down there.',
                sibling: 'Set LOCAL_SANDBOX_PORT to the port that project uses.',
            },
        });

        if (refusal !== undefined) {
            ports.err(refusal);

            return 1;
        }

        if (!containers.some((container) => container.project === project)) {
            ports.out(`${DOOR}: project ${project} has no containers, so nothing was stopped.`);

            return 0;
        }

        return ports.down(project);
    } catch (error) {
        if (isDockerReadError(error)) {
            ports.err(dockerReadRefusal(DOOR, error));

            return 1;
        }

        throw error;
    } finally {
        lock.release();
    }
}
