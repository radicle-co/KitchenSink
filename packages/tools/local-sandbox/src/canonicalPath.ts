import { realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * The real path of a checkout, as the ownership predicates compare it. A path that no longer exists (a deleted
 * worktree whose containers are still on the host) is still an owner, so it is not an error: the longest existing
 * parent is resolved, and the missing rest is appended unchanged.
 *
 * @param value - A path.
 * @returns The canonical path.
 * @sideEffect Reads the file system.
 */
export function canonicalPath(value: string): string {
    const resolved = path.resolve(value);

    try {
        return realpathSync(resolved);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }

        const parent = path.dirname(resolved);

        return parent === resolved ? resolved : path.join(canonicalPath(parent), path.basename(resolved));
    }
}
