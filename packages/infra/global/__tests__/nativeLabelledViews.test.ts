/**
 * Every React Native `View` the apps render with an accessible NAME or ROLE keeps its native node — asserted by
 * DISCOVERY, never by a list.
 *
 * ⛔ WHY THIS GUARD EXISTS. React Native 0.86 flattens a View that only lays out its children out of Android's native
 * tree, and a label or a role does not keep it, so the name is gone from TalkBack and from Maestro while every component
 * test, which renders through react-native-web, still finds it. A local Maestro pass found every matched ingredient
 * row's `Ingredient N name` missing this way. The rule and its sources are in `nativeLabelledViews.ts`.
 *
 * ⛔ IT ENUMERATES NOTHING. Candidate files are `appSourceFiles()` and each is read with the TypeScript parser, so a
 * renamed import and a namespace member are caught, and a type-only import is not.
 *
 * ✅ THE FIX FOR A FAILURE, in this order (`docs/design/nativeContainerNames.md` N1):
 *   1. If text inside the View says its name, DROP THE NAME, and give that text `accessibilityRole="header"`. A View left
 *      with no name and no role needs nothing kept.
 *   2. Only then, keep the node: give the View `collapsable={false}`. Use `accessible` instead only where the View is ONE
 *      element whose children are read as part of it, because `accessible` merges them.
 *
 * ⛔ NAMED TWICE. A View whose name is the expression a `Text` anywhere inside it says is a second stop that says what
 * the next one says. Keeping its node is how those repeats reached TalkBack, so this guard refuses them too
 * (`nativeContainerNames.md` N3). It reads syntax only, so a name in other words is the reviewer's to find.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { namedTwiceViews, unkeptNamedViews } from './nativeLabelledViews.js';
import { appSourceFiles } from './reactNativeValueUses.js';
import { repoRoot } from './serviceSources.js';

/** A row whose name a Maestro pass found missing on Android; the detector must read it. */
const ROW_NAME = 'packages/apps/commise/features/recipes/src/form/RecipeIngredientsFields.native.tsx';

