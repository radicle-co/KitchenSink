/**
 * @module runUp — the order of `local:up`, with the stages injected.
 *
 * The order is the safety: the value check, the project lock, the ownership read and every ownership refusal, the
 * synth and the port preflight, and only then the owner record and the stage that builds, writes and starts. A refusal
 * leaves no trace on disk and no Docker call that changes state. The lock is held from before the ownership read to
 * after the last call, so two runs for one project cannot both pass the read and then recreate each other's containers.
 *
 * @pattern Facade over injected stages: `bin/up.ts` supplies the real ones, and the tests supply recording stubs.
 */
import path from 'node:path';

import { portConflicts } from './localImages.js';
import { isHostLockHeldError, type HostLock } from './maestroLanes/hostLock.js';
import {
    isInvalidStackPortError,
    ownershipRefusal,
    refusalLine,
    stackFrom,
    type ComposeContainer,
    type Stack,
} from './stackPorts.js';

const DOOR = 'local:up';

/** Everything `runUp` touches outside itself. */
export interface UpPorts {
    readonly env: Readonly<Record<string, string | undefined>>;
    /** This checkout. */
    readonly checkout: string;
    /** Resolves a path to its real path. */
    readonly canon: (value: string) => string;
    /** `<state root>/localSandbox`: holds each project's lock and owner record. */
    readonly stateDir: string;
    /** Every Compose container on the host, stopped ones included (`docker ps -a`). Read only. */
    readonly containers: () => readonly ComposeContainer[];
    /** Whether the project's Postgres volume exists. Read only. */
    readonly volumeExists: (project: string) => boolean;
    /** Every host port something listens on. Read only. */
    readonly listening: () => readonly number[];
    /** The host ports the project's own running containers publish. Read only. */
    readonly publishedBy: (project: string) => readonly number[];
    readonly readRecord: (file: string) => string | undefined;
    readonly writeRecord: (file: string, checkout: string) => void;
    /** Takes the project lock, or throws `HostLockHeldError`. */
    readonly acquireLock: (file: string) => HostLock;
    /**
     * Synthesises and works out every host port the stack needs. Writes nothing under the generated folder.
     *
     * @returns The ports, or `undefined` when it already printed why it cannot go on.
     */
    readonly discover: (
        stack: Stack,
    ) => Promise<readonly { readonly name: string; readonly hostPort: number }[] | undefined>;
    /** Builds, writes and starts everything. Returns the exit code. */
    readonly materialize: (stack: Stack) => Promise<number>;
    /** Prints one stderr line. */
    readonly err: (line: string) => void;
}

/**
 * Run `local:up` in its safe order.
 *
 * @param ports - The stages and the reads.
 * @returns The exit code. A refusal is one R9 line on stderr and `1`.
 * @sideEffect Takes and releases the project lock, writes the owner record, and runs the stages.
 */
export async function runUp(ports: UpPorts): Promise<number> {
    let stack: Stack;

    try {
        stack = stackFrom(ports.env);
    } catch (error) {
        if (isInvalidStackPortError(error)) {
            ports.err(refusalLine(DOOR, error.refused, error.why, error.fix));

            return 1;
        }

        throw error;
    }

    let lock: HostLock;

    try {
        lock = ports.acquireLock(path.join(ports.stateDir, `${stack.project}.lock`));
    } catch (error) {
        if (isHostLockHeldError(error)) {
            ports.err(
                refusalLine(
                    DOOR,
                    `project ${stack.project}`,
                    `is being started or stopped by pid ${String(error.holderPid)}`,
                    'Wait for it to finish.',
                ),
            );

            return 1;
        }

        throw error;
    }

    try {
        const recordFile = path.join(ports.stateDir, `${stack.project}.owner`);
        const refusal = ownershipRefusal({
            door: DOOR,
            project: stack.project,
            checkout: ports.checkout,
            containers: ports.containers(),
            volumeExists: ports.volumeExists(stack.project),
            record: ports.readRecord(recordFile),
            recordFile,
            canon: ports.canon,
        });

        if (refusal !== undefined) {
            ports.err(refusal);

            return 1;
        }

        const wanted = await ports.discover(stack);

        if (wanted === undefined) {
            return 1;
        }

        const clashes = portConflicts(wanted, ports.listening(), ports.publishedBy(stack.project));

        if (clashes.length > 0) {
            ports.err(
                refusalLine(
                    DOOR,
                    'host port(s) already in use:',
                    clashes.map((clash) => `${clash.name} :${String(clash.hostPort)}`).join(', '),
                    'Free them, or pick another LOCAL_SANDBOX_PORT.',
                ),
            );

            return 1;
        }

        ports.writeRecord(recordFile, ports.checkout);

        return await ports.materialize(stack);
    } finally {
        lock.release();
    }
}
