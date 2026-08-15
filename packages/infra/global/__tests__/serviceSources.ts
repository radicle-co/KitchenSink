/**
 * Service DISCOVERY + TypeScript-AST reading for the repo-wide guards.
 *
 * ## Why this is a module and not copied into each guard
 *
 * Two repo-wide guard suites (`serviceSecurityInvariants.test.ts` and
 * `serviceInfraWiringInvariants.test.ts`) constrain services that DO NOT EXIST YET, and both depend on the
 * same property to do it: the service list is DISCOVERED from each service's own `package.json`, never
 * enumerated. That property is the whole point — a new service is covered the day its manifest lands and cannot
 * opt out by not being mentioned.
 *
 * Which makes a second copy of the discovery walk the one duplication that actually matters here. If the copies
 * drift — one gains a filter, one changes the manifest glob — a guard silently stops discovering a service and
 * passes vacuously forever, which is precisely the failure mode a guard is supposed to prevent rather than
 * exhibit. One authoritative walk, one reason to change.
 *
 * ## Why the TypeScript PARSER and not grep
 *
 * Several invariants are about things that also appear in PROSE — `trust proxy` is discussed at length in a
 * docstring explaining why it is never set; `sql.raw` is named in the ESLint rule's own message; a queue's
 * missing grant is explained in the comment above the grant that is missing. A textual gate reports its own
 * rationale as a violation, and a gate that fires on its own rationale gets deleted. Parsing means comments are
 * comments and string literals are string literals.
 *
 * Everything here is MECHANISM. The invariants themselves live in the guard suites, as pure predicates over
 * {@link DiscoveredService}, so each can be fired at a deliberately-violating fake.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

/** Repo root — this file sits at `packages/infra/global/__tests__`, so the root is four levels up. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Where the deployable services live. */
export const SERVICES_ROOT = 'packages/services';

/** One source file, as the predicates see it. */
export interface SourceFile {
    /** Repo-relative (or fixture) path. */
    readonly file: string;
    /** The file's text. */
    readonly contents: string;
}

/** A service as the gates see it: its directory name plus every TypeScript source under it. */
export interface DiscoveredService {
    /** Directory name under `packages/services/` (or the fake's name). */
    readonly name: string;
    /** Package name from the manifest. */
    readonly packageName: string;
    /**
     * Every `.ts` source in the service, tests included.
     *
     * Deliberately `.ts` ONLY, even though the tree also tracks `.mjs`/`.js` (each service's `esbuild.mjs`, the
     * k6 load scripts under `tests/load/`). Widening this set would silently change what every existing gate
     * examines — a k6 script writing a header name would become a security finding — so a gate needing a
     * non-TypeScript file asks for it by name via {@link readServiceFile} instead.
     */
    readonly sources: readonly SourceFile[];
}

/**
 * Every tracked file under a repo-relative directory that is ALSO present in the working tree.
 *
 * `git ls-files` rather than a directory walk, so gitignored build output (`dist/`, `cdk.out/`, `.turbo/`)
 * can never contribute a finding — the trap documented at length in `scripts/boundariesRatchet.mjs`, where a
 * stray `cdk synth` invented three phantom violations. The `existsSync` filter is not redundant: `ls-files`
 * reports the INDEX, which disagrees with the working tree during an unstaged deletion or a half-finished
 * rebase, and a gate that throws in those states fails for reasons unrelated to what it checks.
 *
 * @param relativeDir - Repo-relative directory to list.
 * @returns Repo-relative paths of the tracked, on-disk files.
 * @sideEffect Shells out to git and stats the working tree.
 */
export function trackedFiles(relativeDir: string): readonly string[] {
    return execFileSync('git', ['ls-files', '--', relativeDir], { cwd: repoRoot, encoding: 'utf8' })
        .split('\n')
        .filter((file) => file.length > 0 && existsSync(path.join(repoRoot, file)));
}

/**
 * Discover every deployable service and read its sources.
 *
 * @returns One entry per `packages/services/*` directory carrying a manifest.
 * @sideEffect Reads the services tree.
 */
export function discoverServices(): readonly DiscoveredService[] {
    const services: DiscoveredService[] = [];

    for (const entry of readdirSync(path.join(repoRoot, SERVICES_ROOT), { withFileTypes: true })) {
        const manifestPath = path.posix.join(SERVICES_ROOT, entry.name, 'package.json');

        if (!entry.isDirectory() || !existsSync(path.join(repoRoot, manifestPath))) {
            continue;
        }

        const manifest = JSON.parse(readFileSync(path.join(repoRoot, manifestPath), 'utf8')) as { name?: string };
        const sources = trackedFiles(path.posix.join(SERVICES_ROOT, entry.name))
            .filter((file) => file.endsWith('.ts'))
            .map((file) => ({ file, contents: readFileSync(path.join(repoRoot, file), 'utf8') }));

        services.push({ name: entry.name, packageName: manifest.name ?? entry.name, sources });
    }

    return services;
}

