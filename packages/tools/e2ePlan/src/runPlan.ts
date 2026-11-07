import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { parsePlanJson, type PlanJson } from './planJson.js';

const run = promisify(execFile);

const PLAN_BIN = resolve(import.meta.dirname, '../bin/plan.ts');

/**
 * Asks the selector what a change affects, the way a door does: by running the bin and reading its JSON.
 *
 * @sideEffect Spawns `tsx bin/plan.ts` in `repo`, which runs git and builds the import graphs (several seconds).
 * @param repo - The repository root.
 * @param env - The environment the selector sees (`FULL_SUITE`, `TURBO_SCM_BASE`).
 * @returns The plan.
 * @throws When the bin cannot run or prints something that is not a plan. The caller must then run everything.
 */
export async function runPlan(repo: string, env: NodeJS.ProcessEnv): Promise<PlanJson> {
    const { stdout } = await run('npx', ['tsx', PLAN_BIN, '--json', '--repo', repo], {
        cwd: repo,
        env,
        maxBuffer: 64 * 1024 * 1024,
    });

    return parsePlanJson(stdout);
}
