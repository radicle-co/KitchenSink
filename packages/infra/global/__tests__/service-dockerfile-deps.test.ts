/**
 * Repo-wide guard: every deployable service's Docker image must bundle the compiled `dist` of every
 * shared `@kitchensink/*` runtime dependency it declares.
 *
 * A shared workspace package's dev `package.json` exports `./src` (so consumers typecheck/bundle against
 * source), while the prod image needs its `prod.package.json` + built `dist`. The Dockerfile therefore has
 * to `COPY packages/<area>/<pkg>/dist ...` for each such dep, because the root `node_modules` symlink
 * points at the workspace path — if the dist isn't in the image the bare-specifier import crash-loops at
 * boot with `ERR_MODULE_NOT_FOUND`. That failure is invisible until the container actually starts, so it
 * hid behind an unrelated secret-grant AccessDenied on the identity service and only surfaced once that
 * was fixed. This test asserts the Dockerfile↔dependency contract statically so it can never regress
 * silently again.
 *
 * Regression note: the original version of this guard silently SKIPPED any dependency whose shared
 * package had no `prod.package.json` yet (`.filter(({ dir }) => ... existsSync(prod.package.json))`),
 * treating "no prod manifest" as "not a runtime package to check" instead of "not deployable — fail".
 * That let recipe-service's `@kitchensink/identity-core` dep — which had NEITHER a `prod.package.json`
 * NOR a Dockerfile COPY — pass invisibly, because the missing-manifest package was filtered out before
 * the COPY check ever ran (identity-service had the identical gap). The guard now treats a missing
 * `prod.package.json` on a declared workspace runtime dep as a failure in its own right, and also fails
 * when a dep can't be resolved to any scanned workspace directory at all, so both halves of the
 * contract — "the shared package IS prod-deployable" and "the Dockerfile actually COPYs it" — are
 * enforced, and neither can hide behind the other being unmet.
 *
 * Second regression note: fixing the Dockerfile COPY alone is NOT sufficient — the repo-root
 * `.dockerignore` is a deny-all allowlist (`*` then per-path `!...` negations), and the build context
 * silently drops any COPY source that isn't individually un-ignored there, even when the Dockerfile
 * line is correct and the path exists on disk (`docker build` fails with "not found", not a dependency
 * error). Manually running `docker build` for recipe-service AND identity surfaced that both
 * `identity-core` (both services) and `identity-db` (identity only) were missing from `.dockerignore`
 * despite already being COPY'd — a build-breaking gap the string-matching Dockerfile check above cannot
 * see. The guard therefore also asserts `.dockerignore` un-ignores each dep's `dist` and
 * `prod.package.json`, so "the Dockerfile says COPY it" and "the build context will actually contain
 * it" are both enforced.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

// .../packages/infra/global/__tests__ → repo root is four levels up.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Map every `@kitchensink/*` workspace package NAME → its repo-relative directory (by scanning names). */
function workspacePackagesByName(): Map<string, string> {
    const map = new Map<string, string>();
    const bases = [
        'packages/shared',
        'packages/utils',
        'packages/services',
        'packages/clients',
        'packages/tools',
        'packages/apps/commise',
    ];

    for (const base of bases) {
        const baseDir = path.join(repoRoot, base);
        if (!existsSync(baseDir)) {
            continue;
        }
        for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
            const manifestPath = path.join(baseDir, entry.name, 'package.json');
            if (!entry.isDirectory() || !existsSync(manifestPath)) {
                continue;
            }
            const name = JSON.parse(readFileSync(manifestPath, 'utf8')).name;
            if (typeof name === 'string' && name.startsWith('@kitchensink/')) {
                map.set(name, path.posix.join(base, entry.name));
            }
        }
    }

    return map;
}

const workspacePkgs = workspacePackagesByName();

/** Repo-root allowlist controlling what a `docker build .` build context actually contains. */
const dockerignore = readFileSync(path.join(repoRoot, '.dockerignore'), 'utf8');

/** Deployable services = packages/services/* that ship a Dockerfile. */
const serviceDirs = readdirSync(path.join(repoRoot, 'packages/services'), { withFileTypes: true })
    .filter(
        (entry) =>
            entry.isDirectory() && existsSync(path.join(repoRoot, 'packages/services', entry.name, 'Dockerfile')),
    )
    .map((entry) => path.posix.join('packages/services', entry.name));

describe('Service Docker images bundle every shared @kitchensink runtime dependency', () => {
    it('finds at least one deployable service to check', () => {
        expect(serviceDirs.length).toBeGreaterThan(0);
    });

    it.each(serviceDirs)('%s Dockerfile COPYs the dist of each shared runtime dep it declares', (serviceDir) => {
        const manifest = JSON.parse(readFileSync(path.join(repoRoot, serviceDir, 'package.json'), 'utf8'));
        const dockerfile = readFileSync(path.join(repoRoot, serviceDir, 'Dockerfile'), 'utf8');
        const deps = Object.keys(manifest.dependencies ?? {}).filter((dep) => dep.startsWith('@kitchensink/'));

        const missing = deps.flatMap((dep) => {
            const dir = workspacePkgs.get(dep);
            // Every `@kitchensink/*` dependency MUST resolve to a scanned workspace package — an
            // unresolvable dep means either a typo or a package the scan bases don't cover, and either
            // way the image can't possibly bundle it.
            if (dir === undefined) {
                return [`${dep} (no workspace package found for this name)`];
            }

            // A dep the image needs at runtime MUST carry a `prod.package.json` — that's the manifest
            // (exporting ./dist instead of ./src) the Dockerfile installs over the dev one. Without it,
            // the package is not deployable at all, regardless of what the Dockerfile COPYs.
            if (!existsSync(path.join(repoRoot, dir, 'prod.package.json'))) {
                return [`${dep} (${dir}/prod.package.json is missing — package cannot be deployed)`];
            }

            // And the Dockerfile must actually COPY that package's built dist into the image.
            if (!dockerfile.includes(`${dir}/dist`)) {
                return [`${dep} (${dir}/dist is not COPY'd in the Dockerfile)`];
            }

            // A correct COPY line is worthless if the repo-root .dockerignore allowlist drops the
            // source path from the build context before Docker ever sees the Dockerfile.
            const dockerignoreGaps = [`${dir}/dist`, `${dir}/prod.package.json`].filter(
                (allowlistedPath) => !dockerignore.includes(`!${allowlistedPath}`),
            );
            if (dockerignoreGaps.length > 0) {
                return [`${dep} (.dockerignore does not un-ignore: ${dockerignoreGaps.join(', ')})`];
            }

            return [];
        });

        expect(
            missing,
            `${serviceDir}/Dockerfile is missing COPY for shared runtime deps: ${missing.join(', ')}`,
        ).toEqual([]);
    });
});
