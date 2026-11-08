import { describe, expect, it } from 'vitest';

import { parseBindings } from '../src/moduleBindings.js';

const of = (source: string, specifier = './x') => parseBindings(source, 'f.tsx').bySpecifier.get(specifier);

describe('parseBindings: what a module takes from another', () => {
    it('reads named, aliased and default imports as the names of the source module', () => {
        expect(of("import { a, b as c } from './x';")?.uses).toEqual(new Set(['a', 'b']));
        expect(of("import D from './x';")?.uses).toEqual(new Set(['default']));
        expect(of("import D, { a } from './x';")?.uses).toEqual(new Set(['default', 'a']));
    });

    it('counts a type-only import as a use: a changed type changes what the importer compiles', () => {
        expect(of("import type { T } from './x';")?.uses).toEqual(new Set(['T']));
        expect(of("import { type T, a } from './x';")?.uses).toEqual(new Set(['T', 'a']));
    });

    it.each([
        ['a namespace import', "import * as ns from './x';"],
        ['a side-effect import', "import './x';"],
        ['a dynamic import', "const m = () => import('./x');"],
        ['a require call', "const m = require('./x');"],
        ['an import-equals', "import m = require('./x');"],
    ])('reads %s as every name, because the importer can reach any of them', (_name, source) => {
        expect(of(source)?.uses).toBe('all');
    });

    it('joins two imports of one specifier', () => {
        expect(of("import { a } from './x';\nimport { b } from './x';")?.uses).toEqual(new Set(['a', 'b']));
        expect(of("import { a } from './x';\nimport * as ns from './x';")?.uses).toBe('all');
    });

    it('does not see an import whose specifier is not a literal, which no resolver can see either', () => {
        expect(parseBindings('const m = import(name);', 'f.ts').bySpecifier.size).toBe(0);
    });
});

describe('parseBindings: what a module passes on without binding', () => {
    it('reads `export { a as b } from` as a re-export of a under the name b, with no use', () => {
        const binding = of("export { a, c as d } from './x';");

        expect(binding?.reexports).toEqual(
            new Map([
                ['a', ['a']],
                ['c', ['d']],
            ]),
        );
        expect(binding?.uses).toBeUndefined();
    });

    it('reads default re-exports in both directions', () => {
        expect(of("export { default } from './x';")?.reexports).toEqual(new Map([['default', ['default']]]));
        expect(of("export { default as Thing } from './x';")?.reexports).toEqual(new Map([['default', ['Thing']]]));
        expect(of("export { a as default } from './x';")?.reexports).toEqual(new Map([['a', ['default']]]));
    });

    it('keeps both exported names when one name is exported twice', () => {
        expect(of("export { a as b, a as c } from './x';")?.reexports).toEqual(new Map([['a', ['b', 'c']]]));
    });

    it('reads `export *` and `export * as ns` as every name', () => {
        expect(of("export * from './x';")?.reexports).toBe('all');
        expect(of("export * as ns from './x';")?.reexports).toBe('all');
    });

    it('reads an import followed by `export { X }` as a use, because that makes a local binding', () => {
        const binding = of("import { a } from './x';\nexport { a };");

        expect(binding?.uses).toEqual(new Set(['a']));
        expect(binding?.reexports).toBeUndefined();
    });

    it('reads a type-only re-export as a re-export', () => {
        expect(of("export type { T } from './x';")?.reexports).toEqual(new Map([['T', ['T']]]));
    });
});

describe('parseBindings: top-level effects', () => {
    it('is true for a top-level expression statement, which runs when the module loads', () => {
        expect(parseBindings("register('a');", 'f.ts').topLevelEffects).toBe(true);
    });

    it.each([
        ['a directive', "'use client';\nexport const a = 1;"],
        [
            'declarations and exports',
            "import { a } from './x';\nexport function f() { return a; }\nexport const k = 1;",
        ],
        ['a pure barrel', "export { a } from './x';\nexport * from './y';"],
    ])('is false for %s', (_name, source) => {
        expect(parseBindings(source, 'f.ts').topLevelEffects).toBe(false);
    });

    it('is not fooled by a call inside a function body', () => {
        expect(parseBindings('export function f() { register(); }', 'f.ts').topLevelEffects).toBe(false);
    });
});

describe('parseBindings: syntax', () => {
    it('parses TSX', () => {
        expect(of("import { A } from './x';\nexport const B = () => <A />;")?.uses).toEqual(new Set(['A']));
    });

    it('parses plain JavaScript files by their extension', () => {
        expect(parseBindings("import { a } from './x';", 'f.js').bySpecifier.get('./x')?.uses).toEqual(new Set(['a']));
    });
});
