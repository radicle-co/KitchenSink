/**
 * No React Native `View` in the apps moves its children between renders by switching a stacking-context style on and
 * off — asserted by DISCOVERY, never by a list.
 *
 * ⛔ WHY THIS GUARD EXISTS. React Native 0.86 keeps a View's children inside it only while the View forms a stacking
 * context (`ViewShadowNode.cpp`: opacity below 1, a transform, clipping, `pointerEvents` none or box-only, …); a
 * background or a border alone forms a view and still hoists its children to its parent. So a View that gains or loses
 * one of those properties between renders makes Fabric MOVE its children: remove them from one native parent and insert
 * them into another. On Android that move throws `addViewAt: … View already has a parent` when it lands on a screen
 * react-native-screens is removing, because the library marks that screen's views as transitioning before Fabric has
 * applied the commits queued ahead of the removal (`NativeProxy.notifyScreenRemoved`), and a transitioning view keeps
 * its parent. Upstream will not change that in stack v4 (software-mansion/react-native-screens#4677, closed).
 *
 * It crashed the app: the shared Button dims its pill with `opacity` while busy, the Discard confirm turns busy as the
 * editor leaves, and the pill's icon and label moved inside a closing screen (local repro 2026-10-22, 2 crashes in 5
 * discards; 0 in 18 with the pill kept).
 *
 * ✅ THE FIX FOR A FAILURE: keep the View's node, `collapsable={false}`, so its children never move. It changes no pixel
 * and no accessibility node (measured on Android and iOS, 2026-10-22).
 *
 * The rule and the properties it reads are in `nativeFlattenFlips.ts`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { flattenFlippingViews } from './nativeFlattenFlips.js';
import { appSourceFiles } from './reactNativeValueUses.js';
import { repoRoot } from './serviceSources.js';
import { designSystemStyledKinds, type StyledKindsOf, type TamaguiKind } from './tamaguiElements.js';

/** No design-system package: the fixtures name every Tamagui element they use. */
const noKinds: StyledKindsOf = () => new Map<string, TamaguiKind>();

/** The shared Button, whose busy pill crashed the app; the detector must read it. */
const BUTTON = 'packages/apps/commise/ui/src/button/Button.native.tsx';

const TG = `import { styled, View, XStack, YStack, Text } from 'tamagui';`;

const RN = `import { StyleSheet, View, Animated } from 'react-native';`;
const SHEET = `const styles = StyleSheet.create({ dim: { opacity: 0.4 }, wash: { backgroundColor: 'red' }, row: { flexDirection: 'row' }, gone: { opacity: 0 } });`;

