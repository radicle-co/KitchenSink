/**
 * THE IMAGE CLOSURE: every path a content-keyed deployable is built FROM, and nothing it is not.
 *
 * `deployKey.sh` hashes the git objects of exactly these paths into the content key that names an image
 * (`imageTag.sh content <key>`, ADR-0067). Two failure directions, and each costs differently:
 *
 *  - a path MISSING from the closure means two different builds share one key, and the second is never built —
 *    a stale image deployed behind green checks;
 *  - a path that does not belong means the key changes when the build did not, and the image is rebuilt for
 *    nothing (`repoGuards` changed in 32 of the last 100 commits, identity's runtime in 5).
 *
 * The closure is GENERATED (`scripts/infrastructureManifest.mjs` → `imageClosures.tsv`) under the manifest's
 * staleness gate. This suite checks it against two INDEPENDENT readings of the same facts: the Dockerfile's own
 * `COPY` lines, and a dependency walk written here rather than imported, because one shared helper can be wrong
 * in the same way on both sides and still agree (ADR-0035's two-digest rule).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';
import {
    CONTENT_DEPLOYABLES,
    buildImageClosures,
    workspacePackages,
} from '../../../../scripts/infrastructureManifest.mjs';

interface ClosureEntry {
    readonly deployable: string;
    readonly path: string;
}

const closures = buildImageClosures() as readonly ClosureEntry[];
const pathsOf = (deployable: string): readonly string[] =>
    closures.filter((entry) => entry.deployable === deployable).map((entry) => entry.path);
const packages = workspacePackages() as ReadonlyMap<
    string,
    { readonly directory: string; readonly dependencies: readonly string[] }
>;
const directoryOf = (name: string): string => packages.get(name)?.directory ?? `<no workspace ${name}>`;

/** A dependency walk written HERE, from the manifests alone, so it is not the generator's code agreeing with itself. */
function runtimeClosure(rootDirectory: string): readonly string[] {
    const byDirectory = new Map([...packages.values()].map((entry) => [entry.directory, entry]));
    const seen = new Set<string>();
    const pending = [rootDirectory];

    while (pending.length > 0) {
        const directory = pending.pop() as string;

        if (seen.has(directory)) {
            continue;
        }

        seen.add(directory);
        const manifest = JSON.parse(readFileSync(path.join(repoRoot, directory, 'package.json'), 'utf8')) as {
            readonly dependencies?: Readonly<Record<string, string>>;
        };

        for (const name of Object.keys(manifest.dependencies ?? {})) {
            const dependency = packages.get(name);

            if (dependency !== undefined && byDirectory.has(dependency.directory)) {
                pending.push(dependency.directory);
            }
        }
    }

    return [...seen].sort();
}

describe.each(CONTENT_DEPLOYABLES as readonly { readonly name: string; readonly directory: string }[])(
    'the image closure of $name',
    ({ name, directory }) => {
        const paths = pathsOf(name);

        it('is not empty, so every check below is checking something', () => {
            expect(paths.length).toBeGreaterThan(10);
        });

        it('holds exactly the packages its runtime dependencies reach, read independently', () => {
            const packageDirectories = paths
                .filter((file) => file.endsWith('/package.json'))
                .map((file) => path.dirname(file))
                .sort();

            expect(packageDirectories).toEqual(runtimeClosure(directory));
        });

        it('holds the root manifest and lockfile: the image copies the pruned root node_modules', () => {
            expect(paths).toContain('package.json');
            expect(paths).toContain('package-lock.json');
        });

        it('holds the shared compiler configuration its tsconfig extends', () => {
            expect(paths).toContain(`${directoryOf('@kitchensink/typescript')}/base.json`);
        });

        it('holds no development tool: a lint, test or guard change does not change what is built', () => {
            for (const tool of [
                '@kitchensink/repo-guards',
                '@kitchensink/vitest',
                '@kitchensink/eslint',
                '@kitchensink/prettier',
                '@kitchensink/service-test-harness',
            ]) {
                expect(paths.filter((file) => file.startsWith(`${directoryOf(tool)}/`))).toEqual([]);
            }
        });

        it('holds nothing under an infra/ directory, its tests, or a test or lint config', () => {
            expect(paths.filter((file) => /(^|\/)(infra|tests)(\/|$)/u.test(file))).toEqual([]);
            expect(paths.filter((file) => /\/(vitest\.[^/]*config\.ts|eslint\.config\.[cm]?js)$/u.test(file))).toEqual(
                [],
            );
        });
    },
);

describe('the identity image closure covers every source its Dockerfile copies', () => {
    const dockerfile = readFileSync(path.join(repoRoot, 'packages/services/identity/Dockerfile'), 'utf8');
    const sources = [...dockerfile.matchAll(/^COPY (packages\/\S+)/gmu)].map((match) => match[1] ?? '');
    const paths = pathsOf('identity-service');

    it('finds the COPY lines, so the check is not vacuous', () => {
        expect(sources.length).toBeGreaterThan(10);
    });

    it.each(sources)('%s is inside a package the closure holds', (source) => {
        const owner = [...packages.values()]
            .map((entry) => entry.directory)
            .filter((candidate) => source.startsWith(`${candidate}/`))
            .sort((a, b) => b.length - a.length)[0];

        expect(owner).toBeDefined();
        expect(paths).toContain(`${owner}/package.json`);
    });

    it('holds the script docker:prepare runs, which writes the production manifests the image copies', () => {
        expect(paths).toContain('scripts/prepareProdManifest.mjs');
    });
});
