/**
 * A native hit target gets its floor from `touchFloor()` (`@commise/ui/layout`): 44 pt on iOS and 48 dp on Android
 * (`componentFixes.md` §1.6). A literal `44` in a native style is the iOS number alone, so the same control is 4 dp short
 * on Android, and a second copy of the platform ternary (`UndoSnackbar`'s `actionTarget`) is the same knowledge written
 * twice (DRY: one authoritative representation).
 *
 * Refused in `.native.ts(x)` app code, read with the TypeScript parser:
 *  - a `minHeight` or `minWidth` property whose value is the literal `44`;
 *  - an object literal that gives BOTH `width` and `height` the literal `44` (a square hit target);
 *  - the platform ternary `… ? 48 : 44`, which is `touchFloor()` re-spelled;
 *  - any `.touchTarget` read (`nativeTokens.touchTarget`), a second authority that gave 48 on iOS where the floor is 44.
 *
 * The same four shapes are refused on a Tamagui element and in a Tamagui `styled(…)` object (ADR-0080): a `minHeight` or
 * `minWidth` prop of 44, a `width` and a `height` prop that are both 44, a `styled(…)` object that does either (an object
 * literal is read wherever it is), and the platform ternary in a prop. A prop holds `44` as a number, or as the string
 * `"44"` or `"44px"`, which Tamagui reads as the same length.
 *
 * Not refused: a lone `height: 44` (a bar or skeleton, not a hit target), `44` in a comment, and `touchFloor.native.ts`
 * itself, which is where the number is written.
 *
 * ⛔ NO BASELINE AND NO ALLOW-LIST. SCOPE: `packages/apps/**` TypeScript minus tests and fixtures (`appSources.ts`).
 *
 * @pattern Fitness Function over the source of every app
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { appSourceModules, parseModule } from './appSources.js';
import { repoRoot } from './serviceSources.js';
import {
    designSystemStyledExports,
    tamaguiElementNames,
    tamaguiOpeningElements,
    type StyledExportsOf,
} from './tamaguiElements.js';

/** No design-system package: the fixtures name every Tamagui element they use. */
const none: StyledExportsOf = () => new Set<string>();

/** The one module that writes the floor. */
const FLOOR_MODULE = 'packages/apps/commise/ui/src/layout/touchFloor.native.ts';

/** The iOS floor, in points. */
const IOS_FLOOR = 44;

/** Whether an expression is the numeric literal `value`, or the string `"value"` or `"valuepx"` (a Tamagui length). */
const isNumber = (node: ts.Expression, value: number): boolean =>
    (ts.isNumericLiteral(node) && Number(node.text) === value) ||
    ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
        new RegExp(`^${String(value)}(?:px)?$`, 'u').test(node.text));

/** The expression a JSX attribute holds: `{expr}` or a string literal. */
function attributeValue(attribute: ts.JsxAttributeLike): ts.Expression | undefined {
    if (!ts.isJsxAttribute(attribute)) {
        return undefined;
    }

    const value = attribute.initializer;

    return value !== undefined && ts.isJsxExpression(value) ? value.expression : (value as ts.Expression | undefined);
}

/** The property name of an assignment, if it is a plain name. */
const nameOf = (node: ts.PropertyAssignment): string | undefined =>
    ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : undefined;

/**
 * The 1-based line of every hard-coded 44 hit target in a module. Pure.
 *
 * @param fileName - The module's name.
 * @param source - Its text.
 * @param styledExportsOf - Which names a design-system subpath exports as Tamagui `styled(…)` components.
 */
