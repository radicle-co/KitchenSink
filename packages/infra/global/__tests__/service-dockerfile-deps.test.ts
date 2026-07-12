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

        const missing = deps
            .map((dep) => ({ dep, dir: workspacePkgs.get(dep) }))
            // Only shared RUNTIME packages use the dist-copy pattern — they carry a `prod.package.json`.
            .filter(({ dir }) => dir !== undefined && existsSync(path.join(repoRoot, dir, 'prod.package.json')))
            // The image must COPY that package's built dist.
            .filter(({ dir }) => !dockerfile.includes(`${dir}/dist`))
            .map(({ dep, dir }) => `${dep} (${dir}/dist)`);

        expect(
            missing,
            `${serviceDir}/Dockerfile is missing COPY for shared runtime deps: ${missing.join(', ')}`,
        ).toEqual([]);
    });
});
