/**
 * G4 (ADR-0080): native text is set by TYPE ROLE, never by its parts. A type role names a face, a size and a leading
 * together, so a Tamagui element may not set `fontSize`, `lineHeight`, `fontFamily`, `fontWeight` or `letterSpacing`
 * itself, nor spread the old `nativeTokens.type` styles.
 *
 * Inside `styled()` the parts are written once, by the primitive that defines the roles, and there a line height must
 * be a `px` string: Tamagui 3 reads a bare number, and a numeric string, as a RATIO of the font size
 * (`ui/src/tamagui/__tests__/tamaguiRuntimeProbe.native.test.tsx`), so `lineHeight: 24` on 16 px text is 384 px.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { nativeSources } from './nativeSources.js';
import { repoRoot } from './serviceSources.js';
import { designSystemStyledExports } from './tamaguiElements.js';
import { typePropFindings } from './tamaguiTypeProps.js';

const none = (): ReadonlySet<string> => new Set();

const head = `import { styled, Text } from 'tamagui';\nimport { nativeTokens } from '@commise/ui/native';\n`;

describe('typePropFindings', () => {
    it.each([
        ['a number line height on an element', `<Text lineHeight={24} />`, 1],
        ['a string line height on an element', `<Text lineHeight="24px" />`, 1],
        [
            'each type part on an element',
            `<Text fontSize={16} fontFamily="$body" fontWeight="600" letterSpacing={0} />`,
            4,
        ],
        ['a spread of the old type styles', `<Text {...nativeTokens.type.body} />`, 1],
        ['a number line height in styled()', `const T = styled(Text, { lineHeight: 24 });`, 1],
        ['a numeric-string line height in styled()', `const T = styled(Text, { lineHeight: '24' });`, 1],
        [
            'a number line height in a styled() variant',
            `const T = styled(Text, { variants: { r: { body: { lineHeight: 24 } } } });`,
            1,
        ],
        ['a type part on a namespace member', `import * as T from 'tamagui';\n<T.Text fontSize={16} />`, 1],
        ['a variant table built by a call', `const T = styled(Text, { variants: { role: rolesOf(c) } });`, 1],
        ['a px line height in styled()', `const T = styled(Text, { fontSize: 16, lineHeight: '24px' });`, 0],
        ['a px template line height in styled()', 'const T = styled(Text, { lineHeight: `${n}px` });', 0],
        ['a type role', `<Text typeRole="body" />`, 0],
        [
            'a React Native Text is not this rule',
            `import { Text as RNText } from 'react-native';\n<RNText lineHeight={24} />`,
            0,
        ],
    ] as const)('%s', (_shape, body, expected) => {
        expect(typePropFindings(head + body, 'fixture.tsx', none)).toHaveLength(expected);
    });

    it('finds none in the tree', () => {
        const findings = nativeSources().flatMap((file) =>
            typePropFindings(readFileSync(path.join(repoRoot, file), 'utf8'), file, designSystemStyledExports),
        );

        expect(findings).toEqual([]);
    });
});
