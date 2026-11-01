/**
 * G4 (ADR-0080): native text is set by TYPE ROLE, never by its parts. A type role names a face, a size and a leading
 * together, so a Tamagui element may not set `fontSize`, `lineHeight`, `fontFamily`, `fontWeight`, `letterSpacing` or
 * `fontVariant` itself, nor spread the old `nativeTokens.type` styles. A figure's digits come from Text's `figures`
 * variant, in the role's own face.
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
        // Designer ruling 2026-11-01: a figure's digits come from the design system's `figures` variant, in its role's face.
        ['figure digits set by hand on an element', `<Text fontVariant={['tabular-nums']} />`, 1],
        ['the design system figures variant', `<Text typeRole="meta" figures />`, 0],
        ['a number line height in styled()', `const T = styled(Text, { lineHeight: 24 });`, 1],
        ['a numeric-string line height in styled()', `const T = styled(Text, { lineHeight: '24' });`, 1],
        [
            'a number line height in a styled() variant',
            `const T = styled(Text, { variants: { r: { body: { lineHeight: 24 } } } });`,
            1,
        ],
        ['a type part on a namespace member', `import * as T from 'tamagui';\n<T.Text fontSize={16} />`, 1],
        ['a variant table built by a call', `const T = styled(Text, { variants: { role: rolesOf(c) } });`, 1],
        [
            'a variant table cast `as const`, as Tamagui writes it, is read through',
            'const T = styled(Text, { variants: { r: { body: { lineHeight: 24 } } } as const });',
            1,
        ],
        [
            'a px line height in a variant table cast `as const`',
            "const T = styled(Text, { variants: { r: { body: { lineHeight: '24px' } } } as const });",
            0,
        ],
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

    // H-1 (ADR-0080 §8): Tamagui 3's `styled.dynamic` and `.resolve`. A bare carrier only declares a prop, so it is
    // readable anywhere. A `.resolve` callback can return any style, so it is a finding, except the design-system Text's
    // one resolver, whose whole body is a call to the tested `scaledTypeMetrics`.
    describe('styled.dynamic carriers and .resolve resolvers', () => {
        const TEXT = 'packages/apps/commise/ui/src/text/Text.native.tsx';
        const OTHER = 'packages/apps/commise/ui/src/thing/Thing.native.tsx';
        const carrier = 'const F = styled(Text, { variants: { textScale: styled.dynamic<number>() } as const });\n';
        const resolved = `${carrier}export const T = F.resolve(({ typeRole, textScale }) => scaledTypeMetrics(typeRole, textScale));`;

        it.each([
            ['a bare carrier', carrier, OTHER, 0],
            [
                'a function carrier',
                'const F = styled(Text, { variants: { s: styled.dynamic((v) => ({ fontSize: v })) } });',
                OTHER,
                1,
            ],
            ['the scaled-type resolver in the design-system Text', resolved, TEXT, 0],
            ['the same resolver anywhere else', resolved, OTHER, 1],
            [
                'any other resolver in the design-system Text',
                `${carrier}export const T = F.resolve(() => ({ fontSize: 3 }));`,
                TEXT,
                1,
            ],
        ] as const)('%s', (_shape, body, file, expected) => {
            expect(typePropFindings(head + body, file, none)).toHaveLength(expected);
        });
    });

    it('finds none in the tree', () => {
        const findings = nativeSources().flatMap((file) =>
            typePropFindings(readFileSync(path.join(repoRoot, file), 'utf8'), file, designSystemStyledExports),
        );

        expect(findings).toEqual([]);
    });
});
