/**
 * NO REACT NATIVE `Text` CARRIES `pointerEvents`, BECAUSE ANDROID IGNORES IT THERE.
 *
 * `pointerEvents` is a `View` prop. On Android a `Text` takes a tap whatever its own `pointerEvents` says, and
 * react-native-web, which the component tests render with, honours it, so a test cannot see the difference. It shipped
 * once: the pinned bar's title was a `Text` with `pointerEvents="none"` stretched across the bar, the bar covers Home's
 * avatar, and on Android the avatar's tap went to the title (local Android run, 2026-10-23: Home's Profile tap did
 * nothing, while iOS passed). The cure is a `View` with `pointerEvents="none"` around the `Text`.
 *
 * The rule, over every app source file, parsed with the TypeScript parser: a JSX element whose tag is React Native's
 * `Text` (by its import binding, or `RN.Text` through a namespace import) has no `pointerEvents` attribute.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { offenderAt, viewBindingsOf } from './nativeLabelledViews.js';
import { appSourceFiles } from './reactNativeValueUses.js';
import { repoRoot } from './serviceSources.js';

/** Whether a JSX tag names React Native's `Text`. Pure. */
function isTextTag(tag: ts.JsxTagNameExpression, texts: ReadonlySet<string>, namespaces: ReadonlySet<string>): boolean {
    if (ts.isIdentifier(tag)) {
        return texts.has(tag.text);
    }

    return (
        ts.isPropertyAccessExpression(tag) &&
        ts.isIdentifier(tag.expression) &&
        namespaces.has(tag.expression.text) &&
        tag.name.text === 'Text'
    );
}

/**
 * Every React Native `Text` in a source file that carries `pointerEvents`, as `line: <opening tag>`. Pure.
 *
 * @param source - The file's text.
 * @param fileName - Its name, which decides whether it is parsed as TSX.
 * @returns One entry per offending element.
 */
export function textsWithPointerEvents(source: string, fileName: string): readonly string[] {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const { texts, namespaces } = viewBindingsOf(file);
    const offenders: string[] = [];

    const visit = (node: ts.Node): void => {
        if (
            (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
            isTextTag(node.tagName, texts, namespaces) &&
            node.attributes.properties.some(
                (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'pointerEvents',
            )
        ) {
            offenders.push(offenderAt(file, node));
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return offenders;
}

const RN = `import { Text, View } from 'react-native';`;

describe('textsWithPointerEvents (the rule, on inline sources)', () => {
    it.each([
        ['a Text with pointerEvents', `${RN} const A = () => <Text pointerEvents="none">x</Text>;`, true],
        ['a self-closing Text with it', `${RN} const A = () => <Text pointerEvents="none" />;`, true],
        [
            'an aliased Text',
            `import { Text as T } from 'react-native'; const A = () => <T pointerEvents="none" />;`,
            true,
        ],
        ['RN.Text', `import * as RN from 'react-native'; const A = () => <RN.Text pointerEvents="none" />;`, true],
        ['a View with it', `${RN} const A = () => <View pointerEvents="none"><Text>x</Text></View>;`, false],
        ['a Text without it', `${RN} const A = () => <Text numberOfLines={1}>x</Text>;`, false],
        ['another Text', `import { Text } from './text'; const A = () => <Text pointerEvents="none" />;`, false],
    ])('%s', (_name: string, source: string, offends: boolean) => {
        expect(textsWithPointerEvents(source, 'a.native.tsx').length > 0).toBe(offends);
    });
});

describe('no app Text carries pointerEvents', () => {
    it('reads the pinned bar, where it shipped once', () => {
        expect(appSourceFiles()).toContain(
            'packages/apps/commise/ui/src/largeTitleHeader/CondensedTitleBar.native.tsx',
        );
    });

    it('finds none', () => {
        const offenders = appSourceFiles().flatMap((file) =>
            textsWithPointerEvents(readFileSync(path.join(repoRoot, file), 'utf8'), file).map(
                (offender) => `${file}:${offender}`,
            ),
        );

        expect(offenders).toEqual([]);
    });
});
