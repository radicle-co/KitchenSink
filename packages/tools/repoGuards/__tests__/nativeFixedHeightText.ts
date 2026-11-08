/**
 * Every native frame that has a FIXED `height` and holds text, read with the TypeScript parser. The detector behind
 * `nativeFixedHeightText.test.ts`.
 *
 * ⛔ WHY. Text grows with the reader's font scale and with a longer translation; a frame with a fixed `height` does not,
 * so the text is clipped or drawn outside it. The Recipes search pill had `height: 48` around its input and cut the
 * text at a large font scale; a device found it. A `minHeight` is fine: the frame grows.
 *
 * A frame is a React Native `View` or a View-like Tamagui element (`nativeLabelledViews.isViewTag`). Its height is fixed
 * when it sets `height` (or Tamagui's `h`) to anything but `auto`, `undefined`, `null` or a percentage: as a JSX prop, as
 * a key of its `style` (an object, an array, a conditional, a logical operator, or a `StyleSheet.create` entry or
 * object constant of the SAME file), or in the base or a variant of its own `styled(…)` definition. `minHeight`,
 * `maxHeight` and `lineHeight` are other keys and are not read. A frame holds text when any descendant is a `Text`
 * (React Native's or a Text-like Tamagui element), a text input, written text, or an expression child that evaluates
 * to a string.
 *
 * ⚠️ Shapes this reader cannot see are findings, never passes — but only for a frame that is known to be fixed-height
 * or holds text it cannot classify:
 *  - a fixed-height frame whose child is `{children}` or an unknown component, because text may arrive through it
 *    (reported as `may hold text`);
 *  - a `style` that contains a spread or a call, because a height could hide in it (reported as `cannot read`) —
 *    only when the frame holds text.
 * Known blind spots, listed so nobody reads a pass as more than it is: a style imported from another module or passed in
 * as a prop is not followed, and a height set by a custom component's own props (a `<Pill height={48}>` that is not a
 * View) is not a frame here.
 *
 * @pattern Specification — a pure predicate over a parsed source file
 */
import ts from 'typescript';

import { lineOf, parseModule } from './appSources.js';
import { isTextTag, isViewTag, viewBindingsOf } from './nativeLabelledViews.js';
import { styledDeclarations, tamaguiStyledNames, type StyledKindsOf } from './tamaguiElements.js';
import { styledConfig } from './tamaguiStyleObjects.js';
import { attributeValueOf } from './tamaguiTokenValues.js';

/** The keys that mean "this exact height". */
const HEIGHT_KEYS = new Set(['height', 'h']);

/** A text input's name: it holds text whatever it is called inside. */
const INPUT_TAG = /^(?:TextInput|Input|TextField|SearchField)$/u;

const unwrap = (expression: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
        ? unwrap(expression.expression)
        : expression;

/** Whether a `height` value is fixed: not `auto`, `undefined`, `null`, or a percentage of the parent. */
function valueIsFixed(value: ts.Expression): boolean {
    const inner = unwrap(value);

    if (ts.isConditionalExpression(inner)) {
        return valueIsFixed(inner.whenTrue) || valueIsFixed(inner.whenFalse);
    }

    if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) {
        return inner.text !== 'auto' && !inner.text.endsWith('%');
    }

    if (inner.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(inner) && inner.text === 'undefined')) {
        return false;
    }

    return true;
}

/** `styles.name` sheets and object constants a file declares, by name. */
interface Local {
    /** Sheet name → entry name → the entry's object. */
    readonly sheets: ReadonlyMap<string, ReadonlyMap<string, ts.Expression>>;
    /** Constant name → its initializer. */
    readonly constants: ReadonlyMap<string, ts.Expression>;
}

function localsOfFile(file: ts.SourceFile): Local {
    const sheets = new Map<string, Map<string, ts.Expression>>();
    const constants = new Map<string, ts.Expression>();

    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
            const init = unwrap(node.initializer);

            if (
                ts.isCallExpression(init) &&
                ts.isPropertyAccessExpression(init.expression) &&
                init.expression.name.text === 'create' &&
                init.arguments[0] !== undefined &&
                ts.isObjectLiteralExpression(unwrap(init.arguments[0]))
            ) {
                const entries = new Map<string, ts.Expression>();

                for (const property of (unwrap(init.arguments[0]) as ts.ObjectLiteralExpression).properties) {
                    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
                        entries.set(property.name.text, property.initializer);
                    }
                }

                sheets.set(node.name.text, entries);
            } else if (ts.isObjectLiteralExpression(init) || ts.isArrayLiteralExpression(init)) {
                constants.set(node.name.text, init);
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return { sheets, constants };
}

