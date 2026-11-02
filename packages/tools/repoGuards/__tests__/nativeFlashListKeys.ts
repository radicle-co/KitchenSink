/**
 * Every `FlashList` whose layout can change without a `key` that changes with it, read with the TypeScript parser. The
 * detector behind `nativeFlashListKeys.test.ts`.
 *
 * ⛔ WHY. FlashList measures its cells once and recycles them. When `numColumns` (or a prop that switches the layout,
 * such as a row/grid separator) changes under a mounted list, the recycler keeps the old cell sizes and the new layout
 * draws blank slots until the list is remounted. A `key` that changes with the layout remounts it. The Recipes grid
 * shipped without one, and the blank-slot defect was found on a device, not by a test.
 *
 * A list is read as needing a key when any of these is not a literal: its `numColumns`; the condition of a
 * conditional or a logical operator in `ItemSeparatorComponent`, `renderItem`, `getItemType` or `overrideItemLayout`;
 * or a non-literal `horizontal` or `inverted`. Every identifier those read must appear in the `key` expression. A
 * `key` that names fewer of them, or no `key` at all, is a finding.
 *
 * ⚠️ A shape this reader cannot see is a finding, never a pass: a spread attribute that is not followed by an explicit
 * `numColumns` (a later attribute wins over an earlier spread, so `{...scrollBind} numColumns={n}` is read). A spread
 * can still carry a layout prop other than `numColumns` (a separator); that is a known blind spot, and a `FlashList` reached through a binding it does not recognise is simply not read, which is why
 * the test also pins that the real tree's lists ARE found.
 *
 * @pattern Specification — a pure predicate over a parsed source file
 */
import ts from 'typescript';

import { lineOf, parseModule } from './appSources.js';
import { localsOf, valueBindingsOf } from './moduleBindings.js';

const FLASH_LIST_MODULE = '@shopify/flash-list';

/** The names a layout switch can hide in; the identifiers of their conditions are read. */
const LAYOUT_PROPS = new Set(['ItemSeparatorComponent', 'renderItem', 'getItemType', 'overrideItemLayout']);

/** Props that change a list's direction; a non-literal value changes its layout. */
const DIRECTION_PROPS = new Set(['horizontal', 'inverted']);

const unwrap = (expression: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
        ? unwrap(expression.expression)
        : expression;

const isLiteral = (expression: ts.Expression): boolean => {
    const inner = unwrap(expression);

    return (
        ts.isNumericLiteral(inner) ||
        ts.isStringLiteral(inner) ||
        ts.isNoSubstitutionTemplateLiteral(inner) ||
        inner.kind === ts.SyntaxKind.TrueKeyword ||
        inner.kind === ts.SyntaxKind.FalseKeyword
    );
};

/**
 * The data identifiers an expression reads: not a property name after a dot, not a call's callee, not an object key,
 * not a JSX attribute name.
 */
function identifiersOf(root: ts.Node): ReadonlySet<string> {
    const names = new Set<string>();

    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) {
            names.add(node.text);

            return;
        }

        if (ts.isPropertyAccessExpression(node)) {
            visit(node.expression);

            return;
        }

        if (ts.isCallExpression(node)) {
            // `columnsOf(width)` reads `width`; the function's own name is not layout data.
            if (!ts.isIdentifier(node.expression)) {
                visit(node.expression);
            }

            node.arguments.forEach(visit);

            return;
        }

        if (ts.isPropertyAssignment(node)) {
            visit(node.initializer);

            return;
        }

        ts.forEachChild(node, visit);
    };

    visit(root);

    return names;
}

/** The identifiers of every condition (and logical left side) inside a value. */
function conditionIdentifiersOf(root: ts.Expression): ReadonlySet<string> {
    const names = new Set<string>();

    const visit = (node: ts.Node): void => {
        if (ts.isConditionalExpression(node)) {
            identifiersOf(node.condition).forEach((name) => names.add(name));
        }

        if (
            ts.isBinaryExpression(node) &&
            (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
                node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
                node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
        ) {
            identifiersOf(node.left).forEach((name) => names.add(name));
        }

        // A function body is the list's own rendering, not a layout choice.
        if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) {
            ts.forEachChild(node, visit);
        }
    };

    visit(root);

    return names;
}

function expressionOf(attribute: ts.JsxAttribute): ts.Expression | undefined {
    const value = attribute.initializer;

    if (value === undefined) {
        return undefined;
    }

    if (ts.isJsxExpression(value)) {
        return value.expression ?? undefined;
    }

    return ts.isStringLiteral(value) ? value : undefined;
}

