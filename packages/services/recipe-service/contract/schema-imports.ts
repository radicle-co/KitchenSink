/**
 * THE IMPORT RESTRICTION — the load-bearing safety property of the whole schema-package seam.
 *
 * `src/**\/*.schema.ts` files are AUTHORED here, in the service, and then COPIED verbatim into the
 * generated leaf package `@kitchensink/schema-recipe`, which web and mobile both depend on. That copy is
 * what makes the restriction necessary rather than stylistic: a `*.schema.ts` that reaches into the service
 * has two failure modes, and both are severe.
 *
 *  1. **The copy does not resolve.** `import type { X } from '../dal/search.dal.js'` has no meaning inside
 *     the schema package — the path does not exist there — so the generated package fails to compile, or
 *     (worse, if the specifier happens to resolve to something else) compiles against a different type.
 *  2. **The server graph is dragged into the clients.** A single import of a drizzle schema, a Nest symbol,
 *     or a DAL module transitively pulls `drizzle-orm`/`@nestjs/*`/`pg`/`aws-sdk` into `@commise/web` and
 *     `@commise/mobile`. On mobile that is a bundle that cannot even build; the failure surfaces far from
 *     its cause.
 *
 * This is NOT a hypothetical. `src/search/dto/search-response.dto.ts` already takes its WIRE type from the
 * data-access layer (`import type { RecipeSearchFacets } from '../dal/search.dal.js'`), which is exactly
 * this leak in shipped code. Expect more of them during migration, and treat each as a modelling question
 * about who owns the shape — not as something to silently rewrite.
 *
 * DESIGN PATTERN: Specification module. `isAllowedSpecifier` is the single predicate; `findViolations` walks
 * a file and reports every breach. Both are pure, so the lint rule, the generator's pre-flight check, and
 * the unit tests all enforce ONE definition of the rule instead of three that can drift.
 *
 * Parsing uses the TypeScript compiler's own parser rather than a regular expression. A regex over source
 * text cannot tell an import from the word "import" inside a comment or a string literal, and it silently
 * misses `export ... from`, `import()` and side-effect imports — every one of which is a real way to pull a
 * module in.
 */
import ts from 'typescript';

/**
 * Module specifiers a `*.schema.ts` file may import, each with the reason it is safe.
 *
 * This list is DATA, and deliberately short, so widening it is a reviewed decision rather than an
 * incidental edit. Before adding an entry, verify the candidate is a leaf whose own transitive runtime
 * dependencies are safe for a React Native bundle — that property, not convenience, is the admission test.
 */
export const ALLOWED_PACKAGE_IMPORTS: readonly { readonly specifier: string; readonly why: string }[] = [
    {
        specifier: 'zod',
        why: 'The schema language itself. The generated package depends on it directly.',
    },
    {
        // RECONCILIATION, flagged for the owner: the locked rules say a `*.schema.ts` may import "only zod
        // and other *.schema.ts files", and ALSO say to compose `recipe-core`'s existing zod rather than
        // author a second schema for a shape it already owns. Those two rules cannot both hold literally —
        // composing recipe-core requires importing it. This entry resolves the conflict in favour of the
        // no-duplication rule, which is the one with teeth: re-declaring `Recipe`/`RecipeDetail`/
        // `PaginatedResponse` would manufacture precisely the drift this seam exists to prevent.
        //
        // It is safe on the same test every other entry must pass: `@kitchensink/recipe-core` is itself a
        // leaf whose ONLY runtime dependency is `zod` (verified in its package.json), so admitting it pulls
        // no server graph into web or mobile.
        specifier: '@kitchensink/recipe-core',
        why: 'Zod-only leaf that already owns the recipe DOMAIN schemas; composed, never re-declared.',
    },
];

/** Sibling schema modules: `./<name>.schema.js`, the NodeNext spelling of a co-located `*.schema.ts`. */
const SIBLING_SCHEMA_PATTERN = /^\.\/[a-z0-9][a-z0-9-]*\.schema\.js$/u;

/**
 * Whether a `*.schema.ts` file may import the given module specifier.
 *
 * Sibling schema imports are restricted to the FLAT `./x.schema.js` form on purpose. Generation flattens
 * every authored schema into one directory in the leaf package, so a deep relative specifier
 * (`../photos/photos.schema.js`) would not resolve after the copy even though it resolves here.
 *
 * @param specifier - The module specifier exactly as written in the import.
 * @returns True when the specifier is permitted inside a `*.schema.ts` file. Pure.
 */
