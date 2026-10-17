/**
 * @module sources/fsSourceFiles — the disk adapter of {@link SourceFiles}.
 *
 * @pattern Adapter over node:fs/promises
 */
import { access, readFile, readdir } from 'node:fs/promises';

import { DesignArtifactError } from '../errors.js';

import type { SourceFiles } from './sourceFiles.js';

function isMissing(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function read(path: string): Promise<Buffer> {
    try {
        return await readFile(path);
    } catch (error) {
        if (isMissing(error)) {
            throw new DesignArtifactError('missing-source', `No such file: ${path}`);
        }

        throw error;
    }
}

/**
 * @returns A reader over the real file system.
 */
export function fsSourceFiles(): SourceFiles {
    return {
        /** @sideEffect Reads the file. */
        text: async (path) => (await read(path)).toString('utf8'),
        /** @sideEffect Reads the file. */
        bytes: async (path) => new Uint8Array(await read(path)),
        /** @sideEffect Reads the directory. */
        async list(directory) {
            try {
                return (await readdir(directory)).sort();
            } catch (error) {
                if (isMissing(error)) {
                    throw new DesignArtifactError('missing-source', `No such directory: ${directory}`);
                }

                throw error;
            }
        },
        /** @sideEffect Probes the path. */
        exists: (path) =>
            access(path).then(
                () => true,
                () => false,
            ),
    };
}
