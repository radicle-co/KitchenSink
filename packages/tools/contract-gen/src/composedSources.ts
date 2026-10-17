/**
 * COMPOSED-LEAF REACHABILITY — the sources a service's wire contract is built FROM but does not itself contain.
 *
 * ── THE DEFECT THIS CLOSES (measured 2026-08-12) ─────────────────────────────────────────────────────────────
 *
 * `CONTRACT_HASH` (drift layer 3, ADR-0014 §5) hashed only each authored `*.schema.ts` file's own path and text.
 * Eight of the recipe service's ten authored schemas COMPOSE their shapes from `@kitchensink/recipe-core` — the
 * allowlist admits it precisely so `Recipe`/`RecipeDetail`/`Ingredient` are never re-declared. So changing
 * `recipeDetailSchema`'s definition in that package changed the wire shape while every authored source stayed
 * byte-identical, and the hash did not move. Reproduced: adding a required property to `recipeDetailSchema` moved
 * `openapi.yaml` by three lines and left both `CONTRACT_HASH` stamps untouched; a change with no JSON-Schema
 * projection at all (`.catch()` on a field) moved NOTHING, so drift layer 2 was blind to it as well. A deployed
 * service and a pinned mobile binary could therefore disagree about `Recipe` while both stamps agreed and the
 * client's skew guard reported fine — the guarantee was false, not merely weak.
 *
 * ── WHY REACHABILITY RATHER THAN THE WHOLE PACKAGE ───────────────────────────────────────────────────────────
 *
 * Hashing all of `recipe-core` would be one line of code and is the wrong answer. Measured on the real tree: the
 * authored schemas import 39 symbols, and those symbols are declared in **2 of the package's 12 barrel-reachable
 * modules** (1,564 of 2,729 lines). The other ten are `cdnInvalidation`, `serviceErasureToken`,
 * `recipeAccessPolicy`, `recipeDatabaseName`, `ids`, `viewer`, `units`, `nutrition`, `accountErasure` and
 * `recipeObjectKeys` — operational and policy modules that churn for reasons that cannot reach the wire. A hash
 * that moved when a CDN-invalidation helper was edited would train every reader to regenerate without looking,
 * which is how a real skew gets waved through. The hash must move for wire reasons and only wire reasons.
 *
 * ── THE TRAVERSAL RULE, in full ──────────────────────────────────────────────────────────────────────────────
 *
 * 1. **Any demand on a file puts that file's ENTIRE text in the corpus.** Granularity is the file, matching what
 *    the authored half already does. Symbol-level narrowing decides which files to VISIT, never which parts of a
 *    visited file to hash — so a definition that quietly depends on a neighbouring declaration cannot slip
 *    through.
 * 2. **A file's own `import` declarations are followed** whenever the file enters the corpus, because the text
 *    being hashed means nothing without them. Named bindings narrow to those symbols; a namespace, default or
 *    bare side-effect import names nothing to narrow by and takes the whole target.
 * 3. **`export … from` edges are followed only for DEMANDED symbols.** This is what keeps a barrel from dragging
 *    in its whole package: `recipe-core`'s `index.ts` has no imports and twelve star re-exports, so a demand for
 *    `recipeDetailSchema` descends into `recipe.types.ts` alone.
 * 4. **Transitivity is UNBOUNDED, memoised by file.** No depth limit: a depth limit is an arbitrary cut that
 *    reintroduces this very blindness one level deeper. Cycles terminate because a file is re-visited only when
 *    the demand on it grows.
 * 5. **An unattributable symbol THROWS.** Under-inclusion is the dangerous direction — it restores the silent
 *    false guarantee — so a symbol that no reachable module declares fails the run by name.
 *
 * ── WHAT IS DELIBERATELY NOT FOLLOWED ────────────────────────────────────────────────────────────────────────
 *
 * A dependency is followed only when it is BOTH authored in this repo (its real path contains no `node_modules`
 * segment — a workspace package resolves through a symlink, so its real path is the package directory) AND real
 * TypeScript source rather than declarations (`.ts`/`.tsx`/`.mts`, never `.d.ts`). The two conditions rule out
 * two different hazards: the first stops an installed package's version-pinned tree entering the corpus, which
 * would make the hash depend on install state rather than on committed source; the second stops a published
 * package that happens to ship sources from doing the same. `zod` fails both and is correctly excluded — its
 * version is a `package-lock.json` concern, not an authored wire shape.
 *
 * An UNRESOLVABLE specifier is skipped rather than refused, which is a deliberate reversal of this module's first
 * draft. Refusing looked like the safe direction until `generate.test.ts` — whose fixture services import `zod`
 * with no `node_modules` in sight — showed the cost: it made fingerprinting depend on a complete install, which it
 * never did before. And it bought nothing, because `tsc` already refuses to compile a service against a specifier
 * that does not resolve, earlier and with a better message. Non-vacuity is asserted instead from the end that
 * knows the expected answer — see the `@throws` note below.
 *
 * Relative specifiers in an AUTHORED schema are skipped: the import restriction limits them to sibling
 * `*.schema.js` modules, every one of which is already in the authored corpus (and
 * `assertSiblingImportsResolve` proves it). This function's guarantee therefore RESTS on
 * `assertNoForbiddenImports` continuing to run first — that is what bounds the set of specifiers reaching
 * here to zod, the allowlist, and published siblings.
 *
 * ── KNOWN LIMITATION, reported rather than hidden ────────────────────────────────────────────────────────────
 *
 * Only static `import`/`export … from` edges are traversed. A `require()` or dynamic `import()` inside a followed
 * package would not be followed. No followed package contains one today (`recipe-core` is `sideEffects: false`
 * with `zod` as its only dependency), and the authored side cannot contain one at all — `findViolations` refuses
 * both. If a followed leaf ever gains one, this is where the gap would be.
 *
 * A purpose-built parse lives here rather than reusing `collectModuleReferences` from `./schemaImports.js`,
 * which answers a different question. That function reports whether a specifier APPEARS, for the import
 * restriction; it deliberately returns a namespace alias as though it were a named binding and reports an
 * import's LOCAL name rather than the exported one. Both are correct for a restriction check and both would be
 * wrong here, where the exported name is what has to be looked up in the target module.
 */
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import ts from 'typescript';