/** What a style expression says about height. */
type StyleHeight = 'fixed' | 'none' | 'unreadable';

const worse = (a: StyleHeight, b: StyleHeight): StyleHeight =>
    a === 'fixed' || b === 'fixed' ? 'fixed' : a === 'unreadable' || b === 'unreadable' ? 'unreadable' : 'none';

function styleHeightOf(expression: ts.Expression, local: Local, depth = 0): StyleHeight {
    const inner = unwrap(expression);

    if (depth > 6) {
        return 'unreadable';
    }

    if (ts.isObjectLiteralExpression(inner)) {
        let result: StyleHeight = 'none';

        for (const property of inner.properties) {
            if (ts.isSpreadAssignment(property)) {
                result = worse(result, styleHeightOf(property.expression, local, depth + 1));
            } else if (ts.isPropertyAssignment(property) && HEIGHT_KEYS.has(property.name.getText())) {
                result = worse(result, valueIsFixed(property.initializer) ? 'fixed' : 'none');
            } else if (ts.isShorthandPropertyAssignment(property) && HEIGHT_KEYS.has(property.name.text)) {
                result = worse(result, 'fixed');
            }
        }

        return result;
    }

    if (ts.isArrayLiteralExpression(inner)) {
        return inner.elements.reduce<StyleHeight>(
            (result, element) =>
                worse(result, ts.isSpreadElement(element) ? 'unreadable' : styleHeightOf(element, local, depth + 1)),
            'none',
        );
    }

    if (ts.isConditionalExpression(inner)) {
        return worse(styleHeightOf(inner.whenTrue, local, depth + 1), styleHeightOf(inner.whenFalse, local, depth + 1));
    }

    if (ts.isBinaryExpression(inner)) {
        const kind = inner.operatorToken.kind;

        if (kind === ts.SyntaxKind.AmpersandAmpersandToken) {
            return styleHeightOf(inner.right, local, depth + 1);
        }

        if (kind === ts.SyntaxKind.BarBarToken || kind === ts.SyntaxKind.QuestionQuestionToken) {
            return worse(styleHeightOf(inner.left, local, depth + 1), styleHeightOf(inner.right, local, depth + 1));
        }
    }

    if (ts.isPropertyAccessExpression(inner) && ts.isIdentifier(inner.expression)) {
        const entry = local.sheets.get(inner.expression.text)?.get(inner.name.text);

        return entry === undefined ? 'none' : styleHeightOf(entry, local, depth + 1);
    }

    if (ts.isIdentifier(inner)) {
        const constant = local.constants.get(inner.text);

        return constant === undefined ? 'none' : styleHeightOf(constant, local, depth + 1);
    }

    if (
        inner.kind === ts.SyntaxKind.NullKeyword ||
        inner.kind === ts.SyntaxKind.FalseKeyword ||
        (ts.isIdentifier(inner) && inner.text === 'undefined')
    ) {
        return 'none';
    }

    // A call or anything else: a height could hide in it.
    return ts.isCallExpression(inner) ? 'unreadable' : 'none';
}

/** The tags of local `styled(…)` definitions that set a height, with the height's reading. */
function styledHeights(file: ts.SourceFile): ReadonlyMap<string, StyleHeight> {
    const heights = new Map<string, StyleHeight>();

    for (const { name, call } of styledDeclarations(file, tamaguiStyledNames(file))) {
        const config = styledConfig(call);
        const fixed = config.properties.some(
            (property) => HEIGHT_KEYS.has(property.key) && valueIsFixed(property.value),
        );

        heights.set(name, fixed ? 'fixed' : config.unreadable.length > 0 ? 'unreadable' : 'none');
    }

    return heights;
}

/** What a frame's content says about text. */
type Holds = 'text' | 'opaque' | 'none';

