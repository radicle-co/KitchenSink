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

/** The shared Button, whose busy pill crashed the app; the detector must read it. */
const BUTTON = 'packages/apps/commise/ui/src/button/Button.native.tsx';

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
];

describe('flattenFlippingViews reads the shapes a View can take', () => {
    it.each(SHAPES)('%s', (_name, source, offends) => {
        expect(flattenFlippingViews(source, 'a.native.tsx').length > 0).toBe(offends);
    });
});

describe('no app View moves its children by switching a stacking-context style', () => {
    it('reads the shared Button, the View that crashed the app', () => {
        expect(appSourceFiles()).toContain(BUTTON);
    });

    it('finds none', () => {
        const offenders = appSourceFiles().flatMap((file) =>
            flattenFlippingViews(readFileSync(path.join(repoRoot, file), 'utf8'), file).map(
                (offender) => `${file}:${offender}`,
            ),
        );

        expect(offenders).toEqual([]);
    });
});
