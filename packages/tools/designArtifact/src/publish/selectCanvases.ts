/**
 * @module publish/selectCanvases — which repo canvases the LOCAL render test draws: those whose folder a change
 * touched, or the ones a person names.
 */
import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import type { RepoCanvas } from './repoCanvases.js';

const CANVASES_PATH = 'docs/design/canvases/';

const EntriesSchema = z.object({ canvases: z.array(z.looseObject({ id: z.string() })) });

function entriesById(text: string | null): Map<string, object> {
    return new Map(
        text === null ? [] : EntriesSchema.parse(JSON.parse(text)).canvases.map((entry) => [entry.id, entry] as const),
    );
}

/**
 * Names the registry entries that a change added or edited (a removed entry has nothing left to render).
 *
 * @param before - `registry.json` at the merge base, or `null` when it did not exist.
 * @param after - `registry.json` now.
 * @returns The ids of the added or edited entries, in registry order.
 * @throws Error (a zod or JSON error) when either text is not a registry.
 */
export function changedRegistryIds(before: string | null, after: string): readonly string[] {
    const old = entriesById(before);

    return [...entriesById(after)].filter(([id, entry]) => !isDeepStrictEqual(old.get(id), entry)).map(([id]) => id);
}

/**
 * Picks the canvases to render.
 *
 * @param canvases - Every repo canvas, in registry order.
 * @param changedPaths - Repo-relative paths changed against the merge base with main.
 * @param named - `CANVASES`: `all`, or a comma-separated list of ids. `undefined` selects by change.
 * @param registryChanged - Ids of the registry entries the change added or edited (`changedRegistryIds`).
 * @returns The selected canvases, in registry order.
 * @throws Error when `named` lists an id that is not a canvas.
 */
export function selectCanvases(
    canvases: readonly RepoCanvas[],
    changedPaths: readonly string[],
    named: string | undefined,
    registryChanged: ReadonlySet<string>,
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

    return canvases.filter(
        (canvas) =>
            registryChanged.has(canvas.id) ||
            changedPaths.some((path) => path.startsWith(`${CANVASES_PATH}${canvas.folder}/`)),
    );
}
