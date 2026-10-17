import { describe, expect, it } from 'vitest';

import { aliasMatcherOf, valueImportsOfAlias } from '../valueImportsOfAlias.js';

const matcher = aliasMatcherOf(['#commise/*', '@/i18n/messages']);

/** Each row: a source, and the specifiers it imports as VALUES (or as a side effect) through the alias. */
const SHAPES: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    ['import type (named)', `import type { A } from '#commise/x';`, []],
    ['import type (default)', `import type A from '#commise/x';`, []],
    ['import type (namespace)', `import type * as A from '#commise/x';`, []],
    ['export type … from', `export type { A } from '#commise/x';`, []],
    ['typeof import() in a type position', `type T = typeof import('#commise/x');`, []],
    ['import() type argument', `let a: import('#commise/x').A;`, []],
    ['an exact alias, type only', `import type { M } from '@/i18n/messages';`, []],
    ['a specifier that only looks like the alias', `import { a } from '#commisex/y'; import { b } from '@/other';`, []],
    ['a package that is not aliased', `import { b } from '@commise/ui/button';`, []],
    [
        'the alias named in a string or comment',
        `// import { a } from '#commise/x'\nconst s = "import { a } from '#commise/x'";`,
        [],
    ],
    ['named value import', `import { A } from '#commise/x';`, ['#commise/x']],
    ['default value import', `import A from '#commise/x';`, ['#commise/x']],
    ['namespace value import', `import * as A from '#commise/x';`, ['#commise/x']],
    [
        'inline `type` specifier (survives under verbatimModuleSyntax)',
        `import { type A } from '#commise/x';`,
        ['#commise/x'],
    ],
    ['bare side-effect import', `import '#commise/x';`, ['#commise/x']],
    ['re-export of values', `export { A } from '#commise/x';`, ['#commise/x']],
    ['re-export all', `export * from '#commise/x';`, ['#commise/x']],
    ['dynamic import', `const m = await import('#commise/x');`, ['#commise/x']],
    ['require call', `const m = require('#commise/x');`, ['#commise/x']],
    ['import-equals require', `import A = require('#commise/x');`, ['#commise/x']],
    ['an exact alias, as a value', `import { M } from '@/i18n/messages';`, ['@/i18n/messages']],
    [
        'two violations, in source order',
        `import { A } from '#commise/a';\nimport type { B } from '#commise/b';\nimport '#commise/c';`,
        ['#commise/a', '#commise/c'],
    ],
];

describe('valueImportsOfAlias', () => {
    it.each(SHAPES)('%s', (_name, source, expected) => {
        expect(valueImportsOfAlias(source, matcher)).toEqual(expected);
    });

    it('reads a .tsx source (JSX does not blind the scan)', () => {
        const source = `import { A } from '#commise/x';\nexport const B = () => <A />;`;

        expect(valueImportsOfAlias(source, matcher, 'file.tsx')).toEqual(['#commise/x']);
    });
});

describe('aliasMatcherOf', () => {
    it('matches a wildcard key by its prefix and an exact key by equality', () => {
        expect(matcher('#commise/ui/src/x')).toBe(true);
        expect(matcher('#commise/')).toBe(true);
        expect(matcher('@/i18n/messages')).toBe(true);
        expect(matcher('@/i18n/messagesX')).toBe(false);
        expect(matcher('#commise')).toBe(false);
    });

    it('matches nothing for no aliases (an empty list must not match everything)', () => {
        expect(aliasMatcherOf([])('#commise/x')).toBe(false);
    });
});