import type { AuthoredSchema } from './authoredSchema.js';

/** One source file, outside the service, that the authored wire contract is composed from. */
export interface ComposedSource {
    /** The owning package's npm name, e.g. `@kitchensink/recipe-core`. */
    readonly packageName: string;
    /** POSIX path relative to that package's root, e.g. `src/recipe.types.ts`. */
    readonly packageRelativePath: string;
    /** The corpus key: {@link packageName} and {@link packageRelativePath} joined. */
    readonly key: string;
    /** Verbatim source text. */
    readonly source: string;
}

/** Options for {@link collectComposedSources}. */
export interface ComposedSourceOptions {
    /** Absolute path of the service package root, against which each schema's `servicePath` is resolved. */
    readonly serviceRoot: string;
}

/** What a file is wanted for: a set of exported names, or everything it exports. */
interface Demand {
    /** True when the whole module is reachable (a namespace import, or a dependency of such a module). */
    readonly whole: boolean;
    /** The exported names demanded of this module. */
    readonly symbols: ReadonlySet<string>;
}

/** One outgoing static edge from a parsed module. */
interface ModuleEdge {
    /** The specifier text. */
    readonly specifier: string;
    /** Exported names wanted from the target; empty when {@link whole}. */
    readonly symbols: readonly string[];
    /** True when the edge names nothing to narrow by and the whole target is reachable. */
    readonly whole: boolean;
}

/** The static export/import surface of one module. */
interface ParsedModule {
    /** Names this module itself declares and exports. */
    readonly localExports: ReadonlySet<string>;
    /** `import` declarations, which are followed whenever the module enters the corpus. */
    readonly imports: readonly ModuleEdge[];
    /** `export { exported as … } from '…'` hops, keyed by the name as re-exported. */
    readonly namedReexports: ReadonlyMap<string, { readonly specifier: string; readonly original: string }>;
    /** `export * from '…'` targets, searched only for demanded names. */
    readonly starReexports: readonly string[];
    /** `export * as ns from '…'` targets, which expose the whole module. */
    readonly namespaceReexports: readonly string[];
}

/** Module resolution matching the repo's `NodeNext`, so this agrees with `tsc` about what an import points at. */
const RESOLUTION_OPTIONS: ts.CompilerOptions = {
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    module: ts.ModuleKind.NodeNext,
};

