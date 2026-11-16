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

import { MARKER_PATH, parseMarker } from './publishPlan.js';

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
        if ((error as { code?: unknown }).code === 'ENOENT') {
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

/**
 * Hashes downloaded files the way git stores blobs (no line-ending or filter conversion).
 *
 * @sideEffect Spawns `git`.
 * @param run - Runs git (its cwd is irrelevant to absolute paths).
 * @param liveDir - The download directory.
 * @param folder - The canvas folder name.
 * @param paths - Canvas-relative paths to hash.
 * @returns Blob oid by path, only for paths that exist on disk.
 */
export async function hashLive(
    run: RunGit,
    liveDir: string,
    folder: string,
    paths: readonly string[],
): Promise<Map<string, string>> {
    const present: string[] = [];

    for (const path of paths) {
        try {
            await stat(join(liveDir, folder, path));
            present.push(path);
        } catch (error) {
            if ((error as { code?: unknown }).code !== 'ENOENT') {
                throw error;
            }
        }
    }

    if (present.length === 0) {
        return new Map();
    }

    // shortcut: one git call with every path, so the argument list bounds the file count; chunk past ~10k boards.
    const out = await run(['hash-object', '--no-filters', '--', ...present.map((p) => join(liveDir, folder, p))]);
    const oids = out.trim().split('\n');

    return new Map(present.map((path, i) => [path, oids[i] ?? ''] as const));
}
