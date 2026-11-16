/**
 * @module selectedRepoCanvases — which repo canvases this LOCAL run renders. The set-up (which fetches their images)
 * and the render test (which draws them) must agree, so both ask here.
 *
 * Which canvases: the folders changed against the merge base with `origin/main` (committed, staged or not).
 * `CANVASES=all` selects every canvas, and `CANVASES=id,id` the ones named.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRepoCanvases } from '../../src/publish/repoCanvases.js';
import type { RepoCanvas } from '../../src/publish/repoCanvases.js';
import { changedRegistryIds, selectCanvases } from '../../src/publish/selectCanvases.js';

export const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
export const CANVASES_DIR = join(REPO_ROOT, 'docs', 'design', 'canvases');

const git = (...args: string[]): string => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();

const mergeBase = (): string => git('merge-base', 'HEAD', 'origin/main');

const changedPaths = (): readonly string[] =>
    git('diff', '--name-only', mergeBase())
        .split('\n')
        .filter((line) => line !== '');

/** The registry as the merge base had it, or `null` when the merge base has none. */
const registryAtMergeBase = (): string | null => {
    try {
        return git('show', `${mergeBase()}:docs/design/canvases/registry.json`);
    } catch {
        return null;
    }
};

/**
 * Picks the canvases this run renders.
 *
 * @sideEffect Spawns `git` and reads `registry.json`.
 * @param named - `CANVASES`; `undefined` selects by change.
 * @returns The selected repo canvases, in registry order.
 */
export function selectedRepoCanvases(named: string | undefined): readonly RepoCanvas[] {
    const registryText = readFileSync(join(CANVASES_DIR, 'registry.json'), 'utf8');

    return selectCanvases(
        parseRepoCanvases(registryText),
        changedPaths(),
        named,
        new Set(changedRegistryIds(registryAtMergeBase(), registryText)),
    );
}
