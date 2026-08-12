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
 * Third regression note — THE CLOSURE IS TRANSITIVE, and the non-transitive version was one commit away from a
 * crash-loop. The guard used to check only each service's own DIRECT `@kitchensink/*` dependencies. But node
 * resolves a bare specifier from wherever it is written: when `@kitchensink/food-service-client` imports
 * `@kitchensink/schema-food`, the RECIPE image is what has to contain `packages/schemas/food/dist`, even though
 * `recipe-service` never names that package. Measured at the time this was widened: recipe-service's transitive
 * closure was `clerk-verify, food-service-client, identity-core, recipe-core, schema-food, schema-recipe`, and
 * `schema-food` was the ONE member its Dockerfile did not COPY. It had been harmless only because the food
 * client's import of that package was `import type` (erased at compile time). The moment drift layer 3
 * (§15.2.5) made it read `CONTRACT_HASH` as a VALUE, the omission became `ERR_MODULE_NOT_FOUND` at boot — the
 * diagnostic feature crash-looping the service it was meant to keep honest — and the direct-only guard was
 * structurally incapable of seeing it. Walking the closure is what makes "the image contains what it imports"
 * actually true.
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

/** A scanned workspace package: where it lives, and which `@kitchensink/*` packages it needs at RUNTIME. */
interface WorkspacePackage {
    /** Repo-relative directory, e.g. `packages/schemas/food`. */
    readonly dir: string;
    /** Its own `@kitchensink/*` runtime dependencies (never devDependencies — those are not in the image). */
    readonly deps: readonly string[];
}

/** Map every `@kitchensink/*` workspace package NAME → its directory and runtime deps (by scanning names). */
function workspacePackagesByName(): Map<string, WorkspacePackage> {
    const map = new Map<string, WorkspacePackage>();
    // Must list EVERY `packages/*` area the root `workspaces` globs cover. An omitted area does not make this
    // check lenient — it makes it MISLEADING: the dependency is still reported missing, but as "no workspace
    // package found for this name", which sends the reader hunting a package that exists and is right there.
    // `packages/schemas` was the omission that proved it (the generated wire-contract packages,
    // CODING_STANDARDS §15.2).
    const bases = [
        'packages/shared',
        'packages/utils',
        'packages/schemas',
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
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
            if (typeof manifest.name === 'string' && manifest.name.startsWith('@kitchensink/')) {
                map.set(manifest.name, {
                    dir: path.posix.join(base, entry.name),
                    deps: Object.keys(manifest.dependencies ?? {}).filter((dep: string) =>
                        dep.startsWith('@kitchensink/'),
                    ),
                });
            }
        }
    }

    return map;
}

const workspacePkgs = workspacePackagesByName();

/**
 * Every `@kitchensink/*` package a service needs in its image: its own runtime deps, PLUS theirs, recursively.
 *
 * Transitive because node resolves a bare specifier from wherever it is written — a dependency's own
 * `@kitchensink/*` import has to be present in the image of whatever service pulls it in, even when that
 * service's manifest never names it. Cycle-safe via the visited set (workspace graphs do contain cycles).
 *
 * @param roots - The service's own declared `@kitchensink/*` runtime dependencies.
 * @returns Every package name in the closure, sorted, for a stable failure message.
 */
function runtimeClosure(roots: readonly string[]): string[] {
    const seen = new Set<string>();
    const queue = [...roots];

    while (queue.length > 0) {
        const name = queue.pop() as string;

        if (seen.has(name)) {
            continue;
        }

        seen.add(name);
        queue.push(...(workspacePkgs.get(name)?.deps ?? []));
    }

    return [...seen].sort();
}

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

    it.each(serviceDirs)(
        '%s Dockerfile COPYs the dist of every shared runtime dep in its TRANSITIVE closure',
        (serviceDir) => {
            const manifest = JSON.parse(readFileSync(path.join(repoRoot, serviceDir, 'package.json'), 'utf8'));
            const dockerfile = readFileSync(path.join(repoRoot, serviceDir, 'Dockerfile'), 'utf8');
            const deps = runtimeClosure(
                Object.keys(manifest.dependencies ?? {}).filter((dep) => dep.startsWith('@kitchensink/')),
            );

            const missing = deps.flatMap((dep) => {
                const pkg = workspacePkgs.get(dep);
                // Every `@kitchensink/*` dependency MUST resolve to a scanned workspace package — an
                // unresolvable dep means either a typo or a package the scan bases don't cover, and either
                // way the image can't possibly bundle it.
                if (pkg === undefined) {
                    return [`${dep} (no workspace package found for this name)`];
                }

                const dir = pkg.dir;

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
        },
    );

    // Guards the guard. If the closure ever silently collapsed to each service's DIRECT deps, every assertion
    // above would still pass — vacuously — while the transitive gap it exists to catch reopened. This pins the
    // one case that is only reachable through a dependency: `schema-food` is in recipe-service's closure via
    // `food-service-client`, and is named nowhere in recipe-service's own manifest.
    it('resolves TRANSITIVE deps, not just direct ones (schema-food reaches recipe-service via the food client)', () => {
        const recipeManifest = JSON.parse(
            readFileSync(path.join(repoRoot, 'packages/services/recipe-service/package.json'), 'utf8'),
        );
        const direct = Object.keys(recipeManifest.dependencies ?? {});

        expect(direct).not.toContain('@kitchensink/schema-food');
        expect(direct).toContain('@kitchensink/food-service-client');
        expect(runtimeClosure(direct.filter((dep) => dep.startsWith('@kitchensink/')))).toContain(
            '@kitchensink/schema-food',
        );
    });
});
