/**
 * What makes a test suite reach a REAL dependency, and through which door, defined once for every guard that asks.
 *
 * `testTierDependencies.test.ts` holds each tier to it: an integration suite reaches none, every suite a LOCAL
 * config (`vitest.e2e.config.ts`) runs reaches one, and no suite a DEPLOYED config (`vitest.deployed.config.ts`) runs
 * opens a local one. The config file name declares the tier; this module only verifies the declaration.
 *
 * A door is one of three kinds:
 * - `database`: a call to a harness export that connects to a real database (derived from
 *   `@kitchensink/service-test-harness`'s exports, {@link harnessDoorNames}), or a `pg` pool or client constructed
 *   while `pg` itself is not mocked in that file;
 * - `localstack`: a read of a LocalStack endpoint variable (`S3_ENDPOINT`, `AWS_ENDPOINT_URL`, and the like);
 * - `awsClient`: an `@aws-sdk/*` client constructed while that module is not mocked in that file. It reaches LocalStack
 *   under the LOCAL pin and the deployed stage's AWS in a DEPLOYED suite, so only the first two are LOCAL doors.
 *
 * @pattern Specification — one predicate over a suite's source, composed by several guards
 */
import ts from 'typescript';

import {
    isTestModule,
    parseSource,
    readSource,
    relativeSpecifiers,
    resolveRelative,
    withoutTsComments,
} from './roleSplitSources.js';

/** The kinds of door a suite can open. */
export type DoorKind = 'database' | 'localstack' | 'awsClient';

/** The doors that reach something on this machine: what a DEPLOYED suite must never open. */
export const LOCAL_DOORS: ReadonlySet<DoorKind> = new Set<DoorKind>(['database', 'localstack']);

/** The harness's public surface, whose exports {@link harnessDoorNames} reads. */
const HARNESS_ENTRY = 'packages/tools/service-test-harness/src/index.ts';