/** The tags of a module that render a FlashList: the named import, renamed or not, and `Namespace.FlashList`. */
function flashListTags(file: ts.SourceFile): {
    readonly names: ReadonlySet<string>;
    readonly namespaces: ReadonlySet<string>;
} {
    const bindings = valueBindingsOf(file, (specifier) => specifier === FLASH_LIST_MODULE);

    return { names: localsOf(bindings, 'FlashList'), namespaces: bindings.namespaces };
}

function isFlashListTag(
    tag: ts.JsxTagNameExpression,
    { names, namespaces }: ReturnType<typeof flashListTags>,
): boolean {
    if (ts.isIdentifier(tag)) {
        return names.has(tag.text);
    }

    return (
        ts.isPropertyAccessExpression(tag) &&
        tag.name.text === 'FlashList' &&
        ts.isIdentifier(tag.expression) &&
        namespaces.has(tag.expression.text)
    );
}

function flashListElements(file: ts.SourceFile): readonly ts.JsxOpeningLikeElement[] {
    const tags = flashListTags(file);
    const found: ts.JsxOpeningLikeElement[] = [];

    const visit = (node: ts.Node): void => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && isFlashListTag(node.tagName, tags)) {
            found.push(node);
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return found;
}

/**
 * How many FlashList elements a module renders: the number the real-tree test pins above zero, so a reader that stops
 * seeing the lists cannot pass vacuously.
 *
 * @param source - The module text.
 * @param fileName - Its path.
 * @returns The count.
 */
export function flashListSites(source: string, fileName: string): number {
    return flashListElements(parseModule(fileName, source)).length;
}

/**
 * The FlashLists of a module whose layout can change without a key that changes with it.
 *
 * @param source - The module text.
 * @param fileName - Its path.
 * @returns One `line: reason` per finding.
 */
export function unkeyedFlashLists(source: string, fileName: string): readonly string[] {
    const file = parseModule(fileName, source);

    return flashListElements(file).flatMap((element): string[] => {
        const where = `${String(lineOf(file, element))}`;
        const attributes = element.attributes.properties;

        // A later attribute wins over an earlier spread, so a spread that comes BEFORE an explicit `numColumns` cannot
        // change the column count (the house `{...scrollBind}` is one). Any other spread may carry it.
        const columnsAt = attributes.findIndex(
            (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === 'numColumns',
        );
        const unreadableSpread = attributes.some(
            (attribute, index) => ts.isJsxSpreadAttribute(attribute) && (columnsAt === -1 || index > columnsAt),
        );

        if (unreadableSpread) {
            return [`${where}: a spread attribute may carry the layout, so the key cannot be checked`];
        }

        const named = attributes.filter(ts.isJsxAttribute);
        const byName = (name: string): ts.JsxAttribute | undefined =>
            named.find((attribute) => ts.isIdentifier(attribute.name) && attribute.name.text === name);
        const layoutInputs = new Set<string>();

        const columns = byName('numColumns');
        const columnsValue = columns === undefined ? undefined : expressionOf(columns);

        if (columnsValue !== undefined && !isLiteral(columnsValue)) {
            identifiersOf(columnsValue).forEach((name) => layoutInputs.add(name));
        }

        for (const attribute of named) {
            const name = ts.isIdentifier(attribute.name) ? attribute.name.text : '';
            const value = expressionOf(attribute);

            if (value === undefined) {
                continue;
            }

            if (LAYOUT_PROPS.has(name)) {
                conditionIdentifiersOf(value).forEach((id) => layoutInputs.add(id));
            }

            if (DIRECTION_PROPS.has(name) && !isLiteral(value)) {
                identifiersOf(value).forEach((id) => layoutInputs.add(id));
            }
        }

        if (layoutInputs.size === 0) {
            return [];
        }

        const key = byName('key');
        const keyValue = key === undefined ? undefined : expressionOf(key);
        const needed = [...layoutInputs].sort();

        if (keyValue === undefined) {
            return [`${where}: no key, but the layout reads ${needed.join(', ')}`];
        }

        const keyed = identifiersOf(keyValue);
        const missing = needed.filter((name) => !keyed.has(name));

        return missing.length === 0 ? [] : [`${where}: the key does not change with ${missing.join(', ')}`];
    });
}
