/**
 * THE IMPORT RESTRICTION — the load-bearing safety property of the whole schema-package seam
 * (`docs/CODING_STANDARDS.md` §15.2), factored out so every service enforces ONE definition of it.
 *
 * A `src/**\/*.schema.ts` file is AUTHORED in its service and then COPIED verbatim into the generated leaf
 * package `@kitchensink/schema-<service>`, which web and mobile both depend on. That copy is what makes the
 * restriction necessary rather than stylistic: a `*.schema.ts` that reaches into the service has two failure
 * modes, and both are severe.
 *
 *  1. **The copy does not resolve.** `import type { FoodStatus } from './dao/index.js'` has no meaning inside
 *     the schema package — the path does not exist there — so the generated package fails to compile, or
 *     (worse, if the specifier happens to resolve to something else) compiles against a different type.
 *  2. **The server graph is dragged into the clients.** A single import of a drizzle schema, a Nest symbol,
 *     or a DAO module transitively pulls `drizzle-orm`/`@nestjs/*`/`pg`/`aws-sdk` into `@commise/web` and
 *     `@commise/mobile`. On mobile that is a bundle that cannot even build; the failure surfaces far from
 *     its cause.
 *
 * This is NOT hypothetical. Before this seam existed, food's `src/foods/foods.types.ts` took its WIRE
 * `FoodStatus` from `./dao/index.js` (a drizzle enum) and identity's response DTOs were `class-validator`
 * classes; both are exactly this leak in shipped code. Treat each one as a modelling question about who owns
 * the shape — not as something to silently rewrite.
 *
 * DESIGN PATTERN: Specification module over ONE parser. {@link collectModuleReferences} finds every way a
 * module is pulled in; {@link isAllowedSpecifier} decides whether a specifier is admissible;
 * {@link findViolations} and {@link findUnpublishedSiblingImports} are the two specifications over the same
 * collected set, so neither can drift into seeing a different set of imports than the other. All are pure and
 * take the allowlist / published set as a PARAMETER, so a service that may compose an audited domain leaf and a
 * service restricted to bare zod share one implementation instead of two that can drift.
 *
 * Parsing uses the TypeScript compiler's own parser rather than a regular expression. A regex over source
 * text cannot tell an import from the word "import" inside a comment or a string literal, and it silently
 * misses `export ... from`, `import()`, `require()`, a template-literal specifier, a triple-slash reference and
 * side-effect imports — every one of which is a real way to pull a module in.
 */
import ts from 'typescript';

/** One entry on a service's import allowlist: the specifier, and the reason it is safe to admit. */
export interface AllowedPackageImport {
    /** The exact module specifier permitted — matched by equality, never by prefix. */
    readonly specifier: string;
    /**
     * Why this entry is safe. Required, and required to be substantive: the admission test is that the
     * candidate is itself a leaf whose transitive runtime dependencies are safe for a React Native bundle,
     * and the next reader has to be able to check that claim without archaeology.
     */
    readonly why: string;
}

/**
 * Sibling schema modules: `./<name>.schema.js`, the NodeNext spelling of a co-located `*.schema.ts`.
 *
 * The capture group is the flat MODULE NAME the specifier resolves to in the generated package
 * (`./foods.schema.js` → `foods.schema`), which is what {@link findUnpublishedSiblingImports} matches against
 * the set actually published.
 */
const SIBLING_SCHEMA_PATTERN = /^\.\/([a-z0-9][a-z0-9-]*\.schema)\.js$/u;

/**
 * Whether a `*.schema.ts` file may import the given module specifier.
 *
 * Sibling schema imports are restricted to the FLAT `./x.schema.js` form on purpose. Generation flattens
 * every authored schema into one directory in the leaf package, so a deep relative specifier
 * (`../foods/foods.schema.js`) would not resolve after the copy even though it resolves here.
 *
 * Package specifiers match by EQUALITY, never by prefix: `zod/v4` and `@kitchensink/recipe-core/x` are
 * different modules with different transitive dependencies than the entries that name them.
 *
 * @param specifier - The module specifier exactly as written in the import.
 * @param allowed - The service's allowlist.
 * @returns True when the specifier is permitted inside a `*.schema.ts` file. Pure.
 */
export function isAllowedSpecifier(specifier: string, allowed: readonly AllowedPackageImport[]): boolean {
    if (allowed.some((entry) => entry.specifier === specifier)) {
        return true;
    }

    return SIBLING_SCHEMA_PATTERN.test(specifier);
}

/**
 * The flat module name a sibling schema specifier resolves to in the generated package.
 *
 * @param specifier - The module specifier exactly as written in the import.
 * @returns `foods.schema` for `./foods.schema.js`; `undefined` when the specifier is not a flat sibling schema
 *   specifier at all. Pure.
 */
