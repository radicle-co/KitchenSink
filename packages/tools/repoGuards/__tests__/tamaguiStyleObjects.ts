/**
 * Walking the style objects a Tamagui `styled(…)` call is given, shared by the Tamagui guards (ADR-0080). A variant's
 * NAME and its VALUE names are keys of `variants` but are not style properties, so the walk tells the two apart: a
 * guard that read `variants: { press: … }` as a press style would refuse a variant called `press`.
 */
import ts from 'typescript';

/** One style property met inside a `styled(…)` argument: its key and its value. */
export interface StyleProperty {
    readonly key: string;
    readonly value: ts.Expression;
    readonly node: ts.PropertyAssignment;
}

function keyOf(property: ts.PropertyAssignment): string | undefined {
    const { name } = property;

    return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}

/**
 * Every style property inside the object literals a `styled(…)` call is given, at any depth, with the keys of
 * `variants` (variant names) and of each variant (value names) stepped over. Pure.
 *
 * @param call - The `styled(…)` call.
 * @returns The style properties, in source order.
 */
export function styledStyleProperties(call: ts.CallExpression): readonly StyleProperty[] {
    const found: StyleProperty[] = [];

    const walk = (object: ts.ObjectLiteralExpression, depthBelowVariants: number): void => {
        for (const property of object.properties) {
            if (!ts.isPropertyAssignment(property)) {
                continue;
            }

            const key = keyOf(property);
            const value = property.initializer;
            const isName =
                depthBelowVariants === 1 ||
                depthBelowVariants === 2 ||
                (depthBelowVariants === 0 && key === 'variants');

            if (!isName && key !== undefined) {
                found.push({ key, value, node: property });
            }

            if (ts.isObjectLiteralExpression(value)) {
                const next =
                    depthBelowVariants === 0 && key === 'variants'
                        ? 1
                        : depthBelowVariants > 0
                          ? depthBelowVariants + 1
                          : 0;

                walk(value, next > 3 ? 0 : next);
            }
        }
    };

    for (const argument of call.arguments) {
        if (ts.isObjectLiteralExpression(argument)) {
            walk(argument, 0);
        }
    }

    return found;
}
