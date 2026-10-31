/**
 * Walking the style objects a Tamagui `styled(…)` call is given, shared by the Tamagui guards (ADR-0080). A variant's
 * NAME and its VALUE names are keys of `variants` but are not style properties, so the walk tells the two apart: a
 * guard that read `variants: { press: … }` as a press style would refuse a variant called `press`.
 *
 * The walk FAILS CLOSED on structure it cannot read: a config argument that is not an object literal, a spread, a
 * shorthand or method property, a function value (Tamagui's function variants), and a variant table or variant value
 * that is not an object literal. Each is returned as `unreadable`, and the guards report it, because a press style or a
 * ratio line height inside it would otherwise pass unseen. ⚠️ A style VALUE that is an identifier or a call is read as
 * a value, not walked: a press modifier held in a variable is not seen.
 */
import ts from 'typescript';

/** One style property met inside a `styled(…)` argument: its key and its value. */
export interface StyleProperty {
    readonly key: string;
    readonly value: ts.Expression;
    readonly node: ts.PropertyAssignment;
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

function isFunction(node: ts.Expression): boolean {
    return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
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

    const walk = (object: ts.ObjectLiteralExpression, depthBelowVariants: number): void => {
        for (const property of object.properties) {
            if (!ts.isPropertyAssignment(property)) {
                unreadable.push(property);
                continue;
            }

            const key = keyOf(property);
            const value = property.initializer;
            const variantTable = depthBelowVariants === 0 && key === 'variants';
            const isName = depthBelowVariants === 1 || depthBelowVariants === 2 || variantTable;

            if (isFunction(value) || ((variantTable || isName) && !ts.isObjectLiteralExpression(value))) {
                unreadable.push(property);
                continue;
            }

            if (!isName && key !== undefined) {
                properties.push({ key, value, node: property });
            }

            if (ts.isObjectLiteralExpression(value)) {
                walk(value, depthAfter(depthBelowVariants, variantTable));
            }
        }
    };

    // The first argument is the component being styled; every later one is configuration.
    for (const argument of call.arguments.slice(1)) {
        if (ts.isObjectLiteralExpression(argument)) {
            walk(argument, 0);
        } else {
            unreadable.push(argument);
        }
    }

    return { properties, unreadable };
}
