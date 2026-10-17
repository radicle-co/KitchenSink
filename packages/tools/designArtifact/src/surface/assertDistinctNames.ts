/**
 * @module surface/assertDistinctNames — the last check on a surface before it is bundled.
 *
 * Discovery already refuses a duplicate, but the pipeline accepts a surface from a port, and a surface that repeats a
 * name would let the later export silently replace the earlier one on `window.Commise`.
 */
import type { Surface } from './discoverSurface.js';
import { appendDirectEntries } from './discoverSurface.js';

/**
 * @param surface - Both platforms' entries.
 * @returns The same surface.
 * @throws DesignArtifactError `duplicate-name` when a name appears twice on one platform.
 */
export function assertDistinctNames(surface: Surface): Surface {
    for (const platform of ['web', 'native'] as const) {
        appendDirectEntries([], surface[platform], platform);
    }

    return surface;
}
