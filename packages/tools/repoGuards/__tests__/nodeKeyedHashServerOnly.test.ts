/**
 * Guard: `@kitchensink/recipe-core/step-writing/node-keyed-hash` is server only.
 *
 * That module imports `node:crypto`, which the web and mobile bundles do not have. It is kept off the package
 * barrel, and this guard enforces that: only deployable services (`packages/services/**`), these guards and
 * recipe-core's own tests may import it. An app, the design system, a feature package, the query layer or any other
 * shared package (the apps bundle them) that imports it fails here, before a bundler or a device finds out.
 *
 * Imports are read with the TypeScript pre-processor, so a comment or a string that merely names the module is not
 * an import. Files come from the git index, as the other guards do.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const MODULE = '@kitchensink/recipe-core/step-writing/node-keyed-hash';

/** Where an import of the module is allowed: deployable services and these guards. */
const ALLOWED_PREFIXES: readonly string[] = ['packages/services/', 'packages/tools/repoGuards/'];

/**
 * Inside recipe-core only its own tests may import the module. Every other recipe-core source is bundled into the
 * apps through the barrel, so a default hasher in `wordShingles.ts` or a barrel export would put `node:crypto` there.
 */
const RECIPE_CORE_TESTS = /^packages\/shared\/recipe-core\/(src\/(.*\/)?__tests__|tests)\//u;

/** The module as written in an import: the package subpath, or a relative path to its file. */
const MODULE_SPECIFIER = /(^|\/)(node-keyed-hash|nodeKeyedHash)(\.js)?$/u;

const isAllowed = (file: string): boolean =>
    ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix)) || RECIPE_CORE_TESTS.test(file);

/**
 * The files whose imports break the rule.
 *
 * @param sources - Repo-relative path to source text.
 * @returns The paths that import the module and are not allowed to. Pure.
 */
export function offendingImporters(sources: ReadonlyMap<string, string>): readonly string[] {
    return [...sources]
        .filter(([file]) => !isAllowed(file))
        .filter(([, text]) =>
            ts.preProcessFile(text, true, true).importedFiles.some(({ fileName }) => MODULE_SPECIFIER.test(fileName)),
        )
        .map(([file]) => file);
}

describe('offendingImporters (the rule, over fixtures)', () => {
    const files = new Map([
        ['packages/apps/commise/mobile/src/a.ts', `import { keyedShingleHash } from '${MODULE}';`],
        ['packages/apps/commise/features/recipes/src/b.tsx', `const m = await import('${MODULE}');`],
        ['packages/shared/query/src/c.ts', `const m = require('${MODULE}');`],
        ['packages/apps/commise/web/src/d.ts', `// ${MODULE} is server only\nconst s = '${MODULE}';`],
        ['packages/shared/recipe-core/src/stepWriting/wordShingles.ts', `import { x } from './nodeKeyedHash.js';`],
        ['packages/shared/recipe-core/src/index.ts', `export * from './stepWriting/nodeKeyedHash.js';`],
        [
            'packages/shared/recipe-core/src/__tests__/top.test.ts',
            `import { x } from '../stepWriting/nodeKeyedHash.js';`,
        ],
        [
            'packages/shared/recipe-core/tests/fp.integration.test.ts',
            `import { x } from '../src/stepWriting/nodeKeyedHash.js';`,
        ],
        [
            'packages/shared/recipe-core/src/stepWriting/__tests__/nodeKeyedHash.test.ts',
            `import { keyedShingleHash } from '../nodeKeyedHash.js';`,
        ],
        ['packages/services/recipe-service/src/e.ts', `import { keyedShingleHash } from '${MODULE}';`],
    ]);

    it('names every non-server importer, however it imports, and spares comments, strings and services', () => {
        expect(offendingImporters(files)).toEqual([
            'packages/apps/commise/mobile/src/a.ts',
            'packages/apps/commise/features/recipes/src/b.tsx',
            'packages/shared/query/src/c.ts',
            'packages/shared/recipe-core/src/stepWriting/wordShingles.ts',
            'packages/shared/recipe-core/src/index.ts',
        ]);
    });
});

describe('the node keyed hash', () => {
    it('imports node:crypto, which is why it is server only', () => {
        const source = readFileSync(
            path.join(repoRoot, 'packages/shared/recipe-core/src/stepWriting/nodeKeyedHash.ts'),
            'utf8',
        );
        expect(ts.preProcessFile(source).importedFiles.map(({ fileName }) => fileName)).toContain('node:crypto');
    });

    it('is imported by no app, feature, design-system or shared source', () => {
        const tracked = execFileSync('git', ['ls-files', '--', 'packages/*.ts', 'packages/*.tsx'], {
            cwd: repoRoot,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
        })
            .split('\n')
            .filter((file) => file !== '');
        expect(tracked.length).toBeGreaterThan(1000);

        const sources = new Map(tracked.map((file) => [file, readFileSync(path.join(repoRoot, file), 'utf8')]));
        expect(offendingImporters(sources)).toEqual([]);
    });
});
