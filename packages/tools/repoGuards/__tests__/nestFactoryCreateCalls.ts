/**
 * The `NestFactory.create(…)` calls in one file: the one reading of "where does this service boot Nest" under the guards
 * that check a bootstrap (serviceLoggingInvariants L1, serviceJsonParserOnce). Each had its own copy, and the copies
 * drifted: one counted the bracket and alias spellings and the other did not, so a bootstrap could pass one guard unseen.
 *
 * A call counts when its callee is `create` on `NestFactory` imported from `@nestjs/core` (renamed or not) or on a local
 * alias of it (`const F = NestFactory`, an alias of an alias too), read by dot or by a string key (`['create']`).
 */
import ts from 'typescript';

import { valueBindingsOf } from './moduleBindings.js';
import { visit } from './serviceSources.js';

/**
 * Every `NestFactory.create` call in a file, in source order. Pure.
 *
 * @param file - The parsed module.
 * @returns The calls.
 */
export function nestFactoryCreateCalls(file: ts.SourceFile): readonly ts.CallExpression[] {
    const factories = new Set(
        valueBindingsOf(file, (specifier) => specifier === '@nestjs/core').locals.get('NestFactory'),
    );
    const calls: ts.CallExpression[] = [];

    // Declarations are visited in source order, so an alias of an alias is found.
    visit(file, (node) => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer !== undefined &&
            ts.isIdentifier(node.initializer) &&
            factories.has(node.initializer.text)
        ) {
            factories.add(node.name.text);
        }
    });

    visit(file, (node) => {
        if (!ts.isCallExpression(node)) {
            return;
        }

        const callee = node.expression;
        const member = ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)
              ? callee.argumentExpression.text
              : undefined;
        const object =
            ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
                ? callee.expression
                : undefined;

        if (member === 'create' && object !== undefined && ts.isIdentifier(object) && factories.has(object.text)) {
            calls.push(node);
        }
    });

    return calls;
}
