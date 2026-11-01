/**
 * The native text-scale-cap detector, proven shape by shape (ADR-0080 §8: text grows with the system's text size up to
 * 2×). A React Native `Text`, `Animated.Text` or `TextInput` grows without limit unless it carries
 * `maxFontSizeMultiplier={FONT_SCALE_CAP}`; the design system's `Text` carries it already. A text inside a capped
 * ancestor inherits the cap (React Native passes text attributes down to nested text), so only the outermost text of a
 * run is counted.
 */
import { describe, expect, it } from 'vitest';

import { uncappedTexts } from './nativeTextScaleCap.js';
import type { StyledKindsOf, TamaguiKind } from './tamaguiElements.js';

const FILE = 'packages/apps/commise/features/recipes/src/thing/Thing.native.tsx';

/** One design-system subpath, `@commise/ui/text`, whose `Text` is a Tamagui text. */
const kinds: StyledKindsOf = (specifier) =>
    new Map<string, TamaguiKind>(specifier === '@commise/ui/text' ? [['Text', 'text']] : []);

const RN = `import { Animated, Text, TextInput } from 'react-native';\nimport * as RN from 'react-native';\n`;
const CAP = `import { FONT_SCALE_CAP } from '@commise/ui/font-scale-cap';\n`;
const DS = `import { Text as DsText } from '@commise/ui/text';\n`;

describe('uncappedTexts', () => {
    it.each([
        ['a bare Text', `${RN}const A = () => <Text>a</Text>;`, 1],
        ['a capped Text', `${RN}${CAP}const A = () => <Text maxFontSizeMultiplier={FONT_SCALE_CAP}>a</Text>;`, 0],
        ['a cap written as a number', `${RN}const A = () => <Text maxFontSizeMultiplier={2}>a</Text>;`, 1],
        ['scaling turned off', `${RN}const A = () => <Text allowFontScaling={false}>a</Text>;`, 1],
        ['a namespace Text', `${RN}const A = () => <RN.Text>a</RN.Text>;`, 1],
        ['an Animated.Text', `${RN}const A = () => <Animated.Text>a</Animated.Text>;`, 1],
        ['a bare TextInput', `${RN}const A = () => <TextInput />;`, 1],
        ['a capped TextInput', `${RN}${CAP}const A = () => <TextInput maxFontSizeMultiplier={FONT_SCALE_CAP} />;`, 0],
        ['a spread that may hold the cap is not trusted', `${RN}const A = (p) => <Text {...p}>a</Text>;`, 1],
        [
            'a nested Text in a capped Text inherits the cap',
            `${RN}${CAP}const A = () => <Text maxFontSizeMultiplier={FONT_SCALE_CAP}>a <Text>b</Text></Text>;`,
            0,
        ],
        [
            'a nested Text in an uncapped Text is one run, counted once',
            `${RN}const A = () => <Text>a <Text>b</Text></Text>;`,
            1,
        ],
        ['the design system Text', `${DS}const A = () => <DsText typeRole="body">a</DsText>;`, 0],
        [
            'a React Native Text inside the design system Text inherits its cap',
            `${RN}${DS}const A = () => <DsText typeRole="body">a <Text>b</Text></DsText>;`,
            0,
        ],
        [
            'a Text in a View is not inside a text',
            `${RN}import { View } from 'react-native';\nconst A = () => <View><Text>a</Text></View>;`,
            1,
        ],
        ['no React Native import, no finding', `const Text = (p) => p.children;\nconst A = () => <Text>a</Text>;`, 0],
    ] as const)('%s → %i', (_name, source, count) => {
        expect(uncappedTexts(source, FILE, kinds)).toHaveLength(count);
    });

    it('reports the line of each uncapped text', () => {
        expect(uncappedTexts(`${RN}const A = () => (\n    <Text>a</Text>\n);`, FILE, kinds)).toEqual([4]);
    });
});
