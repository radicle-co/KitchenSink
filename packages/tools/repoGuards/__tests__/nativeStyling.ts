/**
 * The native styling detector: every use of React Native's own styling in one module. Mobile UI is styled with
 * Tamagui only (owner rulings 2026-10-31, ADR-0080), and `nativeStylingRatchet.test.ts` holds the count of these uses
 * so it can only fall.
 *
 * One counted use is:
 *
 * - each entry of the object a `StyleSheet.create` call is given (a non-literal argument counts once);
 * - each other access to a `StyleSheet` member (`hairlineWidth`, `absoluteFill`, `flatten`, …);
 * - each JSX attribute named `style` or ending in `Style` (`contentContainerStyle`, …), whatever its value.
 *
 * `StyleSheet` is React Native's when it is a value import from `react-native`, renamed or not, or reached through a
 * namespace import. Tamagui 3 has no `…Style` props of its own (a press or hover style is a `press:` modifier inside a
 * value), so a `…Style` attribute is React Native styling on any element. Reading is by the TypeScript parser: a
 * comment or a string that names `StyleSheet.create` is not a use.
 *
 * One exemption form exists: `// NATIVE-STYLE-ADAPTER: <reason>` on the line directly above a use. It is honoured only
 * in the design system (`ui/src`), for an Adapter over a style surface that has no Tamagui path yet (`Animated.Value`
 * styles, a third-party list's `contentContainerStyle`). Anywhere else the marker is refused, and the use still counts.
 *
 * @pattern Specification — one predicate over a parsed module, shared by the ratchet and its fixture table
 */
import ts from 'typescript';

import { parseModule } from './appSources.js';

/** One use: the line it is on (1-based) and its text. */
export interface NativeStylingUse {
    readonly line: number;
    readonly text: string;
}

/** What one module holds. */
export interface NativeStylingUses {
    /** The uses the ratchet counts. */
    readonly counted: readonly NativeStylingUse[];
    /** Uses under an honoured adapter exemption. */
    readonly exempt: readonly NativeStylingUse[];
    /** Exemption markers outside the design system, which are refused. */
    readonly misplacedExemptions: readonly NativeStylingUse[];
}

const DESIGN_SYSTEM = 'packages/apps/commise/ui/src/';

const EXEMPTION = /^\s*(?:\/\/|\{\/\*)\s*NATIVE-STYLE-ADAPTER:\s*\S/u;

const STYLE_ATTRIBUTE = /^(?:style|\w+Style)$/u;

interface StyleSheetBindings {
    readonly names: ReadonlySet<string>;
    readonly namespaces: ReadonlySet<string>;
}

function styleSheetBindingsOf(file: ts.SourceFile): StyleSheetBindings {
    const names = new Set<string>();
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

        if (bindings === undefined) {
            continue;
        }

        if (ts.isNamespaceImport(bindings)) {
            namespaces.add(bindings.name.text);
            continue;
        }

        for (const element of bindings.elements) {
            if (!element.isTypeOnly && (element.propertyName ?? element.name).text === 'StyleSheet') {
                names.add(element.name.text);
            }
        }
    }

    return { names, namespaces };
}

function isStyleSheet(expression: ts.Expression, { names, namespaces }: StyleSheetBindings): boolean {
    if (ts.isIdentifier(expression)) {
        return names.has(expression.text);
    }

    return (
        ts.isPropertyAccessExpression(expression) &&
        expression.name.text === 'StyleSheet' &&
        ts.isIdentifier(expression.expression) &&
        namespaces.has(expression.expression.text)
    );
}

/**
 * Every React Native styling use in one module. Pure.
 *
 * @param source - The module's text.
 * @param fileName - Its repo-relative path, which decides whether an exemption is honoured.
 * @returns The counted uses, the exempt ones, and any refused exemption markers.
 */
export function nativeStylingUses(source: string, fileName: string): NativeStylingUses {
    const file = parseModule(fileName, source);
    const lines = source.split('\n');
    const bindings = styleSheetBindingsOf(file);
    const honours = fileName.startsWith(DESIGN_SYSTEM);
    const counted: NativeStylingUse[] = [];
    const exempt: NativeStylingUse[] = [];
    const misplacedExemptions: NativeStylingUse[] = [];

    const record = (node: ts.Node): void => {
        const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        const use = { line, text: node.getText(file) };
        const marked = line >= 2 && EXEMPTION.test(lines[line - 2] ?? '');

        if (marked && honours) {
            exempt.push(use);

            return;
        }

        if (marked) {
            misplacedExemptions.push({ line: line - 1, text: (lines[line - 2] ?? '').trim() });
        }

        counted.push(use);
    };

    const visit = (node: ts.Node): void => {
        if (ts.isPropertyAccessExpression(node) && isStyleSheet(node.expression, bindings)) {
            const call = node.parent;

            if (node.name.text === 'create' && ts.isCallExpression(call) && call.expression === node) {
                const [argument] = call.arguments;

                if (argument !== undefined && ts.isObjectLiteralExpression(argument)) {
                    argument.properties.forEach(record);
                } else {
                    record(call);
                }
            } else {
                record(node);
            }
        }

        if (ts.isJsxAttribute(node) && STYLE_ATTRIBUTE.test(node.name.getText(file))) {
            record(node);
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return { counted, exempt, misplacedExemptions };
}
