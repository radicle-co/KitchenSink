/**
 * The field-reveal reader for `nativeInputFieldReveal.test.ts`: whether a module renders the `TextInput` primitive, and
 * whether it calls a hook that asks the reveal host to hold a focused field in view. Read by the TypeScript parser, so a
 * comment that names the hook does not count. It enumerates nothing.
 */
import ts from 'typescript';

import { parseModule } from './appSources.js';

/** The hooks that send the host a `focus` request: the request itself, and the hook that wires a whole input. */
const REVEAL_HOOKS: ReadonlySet<string> = new Set(['useFocusReveal', 'useRevealedField']);

const walk = (node: ts.Node, visit: (node: ts.Node) => boolean): boolean =>
    visit(node) || ts.forEachChild(node, (child) => walk(child, visit) || undefined) === true;

/**
 * Whether a module renders a `<TextInput>`. Pure.
 *
 * @param source - The module text.
 * @param fileName - The module path.
 */
export function rendersTextInput(source: string, fileName: string): boolean {
    return walk(
        parseModule(fileName, source),
        (node) =>
            (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
            node.tagName.getText() === 'TextInput',
    );
}

/**
 * Whether a module calls a reveal hook. Pure.
 *
 * @param source - The module text.
 * @param fileName - The module path.
 */
export function revealsFocus(source: string, fileName: string): boolean {
    return walk(
        parseModule(fileName, source),
        (node) =>
            ts.isCallExpression(node) && ts.isIdentifier(node.expression) && REVEAL_HOOKS.has(node.expression.text),
    );
}
