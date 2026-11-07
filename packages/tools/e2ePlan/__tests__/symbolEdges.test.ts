import { describe, expect, it } from 'vitest';

import { parseBindings, type ModuleBindings } from '../src/moduleBindings.js';
import { reach, type Terminals } from '../src/reachability.js';
import { initialChange, symbolStep } from '../src/symbolEdges.js';

/**
 * A tiny world: `files` is path to source, and `./name` resolves to `name.ts`. The changed file is `x.ts`, which
 * exports `a` and `b`. Screens are `sa.ts` and `sb.ts`; the barrel `bar.ts` is what they import through.
 */
interface World {
    readonly files: Readonly<Record<string, string>>;
    /** Replaces the parse of a file: undefined means it cannot be parsed. */
    readonly parse?: Readonly<Record<string, ModuleBindings | undefined>>;
    /** Replaces the cruise specifiers of a file. */
    readonly specifiers?: Readonly<Record<string, ReadonlyMap<string, string>>>;
}

const resolveSpecifier = (spec: string): string => `${spec.replace('./', '')}.ts`;

function specifiersFromSource(source: string, file: string): ReadonlyMap<string, string> {
    return new Map([...parseBindings(source, file).bySpecifier.keys()].map((spec) => [spec, resolveSpecifier(spec)]));
}

function screensReached(world: World, changed = 'x.ts'): readonly string[] {
    const specifiersOf = (file: string): ReadonlyMap<string, string> =>
        world.specifiers?.[file] ?? specifiersFromSource(world.files[file] ?? '', file);
    const importersOf = (file: string): readonly string[] =>
        Object.keys(world.files)
            .filter((importer) => [...specifiersOf(importer).values()].includes(file))
            .sort();
    const bindingsOf = (file: string): ModuleBindings | undefined =>
        file in (world.parse ?? {}) ? world.parse?.[file] : parseBindings(world.files[file] ?? '', file);
    const terminals: Terminals = {
        screenEntries: new Map([
            ['sa.ts', ['SA']],
            ['sb.ts', ['SB']],
            ['sc.ts', ['SC']],
        ]),
        roots: new Set(),
        tests: new Map(),
    };
    const start = initialChange(bindingsOf(changed));

    return [...reach(changed, symbolStep({ importersOf, specifiersOf, bindingsOf }), terminals, start).screens].sort();
}

const X = 'export const a = 1;\nexport const b = 2;\n';
const SA = "import { a } from './bar';\nexport const SA = a;\n";
const SB = "import { z } from './bar';\nexport const SB = z;\n";
const OTHER = 'export const z = 1;\n';
const base = { 'x.ts': X, 'sa.ts': SA, 'sb.ts': SB, 'other.ts': OTHER };

describe('symbolStep: narrowing at a re-export', () => {
    it('reaches only the screen that takes the changed name through a barrel', () => {
        expect(
            screensReached({
                files: { ...base, 'bar.ts': "export { a } from './x';\nexport { z } from './other';\n" },
            }),
        ).toEqual(['SA']);
    });

    it('follows an aliased re-export under its new name', () => {
        expect(
            screensReached({
                files: {
                    ...base,
                    'sa.ts': "import { renamed } from './bar';\nexport const SA = renamed;\n",
                    'bar.ts': "export { a as renamed } from './x';\nexport { z } from './other';\n",
                },
            }),
        ).toEqual(['SA']);
    });

    it('follows a default re-export under the default name', () => {
        expect(
            screensReached({
                files: {
                    ...base,
                    'sa.ts': "import Thing from './bar';\nexport const SA = Thing;\n",
                    'bar.ts': "export { a as default } from './x';\nexport { z } from './other';\n",
                },
            }),
        ).toEqual(['SA']);
    });

    it('follows a two-level barrel chain', () => {
        expect(
            screensReached({
                files: {
                    ...base,
                    'bar.ts': "export { a } from './mid';\nexport { z } from './other';\n",
                    'mid.ts': "export { a, b } from './x';\n",
                },
            }),
        ).toEqual(['SA']);
    });

    it('joins what reaches a barrel from two files, so a name that arrives second is not lost', () => {
        expect(
            screensReached({
                files: {
                    ...base,
                    'sb.ts': "import { b } from './bar';\nexport const SB = b;\n",
                    'bar.ts': "export { a } from './m1';\nexport { b } from './m2';\n",
                    'm1.ts': "export { a } from './x';\n",
                    'm2.ts': "export { b } from './x';\n",
                },
            }),
        ).toEqual(['SA', 'SB']);
    });

    it('reaches a barrel through two specifiers of the same file', () => {
        expect(
            screensReached({
                files: {
                    ...base,
                    'sb.ts': "import { b } from './bar';\nexport const SB = b;\n",
                    'bar.ts': "export { a } from './x';\nexport { b } from './x.ts';\n",
                },
                specifiers: {
                    'bar.ts': new Map([
                        ['./x', 'x.ts'],
                        ['./x.ts', 'x.ts'],
                    ]),
                },
            }),
        ).toEqual(['SA', 'SB']);
    });
});