export function siblingModuleName(specifier: string): string | undefined {
    return SIBLING_SCHEMA_PATTERN.exec(specifier)?.[1];
}

/**
 * How a module reference was written. Named in the failure message, because the FIX differs: a static import is
 * deleted, a `require()` is a file that should not have been CommonJS in the first place, and a computed
 * specifier has to become a literal before anything can check it.
 */
export type ModuleReferenceKind =
    | 'import'
    | 'export'
    | 'dynamic-import'
    | 'require'
    | 'type-reference'
    | 'path-reference';

/** One module reference found in a source file, whether or not it is permitted. */
export interface ModuleReference {
    /** The specifier text when statically known; otherwise the raw source text of the expression. */
    readonly specifier: string;
    /**
     * Whether {@link specifier} is the module's actual name. FALSE for a computed specifier
     * (`import('dr' + 'izzle-orm')`, `import(NAME)`, an interpolated template) — which is exactly why such a
     * reference is a violation rather than something to look up in the allowlist.
     */
    readonly literal: boolean;
    /** The imported binding names, when the reference names any; empty otherwise. */
    readonly symbols: readonly string[];
    /** 1-based line number. */
    readonly line: number;
    /** How the reference was written. */
    readonly kind: ModuleReferenceKind;
    /** Character offset of the reference, used only to keep results in source order. */
    readonly position: number;
}

/** One breach of the import restriction, carrying enough detail to fix it without opening the file. */
export interface SchemaImportViolation {
    /** The offending file, as the caller identified it. */
    readonly file: string;
    /** The module specifier that is not permitted, or the raw expression text when it is computed. */
    readonly specifier: string;
    /** The imported binding names, when the import names any; empty for `import './x.js'`. */
    readonly symbols: readonly string[];
    /** 1-based line number of the offending statement. */
    readonly line: number;
    /** How the module was pulled in. */
    readonly kind: ModuleReferenceKind;
    /** False when the specifier is computed rather than written as a literal. */
    readonly literal: boolean;
}

/**
 * Collect the imported binding names from an import or export declaration's clause.
 *
 * @param node - The declaration to inspect.
 * @returns The named bindings, the default/namespace alias, or `[]` for a bare side-effect import. Pure.
 */
function bindingNames(node: ts.ImportDeclaration | ts.ExportDeclaration): string[] {
    if (ts.isExportDeclaration(node)) {
        const clause = node.exportClause;

        if (clause !== undefined && ts.isNamedExports(clause)) {
            return clause.elements.map((element) => element.name.text);
        }

        // `export * from '...'` / `export * as ns from '...'` name no individual bindings.
        return [];
    }

    const clause = node.importClause;

    if (clause === undefined) {
        return [];
    }

    const names: string[] = [];

    if (clause.name !== undefined) {
        names.push(clause.name.text);
    }

    if (clause.namedBindings !== undefined) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
            names.push(clause.namedBindings.name.text);
        } else {
            names.push(...clause.namedBindings.elements.map((element) => element.name.text));
        }
    }

    return names;
}

/**
 * Whether a call expression is a CommonJS module resolution — `require(...)` or `require.resolve(...)`.
 *
 * @param node - The call expression to classify.
 * @returns True for either spelling. Pure.
 */
function isRequireCall(node: ts.CallExpression): boolean {
    if (ts.isIdentifier(node.expression)) {
        return node.expression.text === 'require';
    }

    return (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'require' &&
        node.expression.name.text === 'resolve'
    );
}

/**
 * The statically-known text of a specifier expression.
 *
 * A NO-SUBSTITUTION template literal (`` `zod` ``) is as static as a quoted string, and metro and webpack both
 * resolve it — which is precisely why it cannot be skipped. A template WITH substitutions is not static and is
 * reported as a computed specifier instead.
 *
 * @param node - The specifier expression.
 * @returns The module name, or `undefined` when the expression is computed. Pure.
 */
function staticSpecifier(node: ts.Node): string | undefined {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        return node.text;
    }

    return undefined;
}

