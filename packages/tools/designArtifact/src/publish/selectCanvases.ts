/**
 * @module publish/selectCanvases — which repo canvases the LOCAL render test draws: those whose folder a change
 * touched, or the ones a person names.
 */
import type { RepoCanvas } from './repoCanvases.js';

const CANVASES_PATH = 'docs/design/canvases/';

/**
 * Picks the canvases to render.
 *
 * @param canvases - Every repo canvas, in registry order.
 * @param changedPaths - Repo-relative paths changed against the merge base with main.
 * @param named - `CANVASES`: `all`, or a comma-separated list of ids. `undefined` selects by change.
 * @returns The selected canvases, in registry order.
 * @throws Error when `named` lists an id that is not a canvas.
 */
export function selectCanvases(
    canvases: readonly RepoCanvas[],
    changedPaths: readonly string[],
    named: string | undefined,
): readonly RepoCanvas[] {
    if (named === 'all') {
        return canvases;
    }

    if (named !== undefined) {
        const ids = named.split(',').map((id) => id.trim());
        const unknown = ids.filter((id) => !canvases.some((canvas) => canvas.id === id));

        if (unknown.length > 0) {
            throw new Error(`CANVASES names ${unknown.join(', ')}, which is not a repo canvas.`);
        }

        return canvases.filter((canvas) => ids.includes(canvas.id));
    }

    return canvases.filter((canvas) =>
        changedPaths.some((path) => path.startsWith(`${CANVASES_PATH}${canvas.folder}/`)),
    );
}