/** Filesystem host for {@link ts.resolveModuleName}. */
const RESOLUTION_HOST: ts.ModuleResolutionHost = {
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    directoryExists: ts.sys.directoryExists,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
};

/** Extensions that are real TypeScript source. A declaration file describes a build; it is not authored source. */
const SOURCE_EXTENSIONS: readonly string[] = [ts.Extension.Ts, ts.Extension.Tsx, ts.Extension.Mts];

/**
 * The corpus key for a composed source.
 *
 * Package name plus package-relative path, NOT a repo-relative path. Both halves are derivable from the resolved
 * file alone — walk up to the nearest `package.json` and read its `name` — so no repo root has to be computed and
 * no absolute path is ever stripped. That matters beyond tidiness: a path-stripping ratchet in this repo has
 * already broken once on GitHub's doubled `…/KitchenSink/KitchenSink` checkout path, and this key cannot acquire
 * that failure. It also means moving `recipe-core` between `packages/shared/` and `packages/domain/` leaves every
 * key — and therefore the hash — unchanged, which is right, because such a move does not alter the contract.
 *
 * @param packageName - The owning package's npm name.
 * @param packageRelativePath - POSIX path relative to the package root.
 * @returns The corpus key. Pure.
 */
export function composedSourceKey(packageName: string, packageRelativePath: string): string {
    return `${packageName}/${packageRelativePath}`;
}

/**
 * Whether a specifier is relative (and therefore resolved within its own package).
 *
 * @param specifier - The module specifier.
 * @returns True for `./x` and `../x`. Pure.
 */
function isRelativeSpecifier(specifier: string): boolean {
    return specifier.startsWith('./') || specifier.startsWith('../');
}

/**
 * Whether a real path lies inside an installed dependency tree.
 *
 * Segment equality rather than substring containment: a legitimate directory called `my_node_modules_notes`
 * must not be mistaken for one.
 *
 * @param realPath - An absolute, symlink-resolved path.
 * @returns True when any path segment is exactly `node_modules`. Pure.
 */
function isInstalledDependency(realPath: string): boolean {
    return realPath.split(sep).includes('node_modules');
}

/**
 * Collect the exported names, imports and re-export edges of one module.
 *
 * @param file - Path used for diagnostics.
 * @param source - The module's source text.
 * @returns Its static export/import surface. Pure.
 */
function parseModule(file: string, source: string): ParsedModule {
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const localExports = new Set<string>();
    const imports: ModuleEdge[] = [];
    const namedReexports = new Map<string, { specifier: string; original: string }>();
    const starReexports: string[] = [];
    const namespaceReexports: string[] = [];

    const specifierOf = (node: ts.Expression | undefined): string | undefined =>
        node !== undefined && ts.isStringLiteral(node) ? node.text : undefined;

    for (const statement of parsed.statements) {
        if (ts.isImportDeclaration(statement)) {
            const specifier = specifierOf(statement.moduleSpecifier);

            if (specifier === undefined) {
                continue;
            }

            const clause = statement.importClause;
            const bindings = clause?.namedBindings;

            if (clause === undefined || clause.name !== undefined || (bindings && ts.isNamespaceImport(bindings))) {
                // A bare side-effect import, a default import, or `import * as ns` — nothing to narrow by.
                imports.push({ specifier, symbols: [], whole: true });
            }

            if (bindings !== undefined && ts.isNamedImports(bindings)) {
                imports.push({
                    specifier,
                    // The EXPORTED name, which is `propertyName` under an alias — the local name is not what the
                    // target module declares, so narrowing by it would fail to attribute and throw.
                    symbols: bindings.elements.map((element) => (element.propertyName ?? element.name).text),
                    whole: false,
                });
            }

            continue;
        }

        if (ts.isExportDeclaration(statement)) {
            const specifier = specifierOf(statement.moduleSpecifier);
            const clause = statement.exportClause;

            if (specifier === undefined) {
                // `export { a, b }` — a re-export of this module's own bindings.
                if (clause !== undefined && ts.isNamedExports(clause)) {
                    for (const element of clause.elements) {
                        localExports.add(element.name.text);
                    }
                }

                continue;
            }

            if (clause === undefined) {
                starReexports.push(specifier);
            } else if (ts.isNamespaceExport(clause)) {
                namespaceReexports.push(specifier);
                localExports.add(clause.name.text);
            } else {
                for (const element of clause.elements) {
                    namedReexports.set(element.name.text, {
                        specifier,
                        original: (element.propertyName ?? element.name).text,
                    });
                }
            }

            continue;
        }

        if (ts.isExportAssignment(statement)) {
            localExports.add('default');
            continue;
        }

        const exported =
            ts.canHaveModifiers(statement) &&
            (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

        if (!exported) {
            continue;
        }

        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                collectBoundNames(declaration.name, localExports);
            }
        } else if (
            (ts.isFunctionDeclaration(statement) ||
                ts.isClassDeclaration(statement) ||
                ts.isInterfaceDeclaration(statement) ||
                ts.isTypeAliasDeclaration(statement) ||
                ts.isEnumDeclaration(statement) ||
                ts.isModuleDeclaration(statement)) &&
            statement.name !== undefined
        ) {
            localExports.add(ts.isIdentifier(statement.name) ? statement.name.text : statement.name.getText(parsed));
        }
    }

    return { localExports, imports, namedReexports, starReexports, namespaceReexports };
}

