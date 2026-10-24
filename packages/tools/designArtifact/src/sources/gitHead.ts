/**
 * @module sources/gitHead — the commit the artifact is built from.
 *
 * @pattern Port (Ports and Adapters) — {@link GitHeadReader} is a function type; {@link execGitHead} runs `git`.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { DesignArtifactError } from '../errors.js';
import type { BuildStamp } from '../readme/stampReadme.js';

/** Answers with the commit the working tree is at. */
export type GitHeadReader = () => Promise<BuildStamp>;

const SHA = /^[0-9a-f]{40}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/u;

/**
 * Reads the output of `git show -s --format=%H%n%cI HEAD`.
 *
 * @param output - The command's standard output.
 * @returns The commit id and its committer date.
 * @throws DesignArtifactError `missing-source` for anything that is not a full commit id on one line and an ISO date
 * on the next.
 */
export function parseGitHead(output: string): Omit<BuildStamp, 'dirty'> {
    const [sha = '', date = ''] = output.trim().split('\n');

    if (!SHA.test(sha) || !ISO_DATE.test(date)) {
        throw new DesignArtifactError(
            'missing-source',
            `Could not read the git HEAD commit from: ${JSON.stringify(output)}`,
        );
    }

    return { sha, date };
}

/** Runs `git <args>` and answers its standard output. */
export type RunGit = (args: readonly string[]) => Promise<string>;

function execGit(cwd: string): RunGit {
    /** @sideEffect Spawns `git`. */
    return async (args) => (await promisify(execFile)('git', [...args], { cwd })).stdout;
}

/**
 * The adapter that asks git: the HEAD commit, and whether the working tree differs from it (any line of
 * `git status --porcelain`, untracked files included, because an untracked source file is part of what was built).
 *
 * @param cwd - A directory inside the repository.
 * @param run - How git is run; a test supplies a scripted one.
 * @returns A reader of HEAD.
 */
export function execGitHead(cwd: string, run: RunGit = execGit(cwd)): GitHeadReader {
    /** @sideEffect Spawns `git`. */
    return async () => {
        const head = parseGitHead(await run(['show', '-s', '--format=%H%n%cI', 'HEAD']));
        const status = await run(['status', '--porcelain']);

        return { ...head, dirty: status.trim().length > 0 };
    };
}