/**
 * Collect EVERY module reference in a source file, permitted or not.
 *
 * This is the single parser behind both specifications below, so neither can drift into seeing a different set
 * of imports than the other.
 *
 * ── EVERY WAY A MODULE CAN BE PULLED IN, AND WHY EACH ONE COUNTS ──
 *
 *  - `import ... from` / a bare side-effect `import` — the ordinary cases.
 *  - `export ... from` — a re-export is an import plus a re-publication, and leaks just as effectively.
 *  - `import(...)` — a dynamic import is a dependency; bundlers resolve a literal one statically.
 *  - `require(...)` / `require.resolve(...)` — ⚠️ this was previously skipped on the grounds that "these files
 *    are ESM". That is true of the SERVICE runtime and FALSE where it matters: the copy in the leaf package is
 *    bundled by metro and webpack, and both statically resolve a `require()` and pull the module into the
 *    bundle. Reproduced: `require('drizzle-orm')` passed the guard.
 *  - `/// <reference types="..." />` and `/// <reference path="..." />` — a triple-slash reference pulls
 *    declarations into the compilation, so in the leaf package it either does not resolve (failure mode 1) or
 *    resolves to something else. `/// <reference lib="..." />` is deliberately NOT reported: it names a
 *    TypeScript library, not a module, so it cannot fail to resolve after the copy.
 *
 * `import type` is treated EXACTLY like a value import, deliberately. It is tempting to allow, since it erases
 * at runtime and so cannot drag a bundle in — but it still breaks failure mode 1: the copied file would not
 * compile in the leaf package, where the path does not exist.
 *
 * @param file - Path used only to name the source file for the parser.
 * @param source - The file's TypeScript source text.
 * @returns Every reference found, in source order. Pure.
 */
