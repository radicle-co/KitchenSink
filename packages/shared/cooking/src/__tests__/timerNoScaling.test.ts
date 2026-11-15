/**
 * Cook time does not scale with yield (FR-034a), so no part of the timer may be able to take a servings figure. The
 * rule is structural: nothing the timer modules import, directly or through the modules those import, is about scaling,
 * servings or yield, so a scale factor has no way in. Imports are read from the whole source, wrapped over several
 * lines or not.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every module specifier a file imports or re-exports from, wherever its line breaks fall. */
function specifiersOf(source: string): readonly string[] {
    return [...source.matchAll(/\b(?:from|import)\s*['"]([^'"]+)['"]/gu)].map((match) => match[1] ?? '');
}

/** Resolves a workspace package specifier from a file to its source file, or `undefined` for any other package. */
type ResolvePackage = (specifier: string, fromFile: string) => string | undefined;

const WORKSPACE = /^@(?:kitchensink|commise)\//u;

/** The source file a workspace specifier names, through the package's own `exports`. */
const resolveWorkspace: ResolvePackage = (specifier, fromFile) =>
    WORKSPACE.test(specifier) ? createRequire(fromFile).resolve(specifier) : undefined;

/**
 * The files reachable from an entry, following relative imports and workspace packages (`@kitchensink/*`,
 * `@commise/*`) into their source, and every package specifier met on the way. A third-party package is judged by its
 * specifier only.
 */
function closureOf(
    entry: string,
    resolvePackage: ResolvePackage = resolveWorkspace,
): { readonly files: readonly string[]; readonly packages: readonly string[] } {
    const files = new Set<string>();
    const packages = new Set<string>();
    const pending = [entry];

    for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
        if (files.has(file)) {
            continue;
        }

        files.add(file);

        for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
            if (specifier.startsWith('.')) {
                pending.push(resolve(dirname(file), specifier.replace(/\.js$/u, '.ts')));
            } else {
                packages.add(specifier);

                const source = resolvePackage(specifier, file);

                if (source !== undefined) {
                    pending.push(source);
                }
            }
        }
    }

    return { files: [...files], packages: [...packages] };
}

describe.each(['timer.ts', 'duration.ts'])('%s has no way to take a servings figure', (name) => {
    const entry = resolve(SRC, name);
    const { files, packages } = closureOf(entry);

    it('reaches nothing about scaling, servings or yield, directly or through another module', () => {
        expect(files.length).toBeGreaterThan(0);
        expect([...files, ...packages].filter((path) => /scal|serving|yield/iu.test(path))).toEqual([]);
    });

    it('follows the workspace packages it imports into their source', () => {
        expect(files.some((path) => path.includes('measureReader'))).toBe(name === 'duration.ts');
    });

    it('never reads the ambient clock', () => {
        for (const file of files) {
            const source = readFileSync(file, 'utf8');

            expect(source).not.toMatch(/Date\s*\.\s*now\s*\(/u);
            expect(source).not.toMatch(/new\s+Date\s*\(/u);
            expect(source).not.toMatch(/performance\s*\.\s*now/u);
        }
    });
});

describe('the closure reader itself', () => {
    it('follows a workspace package into its source and reports a scaling module behind it', () => {
        const dir = mkdtempSync(join(tmpdir(), 'guardFixture-'));

        try {
            writeFileSync(join(dir, 'entry.ts'), "import { x } from '@kitchensink/fake/measure';\n");
            writeFileSync(join(dir, 'measure.ts'), "import { y } from './scaleRecipe.js';\n");
            writeFileSync(join(dir, 'scaleRecipe.ts'), 'export const y = 1;\n');

            const { files } = closureOf(join(dir, 'entry.ts'), (specifier) =>
                specifier === '@kitchensink/fake/measure' ? join(dir, 'measure.ts') : undefined,
            );

            expect(files.filter((path) => /scal|serving|yield/iu.test(path))).toEqual([join(dir, 'scaleRecipe.ts')]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('sees an import wrapped over several lines, and a re-export', () => {
        const source =
            "import {\n    a,\n    b,\n} from './scaleRecipe.js';\nexport { c } from '@x/servings';\nimport './plain.js';";

        expect(specifiersOf(source)).toEqual(['./scaleRecipe.js', '@x/servings', './plain.js']);
    });
});
