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
 *   under the LOCAL pin and the deployed stage's AWS in a DEPLOYED suite, so only the first two are LOCAL doors;
 * - `browser`: a Playwright browser type (`chromium`, `firefox` or `webkit`) starting or attaching to a browser
 *   (`launch`, `launchPersistentContext`, `launchServer`, `connect`, `connectOverCDP`) while its module is not mocked
 *   in that file. The browser is the dependency under test (a renderer, a runtime), so a suite that drives one is LOCAL
 *   e2e. Like `awsClient` it is not a LOCAL door: a DEPLOYED suite may drive a browser against a deployed origin.
 *
 * @pattern Specification — one predicate over a suite's source, composed by several guards
 */
import ts from 'typescript';

import { isTestModule, parseSource, readSource, relativeSpecifiers, resolveRelative } from './roleSplitSources.js';
import { withoutTsComments } from './sourceComments.js';

/** The kinds of door a suite can open. */
export type DoorKind = 'database' | 'localstack' | 'awsClient' | 'browser';

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

/** A Playwright module. */
const PLAYWRIGHT = new Set(['playwright', 'playwright-core', '@playwright/test']);

/** The Playwright exports that launch a browser. */
const BROWSER_TYPES = new Set(['chromium', 'firefox', 'webkit']);

/** The browser-type methods that start a browser or attach to a running one. */
const BROWSER_ENTRY_POINTS = new Set([
    'launch',
    'launchPersistentContext',
    'launchServer',
    'connect',
    'connectOverCDP',
]);

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
    const { memberOf } = bindingsOf(file, (module) => AWS_SDK.test(module), isAwsClientName);
    const fromModules = new Set<string>();

    walk(file, (node) => {
        const module = ts.isNewExpression(node) ? memberOf(node.expression) : undefined;

        if (module !== undefined) {
            fromModules.add(module);
        }
    });

    return anyUnmocked(fromModules, file);
}

/** Whether an export name is an AWS SDK client class. */
const isAwsClientName = (name: string): boolean => name.endsWith('Client');

/** Whether any of `modules` is one the file does not replace with a test double. */
function anyUnmocked(modules: ReadonlySet<string>, file: ts.SourceFile): boolean {
    const mocked = mockedModules(file);

    return [...modules].some((module) => !mocked.has(module));
}

/** Call `visit` on every node under `root`, depth first. */
function walk(root: ts.Node, visit: (node: ts.Node) => void): void {
    const step = (node: ts.Node): void => {
        visit(node);
        ts.forEachChild(node, step);
    };

    step(root);
}

/** The modules a file replaces with a test double, by `vi.mock` or `vi.doMock`. */
function mockedModules(file: ts.SourceFile): ReadonlySet<string> {
    const mocked = new Set<string>();

    walk(file, (node) => {
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
    });

    return mocked;
}

/** Strip parentheses and `await` from an expression. */
function unwrap(expression: ts.Expression): ts.Expression {
    return ts.isParenthesizedExpression(expression) || ts.isAwaitExpression(expression)
        ? unwrap(expression.expression)
        : expression;
}

/** The matching module a `require('x')` or `import('x')` call loads, when it is one. */
function loadedModule(expression: ts.Expression, isModule: (module: string) => boolean): string | undefined {
    const call = unwrap(expression);

    if (!ts.isCallExpression(call)) {
        return undefined;
    }

    const [first] = call.arguments;
    const loads =
        call.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(call.expression) && call.expression.text === 'require');

    return loads && first !== undefined && ts.isStringLiteralLike(first) && isModule(first.text)
        ? first.text
        : undefined;
}

/** The local names a file binds to a matching module, and a resolver for expressions that denote its members. */
interface Bindings {
    /** Local names bound to a member of a matching module (`chromium`, `S3Client`), by the module. */
    readonly members: ReadonlyMap<string, string>;
    /** Local names bound to the whole of a matching module, by the module. */
    readonly namespaces: ReadonlyMap<string, string>;
    /** The module an expression is a member of: a bound name, `ns.member`, or `(await import('m')).member`. */
    readonly memberOf: (expression: ts.Expression) => string | undefined;
}

/** The maps {@link bindingsOf} fills, and the predicates that decide what goes in them. */
interface BindingScope {
    readonly members: Map<string, string>;
    readonly namespaces: Map<string, string>;
    readonly isMember: (name: string) => boolean;
    readonly namespaceOf: (expression: ts.Expression) => string | undefined;
    readonly memberOf: (expression: ts.Expression) => string | undefined;
}

/** The text of a property name, when it is a plain one. */
function propertyText(name: ts.PropertyName | ts.BindingName): string | undefined {
    return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
}

/** Record what one `import` of a matching module binds. Type-only imports bind nothing a program can run. */
function bindImport(statement: ts.ImportDeclaration, module: string, scope: BindingScope): void {
    const clause = statement.importClause;

    if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) {
        return;
    }

    const bindings = clause.namedBindings;

    if (clause.name !== undefined) {
        scope.namespaces.set(clause.name.text, module);
    }

    if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        scope.namespaces.set(bindings.name.text, module);

        return;
    }

    for (const element of bindings?.elements ?? []) {
        if (!element.isTypeOnly && scope.isMember((element.propertyName ?? element.name).text)) {
            scope.members.set(element.name.text, module);
        }
    }
}

