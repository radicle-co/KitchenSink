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
 * `Text` (by its import binding, or `RN.Text` through a namespace import) has no `pointerEvents` attribute. A Tamagui
 * `Text`, or a `styled(Text, …)` over one (ADR-0080), is the same host `Text`, so it is read the same way.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { isTextTag, offenderAt, viewBindingsOf } from './nativeLabelledViews.js';
import { appSourceFiles } from './reactNativeValueUses.js';
import { repoRoot } from './serviceSources.js';
import { designSystemStyledKinds, type StyledKindsOf, type TamaguiKind } from './tamaguiElements.js';

/** No design-system package: the fixtures name every Tamagui element they use. */
const noKinds: StyledKindsOf = () => new Map<string, TamaguiKind>();

/**
 * Every `Text` (React Native's, or a Tamagui `Text` or `styled(Text, …)`) in a source file that carries `pointerEvents`, as `line: <opening tag>`. Pure.
 *
 * @param source - The file's text.
 * @param fileName - Its name, which decides whether it is parsed as TSX.
 * @param styledKindsOf - The kind of each name a design-system subpath exports as a Tamagui styled component.
 * @returns One entry per offending element.
 */
export function textsWithPointerEvents(
    source: string,
    fileName: string,
    styledKindsOf: StyledKindsOf,
): readonly string[] {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const bindings = viewBindingsOf(file, styledKindsOf);
    const offenders: string[] = [];

    const visit = (node: ts.Node): void => {
        if (
            (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
            isTextTag(node.tagName, bindings) &&
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
        // Tamagui Text (ADR-0080): the same Android defect, a Tamagui Text is a `Text` on the host.
        [
            'a Tamagui Text with it',
            `import { Text } from 'tamagui'; const A = () => <Text pointerEvents="none">x</Text>;`,
            true,
        ],
        [
            'a renamed Tamagui Text',
            `import { Text as T } from 'tamagui'; const A = () => <T pointerEvents="none">x</T>;`,
            true,
        ],
        [
            'a Tamagui Text through a namespace',
            `import * as TG from 'tamagui'; const A = () => <TG.Text pointerEvents="none" />;`,
            true,
        ],
        [
            'a local styled(Text)',
            `import { styled, Text } from 'tamagui'; const Label = styled(Text, {});
             const A = () => <Label pointerEvents="none" />;`,
            true,
        ],
        [
            'a styled(Text) over a styled(Text)',
            `import { styled, Text } from 'tamagui'; const Label = styled(Text, {}); const Small = styled(Label, {});
             const A = () => <Small pointerEvents="none" />;`,
            true,
        ],
        [
            'a Tamagui YStack with it',
            `import { YStack, Text } from 'tamagui'; const A = () => <YStack pointerEvents="none"><Text>x</Text></YStack>;`,
            false,
        ],
        [
            'a styled(View) with it',
            `import { styled, View } from 'tamagui'; const Box = styled(View, {});
             const A = () => <Box pointerEvents="none" />;`,
            false,
        ],
        ['a Tamagui Text without it', `import { Text } from 'tamagui'; const A = () => <Text>x</Text>;`, false],
        [
            'a type-only Tamagui Text',
            `import type { Text } from 'tamagui'; const A = () => <Text pointerEvents="none" />;`,
            false,
        ],
    ])('%s', (_name: string, source: string, offends: boolean) => {
        expect(textsWithPointerEvents(source, 'a.native.tsx', noKinds).length > 0).toBe(offends);
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
            textsWithPointerEvents(readFileSync(path.join(repoRoot, file), 'utf8'), file, designSystemStyledKinds).map(
                (offender) => `${file}:${offender}`,
            ),
        );

        expect(offenders).toEqual([]);
    });
});
