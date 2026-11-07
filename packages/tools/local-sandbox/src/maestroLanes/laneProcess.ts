/**
 * One lane's process: the runner's run mode (`runMaestroFlows.sh` with no subcommand) under the lane's environment, in
 * its own process group, logging to the lane's own file. A lane owns no shared service; it starts and kills nothing but
 * its own runner.
 */
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { constants } from 'node:os';

import type { LaneSpec } from './laneTypes.js';

export type Env = Readonly<Record<string, string | undefined>>;

export interface LaneChild {
    readonly pid: number;
    /** The runner's exit code; a signal is `128 + n`, as a shell reports it. */
    readonly exit: Promise<number>;
    /** SIGTERM to the lane's whole process group. */
    stop(): void;
}

/**
 * Start a runner.
 *
 * @sideEffect Spawns `bash <script>` detached, writing stdout and stderr to `log`.
 */
export function spawnRunner(input: {
    readonly script: string;
    readonly cwd: string;
    readonly env: Env;
    readonly log: string;
}): LaneChild {
    const fd = openSync(input.log, 'w');
    const child = spawn('bash', [input.script], {
        cwd: input.cwd,
        env: input.env,
        stdio: ['ignore', fd, fd],
        detached: true,
    });
    closeSync(fd);

    const exit = new Promise<number>((resolve) => {
        child.on('error', () => resolve(1));
        child.on('exit', (code, signal) =>
            resolve(code ?? (signal === null ? 1 : 128 + (constants.signals[signal] ?? 0))),
        );
    });

    return {
        pid: child.pid ?? -1,
        exit,
        stop: () => {
            if (child.pid !== undefined) {
                try {
                    process.kill(-child.pid, 'SIGTERM');
                } catch {
                    // Already gone.
                }
            }
        },
    };
}

/**
 * The run-mode environment of one lane: the caller's environment, the runner's lane contract, the seed tools' lane
 * settings, then the device adapter's part, which wins. Pure.
 */
export function laneRunnerEnv(input: {
    readonly base: Env;
    readonly lane: LaneSpec;
    readonly selector: string;
    readonly lockDir: string;
    readonly adapterEnv: Readonly<Record<string, string>>;
}): Env {
    const { lane } = input;

    return {
        ...input.base,
        MAESTRO_PLATFORM: lane.platform,
        MAESTRO_FLOW_SELECTOR: input.selector,
        MAESTRO_SHARD_INDEX: String(lane.index),
        MAESTRO_SHARD_COUNT: String(lane.count),
        MAESTRO_DRIVER_PORT: String(lane.driverPort),
        MAESTRO_FIXTURE_ENV_FILE: lane.fixtureEnvFile,
        MAESTRO_LOCAL: '1',
        MAESTRO_LOCK_DIR: input.lockDir,
        COMMISE_E2E_SHARD: String(lane.index),
        E2E_SEED_STATE_DIR: lane.stateDir,
        E2E_POOL_NAMESPACE: 'local',
        // The five read-only role users are CI's shared ones; serving them by default is what keeps the role flows run
        // rather than skipped. The run-mode role lock covers the one that writes.
        E2E_ROLE_USERS_NAMESPACE: 'shared',
        ...input.adapterEnv,
    };
}
