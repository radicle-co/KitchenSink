import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import type { Platform } from './greenStamp.js';
import { parsePlanJson, type PlanJson } from './planJson.js';

const run = promisify(execFile);

/** Long enough for a cold run on a big diff (measured at about 15 s), short enough that a hang costs the suite, not the run. */
const PLAN_TIMEOUT_MS = 120_000;

const PLAN_BIN = resolve(import.meta.dirname, '../bin/plan.ts');

/**
 * Asks the selector what a change affects, the way a door does: by running the bin and reading its JSON.
 *
 * @sideEffect Spawns `tsx bin/plan.ts` in `repo`, which runs git and builds the import graphs (several seconds).
 * @param repo - The repository root.
 * @param env - The environment the selector sees (`FULL_SUITE`, `TURBO_SCM_BASE`).
 * @param options - `platform`: the suite the door runs, which lets a local run measure from its green stamp;
 * `timeoutMs`: how long to wait.
 * @returns The plan.
 * @throws When the bin cannot run, times out, or prints something that is not a plan. The caller must then run everything.
 */
export async function runPlan(
    repo: string,
    env: NodeJS.ProcessEnv,
    options: { readonly platform?: Platform; readonly timeoutMs?: number } = {},
): Promise<PlanJson> {
    const { platform, timeoutMs = PLAN_TIMEOUT_MS } = options;
    const { stdout } = await run(
        'npx',
        ['tsx', PLAN_BIN, '--json', '--repo', repo, ...(platform ? ['--platform', platform] : [])],
        {
            cwd: repo,
            env,
            timeout: timeoutMs,
            killSignal: 'SIGKILL',
            maxBuffer: 64 * 1024 * 1024,
        },
    );

    return parsePlanJson(stdout);
}