/** A barrel with an unrelated re-export, which a narrowed walk must NOT hand to `SB`; each fallback hands it over. */
const unrelated = "export { z } from './other';\n";

describe('symbolStep: every fallback widens to the whole file', () => {
    it.each([
        ['a namespace import', `import * as ns from './x';\nexport const used = ns;\n${unrelated}`],
        ['a side-effect import', `import './x';\n${unrelated}`],
        ['a dynamic import', `export const load = () => import('./x');\n${unrelated}`],
        ['a require call', `const x = require('./x');\nexport const y = x;\n${unrelated}`],
        ['an export star', `export * from './x';\n${unrelated}`],
        ['an import then export of the same name', `import { a } from './x';\nexport { a };\n${unrelated}`],
        [
            'a type-only import of a changed name',
            `import type { a } from './x';\nexport type T = typeof a;\n${unrelated}`,
        ],
    ])('%s reaches the screen of an unrelated export', (_name, bar) => {
        expect(screensReached({ files: { ...base, 'bar.ts': bar } })).toContain('SB');
    });

    it('a top-level effect in the changed file reaches every importer, not only the names re-exported', () => {
        expect(
            screensReached({
                files: {
                    ...base,
                    'x.ts': `${X}register('x');\n`,
                    'bar.ts': `export { a } from './x';\n${unrelated}`,
                },
            }),
        ).toContain('SB');
    });

    it('an intermediate file that consumes a changed name at top level reaches every importer of it', () => {
        expect(
            screensReached({
                files: {
                    ...base,
                    'sb.ts': "import { z } from './bar';\nexport const SB = z;\n",
                    'bar.ts': "export { q } from './mid';\nexport { z } from './other';\n",
                    'mid.ts': "import { a } from './x';\nregister(a);\nexport const q = 1;\n",
                },
            }),
        ).toContain('SB');
    });

    it('an importer that cannot be parsed reaches every importer of it', () => {
        expect(
            screensReached({
                files: { ...base, 'bar.ts': `export { a } from './x';\n${unrelated}` },
                parse: { 'bar.ts': undefined },
            }),
        ).toContain('SB');
    });

    it('an importer whose parse lacks the cruise specifier reaches every importer of it', () => {
        expect(
            screensReached({
                files: { ...base, 'bar.ts': `export { a } from './elsewhere';\n${unrelated}` },
                specifiers: { 'bar.ts': new Map([['./x', 'x.ts']]) },
            }),
        ).toContain('SB');
    });
});

describe('symbolStep: a use of a narrowed edge', () => {
    it('a namespace import of a barrel that carries only some names still takes the whole barrel', () => {
        expect(
            screensReached({
                files: {
                    ...base,
                    'sb.ts': "import { z } from './bar';\nexport const SB = z;\n",
                    'bar.ts': "import * as all from './mid';\nexport const m = all;\nexport { z } from './other';\n",
                    'mid.ts': "export { a as renamed } from './x';\n",
                },
            }),
        ).toContain('SB');
    });
});

describe('symbolStep: a plain use stays file-level', () => {
    it('reaches the screen that imports the changed file for a name, whatever the name', () => {
        expect(
            screensReached({
                files: { ...base, 'sa.ts': "import { b } from './x';\nexport const SA = b;\n" },
            }),
        ).toEqual(['SA']);
    });

    it('does not reach a screen that takes a different name from the same barrel', () => {
        expect(
            screensReached({
                files: {
                    ...base,
                    'sb.ts': "import { b } from './bar';\nexport const SB = b;\n",
                    'bar.ts': "export { a } from './x';\nexport { z } from './other';\n",
                },
            }),
        ).toEqual(['SA']);
    });
});
