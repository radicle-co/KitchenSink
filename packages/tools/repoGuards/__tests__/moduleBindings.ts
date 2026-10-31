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
    /** The local names of namespace imports (`import * as RN`). */
    readonly namespaces: ReadonlySet<string>;
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
    const namespaces = new Set<string>();
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
        }
    }

    return { locals, namespaces, imported };
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

/** Whether a specifier is `react-native`. */
export const isReactNative = (specifier: string): boolean => specifier === 'react-native';
