import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeFixtureRepo, resolutionFixture, type FixtureRepo } from '../__fixtures__/makeFixtureRepo.js';
import { buildImportGraph, type GraphProfile } from '../src/dependencyGraph.js';

const web: GraphProfile = {
    name: 'web',
    cruise: ['apps/web/src'],
    tsConfig: 'apps/web/tsconfig.json',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.mjs'],
};
const mobile: GraphProfile = {
    name: 'mobile',
    cruise: ['apps/mobile/src'],
    tsConfig: 'apps/mobile/tsconfig.json',
    extensions: ['.native.tsx', '.native.ts', '.tsx', '.ts', '.js', '.jsx', '.json', '.mjs'],
};

describe('buildImportGraph', () => {
    let repo: FixtureRepo;

    beforeAll(() => {
        repo = makeFixtureRepo(resolutionFixture);
    });
    afterAll(() => repo.remove());

    it('resolves a workspace export that points at a dist nobody built to its src file', async () => {
        const graph = await buildImportGraph(repo.root, web);

        expect(graph.importersOf('packages/ui/src/index.ts')).toEqual(['apps/web/src/app/page.tsx']);
        expect(graph.importersOf('packages/ui/src/tokens/colors.ts')).toContain('apps/web/src/app/page.tsx');
    });

    it('resolves a workspace export that points at src, and the tsconfig @/ alias', async () => {
        const graph = await buildImportGraph(repo.root, web);

        expect(graph.importersOf('packages/core/src/index.ts')).toEqual(['apps/web/src/app/page.tsx']);
        expect(graph.importersOf('packages/core/src/deep.ts')).toEqual(['apps/web/src/lib/a.ts']);
        expect(graph.importersOf('apps/web/src/lib/a.ts')).toEqual(['apps/web/src/app/page.tsx']);
    });

    it('lists what a file imports, the other way round', async () => {
        const graph = await buildImportGraph(repo.root, web);

        expect(graph.importsOf('apps/web/src/lib/a.ts')).toEqual(['packages/core/src/deep.ts']);
    });

    it('maps each raw specifier of a file to the file it resolved to, so a name-level walk can match an import to its edge', async () => {
        const graph = await buildImportGraph(repo.root, web);

        expect(graph.specifiersOf('apps/web/src/app/page.tsx')).toEqual(
            new Map([
                ['@fx/ui', 'packages/ui/src/index.ts'],
                ['@fx/ui/tokens/colors', 'packages/ui/src/tokens/colors.ts'],
                ['@fx/core', 'packages/core/src/index.ts'],
                ['@/lib/a', 'apps/web/src/lib/a.ts'],
            ]),
        );
    });

    it('follows the platform order in the specifier map: the same `./button` is the native leaf on mobile', async () => {
        const graph = await buildImportGraph(repo.root, mobile);

        expect(graph.specifiersOf('apps/mobile/src/screen.tsx').get('./button')).toBe(
            'apps/mobile/src/button.native.tsx',
        );
    });

    it('has no specifiers for a file it does not hold', async () => {
        expect((await buildImportGraph(repo.root, web)).specifiersOf('nope.ts').size).toBe(0);
    });

    it('lists every file it holds, so a registry can be derived from it', async () => {
        const graph = await buildImportGraph(repo.root, web);

        expect(graph.files).toContain('apps/web/src/app/page.tsx');
        expect(graph.files).toContain('packages/core/src/deep.ts');
        expect(graph.files.every((file) => graph.has(file))).toBe(true);
    });

    it('finds no unresolved internal import in a well-formed tree', async () => {
        expect((await buildImportGraph(repo.root, web)).problems).toEqual([]);
    });

    it('resolves the .native leaf first on mobile, so the web leaf has no importer there', async () => {
        const graph = await buildImportGraph(repo.root, mobile);

        expect(graph.importersOf('apps/mobile/src/button.native.tsx')).toEqual([
            'apps/mobile/src/list.tsx',
            'apps/mobile/src/screen.tsx',
        ]);
        expect(graph.importersOf('apps/mobile/src/button.tsx')).toEqual([]);
    });

    it('resolves a .js specifier to the .ts source, as the NodeNext packages write it', async () => {
        const graph = await buildImportGraph(repo.root, mobile);

        expect(graph.importersOf('apps/mobile/src/util.ts')).toEqual(['apps/mobile/src/list.tsx']);
        expect(graph.problems).toEqual([]);
    });

    it('resolves the web leaf on web', async () => {
        const graph = await buildImportGraph(repo.root, {
            ...web,
            cruise: ['apps/mobile/src'],
            tsConfig: 'apps/mobile/tsconfig.json',
        });

        expect(graph.importersOf('apps/mobile/src/button.tsx')).toEqual([
            'apps/mobile/src/list.tsx',
            'apps/mobile/src/screen.tsx',
        ]);
    });
});

describe('buildImportGraph problems', () => {
    it.each([
        ['a relative import that matches no file', "import './missing';", './missing'],
        ['a workspace package that does not exist', "import '@fx/nope';", '@fx/nope'],
        ['an @/ import that matches no file', "import '@/lib/gone';", '@/lib/gone'],
        ['a workspace export whose dist has no src', "import '@fx/ui/theme.css';", '@fx/ui/theme.css'],
    ])('reports %s, so the caller can widen to the full suite', async (_name, source, specifier) => {
        const broken = makeFixtureRepo({
            ...resolutionFixture,
            'packages/ui/package.json': JSON.stringify({
                name: '@fx/ui',
                exports: { '.': './dist/index.js', './theme.css': './dist/theme.css' },
            }),
            'apps/web/src/app/broken.tsx': `${source}\n`,
        });

        try {
            const graph = await buildImportGraph(broken.root, web);

            expect(graph.problems.join('\n')).toContain(specifier);
        } finally {
            broken.remove();
        }
    });

    it('does not report an external package, which no change here can alter', async () => {
        const external = makeFixtureRepo({
            ...resolutionFixture,
            'apps/web/src/app/ext.tsx': "import 'react';\nimport 'node:fs';\n",
        });

        try {
            expect((await buildImportGraph(external.root, web)).problems).toEqual([]);
        } finally {
            external.remove();
        }
    });
});
