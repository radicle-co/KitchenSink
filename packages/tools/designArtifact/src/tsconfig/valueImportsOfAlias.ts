/**
 * @module tsconfig/valueImportsOfAlias — which imports through a tsconfig `paths` alias are NOT type-only.
 *
 * This package reaches into the Commise product tree through `paths` aliases (`#commise/*`, and the one `@/` message
 * module the web chrome imports) so the card registry can be typed against sources no package exports. An alias is a
 * resolver, not a boundary: a value import through it would compile, and bundle a second copy of product code. The
 * guard test (`__tests__/commiseTypeOnlyImports.test.ts`) feeds every source of the package through this scanner.
 *
 * The scan walks the TypeScript syntax tree rather than matching text, so a specifier in a comment or a string is not
 * an import, and a JSX file parses.
 *
 * @pattern Specification — a pure predicate over a syntax tree, parameterised by the alias matcher.
 */
import ts from 'typescript';

/** Whether a module specifier goes through a guarded alias. */
export type AliasMatcher = (specifier: string) => boolean;

/**
 * The matcher for a set of `paths` keys: a key ending in `/*` matches by its prefix, any other key by equality.
 *
 * @param keys - The `compilerOptions.paths` keys.
 * @returns A matcher; for no keys, one that matches nothing.
 */
export function aliasMatcherOf(keys: readonly string[]): AliasMatcher {
    const prefixes = keys.filter((key) => key.endsWith('*')).map((key) => key.slice(0, -1));
    const exact = new Set(keys.filter((key) => !key.endsWith('*')));

    return (specifier) => exact.has(specifier) || prefixes.some((prefix) => specifier.startsWith(prefix));
}

/** The module specifier of a string-literal node, or `undefined`. */
function specifierOf(node: ts.Node | undefined): string | undefined {
    return node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined;
}

/** The specifier a node imports as a value (or for its side effect), or `undefined` when it imports only types. */
function valueSpecifierOf(node: ts.Node): string | undefined {
    if (ts.isImportDeclaration(node)) {
        // `import type …` is erased. `import { type A }` is NOT: under `verbatimModuleSyntax` it stays as `import 'x'`.
        return node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
            ? undefined
            : specifierOf(node.moduleSpecifier);
    }

    if (ts.isExportDeclaration(node)) {
        return node.isTypeOnly ? undefined : specifierOf(node.moduleSpecifier);
    }

    if (ts.isImportEqualsDeclaration(node)) {
        return !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)
            ? specifierOf(node.moduleReference.expression)
            : undefined;
    }

    if (ts.isCallExpression(node)) {
        const isLoad =
            node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === 'require');

        return isLoad ? specifierOf(node.arguments[0]) : undefined;
    }

    return undefined;
}

/**
 * The specifiers a source imports through a guarded alias other than with `import type` / `export type`.
 *
 * @param source - The file's text.
 * @param isAlias - Which specifiers are guarded.
 * @param fileName - Selects the parser (`.tsx` parses JSX); defaults to a `.ts` file.
 * @returns The offending specifiers, in source order (a repeated one is repeated).
 */
export function valueImportsOfAlias(source: string, isAlias: AliasMatcher, fileName = 'source.ts'): readonly string[] {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const found: string[] = [];

    const visit = (node: ts.Node): void => {
        const specifier = valueSpecifierOf(node);

        if (specifier !== undefined && isAlias(specifier)) {
            found.push(specifier);
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return found;
}
