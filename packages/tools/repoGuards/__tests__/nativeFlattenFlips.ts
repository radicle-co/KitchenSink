/**
 * Every React Native `View` in a source file that forms a stacking context in some renders and not in others, and
 * nothing that keeps its native node — read with the TypeScript parser. The detector behind `nativeFlattenFlips.test.ts`.
 *
 * React Native 0.86 keeps a View's children inside its native node only while it forms a stacking context
 * (`ReactCommon/react/renderer/components/view/ViewShadowNode.cpp`, `formsStackingContext`). Of the properties there, the
 * ones a style or a prop switches are read: `opacity` other than 1, a `transform`, `overflow` other than `visible`, a
 * `zIndex`, `display: 'none'`, a `shadowColor`, a `filter`, a `mixBlendMode`, `isolation: 'isolate'`, a `cursor`, and
 * `pointerEvents` none or box-only (as a style or a prop). A background or a border is not one: it forms a view whose
 * children are still hoisted, so switching it moves nothing.
 *
 * A View offends when those properties come and go between renders: through a conditional or a logical operator, or a
 * value that is not a literal (an `opacity` that can reach 1). It does not when another entry forms a stacking context
 * in every render, or when an attribute keeps the node: those of `nativeLabelledViews.ts` (`collapsable={false}`, a
 * native id, `accessible`, the modal flags), `aria-hidden` or `accessibilityElementsHidden` set, an
 * `importantForAccessibility` other than `auto`, `removeClippedSubviews` set, or a literal `pointerEvents` of none or
 * box-only. A style is resolved through `StyleSheet.create` in the same file; any other reference is read as forming
 * nothing, so a style handed in from outside is not seen.
 *
 * @pattern Specification — a pure predicate over a parsed source file
 */
import ts from 'typescript';

import { isSetFlag, isViewTag, keepsNode, offenderAt, viewBindingsOf } from './nativeLabelledViews.js';

/** Whether a style forms a stacking context in every render, in none, or in some. */
type Forms = 'always' | 'never' | 'sometimes';

/** The style keys of a stacking context, each with the literal values that do NOT form one. */
const STACKING_KEYS: ReadonlyMap<string, readonly (string | number)[]> = new Map<string, readonly (string | number)[]>([
    ['opacity', [1]],
    ['transform', []],
    ['overflow', ['visible']],
    ['zIndex', []],
    ['display', ['flex', 'contents']],
    ['shadowColor', ['transparent']],
    ['filter', []],
    ['mixBlendMode', ['normal']],
    ['isolation', ['auto']],
    ['cursor', ['auto']],
    ['pointerEvents', ['auto', 'box-none']],
]);

/** The style sheets a file declares: sheet name → style name → the style's object literal. */
type Sheets = ReadonlyMap<string, ReadonlyMap<string, ts.ObjectLiteralExpression>>;

/** Strip parentheses, type assertions and non-null assertions. */
function unwrap(expression: ts.Expression): ts.Expression {
    if (
        ts.isParenthesizedExpression(expression) ||
        ts.isAsExpression(expression) ||
        ts.isSatisfiesExpression(expression) ||
        ts.isNonNullExpression(expression)
    ) {
        return unwrap(expression.expression);
    }

    return expression;
}

/** Two alternatives, either of which a render may take. */
const either = (a: Forms, b: Forms): Forms => (a === b ? a : 'sometimes');

/** Entries a render applies together. */
function together(all: readonly Forms[]): Forms {
    if (all.includes('always')) {
        return 'always';
    }

    return all.includes('sometimes') ? 'sometimes' : 'never';
}

/** Whether one stacking-context key, at this value, forms a stacking context. */
function valueForms(key: string, value: ts.Expression): Forms {
    const expression = unwrap(value);
    const inert = STACKING_KEYS.get(key) ?? [];

    if (ts.isConditionalExpression(expression)) {
        return either(valueForms(key, expression.whenTrue), valueForms(key, expression.whenFalse));
    }

    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        return inert.includes(expression.text) ? 'never' : 'always';
    }

    if (ts.isNumericLiteral(expression)) {
        return inert.includes(Number(expression.text)) ? 'never' : 'always';
    }

    if (ts.isArrayLiteralExpression(expression)) {
        return expression.elements.length === 0 ? 'never' : 'always';
    }

    if (expression.kind === ts.SyntaxKind.UndefinedKeyword || expression.kind === ts.SyntaxKind.NullKeyword) {
        return 'never';
    }

    if (ts.isIdentifier(expression) && expression.text === 'undefined') {
        return 'never';
    }

    return 'sometimes';
}

