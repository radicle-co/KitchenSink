/**
 * Every window that extends under the Android navigation bar and never reads the bottom inset, read with the
 * TypeScript parser. The detector behind `nativeNavigationBarInset.test.ts`.
 *
 * ⛔ WHY. A React Native `Modal` with `navigationBarTranslucent` is drawn edge to edge, so the navigation bar covers
 * its foot, and an edge-to-edge window is not resized for the keyboard. A sheet that does not add the bottom inset puts
 * its action row under the navigation bar, or behind the keyboard (the Android sheet-under-keyboard defect, found on a
 * device). The house sheet and dialog frame read `useSafeAreaInsets().bottom` and hand it to `KeyboardLift`
 * (`ui/src/sheet`, `ui/src/keyboardAvoider`).
 *
 * A window offends when an element sets `navigationBarTranslucent` (bare, `{true}`, or any value that is not the
 * literal `false`) and its module never reads the bottom inset: `.bottom` of a `useSafeAreaInsets()` result, bound to
 * a name or called inline, or `bottom` taken out of it by destructuring. The window and the read are matched by
 * MODULE, not by flow: a read that never reaches the window is not seen.
 *
 * ⚠️ A shape this reader cannot see is a finding, never a pass: a spread attribute on a `Modal`, `NativeModal` or
 * `OverlayHost` element, which may carry `navigationBarTranslucent`. The one spread it can place is a FORWARDING
 * ADAPTER: the spread of the props the component itself was given (a parameter, or the rest of its destructuring), as
 * the house `Modal` and `OverlayHost` do. Such an adapter sets no flag; the flag is read at every call site that sets
 * it on an element, in any module, so nothing is exempt by name.
 *
 * @pattern Specification — a pure predicate over a parsed source file
 */
import ts from 'typescript';

import { lineOf, parseModule } from './appSources.js';
import { localsOf, valueBindingsOf } from './moduleBindings.js';

const SAFE_AREA_MODULE = 'react-native-safe-area-context';

/** The tags whose props reach a native window. */
const WINDOW_TAG = /^(?:Native)?Modal$|^OverlayHost$/u;

const unwrap = (expression: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
        ? unwrap(expression.expression)
        : expression;

/** Whether the attribute is `navigationBarTranslucent` and could be on: anything but the literal `false`. */
function setsTranslucent(attribute: ts.JsxAttribute): boolean {
    if (attribute.name.getText() !== 'navigationBarTranslucent') {
        return false;
    }

    const value = attribute.initializer;

    if (value === undefined) {
        return true;
    }

    return !(
        ts.isJsxExpression(value) &&
        value.expression !== undefined &&
        unwrap(value.expression).kind === ts.SyntaxKind.FalseKeyword
    );
}

/**
 * Whether a spread passes on the props a component was given: its identifier is a parameter, or the rest element of a
 * parameter's destructuring, of an enclosing function. That is a forwarding adapter (the house `Modal` and
 * `OverlayHost`): it adds no flag of its own, so the flag is read where a caller sets it.
 */
function forwardsItsProps(spread: ts.JsxSpreadAttribute): boolean {
    const expression = unwrap(spread.expression);

    if (!ts.isIdentifier(expression)) {
        return false;
    }

    for (let node: ts.Node | undefined = spread.parent; node !== undefined; node = node.parent) {
        if (!ts.isFunctionLike(node)) {
            continue;
        }

        for (const parameter of node.parameters) {
            if (ts.isIdentifier(parameter.name) && parameter.name.text === expression.text) {
                return true;
            }

            if (
                ts.isObjectBindingPattern(parameter.name) &&
                parameter.name.elements.some(
                    (element) =>
                        element.dotDotDotToken !== undefined &&
                        ts.isIdentifier(element.name) &&
                        element.name.text === expression.text,
                )
            ) {
                return true;
            }
        }
    }

    return false;
}

/** Whether a module reads the bottom inset of `useSafeAreaInsets()`. */
function readsBottomInset(file: ts.SourceFile): boolean {
    const bindings = valueBindingsOf(file, (specifier) => specifier === SAFE_AREA_MODULE);
    const hooks = localsOf(bindings, 'useSafeAreaInsets');
    const isHookCall = (node: ts.Node | undefined): boolean =>
        node !== undefined &&
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        hooks.has(node.expression.text);

    if (hooks.size === 0) {
        return false;
    }

    const holders = new Set<string>();
    let read = false;

    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && node.initializer !== undefined && isHookCall(unwrap(node.initializer))) {
            if (ts.isIdentifier(node.name)) {
                holders.add(node.name.text);
            } else if (ts.isObjectBindingPattern(node.name)) {
                read ||= node.name.elements.some(
                    (element) => (element.propertyName ?? element.name).getText() === 'bottom',
                );
            }
        }

        if (ts.isPropertyAccessExpression(node) && node.name.text === 'bottom') {
            const owner = unwrap(node.expression);

            read ||= isHookCall(owner) || (ts.isIdentifier(owner) && holders.has(owner.text));
        }

        if (
            ts.isElementAccessExpression(node) &&
            ts.isStringLiteral(node.argumentExpression) &&
            node.argumentExpression.text === 'bottom'
        ) {
            const owner = unwrap(node.expression);

            read ||= isHookCall(owner) || (ts.isIdentifier(owner) && holders.has(owner.text));
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return read;
}

/**
 * The windows of a module that extend under the navigation bar without the module reading the bottom inset.
 *
 * @param source - The module text.
 * @param fileName - Its path.
 * @returns One `line: reason` per finding.
 */
export function windowsWithoutBottomInset(source: string, fileName: string): readonly string[] {
    const file = parseModule(fileName, source);
    const findings: string[] = [];
    let reads: boolean | undefined;
    const bottomRead = (): boolean => (reads ??= readsBottomInset(file));

    const visit = (node: ts.Node): void => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
            const attributes = node.attributes.properties;
            const where = String(lineOf(file, node));

            if (attributes.some((attribute) => ts.isJsxAttribute(attribute) && setsTranslucent(attribute))) {
                if (!bottomRead()) {
                    findings.push(
                        `${where}: a window under the navigation bar, and the module never reads the bottom inset`,
                    );
                }
            } else if (
                WINDOW_TAG.test(node.tagName.getText()) &&
                attributes.some((attribute) => ts.isJsxSpreadAttribute(attribute) && !forwardsItsProps(attribute))
            ) {
                findings.push(
                    `${where}: a spread on ${node.tagName.getText()} may carry navigationBarTranslucent, so it cannot be checked`,
                );
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return findings;
}

/**
 * How many elements a module gives `navigationBarTranslucent`: the number the real-tree test pins above zero, so a
 * reader that stops seeing the windows cannot pass vacuously.
 *
 * @param source - The module text.
 * @param fileName - Its path.
 * @returns The count.
 */
export function translucentWindowSites(source: string, fileName: string): number {
    const file = parseModule(fileName, source);
    let count = 0;

    const visit = (node: ts.Node): void => {
        if (
            (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
            node.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && setsTranslucent(attribute))
        ) {
            count += 1;
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return count;
}
