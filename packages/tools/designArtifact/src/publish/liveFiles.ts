/**
 * @module publish/liveFiles — the live canvas as the Artifact `read` downloaded it: `<live>/<folder>/project/…`.
 *
 * @pattern Adapter — over a directory of downloads. It never decodes a file: oids come from `git hash-object`.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { DesignArtifactError } from '../errors.js';
import type { RunGit } from '../sources/gitHead.js';

import { CANVASES_DIR } from './gitCanvasHistory.js';
import { MARKER_PATH, parseMarker, type LiveOids } from './publishPlan.js';

/**
 * Reads the live marker.
 *
 * @sideEffect Reads a file.
 * @param liveDir - The download directory.
 * @param folder - The canvas folder name.
 * @returns The sha in `project/published.json`, or `null` when none was downloaded.
 * @throws DesignArtifactError `invalid-marker` when the file exists and is malformed.
 */
export async function readMarker(liveDir: string, folder: string): Promise<string | null> {
    try {
        return parseMarker(await readFile(join(liveDir, folder, MARKER_PATH), 'utf8'));
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return null;
        }

        throw error;
    }
}

/**
 * Reads the live path list (the Artifact `list` result saved as a JSON array of paths).
 *
 * @sideEffect Reads a file.
 * @param file - The JSON file.
 * @returns The live paths.
 * @throws DesignArtifactError `missing-source` when it is not an array of strings.
 */
export async function readLiveList(file: string): Promise<string[]> {
    const parsed = z.array(z.string()).safeParse(JSON.parse(await readFile(file, 'utf8')));

    if (!parsed.success) {
        throw new DesignArtifactError('missing-source', `${file} is not a JSON array of paths.`);
    }

    return parsed.data;
}

const HASH_CHUNK = 16;

/**
 * Hashes downloaded files the way git could have stored them. A canvas image is an LFS pointer today, but a canvas
 * snapshotted before LFS took over `project/assets/` stored the same bytes raw, so such a file has two oids: the
 * filtered one and the raw one. Pointer text downloaded as a live file needs no special case: its raw oid is the
 * pointer blob, which is right, because that file is the pointer.
 *
 * @sideEffect Spawns `git`. `--path` runs the LFS clean filter, which writes the image's object into
 * `.git/lfs/objects`.
 * @param run - Runs git (its cwd is irrelevant to absolute paths).
 * @param liveDir - The download directory.
 * @param folder - The canvas folder name.
 * @param paths - Canvas-relative paths to hash.
 * @returns The oids by path (the filtered oid first, then the raw one when it differs), only for paths on disk.
 */
export async function hashLive(
    run: RunGit,
    liveDir: string,
    folder: string,
    paths: readonly string[],
): Promise<LiveOids> {
    const present: string[] = [];

    for (const path of paths) {
        try {
            await stat(join(liveDir, folder, path));
            present.push(path);
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
                throw error;
            }
        }
    }

    if (present.length === 0) {
        return new Map();
    }

    // `--path` makes git apply the repo's attributes for the file's repo path: an LFS image hashes to its pointer oid,
    // and every other canvas file is `-text` there, so it still hashes byte for byte. `--no-filters` is the raw oid.
    // shortcut: one git call per file, in chunks; the canvases hold tens of files.
    const entries: [string, readonly string[]][] = [];

    for (let i = 0; i < present.length; i += HASH_CHUNK) {
        const chunk = present.slice(i, i + HASH_CHUNK);
        const oids = await Promise.all(
            chunk.map(async (path) => {
                const file = join(liveDir, folder, path);
                const filtered = (
                    await run(['hash-object', `--path=${CANVASES_DIR}/${folder}/${path}`, '--', file])
                ).trim();
                const raw = (await run(['hash-object', '--no-filters', '--', file])).trim();

                return [...new Set([filtered, raw])];
            }),
        );
        entries.push(...chunk.map((path, j): [string, readonly string[]] => [path, oids[j] ?? []]));
    }

    return new Map(entries);
}
