// @vitest-environment node
/**
 * Repo-wide guard for ADR-0091: every workspace package a source file imports is declared by the workspace that holds
 * the file, tests included. A file in a nested project (a service's `infra/`) counts for the workspace around it: turbo
 * reads only workspace manifests, and the selector gives such a file to that workspace.
 *
 * The changed-only selector walks turbo's package graph, and turbo builds that graph from the manifests. A workspace
 * imported through npm's hoisting without a declaration has no edge, so a change to it selects nothing that uses it and
 * the run reads green. `import-x/no-extraneous-dependencies` holds this only for image services' production `src/`.
 * This guard holds it for every file, `import type` and `vi.mock` included, because a type-only import still breaks
 * the importer's typecheck when the imported package changes.
 *
 * What it does not prove: imports of third-party packages (npm resolution and lint cover those), or a path built at
 * runtime and passed to `import()`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';
import {
    declaredDependencies,
    isSource,
    moduleSpecifiers,
    ownerOf,
    trackedPackageFiles,
    workspaces,
} from './workspaceSourceScan.js';

const WORKSPACES = workspaces();
const NAMES = new Set(WORKSPACES.map((workspace) => workspace.name));
const SCOPED = /^(@(?:commise|kitchensink)\/[^/]+)/u;

describe('moduleSpecifiers', () => {
    it('reads every way a source names a module, and nothing in a comment or a plain string', () => {
        const source = [
            "import a from '@kitchensink/a';",
            "import type { B } from '@kitchensink/b';",
            "export { c } from '@kitchensink/c';",
            "type D = import('@kitchensink/d').D;",
            "const e = await import('@kitchensink/e');",
            "const f = require('@kitchensink/f');",
            "vi.mock('@kitchensink/g', () => ({}));",
            "vi.importActual('@kitchensink/h');",
            "// import x from '@kitchensink/comment';",
            "const label = '@kitchensink/just-a-string';",
        ].join('\n');

        expect(moduleSpecifiers('x.ts', source)).toEqual([
            '@kitchensink/a',
            '@kitchensink/b',
            '@kitchensink/c',
            '@kitchensink/d',
            '@kitchensink/e',
            '@kitchensink/f',
            '@kitchensink/g',
            '@kitchensink/h',
        ]);
    });
});

describe('workspace imports', () => {
    const sources = trackedPackageFiles().filter(isSource);

    it('scans the tree it claims to', () => {
        expect(WORKSPACES.length).toBeGreaterThan(40);
        expect(sources.length).toBeGreaterThan(2000);
    });

    it('are declared by the workspace that holds the importing file', () => {
        const undeclared = new Set<string>();

        for (const file of sources) {
            const owner = ownerOf(file, WORKSPACES);
            const text = owner === undefined ? '' : readFileSync(join(repoRoot, file), 'utf8');

            if (owner === undefined || !/@(?:commise|kitchensink)\//u.test(text)) {
                continue;
            }

            const declared = declaredDependencies(owner.dir);

            for (const specifier of moduleSpecifiers(file, text)) {
                const name = SCOPED.exec(specifier)?.[1];

                if (name !== undefined && NAMES.has(name) && name !== owner.name && !declared.has(name)) {
                    undeclared.add(`${file} imports ${name}, which ${owner.dir}/package.json does not declare`);
                }
            }
        }

        expect([...undeclared].sort()).toEqual([]);
    });
});
