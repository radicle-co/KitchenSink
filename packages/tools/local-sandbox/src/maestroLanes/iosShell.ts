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
            const exited = new Promise<void>((resolve) => {
                child.once('exit', () => {
                    resolve();
                });
            });

            return {
                stop: async () => {
                    if (child.pid !== undefined && child.exitCode === null) {
                        process.kill(-child.pid, 'SIGTERM');
                    }

                    await exited;
                },
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
