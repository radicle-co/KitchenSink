/**
 * @module publish/gitCanvasHistory — what git knows about a canvas folder: main's commit, a commit's blob oids, the
 * commit that added the snapshot, ancestry, and a blob's bytes.
 *
 * @pattern Port + Adapter — it reuses the {@link RunGit} port from `sources/gitHead`; a test can script it.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { DesignArtifactError } from '../errors.js';
import { SHA_PATTERN } from '../sources/gitHead.js';
import type { RunGit } from '../sources/gitHead.js';

/** Repo-relative folder that holds the canvases. */
export const CANVASES_DIR = 'docs/design/canvases';

/** The folder, inside a canvas's `project/`, that holds its LFS images. */
export const CANVAS_ASSETS_DIR = 'assets';

/** The ref a publish is made from. */
export const MAIN_REF = 'origin/main';

function oneSha(output: string, what: string): string {
    const sha = output.trim();

    if (!SHA_PATTERN.test(sha)) {
        throw new DesignArtifactError(
            'missing-source',
            `Git did not answer a commit for ${what}: ${JSON.stringify(sha)}`,
        );
    }

    return sha;
}

/**
 * Resolves `origin/main`.
 *
 * @param run - Runs git in the repository.
 * @returns The full commit id.
 * @throws DesignArtifactError `missing-source` when the ref does not exist (fetch first).
 */
export async function resolveMain(run: RunGit): Promise<string> {
    return oneSha(await run(['rev-parse', '--verify', `${MAIN_REF}^{commit}`]), MAIN_REF);
}

/**
 * Reads one canvas's tree at a commit.
 *
 * @param run - Runs git in the repository.
 * @param sha - The commit.
 * @param folder - The canvas folder name (a registry-validated single segment).
 * @returns Blob oid by canvas-relative path (`project/…`, `snapshot.json`). Empty when the folder is absent there.
 */
export async function canvasTree(run: RunGit, sha: string, folder: string): Promise<Map<string, string>> {
    const prefix = `${CANVASES_DIR}/${folder}/`;
    const out = await run(['ls-tree', '-r', '-z', sha, '--', prefix]);
    const tree = new Map<string, string>();

    for (const entry of out.split('\0').filter(Boolean)) {
        const tab = entry.indexOf('\t');
        const [, , oid = ''] = entry.slice(0, tab).split(' ');
        tree.set(entry.slice(tab + 1).slice(prefix.length), oid);
    }

    return tree;
}

/**
 * Whether a canvas folder differs between two commits.
 *
 * @param run - Runs git in the repository.
 * @param a - One commit.
 * @param b - The other commit.
 * @param folder - The canvas folder name.
 * @returns `true` when any file under the folder differs.
 */
export async function canvasDiffers(run: RunGit, a: string, b: string, folder: string): Promise<boolean> {
    return (await run(['diff', '--name-only', a, b, '--', `${CANVASES_DIR}/${folder}/`])).trim() !== '';
}

/**
 * Finds the commit that added a canvas's `snapshot.json` on main's first-parent line.
 *
 * @param run - Runs git in the repository.
 * @param main - The main commit to search back from.
 * @param folder - The canvas folder name.
 * @returns The commit id.
 * @throws DesignArtifactError `missing-source` when the folder has no snapshot on main.
 */
export async function snapshotCommit(run: RunGit, main: string, folder: string): Promise<string> {
    const out = await run([
        'log',
        '--first-parent',
        '--diff-filter=A',
        '-1',
        '--format=%H',
        main,
        '--',
        `${CANVASES_DIR}/${folder}/snapshot.json`,
    ]);

    return oneSha(out, `the snapshot of ${folder}`);
}

/**
 * Whether `sha` is a commit reachable from `main`.
 *
 * @param run - Runs git in the repository.
 * @param sha - The commit asked about.
 * @param main - The tip to search from.
 * @returns `false` for an unknown object or a commit that is not an ancestor; any other git failure is rethrown.
 */