/** Bind a name to a map unless it is already there; whether it was new. */
function bindOnce(map: Map<string, string>, name: string, module: string | undefined): boolean {
    if (module === undefined || map.has(name)) {
        return false;
    }

    map.set(name, module);

    return true;
}

/** Bind one destructured element of a matching module: a member, or `default` (the whole module). */
function bindElement(element: ts.BindingElement, module: string, scope: BindingScope): boolean {
    const property = propertyText(element.propertyName ?? element.name);

    if (property === undefined || !ts.isIdentifier(element.name)) {
        return false;
    }

    if (scope.isMember(property)) {
        return bindOnce(scope.members, element.name.text, module);
    }

    return property === 'default' && bindOnce(scope.namespaces, element.name.text, module);
}

/** Bind what one `const x = <initializer>` takes from a matching module; whether anything new was bound. */
function bindDeclaration(declaration: ts.VariableDeclaration, scope: BindingScope): boolean {
    const { name, initializer } = declaration;

    if (initializer === undefined) {
        return false;
    }

    const module = scope.namespaceOf(initializer);

    if (ts.isIdentifier(name)) {
        return (
            bindOnce(scope.members, name.text, scope.memberOf(initializer)) ||
            bindOnce(scope.namespaces, name.text, module)
        );
    }

    if (module === undefined || !ts.isObjectBindingPattern(name)) {
        return false;
    }

    return name.elements.map((element) => bindElement(element, module, scope)).some(Boolean);
}

/**
 * Which local names a file binds to a matching module, and to members of it. Pure.
 *
 * A member is reached by a named or renamed import, by destructuring any binding of the whole module, or by re-binding
 * one of those to another name; the whole module is reached by a namespace or default import, a dynamic `import()` or
 * a `require()`. Bindings are followed to a fixpoint, so an alias of an alias resolves. Type-only imports are excluded.
 *
 * @param file - The parsed source.
 * @param isModule - Whether a module specifier is one that counts.
 * @param isMember - Whether an export name of such a module is a member that counts.
 * @returns The bound names and a resolver over expressions.
 */
function bindingsOf(
    file: ts.SourceFile,
    isModule: (module: string) => boolean,
    isMember: (name: string) => boolean,
): Bindings {
    const members = new Map<string, string>();
    const namespaces = new Map<string, string>();

    const namespaceOf = (expression: ts.Expression): string | undefined => {
        const inner = unwrap(expression);

        if (ts.isIdentifier(inner)) {
            return namespaces.get(inner.text);
        }

        return ts.isPropertyAccessExpression(inner) && inner.name.text === 'default'
            ? namespaceOf(inner.expression)
            : loadedModule(inner, isModule);
    };

    const memberOf = (expression: ts.Expression): string | undefined => {
        const inner = unwrap(expression);

        if (ts.isIdentifier(inner)) {
            return members.get(inner.text);
        }

        return ts.isPropertyAccessExpression(inner) && isMember(inner.name.text)
            ? namespaceOf(inner.expression)
            : undefined;
    };

    const scope: BindingScope = { members, namespaces, isMember, namespaceOf, memberOf };
    const declarations: ts.VariableDeclaration[] = [];

    for (const statement of file.statements) {
        if (
            ts.isImportDeclaration(statement) &&
            ts.isStringLiteral(statement.moduleSpecifier) &&
            isModule(statement.moduleSpecifier.text)
        ) {
            bindImport(statement, statement.moduleSpecifier.text, scope);
        }
    }

    walk(file, (node) => {
        if (ts.isVariableDeclaration(node)) {
            declarations.push(node);
        }
    });

    for (let grew = true; grew;) {
        grew = declarations.map((declaration) => bindDeclaration(declaration, scope)).some(Boolean);
    }

    return { members, namespaces, memberOf };
}

/**
 * Whether a source starts or attaches to a Playwright browser from a module it does not mock. Pure.
 *
 * @param path - The source's path.
 * @param text - The source.
 * @returns `true` when one is launched or connected to.
 */
function launchesBrowser(path: string, text: string): boolean {
    const file = parseSource(path, text);
    const { memberOf } = bindingsOf(
        file,
        (module) => PLAYWRIGHT.has(module),
        (name) => BROWSER_TYPES.has(name),
    );
    const fromModules = new Set<string>();

    walk(file, (node) => {
        const module =
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            BROWSER_ENTRY_POINTS.has(node.expression.name.text)
                ? memberOf(node.expression.expression)
                : undefined;

        if (module !== undefined) {
            fromModules.add(module);
        }
    });

    return anyUnmocked(fromModules, file);
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
    const code = withoutTsComments(text, path);
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

    if (launchesBrowser(path, text)) {
        opened.add('browser');
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
