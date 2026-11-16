/**
 * @module publish/repoCanvases — the registry entries a publish handles: those whose `source` is `repo-canvas`.
 */
import { z } from 'zod';

import { DesignArtifactError } from '../errors.js';

/** One repo-source canvas. */
export interface RepoCanvas {
    readonly id: string;
    readonly url: string;
    readonly folder: string;
}

/** A folder is one path segment of letters and digits, so it can never leave `docs/design/canvases/`. */
const FolderSchema = z.string().regex(/^[A-Za-z0-9]+$/u);

const RegistrySchema = z.object({
    canvases: z.array(z.looseObject({ id: z.string(), url: z.string(), source: z.string().optional() })),
});

/**
 * Reads `registry.json`.
 *
 * @param text - The file's content.
 * @returns The `repo-canvas` entries in registry order. Until the migration none exist.
 * @throws DesignArtifactError `missing-source` for unreadable JSON, a malformed registry or a repo-canvas entry
 * without a safe `folder`.
 */
export function parseRepoCanvases(text: string): RepoCanvas[] {
    let json: unknown;

    try {
        json = JSON.parse(text);
    } catch {
        throw new DesignArtifactError('missing-source', 'registry.json is not JSON.');
    }

    const registry = RegistrySchema.safeParse(json);

    if (!registry.success) {
        throw new DesignArtifactError('missing-source', `registry.json is malformed: ${registry.error.message}`);
    }

    return registry.data.canvases
        .filter((entry) => entry.source === 'repo-canvas')
        .map((entry) => {
            const folder = FolderSchema.safeParse(entry['folder']);

            if (!folder.success) {
                throw new DesignArtifactError(
                    'missing-source',
                    `Canvas ${entry.id} needs a folder of letters and digits.`,
                );
            }

            return { id: entry.id, url: entry.url, folder: folder.data };
        });
}
