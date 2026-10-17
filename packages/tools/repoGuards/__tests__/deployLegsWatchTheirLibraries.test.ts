// @vitest-environment node
/**
 * Guard: a deploy leg starts, and is set, for a change to any workspace library the thing it deploys links. Two
 * halves: every workflow that deploys the global app on a CHANGE watches the libraries that app's production code
 * imports; and every service leg watches the runtime closure of the service packages it deploys.
 *
 * ## The failure this catches
 *
 * `DataStack` digests `@kitchensink/db-schema-guard`'s role statements into its bootstrap custom resource, and its
 * Lambdas bundle that library and others. But `prod-deploy.yml` and `sandbox-identity-deploy.yml` watched only
 * `packages/infra/global/**`. A change to the role registry alone (curated catalog plan U18: a new role) therefore
 * started no global deploy, so the bootstrap never created the role, while every service's migrate refused to run
 * without it (`RoleModelAbsentError`).
 *
 * The service half caught the same class at every service leg (plan 002 architect REVIEW, 2026-09-30): the recipe and
 * food images copy `@kitchensink/clerk-verify`, which holds the `azp` trust boundary and the CORS policy, but their
 * filters watched only their own package, so a change to that boundary redeployed identity and neither of them. On a
 * per-PR preview the same miss is quieter: `deployGate.sh` sees "unchanged and serving" and keeps the old build.
 *
 * ## Why nothing is enumerated
 *
 * The libraries are read from the global app's own imports (`bin/`, `lib/`, `src/`, tests excluded), closed over each
 * library's `dependencies`. A service leg's packages are the `packages/services/<name>/**` entries of its own filter
 * group, closed over their `dependencies`.
 *
 * The workflows are found by what they do. A global-app workflow is one `deployedApps()` says deploys the global app
 * and whose `on:` filters an event by `paths`; a workflow only another workflow calls (`deployInfra.yml`) deploys when
 * called, not on a change, so it has no trigger to hold. A service leg is either every group of a `deployedApps()`
 * workflow's `changes` filter, or a group a `deployGate.sh evaluate` step reads: that is how
 * `sandboxPreview.yml` decides a per-PR deploy it hands to `deployInfra.yml`. A CI workflow's other groups pick test
 * jobs, so they are not subjects. The readers are pinned by fixture cases below, including shapes the tree has never
 * held, because a reader that misses a shape shrinks the watched set with every test still green.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { deployedApps } from './cdkApps.js';
import { repoRoot } from './serviceSources.js';

const GLOBAL_APP = 'packages/infra/global';
const SHARED_INFRA_GLOB = 'shared/infra/**';

/** A workspace package, as the closure reads it. */
interface WorkspacePackage {
    readonly directory: string;
    readonly dependencies: readonly string[];
}

/**
 * The `@kitchensink/*` packages a source file imports: `import … from`, `import type … from`, `export … from`, a
 * side-effect `import '…'`, `import('…')` and `require('…')`, with either quote, subpath imports read as their
 * package. Over-inclusion (a match inside a comment) is the safe direction: it watches one path more. Pure.
 *
 * @param source - The file's text.
 * @returns The package names, in order of appearance.
 */
