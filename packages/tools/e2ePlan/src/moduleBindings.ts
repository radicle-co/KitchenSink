/**
 * What one module takes from another and what it passes on, read from syntax alone.
 *
 * The import graph says WHICH files import a file. This says WHICH NAMES. The selector uses it only at re-export
 * edges: a barrel that merely passes `a` through does not change when `b` of the same source changes. Everything
 * else stays file-level, so a name this module cannot attribute (a namespace, a side-effect import, a dynamic
 * import, a `require`, `export *`) is reported as every name.
 *
 * @pattern Adapter — over the TypeScript compiler's syntax tree (`createSourceFile`, no Program, no type check)
 */
import ts from 'typescript';

/** A set of names of the source module, or every name. */
export type Names = ReadonlySet<string> | 'all';

export interface SpecifierBinding {
    /** Names taken into a local binding: imports, `require`, dynamic `import()`. Absent when the module only re-exports. */
    readonly uses?: Names;
    /** `export { a as b } from`: the source name to the names it is exported under, or `'all'` for `export *`. */
    readonly reexports?: ReadonlyMap<string, readonly string[]> | 'all';
}

export interface ModuleBindings {
    /** The raw specifier, as written, to what the module does with it. */
    readonly bySpecifier: ReadonlyMap<string, SpecifierBinding>;
    /** Whether the module runs code of its own when loaded (a top-level expression statement), apart from declaring. */
    readonly topLevelEffects: boolean;
}

const KIND_BY_EXTENSION: Readonly<Record<string, ts.ScriptKind>> = {
    '.tsx': ts.ScriptKind.TSX,
    '.jsx': ts.ScriptKind.JSX,
    '.js': ts.ScriptKind.JS,
    '.mjs': ts.ScriptKind.JS,
    '.cjs': ts.ScriptKind.JS,
    '.ts': ts.ScriptKind.TS,
    '.mts': ts.ScriptKind.TS,
    '.cts': ts.ScriptKind.TS,
};

const scriptKindOf = (fileName: string): ts.ScriptKind =>
    KIND_BY_EXTENSION[fileName.slice(fileName.lastIndexOf('.'))] ?? ts.ScriptKind.TSX;

const joinNames = (left: Names | undefined, right: Names): Names =>
    left === 'all' || right === 'all' ? 'all' : new Set([...(left ?? []), ...right]);

/**
 * Reads the bindings of one module.
 *
 * @param source - The module's text.
 * @param fileName - Its name, for the dialect (`.tsx`, `.js`, ...).
 * @returns The bindings.
 */
export function parseBindings(source: string, fileName: string): ModuleBindings {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, scriptKindOf(fileName));
    const uses = new Map<string, Names>();
    const reexports = new Map<string, ReadonlyMap<string, readonly string[]> | 'all'>();
    let topLevelEffects = false;

    const recordUse = (specifier: string, names: Names): void => {
        uses.set(specifier, joinNames(uses.get(specifier), names));
    };

    const reexport = (specifier: string, names: ReadonlyMap<string, readonly string[]> | 'all'): void => {
        const before = reexports.get(specifier);

        if (names === 'all' || before === 'all') {
            reexports.set(specifier, 'all');

            return;
        }

        const merged = new Map(before ?? []);

        for (const [from, as] of names) {
            merged.set(from, [...new Set([...(merged.get(from) ?? []), ...as])]);
        }

        reexports.set(specifier, merged);
    };

    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            recordUse(node.moduleSpecifier.text, importedNames(node.importClause));
        } else if (
            ts.isImportEqualsDeclaration(node) &&
            ts.isExternalModuleReference(node.moduleReference) &&
            ts.isStringLiteral(node.moduleReference.expression)
        ) {
            recordUse(node.moduleReference.expression.text, 'all');
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            reexport(node.moduleSpecifier.text, reexportedNames(node.exportClause));
        } else if (ts.isCallExpression(node) && isLoadCall(node)) {
            const [argument] = node.arguments;

            if (argument !== undefined && ts.isStringLiteralLike(argument)) {
                recordUse(argument.text, 'all');
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    for (const statement of file.statements) {
        if (ts.isExpressionStatement(statement) && !ts.isStringLiteral(statement.expression)) {
            topLevelEffects = true;
        }
    }

    const specifiers = new Set([...uses.keys(), ...reexports.keys()]);

    return {
        bySpecifier: new Map(
            [...specifiers].map((specifier) => {
                const used = uses.get(specifier);
                const passed = reexports.get(specifier);

                return [
                    specifier,
                    {
                        ...(used === undefined ? {} : { uses: used }),
                        ...(passed === undefined ? {} : { reexports: passed }),
                    },
                ] as const;
            }),
        ),
        topLevelEffects,
    };
}

const isLoadCall = (call: ts.CallExpression): boolean =>
    call.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(call.expression) && call.expression.text === 'require');

/** The names an import clause takes. A bare `import 'x'` has no clause and takes the module for its effects. */
function importedNames(clause: ts.ImportClause | undefined): Names {
    if (clause === undefined) {
        return 'all';
    }

    const names = new Set<string>();

    if (clause.name !== undefined) {
        names.add('default');
    }

    const bindings = clause.namedBindings;

    if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        return 'all';
    }

    for (const element of bindings?.elements ?? []) {
        names.add((element.propertyName ?? element.name).text);
    }

    return names;
}

/** What an `export ... from` passes through. */
function reexportedNames(clause: ts.NamedExportBindings | undefined): ReadonlyMap<string, readonly string[]> | 'all' {
    if (clause === undefined || ts.isNamespaceExport(clause)) {
        return 'all';
    }

    const names = new Map<string, string[]>();

    for (const element of clause.elements) {
        const from = (element.propertyName ?? element.name).text;

        names.set(from, [...(names.get(from) ?? []), element.name.text]);
    }

    return names;
}
