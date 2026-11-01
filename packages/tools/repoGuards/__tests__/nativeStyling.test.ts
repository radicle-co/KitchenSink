/**
 * The native styling detector, proven shape by shape before the ratchet trusts it with the tree. Each row is one
 * shape of React Native styling and the exact number of uses it must count. A row that counts too few lets styling
 * hide; a row that counts too many blocks a file that is clean.
 *
 * Tamagui 3 has no `pressStyle`-style props (press and hover are `press:` modifiers inside a value), so every `style`
 * or `…Style` attribute is React Native styling, on any element.
 */
import { describe, expect, it } from 'vitest';

import { admitsAdapterExemption, nativeStylingUses } from './nativeStyling.js';

const UI = 'packages/apps/commise/ui/src/thing/Thing.native.tsx';
const FEATURE = 'packages/apps/commise/features/recipes/src/thing/Thing.native.tsx';

interface Row {
    readonly shape: string;
    readonly source: string;
    readonly counted: number;
    readonly exempt?: number;
    readonly misplaced?: number;
    readonly file?: string;
}

const rows: readonly Row[] = [
    {
        shape: 'StyleSheet.create counts each entry',
        source: `import { StyleSheet } from 'react-native';\nconst s = StyleSheet.create({ a: {}, b: {}, c: {} });`,
        counted: 3,
    },
    {
        shape: 'an aliased StyleSheet',
        source: `import { StyleSheet as SS } from 'react-native';\nconst s = SS.create({ a: {}, b: {} });`,
        counted: 2,
    },
    {
        shape: 'StyleSheet through a namespace import',
        source: `import * as RN from 'react-native';\nconst s = RN.StyleSheet.create({ a: {} });`,
        counted: 1,
    },
    {
        shape: 'StyleSheet.create of a non-literal counts once',
        source: `import { StyleSheet } from 'react-native';\nconst s = StyleSheet.create(base);`,
        counted: 1,
    },
    {
        shape: 'every other StyleSheet member',
        source: `import { StyleSheet } from 'react-native';\nconst a = StyleSheet.hairlineWidth;\nconst b = StyleSheet.absoluteFill;\nconst c = StyleSheet.flatten(x);`,
        counted: 3,
    },
    {
        shape: 'a type-only StyleSheet import is not styling',
        source: `import type { StyleSheet } from 'react-native';\ntype T = typeof StyleSheet;`,
        counted: 0,
    },
    {
        shape: 'a local StyleSheet that is not React Native’s',
        source: `const StyleSheet = { create: (x: object) => x };\nconst s = StyleSheet.create({ a: {} });`,
        counted: 0,
    },
    {
        shape: 'StyleSheet rebound to another name counts once',
        source: `import { StyleSheet } from 'react-native';\nconst SS = StyleSheet;\nconst s = SS.create({ a: {} });`,
        counted: 1,
    },
    {
        shape: 'a member destructured off StyleSheet counts once',
        source: `import { StyleSheet } from 'react-native';\nconst { create } = StyleSheet;`,
        counted: 1,
    },
    {
        shape: 'a namespace StyleSheet rebound counts once',
        source: `import * as RN from 'react-native';\nconst SS = RN.StyleSheet;`,
        counted: 1,
    },
    { shape: 'an inline style object', source: `const v = <View style={{ padding: 4 }} />;`, counted: 1 },
    { shape: 'a style array', source: `const v = <View style={[a, b]} />;`, counted: 1 },
    { shape: 'a style reference', source: `const v = <View style={styles.x} />;`, counted: 1 },
    {
        shape: 'a …Style attribute',
        source: `const v = <ScrollView contentContainerStyle={{ padding: 4 }} />;`,
        counted: 1,
    },
    {
        shape: 'style on a Tamagui element is still React Native styling',
        source: `import { View } from 'tamagui';\nconst v = <View style={{ padding: 4 }} />;`,
        counted: 1,
    },
    {
        shape: 'Tamagui style props are not counted',
        source: `import { View } from 'tamagui';\nconst v = <View padding="$4" backgroundColor="$paper" />;`,
        counted: 0,
    },
    {
        shape: 'a comment or a string that names StyleSheet.create',
        source: `// StyleSheet.create({ a: {} })\nconst s = 'StyleSheet.create({ a: {} }) style={{}}';`,
        counted: 0,
    },
    {
        shape: 'an adapter exemption in the design system',
        source: `const v = (\n    // NATIVE-STYLE-ADAPTER: Animated.Value styles have no Tamagui path yet\n    <Animated.View style={{ opacity }} />\n);`,
        counted: 0,
        exempt: 1,
        file: UI,
    },
    {
        shape: 'an adapter exemption outside the design system is refused and still counts',
        source: `const v = (\n    // NATIVE-STYLE-ADAPTER: not allowed here\n    <Animated.View style={{ opacity }} />\n);`,
        counted: 1,
        misplaced: 1,
        file: FEATURE,
    },
    {
        shape: 'an exemption marker with no reason is not an exemption',
        source: `const v = (\n    // NATIVE-STYLE-ADAPTER:\n    <Animated.View style={{ opacity }} />\n);`,
        counted: 1,
        file: UI,
    },
];

describe('nativeStylingUses', () => {
    it.each(rows)('$shape', ({ source, counted, exempt = 0, misplaced = 0, file = FEATURE }) => {
        const uses = nativeStylingUses(source, file);

        expect(uses.counted).toHaveLength(counted);
        expect(uses.exempt).toHaveLength(exempt);
        expect(uses.misplacedExemptions).toHaveLength(misplaced);
    });

    it('says where each use is, so a failure names the line to change', () => {
        const uses = nativeStylingUses(`const a = 1;\nconst v = <View style={{ padding: 4 }} />;`, FEATURE);

        expect(uses.counted).toEqual([{ line: 2, text: 'style={{ padding: 4 }}' }]);
    });
});

// A design-system Adapter may record a NEW adapter exemption (the hairline token was the first), but only in a file
// whose uses were never counted: an exemption marker must not relabel styling the ratchet still owes a migration.
describe('admitsAdapterExemption', () => {
    const history: readonly Readonly<Record<string, number>>[] = [{ [FEATURE]: 2 }, { [FEATURE]: 3, [UI]: 1 }];

    it('admits a design-system file no baseline ever counted', () => {
        expect(admitsAdapterExemption([{ [FEATURE]: 2 }])(UI)).toBe(true);
    });

    it('refuses a design-system file whose counted uses would become exemptions', () => {
        expect(admitsAdapterExemption(history)(UI)).toBe(false);
    });

    it('refuses a file outside the design system', () => {
        expect(admitsAdapterExemption([{}])(FEATURE)).toBe(false);
    });
});