/**
 * Add every name a binding pattern introduces.
 *
 * Destructuring is handled because `export const { a, b } = …` is legal and exports both names; missing one would
 * make it unattributable and throw on a legitimate contract.
 *
 * @param name - The binding name or pattern.
 * @param into - Set to add to.
 * @sideEffect Mutates `into`.
 */
function collectBoundNames(name: ts.BindingName, into: Set<string>): void {
    if (ts.isIdentifier(name)) {
        into.add(name.text);

        return;
    }

    for (const element of name.elements) {
        if (ts.isBindingElement(element)) {
            collectBoundNames(element.name, into);
        }
    }
}

/**
 * Collect every composed source the authored wire contract transitively reaches.
 *
 * @param schemas - The authored schemas, as discovered for the service.
 * @param options - The service root the schemas' paths are relative to.
 * @returns The reachable composed sources, deduplicated and sorted by {@link ComposedSource.key} so traversal
 *   order can never affect the hash. EMPTY for a service whose allowlist is zod-only, which is why food's and
 *   identity's fingerprints are unaffected by this mechanism.
 * @throws When an imported symbol cannot be attributed to any reachable module, or when a resolved file belongs
 *   to no package. The first guards THIS module's approximation of the export graph rather than duplicating
 *   `tsc`: an export form the parser does not understand would otherwise leave a real source out of the corpus
 *   silently, and `tsc` cannot catch that because it uses the real checker. An UNRESOLVABLE specifier is by
 *   contrast skipped, because `tsc` already refuses to compile the service at all.
 * @sideEffect Reads the filesystem.
 */
