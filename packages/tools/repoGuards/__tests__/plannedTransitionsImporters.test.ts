/**
 * PLANNED edges are not enforced, so nothing at runtime may read them (docs/architecture/recipeStateModel.md 5). The one
 * reader is the doc generator. The list is a subpath export of recipe-core and not part of its root entry, so a stray
 * import has to name the subpath, and this guard finds it.
 */
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

const SUBPATH = '@kitchensink/recipe-core/recipe-state/planned';

/** Every source file of the workspaces, as raw text, read lazily. Installed packages and build output are left out. */
const SOURCES = import.meta.glob<string>(
    [
        '../../../../packages/**/*.{ts,tsx,mts,cts,js,mjs,cjs}',
        '!../../../../packages/**/{node_modules,dist,dist-lambda,.next,.turbo,cdk.out,coverage}/**',
        '!../../../../packages/tools/repoGuards/**',
        '!../../../../packages/shared/recipe-core/src/recipeState/plannedTransitions.ts',
    ],
    { query: '?raw', import: 'default' },
);

const ROOT_INDEX = import.meta.glob<string>('../../../shared/recipe-core/src/index.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
});
const MANIFEST = import.meta.glob<string>('../../../shared/recipe-core/package.json', {
    query: '?raw',
    import: 'default',
    eager: true,
});

/** The modules beside `plannedTransitions.ts`, as text. The state module's own entry is one of them. */
const MODULE_FILES = import.meta.glob<string>(
    [
        '../../../shared/recipe-core/src/recipeState/*.ts',
        '!../../../shared/recipe-core/src/recipeState/plannedTransitions.ts',
    ],
    { query: '?raw', import: 'default', eager: true },
);

describe('the planned transitions subpath', () => {
    it('is not imported or re-exported by any other module of the state model', () => {
        expect(Object.keys(MODULE_FILES).length).toBeGreaterThan(5);
        expect(
            Object.entries(MODULE_FILES)
                .filter(([, text]) =>
                    text
                        .split('\n')
                        .some(
                            (line) =>
                                line.includes('plannedTransitions') &&
                                (line.includes(' from ') || line.includes('import(')),
                        ),
                )
                .map(([file]) => file),
        ).toEqual([]);
    });

    it('is imported only by the recipe state doc generator', async () => {
        const sources = await Promise.all(
            Object.entries(SOURCES).map(async ([file, load]) => ({ file, text: await load() })),
        );
        const importers = sources.filter(({ text }) => text.includes(SUBPATH)).map(({ file }) => file);

        expect(sources.length).toBeGreaterThan(1000);
        expect(importers.length).toBeGreaterThan(0);
        expect(importers.filter((file) => !file.includes('/recipeStateDoc/'))).toEqual([]);
    });

    it('is not re-exported from the root entry of recipe-core', () => {
        const [index] = Object.values(ROOT_INDEX);

        expect(index).toContain('export');
        expect(index).not.toMatch(/plannedTransitions/u);
    });

    it('is declared as a subpath export', () => {
        const [manifest] = Object.values(MANIFEST);

        expect(manifest).toContain('"./recipe-state/planned": "./src/recipeState/plannedTransitions.ts"');
    });
});
