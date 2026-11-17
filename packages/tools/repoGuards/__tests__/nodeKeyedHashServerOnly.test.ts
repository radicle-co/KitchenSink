/**
 * Guard: `@kitchensink/recipe-core/step-writing/node-keyed-hash` is server only.
 *
 * That module imports `node:crypto`, which the web and mobile bundles do not have. It is kept off the package
 * barrel, and this guard closes the other door: only deployable services (`packages/services/**`), recipe-core
 * itself and these guards may import it. An app, the design system, a feature package, the query layer or any other
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

/** Where an import of the module is allowed. */
const ALLOWED_PREFIXES: readonly string[] = [
    'packages/services/',
    'packages/shared/recipe-core/',
    'packages/tools/repoGuards/',
];

/**
 * The files whose imports break the rule.
 *
 * @param sources - Repo-relative path to source text.
 * @returns The paths that import the module and are not allowed to. Pure.
 */
export function offendingImporters(sources: ReadonlyMap<string, string>): readonly string[] {
    return [...sources]
        .filter(([file]) => !ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix)))
        .filter(([, text]) =>
            ts
                .preProcessFile(text, true, true)
                .importedFiles.some(({ fileName }) => fileName === MODULE || fileName.endsWith('/node-keyed-hash')),
        )
        .map(([file]) => file);
}

describe('offendingImporters (the rule, over fixtures)', () => {
    const files = new Map([
        ['packages/apps/commise/mobile/src/a.ts', `import { keyedShingleHash } from '${MODULE}';`],
        ['packages/apps/commise/features/recipes/src/b.tsx', `const m = await import('${MODULE}');`],
        ['packages/shared/query/src/c.ts', `const m = require('${MODULE}');`],
        ['packages/apps/commise/web/src/d.ts', `// ${MODULE} is server only\nconst s = '${MODULE}';`],
        ['packages/services/recipe-service/src/e.ts', `import { keyedShingleHash } from '${MODULE}';`],
    ]);

    it('names every non-server importer, however it imports, and spares comments, strings and services', () => {
        expect(offendingImporters(files)).toEqual([
            'packages/apps/commise/mobile/src/a.ts',
            'packages/apps/commise/features/recipes/src/b.tsx',
            'packages/shared/query/src/c.ts',
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