/** Whether a frame holds text, may hold some it cannot see, or none. */
function holdsOf(
    element: ts.JsxElement,
    isText: (tag: ts.JsxTagNameExpression) => boolean,
    isView: (tag: ts.JsxTagNameExpression) => boolean,
): Holds {
    let result: Holds = 'none';

    const visit = (node: ts.Node): void => {
        if (result === 'text') {
            return;
        }

        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
            const tag = node.tagName;

            if (isText(tag) || INPUT_TAG.test(tag.getText())) {
                result = 'text';

                return;
            }

            // An unknown component may render text; a View or a fragment is only a container.
            if (!isView(tag) && /^[A-Z]/u.test(tag.getText()) && !tag.getText().includes('Icon')) {
                result = 'opaque';
            }
        }

        if (ts.isJsxText(node) && node.text.trim() !== '') {
            result = 'text';

            return;
        }

        if (
            ts.isJsxExpression(node) &&
            node.expression !== undefined &&
            (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
        ) {
            const expression = unwrap(node.expression);
            const text = expression.getText();

            if (ts.isIdentifier(expression) && expression.text === 'children') {
                result = result === 'none' ? 'opaque' : result;
            } else if (
                ts.isStringLiteral(expression) ||
                ts.isNoSubstitutionTemplateLiteral(expression) ||
                ts.isTemplateExpression(expression) ||
                (ts.isIdentifier(expression) && !/^[A-Z]/u.test(text)) ||
                ts.isPropertyAccessExpression(expression) ||
                ts.isCallExpression(expression)
            ) {
                result = 'text';

                return;
            }
        }

        ts.forEachChild(node, visit);
    };

    element.children.forEach(visit);

    return result;
}

interface FrameReading {
    readonly line: number;
    /** The frame as written: its tag and the attributes that set its size, so a finding can be named without its line. */
    readonly frame: string;
    readonly height: StyleHeight;
    readonly holds: Holds;
}

function framesOf(source: string, fileName: string, styledKindsOf: StyledKindsOf): readonly FrameReading[] {
    const file = parseModule(fileName, source);
    const bindings = viewBindingsOf(file, styledKindsOf);
    const local = localsOfFile(file);
    const styled = styledHeights(file);
    const readings: FrameReading[] = [];
    const isText = (tag: ts.JsxTagNameExpression): boolean => isTextTag(tag, bindings);
    const isView = (tag: ts.JsxTagNameExpression): boolean => isViewTag(tag, bindings);

    const visit = (node: ts.Node): void => {
        if (ts.isJsxElement(node) && isView(node.openingElement.tagName)) {
            const opening = node.openingElement;
            let height: StyleHeight = styled.get(opening.tagName.getText()) ?? 'none';

            for (const attribute of opening.attributes.properties) {
                if (ts.isJsxSpreadAttribute(attribute)) {
                    continue;
                }

                const name = attribute.name.getText();
                const value = attributeValueOf(attribute);

                if (HEIGHT_KEYS.has(name)) {
                    height = worse(height, value === undefined || valueIsFixed(value) ? 'fixed' : 'none');
                } else if (name === 'style' && value !== undefined) {
                    height = worse(height, styleHeightOf(value, local));
                }
            }

            const sizing = opening.attributes.properties
                .filter(
                    (attribute) =>
                        ts.isJsxAttribute(attribute) &&
                        (attribute.name.getText() === 'style' || HEIGHT_KEYS.has(attribute.name.getText())),
                )
                .map((attribute) => attribute.getText().replace(/\s+/gu, ' '))
                .join(' ');
            const frame = `<${opening.tagName.getText()} ${sizing}>`.replace(' >', '>').slice(0, 90);

            readings.push({ line: lineOf(file, node), frame, height, holds: holdsOf(node, isText, isView) });
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return readings;
}

/**
 * The fixed-height frames of a module that hold text.
 *
 * @param source - The module text.
 * @param fileName - Its path.
 * @param styledKindsOf - The kind of each name a design-system subpath exports as a Tamagui styled component.
 * @returns One `line: reason` per finding.
 */
export function fixedHeightTextFrames(
    source: string,
    fileName: string,
    styledKindsOf: StyledKindsOf,
): readonly string[] {
    return framesOf(source, fileName, styledKindsOf).flatMap(({ line, frame, height, holds }): string[] => {
        if (height === 'fixed' && holds === 'text') {
            return [`${String(line)}: a fixed height around text — ${frame}`];
        }

        if (height === 'fixed' && holds === 'opaque') {
            return [
                `${String(line)}: a fixed height that may hold text (children or a component this reader cannot see into) — ${frame}`,
            ];
        }

        if (height === 'unreadable' && holds === 'text') {
            return [`${String(line)}: a style this reader cannot read, around text — ${frame}`];
        }

        return [];
    });
}

/**
 * How many frames a module gives a fixed height: the number the real-tree test pins above zero, so a reader that stops
 * seeing frames cannot pass vacuously.
 *
 * @param source - The module text.
 * @param fileName - Its path.
 * @param styledKindsOf - The kind of each name a design-system subpath exports as a Tamagui styled component.
 * @returns The count.
 */
export function fixedHeightFrameSites(source: string, fileName: string, styledKindsOf: StyledKindsOf): number {
    return framesOf(source, fileName, styledKindsOf).filter((frame) => frame.height === 'fixed').length;
}
