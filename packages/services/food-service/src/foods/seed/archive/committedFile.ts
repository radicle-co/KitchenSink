/**
 * Reading a committed file that may be absent. A seed tool asks this of a pin, an extract or a prior: the file is
 * absent until an operator writes it, and only that case is an answer. Any other failure is rethrown.
 *
 * @module
 */
import { readFile } from 'node:fs/promises';

/**
 * Whether an error is `fs` reporting a path that does not exist. Pure.
 *
 * @param error - A caught value.
 * @returns True only for an `Error` whose `code` is `ENOENT`.
 */
export function isMissingFile(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * A file's UTF-8 text, or `undefined` when the file does not exist.
 *
 * @param path - The file.
 * @returns Its text, or `undefined` when absent.
 * @throws Any read failure other than an absent file.
 * @sideEffect Reads one file.
 */
export async function readTextIfPresent(path: string): Promise<string | undefined> {
    try {
        return await readFile(path, 'utf8');
    } catch (error) {
        if (isMissingFile(error)) {
            return undefined;
        }

        throw error;
    }
}