/** A `pg` pool or client being constructed. */
const PG_CONSTRUCTOR = /\bnew\s+(?:pg\.)?(?:Pool|Client)\s*\(/u;

/** `pg` replaced by a test double in this file, so a constructed pool reaches nothing. */
const PG_MOCKED = /\bvi\.(?:mock|doMock)\(\s*['"]pg['"]/u;

/** A read of a LocalStack endpoint variable. */
const LOCALSTACK_ENDPOINT = /process\.env(?:\[['"][A-Z0-9_]*ENDPOINT(?:_URL)?['"]\]|\.[A-Z0-9_]*ENDPOINT(?:_URL)?\b)/u;

/** An AWS SDK module. */
const AWS_SDK = /^@aws-sdk\//u;

/** A test file, as opposed to a helper module. */
export const SUITE = /\.test\.tsx?$/u;

/** Reads a repo-relative file's text, or `undefined` when there is none. */
export type Reader = (path: string) => string | undefined;

/**
 * The harness exports that connect to a real database, derived from the harness itself: an exported function whose
 * body constructs a `pg` pool or client, or calls a harness function that does, transitively. Pure over `read`.
 *
 * @param read - Reads a file.
 * @param entry - The harness's public entry, which re-exports from its modules.
 * @returns The exported names, sorted.
 */
export function harnessDoorNames(read: Reader, entry: string = HARNESS_ENTRY): readonly string[] {
    const exported = new Map<string, string>();
    const bodies = new Map<string, string>();
    const pending = [entry];
    const seen = new Set<string>();

    for (let module = pending.pop(); module !== undefined; module = pending.pop()) {
        const text = seen.has(module) ? undefined : read(module);

        seen.add(module);

        if (text === undefined) {
            continue;
        }

        const file = parseSource(module, text);

        for (const statement of file.statements) {
            collectExports(statement, module === entry, exported);
            collectBodies(statement, file, bodies);
        }

        for (const specifier of relativeSpecifiers(module, text)) {
            const resolved = resolveRelative(module, specifier, (path) => read(path) !== undefined);

            if (resolved !== undefined) {
                pending.push(resolved);
            }
        }
    }

    const doors = new Set([...bodies].filter(([, body]) => PG_CONSTRUCTOR.test(body)).map(([name]) => name));

    for (let grew = true; grew;) {
        grew = false;

        for (const [name, body] of bodies) {
            if (!doors.has(name) && [...doors].some((door) => callPattern([door]).test(body))) {
                doors.add(name);
                grew = true;
            }
        }
    }

    return [...exported]
        .filter(([, local]) => doors.has(local))
        .map(([name]) => name)
        .sort();
}

/** Record the value names an entry statement re-exports, as `exported name → declared name`. */
function collectExports(statement: ts.Statement, isEntry: boolean, exported: Map<string, string>): void {
    if (
        !isEntry ||
        !ts.isExportDeclaration(statement) ||
        statement.isTypeOnly ||
        statement.exportClause === undefined ||
        !ts.isNamedExports(statement.exportClause)
    ) {
        return;
    }

    for (const element of statement.exportClause.elements.filter((candidate) => !candidate.isTypeOnly)) {
        exported.set(element.name.text, (element.propertyName ?? element.name).text);
    }
}

/** Record each top-level function's body, comments blanked, by its name. */
function collectBodies(statement: ts.Statement, file: ts.SourceFile, bodies: Map<string, string>): void {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined && statement.body !== undefined) {
        bodies.set(statement.name.text, withoutTsComments(statement.body.getText(file)));
    }

    if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
            const value = declaration.initializer;

            if (
                ts.isIdentifier(declaration.name) &&
                value !== undefined &&
                (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
            ) {
                bodies.set(declaration.name.text, withoutTsComments(value.body.getText(file)));
            }
        }
    }
}

/** A call to any of `names`. */
const callPattern = (names: readonly string[]): RegExp =>
    new RegExp(`\\b(?:${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')})\\s*\\(`, 'u');

/**
 * Whether a source constructs an `@aws-sdk/*` client from a module it does not mock. Pure.
 *
 * @param path - The source's path.
 * @param text - The source.
 * @returns `true` when one is constructed.
 */
function constructsAwsClient(path: string, text: string): boolean {
    const file = parseSource(path, text);
    const clients = new Map<string, string>();
    const namespaces = new Map<string, string>();
    const mocked = new Set<string>();

    for (const statement of file.statements) {
        if (
            !ts.isImportDeclaration(statement) ||
            !ts.isStringLiteral(statement.moduleSpecifier) ||
            !AWS_SDK.test(statement.moduleSpecifier.text) ||
            statement.importClause === undefined ||
            statement.importClause.isTypeOnly
        ) {
            continue;
        }

        const module = statement.moduleSpecifier.text;
        const bindings = statement.importClause.namedBindings;

        if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
            namespaces.set(bindings.name.text, module);
            continue;
        }

        for (const element of bindings?.elements ?? []) {
            if (!element.isTypeOnly && (element.propertyName ?? element.name).text.endsWith('Client')) {
                clients.set(element.name.text, module);
            }
        }
    }

    const constructedFrom = (node: ts.NewExpression): string | undefined => {
        const callee = node.expression;

        if (ts.isIdentifier(callee)) {
            return clients.get(callee.text);
        }

        return ts.isPropertyAccessExpression(callee) &&
            ts.isIdentifier(callee.expression) &&
            callee.name.text.endsWith('Client')
            ? namespaces.get(callee.expression.text)
            : undefined;
    };

    const fromModules = new Set<string>();

    const visit = (node: ts.Node): void => {
        if (ts.isNewExpression(node)) {
            const module = constructedFrom(node);

            if (module !== undefined) {
                fromModules.add(module);
            }
        }

        if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            ts.isIdentifier(node.expression.expression) &&
            node.expression.expression.text === 'vi' &&
            ['mock', 'doMock'].includes(node.expression.name.text)
        ) {
            const [first] = node.arguments;

            if (first !== undefined && ts.isStringLiteralLike(first)) {
                mocked.add(first.text);
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return [...fromModules].some((module) => !mocked.has(module));
}

/**
 * The doors one file's own code opens. Pure.
 *
 * @param path - The file's path.
 * @param text - The file's source.
 * @param doorNames - The harness exports that connect to a database.
 * @returns The kinds of door it opens.
 */
export function doorsOpened(path: string, text: string, doorNames: readonly string[]): ReadonlySet<DoorKind> {
    const code = withoutTsComments(text);
    const opened = new Set<DoorKind>();

    if (
        (doorNames.length > 0 && callPattern(doorNames).test(code)) ||
        (PG_CONSTRUCTOR.test(code) && !PG_MOCKED.test(code))
    ) {
        opened.add('database');
    }

    if (LOCALSTACK_ENDPOINT.test(code)) {
        opened.add('localstack');
    }

    if (constructsAwsClient(path, text)) {
        opened.add('awsClient');
    }

    return opened;
}

/**
 * The relative modules a file loads, resolved to repo-relative paths that exist ({@link relativeSpecifiers}). Pure over
 * `read`.
 *
 * @param path - The importing file.
 * @param text - Its source.
 * @param read - Reads a candidate, to learn whether it exists.
 * @returns The loaded modules.
 */
export function relativeImports(path: string, text: string, read: Reader): readonly string[] {
    return relativeSpecifiers(path, text).flatMap(
        (specifier) => resolveRelative(path, specifier, (candidate) => read(candidate) !== undefined) ?? [],
    );
}

/**
 * The doors a file opens, itself or through a test module it loads, transitively ({@link isTestModule}). Pure over
 * `read`.
 *
 * @param path - The file.
 * @param read - Reads a file.
 * @param doorNames - The harness exports that connect to a database; derived from the real harness by default.
 * @returns The kinds of door reached.
 */
export function doorsReached(
    path: string,
    read: Reader,
    doorNames: readonly string[] = realHarnessDoorNames(),
): ReadonlySet<DoorKind> {
    const reached = new Set<DoorKind>();
    const seen = new Set<string>();
    const pending = [path];

    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
        const text = seen.has(next) ? undefined : read(next);

        seen.add(next);

        if (text === undefined) {
            continue;
        }

        for (const kind of doorsOpened(next, text, doorNames)) {
            reached.add(kind);
        }

        pending.push(...relativeImports(next, text, read).filter(isTestModule));
    }

    return reached;
}

/**
 * Whether a file reaches any real dependency. Pure over `read`.
 *
 * @param path - The file.
 * @param read - Reads a file.
 * @returns `true` when it opens any door.
 */
export function reachesRealDependency(path: string, read: Reader): boolean {
    return doorsReached(path, read).size > 0;
}

/** The real tree's reader. */
export const readTree: Reader = (path) => {
    try {
        return readSource(path);
    } catch {
        return undefined;
    }
};

let harnessDoorCache: readonly string[] | undefined;

/**
 * The real harness's door names, read once.
 *
 * @sideEffect Reads the harness's sources.
 */
function realHarnessDoorNames(): readonly string[] {
    harnessDoorCache ??= harnessDoorNames(readTree);

    return harnessDoorCache;
}
