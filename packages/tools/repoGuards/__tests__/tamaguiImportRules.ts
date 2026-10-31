/**
 * G1 and G2 (ADR-0080): where Tamagui may be imported, and that its own theme hooks are not. See
 * `tamaguiImportRules.test.ts` for why.
 *
 * @pattern Specification — two predicates over a parsed module
 */
import ts from 'typescript';

import { parseModule } from './appSources.js';
import { importsValues } from './moduleBindings.js';
import { TAMAGUI_MODULE } from './tamaguiElements.js';

const CONFIG_EXPORT = '@commise/ui/tamagui-config';

const NATIVE_ONLY = /\.native\.tsx?$|^packages\/apps\/commise\/mobile\/(?:src\/|App\.tsx$)/u;

const THEME_HOOKS = new Set(['useTheme', 'useThemeName', 'getTokens']);

function lineOf(file: ts.SourceFile, node: ts.Node): number {
    return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

function isTamaguiSpecifier(text: string): boolean {
    return TAMAGUI_MODULE.test(text) || text === CONFIG_EXPORT;
}

/**
 * G1: every import of Tamagui or of the Tamagui config in a module that is not native-only. Pure.
 *
 * @param source - The module's text.
 * @param fileName - Its repo-relative path.
 * @returns One `file:line text` entry per import.
 */
export function tamaguiImportFindings(source: string, fileName: string): readonly string[] {
    if (NATIVE_ONLY.test(fileName)) {
        return [];
    }

    const file = parseModule(fileName, source);
    const findings: string[] = [];

    const visit = (node: ts.Node): void => {
        const specifier =
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined
                ? node.moduleSpecifier
                : ts.isCallExpression(node) &&
                    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
                  ? node.arguments[0]
                  : undefined;

        if (specifier !== undefined && ts.isStringLiteral(specifier) && isTamaguiSpecifier(specifier.text)) {
            findings.push(`${fileName}:${lineOf(file, node)} ${node.getText(file)}`);
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return findings;
}

/**
 * G2: every value import of Tamagui's own theme hooks, renamed or through a namespace. Pure.
 *
 * @param source - The module's text.
 * @param fileName - Its path.
 * @returns One `file:line text` entry per use.
 */
export function tamaguiThemeHookFindings(source: string, fileName: string): readonly string[] {
    const file = parseModule(fileName, source);
    const findings: string[] = [];
    const namespaces = new Set<string>();

    const report = (node: ts.Node): void => {
        findings.push(`${fileName}:${lineOf(file, node)} ${node.getText(file)}`);
    };

    for (const statement of file.statements) {
        if (
            !ts.isImportDeclaration(statement) ||
            !ts.isStringLiteral(statement.moduleSpecifier) ||
            !TAMAGUI_MODULE.test(statement.moduleSpecifier.text) ||
            !importsValues(statement)
        ) {
            continue;
        }

        const bindings = statement.importClause?.namedBindings;

        if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
            namespaces.add(bindings.name.text);
        } else if (bindings !== undefined) {
            bindings.elements
                .filter(
                    (element) => !element.isTypeOnly && THEME_HOOKS.has((element.propertyName ?? element.name).text),
                )
                .forEach(report);
        }
    }

    const visit = (node: ts.Node): void => {
        if (
            ts.isPropertyAccessExpression(node) &&
            ts.isIdentifier(node.expression) &&
            namespaces.has(node.expression.text) &&
            THEME_HOOKS.has(node.name.text)
        ) {
            report(node);
        }

        ts.forEachChild(node, visit);
    };

    if (namespaces.size > 0) {
        visit(file);
    }

    return findings;
}
