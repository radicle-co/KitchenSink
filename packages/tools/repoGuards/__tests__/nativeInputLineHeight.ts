/**
 * The native text input line-height reader (`nativeInputLineHeight.test.ts`). It finds every `<TextInput>` (or the
 * `NativeTextInput` alias) whose `style` can reach a `lineHeight`: a `...nativeTokens.type.<role>` spread, which carries
 * the role's fixed leading, or a `lineHeight` key, written inline, in a `StyleSheet` entry the input names, or in a local
 * constant it spreads or names. It reads one module and follows names defined in it; a style that arrives as a prop is
 * the caller's, and the caller is read where it is written.
 *
 * It enumerates nothing: the files are `nativeSources()`, the inputs are the JSX tags.
 */
import ts from 'typescript';

import { parseModule } from './appSources.js';

/** The JSX tag names that render React Native's text input. */
const INPUT_TAGS: ReadonlySet<string> = new Set(['TextInput', 'NativeTextInput']);

/** A spread of a type role: `...nativeTokens.type.body`. */
const TYPE_ROLE = /\.type\.\w+$/u;

/** Every JSX element in a module that renders a text input. */
function inputElements(file: ts.SourceFile): readonly (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] {
    const found: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];

    const visit = (node: ts.Node): void => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && INPUT_TAGS.has(node.tagName.getText(file))) {
            found.push(node);
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return found;
}

/** Every named object a module defines: `const base = {…}` and `key: {…}` (a `StyleSheet.create` entry). */
function definitions(file: ts.SourceFile): ReadonlyMap<string, readonly ts.Expression[]> {
    const byName = new Map<string, ts.Expression[]>();

    const add = (name: string, value: ts.Expression): void => {
        byName.set(name, [...(byName.get(name) ?? []), value]);
    };

    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
            add(node.name.text, node.initializer);
        }

        if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
            add(node.name.text, node.initializer);
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return byName;
}

/** Whether a style expression can reach a line height. Follows names within the module, once each. */
function reachesLineHeight(
    expression: ts.Expression,
    file: ts.SourceFile,
    defined: ReadonlyMap<string, readonly ts.Expression[]>,
    seen: Set<string>,
): boolean {
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
        return reachesLineHeight(expression.expression, file, defined, seen);
    }

    if (ts.isArrayLiteralExpression(expression)) {
        return expression.elements.some((element) =>
            reachesLineHeight(ts.isSpreadElement(element) ? element.expression : element, file, defined, seen),
        );
    }

    if (ts.isObjectLiteralExpression(expression)) {
        return expression.properties.some((property) => {
            if (ts.isSpreadAssignment(property)) {
                return (
                    TYPE_ROLE.test(property.expression.getText(file)) ||
                    reachesLineHeight(property.expression, file, defined, seen)
                );
            }

            return (
                (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
                property.name.getText(file) === 'lineHeight'
            );
        });
    }

    if (ts.isConditionalExpression(expression)) {
        return [expression.whenTrue, expression.whenFalse].some((branch) => reachesLineHeight(branch, file, defined, seen));
    }

    const name = ts.isIdentifier(expression)
        ? expression.text
        : ts.isPropertyAccessExpression(expression)
          ? expression.name.text
          : undefined;

    if (name === undefined || seen.has(name)) {
        return false;
    }

    seen.add(name);

    return (defined.get(name) ?? []).some((value) => reachesLineHeight(value, file, defined, seen));
}

/**
 * The text inputs in a module whose style can reach a line height. Pure.
 *
 * @param source - The module text.
 * @param fileName - The module path, which decides TSX parsing.
 * @returns One `path:line` per offending input.
 */
export function inputsWithLineHeight(source: string, fileName: string): readonly string[] {
    const file = parseModule(fileName, source);
    const defined = definitions(file);

    return inputElements(file).flatMap((element) => {
        const attribute = element.attributes.properties.find(
            (property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText(file) === 'style',
        );
        const value = attribute?.initializer;

        if (value === undefined || !ts.isJsxExpression(value) || value.expression === undefined) {
            return [];
        }

        return reachesLineHeight(value.expression, file, defined, new Set())
            ? [`${fileName}:${String(file.getLineAndCharacterOfPosition(element.getStart(file)).line + 1)}`]
            : [];
    });
}

/**
 * How many text inputs a module renders, so a caller can prove the reader sees real ones. Pure.
 *
 * @param source - The module text.
 * @param fileName - The module path.
 */
export function textInputCount(source: string, fileName: string): number {
    return inputElements(parseModule(fileName, source)).length;
}
