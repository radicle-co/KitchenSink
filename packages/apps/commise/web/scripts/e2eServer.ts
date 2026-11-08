/**
 * The ONE `next start` every lane drives, and the environments that point the build, the server and the lanes at dead
 * API origins.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';

import { processEnv, type Env } from '@kitchensink/e2e-plan/stampRun';

import { LANE_LOG_DIR } from './e2ePaths';
import { sleep } from './e2eProcess';

/** An address nothing listens on: the discard port. A call to it is REFUSED, as CI's identity and food ports are. */
export const DEAD_ORIGIN = 'http://127.0.0.1:9';

const ORIGIN_VARS = ['NEXT_PUBLIC_RECIPE_API_URL', 'NEXT_PUBLIC_IDENTITY_API_URL', 'NEXT_PUBLIC_FOOD_API_URL'] as const;

export const deadOrigins = (): Record<string, string> =>
    Object.fromEntries(ORIGIN_VARS.map((name) => [name, DEAD_ORIGIN]));

/**
 * Whether the lanes share ONE `next start`. They can: a lane differs from another only by its Clerk pool user and its
 * blob folder, both held by the Playwright process and the browser, and the web app reads no end-to-end setting and
 * keeps nothing per user between requests. The default is to share; `E2E_SHARED_SERVER=0` gives each lane its own
 * server again. The dev server is never shared: it compiles a route on its first request, inside whichever
 * lane's assertion asked.
 *
 * @param env - The caller's environment.
 * @returns True when one server serves every lane.
 */
export const wantsSharedServer = (env: Env): boolean =>
    env['E2E_SHARED_SERVER'] !== '0' && env['E2E_WEB_SERVER'] !== 'dev';

/**
 * The environment of the one server the lanes share: what the config's `webServer` would have given a lane's own.
 *
 * @param base - The caller's environment.
 * @param port - The port it serves on.
 * @returns A copy that serves the finished build, with every API origin dead.
 */
export function serverEnv(base: Env, port: number): Env {
    const { E2E_BUILD_ONLY: _buildOnly, ...rest } = base;

    return { ...rest, ...deadOrigins(), PORT: String(port), COMMISE_PSEUDO_LOCALE: '1' };
}

/** How long a freshly started server has to answer before the run gives up on it. */
const SERVER_READY_MS = 120_000;

export interface SharedServer {
    /** Stops the server and everything it started. */
    readonly stop: () => Promise<void>;
}

/**
 * Starts the ONE `next start` that every lane drives, and waits until it answers.
 *
 * The server is a child in its own process group, so stopping it cannot leave a Next worker behind, and it is stopped
 * when this process exits however it exits.
 *
 * @sideEffect Spawns `npm run start`, writes its log to `test-results/lanes/server.log`, and polls it over HTTP.
 * @param env - The caller's environment.
 * @param port - The port to serve on.
 * @returns A handle that stops it.
 * @throws When the server exits or does not answer in time.
 */
export async function startSharedServer(env: Env, port: number): Promise<SharedServer> {
    mkdirSync(LANE_LOG_DIR, { recursive: true });

    const log = openSync(`${LANE_LOG_DIR}/server.log`, 'w');
    const child = spawn('npm', ['run', 'start'], {
        env: processEnv(serverEnv(env, port)),
        stdio: ['ignore', log, log],
        detached: true,
    });
    const pid = child.pid;
    let exited = false;

    child.on('exit', () => {
        exited = true;
    });

    const kill = (signal: NodeJS.Signals): void => {
        try {
            if (pid !== undefined) {
                process.kill(-pid, signal);
            }
        } catch {
            // Already gone.
        }
    };

    const stop = async (): Promise<void> => {
        kill('SIGTERM');

        for (let waited = 0; !exited && waited < 5000; waited += 100) {
            await sleep(0.1);
        }

        kill('SIGKILL');
    };

    process.once('exit', () => kill('SIGKILL'));

    const url = `http://localhost:${port}/${env['E2E_LOCALE'] ?? 'en'}/sign-in`;

    for (let waited = 0; waited < SERVER_READY_MS; waited += 500) {
        if (exited) {
            throw new Error(`error: the shared web server exited before it answered (see ${LANE_LOG_DIR}/server.log)`);
        }

        const answered = await fetch(url).then(
            (response) => response.ok,
            () => false,
        );

        if (answered) {
            console.log(
                `▶ web server     : one shared \`next start\` on port ${port} (log ${LANE_LOG_DIR}/server.log)`,
            );

            return { stop };
        }

        await sleep(0.5);
    }

    await stop();

    throw new Error(`error: the shared web server did not answer ${url} within ${SERVER_READY_MS / 1000}s`);
}
