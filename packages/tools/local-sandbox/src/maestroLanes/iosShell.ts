/**
 * The real {@link IosShell}: child processes and the file system, for the iOS adapter.
 *
 * @pattern Adapter over node:child_process and node:fs, behind the IosShell port.
 * @sideEffect Spawns processes and writes files.
 */
import { execFile, spawn } from 'node:child_process';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { IosShell } from './iosAdapter.js';
import { exitOf } from './laneProcess.js';

export function createIosShell(): IosShell {
    return {
        run: (command, args, env) =>
            new Promise<string>((resolve, reject) => {
                execFile(
                    command,
                    [...args],
                    { env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 },
                    (error, stdout, stderr) => {
                        if (error === null) {
                            resolve(stdout);
                        } else {
                            reject(new Error(`${command} ${args.join(' ')} failed: ${stderr.trim() || error.message}`));
                        }
                    },
                );
            }),
        background: (command, args) => {
            const child = spawn(command, [...args], { stdio: 'ignore', detached: true });
            const exited = exitOf(child);

            return {
                stop: async () => {
                    // A child killed by a signal has no exit code but is gone: its group no longer exists to signal.
                    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
                        process.kill(-child.pid, 'SIGTERM');
                    }

                    await exited;
                },
                exited,
            };
        },
        writeFile: async (file, content) => {
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file, content);
        },
        linkFile: async (target, link) => {
            await mkdir(path.dirname(link), { recursive: true });
            await rm(link, { force: true });
            await symlink(target, link);
        },
    };
}
