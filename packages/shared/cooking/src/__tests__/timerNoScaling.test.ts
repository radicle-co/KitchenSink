/**
 * Cook time does not scale with yield (FR-034a), so no part of the timer may be able to take a servings figure. The
 * rule is structural: nothing the timer modules import, directly or through the modules those import, is about scaling,
 * servings or yield, so a scale factor has no way in. Imports are read from the whole source, wrapped over several
 * lines or not.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every module specifier a file imports or re-exports from, wherever its line breaks fall. */
function specifiersOf(source: string): readonly string[] {
    return [...source.matchAll(/\b(?:from|import)\s*['"]([^'"]+)['"]/gu)].map((match) => match[1] ?? '');
}

/** The relative files reachable from an entry, and every non-relative package it reaches on the way. */
function closureOf(entry: string): { readonly files: readonly string[]; readonly packages: readonly string[] } {
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
    it('sees an import wrapped over several lines, and a re-export', () => {
        const source =
            "import {\n    a,\n    b,\n} from './scaleRecipe.js';\nexport { c } from '@x/servings';\nimport './plain.js';";

        expect(specifiersOf(source)).toEqual(['./scaleRecipe.js', '@x/servings', './plain.js']);
    });
});