export async function isAncestor(run: RunGit, sha: string, main: string): Promise<boolean> {
    try {
        await run(['merge-base', '--is-ancestor', sha, main]);

        return true;
    } catch (error) {
        const code = (error as { code?: unknown }).code;

        if (code === 1 || code === 128) {
            return false;
        }

        throw error;
    }
}

/**
 * Reads a file at `main` as text (the registry).
 *
 * @param run - Runs git in the repository.
 * @param main - The commit.
 * @param path - Repo-relative path.
 * @returns The file's text.
 */
export async function showText(run: RunGit, main: string, path: string): Promise<string> {
    return run(['show', `${main}:${path}`]);
}

const LFS_POINTER_START = 'version https://git-lfs.github.com/spec/v1\n';

/**
 * Whether bytes are a Git LFS pointer file instead of the content it stands for.
 *
 * @param bytes - A blob read from git.
 * @returns `true` when it starts with the LFS pointer header.
 */
export function isLfsPointer(bytes: Buffer): boolean {
    return bytes.subarray(0, LFS_POINTER_START.length).toString('latin1') === LFS_POINTER_START;
}

/**
 * The `git` arguments that fetch the LFS images of canvas folders (`.lfsconfig` excludes them from an ordinary fetch).
 *
 * @param folders - The canvas folder names.
 * @returns The arguments, with one `--include` list for all the folders.
 */
export function lfsPullArgs(folders: readonly string[]): string[] {
    const include = folders.map((folder) => `${CANVASES_DIR}/${folder}/project/${CANVAS_ASSETS_DIR}/**`).join(',');

    return ['-c', 'lfs.fetchexclude=', 'lfs', 'pull', `--include=${include}`];
}

/**
 * {@link lfsPullArgs} as the shell command a person runs.
 *
 * @param folders - The canvas folder names.
 * @returns The command, the include list quoted.
 */
export function lfsPullCommand(...folders: readonly string[]): string {
    return `git ${lfsPullArgs(folders)
        .join(' ')
        .replace(/--include=(\S+)$/u, "--include='$1'")}`;
}

function lfsMissing(folder: string, path: string, detail = ''): DesignArtifactError {
    return new DesignArtifactError(
        'lfs-object-missing',
        `${CANVASES_DIR}/${folder}/${path} is a Git LFS file whose content is not on this machine. Run: ${lfsPullCommand(folder)}${detail}`,
    );
}

function stderrText(error: unknown): string {
    return typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr).trim() : '';
}

/**
 * Reads one blob's exact bytes, through the repository's filters so an LFS path yields the real file.
 *
 * @sideEffect Spawns `git`. With `.lfsconfig` `fetchexclude` the smudge filter answers the pointer instead of
 * downloading, which the pointer check then reports.
 * @param cwd - The repository.
 * @param main - The commit.
 * @param folder - The canvas folder name.
 * @param path - Canvas-relative path.
 * @returns The bytes, never decoded as a string.
 * @throws DesignArtifactError `lfs-object-missing` when an image path is an LFS pointer, or its LFS filter fails; the
 * message carries git's stderr in the second case.
 */
export async function blobBytes(cwd: string, main: string, folder: string, path: string): Promise<Buffer> {
    let stdout: Buffer;

    try {
        ({ stdout } = await promisify(execFile)(
            'git',
            ['cat-file', '--filters', `${main}:${CANVASES_DIR}/${folder}/${path}`],
            { cwd, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 },
        ));
    } catch (error) {
        // A required LFS filter that cannot fetch its object fails the whole command.
        if (path.startsWith(`project/${CANVAS_ASSETS_DIR}/`)) {
            const detail = stderrText(error);

            throw lfsMissing(folder, path, detail === '' ? '' : `\ngit said: ${detail}`);
        }

        throw error;
    }

    if (isLfsPointer(stdout)) {
        throw lfsMissing(folder, path);
    }

    return stdout;
}
