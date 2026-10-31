/**
 * Which JSX tags in a module render a Tamagui element: the shared reading under the Tamagui guards (ADR-0080). A tag
 * missed here is a Tamagui element no guard sees.
 */
import { describe, expect, it } from 'vitest';

import { parseModule } from './appSources.js';
import { tamaguiElementNames } from './tamaguiElements.js';

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