export function isAllowedSpecifier(specifier: string): boolean {
    if (ALLOWED_PACKAGE_IMPORTS.some((allowed) => allowed.specifier === specifier)) {
        return true;
    }

    return SIBLING_SCHEMA_PATTERN.test(specifier);
}

/** One breach of the import restriction, carrying enough detail to fix it without opening the file. */
export interface SchemaImportViolation {
    /** The offending file, as the caller identified it. */
    readonly file: string;
    /** The module specifier that is not permitted. */
    readonly specifier: string;
    /** The imported binding names, when the import names any; empty for `import './x.js'`. */
    readonly symbols: readonly string[];
    /** 1-based line number of the offending statement. */
    readonly line: number;
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
 * Find every import in a `*.schema.ts` source that the restriction forbids.
 *
 * Covers all four ways a module can be pulled in — `import ... from`, a bare side-effect `import`,
 * `export ... from` (a re-export is an import plus a re-publication, and would leak just as effectively),
 * and a dynamic `import()` call. A `require()` is not considered: these files are ESM (`"type": "module"`).
 *
 * `import type` is treated EXACTLY like a value import, deliberately. It is tempting to allow, since it
 * erases at runtime and so cannot drag a bundle in — but it still breaks failure mode 1: the copied file
 * would not compile in the leaf package, where the path does not exist. `search-response.dto.ts`'s DAL
 * import is `import type`, and it is the leak this rule exists to catch.
 *
 * @param file - Path used in the returned violations (for the operator-facing message).
 * @param source - The file's TypeScript source text.
 * @returns Every violation found, in source order. Empty when the file is compliant. Pure.
 */
export function findViolations(file: string, source: string): SchemaImportViolation[] {
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const violations: SchemaImportViolation[] = [];

    const record = (specifier: string, symbols: readonly string[], position: number): void => {
        if (isAllowedSpecifier(specifier)) {
            return;
        }

        violations.push({
            file,
            specifier,
            symbols,
            line: parsed.getLineAndCharacterOfPosition(position).line + 1,
        });
    };

    const visit = (node: ts.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
            if (ts.isStringLiteral(node.moduleSpecifier)) {
                record(node.moduleSpecifier.text, bindingNames(node), node.getStart(parsed));
            }
        }

        // A dynamic `import('...')` with a literal specifier is as much a dependency as a static one.
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const [argument] = node.arguments;

            if (argument !== undefined && ts.isStringLiteral(argument)) {
                record(argument.text, [], node.getStart(parsed));
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(parsed);

    return violations;
}

/**
 * Render violations as an operator-facing failure message.
 *
 * Names the file, the line, the specifier AND the symbols, because the fix is a modelling decision: the
 * author has to decide where that shape should actually live, and a bare "illegal import" tells them
 * nothing about what they were reaching for.
 *
 * @param violations - The violations to describe. Must be non-empty to be meaningful.
 * @returns A multi-line message suitable for throwing or printing. Pure.
 */
export function formatViolations(violations: readonly SchemaImportViolation[]): string {
    const lines = violations.map((violation) => {
        const symbols = violation.symbols.length > 0 ? ` (${violation.symbols.join(', ')})` : '';

        return `  ${violation.file}:${violation.line} imports '${violation.specifier}'${symbols}`;
    });

    const allowed = ALLOWED_PACKAGE_IMPORTS.map((entry) => `'${entry.specifier}'`).join(', ');

    return [
        `${violations.length} forbidden import(s) in authored schema file(s):`,
        ...lines,
        '',
        `A *.schema.ts file is COPIED into @kitchensink/schema-recipe, which web and mobile depend on.`,
        `It may import only ${allowed}, or a flat sibling './<name>.schema.js'.`,
        `Move the shape you are reaching for into a *.schema.ts file, or into @kitchensink/recipe-core if`,
        `it is a domain entity. Do not widen ALLOWED_PACKAGE_IMPORTS without checking the candidate is a`,
        `leaf that is safe to bundle into a React Native app.`,
    ].join('\n');
}