export function literalTouchFloors(
    fileName: string,
    source: string,
    styledExportsOf: StyledExportsOf,
): readonly { readonly line: number }[] {
    const file = parseModule(fileName, source);
    const hits: { line: number }[] = [];

    const report = (node: ts.Node): void => {
        hits.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 });
    };

    const visit = (node: ts.Node): void => {
        if (ts.isPropertyAssignment(node)) {
            const name = nameOf(node);

            if ((name === 'minHeight' || name === 'minWidth') && isNumber(node.initializer, IOS_FLOOR)) {
                report(node);
            }
        } else if (ts.isObjectLiteralExpression(node)) {
            const sized = (key: string): boolean =>
                node.properties.some(
                    (property) =>
                        ts.isPropertyAssignment(property) &&
                        nameOf(property) === key &&
                        isNumber(property.initializer, IOS_FLOOR),
                );

            if (sized('width') && sized('height')) {
                report(node);
            }
        } else if (ts.isPropertyAccessExpression(node) && node.name.text === 'touchTarget') {
            report(node);
        } else if (
            ts.isConditionalExpression(node) &&
            isNumber(node.whenTrue, 48) &&
            isNumber(node.whenFalse, IOS_FLOOR)
        ) {
            report(node);
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    for (const element of tamaguiOpeningElements(file, tamaguiElementNames(file, styledExportsOf))) {
        const props = element.attributes.properties.filter(ts.isJsxAttribute);
        const floored = (key: string): boolean =>
            props.some((prop) => {
                const value = attributeValue(prop);

                return prop.name.getText(file) === key && value !== undefined && isNumber(value, IOS_FLOOR);
            });

        if (floored('minHeight') || floored('minWidth') || (floored('width') && floored('height'))) {
            report(element);
        }
    }

    // A node reported by two readings (a pair of properties) is one site.
    return hits.filter((hit, at) => hits.findIndex((other) => other.line === hit.line) === at);
}

describe('the literal touch-floor reader', () => {
    const cases: readonly { readonly shape: string; readonly source: string; readonly lines: readonly number[] }[] = [
        { shape: 'a minHeight of 44', source: `const s = { minHeight: 44 };`, lines: [1] },
        { shape: 'a minWidth of 44', source: `const s = { minWidth: 44, alignItems: 'center' };`, lines: [1] },
        { shape: 'a square 44', source: `const s = { width: 44, height: 44 };`, lines: [1] },
        { shape: 'the platform ternary', source: `const f = () => (Platform.OS === 'android' ? 48 : 44);`, lines: [1] },
        {
            shape: 'a style sheet entry',
            source: `const s = StyleSheet.create({\n row: { minHeight: 44 },\n});`,
            lines: [2],
        },
        {
            shape: 'a nativeTokens.touchTarget read',
            source: `const s = { minHeight: nativeTokens.touchTarget };`,
            lines: [1],
        },
        // Tamagui elements and `styled(…)` objects (ADR-0080).
        {
            shape: 'a Tamagui minHeight prop of 44',
            source: `import { View } from 'tamagui';\nconst A = () => <View minHeight={44} />;`,
            lines: [2],
        },
        {
            shape: 'a Tamagui minWidth prop of 44',
            source: `import { XStack } from 'tamagui';\nconst A = () => <XStack minWidth={44} />;`,
            lines: [2],
        },
        {
            shape: 'a Tamagui square 44 in props',
            source: `import { YStack } from 'tamagui';\nconst A = () => <YStack width={44} height={44} />;`,
            lines: [2],
        },
        {
            shape: 'a Tamagui length written as a string',
            source: `import { View } from 'tamagui';\nconst A = () => <View minHeight="44px" />;`,
            lines: [2],
        },
        {
            shape: 'a Tamagui prop ternary',
            source: `import { View } from 'tamagui';\nconst A = ({ a }) => <View minHeight={a ? 48 : 44} />;`,
            lines: [2],
        },
        {
            shape: 'a local styled() element with the prop',
            source: `import { styled, View } from 'tamagui';\nconst Row = styled(View, {});\nconst A = () => <Row minHeight={44} />;`,
            lines: [3],
        },
        {
            shape: 'a styled() object with a minHeight of 44',
            source: `import { styled, View } from 'tamagui';\nconst Row = styled(View, {\n minHeight: 44,\n});`,
            lines: [3],
        },
        {
            shape: 'a styled() variant with a square 44',
            source: `import { styled, View } from 'tamagui';\nconst Row = styled(View, {\n variants: { big: { true: { width: 44, height: 44 } } },\n});`,
            lines: [3],
        },
        {
            shape: 'a styled() length written as a string',
            source: `import { styled, View } from 'tamagui';\nconst Row = styled(View, { minWidth: '44px' });`,
            lines: [2],
        },
        {
            shape: 'a Tamagui minHeight from touchFloor()',
            source: `import { View } from 'tamagui';\nconst A = () => <View minHeight={touchFloor()} />;`,
            lines: [],
        },
        {
            shape: 'a lone Tamagui height of 44',
            source: `import { View } from 'tamagui';\nconst A = () => <View height={44} />;`,
            lines: [],
        },
        {
            shape: 'a Tamagui width of 44 beside a height of 32',
            source: `import { View } from 'tamagui';\nconst A = () => <View width={44} height={32} />;`,
            lines: [],
        },
        {
            shape: 'a minHeight of 44 on an element that is not Tamagui',
            source: `import { View } from './box';\nconst A = () => <View minHeight={44} />;`,
            lines: [],
        },
        {
            shape: 'a type-only Tamagui import',
            source: `import type { View } from 'tamagui';\nconst A = () => <View minHeight={44} />;`,
            lines: [],
        },
        { shape: 'touchFloor()', source: `const s = { minHeight: touchFloor(), minWidth: touchFloor() };`, lines: [] },
        { shape: 'a lone height of 44', source: `const s = { height: 44, width: '50%' };`, lines: [] },
        { shape: 'a minHeight of 48', source: `const s = { minHeight: 48 };`, lines: [] },
        { shape: 'a 44 in a comment', source: `// minHeight: 44\nconst s = {};`, lines: [] },
        { shape: 'a width of 44 beside a height of 32', source: `const s = { width: 44, height: 32 };`, lines: [] },
    ];

    for (const { shape, source, lines } of cases) {
        it(`reads ${shape}`, () => {
            expect(literalTouchFloors('fixture.native.tsx', source, none).map((hit) => hit.line)).toEqual(lines);
        });
    }
});

describe('native app code takes its hit-target floor from touchFloor()', () => {
    const modules = appSourceModules().filter((file) => /\.native\.tsx?$/u.test(file));

    it('reads the native modules, the layout module among them (a vacuous pass would hide the rule)', () => {
        expect(modules).toContain(FLOOR_MODULE);
        expect(modules.length).toBeGreaterThan(200);
    });

    it('lets no native module hard-code the iOS floor', () => {
        const offenders = modules
            .filter((file) => file !== FLOOR_MODULE)
            .flatMap((file) =>
                literalTouchFloors(
                    file,
                    readFileSync(path.join(repoRoot, file), 'utf8'),
                    designSystemStyledExports,
                ).map((hit) => `${file}:${String(hit.line)}`),
            );

        expect(offenders).toEqual([]);
    });
});
