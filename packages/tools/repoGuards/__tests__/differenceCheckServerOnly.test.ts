// @vitest-environment node
/**
 * Repo-wide guard (board P4a, plan paidSiteAdaptedUnlock KTD-1, qse F-6): `@kitchensink/difference-check` is SERVER ONLY.
 * No workspace that reaches a client bundle declares it in `package.json` or imports it from source.
 *
 * ## The failure this catches
 *
 * The package carries Unicode's confusables map (200 kB of data) and the v1 measure. Its answer is also what earns the
 * "Adapted by you" fact, so a copy that ran in the browser would let a client tell itself the check passed, and would ship
 * the map to every visitor. It lives in its own package, not in `recipe-core`, because both apps bundle `recipe-core`.
 * Nothing in the toolchain stops a feature package from importing a shared package, so a guard does.
 *
 * ## What "reaches a client bundle" means here
 *
 * The CLOSURE of the two apps' manifests: `@commise/web` and `@commise/mobile`, and every workspace package they declare
 * in `dependencies`, `devDependencies`, `peerDependencies` or `optionalDependencies`, transitively. Dev dependencies are
 * counted on purpose: a guard that trusted the split between runtime and dev fields would miss a package that moves a
 * line from one to the other. The closure is DERIVED from the manifests, never written down, so a new client-side
 * package is covered the day it is declared.
 *
 * ## What it does not prove
 *
 * A path built at runtime and passed to `import()`, and a server package that re-exports the check to a client by a
 * route this guard does not follow (a wire type is the only such route, and it carries no code).
 *
 * ## Mutation evidence
 *
 *   1. `import '@kitchensink/difference-check'` added to a source in `packages/apps/commise/features/recipes/src` ->
 *      'no workspace that reaches a client bundle imports the check' reports it (run seen red, then removed).
 *   2. `"@kitchensink/difference-check": "*"` added to `packages/apps/commise/ui/package.json` -> 'no workspace that
 *      reaches a client bundle declares the check' reports it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ownerOf } from '@kitchensink/e2e-plan/checkScope';
import { loadWorkspaces } from '@kitchensink/e2e-plan/checkScopeGraph';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';
import { isSource, moduleSpecifiers, trackedPackageFiles } from './workspaceSourceScan.js';

/** The package that must stay on the server. */
const CHECK = '@kitchensink/difference-check';

/** The apps whose bundles reach a person's device. */
const CLIENT_ROOTS = ['@commise/web', '@commise/mobile'] as const;

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

/** A workspace's declared dependencies, by field. */
type Manifest = Partial<Record<(typeof DEPENDENCY_FIELDS)[number], Readonly<Record<string, string>>>>;

/**
 * Every workspace reachable from `roots` through declared dependencies.
 *
 * @param roots - The starting workspaces.
 * @param manifests - Each workspace's manifest by name.
 * @returns The roots and everything they declare, transitively, among the known workspaces.
 */
function closureOf(roots: readonly string[], manifests: ReadonlyMap<string, Manifest>): Set<string> {
    const seen = new Set<string>();
    const pending = [...roots];

    for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
        const manifest = manifests.get(name);

        if (seen.has(name) || manifest === undefined) {
            continue;
        }

        seen.add(name);

        for (const field of DEPENDENCY_FIELDS) {
            pending.push(...Object.keys(manifest[field] ?? {}));
        }
    }

    return seen;
}

/** The names in alphabetical order, so a failure message and a comparison do not depend on the walk order. */
function sorted(names: Iterable<string>): string[] {
    return [...names].sort((left, right) => left.localeCompare(right));
}

describe('closureOf', () => {
    const graph = new Map<string, Manifest>([
        ['app', { dependencies: { ui: '*' }, devDependencies: { tooling: '*' } }],
        ['ui', { peerDependencies: { core: '*' } }],
        ['core', { optionalDependencies: { leaf: '*' } }],
        ['leaf', {}],
        ['tooling', {}],
        ['server', { dependencies: { core: '*' } }],
    ]);

    it('follows every dependency field, transitively, and stops at a package no manifest knows', () => {
        expect(sorted(closureOf(['app'], graph))).toEqual(['app', 'core', 'leaf', 'tooling', 'ui']);
        expect(sorted(closureOf(['app'], new Map([...graph, ['leaf', { dependencies: { npmOnly: '1' } }]])))).toEqual([
            'app',
            'core',
            'leaf',
            'tooling',
            'ui',
        ]);
    });

    it('does not reach a package only a server declares, and survives a cycle', () => {
        expect(closureOf(['app'], graph).has('server')).toBe(false);
        expect(
            [
                ...closureOf(
                    ['a'],
                    new Map<string, Manifest>([
                        ['a', { dependencies: { b: '*' } }],
                        ['b', { dependencies: { a: '*' } }],
                    ]),
                ),
            ].sort(),
        ).toEqual(['a', 'b']);
    });
});

const WORKSPACES = await loadWorkspaces(repoRoot);
const MANIFESTS = new Map<string, Manifest>(
    WORKSPACES.map((workspace) => [
        workspace.name,
        JSON.parse(readFileSync(join(repoRoot, workspace.dir, 'package.json'), 'utf8')) as Manifest,
    ]),
);
const CLIENT_REACHING = closureOf(CLIENT_ROOTS, MANIFESTS);

describe('@kitchensink/difference-check is server only', () => {
    it('scans the closure it claims to: both apps, the design system and the shared recipe package are in it', () => {
        for (const expected of [...CLIENT_ROOTS, '@commise/ui', '@kitchensink/recipe-core']) {
            expect(CLIENT_REACHING.has(expected)).toBe(true);
        }

        expect(CLIENT_REACHING.size).toBeGreaterThan(15);
    });

    it('exists as a workspace, outside the client closure itself', () => {
        expect(MANIFESTS.has(CHECK)).toBe(true);
        expect(CLIENT_REACHING.has(CHECK)).toBe(false);
    });

    it('no workspace that reaches a client bundle declares the check', () => {
        const declarers = [...CLIENT_REACHING].filter((name) =>
            DEPENDENCY_FIELDS.some((field) => MANIFESTS.get(name)?.[field]?.[CHECK] !== undefined),
        );

        expect(sorted(declarers)).toEqual([]);
    });

    it('no workspace that reaches a client bundle imports the check', () => {
        const importers = new Set<string>();

        for (const file of trackedPackageFiles().filter(isSource)) {
            const owner = ownerOf(file, WORKSPACES);

            if (owner === undefined || !CLIENT_REACHING.has(owner)) {
                continue;
            }

            if (
                moduleSpecifiers(file, readFileSync(join(repoRoot, file), 'utf8')).some(
                    (name) => name === CHECK || name.startsWith(`${CHECK}/`),
                )
            ) {
                importers.add(`${file} (${owner})`);
            }
        }

        expect(sorted(importers)).toEqual([]);
    });
});
