/**
 * The native-suite render rule: a native component suite renders inside the design system. See
 * `nativeSuiteRender.test.ts` for why.
 *
 * @pattern Specification — one predicate over a parsed suite
 */
import ts from 'typescript';

import { lineOf, parseModule } from './appSources.js';

const TESTING_LIBRARY = '@testing-library/react';

/** The one alias under which a suite may take Testing Library's own render: its subject mounts the provider itself. */
const OPT_OUT = 'renderUnscoped';

/**
 * Every place a suite takes Testing Library's own `render`: by name, under any alias but {@link OPT_OUT}, or through a
 * namespace import whose `render` no reader can see. Pure.
 *
 * @param source - The suite's source.
 * @param fileName - Its path.
 * @returns One `file:line text` entry per finding.
 */
export function unscopedRenders(source: string, fileName: string): readonly string[] {
    const file = parseModule(fileName, source);

    return file.statements.flatMap((statement) => {
        if (
            !ts.isImportDeclaration(statement) ||
            !ts.isStringLiteral(statement.moduleSpecifier) ||
            statement.moduleSpecifier.text !== TESTING_LIBRARY ||
            statement.importClause === undefined ||
            statement.importClause.isTypeOnly
        ) {
            return [];
        }

        const bindings = statement.importClause.namedBindings;
        const found = (node: ts.Node): string => `${fileName}:${lineOf(file, node)} ${node.getText(file)}`;

        if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
            return [found(bindings)];
        }

        if (bindings === undefined || !ts.isNamedImports(bindings)) {
            return [];
        }

        return bindings.elements
            .filter(
                (element) =>
                    !element.isTypeOnly &&
                    (element.propertyName ?? element.name).text === 'render' &&
                    element.name.text !== OPT_OUT,
            )
            .map(found);
    });
}
