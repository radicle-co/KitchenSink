/**
 * The seed manifest of a bundle directory, read from disk (curated catalog plan U2, R8, KTD-4).
 *
 * One digest names every regular file under the seed function's asset directory: its bundle and the `data/` copy
 * the build makes. The function digests its own task root with {@link assertSeedBundleMatches} before it applies
 * anything; `runSeed.sh manifest` digests the directory the pipeline built. The two are independent
 * implementations over one rendering (`formatManifest`), held in agreement by
 * `packages/infra/global/__tests__/seedManifestAgreement.test.ts`.
 *
 * ⛔ A symlink, a special file or a path outside `isSeedManifestPath` is refused, never followed or skipped: either
 * would let the two halves digest the same tree differently, and an empty tree is refused because it digests
 * cleanly and proves nothing.
 *
 * @pattern Imperative shell — the filesystem walk around the pure rendering in `manifest.ts` and the path rule in
 *   `seedManifest.ts`
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { SeedBundleRefusedError, SeedManifestMismatchError } from './errors.js';
import { digestManifest, formatManifest, isManifestSha, sha256Hex, type ManifestEntry } from './manifest.js';
import { isSeedManifestPath } from './seedManifest.js';

/** A bundle directory's manifest: its files, the entries, the rendered text, and the digest of that text. */
export interface SeedManifest {
    /** Every regular file's bundle-relative POSIX path, C-ordered. */
    readonly files: readonly string[];
    /** The per-file entries, C-ordered. */
    readonly entries: readonly ManifestEntry[];
    /** The canonical manifest text. */
    readonly text: string;
    /** The digest of {@link SeedManifest.text}. */
    readonly sha: string;
}

/** Order two paths as `LC_ALL=C sort` does; within the path contract, a code-unit comparison is byte order. */
const byCOrder = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/**
 * Read a bundle directory's seed manifest.
 *
 * @param bundleDir - The bundle root: the function's task root, or the directory the pipeline built.
 * @returns The manifest.
 * @throws {SeedBundleRefusedError} for a missing root, a root that is not a directory, a tree with no regular file,
 *   or any symlink, special file or unsafe path, naming every offender of the first kind found.
 * @sideEffect Reads the tree.
 */
export function readSeedManifest(bundleDir: string): SeedManifest {
    const root = statSync(bundleDir, { throwIfNoEntry: false });

    if (root === undefined) {
        throw new SeedBundleRefusedError(bundleDir, 'missing');
    }

    if (!root.isDirectory()) {
        throw new SeedBundleRefusedError(bundleDir, 'notADirectory');
    }

    const files: string[] = [];
    const symlinks: string[] = [];
    const specials: string[] = [];
    // ⛔ An explicit walk, not `readdirSync(…, { recursive: true })`: that one descends into a directory SYMLINK,
    // which would digest files outside the bundle. A `Dirent` describes the link itself, so only real directories
    // are entered.
    const pending = [bundleDir];

    for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const absolute = join(dir, entry.name);
            const path = relative(bundleDir, absolute).split(sep).join('/');

            if (entry.isSymbolicLink()) {
                symlinks.push(path);
            } else if (entry.isDirectory()) {
                pending.push(absolute);
            } else if (entry.isFile()) {
                files.push(path);
            } else {
                specials.push(path);
            }
        }
    }

    const unsafe = files.filter((path) => !isSeedManifestPath(path));
    const refusals: readonly (readonly ['symlink' | 'specialFile' | 'unsafePath', string[]])[] = [
        ['symlink', symlinks],
        ['specialFile', specials],
        ['unsafePath', unsafe],
    ];

    for (const [reason, paths] of refusals) {
        if (paths.length > 0) {
            throw new SeedBundleRefusedError(bundleDir, reason, paths.sort(byCOrder));
        }
    }

    if (files.length === 0) {
        throw new SeedBundleRefusedError(bundleDir, 'empty');
    }

    files.sort(byCOrder);

    const entries = files.map((name) => ({ name, sha256: sha256Hex(readFileSync(join(bundleDir, name))) }));
    const text = formatManifest(entries);

    return { files, entries, text, sha: digestManifest(text) };
}

/** Options for {@link assertSeedBundleMatches}. */
export interface AssertSeedBundleMatchesOptions {
    /** Which seed this is, for the error message. */
    readonly label: string;
    /** The bundle root the function holds. */
    readonly bundleDir: string;
    /** The digest the pipeline computed from the bundle it built. */
    readonly expectSeedSha: string;
}

/**
 * Refuse unless the bundle the function holds is the one the pipeline built.
 *
 * @param options - The label, the bundle root and the expected digest.
 * @returns The manifest, when it matches.
 * @throws {Error} for an expectation that is not a well-formed digest, before anything is read.
 * @throws {SeedBundleRefusedError} for a bundle the manifest cannot name.
 * @throws {SeedManifestMismatchError} when the bundle's digest differs from the expectation.
 * @sideEffect Reads the tree.
 */
export function assertSeedBundleMatches(options: AssertSeedBundleMatchesOptions): SeedManifest {
    if (!isManifestSha(options.expectSeedSha)) {
        throw new Error(`[${options.label}] expectSeedSha is not a 64-character lowercase hex sha256`);
    }

    const manifest = readSeedManifest(options.bundleDir);

    if (manifest.sha !== options.expectSeedSha) {
        throw new SeedManifestMismatchError({
            label: options.label,
            expected: options.expectSeedSha,
            actual: manifest.sha,
            files: manifest.files,
        });
    }

    return manifest;
}
