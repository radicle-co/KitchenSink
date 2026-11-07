/**
 * The working tree as one git tree object, and the files that differ between two trees.
 *
 * A tree is the only description of "the code as it is now" that covers staged, unstaged and untracked files with one
 * hash, so a stamp can name it and a later run can diff against it. The snapshot is built in a COPY of the index, so a
 * person's staged files are never touched.
 */
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function git(repo: string, args: readonly string[], env?: Readonly<Record<string, string>>): Promise<string> {
    const { stdout } = await run('git', [...args], {
        cwd: repo,
        maxBuffer: 256 * 1024 * 1024,
        ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
    });

    return stdout;
}

/**
 * Writes the working tree (tracked, staged and untracked files, minus what git ignores) as a tree object.
 *
 * @sideEffect Writes blob and tree objects into the repository's object store, and a temporary index file that it
 * removes. The repository's own index is only read.
 * @param repo - The repository root.
 * @returns The tree hash. The same files always give the same hash.
 */
export async function snapshotTree(repo: string): Promise<string> {
    const index = (await git(repo, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])).trim();
    const dir = await mkdtemp(join(tmpdir(), 'e2eSnapshot-'));
    const scratch = join(dir, 'index');

    try {
        // A repository with no index yet (nothing ever staged) starts the copy empty.
        await copyFile(index, scratch).catch(() => undefined);

        const env = { GIT_INDEX_FILE: scratch };

        await git(repo, ['add', '-A', '--', '.'], env);

        return (await git(repo, ['write-tree'], env)).trim();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

/**
 * Whether the repository still holds this tree object. A stamp whose tree was garbage-collected cannot be diffed from.
 *
 * @sideEffect Runs git.
 * @param repo - The repository root.
 * @param tree - A tree hash.
 * @returns True when it exists.
 */
export async function treeExists(repo: string, tree: string): Promise<boolean> {
    return git(repo, ['cat-file', '-e', `${tree}^{tree}`]).then(
        () => true,
        () => false,
    );
}

/**
 * The files whose content or existence differs between two trees (or commits).
 *
 * Renames are turned off on purpose: a rename then arrives as a delete and an add, so both names are listed, and the
 * old name's importers are checked, without a second code path for renames. The output is NUL-separated, so a path
 * with spaces or newlines stays whole.
 *
 * @sideEffect Runs git.
 * @param repo - The repository root.
 * @param from - The older tree-ish.
 * @param to - The newer tree-ish.
 * @returns Sorted repo-relative paths, each once.
 */
export async function changedBetween(repo: string, from: string, to: string): Promise<readonly string[]> {
    const out = await git(repo, ['diff-tree', '-r', '--no-renames', '--name-only', '-z', from, to]);

    return [...new Set(out.split('\0').filter((path) => path !== ''))].sort();
}