export async function collectComposedSources(
    schemas: readonly AuthoredSchema[],
    options: ComposedSourceOptions,
): Promise<ComposedSource[]> {
    const corpus = new Map<string, ComposedSource>();
    const visited = new Map<string, { whole: boolean; symbols: Set<string> }>();
    const packages = new Map<string, { name: string; root: string }>();
    const work: { file: string; demand: Demand; via: string }[] = [];

    const resolveFollowable = async (specifier: string, from: string): Promise<string | undefined> => {
        const resolved = ts.resolveModuleName(specifier, from, RESOLUTION_OPTIONS, RESOLUTION_HOST).resolvedModule;

        if (resolved === undefined) {
            // NOT followable, and deliberately NOT an error. An unresolvable import is already caught earlier and
            // harder by `tsc`: the service cannot compile against a specifier that does not resolve, so a throw
            // here would only duplicate that gate — while making generation depend on a complete `node_modules`,
            // which it never did before, and breaking on an uninstalled tree with a message about hashing.
            //
            // The corpus is instead kept honest from the other end, where the expected answer is actually known: a
            // service's `contract/__tests__/contract.test.ts` asserts NON-VACUITY by name — recipe's must reach
            // `recipe-core`'s `recipe.types.ts`; food's and identity's must reach nothing while still importing
            // zod. A collector that quietly stopped following imports fails those, which a resolution error here
            // could never express.
            return undefined;
        }

        const real = await realpath(resolved.resolvedFileName);

        if (isInstalledDependency(real) || !SOURCE_EXTENSIONS.includes(resolved.extension)) {
            // An installed dependency, or a published package's declarations: version-pinned rather than authored
            // here, and deliberately outside the corpus.
            return undefined;
        }

        return real;
    };

    const enqueue = (file: string, demand: Demand, via: string): void => {
        work.push({ file, demand, via });
    };

    const followEdge = async (edge: ModuleEdge, from: string, via: string): Promise<void> => {
        const target = await resolveFollowable(edge.specifier, from);

        if (target === undefined) {
            return;
        }

        enqueue(target, { whole: edge.whole, symbols: new Set(edge.symbols) }, via);
    };

    // ── Seed: the authored schemas' own package imports ──────────────────────────────────────────────────────
    for (const schema of schemas) {
        const containing = join(options.serviceRoot, schema.servicePath);
        const parsed = parseModule(containing, schema.source);
        const outgoing: ModuleEdge[] = [
            ...parsed.imports,
            ...[...parsed.namedReexports.values()].map((hop) => ({
                specifier: hop.specifier,
                symbols: [hop.original],
                whole: false,
            })),
            ...parsed.starReexports.map((specifier) => ({ specifier, symbols: [], whole: true })),
            ...parsed.namespaceReexports.map((specifier) => ({ specifier, symbols: [], whole: true })),
        ];

        for (const edge of outgoing) {
            // Relative specifiers are sibling `*.schema.ts` modules, already in the authored corpus.
            if (isRelativeSpecifier(edge.specifier)) {
                continue;
            }

            await followEdge(edge, containing, schema.servicePath);
        }
    }

    // ── Traverse ────────────────────────────────────────────────────────────────────────────────────────────
    while (work.length > 0) {
        const item = work.pop();

        if (item === undefined) {
            break;
        }

        const seen = visited.get(item.file);
        const newSymbols = [...item.demand.symbols].filter((symbol) => seen?.symbols.has(symbol) !== true);
        const becomesWhole = item.demand.whole && seen?.whole !== true;

        if (seen !== undefined && !becomesWhole && newSymbols.length === 0) {
            continue;
        }

        const merged = {
            whole: (seen?.whole ?? false) || item.demand.whole,
            symbols: new Set([...(seen?.symbols ?? []), ...item.demand.symbols]),
        };

        visited.set(item.file, merged);

        const source = await readFile(item.file, 'utf8');
        const owner = await packageOf(item.file, packages);
        const packageRelativePath = relative(owner.root, item.file).replaceAll('\\', '/');
        const key = composedSourceKey(owner.name, packageRelativePath);

        corpus.set(key, { packageName: owner.name, packageRelativePath, key, source });

        const parsed = parseModule(item.file, source);
        const here = `${key} (via ${item.via})`;

        if (seen === undefined) {
            // A file's own imports are followed once, on first inclusion: its text is in the corpus and means
            // nothing without them.
            for (const edge of parsed.imports) {
                await followEdge(edge, item.file, here);
            }
        }

        if (becomesWhole) {
            for (const specifier of [...parsed.starReexports, ...parsed.namespaceReexports]) {
                await followEdge({ specifier, symbols: [], whole: true }, item.file, here);
            }

            for (const hop of parsed.namedReexports.values()) {
                await followEdge({ specifier: hop.specifier, symbols: [hop.original], whole: false }, item.file, here);
            }

            continue;
        }

        if (merged.whole) {
            continue;
        }

        // ── Attribute each demanded symbol to the module that declares it ────────────────────────────────────
        const unattributed: string[] = [];

        for (const symbol of newSymbols) {
            if (parsed.localExports.has(symbol)) {
                continue;
            }

            const hop = parsed.namedReexports.get(symbol);

            if (hop !== undefined) {
                await followEdge({ specifier: hop.specifier, symbols: [hop.original], whole: false }, item.file, here);
                continue;
            }

            const providers = await findStarProviders(symbol, parsed.starReexports, item.file, resolveFollowable);

            if (providers.kind === 'none') {
                unattributed.push(symbol);
                continue;
            }

            if (providers.kind === 'external') {
                // Only an installed dependency's star re-export could supply it. Deliberately outside the corpus,
                // so the symbol is accounted for without adding a file.
                continue;
            }

            for (const provider of providers.files) {
                enqueue(provider, { whole: false, symbols: new Set([symbol]) }, here);
            }
        }

        if (unattributed.length > 0) {
            throw new Error(
                `Cannot attribute ${unattributed.length} imported symbol(s) to a source module: ` +
                    `${unattributed.join(', ')} — imported from ${key} by ${item.via}. The contract hash covers ` +
                    'the sources every wire shape is composed from; a symbol whose defining module cannot be ' +
                    'found would leave that source OUT of the corpus, so the hash would stop moving when the ' +
                    'shape changed. Refusing rather than under-reporting.',
            );
        }
    }

    return [...corpus.values()].sort((left, right) => (left.key < right.key ? -1 : 1));
}

