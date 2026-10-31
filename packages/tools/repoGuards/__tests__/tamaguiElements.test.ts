/**
 * Which JSX tags in a module render a Tamagui element: the shared reading under the Tamagui guards (ADR-0080). A tag
 * missed here is a Tamagui element no guard sees.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { parseModule } from './appSources.js';
import { styledExportsReader, tamaguiElementNames } from './tamaguiElements.js';

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
});