function importedPackages(source: string): readonly string[] {
    return [
        ...source.matchAll(/(?:\bfrom|\bimport|\bimport\s*\(|\brequire\s*\()\s*['"](@kitchensink\/[a-z0-9-]+)/gu),
    ].map((match) => match[1] ?? '');
}

/**
 * The directories of `roots` and every workspace package they depend on, transitively. Pure.
 *
 * @param roots - Package names imported directly.
 * @param packages - Every workspace package, by name.
 * @returns The directories, sorted.
 * @throws {Error} when a name is not a workspace package.
 */
function closeOverWorkspace(
    roots: readonly string[],
    packages: ReadonlyMap<string, WorkspacePackage>,
): readonly string[] {
    const pending = [...roots];
    const reached = new Set<string>();

    while (pending.length > 0) {
        const name = pending.pop() ?? '';
        const workspacePackage = packages.get(name);

        if (workspacePackage === undefined) {
            throw new Error(`${roots.join(', ')} reach ${name}, which no workspace package.json declares`);
        }

        if (reached.has(workspacePackage.directory)) {
            continue;
        }

        reached.add(workspacePackage.directory);
        pending.push(...workspacePackage.dependencies.filter((dependency) => dependency.startsWith('@kitchensink/')));
    }

    return [...reached].sort();
}

interface WorkflowStep {
    readonly id?: string;
    readonly run?: string;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly with?: { readonly filters?: string };
}

interface Workflow {
    readonly on?: Readonly<Record<string, { readonly paths?: readonly string[] } | null>>;
    readonly jobs?: Readonly<Record<string, { readonly steps?: readonly WorkflowStep[] }>>;
}

/** Every step of every job. Pure. */
function stepsOf(workflow: Workflow): readonly WorkflowStep[] {
    return Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);
}

/**
 * The `changes` filter groups a workflow's `deployGate.sh evaluate` steps read, however each step passes one (an env var
 * of any name, or its run text): the groups that decide a per-service deploy. Pure.
 *
 * @param text - The workflow's YAML.
 * @returns The group names, in step order.
 */
function deployGateGroups(text: string): readonly string[] {
    return stepsOf(parse(text) as Workflow).flatMap((step) => {
        if (step.run?.includes('deployGate.sh evaluate') !== true) {
            return [];
        }

        const sources = [step.run, ...Object.values(step.env ?? {}).filter((value) => typeof value === 'string')];

        return sources.flatMap((source) =>
            [...source.matchAll(/steps\.changes\.outputs\.([\w-]+)/gu)].map((match) => match[1] ?? ''),
        );
    });
}

/**
 * What a workflow watches: the `paths` of each event that filters by them, and its `id: changes` filter's `global`
 * group. Pure.
 *
 * @param text - The workflow's YAML.
 * @returns Per path-filtered event its paths, and the `global` group (empty when the filter has none).
 * @throws {Error} when the workflow has no `id: changes` step to set its legs, or more than one.
 */
function watchedBy(text: string): {
    readonly triggers: Readonly<Record<string, readonly string[]>>;
    readonly global: readonly string[];
    readonly groups: Readonly<Record<string, readonly string[]>>;
} {
    const workflow = parse(text) as Workflow;
    const triggers = Object.fromEntries(
        Object.entries(workflow.on ?? {}).flatMap(([event, config]) =>
            config?.paths === undefined ? [] : [[event, config.paths] as const],
        ),
    );
    const changeSteps = stepsOf(workflow).filter((step) => step.id === 'changes');

    if (changeSteps.length > 1) {
        throw new Error('a deploy workflow has two `id: changes` steps, so which one sets its legs is ambiguous');
    }

    const filters = changeSteps[0]?.with?.filters;

    if (filters === undefined) {
        throw new Error('a path-triggered deploy workflow has no `id: changes` paths-filter step to set its legs');
    }

    const groups = (parse(filters) as Record<string, readonly string[] | null> | null) ?? {};
    const lists = Object.fromEntries(Object.entries(groups).map(([name, patterns]) => [name, patterns ?? []] as const));

    return { triggers, global: lists['global'] ?? [], groups: lists };
}

/** Tracked files matching the pathspecs, read from the git index. */
function tracked(...pathspecs: readonly string[]): readonly string[] {
    return execFileSync('git', ['ls-files', '--', ...pathspecs], { cwd: repoRoot, encoding: 'utf8' })
        .split('\n')
        .filter((line) => line.length > 0);
}

/** Every workspace package, by name, read from the tracked manifests. */
function workspacePackages(): ReadonlyMap<string, WorkspacePackage> {
    return new Map(
        tracked('packages/**/package.json')
            .filter((file) => !file.includes('/node_modules/'))
            .flatMap((file) => {
                const manifest = JSON.parse(readFileSync(join(repoRoot, file), 'utf8')) as {
                    readonly name?: string;
                    readonly dependencies?: Readonly<Record<string, string>>;
                };

                return manifest.name === undefined
                    ? []
                    : [
                          [
                              manifest.name,
                              {
                                  directory: file.slice(0, -'/package.json'.length),
                                  dependencies: Object.keys(manifest.dependencies ?? {}),
                              },
                          ] as const,
                      ];
            }),
    );
}

/**
 * The service packages a leg deploys: its filter group's `packages/services/<name>/**` entries. Pure.
 *
 * @param patterns - The leg's filter group.
 * @returns The package directories.
 */
function servicePackagesOf(patterns: readonly string[]): readonly string[] {
    return patterns.flatMap((pattern) => /^(packages\/services\/[^/*]+)\/\*\*$/u.exec(pattern)?.[1] ?? []);
}

/**
 * The library directories a leg's own group or the workflow's trigger fails to watch. Pure.
 *
 * @param libraries - The directories the leg's packages link.
 * @param watched - The globs that do watch them.
 * @returns The directories no glob covers, as their `/**` glob.
 */
function unwatched(libraries: readonly string[], watched: readonly string[]): readonly string[] {
    return libraries.map((directory) => `${directory}/**`).filter((glob) => !watched.includes(glob));
}

describe('the readers, over fixtures', () => {
    it('reads every import shape, with either quote, and a subpath as its package', () => {
        const source = [
            "import { a } from '@kitchensink/alpha';",
            "import type { B } from '@kitchensink/bravo/sub/path';",
            'export * from "@kitchensink/charlie";',
            "export { d } from '@kitchensink/delta';",
            "import '@kitchensink/echo';",
            "const f = await import('@kitchensink/foxtrot');",
            "const g = require('@kitchensink/golf');",
            "import { h } from 'aws-cdk-lib';",
        ].join('\n');

        expect(importedPackages(source)).toEqual([
            '@kitchensink/alpha',
            '@kitchensink/bravo',
            '@kitchensink/charlie',
            '@kitchensink/delta',
            '@kitchensink/echo',
            '@kitchensink/foxtrot',
            '@kitchensink/golf',
        ]);
    });

    const packages = new Map<string, WorkspacePackage>([
        ['@kitchensink/a', { directory: 'packages/shared/a', dependencies: ['@kitchensink/b', 'zod'] }],
        ['@kitchensink/b', { directory: 'packages/shared/b', dependencies: ['@kitchensink/c'] }],
        ['@kitchensink/c', { directory: 'packages/shared/c', dependencies: ['@kitchensink/a'] }],
        ['@kitchensink/d', { directory: 'packages/shared/d', dependencies: [] }],
    ]);

    it('closes over dependencies two levels down, through a cycle, and leaves out what nothing reaches', () => {
        expect(closeOverWorkspace(['@kitchensink/a'], packages)).toEqual([
            'packages/shared/a',
            'packages/shared/b',
            'packages/shared/c',
        ]);
    });

    it('refuses a name no workspace declares, rather than watching nothing for it', () => {
        expect(() => closeOverWorkspace(['@kitchensink/missing'], packages)).toThrow(/@kitchensink\/missing/u);
    });

    it('reads each path-filtered event and the `global` group, and ignores an event with no paths', () => {
        const workflow = [
            'on:',
            '    push:',
            '        paths: [a/**]',
            '    pull_request:',
            '        paths: [b/**]',
            '    workflow_dispatch:',
            'jobs:',
            '    deploy:',
            '        steps:',
            '            - id: changes',
            '              with:',
            '                  filters: |',
            '                      global:',
            "                        - 'a/**'",
        ].join('\n');

        expect(watchedBy(workflow)).toEqual({
            triggers: { push: ['a/**'], pull_request: ['b/**'] },
            global: ['a/**'],
            groups: { global: ['a/**'] },
        });
    });

    it('reads a leg`s service packages from its own group, and nothing else', () => {
        expect(
            servicePackagesOf([
                'packages/services/recipe-service/**',
                'packages/services/recipe-workers/**',
                'packages/shared/recipe-core/**',
                'packages/services/*/**',
                'Dockerfile',
            ]),
        ).toEqual(['packages/services/recipe-service', 'packages/services/recipe-workers']);
    });

    it('names each library no glob watches, and none that one does', () => {
        expect(unwatched(['packages/shared/a', 'packages/shared/b'], ['packages/shared/a/**'])).toEqual([
            'packages/shared/b/**',
        ]);
    });

    it('reads a filter with no `global` group as watching nothing, so the check below fails', () => {
        const workflow = [
            'on: { push: { paths: [a/**] } }',
            'jobs: { deploy: { steps: [{ id: changes, with: { filters: "food: [a/**]" } }] } }',
        ].join('\n');

        expect(watchedBy(workflow).global).toEqual([]);
    });

    it('reads the groups a `deployGate.sh evaluate` step takes its CHANGED from, and no other group', () => {
        const workflow = [
            'on: { workflow_call: {} }',
            'jobs:',
            '    gate:',
            '        steps:',
            '            - id: changes',
            '              with:',
            '                  filters: |',
            '                      food: [packages/services/food-service/**]',
            '                      docs: [docs/**]',
            '            - name: food gate',
            '              env: { CHANGED: "${{ steps.changes.outputs.food || \'false\' }}" }',
            '              run: .github/scripts/deployGate.sh evaluate "$INTENT" food "$CHANGED"',
            '            - name: not a gate',
            '              env: { CHANGED: "${{ steps.changes.outputs.docs }}" }',
            '              run: ./publish.sh',
            '            - name: a closure over legs, not a deploy decision',
            '              env: { GLOBAL: "${{ steps.changes.outputs.global }}" }',
            '              run: .github/scripts/deployGate.sh close "$GLOBAL"',
        ].join('\n');

        expect(deployGateGroups(workflow)).toEqual(['food']);
    });

    it('reads a gate`s group however the step passes it: a positional argument or an env var of any name', () => {
        const workflow = [
            'jobs:',
            '    gate:',
            '        steps:',
            '            - name: positional',
            '              run: .github/scripts/deployGate.sh evaluate true recipe "${{ steps.changes.outputs.recipe }}"',
            '            - name: renamed env',
            '              env: { WEB_CHANGED: "${{ steps.changes.outputs.web }}" }',
            '              run: .github/scripts/deployGate.sh evaluate true web "$WEB_CHANGED"',
        ].join('\n');

        expect(deployGateGroups(workflow)).toEqual(['recipe', 'web']);
    });

    it('refuses a deploy workflow with two `id: changes` steps, rather than reading only the first', () => {
        const step = '{ id: changes, with: { filters: "food: [a/**]" } }';

        expect(() => watchedBy(`jobs: { a: { steps: [${step}] }, b: { steps: [${step}] } }`)).toThrow(
            /two `id: changes`/u,
        );
    });

    it('refuses a path-triggered workflow with no `id: changes` step', () => {
        expect(() => watchedBy('on: { push: { paths: [a/**] } }\njobs: { deploy: { steps: [] } }')).toThrow(
            /no `id: changes`/u,
        );
    });
});

describe('the global leg watches every workspace library the global app imports', () => {
    const libraries = closeOverWorkspace(
        [
            ...new Set(
                tracked(`${GLOBAL_APP}/bin/**/*.ts`, `${GLOBAL_APP}/lib/**/*.ts`, `${GLOBAL_APP}/src/**/*.ts`)
                    .filter((file) => !file.includes('/__tests__/'))
                    .flatMap((file) => importedPackages(readFileSync(join(repoRoot, file), 'utf8'))),
            ),
        ],
        workspacePackages(),
    );
    const workflows = [
        ...new Set(
            deployedApps()
                .filter((deployment) => deployment.entrypoint === `${GLOBAL_APP}/bin/app.ts`)
                .map((deployment) => deployment.workflow),
        ),
    ]
        .map((file) => ({ file, text: readFileSync(join(repoRoot, '.github/workflows', file), 'utf8') }))
        .filter(({ text }) => Object.values((parse(text) as Workflow).on ?? {}).some((config) => config?.paths));

    it('finds the libraries and the workflows at all (an empty derivation would pass everything below)', () => {
        expect(libraries).toContain('packages/shared/db-schema-guard');
        expect(workflows.map(({ file }) => file)).toEqual(
            expect.arrayContaining(['prod-deploy.yml', 'sandbox-identity-deploy.yml']),
        );
    });

    it('each such workflow starts on, and sets its global leg for, each library', () => {
        const globs = libraries.map((directory) => `${directory}/**`);
        const gaps = workflows.flatMap(({ file, text }) => {
            const { triggers, global } = watchedBy(text);

            return [
                ...Object.entries(triggers).flatMap(([event, paths]) =>
                    globs.filter((glob) => !paths.includes(glob)).map((glob) => `${file} on.${event}.paths: ${glob}`),
                ),
                ...globs.filter((glob) => !global.includes(glob)).map((glob) => `${file} global filter: ${glob}`),
            ];
        });

        expect(gaps).toEqual([]);
    });
});

describe('each service leg of a path-filtered deploy workflow watches the libraries its services link', () => {
    const packages = workspacePackages();
    const nameOf = new Map(
        [...packages].map(([name, workspacePackage]) => [workspacePackage.directory, name] as const),
    );
    // Found by what each workflow does (this file's docstring), never named.
    const deployWorkflows = new Set(deployedApps().map((deployment) => deployment.workflow));
    const workflows = tracked('.github/workflows/*.yml')
        .map((path) => ({
            file: path.slice('.github/workflows/'.length),
            text: readFileSync(join(repoRoot, path), 'utf8'),
        }))
        .flatMap(({ file, text }) => {
            const gated = deployGateGroups(text);
            const deploys =
                deployWorkflows.has(file) && stepsOf(parse(text) as Workflow).some((step) => step.id === 'changes');

            return deploys || gated.length > 0 ? [{ file, gated, deploys, ...watchedBy(text) }] : [];
        });
    const legs = workflows.flatMap(({ file, triggers, groups, gated, deploys }) =>
        Object.entries(groups)
            .filter(([leg]) => deploys || gated.includes(leg))
            .map(([leg, patterns]) => ({ file, triggers, leg, patterns, services: servicePackagesOf(patterns) }))
            // A gated group that names no service package cannot be checked, so it stays in and fails below.
            .filter(({ leg, services }) => services.length > 0 || gated.includes(leg))
            .map(({ services, ...rest }) => ({
                ...rest,
                libraries: closeOverWorkspace(
                    services.map((directory) => nameOf.get(directory) ?? directory),
                    packages,
                ),
            })),
    );

    it('finds the service legs and their libraries at all (an empty derivation would pass everything below)', () => {
        expect(legs.map(({ file, leg }) => `${file}:${leg}`)).toEqual(
            expect.arrayContaining([
                'prod-deploy.yml:service',
                'prod-deploy.yml:webhooks',
                'prod-deploy.yml:food',
                'prod-deploy.yml:recipe',
                'sandbox-identity-deploy.yml:service',
                'sandbox-identity-deploy.yml:webhooks',
                'sandboxPreview.yml:food',
                'sandboxPreview.yml:recipe',
            ]),
        );
        expect(legs.find(({ leg }) => leg === 'recipe')?.libraries).toContain('packages/shared/clerk-verify');
    });

    it('each leg`s own filter group watches every library, and so does every trigger', () => {
        const gaps = legs.flatMap(({ file, triggers, leg, patterns, libraries }) => [
            ...(libraries.length === 0 ? [`${file} ${leg} filter names no service package`] : []),
            ...unwatched(libraries, patterns).map((glob) => `${file} ${leg} filter: ${glob}`),
            ...Object.entries(triggers).flatMap(([event, paths]) =>
                unwatched(libraries, paths).map((glob) => `${file} on.${event}.paths: ${glob}`),
            ),
        ]);

        expect([...new Set(gaps)]).toEqual([]);
    });

    it('sandbox preview gates watch the shared CDK constructs every preview CDK app consumes', () => {
        const preview = workflows.find(({ file }) => file === 'sandboxPreview.yml');

        expect(preview, 'sandboxPreview.yml must be discovered so this guard is not vacuous').toBeDefined();

        const watchedLegs = ['food', 'recipe', 'search'] as const;
        const missing = watchedLegs
            .filter((leg) =>
                preview?.groups[leg]?.some(
                    (pattern) =>
                        pattern === `packages/services/${leg === 'search' ? 'remote-search' : `${leg}-service`}/**`,
                ),
            )
            .filter((leg) => preview?.groups[leg]?.includes(SHARED_INFRA_GLOB) !== true);

        expect(missing).toEqual([]);
    });
});
