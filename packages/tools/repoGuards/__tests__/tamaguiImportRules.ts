/**
 * G1 and G2 (ADR-0080): where Tamagui may be imported, and that its own theme hooks are not. See
 * `tamaguiImportRules.test.ts` for why.
 *
 * @pattern Specification — two predicates over a parsed module
 */
import ts from 'typescript';

import { lineOf, parseModule } from './appSources.js';
import { reExportsOf, specifiersOf, valueBindingsOf } from './moduleBindings.js';
import { isClassifiedElementExport, TAMAGUI_MODULE } from './tamaguiElements.js';

const CONFIG_EXPORT = '@commise/ui/tamagui-config';

const NATIVE_ONLY = /\.native\.tsx?$|^packages\/apps\/commise\/mobile\/(?:src\/|App\.tsx$)/u;

const THEME_HOOKS = new Set(['useTheme', 'useThemeName', 'getTokens']);

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
    const tamagui = valueBindingsOf(file, (specifier) => TAMAGUI_MODULE.test(specifier));
    const { namespaces } = tamagui;

    const report = (node: ts.Node): void => {
        findings.push(`${fileName}:${lineOf(file, node)} ${node.getText(file)}`);
    };

    for (const hook of THEME_HOOKS) {
        specifiersOf(tamagui, hook).forEach(report);
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

/**
 * The Tamagui value exports that are not elements, and that app code may import: `styled` (a definition the guards
 * read), the provider, and the builders of the one config.
 */
const NON_ELEMENT_EXPORTS = new Set(['styled', 'TamaguiProvider', 'createTamagui', 'createTokens', 'createFont']);

function isAllowedExport(name: string): boolean {
    return NON_ELEMENT_EXPORTS.has(name) || isClassifiedElementExport(name);
}

/**
 * G1b: every value import, re-export or namespace member of Tamagui that no guard classifies. The style guards read
 * `View`, the stacks, `ScrollView` and `Text` and anything `styled(…)` from them; a `Sheet`, a `Dialog` or a `Paragraph`
 * would render with none of those rules applied, so it fails OPEN. Classify it in `tamaguiElements.ts` first, then
 * allow it. Type-only imports bind nothing and stay allowed. Pure.
 *
 * @param source - The module's text.
 * @param fileName - Its repo-relative path.
 * @returns One `file:line text` entry per unclassified use.
 */
export function tamaguiUnclassifiedImportFindings(source: string, fileName: string): readonly string[] {
    const file = parseModule(fileName, source);
    const isTamagui = (specifier: string): boolean => TAMAGUI_MODULE.test(specifier);
    const bindings = valueBindingsOf(file, isTamagui);
    const reExports = reExportsOf(file, isTamagui);

    const report = (node: ts.Node): string =>
        `${fileName}:${lineOf(file, node)} ${node.getText(file)} is not classified by the Tamagui guards`;

    const unclassifiedImports = [...bindings.specifiers]
        .filter(([name]) => !isAllowedExport(name))
        .flatMap(([, specifiers]) => specifiers);
    const unclassifiedReExports = reExports.named.filter(
        (element) => !isAllowedExport((element.propertyName ?? element.name).text),
    );

    // A default import and an export of everything reach members by name at run time, which no guard can classify.
    const defaults = [...bindings.defaults.values()];

    const members: ts.Node[] = [];

    const visit = (node: ts.Node): void => {
        if (
            ts.isPropertyAccessExpression(node) &&
            ts.isIdentifier(node.expression) &&
            bindings.namespaces.has(node.expression.text) &&
            !isAllowedExport(node.name.text)
        ) {
            members.push(node);
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return [...unclassifiedImports, ...unclassifiedReExports, ...reExports.everything, ...defaults, ...members].map(
        report,
    );
}
