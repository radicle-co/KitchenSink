import { execFileSync } from 'node:child_process';

/**
 * The top of the git repository that contains a folder.
 *
 * `npm run` moves into the package folder before it runs a script, so the current folder is the wrong place to start
 * from; the folder the person typed the command in is `INIT_CWD`.
 *
 * @sideEffect Runs `git rev-parse`.
 * @param cwd - The current folder.
 * @param initCwd - npm's `INIT_CWD`, when set; it wins.
 * @returns The absolute top-level folder.
 * @throws When the folder is not inside a git repository.
 */
export function findRepoRoot(cwd: string, initCwd?: string): string {
    const start = initCwd !== undefined && initCwd !== '' ? initCwd : cwd;

    try {
        return execFileSync('git', ['rev-parse', '--show-toplevel'], {
            cwd: start,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        throw new Error(`error: ${start} is not inside a git repository`);
    }
}
