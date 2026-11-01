/**
 * Every React Native text in a native source file that grows with the system's text size without limit (ADR-0080 §8:
 * the cap is 2×), read with the TypeScript parser. The detector behind `nativeTextScaleCapRatchet.test.ts`.
 *
 * A React Native `Text` (directly, through a namespace import, or as `Animated.Text`) or `TextInput` is capped only by
 * `maxFontSizeMultiplier={FONT_SCALE_CAP}`; a number, `allowFontScaling={false}` and a spread are not trusted. The
 * design system's `Text` carries the cap itself and is not counted. React Native passes text attributes down to nested
 * text, so a text inside another text, React Native's or the design system's, is part of that text's run and is not
 * counted on its own: capping the outer text caps the run.
 *
 * ⚠️ It reads React Native text only. A Tamagui `Text` in app code is capped only if it is the design system's; a
 * `styled()` over Tamagui's own `Text` would not be seen.
 *
 * @pattern Specification — a pure predicate over a parsed source file
 */
import ts from 'typescript';

import { parseModule } from './appSources.js';
import { isReactNative, localsOf, valueBindingsOf } from './moduleBindings.js';
import { tamaguiElementKinds, type StyledKindsOf } from './tamaguiElements.js';

/** The one cap a React Native text may name: the design system's constant. */
const CAP = 'FONT_SCALE_CAP';

interface TextBindings {
    readonly texts: ReadonlySet<string>;
    readonly inputs: ReadonlySet<string>;
    readonly animated: ReadonlySet<string>;
    readonly namespaces: ReadonlySet<string>;
    readonly tamagui: ReadonlyMap<string, string>;
}

function isReactNativeText(tag: ts.JsxTagNameExpression, b: TextBindings): boolean {
    if (ts.isIdentifier(tag)) {
        return b.texts.has(tag.text) || b.inputs.has(tag.text);
    }

    if (!ts.isPropertyAccessExpression(tag) || !ts.isIdentifier(tag.expression)) {
        return false;
    }

    const owner = tag.expression.text;
    const member = tag.name.text;

    return (
        (b.namespaces.has(owner) && (member === 'Text' || member === 'TextInput')) ||
        (b.animated.has(owner) && member === 'Text')
    );
}

function isText(tag: ts.JsxTagNameExpression, b: TextBindings): boolean {
    return b.tamagui.get(tag.getText()) === 'text' || isReactNativeText(tag, b);
}

function capped(attributes: ts.JsxAttributes): boolean {
    return attributes.properties.some(
        (property) =>
            ts.isJsxAttribute(property) &&
            property.name.getText() === 'maxFontSizeMultiplier' &&
            property.initializer !== undefined &&
            ts.isJsxExpression(property.initializer) &&
            property.initializer.expression !== undefined &&
            ts.isIdentifier(property.initializer.expression) &&
            property.initializer.expression.text === CAP,
    );
}

/**
 * The 1-based lines of every uncapped React Native text that is not inside another text. Pure.
 *
 * @param source - The module's source.
 * @param fileName - Its path, for the parser.
 * @param styledKindsOf - The kind of each name a design-system subpath exports as a Tamagui styled component.
 * @returns The lines, in source order.
 */
export function uncappedTexts(source: string, fileName: string, styledKindsOf: StyledKindsOf): readonly number[] {
    const file = parseModule(fileName, source);
    const rn = valueBindingsOf(file, isReactNative);
    const bindings: TextBindings = {
        texts: localsOf(rn, 'Text'),
        inputs: localsOf(rn, 'TextInput'),
        animated: localsOf(rn, 'Animated'),
        namespaces: new Set(rn.namespaces),
        tamagui: tamaguiElementKinds(file, styledKindsOf),
    };
    const lines: number[] = [];

    const visit = (node: ts.Node, insideText: boolean): void => {
        const opening = ts.isJsxElement(node)
            ? node.openingElement
            : ts.isJsxSelfClosingElement(node)
              ? node
              : undefined;

        if (opening === undefined) {
            ts.forEachChild(node, (child) => {
                visit(child, insideText);
            });

            return;
        }

        if (!insideText && isReactNativeText(opening.tagName, bindings) && !capped(opening.attributes)) {
            lines.push(file.getLineAndCharacterOfPosition(opening.getStart(file)).line + 1);
        }

        const childrenInside = insideText || isText(opening.tagName, bindings);

        ts.forEachChild(node, (child) => {
            visit(child, childrenInside);
        });
    };

    visit(file, false);

    return lines;
}
