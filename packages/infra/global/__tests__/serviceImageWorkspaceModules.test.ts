// @vitest-environment node
/**
 * Repo-wide guard: a service Dockerfile may only `COPY` a per-workspace `node_modules` if the LOCKFILE
 * actually places a runtime dependency there.
 *
 * ## The outage this exists to make impossible
 *
 * All three service images carried an unconditional line:
 *
 *     COPY packages/services/<svc>/node_modules ./packages/services/<svc>/node_modules
 *
 * npm workspaces hoist everything they can to the root `node_modules`. A workspace gets its OWN
 * `node_modules` only when a version conflict prevents hoisting — so that directory's existence was never a
 * property of the service, it was an accident of dependency arithmetic elsewhere in the monorepo.
 *
 * On 2026-08-27 `c90098ff` pinned `@types/node` to the runtime major, aligning it across workspaces. That
 * removed the last conflict for identity, food-service and identity-webhooks, so `npm ci` stopped creating
 * their per-workspace directories, and the unconditional `COPY` began failing:
 *
 *     ERROR: failed to compute cache key: "/packages/services/identity/node_modules": not found
 *
 * **Every sandbox identity deploy failed for four days**, and because the deploy is what stands the shared
 * tier up, ADR-0028's button was broken the whole time for a reason nothing connected to it.
 *
 * ## Why the fix was DELETION and not "make the directory exist"
 *
 * The tempting repair is a `mkdir -p` before the build, or a `.gitkeep`. Both are wrong, and the lockfile
 * says why: the only entries those directories EVER held were `@types/node` and `undici-types`, both
 * `dev: true`. The workflow runs `npm prune --omit=dev` BEFORE the image build, so the directory was already
 * empty when it was copied. The `COPY` had never contributed a single byte the runtime uses — it succeeded
 * for years only because an empty-but-present directory satisfies Docker, and failed the moment the
 * directory stopped being created at all. Forcing it to exist would restore a line that does nothing.
 *
 * Measured across the whole lockfile at the time of the fix: **zero** production dependencies resolve inside
 * any service's own `node_modules` (recipe-service had 66 entries, all `dev`).
 *
 * ## What is asserted
 *
 * The lockfile is the authority on what `npm ci` creates, so the invariant is stated against it rather than
 * against a directory listing that varies with whoever last ran `npm install`. If a real runtime dependency
 * is ever pinned into a workspace, the `COPY` becomes correct again and this guard permits it — the rule is
 * "copy it if and only if something runtime lives there", not "never copy it".
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot, trackedFiles } from './serviceSources.js';

/** One entry of `package-lock.json`'s `packages` map. */
interface LockEntry {
    readonly dev?: boolean;
}

const lock = JSON.parse(readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, LockEntry>;
};

/** Every tracked service Dockerfile. */
const dockerfiles = (): readonly string[] =>
    trackedFiles('packages/services').filter((file) => file.endsWith('/Dockerfile'));

/**
 * The workspace paths a Dockerfile copies a `node_modules` directory for.
 *
 * @param contents - Dockerfile source.
 * @returns Workspace paths, e.g. `packages/services/identity`. Pure.
 */
export function workspaceModulesCopiedBy(contents: string): string[] {
    return [...contents.matchAll(/^\s*COPY\s+(packages\/[\w/-]+)\/node_modules\s/gmu)].map((match) => match[1] ?? '');
}

/**
 * Runtime (non-dev) lockfile entries installed inside a workspace's own `node_modules`.
 *
 * @param workspace - Workspace path, e.g. `packages/services/identity`.
 * @returns The dependency names. Pure.
 */
export function runtimeModulesUnder(workspace: string): string[] {
    const prefix = `${workspace}/node_modules/`;

    return Object.entries(lock.packages)
        .filter(([entry, meta]) => entry.startsWith(prefix) && meta.dev !== true)
        .map(([entry]) => entry.slice(prefix.length));
}

describe('service images copy a workspace node_modules only when one holds a runtime dependency', () => {
    it('inspects the service Dockerfiles — the scan is not vacuous', () => {
        expect(dockerfiles().length).toBeGreaterThanOrEqual(3);
    });

    it('copies no workspace node_modules that the lockfile leaves empty of runtime dependencies', () => {
        const offenders = dockerfiles().flatMap((file) => {
            const contents = readFileSync(path.join(repoRoot, file), 'utf8');

            return workspaceModulesCopiedBy(contents)
                .filter((workspace) => runtimeModulesUnder(workspace).length === 0)
                .map((workspace) => `${file} copies ${workspace}/node_modules, which npm ci never creates`);
        });

        expect(offenders).toEqual([]);
    });

    it('agrees with the measurement that motivated the fix: no service hoists a runtime dep locally', () => {
        const withRuntimeModules = Object.keys(lock.packages)
            .filter((entry) => entry.startsWith('packages/services/') && entry.includes('/node_modules/'))
            .filter((entry) => lock.packages[entry]?.dev !== true);

        expect(withRuntimeModules).toEqual([]);
    });

    it('permits the COPY again if a runtime dependency is ever pinned into a workspace', () => {
        // The rule is conditional, not a ban. Fired at a fake so the permitting branch is exercised too.
        const contents = 'COPY packages/services/identity/node_modules ./x\n';

        expect(workspaceModulesCopiedBy(contents)).toEqual(['packages/services/identity']);
        expect(runtimeModulesUnder('packages/services/does-not-exist')).toEqual([]);
    });
});
