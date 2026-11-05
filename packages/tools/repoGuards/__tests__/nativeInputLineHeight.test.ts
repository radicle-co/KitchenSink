/**
 * A native text input must not be given a line height (`inputTextStyle`, `ui/src/input`). React Native's Fabric text
 * input applies a `lineHeight` as paragraph style without the baseline offset that centres a `Text`, so on iOS the text
 * sits at the bottom of its line box: 4 pt low at 1x and touching the border at the cap. The `TextInput` primitive sets
 * the text of every input; a caller styles the BOX. The reader (`nativeInputLineHeight.ts`) is proven on fixtures, then
 * run over every native source, where the count is ZERO, not a ratchet: there is nothing to migrate.
 *
 * ✅ THE FIX FOR A FAILURE: drop the `...nativeTokens.type.<role>` spread (or the `lineHeight`) from the input's style.
 * Its text comes from the primitive. A multi-line input is the primitive's own case.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { inputsWithLineHeight, textInputCount } from './nativeInputLineHeight.js';
import { nativeSources } from './nativeSources.js';
import { repoRoot } from './serviceSources.js';

const FILE = 'packages/apps/commise/ui/src/thing/Thing.native.tsx';
const HEAD = `import { StyleSheet } from 'react-native';\nimport { TextInput } from '@commise/ui/text-input';\nimport { nativeTokens } from '@commise/ui/native';\n`;

const found = (source: string): number => inputsWithLineHeight(`${HEAD}${source}`, FILE).length;

describe('inputsWithLineHeight', () => {
    it.each([
        [
            'a type-role spread in a named style',
            `const A = () => <TextInput style={styles.f} />;\nconst styles = StyleSheet.create({ f: { ...nativeTokens.type.body, flex: 1 } });`,
            1,
        ],
        [
            'a type-role spread in an inline style',
            `const A = () => <TextInput style={{ ...nativeTokens.type.label }} />;`,
            1,
        ],
        [
            'a spread inside a style array',
            `const A = () => <TextInput style={[styles.f, { color: 'red' }]} />;\nconst styles = StyleSheet.create({ f: { ...nativeTokens.type.meta } });`,
            1,
        ],
        ['a literal lineHeight', `const A = () => <TextInput style={{ lineHeight: 24 }} />;`, 1],
        [
            'a lineHeight read from a token',
            `const A = () => <TextInput style={[{ lineHeight: nativeTokens.type.body.lineHeight }]} />;`,
            1,
        ],
        [
            'a style reached through a local constant',
            `const base = { ...nativeTokens.type.body };\nconst A = () => <TextInput style={base} />;`,
            1,
        ],
        [
            'a style spread from a local constant',
            `const base = { lineHeight: 20 };\nconst A = () => <TextInput style={[{ ...base }]} />;`,
            1,
        ],
        [
            'an aliased React Native input',
            `import { TextInput as NativeTextInput } from 'react-native';\nconst A = () => <NativeTextInput style={{ ...nativeTokens.type.body }} />;`,
            1,
        ],
    ])('refuses %s', (_name, source, count) => {
        expect(found(source)).toBe(count);
    });

    it.each([
        [
            'a box-only style',
            `const A = () => <TextInput style={styles.f} />;\nconst styles = StyleSheet.create({ f: { minHeight: 48, borderWidth: 1 } });`,
        ],
        ['no style', `const A = () => <TextInput value="x" />;`],
        [
            'a type-role spread on a Text, not an input',
            `import { Text } from 'react-native';\nconst A = () => <Text style={{ ...nativeTokens.type.body }} />;`,
        ],
        [
            'a type role in a style the input does not use',
            `const A = () => <TextInput style={styles.box} />;\nconst styles = StyleSheet.create({ box: { flex: 1 }, label: { ...nativeTokens.type.label } });`,
        ],
        [
            'a caller style passed through unread',
            `const A = ({ style }: { style: object }) => <TextInput style={style} />;`,
        ],
    ])('allows %s', (_name, source) => {
        expect(found(source)).toBe(0);
    });

    it('counts the inputs it reads', () => {
        expect(textInputCount(`${HEAD}const A = () => <><TextInput /><TextInput /></>;`, FILE)).toBe(2);
    });
});

describe('every native text input', () => {
    const sources = nativeSources().map((file) => [file, readFileSync(path.join(repoRoot, file), 'utf8')] as const);

    it('reads real inputs, so a reader that sees nothing cannot pass', () => {
        expect(sources.reduce((sum, [file, source]) => sum + textInputCount(source, file), 0)).toBeGreaterThan(5);
    });

    it('is styled without a line height', () => {
        expect(sources.flatMap(([file, source]) => inputsWithLineHeight(source, file))).toEqual([]);
    });
});
