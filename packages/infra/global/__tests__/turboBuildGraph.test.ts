// @vitest-environment node
/**
 * Repo-wide guard: a package's `build` must be ordered AFTER the `build` of every workspace package it depends
 * on at runtime — including where `turbo.json` overrides that package's `build` task.
 *
 * ## The failure this pins
 *
 * Turbo's package-task configuration (`"<pkg>#build": { … }`) **REPLACES** the base `build` task; it does not
 * merge with it. So an override written to add an `inputs` glob silently drops whatever the base task declared —
 * and the base `build` declares `dependsOn: ["^build"]`, the edge that says "build my dependencies first".
 *
 * That is exactly what happened to `@kitchensink/schema-recipe#build`. Measured with `turbo run build
 * --dry=json`, it had `deps=[]`, while `@kitchensink/schema-recipe#typecheck` — which is NOT overridden and so
 * still inherits `^build` — depended on `@kitchensink/recipe-core#build`. That asymmetry was the only tell.
 * `schema-recipe` has a real runtime dependency on `recipe-core` whose values its schemas import, and it kept
 * compiling only because recipe-core's dev manifest exports `./src`, so `tsc` resolved SOURCE rather than a
 * `dist` that had never been built. An accident of convention was standing in for a declared dependency.
 *
 * ## Why it is asserted this way
 *
 * Against turbo's OWN resolved graph (`--dry=json`), not against the text of `turbo.json`. The bug is that the
 * config text looked complete while the resolved semantics were not, so a test that reads the config would have
 * agreed with the bug. The dry run is also what makes this general: it covers every package and every future
 * package-task override, including ones written after this test.
 *
 * The rule is scoped to `dependencies` (runtime) rather than `devDependencies`, because that is the set whose
 * built output a consumer's compile and runtime actually need.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

// .../packages/infra/global/__tests__ → repo root is four levels up.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The `packages/*` areas the root `workspaces` globs cover. */
const WORKSPACE_AREAS: readonly string[] = [
    'packages/shared',
    'packages/utils',
    'packages/schemas',
    'packages/services',
    'packages/clients',
    'packages/tools',
    'packages/infra',
    'packages/apps/commise',
];

/** One workspace package, as far as this guard cares. */
interface WorkspacePackage {
    /** The npm name. */
    readonly name: string;
    /** `@kitchensink/*` runtime dependencies. */
    readonly runtimeDependencies: readonly string[];
    /** Whether the package declares a `build` script at all. */
    readonly builds: boolean;
}

/** Every workspace package, keyed by npm name. */
function workspacePackages(): Map<string, WorkspacePackage> {
    const packages = new Map<string, WorkspacePackage>();

    for (const area of WORKSPACE_AREAS) {
        const areaDir = path.join(repoRoot, area);

        if (!existsSync(areaDir)) {
            continue;
        }

        for (const entry of readdirSync(areaDir, { withFileTypes: true })) {
            const manifestPath = path.join(areaDir, entry.name, 'package.json');

            if (!entry.isDirectory() || !existsSync(manifestPath)) {
                continue;
            }

            const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
                name?: string;
                scripts?: Record<string, string>;
                dependencies?: Record<string, string>;
            };

            if (typeof manifest.name !== 'string') {
                continue;
            }

            packages.set(manifest.name, {
                name: manifest.name,
                runtimeDependencies: Object.keys(manifest.dependencies ?? {}).filter((dependency) =>
                    dependency.startsWith('@kitchensink/'),
                ),
                builds: manifest.scripts?.['build'] !== undefined,
            });
        }
    }

    return packages;
}

/** Turbo's resolved `build` graph: task id → the task ids it depends on. */
function resolvedBuildGraph(): Map<string, readonly string[]> {
    const stdout = execFileSync(path.join(repoRoot, 'node_modules/.bin/turbo'), ['run', 'build', '--dry=json'], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });

    const plan = JSON.parse(stdout) as { tasks: { taskId: string; dependencies: string[] }[] };

    return new Map(plan.tasks.map((task) => [task.taskId, task.dependencies]));
}

const packages = workspacePackages();
const graph = resolvedBuildGraph();

describe("turbo's resolved build graph", () => {
    it('plans a build for every workspace package that declares one', () => {
        const missing = [...packages.values()]
            .filter((entry) => entry.builds && !graph.has(`${entry.name}#build`))
            .map((entry) => entry.name);

        // Non-vacuity in both directions: an empty graph, or a graph that quietly skipped packages, would make
        // every assertion below pass while measuring nothing.
        expect(graph.size).toBeGreaterThan(10);
        expect(missing).toStrictEqual([]);
    });

    it('orders each package build after the build of every workspace runtime dependency it declares', () => {
        const gaps = [...packages.values()]
            .filter((entry) => entry.builds)
            .flatMap((entry) => {
                const dependencies = graph.get(`${entry.name}#build`) ?? [];

                return entry.runtimeDependencies
                    .filter((dependency) => packages.get(dependency)?.builds === true)
                    .filter((dependency) => !dependencies.includes(`${dependency}#build`))
                    .map(
                        (dependency) =>
                            `${entry.name}#build does not depend on ${dependency}#build — a package-task ` +
                            'override in turbo.json REPLACES the base task, so it must re-declare `^build`',
                    );
            });

        expect(gaps).toStrictEqual([]);
    });

    // The specific edge the omission cost, named so a future reader sees WHICH dependency this is about rather
    // than only the general rule. `schema-recipe`'s zod imports runtime values from `recipe-core`.
    it('orders recipe-core before the generated recipe schema package, whose zod imports its values', () => {
        expect(graph.get('@kitchensink/schema-recipe#build')).toContain('@kitchensink/recipe-core#build');
    });

    // Every generated contract package is an override with a `$TURBO_ROOT$` input, which is precisely the shape
    // that dropped `^build`. Asserting all three keeps a copy-paste of the block from reintroducing it.
    it.each(['@kitchensink/schema-food', '@kitchensink/schema-identity', '@kitchensink/schema-recipe'])(
        '%s#build still inherits the base ^build edges despite its package-task override',
        (name) => {
            expect(graph.get(`${name}#build`)?.length ?? 0).toBeGreaterThan(0);
        },
    );
});
