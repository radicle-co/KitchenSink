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
 * Files under a linked `node_modules` are SHARED INODES (the store's and every sibling worktree's): never edit one in
 * place. The two kinds `npm install` rewrites, `.package-lock.json` at each `node_modules` root, are copied out of the
 * link as they are linked. A new worktree also gets its git hooks: `core.hooksPath` is `.husky/_`, which is gitignored
 * and made only by the `prepare` script (`husky`), so a cache hit that runs no npm runs `node_modules/.bin/husky`.
 *
 * A failure after `git worktree add` removes the worktree and the branch this run made, so a re-run can start clean.
 * Pruning runs after that, once the worktree is complete: a failed prune only warns.
 *
 * shortcut: hard links need the install root and the worktree on one filesystem; on another `cp -al` fails loudly,
 * upgrade to a plain copy fallback only if that setup ever appears.
 *
 * @sideEffect Runs git and npm, and writes under the install root and the new worktree.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    utimesSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const KEEP = 3;
const STALE_TMP_MS = 24 * 60 * 60 * 1000;
const TMP_PREFIX = '.tmp-';
const TRASH_PREFIX = `${TMP_PREFIX}trash-`;

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

/** Replace a hard-linked file with a private copy: copy aside, then rename over the link (atomic, same directory). */
function breakLink(file) {
    const copy = `${file}.tmp-${process.pid}`;

    copyFileSync(file, copy);
    renameSync(copy, file);
}

/** Hard-link every `node_modules` tree of `from` into the same relative place under `to`. */
function linkTrees(from, to) {
    for (const rel of nodeModulesDirs(from)) {
        mkdirSync(join(to, rel, '..'), { recursive: true });
        execFileSync('cp', ['-al', join(from, rel), join(to, rel)]);

        // `npm install` rewrites this file in place, which would rewrite it for the store and every sibling.
        const hidden = join(to, rel, '.package-lock.json');

        if (existsSync(hidden)) {
            breakLink(hidden);
        }
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
        // Rename first: a run linking from this install sees all of it or ENOENT at its start, never a half-deleted
        // tree. The trash name starts with TMP_PREFIX, so a killed run's leftover is swept by the stale-tmp rule above.
        const trash = join(installRoot, `${TRASH_PREFIX}${hash}-${process.pid}`);

        renameSync(join(installRoot, hash), trash);
        rmSync(trash, { recursive: true, force: true });
    }
}

/** Runs the root `prepare` script's `husky` (not `npm run prepare`, whose `|| true` hides a failure). */
function installHooks(path) {
    execFileSync(join(path, 'node_modules/.bin/husky'), { cwd: path, stdio: 'inherit' });
}

function giveInstall(path, installRoot) {
    const hash = hashOf(path);

    if (hash === undefined) {
        throw new Error(`${path} has no package-lock.json, so there is no install to key`);
    }

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

    installHooks(path);
}

/**
 * Adds the worktree and gives it an install.
 *
 * @param {{ path: string, branch: string, startPoint?: string, installRoot: string, cwd: string }} input - The request.
 * @returns {void}
 * @sideEffect See the file header.
 */
function worktreeAdd({ path, branch, startPoint, installRoot, cwd }) {
    // Hard links cannot cross filesystems: find out before anything is created, not from a failed `cp` half way.
    mkdirSync(installRoot, { recursive: true });
    mkdirSync(dirname(path), { recursive: true });

    if (statSync(installRoot).dev !== statSync(dirname(path)).dev) {
        throw new Error(
            `${installRoot} and ${dirname(path)} are on different filesystems, so nothing can be hard-linked`,
        );
    }

    const branchExists =
        spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd }).status === 0;
    if (branchExists && startPoint !== undefined) {
        throw new Error(`branch ${branch} already exists, so a start point would be ignored: omit it`);
    }

    const start = startPoint === undefined ? [] : [startPoint];

    execFileSync('git', ['worktree', 'add', ...(branchExists ? [path, branch] : ['-b', branch, path, ...start])], {
        cwd,
        stdio: 'inherit',
    });

    try {
        giveInstall(path, installRoot);
    } catch (error) {
        // Best effort: the original error is the one worth reading.
        spawnSync('git', ['worktree', 'remove', '--force', path], { cwd });

        if (!branchExists) {
            spawnSync('git', ['branch', '-D', branch], { cwd });
        }

        throw error;
    }

    // The worktree is complete here: a failed prune (a concurrent run won a rename) only leaves extra installs behind.
    try {
        prune(installRoot, cwd);
    } catch (error) {
        console.warn(`worktree:add: the worktree is ready, but pruning old installs failed: ${String(error)}`);
    }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [path, branch, startPoint] = process.argv.slice(2);

    if (path === undefined || branch === undefined) {
        console.error('usage: npm run worktree:add -- <path> <branch> [<start-point>]');
        process.exit(2);
    }

    worktreeAdd({
        // `npm run` starts in the package root, but the caller typed the path from where they were: INIT_CWD.
        path: resolve(process.env['INIT_CWD'] ?? process.cwd(), path),
        branch,
        startPoint,
        installRoot: process.env['KS_INSTALL_ROOT'] ?? join(homedir(), '.local/state/kitchensink/installs'),
        cwd: process.cwd(),
    });
}
