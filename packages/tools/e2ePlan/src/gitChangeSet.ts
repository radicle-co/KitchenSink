/**
 * The files a change touches: everything between a starting point and the working tree.
 *
 * The starting point is either the merge base with a base branch (so a base branch that moved on is not read as this
 * branch's change) or a tree recorded by the last green run. The working tree is snapshotted as a tree object, so
 * staged, unstaged and untracked files, new directories and both names of a rename all arrive from one diff, and
 * nothing here changes the process working directory.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { changedBetween, snapshotTree } from './worktreeSnapshot.js';

const run = promisify(execFile);

export interface ChangeSet {
    /** Repo-relative paths, sorted, each once. */
    readonly files: readonly string[];
    /** The tree of the working tree these files were measured against. A stamp names it. */
    readonly tree: string;
}

export interface MergeBaseChangeSet extends ChangeSet {
    /** The commit the change is measured from. */
    readonly mergeBase: string;
}

/**
 * Lists what changed since a recorded commit or tree.
 *
 * @sideEffect Runs git in `repo` and writes tree objects (see `snapshotTree`).
 * @param repo - The repository root.
 * @param from - A commit or tree hash.
 * @returns The files and the tree they were measured against.
 */
export async function changedSince(repo: string, from: string): Promise<ChangeSet> {
    const tree = await snapshotTree(repo);

    return { files: await changedBetween(repo, from, tree), tree };
}

/**
 * Lists the changed files since the merge base with a base branch.
 *
 * @sideEffect Runs git in `repo` and writes tree objects (see `snapshotTree`).
 * @param repo - The repository root.
 * @param baseRef - The branch or commit to compare against, e.g. `origin/main`.
 * @returns The files, the tree and the merge base.
 * @throws When `baseRef` does not exist or there is no common ancestor.
 */
export async function changedFiles(repo: string, baseRef: string): Promise<MergeBaseChangeSet> {
    const mergeBase = (
        await run('git', ['merge-base', 'HEAD', baseRef], { cwd: repo }).catch(() => {
            throw new Error(`error: cannot find a merge base between HEAD and ${baseRef}`);
        })
    ).stdout.trim();

    return { ...(await changedSince(repo, mergeBase)), mergeBase };
}
