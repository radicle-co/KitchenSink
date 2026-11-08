/**
 * The local names a module gives the VALUES it imports from a set of modules: the one reading of import bindings under
 * the native and Tamagui guards. Each guard had grown its own copy of this loop (the type-only check, the namespace
 * import, the rename), and `appSources.ts` records why that is a defect: copies of a reader drift, and a guard that
 * misreads its imports passes vacuously.
 *
 * A type-only import, or a type-only name inside one, binds nothing a program can run, so it binds nothing here.
 */
import ts from 'typescript';

/** What a module binds from the matched modules. */
export interface ModuleBindings {
    /** Each imported export name, and the local names it is bound to. */
    readonly locals: ReadonlyMap<string, ReadonlySet<string>>;
    /** Each imported export name, and the import specifiers that bind it, so a finding can name its line. */
    readonly specifiers: ReadonlyMap<string, readonly ts.ImportSpecifier[]>;
    /** The local names of namespace imports (`import * as RN`). */
    readonly namespaces: ReadonlySet<string>;
    /** Each default import's local name and its node (`import T from …`). */
    readonly defaults: ReadonlyMap<string, ts.Identifier>;
    /** Whether the module has any value import of a matched module. */
    readonly imported: boolean;
}

/**
 * Whether an import declaration imports values, not only types. Pure.
 *
 * @param statement - The declaration.
 */
export function importsValues(statement: ts.ImportDeclaration): boolean {
    const clause = statement.importClause;

    return clause !== undefined && clause.phaseModifier !== ts.SyntaxKind.TypeKeyword;
}

/**
 * Every value import of the matched modules in one file. Pure.
 *
 * @param file - The parsed module.
 * @param matches - Which module specifiers to read.
 * @returns The bindings.
 */
export function valueBindingsOf(file: ts.SourceFile, matches: (specifier: string) => boolean): ModuleBindings {
    const locals = new Map<string, Set<string>>();
    const specifiers = new Map<string, ts.ImportSpecifier[]>();
    const namespaces = new Set<string>();
    const defaults = new Map<string, ts.Identifier>();
    let imported = false;

    for (const statement of file.statements) {
        if (
            !ts.isImportDeclaration(statement) ||
            !ts.isStringLiteral(statement.moduleSpecifier) ||
            !matches(statement.moduleSpecifier.text) ||
            !importsValues(statement)
        ) {
            continue;
        }

        imported = true;

        if (statement.importClause?.name !== undefined) {
            defaults.set(statement.importClause.name.text, statement.importClause.name);
        }

        const bindings = statement.importClause?.namedBindings;

        if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
            namespaces.add(bindings.name.text);
            continue;
        }

        for (const element of bindings?.elements ?? []) {
            if (element.isTypeOnly) {
                continue;
            }

            const name = (element.propertyName ?? element.name).text;
            const bound = locals.get(name) ?? new Set<string>();

            bound.add(element.name.text);
            locals.set(name, bound);
            specifiers.set(name, [...(specifiers.get(name) ?? []), element]);
        }
    }

    return { locals, specifiers, namespaces, defaults, imported };
}

/**
 * The local names one export is bound to. Pure.
 *
 * @param bindings - A module's bindings.
 * @param name - The export name.
 */
export function localsOf(bindings: ModuleBindings, name: string): ReadonlySet<string> {
    return bindings.locals.get(name) ?? new Set();
}

/**
 * The import specifiers that bind one export. Pure.
 *
 * @param bindings - A module's bindings.
 * @param name - The export name.
 */
export function specifiersOf(bindings: ModuleBindings, name: string): readonly ts.ImportSpecifier[] {
    return bindings.specifiers.get(name) ?? [];
}

/** What a module re-exports, as values, from the matched modules. */
export interface ReExports {
    /** Each name re-exported (`export { View, Text as T } from …`). */
    readonly named: readonly ts.ExportSpecifier[];
    /** Each `export * from …` and `export * as NS from …`. */
    readonly everything: readonly ts.ExportDeclaration[];
}

/**
 * Every value re-export of the matched modules in one file. A type-only re-export, or a type-only name inside one,
 * re-exports nothing a program can run. Pure.
 *
 * @param file - The parsed module.
 * @param matches - Which module specifiers to read.
 * @returns The re-exports.
 */
export function reExportsOf(file: ts.SourceFile, matches: (specifier: string) => boolean): ReExports {
    const declarations = file.statements.filter(
        (statement): statement is ts.ExportDeclaration =>
            ts.isExportDeclaration(statement) &&
            !statement.isTypeOnly &&
            statement.moduleSpecifier !== undefined &&
            ts.isStringLiteral(statement.moduleSpecifier) &&
            matches(statement.moduleSpecifier.text),
    );

    return {
        named: declarations.flatMap((declaration) => {
            const clause = declaration.exportClause;

            return clause !== undefined && ts.isNamedExports(clause)
                ? clause.elements.filter((element) => !element.isTypeOnly)
                : [];
        }),
        everything: declarations.filter(
            (declaration) => declaration.exportClause === undefined || ts.isNamespaceExport(declaration.exportClause),
        ),
    };
}

/** Whether a specifier is `react-native`. */
export const isReactNative = (specifier: string): boolean => specifier === 'react-native';
