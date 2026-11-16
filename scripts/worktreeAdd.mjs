#!/usr/bin/env node
/**
 * `npm run worktree:add -- <path> <branch> [<start-point>]`: `git worktree add -b`, then a `node_modules` for the new
 * worktree that matches ITS lockfile.
 *
 * Why: a worktree with no `node_modules` resolves packages from the main checkout's, which is often stale against the
 * worktree's lockfile. Here every worktree gets its own `node_modules` trees (the root one and each workspace's),
 * hard-linked (`cp -al`) from a shared install keyed by the sha256 of its `package-lock.json`, at
 * `$KS_INSTALL_ROOT` (default `~/.local/state/kitchensink/installs/<hash>/`). One `npm ci` per distinct lockfile, one
 * copy of the bytes on disk.
 *
 * Failure safety: a missing install is built by `npm ci` in the new worktree, snapshotted into a `.tmp-*` directory
 * of the install root and only then renamed to `<hash>`. A killed run leaves a `.tmp-*` directory, which nothing
 * reuses and the next run's prune sweeps, never a half install under a real hash.
 *
 * Pruning keeps the newest installs (an install is touched whenever it is used) and never deletes one whose hash is
 * a current worktree's lockfile (`git worktree list --porcelain`).
 *
 * shortcut: hard links need the install root and the worktree on one filesystem; on another `cp -al` fails loudly,
 * upgrade to a plain copy fallback only if that setup ever appears.
 *
 * @sideEffect Runs git and npm, and writes under the install root and the new worktree.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

const KEEP = 3;
const STALE_TMP_MS = 24 * 60 * 60 * 1000;
const TMP_PREFIX = '.tmp-';

/**
 * The key of an install: the sha256 of the lockfile bytes.
 *
 * @param {Buffer} lockfile - The `package-lock.json` bytes.
 * @returns {string} Lowercase hex.
 */
export function lockfileHash(lockfile) {
    return createHash('sha256').update(lockfile).digest('hex');
}

/**
 * Which installs to delete: all but the newest `keep`, except any whose hash a live worktree still uses.
 *
 * Pure.
 *
 * @param {readonly { hash: string, mtimeMs: number }[]} installs - What is on disk.
 * @param {number} keep - How many of the newest to keep.
 * @param {ReadonlySet<string>} protectedHashes - Lockfile hashes of the current worktrees.
 * @returns {string[]} The hashes to delete, newest first.
 */
export function installsToPrune(installs, keep, protectedHashes) {
    return [...installs]
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(keep)
        .map((install) => install.hash)
        .filter((hash) => !protectedHashes.has(hash));
}

/**
 * The worktree paths in `git worktree list --porcelain` output.
 *
 * Pure.
 *
 * @param {string} porcelain - The command output.
 * @returns {string[]} Absolute paths, main checkout first.
 */
export function worktreePaths(porcelain) {
    return porcelain
        .split('\n')
        .filter((line) => line.startsWith('worktree '))
        .map((line) => line.slice('worktree '.length));
}

/** Every `node_modules` directory under `root`, as paths relative to it, without descending into one. */
function nodeModulesDirs(root, dir = root) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (!entry.isDirectory() || entry.name === '.git') {
            return [];
        }

        const full = join(dir, entry.name);

        return entry.name === 'node_modules' ? [relative(root, full)] : nodeModulesDirs(root, full);
    });
}

/** Hard-link every `node_modules` tree of `from` into the same relative place under `to`. */
function linkTrees(from, to) {
    for (const rel of nodeModulesDirs(from)) {
        mkdirSync(join(to, rel, '..'), { recursive: true });
        execFileSync('cp', ['-al', join(from, rel), join(to, rel)]);
    }
}

const hashOf = (dir) => {
    const file = join(dir, 'package-lock.json');

    return existsSync(file) ? lockfileHash(readFileSync(file)) : undefined;
};

function prune(installRoot, repoRoot) {
    const live = new Set(
        worktreePaths(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }))
            .map(hashOf)
            .filter((hash) => hash !== undefined),
    );
    const entries = readdirSync(installRoot).map((name) => ({
        name,
        mtimeMs: statSync(join(installRoot, name)).mtimeMs,
    }));

    for (const { name, mtimeMs } of entries) {
        if (name.startsWith(TMP_PREFIX) && Date.now() - mtimeMs > STALE_TMP_MS) {
            rmSync(join(installRoot, name), { recursive: true, force: true });
        }
    }

    const installs = entries
        .filter((entry) => !entry.name.startsWith(TMP_PREFIX))
        .map((e) => ({ hash: e.name, mtimeMs: e.mtimeMs }));

    for (const hash of installsToPrune(installs, KEEP, live)) {
        rmSync(join(installRoot, hash), { recursive: true, force: true });
    }
}

/**
 * Adds the worktree and gives it an install.
 *
 * @param {{ path: string, branch: string, startPoint?: string, installRoot: string, cwd: string }} input - The request.
 * @returns {void}
 * @sideEffect See the file header.
 */
export function worktreeAdd({ path, branch, startPoint, installRoot, cwd }) {
    execFileSync('git', ['worktree', 'add', '-b', branch, path, ...(startPoint === undefined ? [] : [startPoint])], {
        cwd,
        stdio: 'inherit',
    });

    const hash = hashOf(path);

    if (hash === undefined) {
        throw new Error(`${path} has no package-lock.json, so there is no install to key`);
    }

    mkdirSync(installRoot, { recursive: true });

    const shared = join(installRoot, hash);

    if (existsSync(shared)) {
        linkTrees(shared, path);
        utimesSync(shared, new Date(), new Date());
    } else {
        execFileSync('npm', ['ci'], { cwd: path, stdio: 'inherit' });

        const tmp = join(installRoot, `${TMP_PREFIX}${hash}-${process.pid}`);

        rmSync(tmp, { recursive: true, force: true });

        try {
            mkdirSync(tmp);
            linkTrees(path, tmp);
            renameSync(tmp, shared);
        } catch (error) {
            rmSync(tmp, { recursive: true, force: true });

            // A concurrent run published the same install first: ours is a duplicate, theirs is complete.
            if (!(error instanceof Error && 'code' in error && ['ENOTEMPTY', 'EEXIST'].includes(String(error.code)))) {
                throw error;
            }
        }
    }

    prune(installRoot, cwd);
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
    const [path, branch, startPoint] = process.argv.slice(2);

    if (path === undefined || branch === undefined) {
        console.error('usage: npm run worktree:add -- <path> <branch> [<start-point>]');
        process.exit(2);
    }

    worktreeAdd({
        path,
        branch,
        startPoint,
        installRoot: process.env['KS_INSTALL_ROOT'] ?? join(homedir(), '.local/state/kitchensink/installs'),
        cwd: process.cwd(),
    });
}
