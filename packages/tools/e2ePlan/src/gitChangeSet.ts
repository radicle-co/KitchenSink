/**
 * The files a change touches: everything between the merge base with the base branch and the working tree.
 *
 * The diff itself is watskeburt's. This module adds only what a selector needs and a diff does not give: the merge
 * base (so a base branch that moved on is not read as this branch's change), both names of a rename, and the files
 * inside a new directory, which `git status` reports as one entry.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { list, type IChange } from 'watskeburt';

const run = promisify(execFile);

export interface ChangeSet {
    /** Repo-relative paths, sorted, each once. */
    readonly files: readonly string[];
    /** The commit the change is measured from. */
    readonly mergeBase: string;
}

/**
 * Flattens a change list into the paths whose content or existence changed.
 *
 * @param changes - Watskeburt's changes.
 * @returns Sorted unique paths: a rename counts under both names, because the old name's importers just broke.
 */
export function pathsOf(changes: readonly IChange[]): readonly string[] {
    return [
        ...new Set(
            changes.flatMap((change) => [change.name, ...(change.oldName === undefined ? [] : [change.oldName])]),
        ),
    ].sort();
}

async function git(repo: string, args: readonly string[]): Promise<string> {
    return (await run('git', [...args], { cwd: repo, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();
}

/**
 * Lists the changed files.
 *
 * @sideEffect Runs git in `repo`, and sets the process working directory to it while watskeburt (which reads
 * `process.cwd()` and takes no directory) runs.
 * @param repo - The repository root.
 * @param baseRef - The branch or commit to compare against, e.g. `origin/main`.
 * @returns The files and the merge base.
 * @throws When `baseRef` does not exist or there is no common ancestor.
 */
export async function changedFiles(repo: string, baseRef: string): Promise<ChangeSet> {
    const mergeBase = await git(repo, ['merge-base', 'HEAD', baseRef]).catch(() => {
        throw new Error(`error: cannot find a merge base between HEAD and ${baseRef}`);
    });
    const before = process.cwd();

    process.chdir(repo);

    try {
        const changes = await list({ oldRevision: mergeBase });
        const paths = await Promise.all(
            pathsOf(changes).map(async (path) =>
                path.endsWith('/')
                    ? (await git(repo, ['ls-files', '--others', '--exclude-standard', '--', path]))
                          .split('\n')
                          .filter(Boolean)
                    : [path],
            ),
        );

        return { files: [...new Set(paths.flat())].sort(), mergeBase };
    } finally {
        process.chdir(before);
    }
}
