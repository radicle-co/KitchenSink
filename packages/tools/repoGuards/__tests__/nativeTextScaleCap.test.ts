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
const TG = `import { Text as TText, styled } from 'tamagui';\n`;

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
        // H-1 (ADR-0080 §8): the design-system Text turns system scaling off and draws its own size, so a React Native
        // text inside it inherits `allowFontScaling: false` and stays at 1× while its line grows. It is a finding: it
        // moves onto the design-system Text. REWRITTEN from "inherits its cap".
        [
            'a React Native Text inside the design system Text stays at 1×',
            `${RN}${DS}const A = () => <DsText typeRole="body">a <Text>b</Text></DsText>;`,
            1,
        ],
        [
            'a design system Text inside the design system Text',
            `${DS}const A = () => <DsText>a <DsText>b</DsText></DsText>;`,
            0,
        ],
        [
            'a Text in a View is not inside a text',
            `${RN}import { View } from 'react-native';\nconst A = () => <View><Text>a</Text></View>;`,
            1,
        ],
        ['no React Native import, no finding', `const Text = (p) => p.children;\nconst A = () => <Text>a</Text>;`, 0],
        // REVIEW 2026-11-01 (staff-architect, High): only the design system's Text carries the cap. Tamagui's own Text,
        // which app code may import, is a text root like React Native's, and excuses nothing nested in it.
        ["Tamagui's own Text", `${TG}const A = () => <TText>a</TText>;`, 1],
        [
            "Tamagui's own Text with the cap",
            `${TG}${CAP}const A = () => <TText maxFontSizeMultiplier={FONT_SCALE_CAP}>a</TText>;`,
            0,
        ],
        [
            "a React Native Text inside Tamagui's own Text is one uncapped run",
            `${RN}${TG}const A = () => <TText>a <Text>b</Text></TText>;`,
            1,
        ],
        [
            'a styled() over the design system Text keeps its cap',
            `${DS}${TG}const L = styled(DsText, {});\nconst A = () => <L>a</L>;`,
            0,
        ],
        [
            'the design system Text imported by path, inside the design system',
            `import { Text as Own } from '../text/Text.native.js';\nconst A = () => <Own typeRole="body">a</Own>;`,
            0,
        ],
        // GATE 2026-11-01: the cap is the design system's constant by import, not any name that reads FONT_SCALE_CAP.
        [
            'a local constant named like the cap',
            `${RN}const FONT_SCALE_CAP = 9;\nconst A = () => <Text maxFontSizeMultiplier={FONT_SCALE_CAP}>a</Text>;`,
            1,
        ],
        [
            'the cap imported under another name',
            `${RN}import { FONT_SCALE_CAP as CAP2 } from '@commise/ui/font-scale-cap';\nconst A = () => <Text maxFontSizeMultiplier={CAP2}>a</Text>;`,
            0,
        ],
        [
            'the cap imported by path inside the design system',
            `${RN}import { FONT_SCALE_CAP } from '../text/fontScaleCap.js';\nconst A = () => <Text maxFontSizeMultiplier={FONT_SCALE_CAP}>a</Text>;`,
            0,
        ],
        // REVIEW 2026-11-01 (Low): a View inside a text starts a new root, and a nested text that sets its own scaling
        // overrides the cap it would inherit (React Native's TextAttributes::apply).
        [
            'a Text in a View inside a capped Text is a new root',
            `${RN}${CAP}import { View } from 'react-native';\nconst A = () => <Text maxFontSizeMultiplier={FONT_SCALE_CAP}><View><Text>b</Text></View></Text>;`,
            1,
        ],
        [
            'a nested Text that lifts the cap',
            `${RN}${CAP}const A = () => <Text maxFontSizeMultiplier={FONT_SCALE_CAP}>a <Text maxFontSizeMultiplier={0}>b</Text></Text>;`,
            1,
        ],
        [
            'a nested Text that turns scaling off',
            `${RN}${CAP}const A = () => <Text maxFontSizeMultiplier={FONT_SCALE_CAP}>a <Text allowFontScaling={false}>b</Text></Text>;`,
            1,
        ],
        // GATE 2026-11-01 (minors): a `styled()` keeps the design system's cap only when it is Tamagui's, and the design
        // system's Text loses its cap like any text when it sets its own scaling.
        [
            "a Text inside a styled() that is not Tamagui's does not inherit a cap",
            `${RN}${DS}const styled = (c, _s) => c;\nconst L = styled(DsText, {});\nconst A = () => <L><Text>b</Text></L>;`,
            1,
        ],
        [
            'a Text inside a Tamagui styled() over the design system Text stays at 1×',
            `${RN}${DS}${TG}const L = styled(DsText, {});\nconst A = () => <L><Text>b</Text></L>;`,
            1,
        ],
        [
            'the design system Text that lifts its cap',
            `${DS}const A = () => <DsText maxFontSizeMultiplier={0}>a</DsText>;`,
            1,
        ],
        [
            'the design system Text that turns scaling off',
            `${DS}const A = () => <DsText allowFontScaling={false}>a</DsText>;`,
            1,
        ],
        // H-1: the design-system Text draws its own size, so any scaling prop on it is wrong: it re-enables system scaling
        // on top of its own, or does nothing. REWRITTEN from "restates the cap" (0).
        [
            'the design system Text that restates the cap',
            `${DS}${CAP}const A = () => <DsText maxFontSizeMultiplier={FONT_SCALE_CAP}>a</DsText>;`,
            1,
        ],
        [
            'the design system Text that turns system scaling back on',
            `${DS}const A = () => <DsText allowFontScaling>a</DsText>;`,
            1,
        ],
        // GATE SCQ-2: a `textScale` prop overrides the system scale the provider passes down.
        [
            'the design system Text given its own text scale',
            `${DS}const A = () => <DsText textScale={1}>a</DsText>;`,
            1,
        ],
        [
            'a Text inside a design system Text that lifts its cap is one uncapped run',
            `${RN}${DS}const A = () => <DsText maxFontSizeMultiplier={0}>a <Text>b</Text></DsText>;`,
            1,
        ],
    ] as const)('%s → %i', (_name, source, count) => {
        expect(uncappedTexts(source, FILE, kinds)).toHaveLength(count);
    });

    it('reports the line of each uncapped text', () => {
        expect(uncappedTexts(`${RN}const A = () => (\n    <Text>a</Text>\n);`, FILE, kinds)).toEqual([4]);
    });
});
