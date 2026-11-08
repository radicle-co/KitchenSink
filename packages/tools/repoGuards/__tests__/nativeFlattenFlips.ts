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
 * A Tamagui View-like element (a `View`, a stack, a `ScrollView`, or a `styled(…)` over one: ADR-0080) is read the same
 * way, with the properties written as Tamagui props and `styled(…)` objects. It offends when one of those properties
 * is set (i) by a prop that is a conditional or a non-literal, (ii) inside a `variants` value of its `styled(…)`
 * definition, which applies only while that variant is chosen, or (iii) through a state modifier (`disabled:`,
 * `press:`, …) or a state key of the object form (`{ base, disabled }`), and no property forms a stacking context in
 * every render. Tamagui passes `collapsable` through to the host view, so `collapsable={false}` keeps the node, and a
 * `styled(…)` definition cures every use with `collapsable: false` in its base. ⚠️ A `styled(…)` configuration the walk
 * cannot read (a spread, a function variant) is reported, because a stacking property could hide in it.
 *
 * @pattern Specification — a pure predicate over a parsed source file
 */
import ts from 'typescript';

import { isSetFlag, isViewTag, keepsNode, offenderAt, viewBindingsOf } from './nativeLabelledViews.js';
import {
    styledDeclarations,
    tamaguiStyledNames,
    unwrapBase,
    type StyledDeclaration,
    type StyledKindsOf,
} from './tamaguiElements.js';
import { isStateModifier, valueHasModifier } from './tamaguiStateStyles.js';
import { styledConfig } from './tamaguiStyleObjects.js';
import { attributeValueOf } from './tamaguiTokenValues.js';

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
    const expression = attributeValueOf(attribute);

    if (expression === undefined) {
        return 'never';
    }

    if (name === 'style') {
        return styleForms(expression, sheets);
    }

    return name === 'pointerEvents' ? valueForms(name, expression) : 'never';
}

/**
 * Whether a Tamagui value forms a stacking context in every render, none, or some: a state modifier or a state key of
 * the object form makes it some, anything else reads as a literal or not (`valueForms`).
 */
function tamaguiValueForms(key: string, value: ts.Expression): Forms {
    return valueHasModifier(value, isStateModifier) ? 'sometimes' : valueForms(key, value);
}

/** Whether a Tamagui prop forms a stacking context. Only the stacking keys are read. */
function tamaguiAttributeForms(attribute: ts.JsxAttribute): Forms {
    const name = attribute.name.getText();
    const expression = attributeValueOf(attribute);

    return expression === undefined || !STACKING_KEYS.has(name) ? 'never' : tamaguiValueForms(name, expression);
}

/** Whether a `styled(…)` base config keeps its node: `collapsable: false` at the top level, not inside a variant. */
function configKeepsNode(call: ts.CallExpression): boolean {
    return styledConfig(call).properties.some(
        ({ key, value, inVariants }) =>
            key === 'collapsable' && !inVariants && value.kind === ts.SyntaxKind.FalseKeyword,
    );
}

/** The local `styled(…)` bindings that keep their node, a base followed through chains of local bindings. */
function curedBindings(declarations: readonly StyledDeclaration[]): ReadonlySet<string> {
    const cured = new Set<string>();

    for (let pass = 0; pass <= declarations.length; pass += 1) {
        const before = cured.size;

        for (const { name, call } of declarations) {
            const base = call.arguments[0] === undefined ? undefined : unwrapBase(call.arguments[0]);

            if (configKeepsNode(call) || (base !== undefined && ts.isIdentifier(base) && cured.has(base.text))) {
                cured.add(name);
            }
        }

        if (cured.size === before) {
            break;
        }
    }

    return cured;
}

/**
 * Whether a View-like `styled(…)` definition switches a stacking context on a variant, a state or a non-literal, with
 * nothing forming one in every render, or has a configuration the walk cannot read. Pure.
 */
function definitionFlips(call: ts.CallExpression): boolean {
    const { properties, unreadable } = styledConfig(call);
    const stacking = properties
        .filter(({ key }) => STACKING_KEYS.has(key))
        .map(({ key, value, inVariants }) => ({ inVariants, forms: tamaguiValueForms(key, value) }));
    const base = together(stacking.filter(({ inVariants }) => !inVariants).map(({ forms }) => forms));

    if (base === 'always') {
        return false;
    }

    return (
        unreadable.length > 0 ||
        base === 'sometimes' ||
        stacking.some(({ inVariants, forms }) => inVariants && forms !== 'never')
    );
}

/**
 * Every `View` in a source file that forms a stacking context in some renders and not in others, and nothing keeps, as
 * `line: <opening tag>`. Pure.
 *
 * @param source - The file's text.
 * @param fileName - Its name, which decides whether it is parsed as TSX.
 * @param styledKindsOf - The kind of each name a design-system subpath exports as a Tamagui styled component.
 * @returns One entry per offending element or `styled(…)` definition.
 */
export function flattenFlippingViews(
    source: string,
    fileName: string,
    styledKindsOf: StyledKindsOf,
): readonly string[] {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const bindings = viewBindingsOf(file, styledKindsOf);
    const sheets = sheetsOf(file);
    const declarations = styledDeclarations(file, tamaguiStyledNames(file));
    const cured = curedBindings(declarations);
    const offenders: string[] = [];

    for (const { name, call } of declarations) {
        if (bindings.tamagui.get(name) === 'view' && !cured.has(name) && definitionFlips(call)) {
            offenders.push(offenderAt(file, call.parent));
        }
    }

    const visit = (node: ts.Node): void => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && isViewTag(node.tagName, bindings)) {
            const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
            const kept = attributes.some(keepsNodeAlways) || cured.has(node.tagName.getText());
            const forms = together([
                ...attributes.map((attribute) => attributeForms(attribute, sheets)),
                ...(bindings.tamagui.get(node.tagName.getText()) === 'view'
                    ? attributes.map(tamaguiAttributeForms)
                    : []),
            ]);

            if (!kept && forms === 'sometimes') {
                offenders.push(offenderAt(file, node));
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return offenders;
}