/** Shapes the tree may hold, and whether each is an offender. */
const SHAPES: readonly (readonly [string, string, boolean])[] = [
    [
        'a dimmed state from the sheet',
        `${RN} ${SHEET} const A = ({ d }) => <View style={[styles.row, d ? styles.dim : null]} />;`,
        true,
    ],
    [
        'a dimmed state with &&',
        `${RN} ${SHEET} const A = ({ d }) => <View style={[styles.row, d && styles.dim]} />;`,
        true,
    ],
    ['an inline dimmed state', `${RN} const A = ({ d }) => <View style={d ? { opacity: 0.5 } : undefined} />;`, true],
    [
        'a transform only while pressed',
        `${RN} const A = ({ p }) => <View style={p ? { transform: [{ scale: 0.9 }] } : {}} />;`,
        true,
    ],
    [
        'clipping only when open',
        `${RN} const A = ({ o }) => <View style={{ overflow: o ? 'hidden' : 'visible' }} />;`,
        true,
    ],
    ['an opacity from a variable', `${RN} const A = ({ v }) => <View style={{ opacity: v }} />;`, true],
    ['pointerEvents that switch', `${RN} const A = ({ o }) => <View pointerEvents={o ? 'auto' : 'none'} />;`, true],
    ['an Animated View', `${RN} ${SHEET} const A = ({ d }) => <Animated.View style={d ? styles.dim : null} />;`, true],
    ['kept', `${RN} ${SHEET} const A = ({ d }) => <View collapsable={false} style={d ? styles.dim : null} />;`, false],
    [
        'still flattenable',
        `${RN} ${SHEET} const A = ({ d }) => <View collapsable style={d ? styles.dim : null} />;`,
        true,
    ],
    ['one element', `${RN} ${SHEET} const A = ({ d }) => <View accessible style={d ? styles.dim : null} />;`, false],
    [
        'hidden from readers',
        `${RN} ${SHEET} const A = ({ d }) => <View aria-hidden style={d ? styles.dim : null} />;`,
        false,
    ],
    ['always dimmed', `${RN} ${SHEET} const A = () => <View style={[styles.row, styles.dim]} />;`, false],
    ['dim in both states', `${RN} ${SHEET} const A = ({ d }) => <View style={d ? styles.dim : styles.gone} />;`, false],
    [
        'a stacking context kept by another entry',
        `${RN} ${SHEET} const A = ({ d }) => <View style={[{ opacity: 0.9 }, d ? styles.dim : null]} />;`,
        false,
    ],
    [
        'a background that switches',
        `${RN} ${SHEET} const A = ({ d }) => <View style={d ? styles.wash : null} />;`,
        false,
    ],
    ['a layout that switches', `${RN} ${SHEET} const A = ({ d }) => <View style={d ? styles.row : null} />;`, false],
    [
        'opacity 1 is no stacking context',
        `${RN} const A = ({ d }) => <View style={d ? { opacity: 1 } : null} />;`,
        false,
    ],
    [
        'fixed pointerEvents',
        `${RN} ${SHEET} const A = ({ d }) => <View pointerEvents="none" style={d ? styles.dim : null} />;`,
        false,
    ],
    [
        'another View',
        `import { View } from './box'; ${SHEET} const A = ({ d }) => <View style={d ? styles.dim : null} />;`,
        false,
    ],
    // Tamagui elements (ADR-0080): a prop, a variant or a state modifier that switches a stacking context.
    ['a Tamagui prop that switches', `${TG} const A = ({ b }) => <YStack opacity={b ? 0.4 : 1} />;`, true],
    ['a Tamagui prop from a variable', `${TG} const A = ({ v }) => <YStack opacity={v} />;`, true],
    ['a Tamagui prop behind &&', `${TG} const A = ({ b }) => <XStack opacity={b && 0.4} />;`, true],
    ['a Tamagui prop that is fixed', `${TG} const A = () => <YStack opacity={0.4} />;`, false],
    ['a Tamagui opacity of 1', `${TG} const A = ({ b }) => <YStack opacity={b ? 1 : 1} />;`, false],
    ['a kept Tamagui view', `${TG} const A = ({ b }) => <YStack collapsable={false} opacity={b ? 0.4 : 1} />;`, false],
    [
        'a Tamagui prop kept by another that is always on',
        `${TG} const A = ({ b }) => <YStack overflow="hidden" opacity={b ? 0.4 : 1} />;`,
        false,
    ],
    ['a Tamagui disabled: modifier', `${TG} const A = () => <YStack opacity="0.4 disabled:0.4" />;`, true],
    ['a Tamagui press: modifier', `${TG} const A = () => <View transform="press:scale(0.9)" />;`, true],
    ['a Tamagui pressed: alias', `${TG} const A = () => <View opacity="pressed:0.5" />;`, true],
    ['a Tamagui object form', `${TG} const A = () => <YStack opacity={{ base: 1, disabled: 0.4 }} />;`, true],
    ['a Tamagui modifier on a layout prop', `${TG} const A = () => <YStack padding="$2 hover:$3" />;`, false],
    ['a Tamagui Text is not a View', `${TG} const A = ({ b }) => <Text opacity={b ? 0.4 : 1} />;`, false],
    [
        'a namespace Tamagui view',
        `import * as T from 'tamagui'; const A = ({ b }) => <T.YStack opacity={b ? 0.4 : 1} />;`,
        true,
    ],
    [
        'a local styled() view used with a switching prop',
        `${TG} const Row = styled(XStack, {}); const A = ({ b }) => <Row opacity={b ? 0.4 : 1} />;`,
        true,
    ],
    [
        'a variant that dims',
        `${TG} const B = styled(View, { variants: { busy: { true: { opacity: 0.4 } } } }); const A = ({ x }) => <B busy={x} />;`,
        true,
    ],
    [
        'a variant that dims, defined and never used',
        `${TG} const B = styled(View, { variants: { busy: { true: { opacity: 0.4 } } } });`,
        true,
    ],
    [
        'a variant that dims, cured in the base',
        `${TG} const B = styled(View, { collapsable: false, variants: { busy: { true: { opacity: 0.4 } } } });`,
        false,
    ],
    [
        'a variant that dims, over a base that dims the same',
        `${TG} const B = styled(View, { opacity: 0.4, variants: { busy: { true: { opacity: 0.4 } } } });`,
        false,
    ],
    [
        'a variant that is a layout',
        `${TG} const B = styled(View, { variants: { dense: { true: { padding: '$1' } } } });`,
        false,
    ],
    [
        'a variant of a styled Text',
        `${TG} const B = styled(Text, { variants: { busy: { true: { opacity: 0.4 } } } });`,
        false,
    ],
    [
        'a variant over a chain of styled views',
        `${TG} const Row = styled(XStack, {}); const B = styled(Row, { variants: { busy: { true: { opacity: 0.4 } } } });`,
        true,
    ],
    ['a state modifier in a styled base', `${TG} const B = styled(View, { opacity: '0.4 disabled:0.4' });`, true],
    [
        'a state modifier in a styled base, cured',
        `${TG} const B = styled(View, { collapsable: false, opacity: '0.4 disabled:0.4' });`,
        false,
    ],
    [
        'a variant unreadable to the walk',
        `${TG} const B = styled(View, { variants: { busy: (v) => ({ opacity: v }) } });`,
        true,
    ],
    [
        'a switching prop on a styled view that is cured in its definition',
        `${TG} const B = styled(View, { collapsable: false }); const A = ({ b }) => <B opacity={b ? 0.4 : 1} />;`,
        false,
    ],
    [
        'a cast-wrapped base keeps the base cure',
        `${TG} const Base = styled(View, { collapsable: false });
         const B = styled(Base as typeof Base, { variants: { busy: { true: { opacity: 0.4 } } } });`,
        false,
    ],
    [
        'a cast-wrapped styled() view that dims',
        `${TG} const B = styled(View, { variants: { busy: { true: { opacity: 0.4 } } } }) as typeof View;`,
        true,
    ],
    [
        'a styled() from another module',
        `import { styled } from 'other'; import { View } from 'react-native'; const B = styled(View, { variants: { busy: { true: { opacity: 0.4 } } } });`,
        false,
    ],
];

describe('flattenFlippingViews reads the shapes a View can take', () => {
    it.each(SHAPES)('%s', (_name, source, offends) => {
        expect(flattenFlippingViews(source, 'a.native.tsx', noKinds).length > 0).toBe(offends);
    });
});

describe('no app View moves its children by switching a stacking-context style', () => {
    it('reads the shared Button, the View that crashed the app', () => {
        expect(appSourceFiles()).toContain(BUTTON);
    });

    it('finds none', () => {
        const offenders = appSourceFiles().flatMap((file) =>
            flattenFlippingViews(readFileSync(path.join(repoRoot, file), 'utf8'), file, designSystemStyledKinds).map(
                (offender) => `${file}:${offender}`,
            ),
        );

        expect(offenders).toEqual([]);
    });
});
