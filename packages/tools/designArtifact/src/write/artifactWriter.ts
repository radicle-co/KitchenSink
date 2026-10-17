/**
 * @module write/artifactWriter — puts a built payload on disk without ever leaving it half written.
 *
 * The payload is written into a sibling directory first and swapped in with renames only when every file is down. A
 * failure part-way removes the sibling and leaves whatever was at `root` exactly as it was, so a publish never reads a
 * payload from a build that failed.
 *
 * @pattern Port (Ports and Adapters) — the pipeline depends on {@link ArtifactWriter}; {@link fsArtifactWriter} is the
 * file-system adapter and a test supplies a recording one.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';

import { DesignArtifactError } from '../errors.js';

/** A payload: relative path (forward slashes) to its content. */
export type ArtifactFiles = ReadonlyMap<string, string | Uint8Array>;

/** What a successful write has to say. */
export interface WriteOutcome {
    /** Things that did not stop the write but that a person should hear about, such as a directory left behind. */
    readonly warnings: readonly string[];
}

/** Writes one payload. */
export interface ArtifactWriter {
    /**
     * @param root - The directory the payload becomes.
     * @param files - Relative path to content; text is written as UTF-8.
     * @returns Warnings, such as the previous payload that could not be deleted after the swap.
     * @throws DesignArtifactError `unsafe-path` for a path that leaves `root`, `write-failed` when disk refuses. When
     * the swap fails and the previous payload cannot be put back, the message names where it was left.
     * @sideEffect Replaces `root`.
     */
    write(root: string, files: ArtifactFiles): Promise<WriteOutcome>;
}

/** The two file-system calls whose failure the writer has to survive; injectable so a test can make them fail. */
export interface WriterFs {
    rename(from: string, to: string): Promise<void>;
    rm(path: string, options: { readonly recursive: true; readonly force: true }): Promise<void>;
}

/** Whether a payload path stays inside the payload. */
function isSafe(path: string): boolean {
    const normalised = normalize(path);

    return (
        path.length > 0 &&
        !isAbsolute(path) &&
        normalised !== '.' &&
        normalised !== '..' &&
        !normalised.startsWith(`..${sep}`)
    );
}

function isMissing(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * The file-system adapter.
 *
 * @param fs - The calls that move and delete directories; the real ones by default.
 * @returns A writer that builds beside `root` and swaps by rename.
 */
export function fsArtifactWriter(fs: WriterFs = { rename, rm }): ArtifactWriter {
    /** Removes a directory and ignores that it may not exist. */
    const discard = (path: string): Promise<void> => fs.rm(path, { recursive: true, force: true });

    return {
        /** @sideEffect Creates and removes directories next to `root`. */
        async write(root, files) {
            for (const path of files.keys()) {
                if (!isSafe(path)) {
                    throw new DesignArtifactError(
                        'unsafe-path',
                        `Payload path ${JSON.stringify(path)} leaves ${root}.`,
                    );
                }
            }

            const token = randomUUID().slice(0, 8);
            const staging = `${root}.new-${token}`;
            const previous = `${root}.old-${token}`;
            let parked = false;
            /** What to tell the person when the previous payload could not be put back. */
            let stranded = '';

            try {
                await mkdir(staging, { recursive: true });

                for (const [path, content] of files) {
                    const target = join(staging, path);

                    await mkdir(dirname(target), { recursive: true });
                    await writeFile(target, content);
                }

                try {
                    await fs.rename(root, previous);
                    parked = true;
                } catch (error) {
                    if (!isMissing(error)) {
                        throw error;
                    }
                }

                try {
                    await fs.rename(staging, root);
                } catch (error) {
                    if (parked) {
                        try {
                            await fs.rename(previous, root);
                        } catch (rollback) {
                            stranded = ` The swap failed and the previous payload could not be put back; it is at ${previous} (${String(rollback)}).`;
                        }
                    }

                    throw error;
                }
            } catch (error) {
                await discard(staging).catch(() => undefined);

                throw new DesignArtifactError(
                    'write-failed',
                    stranded === ''
                        ? `Could not write ${root}; the previous payload, if any, is untouched: ${String(error)}`
                        : `Could not write ${root}: ${String(error)}.${stranded}`,
                );
            }

            if (!parked) {
                return { warnings: [] };
            }

            try {
                await discard(previous);

                return { warnings: [] };
            } catch (error) {
                return {
                    warnings: [
                        `${root} was replaced, but the old payload at ${previous} could not be deleted: ${String(error)}`,
                    ],
                };
            }
        },
    };
}
