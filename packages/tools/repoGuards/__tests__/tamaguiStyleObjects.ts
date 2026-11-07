/**
 * Walking the style objects a Tamagui `styled(…)` call is given, shared by the Tamagui guards (ADR-0080). A variant's
 * NAME and its VALUE names are keys of `variants` but are not style properties, so the walk tells the two apart: a
 * guard that read `variants: { press: … }` as a press style would refuse a variant called `press`.
 *
 * The walk FAILS CLOSED on structure it cannot read: a config argument that is not an object literal, a spread, a
 * shorthand or method property, a function value (Tamagui's function variants; a bare `styled.dynamic<T>()` carrier
 * is readable), and a variant table or variant value
 * that is not an object literal. Each is returned as `unreadable`, and the guards report it, because a press style or a
 * ratio line height inside it would otherwise pass unseen. ⚠️ A style VALUE that is an identifier or a call is read as
 * a value, not walked: a press modifier held in a variable is not seen. Parentheses, `as` and `satisfies` around an
 * OBJECT are read through, because Tamagui's own examples write `variants: { … } as const`.
 */
import ts from 'typescript';

import { unwrapBase } from './tamaguiElements.js';

/** One style property met inside a `styled(…)` argument: its key and its value. */
export interface StyleProperty {
    readonly key: string;
    readonly value: ts.Expression;
    readonly node: ts.PropertyAssignment;
    /** Whether the property sits anywhere inside `variants`, so it applies only while that variant is chosen. */
    readonly inVariants: boolean;
}

/** What a `styled(…)` call's configuration holds. */
export interface StyledConfig {
    readonly properties: readonly StyleProperty[];
    /** The parts the walk cannot read, which a guard reports instead of passing. */
    readonly unreadable: readonly ts.Node[];
}

function keyOf(property: ts.PropertyAssignment): string | undefined {
    const { name } = property;

    return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}

/**
 * How deep below `variants` the walk is after entering a property's object value: 1 inside the variant table (variant
 * names), 2 inside one variant (value names), 3 inside one value (styles), and 0 again for anything deeper, which is
 * an ordinary style object (`backgroundColor: { base, press }`).
 */
function depthAfter(depthBelowVariants: number, enteringVariantTable: boolean): number {
    if (enteringVariantTable) {
        return 1;
    }

    return depthBelowVariants > 0 && depthBelowVariants < 3 ? depthBelowVariants + 1 : 0;
}

/**
 * An object literal with its parentheses, `as` and `satisfies` read through, or the expression as written. Only an
 * OBJECT is read through: a cast on a style VALUE (`'$ink' as ColorTokens`) is kept, because the guards refuse it.
 * Pure.
 */
function objectThrough(expression: ts.Expression): ts.Expression {
    const inner = unwrapBase(expression);

    return ts.isObjectLiteralExpression(inner) ? inner : expression;
}

function isFunction(node: ts.Expression): boolean {
    return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

/**
 * Whether a variant value is a bare `styled.dynamic<T>()` carrier: Tamagui 3's typed prop that a `.resolve` consumes. It
 * declares a prop and emits no style, so it is readable; a carrier given a function is not.
 */
function isBareDynamicCarrier(node: ts.Expression): boolean {
    return (
        ts.isCallExpression(node) &&
        node.arguments.length === 0 &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'dynamic' &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'styled'
    );
}

/**
 * Every style property inside the object literals a `styled(…)` call is given, at any depth, with the keys of
 * `variants` (variant names) and of each variant (value names) stepped over, and every part it cannot read. Pure.
 *
 * @param call - The `styled(…)` call.
 * @returns The style properties, in source order, and the unreadable parts.
 */
export function styledConfig(call: ts.CallExpression): StyledConfig {
    const properties: StyleProperty[] = [];
    const unreadable: ts.Node[] = [];

    const walk = (object: ts.ObjectLiteralExpression, depthBelowVariants: number, inVariants: boolean): void => {
        for (const property of object.properties) {
            if (!ts.isPropertyAssignment(property)) {
                unreadable.push(property);
                continue;
            }

            const key = keyOf(property);
            const value = objectThrough(property.initializer);
            const variantTable = depthBelowVariants === 0 && key === 'variants';
            const isName = depthBelowVariants === 1 || depthBelowVariants === 2 || variantTable;

            if (isName && !variantTable && isBareDynamicCarrier(value)) {
                continue;
            }

            if (isFunction(value) || ((variantTable || isName) && !ts.isObjectLiteralExpression(value))) {
                unreadable.push(property);
                continue;
            }

            if (!isName && key !== undefined) {
                properties.push({ key, value, node: property, inVariants });
            }

            if (ts.isObjectLiteralExpression(value)) {
                walk(value, depthAfter(depthBelowVariants, variantTable), inVariants || variantTable);
            }
        }
    };

    // The first argument is the component being styled; every later one is configuration.
    for (const written of call.arguments.slice(1)) {
        const argument = objectThrough(written);

        if (ts.isObjectLiteralExpression(argument)) {
            walk(argument, 0, false);
        } else {
            unreadable.push(argument);
        }
    }

    return { properties, unreadable };
}