/** Whether a style expression forms a stacking context. */
function styleForms(value: ts.Expression, sheets: Sheets): Forms {
    const expression = unwrap(value);

    if (ts.isArrayLiteralExpression(expression)) {
        return together(expression.elements.map((element) => styleForms(element, sheets)));
    }

    if (ts.isConditionalExpression(expression)) {
        return either(styleForms(expression.whenTrue, sheets), styleForms(expression.whenFalse, sheets));
    }

    if (ts.isBinaryExpression(expression)) {
        const right = styleForms(expression.right, sheets);

        if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
            return right === 'never' ? 'never' : 'sometimes';
        }

        return either(styleForms(expression.left, sheets), right);
    }

    if (ts.isObjectLiteralExpression(expression)) {
        return together(
            expression.properties.map((property) => {
                if (ts.isSpreadAssignment(property)) {
                    return styleForms(property.expression, sheets);
                }

                const key = property.name;

                if (
                    !ts.isPropertyAssignment(property) ||
                    key === undefined ||
                    !(ts.isIdentifier(key) || ts.isStringLiteral(key)) ||
                    !STACKING_KEYS.has(key.text)
                ) {
                    return 'never';
                }

                return valueForms(key.text, property.initializer);
            }),
        );
    }

    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
        const style = sheets.get(expression.expression.text)?.get(expression.name.text);

        return style === undefined ? 'never' : styleForms(style, sheets);
    }

    return 'never';
}

/** The `StyleSheet.create({...})` sheets a file declares at any depth. */
function sheetsOf(file: ts.SourceFile): Sheets {
    const sheets = new Map<string, Map<string, ts.ObjectLiteralExpression>>();

    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
            const call = unwrap(node.initializer);
            const argument = ts.isCallExpression(call) ? call.arguments[0] : undefined;

            if (
                ts.isCallExpression(call) &&
                ts.isPropertyAccessExpression(call.expression) &&
                call.expression.name.text === 'create' &&
                ts.isIdentifier(call.expression.expression) &&
                call.expression.expression.text === 'StyleSheet' &&
                argument !== undefined &&
                ts.isObjectLiteralExpression(argument)
            ) {
                const styles = new Map<string, ts.ObjectLiteralExpression>();

                for (const property of argument.properties) {
                    if (
                        ts.isPropertyAssignment(property) &&
                        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
                        ts.isObjectLiteralExpression(unwrap(property.initializer))
                    ) {
                        styles.set(property.name.text, unwrap(property.initializer) as ts.ObjectLiteralExpression);
                    }
                }

                sheets.set(node.name.text, styles);
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return sheets;
}

/** Whether one attribute keeps the node in every render, beyond what `nativeLabelledViews.ts` counts. */
function keepsNodeAlways(attribute: ts.JsxAttribute): boolean {
    const name = attribute.name.getText();
    const value = attribute.initializer;

    if (keepsNode(attribute)) {
        return true;
    }

    if (name === 'aria-hidden' || name === 'accessibilityElementsHidden' || name === 'removeClippedSubviews') {
        return isSetFlag(attribute);
    }

    if ((name === 'importantForAccessibility' || name === 'pointerEvents') && value !== undefined) {
        const text = ts.isStringLiteral(value)
            ? value.text
            : ts.isJsxExpression(value) && value.expression !== undefined && ts.isStringLiteral(value.expression)
              ? value.expression.text
              : undefined;

        if (text === undefined) {
            return false;
        }

        return name === 'importantForAccessibility' ? text !== 'auto' : !(STACKING_KEYS.get(name) ?? []).includes(text);
    }

    return false;
}

/** Whether one attribute forms a stacking context: the style, or a `pointerEvents` prop. */
function attributeForms(attribute: ts.JsxAttribute, sheets: Sheets): Forms {
    const name = attribute.name.getText();
    const value = attribute.initializer;
    const expression =
        value !== undefined && ts.isJsxExpression(value)
            ? value.expression
            : value !== undefined && ts.isStringLiteral(value)
              ? value
              : undefined;

    if (expression === undefined) {
        return 'never';
    }

    if (name === 'style') {
        return styleForms(expression, sheets);
    }

    return name === 'pointerEvents' ? valueForms(name, expression) : 'never';
}

/**
 * Every `View` in a source file that forms a stacking context in some renders and not in others, and nothing keeps, as
 * `line: <opening tag>`. Pure.
 *
 * @param source - The file's text.
 * @param fileName - Its name, which decides whether it is parsed as TSX.
 * @returns One entry per offending element.
 */
export function flattenFlippingViews(source: string, fileName: string): readonly string[] {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const bindings = viewBindingsOf(file);
    const sheets = sheetsOf(file);
    const offenders: string[] = [];

    const visit = (node: ts.Node): void => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && isViewTag(node.tagName, bindings)) {
            const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
            const kept = attributes.some(keepsNodeAlways);
            const forms = together(attributes.map((attribute) => attributeForms(attribute, sheets)));

            if (!kept && forms === 'sometimes') {
                offenders.push(offenderAt(file, node));
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return offenders;
}