/** Shapes the tree may hold, and whether each is an offender. */
const SHAPES: readonly (readonly [string, string, boolean])[] = [
    ['a named View', `import { View } from 'react-native'; const A = () => <View aria-label="x" />;`, true],
    ['a roled View', `import { View } from 'react-native'; const A = () => <View role="group" style={s} />;`, true],
    ['the legacy name', `import { View } from 'react-native'; const A = () => <View accessibilityLabel="x" />;`, true],
    [
        'the legacy role',
        `import { View } from 'react-native'; const A = () => <View accessibilityRole="alert" />;`,
        true,
    ],
    [
        'kept',
        `import { View } from 'react-native'; const A = () => <View collapsable={false} aria-label="x" />;`,
        false,
    ],
    [
        'still flattenable',
        `import { View } from 'react-native'; const A = () => <View collapsable aria-label="x" />;`,
        true,
    ],
    ['one element', `import { View } from 'react-native'; const A = () => <View accessible aria-label="x" />;`, false],
    [
        'not one element',
        `import { View } from 'react-native'; const A = () => <View accessible={false} role="list" />;`,
        true,
    ],
    ['a native id', `import { View } from 'react-native'; const A = () => <View id="n" role="note" />;`, false],
    ['a modal', `import { View } from 'react-native'; const A = () => <View aria-modal aria-label="x" />;`, false],
    ['a spread', `import { View } from 'react-native'; const A = (p) => <View {...p} aria-label="x" />;`, true],
    ['unnamed', `import { View } from 'react-native'; const A = () => <View style={s} />;`, false],
    ['renamed', `import { View as Box } from 'react-native'; const A = () => <Box aria-label="x" />;`, true],
    ['a namespace', `import * as RN from 'react-native'; const A = () => <RN.View aria-label="x" />;`, true],
    ['type only', `import type { View } from 'react-native'; const A = () => <View aria-label="x" />;`, false],
    ['another View', `import { View } from './box'; const A = () => <View aria-label="x" />;`, false],
    [
        'an Animated View',
        `import { Animated } from 'react-native'; const A = () => <Animated.View aria-label="x" />;`,
        true,
    ],
    [
        'a kept Animated View',
        `import { Animated } from 'react-native'; const A = () => <Animated.View collapsable={false} role="list" />;`,
        false,
    ],
    [
        'a renamed Animated View',
        `import { Animated as Motion } from 'react-native'; const A = () => <Motion.View aria-label="x" />;`,
        true,
    ],
    [
        'an Animated View through a namespace',
        `import * as RN from 'react-native'; const A = () => <RN.Animated.View aria-label="x" />;`,
        true,
    ],
    [
        'an Animated View from another module',
        `import { Animated } from './motion'; const A = () => <Animated.View aria-label="x" />;`,
        false,
    ],
    [
        'a name in a spread object',
        `import { View } from 'react-native'; const A = () => <View {...{ 'aria-label': 'x' }} />;`,
        true,
    ],
    [
        'a name in a conditional spread',
        `import { View } from 'react-native'; const A = (c) => <View {...(c ? { accessibilityLabel: 'x' } : {})} />;`,
        true,
    ],
    [
        'a name in the other branch of a conditional spread',
        `import { View } from 'react-native'; const A = (c) => <View {...(c ? {} : { accessibilityLabel: 'x' })} />;`,
        true,
    ],
    [
        'a role in a guarded spread',
        `import { View } from 'react-native'; const A = (c) => <View {...(c && { role: 'list' })} />;`,
        true,
    ],
    [
        'a name in a spread, kept',
        `import { View } from 'react-native'; const A = (c) => <View {...(c ? { role: 'list' } : {})} collapsable={false} />;`,
        false,
    ],
    [
        'a spread object with no name',
        `import { View } from 'react-native'; const A = () => <View {...{ style: s }} />;`,
        false,
    ],
    [
        'an opaque spread alone',
        `import { View } from 'react-native'; const A = (p) => <View {...p.handlers} />;`,
        false,
    ],
    [
        'one element only sometimes',
        `import { View } from 'react-native'; const A = (one) => <View accessible={one} aria-label="x" />;`,
        true,
    ],
    [
        'one element, literally',
        `import { View } from 'react-native'; const A = () => <View accessible={true} aria-label="x" />;`,
        false,
    ],
    [
        'a modal only sometimes',
        `import { View } from 'react-native'; const A = (open) => <View aria-modal={open} aria-label="x" />;`,
        true,
    ],
];

