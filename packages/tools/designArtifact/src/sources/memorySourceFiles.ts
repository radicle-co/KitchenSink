/**
 * @module sources/memorySourceFiles — a {@link SourceFiles} over a map, for tests and for building a payload from
 * text that is not on disk.
 *
 * @pattern Adapter (in-memory) behind the SourceFiles port
 */
import { DesignArtifactError } from '../errors.js';

import type { SourceFiles } from './sourceFiles.js';

/**
 * @param files - Absolute path to content.
 * @returns A reader that serves exactly those files; a directory exists when a file is under it.
 */
export function memorySourceFiles(files: Readonly<Record<string, string | Uint8Array>>): SourceFiles {
    const get = (path: string): string | Uint8Array => {
        const content = files[path];

        if (content === undefined) {
            throw new DesignArtifactError('missing-source', `No such file: ${path}`);
        }

        return content;
    };

    return {
        text: (path) =>
            Promise.resolve().then(() => {
                const content = get(path);

                return typeof content === 'string' ? content : new TextDecoder().decode(content);
            }),
        bytes: (path) =>
            Promise.resolve().then(() => {
                const content = get(path);

                return typeof content === 'string' ? new TextEncoder().encode(content) : content;
            }),
        list: (directory) => {
            const prefix = directory.endsWith('/') ? directory : `${directory}/`;
            const names = Object.keys(files)
                .filter((path) => path.startsWith(prefix))
                .map((path) => path.slice(prefix.length).split('/')[0] ?? '');

            if (names.length === 0) {
                return Promise.reject(new DesignArtifactError('missing-source', `No such directory: ${directory}`));
            }

            return Promise.resolve([...new Set(names)].sort());
        },
        exists: (path) =>
            Promise.resolve(path in files || Object.keys(files).some((file) => file.startsWith(`${path}/`))),
    };
}
