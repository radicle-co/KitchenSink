/**
 * The one reader of value imports and re-exports under the native and Tamagui guards. A shape it misses is a shape
 * every guard built on it misses, so each shape is a row here.
 */
import { describe, expect, it } from 'vitest';

import { parseModule } from './appSources.js';
import { reExportsOf, specifiersOf, valueBindingsOf } from './moduleBindings.js';

const isTamagui = (specifier: string): boolean => specifier === 'tamagui';

function bindingsOf(source: string) {
    return valueBindingsOf(parseModule('fixture.tsx', source), isTamagui);
}

describe('valueBindingsOf', () => {
    it('reads named imports, renamed or not, with their specifiers', () => {
        const bindings = bindingsOf(`import { View, Text as T } from 'tamagui';`);

        expect([...(bindings.locals.get('Text') ?? [])]).toEqual(['T']);
        expect(specifiersOf(bindings, 'View')).toHaveLength(1);
    });

    it('reads a namespace import and a default import', () => {
        const bindings = bindingsOf(`import * as NS from 'tamagui';\nimport D from 'tamagui';`);

        expect([...bindings.namespaces]).toEqual(['NS']);
        expect([...bindings.defaults.keys()]).toEqual(['D']);
    });

    it('binds nothing for a type-only import or a type-only name', () => {
        const bindings = bindingsOf(`import type { A } from 'tamagui';\nimport { type B, View } from 'tamagui';`);

        expect([...bindings.locals.keys()]).toEqual(['View']);
    });

    it('reads nothing from another module', () => {
        expect(bindingsOf(`import { View } from 'react-native';`).imported).toBe(false);
    });
});

describe('reExportsOf', () => {
    it('reads named re-exports, renamed or not, and export-everything', () => {
        const reExports = reExportsOf(
            parseModule('fixture.ts', `export { View, Text as T } from 'tamagui';\nexport * from 'tamagui';`),
            isTamagui,
        );

        expect(reExports.named.map((element) => (element.propertyName ?? element.name).text)).toEqual(['View', 'Text']);
        expect(reExports.everything).toHaveLength(1);
    });

    it('reads nothing type-only', () => {
        const reExports = reExportsOf(
            parseModule('fixture.ts', `export type { A } from 'tamagui';\nexport { type B } from 'tamagui';`),
            isTamagui,
        );

        expect(reExports.named).toEqual([]);
        expect(reExports.everything).toEqual([]);
    });
});
