/**
 * Which JSX tags in a module render a Tamagui element: the shared reading under the Tamagui guards (ADR-0080). A tag
 * missed here is a Tamagui element no guard sees.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { parseModule } from './appSources.js';
import {
    styledExportsReader,
    styledKindsReader,
    tamaguiElementKinds,
    tamaguiElementNames,
    type TamaguiKind,
} from './tamaguiElements.js';

const designSystemStyled = (subpath: string): ReadonlySet<string> =>
    subpath === '@commise/ui/text' ? new Set(['Text']) : new Set();

function namesIn(source: string): readonly string[] {
    return [...tamaguiElementNames(parseModule('fixture.tsx', source), designSystemStyled)].sort();
}

describe('tamaguiElementNames', () => {
    it.each([
        ['a named Tamagui import', `import { View, XStack } from 'tamagui';`, ['View', 'XStack']],
        ['a renamed one', `import { View as TView } from 'tamagui';`, ['TView']],
        ['an @tamagui package', `import { Stack } from '@tamagui/core';`, ['Stack']],
        ['a namespace, read as its members', `import * as T from 'tamagui';\nconst v = <T.View />;`, ['T.View']],
        [
            'a local styled() binding',
            `import { styled, View } from 'tamagui';\nconst Pill = styled(View, {});`,
            ['Pill', 'View'],
        ],
        ['a design-system styled export', `import { Text } from '@commise/ui/text';`, ['Text']],
        ['a React Native element is not Tamagui', `import { View } from 'react-native';`, []],
        ['a type-only import renders nothing', `import type { View } from 'tamagui';`, []],
        [
            'a styled() from somewhere else is not Tamagui',
            `import { styled } from 'other';\nconst Pill = styled(View, {});`,
            [],
        ],
    ] as const)('%s', (_shape, source, expected) => {
        expect(namesIn(source)).toEqual(expected);
    });
});

const designSystemKinds = (subpath: string): ReadonlyMap<string, TamaguiKind> =>
    subpath === '@commise/ui/text' ? new Map<string, TamaguiKind>([['Text', 'text']]) : new Map<string, TamaguiKind>();

function kindsIn(source: string): Readonly<Record<string, TamaguiKind>> {
    return Object.fromEntries([...tamaguiElementKinds(parseModule('fixture.tsx', source), designSystemKinds)].sort());
}

describe('tamaguiElementKinds', () => {
    it.each([
        [
            'each View-like export',
            `import { View, Stack, XStack, YStack, ZStack, ScrollView } from 'tamagui';`,
            { ScrollView: 'view', Stack: 'view', View: 'view', XStack: 'view', YStack: 'view', ZStack: 'view' },
        ],
        ['Text', `import { Text } from 'tamagui';`, { Text: 'text' }],
        ['a Tamagui element no guard classifies', `import { Button } from 'tamagui';`, { Button: 'other' }],
        ['a renamed View', `import { View as Box } from 'tamagui';`, { Box: 'view' }],
        [
            'a namespace member',
            `import * as T from 'tamagui';\nconst a = <T.View />; const b = <T.Text />;`,
            { 'T.Text': 'text', 'T.View': 'view' },
        ],
        [
            'a styled() by its base',
            `import { styled, View, Text } from 'tamagui';\nconst A = styled(View, {}); const B = styled(Text, {});`,
            { A: 'view', B: 'text', Text: 'text', View: 'view' },
        ],
        [
            'a styled() chain, declared out of order',
            `import { styled, XStack } from 'tamagui';\nconst C = styled(B, {}); const B = styled(A, {}); const A = styled(XStack, {});`,
            { A: 'view', B: 'view', C: 'view', XStack: 'view' },
        ],
        [
            'a styled() over something that is not Tamagui',
            `import { styled } from 'tamagui';\nconst A = styled(Other, {});`,
            { A: 'other' },
        ],
        ['a design-system export, by its own kind', `import { Text } from '@commise/ui/text';`, { Text: 'text' }],
        ['a type-only import', `import type { View } from 'tamagui';`, {}],
    ] as const)('%s', (_shape, source, expected) => {
        expect(kindsIn(source)).toEqual(expected);
    });
});

/**
 * The real resolver over a small design-system package written to a temporary directory: the `exports` map, a barrel
 * that re-exports a `.native` leaf, a direct leaf, a local export list, and a chain of two re-exports. Written at test
 * time, not committed, because a committed fixture that imports `tamagui` would be type-checked by this package.
 */
describe('styledExportsReader', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tamaguiUi-'));

    const write = (file: string, text: string): void => {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), text);
    };

    write(
        'package.json',
        JSON.stringify({
            exports: {
                './text': './src/text/index.ts',
                './pill': './src/pill/Pill.native.tsx',
                './chain': './src/chain/index.ts',
                './theme': './src/theme/index.ts',
                './css': './dist/theme.css',
            },
        }),
    );
    write('src/text/index.ts', `export { Text } from './Text.js';\nexport { other } from './other.js';\n`);
    write(
        'src/text/Text.native.tsx',
        `import { styled, Text as Base } from 'tamagui';\nexport const Text = styled(Base, {});\n`,
    );
    write('src/text/other.ts', `export const other = 1;\n`);
    write(
        'src/pill/Pill.native.tsx',
        `import { styled, View } from 'tamagui';\nconst Pill = styled(View, {});\nconst plain = 1;\nexport { Pill, plain };\n`,
    );
    write('src/chain/index.ts', `export * from './middle.js';\n`);
    write('src/chain/middle.ts', `export { Deep as Renamed } from './Deep.js';\n`);
    write(
        'src/chain/Deep.native.tsx',
        `import { styled, View } from 'tamagui';\nexport const Deep = styled(View, {});\n`,
    );
    write('src/theme/index.ts', `export const useTheme = () => null;\n`);

    const read = styledExportsReader(root);
    const readKinds = styledKindsReader(root);

    afterAll(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it.each([
        ['a barrel re-exporting a .native leaf', '@commise/ui/text', ['Text']],
        ['a local export list', '@commise/ui/pill', ['Pill']],
        ['a chain of re-exports, renamed on the way', '@commise/ui/chain', ['Renamed']],
        ['a subpath with no styled export', '@commise/ui/theme', []],
        ['a non-module export', '@commise/ui/css', []],
        ['an unknown subpath', '@commise/ui/missing', []],
    ] as const)('%s', (_shape, subpath, expected) => {
        expect([...read(subpath)].sort()).toEqual(expected);
    });

    it('reads each export by its base: a styled(Text) is a text, a styled(View) a view, through re-exports', () => {
        expect(Object.fromEntries(readKinds('@commise/ui/text'))).toEqual({ Text: 'text' });
        expect(Object.fromEntries(readKinds('@commise/ui/pill'))).toEqual({ Pill: 'view' });
        expect(Object.fromEntries(readKinds('@commise/ui/chain'))).toEqual({ Renamed: 'view' });
    });
});