export function collectModuleReferences(file: string, source: string): ModuleReference[] {
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const references: Omit<ModuleReference, 'line'>[] = [];

    const add = (
        specifier: string,
        literal: boolean,
        symbols: readonly string[],
        kind: ModuleReferenceKind,
        position: number,
    ): void => {
        references.push({ specifier, literal, symbols, kind, position });
    };

    const addCallArgument = (node: ts.CallExpression, kind: ModuleReferenceKind): void => {
        const [argument] = node.arguments;

        if (argument === undefined) {
            return;
        }

        const specifier = staticSpecifier(argument);

        add(specifier ?? argument.getText(parsed), specifier !== undefined, [], kind, node.getStart(parsed));
    };

    for (const directive of parsed.typeReferenceDirectives) {
        add(directive.fileName, true, [], 'type-reference', directive.pos);
    }

    for (const directive of parsed.referencedFiles) {
        add(directive.fileName, true, [], 'path-reference', directive.pos);
    }

    const visit = (node: ts.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
            const specifier = staticSpecifier(node.moduleSpecifier);

            add(
                specifier ?? node.moduleSpecifier.getText(parsed),
                specifier !== undefined,
                bindingNames(node),
                ts.isImportDeclaration(node) ? 'import' : 'export',
                node.getStart(parsed),
            );
        }

        if (ts.isCallExpression(node)) {
            // The `isCallExpression` guard is what keeps `import.meta` (a MetaProperty, not a call) out of here.
            if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
                addCallArgument(node, 'dynamic-import');
            } else if (isRequireCall(node)) {
                addCallArgument(node, 'require');
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(parsed);

    return references
        .sort((left, right) => left.position - right.position)
        .map((reference) => ({
            ...reference,
            line: parsed.getLineAndCharacterOfPosition(reference.position).line + 1,
        }));
}

/**
 * Find every module reference in a `*.schema.ts` source that the restriction forbids.
 *
 * A COMPUTED specifier is a violation in its own right, not something to ignore. The guard's job is to prove
 * that nothing outside the allowlist is reachable, and it cannot prove that about `import(NAME)` or
 * `import('dr' + 'izzle-orm')` — so the honest answer is to refuse it and make the author write a literal.
 * (Reproduced: both forms passed the previous implementation, which only looked at `ts.isStringLiteral`.)
 *
 * @param file - Path used in the returned violations (for the operator-facing message).
 * @param source - The file's TypeScript source text.
 * @param allowed - The service's allowlist.
 * @returns Every violation found, in source order. Empty when the file is compliant. Pure.
 */
export function findViolations(
    file: string,
    source: string,
    allowed: readonly AllowedPackageImport[],
): SchemaImportViolation[] {
    return collectModuleReferences(file, source)
        .filter((reference) => !reference.literal || !isAllowedSpecifier(reference.specifier, allowed))
        .map((reference) => ({
            file,
            specifier: reference.specifier,
            symbols: reference.symbols,
            line: reference.line,
            kind: reference.kind,
            literal: reference.literal,
        }));
}

/** A sibling schema import that names a module the generated package will NOT contain. */
export interface UnpublishedSiblingImport {
    /** The importing file, as the caller identified it. */
    readonly file: string;
    /** The specifier as written, e.g. `./env.schema.js`. */
    readonly specifier: string;
    /** The flat module name it would resolve to, e.g. `env.schema`. */
    readonly moduleName: string;
    /** 1-based line number of the import. */
    readonly line: number;
}

/**
 * Find sibling schema imports that would NOT resolve in the generated package.
 *
 * {@link isAllowedSpecifier} answers "is this specifier SHAPED like a flat sibling schema module", which is a
 * different question from "is that module actually published". The gap between the two is a real, reachable
 * hole: an authored wire schema may import `./env.schema.js`, and every service EXCLUDES its
 * `src/config/env.schema.ts` from publication — so generation would succeed and the leaf package would ship an
 * import of a file that is not there. Same for a sibling that was renamed or deleted.
 *
 * @param file - Path used in the returned results.
 * @param source - The file's TypeScript source text.
 * @param publishedModuleNames - The flat module names the generated package will contain (`foods.schema`, …).
 * @returns Every sibling import that does not resolve, in source order. Pure.
 */
export function findUnpublishedSiblingImports(
    file: string,
    source: string,
    publishedModuleNames: readonly string[],
): UnpublishedSiblingImport[] {
    const published = new Set(publishedModuleNames);

    return collectModuleReferences(file, source).flatMap((reference) => {
        if (!reference.literal) {
            return [];
        }

        const moduleName = siblingModuleName(reference.specifier);

        if (moduleName === undefined || published.has(moduleName)) {
            return [];
        }

        return [{ file, specifier: reference.specifier, moduleName, line: reference.line }];
    });
}

/**
 * Render unresolved sibling imports as an operator-facing failure message.
 *
 * @param unresolved - The unresolved sibling imports. Must be non-empty to be meaningful.
 * @param context - The destination package name and the module names that ARE published.
 * @returns A multi-line message suitable for throwing. Pure.
 */
export function formatUnpublishedSiblingImports(
    unresolved: readonly UnpublishedSiblingImport[],
    context: { readonly schemaPackageName: string; readonly publishedModuleNames: readonly string[] },
): string {
    return [
        `${unresolved.length} sibling schema import(s) name a module that is NOT published:`,
        ...unresolved.map(
            (entry) => `  ${entry.file}:${entry.line} imports '${entry.specifier}' → '${entry.moduleName}'`,
        ),
        '',
        `${context.schemaPackageName} will contain: ${[...context.publishedModuleNames].sort().join(', ')}.`,
        'The specifier is SHAPED like a flat sibling schema module, so the import restriction admits it — but',
        'the module is not in the generated package (excluded from the wire contract? renamed? deleted?), so',
        'the copy would not resolve. Publish the module, or move the shape into a schema that is published.',
    ].join('\n');
}

/** What {@link formatViolations} needs to explain the rule in the service's own terms. */
export interface ViolationMessageContext {
    /** The service's allowlist, rendered into the message so the reader learns what IS permitted. */
    readonly allowed: readonly AllowedPackageImport[];
    /** The generated leaf package the offending file is copied into, e.g. `@kitchensink/schema-food`. */
    readonly schemaPackageName: string;
}

/**
 * Render violations as an operator-facing failure message.
 *
 * Names the file, the line, the specifier AND the symbols, because the fix is a modelling decision: the
 * author has to decide where that shape should actually live, and a bare "illegal import" tells them
 * nothing about what they were reaching for.
 *
 * @param violations - The violations to describe. Must be non-empty to be meaningful.
 * @param context - The service's allowlist and destination package name.
 * @returns A multi-line message suitable for throwing or printing. Pure.
 */
export function formatViolations(
    violations: readonly SchemaImportViolation[],
    context: ViolationMessageContext,
): string {
    const lines = violations.map((violation) => {
        const symbols = violation.symbols.length > 0 ? ` (${violation.symbols.join(', ')})` : '';
        const location = `  ${violation.file}:${violation.line}`;

        if (!violation.literal) {
            return (
                `${location} imports a COMPUTED specifier \`${violation.specifier}\` — nothing can prove what ` +
                'module that resolves to, so it is refused. Write a literal.'
            );
        }

        return `${location} imports '${violation.specifier}'${symbols}`;
    });

    const allowed = context.allowed.map((entry) => `'${entry.specifier}'`).join(', ');

    return [
        `${violations.length} forbidden import(s) in authored schema file(s):`,
        ...lines,
        '',
        `A *.schema.ts file is COPIED into ${context.schemaPackageName}, which web and mobile depend on.`,
        `It may import only ${allowed}, or a flat sibling './<name>.schema.js'.`,
        'Move the shape you are reaching for into a *.schema.ts file. Do not widen the allowlist without',
        'checking the candidate is a leaf that is safe to bundle into a React Native app.',
    ].join('\n');
}
