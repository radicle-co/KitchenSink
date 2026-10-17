/**
 * How an app source file reaches one of React Native's exports AS A VALUE, read with the TypeScript parser — the shared
 * detector behind the design-system adapter guards (`modalAdapterImports.test.ts`, `textInputAdapterImports.test.ts`).
 *
 * A guard that an adapter is used is only as good as its reading of an import: a renamed import (`Modal as RNModal`)
 * and a namespace member (`RN.TextInput`) are both uses, and a type-only import (a ref's type) is not. One reader, so
 * the two guards cannot disagree on what counts.
 *
 * @pattern Specification — a pure predicate over a parsed source file, parameterised by the export it looks for.
 */
import { globSync } from 'glob';
import ts from 'typescript';

import { repoRoot } from './serviceSources.js';

/**
 * Every value use of `exportName` from `react-native` in a source file, one entry per use. Pure.
 *
 * @param source - The file's text.
 * @param fileName - Its name, which decides whether it is parsed as TSX.
 * @param exportName - The React Native export to look for, e.g. `Modal`.
 * @returns A description of each value import or namespace member access of that export.
 */
export function reactNativeValueUses(source: string, fileName: string, exportName: string): readonly string[] {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const uses: string[] = [];
    const namespaces = new Set<string>();

    for (const statement of file.statements) {
        if (
            !ts.isImportDeclaration(statement) ||
            !ts.isStringLiteral(statement.moduleSpecifier) ||
            statement.moduleSpecifier.text !== 'react-native' ||
            statement.importClause === undefined ||
            statement.importClause.isTypeOnly
        ) {
            continue;
        }

        const bindings = statement.importClause.namedBindings;

        if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
            namespaces.add(bindings.name.text);
            continue;
        }

        for (const element of bindings?.elements ?? []) {
            if (!element.isTypeOnly && (element.propertyName ?? element.name).text === exportName) {
                uses.push(`import { ${element.getText(file)} } from 'react-native'`);
            }
        }
    }

    const visit = (node: ts.Node): void => {
        if (
            ts.isPropertyAccessExpression(node) &&
            ts.isIdentifier(node.expression) &&
            namespaces.has(node.expression.text) &&
            node.name.text === exportName
        ) {
            uses.push(node.getText(file));
        }

        ts.forEachChild(node, visit);
    };

    if (namespaces.size > 0) {
        visit(file);
    }

    return uses;
}

/**
 * Every app source file, from the FILESYSTEM (the working tree, not the git index). Tests, fixtures and build output are
 * excluded: a harness may record a real React Native component's props.
 *
 * @returns Repo-relative paths, sorted.
 */
export const appSourceFiles = (): readonly string[] =>
    globSync('packages/apps/**/src/**/*.{ts,tsx}', {
        cwd: repoRoot,
        ignore: [
            '**/node_modules/**',
            '**/dist/**',
            '**/__tests__/**',
            '**/__fixtures__/**',
            '**/*.test.ts',
            '**/*.test.tsx',
        ],
    }).sort();
