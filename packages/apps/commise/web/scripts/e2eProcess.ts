/**
 * The process helpers of the local Playwright door.
 */
import { spawnSync, type ChildProcess } from 'node:child_process';

import type { Env } from './e2eEnv';

export const sleep = (seconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/**
 * Runs a command with inherited output.
 *
 * @sideEffect Spawns the command and waits.
 * @param command - The program.
 * @param args - Its arguments.
 * @param env - Its environment.
 * @returns Its exit status, 1 when it has none.
 */
export const run = (command: string, args: readonly string[], env: Env): number =>
    spawnSync(command, args, { stdio: 'inherit', env: env as NodeJS.ProcessEnv }).status ?? 1;

export const waitForExit = (child: ChildProcess): Promise<number | null> =>
    new Promise((resolve) => {
        child.on('exit', (code) => resolve(code));
        child.on('error', () => resolve(1));
    });