/**
 * Read one non-TypeScript file out of a service directory (a bundler config, a manifest).
 *
 * Returns `undefined` rather than throwing when the file is absent: "this service has no bundler config" is a
 * legitimate state a gate must be able to branch on, not an error.
 *
 * @param serviceName - Directory name under `packages/services/`.
 * @param relativePath - Path within the service directory.
 * @returns The file's text, or `undefined` when it does not exist.
 * @sideEffect Reads the working tree.
 */
export function readServiceFile(serviceName: string, relativePath: string): string | undefined {
    const absolute = path.join(repoRoot, SERVICES_ROOT, serviceName, relativePath);

    return existsSync(absolute) ? readFileSync(absolute, 'utf8') : undefined;
}

/**
 * Walk every node of a parsed source file.
 *
 * @param source - The parsed file.
 * @param callback - Invoked once per node, pre-order.
 */
export function visit(source: ts.SourceFile, callback: (node: ts.Node) => void): void {
    const walk = (node: ts.Node): void => {
        callback(node);
        ts.forEachChild(node, walk);
    };

    walk(source);
}

/**
 * Parse one file.
 *
 * `ScriptKind.TS` regardless of extension: the only non-TypeScript files any gate parses are the `esbuild.mjs`
 * bundler configs, which are plain ESM that the TypeScript parser reads without complaint.
 *
 * @param source - The file to parse.
 * @returns The parsed source file.
 */
export function parse({ file, contents }: SourceFile): ts.SourceFile {
    return ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, /* setParentNodes */ false, ts.ScriptKind.TS);
}

/**
 * Every string-literal VALUE in a file (never a comment, never an identifier).
 *
 * @param source - The file to read.
 * @returns The literal texts, in source order.
 */
export function stringLiterals(source: SourceFile): readonly string[] {
    const literals: string[] = [];

    visit(parse(source), (node) => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            literals.push(node.text);
        }
    });

    return literals;
}

/**
 * Every module specifier a file imports / exports-from / requires.
 *
 * @param source - The file to read.
 * @returns The specifier texts, in source order.
 */
export function moduleSpecifiers(source: SourceFile): readonly string[] {
    const specifiers: string[] = [];

    visit(parse(source), (node) => {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier !== undefined &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            specifiers.push(node.moduleSpecifier.text);
        }

        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
            const [first] = node.arguments;

            if (first !== undefined && ts.isStringLiteral(first)) {
                specifiers.push(first.text);
            }
        }
    });

    return specifiers;
}

/**
 * Whether a file is a test/fixture rather than production source.
 *
 * `__mocks__` is included deliberately, and is the ONE difference from the copy this was extracted from
 * (`serviceSecurityInvariants.test.ts` listed `__tests__`, `__fixtures__`, `tests`). It is inert today —
 * `git ls-files` finds no `__mocks__` directory anywhere under `packages/services` — and a mock is test code by
 * any reading, so the alternative would be a gate that treats a hand-written mock as production source. Recorded
 * here rather than left as an unexplained widening, since the effect of adding a name is to EXCLUDE more files
 * from the gates that filter test code.
 *
 * @param file - Repo-relative path.
 * @returns `true` for anything under a test/fixture directory or named as a spec.
 */
export function isTestFile(file: string): boolean {
    return /(^|\/)(__tests__|__fixtures__|__mocks__|tests)\//u.test(file) || /\.(test|spec)\.ts$/u.test(file);
}

/**
 * Whether a file is a service's CDK infrastructure (as opposed to its runtime source).
 *
 * @param file - Repo-relative path.
 * @returns `true` for anything under the service's `infra/` directory.
 */
export function isInfraFile(file: string): boolean {
    return /(^|\/)infra\//u.test(file);
}

/**
 * The property assignments of an object literal, keyed by property name.
 *
 * Shorthand (`{ stage }`) and computed keys are skipped: a gate that needs a literal VALUE cannot resolve
 * either without type-level dataflow, and silently treating a shorthand as absent is the honest answer.
 *
 * @param node - The object literal.
 * @returns Name → initializer expression.
 */
export function objectProperties(node: ts.ObjectLiteralExpression): ReadonlyMap<string, ts.Expression> {
    const properties = new Map<string, ts.Expression>();

    for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) {
            continue;
        }

        const name = ts.isIdentifier(property.name)
            ? property.name.text
            : ts.isStringLiteral(property.name)
              ? property.name.text
              : undefined;

        if (name !== undefined) {
            properties.set(name, property.initializer);
        }
    }

    return properties;
}

/**
 * The text of an expression when it is a plain string literal, else `undefined`.
 *
 * @param node - The expression to read.
 * @returns The literal text, or `undefined` for anything computed.
 */
export function literalText(node: ts.Expression | undefined): string | undefined {
    if (node === undefined) {
        return undefined;
    }

    return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;
}