/**
 * Find which `export * from` target declares a name, searching transitively through further star re-exports.
 *
 * @param symbol - The exported name being attributed.
 * @param starTargets - The current module's `export * from` specifiers.
 * @param from - The current module, used to resolve those specifiers.
 * @param resolveFollowable - Resolver, which returns `undefined` for anything outside the corpus.
 * @returns `found` with the declaring files, `external` when only an unfollowable target could supply it, or
 *   `none` when no target does — which the caller turns into a refusal.
 * @sideEffect Reads the filesystem.
 */
async function findStarProviders(
    symbol: string,
    starTargets: readonly string[],
    from: string,
    resolveFollowable: (specifier: string, from: string) => Promise<string | undefined>,
): Promise<{ kind: 'found'; files: string[] } | { kind: 'external' } | { kind: 'none' }> {
    const files: string[] = [];
    const seen = new Set<string>();
    let sawExternal = false;

    const search = async (module: string, targets: readonly string[]): Promise<void> => {
        for (const specifier of targets) {
            const target = await resolveFollowable(specifier, module);

            if (target === undefined) {
                // A star re-export of an installed dependency could supply the name; it is deliberately not in the
                // corpus, so treat the symbol as accounted for rather than refusing a legitimate contract.
                sawExternal = true;
                continue;
            }

            if (seen.has(target)) {
                continue;
            }

            seen.add(target);

            const parsed = parseModule(target, await readFile(target, 'utf8'));

            if (parsed.localExports.has(symbol) || parsed.namedReexports.has(symbol)) {
                files.push(target);
                continue;
            }

            await search(target, parsed.starReexports);
        }
    };

    await search(from, starTargets);

    if (files.length > 0) {
        return { kind: 'found', files };
    }

    return sawExternal ? { kind: 'external' } : { kind: 'none' };
}

/**
 * Identify the package a file belongs to by walking up to the nearest named `package.json`.
 *
 * @param file - Absolute path of a source file.
 * @param cache - Directory-keyed memo, so a package's manifest is read once per run.
 * @returns The package's npm name and absolute root.
 * @throws When no ancestor `package.json` carries a `name`, which would leave the file unkeyable.
 * @sideEffect Reads the filesystem.
 */
async function packageOf(
    file: string,
    cache: Map<string, { name: string; root: string }>,
): Promise<{ name: string; root: string }> {
    const start = dirname(file);
    const visited: string[] = [];

    for (let directory = start; ; directory = dirname(directory)) {
        const cached = cache.get(directory);

        if (cached !== undefined) {
            for (const seen of visited) {
                cache.set(seen, cached);
            }

            return cached;
        }

        visited.push(directory);

        const manifest = await readOptionalJson(join(directory, 'package.json'));
        const name = manifest?.['name'];

        if (typeof name === 'string' && name.length > 0) {
            const owner = { name, root: directory };

            for (const seen of visited) {
                cache.set(seen, owner);
            }

            return owner;
        }

        if (dirname(directory) === directory) {
            throw new Error(
                `No package.json with a name above ${file}. Composed sources are keyed by package name and ` +
                    'package-relative path, so an unowned file cannot be given a checkout-independent key.',
            );
        }
    }
}

/**
 * Read and parse a JSON file, treating absence as absence rather than as an error.
 *
 * @param path - Absolute path of the file.
 * @returns The parsed object, or `undefined` when the file does not exist or is not a JSON object.
 * @sideEffect Reads the filesystem.
 */
async function readOptionalJson(path: string): Promise<Record<string, unknown> | undefined> {
    try {
        const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));

        return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
    } catch {
        return undefined;
    }
}
