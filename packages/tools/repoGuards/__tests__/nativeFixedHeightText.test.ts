/**
 * No native frame that holds text has a fixed `height` — fixture rows for the detector in `nativeFixedHeightText.ts`.
 *
 * ⛔ WHY. Text grows with the font scale and with a longer translation; a fixed `height` does not, so the text is clipped.
 * The Recipes search pill had `height: 48` around its input and cut the text at a large font scale; a device found it. A
 * `minHeight` is fine. The real tree is NOT asserted here yet: its findings go to the lead first (job `preDevice`). The
 * rows `reads real frames` pin that the reader finds fixed-height frames in the tree, so a later tree assertion cannot
 * pass vacuously.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { fixedHeightFrameSites, fixedHeightTextFrames } from './nativeFixedHeightText.js';
import { repoRoot } from './serviceSources.js';
import { designSystemStyledKinds, type StyledKindsOf, type TamaguiKind } from './tamaguiElements.js';

/** No design-system package: the fixtures name every element they use. */
const noKinds: StyledKindsOf = () => new Map<string, TamaguiKind>();

const RN = `import { StyleSheet, View, Text, TextInput } from 'react-native';`;
const TG = `import { styled, View, XStack, YStack, Text } from 'tamagui';`;

/** [what the shape is, the module text, the number of findings it must produce]. */
const SHAPES: readonly (readonly [string, string, number])[] = [
    [
        'a fixed-height View around a Text (the defect)',
        `${RN} const A = () => <View style={{ height: 48 }}><Text>Hi</Text></View>;`,
        1,
    ],
    [
        'a fixed-height View around a TextInput (the search pill)',
        `${RN} const A = () => <View style={{ height: 48 }}><TextInput /></View>;`,
        1,
    ],
    [
        'a minHeight View around a Text',
        `${RN} const A = () => <View style={{ minHeight: 48 }}><Text>Hi</Text></View>;`,
        0,
    ],
    ['a maxHeight only', `${RN} const A = () => <View style={{ maxHeight: 48 }}><Text>Hi</Text></View>;`, 0],
    [
        'a lineHeight is not a frame height',
        `${RN} const A = () => <View style={{ lineHeight: 20 }}><Text>Hi</Text></View>;`,
        0,
    ],
    ['a fixed-height View with no text (a divider)', `${RN} const A = () => <View style={{ height: 1 }} />;`, 0],
    [
        'a percentage height fills the parent',
        `${RN} const A = () => <View style={{ height: '100%' }}><Text>Hi</Text></View>;`,
        0,
    ],
    ['height auto', `${RN} const A = () => <View style={{ height: 'auto' }}><Text>Hi</Text></View>;`, 0],
    [
        'the height in a StyleSheet entry of the same file',
        `${RN} const styles = StyleSheet.create({ pill: { height: 48 } }); const A = () => <View style={styles.pill}><Text>Hi</Text></View>;`,
        1,
    ],
    [
        'a StyleSheet entry with a minHeight',
        `${RN} const styles = StyleSheet.create({ pill: { minHeight: 48 } }); const A = () => <View style={styles.pill}><Text>Hi</Text></View>;`,
        0,
    ],
    [
        'the height in an array style, behind a condition',
        `${RN} const styles = StyleSheet.create({ pill: { height: 48 }, row: { flexDirection: 'row' } }); const A = ({ on }) => <View style={[styles.row, on && styles.pill]}><Text>Hi</Text></View>;`,
        1,
    ],
    [
        'a height in an object constant',
        `${RN} const PILL = { height: 40 }; const A = () => <View style={PILL}><Text>Hi</Text></View>;`,
        1,
    ],
    ['written text as the only child', `${RN} const A = () => <View style={{ height: 48 }}>Hello</View>;`, 1],
    [
        'an expression child that is a string',
        `${RN} const A = ({ label }) => <View style={{ height: 48 }}>{label}</View>;`,
        1,
    ],
    [
        'the text two levels down',
        `${RN} const A = () => <View style={{ height: 48 }}><View><Text>Hi</Text></View></View>;`,
        1,
    ],
    [
        'only an icon inside a fixed-height frame',
        `${RN} const A = () => <View style={{ height: 48 }}><SearchIcon /></View>;`,
        0,
    ],
    [
        'children it cannot see into are a finding, not a pass',
        `${RN} const A = ({ children }) => <View style={{ height: 48 }}>{children}</View>;`,
        1,
    ],
    [
        'an unknown component inside a fixed-height frame is a finding, not a pass',
        `${RN} const A = () => <View style={{ height: 48 }}><Pill /></View>;`,
        1,
    ],
    [
        'a style built by a call, around text, cannot be read',
        `${RN} const A = () => <View style={makeStyle()}><Text>Hi</Text></View>;`,
        1,
    ],
    ['a style built by a call, around nothing', `${RN} const A = () => <View style={makeStyle()} />;`, 0],
    ['Tamagui height prop around a Text', `${TG} const A = () => <YStack height={48}><Text>Hi</Text></YStack>;`, 1],
    ['Tamagui h prop around a Text', `${TG} const A = () => <XStack h={48}><Text>Hi</Text></XStack>;`, 1],
    ['Tamagui minHeight around a Text', `${TG} const A = () => <YStack minHeight={48}><Text>Hi</Text></YStack>;`, 0],
    [
        'Tamagui height from a token, around a Text',
        `${TG} const A = () => <YStack height="$12"><Text>Hi</Text></YStack>;`,
        1,
    ],
    [
        'a styled frame with a base height, used around a Text',
        `${TG} const Pill = styled(XStack, { height: 48 }); const A = () => <Pill><Text>Hi</Text></Pill>;`,
        1,
    ],
    [
        'a styled frame with a minHeight',
        `${TG} const Pill = styled(XStack, { minHeight: 48 }); const A = () => <Pill><Text>Hi</Text></Pill>;`,
        0,
    ],
    [
        'a styled frame whose variant sets a height',
        `${TG} const Pill = styled(XStack, { variants: { big: { true: { height: 64 } } } }); const A = () => <Pill big><Text>Hi</Text></Pill>;`,
        1,
    ],
    [
        'a Text itself with a fixed height is not a frame',
        `${RN} const A = () => <Text style={{ height: 20 }}>Hi</Text>;`,
        0,
    ],
    [
        'two frames, one fixed',
        `${RN} const A = () => (<><View style={{ height: 48 }}><Text>A</Text></View><View><Text>B</Text></View></>);`,
        1,
    ],
];

describe('fixedHeightTextFrames — fixture rows', () => {
    it.each(SHAPES)('%s', (_name, source, expected) => {
        expect(fixedHeightTextFrames(source, 'Fixture.native.tsx', noKinds)).toHaveLength(expected);
    });

    it('names the line', () => {
        expect(
            fixedHeightTextFrames(
                `${RN}\nconst A = () => (\n<View style={{ height: 48 }}><Text>Hi</Text></View>\n);`,
                'Fixture.native.tsx',
                noKinds,
            ),
        ).toEqual(['3: a fixed height around text']);
    });
});

describe('fixedHeightFrameSites — the reader finds the real frames', () => {
    const REAL_FRAMES = [
        'packages/apps/commise/ui/src/avatar/AvatarDisc.native.tsx',
        'packages/apps/commise/features/recipes/src/detail/StepRow.native.tsx',
        'packages/apps/commise/ui/src/largeTitleHeader/LargeTitleHeader.native.tsx',
    ] as const;

    it.each(REAL_FRAMES)('reads a fixed-height frame in %s', (file) => {
        expect(
            fixedHeightFrameSites(readFileSync(path.join(repoRoot, file), 'utf8'), file, designSystemStyledKinds),
        ).toBeGreaterThan(0);
    });
});