/** The same expression in a View's name and in a `Text` inside it, and whether each shape is an offender (N3). */
const NAMED_TWICE: readonly (readonly [string, string, boolean])[] = [
    [
        'named twice, the Text a direct child',
        `import { Text, View } from 'react-native'; const A = ({ t }) => <View aria-label={t}><Text>{t}</Text></View>;`,
        true,
    ],
    [
        'named twice, the Text nested in another element',
        `import { Text, View } from 'react-native';
         const A = ({ r }) => <View accessibilityLabel={r.title}><Surface><Text>{ r.title }</Text></Surface></View>;`,
        true,
    ],
    [
        'named twice, the Text inside a list the View maps',
        `import { Text, View } from 'react-native';
         const A = ({ g }) => <View aria-label={g.label}>{g.items.map((i) => <Text key={i}>{g.label}</Text>)}</View>;`,
        true,
    ],
    [
        'named twice through a conditional spread',
        `import { Text, View } from 'react-native';
         const A = ({ g }) => <View {...(g.label === undefined ? {} : { accessibilityLabel: g.label })}><Text>{g.label}</Text></View>;`,
        true,
    ],
    [
        'named twice by a literal',
        `import { Text, View } from 'react-native'; const A = () => <View aria-label="Tags"><Text>Tags</Text></View>;`,
        true,
    ],
    [
        'named twice, kept',
        `import { Text, View } from 'react-native';
         const A = ({ t }) => <View collapsable={false} role="group" aria-label={t}><Text>{t}</Text></View>;`,
        true,
    ],
    [
        'named twice, an Animated View',
        `import { Animated, Text } from 'react-native';
         const A = ({ t }) => <Animated.View aria-label={t}><Text>{t}</Text></Animated.View>;`,
        true,
    ],
    [
        'one element, its text merged into its name',
        `import { Text, View } from 'react-native';
         const A = ({ t }) => <View accessible accessibilityRole="progressbar" accessibilityLabel={t}><Text>{t}</Text></View>;`,
        false,
    ],
    [
        'one element only sometimes',
        `import { Text, View } from 'react-native';
         const A = ({ t, one }) => <View accessible={one} accessibilityLabel={t}><Text>{t}</Text></View>;`,
        true,
    ],
    [
        'named by its heading only',
        `import { Text, View } from 'react-native';
         const A = ({ t }) => <View><Text accessibilityRole="header">{t}</Text></View>;`,
        false,
    ],
    [
        'a name the inner text does not say',
        `import { Text, View } from 'react-native';
         const A = ({ t }) => <View collapsable={false} aria-label={t}><Pressable onPress={go} /></View>;`,
        false,
    ],
    [
        'an inner Text with another expression',
        `import { Text, View } from 'react-native'; const A = ({ t, u }) => <View aria-label={t}><Text>{u}</Text></View>;`,
        false,
    ],
    [
        'the name in a sibling Text, not an inner one',
        `import { Text, View } from 'react-native';
         const A = ({ t }) => <><Text>{t}</Text><View aria-label={t} /></>;`,
        false,
    ],
    [
        'a role with no name',
        `import { Text, View } from 'react-native';
         const A = ({ t }) => <View collapsable={false} role="list"><Text>{t}</Text></View>;`,
        false,
    ],
    [
        'a Text from another module',
        `import { View } from 'react-native'; import { Text } from './text';
         const A = ({ t }) => <View aria-label={t}><Text>{t}</Text></View>;`,
        false,
    ],
];

describe('the apps keep the native node of every View they name or role', () => {
    it.each(SHAPES)('reads %s', (_shape, source, offends) => {
        expect(unkeptNamedViews(source, 'shape.tsx')).toHaveLength(offends ? 1 : 0);
    });

    it('discovers the app sources, the row name included (a vacuous pass would hide the rule below)', () => {
        expect(appSourceFiles()).toContain(ROW_NAME);
    });

    it('reads the row name’s group as a named View, so the detector reads the real file', () => {
        const source = readFileSync(path.join(repoRoot, ROW_NAME), 'utf8');

        expect(unkeptNamedViews(source.replaceAll('collapsable={false}', ''), ROW_NAME)).not.toHaveLength(0);
    });

    it('finds no named or roled View that nothing keeps', () => {
        const offenders = appSourceFiles().flatMap((file) =>
            unkeptNamedViews(readFileSync(path.join(repoRoot, file), 'utf8'), file).map((use) => `${file}:${use}`),
        );

        expect(offenders).toEqual([]);
    });

    it.each(NAMED_TWICE)('reads %s', (_shape, source, offends) => {
        expect(namedTwiceViews(source, 'shape.tsx')).toHaveLength(offends ? 1 : 0);
    });

    it('finds no View whose name a Text inside it says again (drop the name; nativeContainerNames.md N1)', () => {
        const offenders = appSourceFiles().flatMap((file) =>
            namedTwiceViews(readFileSync(path.join(repoRoot, file), 'utf8'), file).map((use) => `${file}:${use}`),
        );

        expect(offenders).toEqual([]);
    });
});
