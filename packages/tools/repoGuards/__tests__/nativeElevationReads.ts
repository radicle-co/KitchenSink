/**
 * Who reads the native elevation table, read with the TypeScript parser (never a text match, which a comment or a
 * string would fool).
 *
 * The table (`nativeTokens.elevation`) is the ONE source of every native shadow's numbers, and `Elevated`
 * (`ui/src/elevation`) is the one view that turns it into a shadow, with the shadow colour taken from the theme. A
 * component that spreads a level into its own style draws a shadow the theme cannot recolour and that Android draws
 * only when that view carries the fill. So the table is read only inside the modules that own it.
 *
 * Known limit: an aliased import (`import { nativeTokens as t }`) is not followed. Nobody writes one today; widen the
 * reader if one appears.
 *
 * @pattern Specification — a pure predicate over a parsed module, with the owning modules named in one place
 */
import ts from 'typescript';

import { lineOf, parseModule } from './appSources.js';

/** The modules that own the table: the table, the theme that derives colours from it, `Elevated`, the tests' reader. */
const ELEVATION_TABLE_OWNERS = /^packages\/apps\/commise\/ui\/src\/(?:tokens|theme|elevation|testing)\//u;

/** `nativeTokens.elevation`, `nativeTokens['elevation']`, or `const { elevation } = nativeTokens`. */
const readsElevation = (node: ts.Node): boolean => {
    if (ts.isPropertyAccessExpression(node)) {
        return (
            node.name.text === 'elevation' &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'nativeTokens'
        );
    }

    if (ts.isElementAccessExpression(node)) {
        return (
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'nativeTokens' &&
            ts.isStringLiteralLike(node.argumentExpression) &&
            node.argumentExpression.text === 'elevation'
        );
    }

    return (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer !== undefined &&
        ts.isIdentifier(node.initializer) &&
        node.initializer.text === 'nativeTokens' &&
        node.name.elements.some((element) => (element.propertyName ?? element.name).getText() === 'elevation')
    );
};

/**
 * Every place a module reads the elevation table. Pure.
 *
 * @param fileName - The module's repo path.
 * @param source - Its text.
 * @returns One `path:line` entry per read, empty for an owning module.
 */
export function elevationTableReads(fileName: string, source: string): readonly string[] {
    if (ELEVATION_TABLE_OWNERS.test(fileName)) {
        return [];
    }

    const file = parseModule(fileName, source);
    const found: string[] = [];

    const visit = (node: ts.Node): void => {
        if (readsElevation(node)) {
            found.push(`${fileName}:${String(lineOf(file, node))}`);
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return found;
}
