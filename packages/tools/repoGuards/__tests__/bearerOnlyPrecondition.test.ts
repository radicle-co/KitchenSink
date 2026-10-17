// @vitest-environment node
/**
 * Repo-wide guard: every package that adopts the shared CORS policy is BEARER-ONLY (ADR-0047).
 *
 * ## What the precondition is
 *
 * `resolveCorsPolicy` (`@kitchensink/clerk-verify`) admits a whole family of origins on a deployed non-prod stage
 * (the anchored preview pattern, so any `pr-{N}` page) and every loopback origin on a developer machine. That is
 * safe only while a page on an admitted origin has no ambient credential to ride: no route reads a cookie or a
 * session, and none accepts a WebSocket upgrade. A browser attaches cookies by itself, and it applies no CORS check
 * to a WebSocket handshake, so either one turns an admitted origin into a credential a hostile page can use. With
 * neither, a cross-origin request carries a credential only if its author already holds a bearer token, and then
 * CORS was never the control.
 *
 * ## Why one guard, here, discovering its subjects
 *
 * Recipe and identity each carried a copy of this check. The copies had drifted: neither looked for a WebSocket
 * upgrade, and only recipe's proved that its scan reached the code that authenticates. And each copy covered only
 * its own service, so a third adopter (food, plan 002 S4) was covered only if someone remembered to write a third
 * copy. This file replaces both. It finds every package that calls `resolveCorsPolicy` by scanning the tree, so a
 * new adopter is covered the day it adopts, with no step of its own.
 *
 * It lives in this test package and not in `clerk-verify` because it reads OTHER packages' sources. A library
 * that scans its consumers inverts the dependency, and `clerk-verify` ships inside every service image. This
 * package already owns the repo-wide guards and the one shared walk they use (`serviceSources.ts`).
 *
 * ## Why it parses and does not grep
 *
 * The prose that explains the precondition names the very things it forbids (`req.cookies`, `upgrade`). A text
 * search would report its own rationale. The detectors walk the TypeScript AST, so a comment is never a node and a
 * sentence inside a string is never a property read. The fixture table below proves that property for every
 * detector, alongside a positive case for each shape it must catch.
 *
 * ## Why it checks that the scan reached the authentication code
 *
 * Every real-tree assertion here concludes something from an EMPTY list, which a walk that read nothing also
 * produces. So for each adopter the guard lists, by a second and independent walk of the whole package, every file
 * that reads the `Authorization` header, and requires that list to be non-empty and inside the scanned set.
 *
 * @see docs/architecture/decisions/0047-shared-cors-policy.md
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { isTestFile, parse, presentFiles, repoRoot, visit, type SourceFile } from './serviceSources.js';

// ───────────────────────────── the vocabulary ─────────────────────────────

/** The shared policy's exported name: calling or importing it is what makes a package an adopter. */
const POLICY_EXPORT = 'resolveCorsPolicy';

/** A property read with one of these names reads a browser-supplied credential rather than the bearer. */
const AMBIENT_PROPERTIES = new Set(['cookie', 'cookies', 'signedCookies', 'session']);

/**
 * Header names, as the first argument of a method call (`req.get('Cookie')`, `res.setHeader('Set-Cookie', …)`,
 * `server.on('upgrade', …)`), and the precondition each one breaks. Compared lower-cased.
 */
const HEADER_SIGNALS: ReadonlyMap<string, PreconditionBreak> = new Map([
    ['cookie', 'ambient-credential'],
    ['set-cookie', 'ambient-credential'],
    ['upgrade', 'websocket-upgrade'],
    ['sec-websocket-key', 'websocket-upgrade'],
    ['sec-websocket-protocol', 'websocket-upgrade'],
]);

/** Members whose only use is accepting a WebSocket upgrade (`ws`'s server, Nest's adapter seam). */
const WEBSOCKET_MEMBERS = new Set(['handleUpgrade', 'useWebSocketAdapter']);

/** Nest's gateway decorators. Any of them means the service accepts a socket. */
const WEBSOCKET_IDENTIFIERS = new Set(['WebSocketGateway', 'WebSocketServer', 'SubscribeMessage']);

/**
 * A module that handles cookies or sessions: `cookie`, `cookies`, `cookie-parser`, `express-session`,
 * `cookie-session`, `@fastify/cookie`, `@fastify/secure-session`, `iron-session`, `tough-cookie`. A pattern rather
 * than a list, so a package nobody thought of is still caught. The word must be a whole segment, so
 * `cookiecutter` and `@scope/sessionless` pass.
 */
const COOKIE_MODULE = /(?:^|[/@-])(?:cookies?|(?:secure-)?session)(?:[/-]|$)/iu;

/**
 * A module that serves WebSockets: `ws`, `socket.io`, `@nestjs/websockets`, `@nestjs/platform-ws`,
 * `@nestjs/platform-socket.io`, `express-ws`, `graphql-ws`, `sockjs`, `engine.io`, `uWebSockets.js`. A pattern
 * for the same reason as {@link COOKIE_MODULE}. `ws` must be the whole name or a trailing segment, so `news` and
 * `@aws-sdk/*` pass.
 */
const WEBSOCKET_MODULE = /websocket|socket\.io|sockjs|engine\.io|^uWebSockets\.js(?:\/|$)|(?:^|[/-])ws(?:\/|$)/iu;

/**
 * Clerk's request authenticators. Each reads the `__session` COOKIE when a request carries no bearer, so a call to
 * either is a cookie read by another name, and no property detector above sees it. `authenticateRequest` is
 * `@clerk/backend`'s, reached as a member (`clerkClient.authenticateRequest(req)`) or imported bare;
 * `clerkMiddleware` is every Clerk framework SDK's.
 */
const CLERK_COOKIE_AUTHENTICATORS = new Set(['authenticateRequest', 'clerkMiddleware']);

/**
 * Clerk's server framework SDKs, whose whole job is authenticating a request from its session cookie. `express` and
 * `fastify` are the two a Nest service can run on. A whole segment, so `@clerk/express-types` passes.
 * `@clerk/backend` is NOT here: every adopter uses its bearer-only `verifyToken`, and its cookie path is caught by
 * name through {@link CLERK_COOKIE_AUTHENTICATORS}.
 */
const CLERK_SESSION_MODULE = /^@clerk\/(?:express|fastify)(?:\/|$)/u;

/** Directories a package walk never descends into: build output and installed dependencies. */
const NON_SOURCE_DIRECTORIES = new Set(['node_modules', 'dist', 'dist-lambda', 'cdk.out', 'coverage']);

// ───────────────────────────── the detectors, as pure functions ─────────────────────────────

/** Which half of the precondition a finding breaks. */
type PreconditionBreak = 'ambient-credential' | 'websocket-upgrade';

/** One place a source breaks the bearer-only precondition. */
interface PreconditionFinding {
    readonly kind: PreconditionBreak;
    /** What was found, as written in the source. */
    readonly what: string;
    /** 1-based line. */
    readonly line: number;
}

/** The line a node starts on, 1-based. */
function lineOf(file: ts.SourceFile, node: ts.Node): number {
    return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

/** A string-literal node's text, or `undefined` for any other node. */
function literalText(node: ts.Node | undefined): string | undefined {
    return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        ? node.text
        : undefined;
}

/**
 * The module a node names, for every way a module is pulled in: `import … from`, `export … from`, `require(…)`
 * and `import(…)`. Pure.
 *
 * @param node - Any node.
 * @returns The specifier, or `undefined` when the node pulls in no module.
 */
function moduleNamedBy(node: ts.Node): string | undefined {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
        return literalText(node.moduleSpecifier);
    }

    if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
        return literalText(node.arguments[0]);
    }

    return undefined;
}

/** Whether an expression's text ends in `headers`, i.e. it is a request's header bag. */
function isHeaderBag(file: ts.SourceFile, expression: ts.Expression): boolean {
    return /(?:^|\.)headers$/iu.test(expression.getText(file));
}

/**
 * A read of member `name` off a header bag, as `x.headers.name` or `x.headers['name']`. Pure.
 *
 * @param file - The parsed file.
 * @param node - Any node.
 * @returns The member name, lower-cased, or `undefined` when the node is not such a read.
 */
function headerMemberRead(file: ts.SourceFile, node: ts.Node): string | undefined {
    if (ts.isPropertyAccessExpression(node) && isHeaderBag(file, node.expression)) {
        return node.name.text.toLowerCase();
    }

    if (ts.isElementAccessExpression(node) && isHeaderBag(file, node.expression)) {
        return literalText(node.argumentExpression)?.toLowerCase();
    }

    return undefined;
}

/**
 * A method call whose first argument is a string literal: `req.get('Cookie')`, `server.on('upgrade', …)`. Pure.
 *
 * @param node - Any node.
 * @returns The callee and the literal, or `undefined` for any other node.
 */
function methodCallOnLiteral(
    node: ts.Node,
): { readonly callee: ts.PropertyAccessExpression; readonly literal: string } | undefined {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
        return undefined;
    }

    const literal = literalText(node.arguments[0]);

    return literal === undefined ? undefined : { callee: node.expression, literal };
}

/**
 * Every place one source breaks the precondition. Pure.
 *
 * @param source - The file to read.
 * @returns The findings, in source order.
 */
function findPreconditionBreaks(source: SourceFile): readonly PreconditionFinding[] {
    const file = parse(source);
    const found: PreconditionFinding[] = [];

    const report = (kind: PreconditionBreak, what: string, node: ts.Node): void => {
        found.push({ kind, what, line: lineOf(file, node) });
    };

    // The names of `x.authenticateRequest` reads already reported in full, so the identifier rule below skips them.
    // The walk is pre-order, so a property access is always seen before its name.
    const reportedMemberNames = new Set<ts.Node>();

    visit(file, (node) => {
        const module = moduleNamedBy(node);

        if (module !== undefined && (COOKIE_MODULE.test(module) || CLERK_SESSION_MODULE.test(module))) {
            report('ambient-credential', `import '${module}'`, node);
        }

        if (ts.isPropertyAccessExpression(node) && CLERK_COOKIE_AUTHENTICATORS.has(node.name.text)) {
            reportedMemberNames.add(node.name);
            report('ambient-credential', `${node.expression.getText(file)}.${node.name.text}`, node);
        }

        if (ts.isIdentifier(node) && CLERK_COOKIE_AUTHENTICATORS.has(node.text) && !reportedMemberNames.has(node)) {
            report('ambient-credential', node.text, node);
        }

        if (module !== undefined && WEBSOCKET_MODULE.test(module)) {
            report('websocket-upgrade', `import '${module}'`, node);
        }

        if (ts.isPropertyAccessExpression(node) && AMBIENT_PROPERTIES.has(node.name.text)) {
            report('ambient-credential', `${node.expression.getText(file)}.${node.name.text}`, node);
        }

        if (ts.isElementAccessExpression(node)) {
            const member = literalText(node.argumentExpression);

            if (member !== undefined && AMBIENT_PROPERTIES.has(member)) {
                report('ambient-credential', `${node.expression.getText(file)}['${member}']`, node);
            }
        }

        if (ts.isPropertyAccessExpression(node) && WEBSOCKET_MEMBERS.has(node.name.text)) {
            report('websocket-upgrade', `${node.expression.getText(file)}.${node.name.text}`, node);
        }

        if (ts.isIdentifier(node) && WEBSOCKET_IDENTIFIERS.has(node.text)) {
            report('websocket-upgrade', node.text, node);
        }

        // The `Upgrade` header off a header bag. Only `upgrade`: a cookie header read is already caught by the
        // ambient property rule above, and reporting it twice would only double the finding.
        if (headerMemberRead(file, node) === 'upgrade') {
            const what = ts.isPropertyAccessExpression(node)
                ? `${node.expression.getText(file)}.${node.name.text}`
                : node.getText(file).replace(/"/gu, "'");

            report('websocket-upgrade', what, node);
        }

        const call = methodCallOnLiteral(node);
        const signal = call === undefined ? undefined : HEADER_SIGNALS.get(call.literal.toLowerCase());

        if (call !== undefined && signal !== undefined) {
            report(signal, `${call.callee.getText(file)}('${call.literal}')`, node);
        }
    });

    return found;
}

/**
 * Whether a source reads the `Authorization` request header: the bearer credential, and so the package's
 * authentication entry point. Pure.
 *
 * @param source - The file to read.
 * @returns `true` for `x.headers.authorization`, `x.headers['authorization']` or `x.get('authorization')`.
 */
function readsBearerHeader(source: SourceFile): boolean {
    const file = parse(source);
    let reads = false;

    visit(file, (node) => {
        const call = methodCallOnLiteral(node);

        if (
            headerMemberRead(file, node) === 'authorization' ||
            (call !== undefined && call.callee.name.text === 'get' && call.literal.toLowerCase() === 'authorization')
        ) {
            reads = true;
        }
    });

    return reads;
}

/**
 * Whether a source adopts the shared policy: it imports {@link POLICY_EXPORT} under any local name, or calls a
 * function or method of that name. A re-export is not adoption, and neither is the declaration itself. Pure.
 *
 * @param source - The file to read.
 * @returns `true` when the file adopts the policy.
 */
function adoptsSharedPolicy(source: SourceFile): boolean {
    let adopts = false;

    visit(parse(source), (node) => {
        if (ts.isImportSpecifier(node) && (node.propertyName ?? node.name).text === POLICY_EXPORT) {
            adopts = true;
        }

        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            const name = ts.isPropertyAccessExpression(callee)
                ? callee.name.text
                : ts.isIdentifier(callee)
                  ? callee.text
                  : undefined;

            if (name === POLICY_EXPORT) {
                adopts = true;
            }
        }
    });

    return adopts;
}

/**
 * Whether a source turns CORS on by any route Nest or Express offers: `app.enableCors(…)`,
 * `NestFactory.create(…, { cors: … })`, or an import of the `cors` middleware. Pure.
 *
 * @param source - The file to read.
 * @returns `true` when the file enables CORS.
 */
function enablesCors(source: SourceFile): boolean {
    let enables = false;

    visit(parse(source), (node) => {
        if (moduleNamedBy(node) === 'cors') {
            enables = true;
        }

        if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
            return;
        }

        if (node.expression.name.text === 'enableCors') {
            enables = true;
        }

        // `create`'s options object, and only there: `{ cors: true }` anywhere else is just an object.
        if (node.expression.name.text === 'create') {
            for (const argument of node.arguments) {
                if (
                    ts.isObjectLiteralExpression(argument) &&
                    argument.properties.some(
                        (property) =>
                            property.name !== undefined &&
                            ts.isIdentifier(property.name) &&
                            property.name.text === 'cors',
                    )
                ) {
                    enables = true;
                }
            }
        }
    });

    return enables;
}

/**
 * Whether a source DECLARES the shared policy function. Pure.
 *
 * @param source - The file to read.
 * @returns `true` for the file that defines {@link POLICY_EXPORT}.
 */
function declaresSharedPolicy(source: SourceFile): boolean {
    let declares = false;

    visit(parse(source), (node) => {
        if (ts.isFunctionDeclaration(node) && node.name?.text === POLICY_EXPORT) {
            declares = true;
        }
    });

    return declares;
}

/**
 * The package a file belongs to: the nearest enclosing directory that holds a manifest. Pure.
 *
 * @param file - Repo-relative path.
 * @param manifestDirectories - Repo-relative directories that hold a `package.json`.
 * @returns The package directory, or `undefined` when no manifest encloses the file.
 */
function packageOf(file: string, manifestDirectories: ReadonlySet<string>): string | undefined {
    for (let directory = path.posix.dirname(file); directory !== '.'; directory = path.posix.dirname(directory)) {
        if (manifestDirectories.has(directory)) {
            return directory;
        }
    }

    return undefined;
}

/**
 * The cookie, session and WebSocket packages a manifest declares, runtime or dev. Pure.
 *
 * @param manifest - The parsed `package.json`.
 * @returns The offending package names, sorted.
 */
function manifestBreaks(manifest: {
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
}): readonly string[] {
    return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
        .filter((name) => COOKIE_MODULE.test(name) || CLERK_SESSION_MODULE.test(name) || WEBSOCKET_MODULE.test(name))
        .sort();
}

/** One workspace package, as {@link workspaceRuntimeClosure} reads it. */
interface WorkspaceManifest {
    /** Repo-relative directory holding its `package.json`. */
    readonly directory: string;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
}

/**
 * The directories of every workspace package `packageName` ships, followed through runtime `dependencies` to any
 * depth. Pure.
 *
 * Runtime only, on purpose: an image installs `dependencies`, so a dev-only package never handles a request, and
 * scanning one would report test harnesses that read cookies on purpose. A name with no workspace manifest is a
 * registry package and ends the walk there.
 *
 * @param packageName - The adopter's `name`.
 * @param workspace - Every workspace manifest, keyed by package name.
 * @returns The dependency directories, sorted, without the package's own.
 */
function workspaceRuntimeClosure(
    packageName: string,
    workspace: ReadonlyMap<string, WorkspaceManifest>,
): readonly string[] {
    const seen = new Set<string>([packageName]);
    const pending = [packageName];
    const directories: string[] = [];

    for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
        for (const dependency of Object.keys(workspace.get(name)?.dependencies ?? {})) {
            const manifest = workspace.get(dependency);

            if (manifest !== undefined && !seen.has(dependency)) {
                seen.add(dependency);
                pending.push(dependency);
                directories.push(manifest.directory);
            }
        }
    }

    return directories.sort();
}

// ───────────────────────────── the real tree ─────────────────────────────

/** Whether a path is a TypeScript source rather than a declaration file. */
function isTypeScriptSource(file: string): boolean {
    return /\.[cm]?tsx?$/u.test(file) && !file.endsWith('.d.ts');
}

/**
 * Read files, repo-relative.
 *
 * @param files - Repo-relative paths.
 * @returns Each file's path and text.
 * @sideEffect Reads the working tree.
 */
function readSources(files: readonly string[]): readonly SourceFile[] {
    return files.map((file) => ({ file, contents: readFileSync(path.join(repoRoot, file), 'utf8') }));
}

/**
 * Every non-test TypeScript source under a package, by walking the directory tree. Deliberately NOT the git
 * listing the scan uses, so the two can disagree when one of them is broken.
 *
 * @param packageDirectory - Repo-relative package directory.
 * @returns Repo-relative paths.
 * @sideEffect Reads the working tree.
 */
function walkPackage(packageDirectory: string): readonly string[] {
    const found: string[] = [];

    const walk = (relative: string): void => {
        for (const entry of readdirSync(path.join(repoRoot, relative), { withFileTypes: true })) {
            const child = path.posix.join(relative, entry.name);

            if (entry.isDirectory()) {
                if (!NON_SOURCE_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) {
                    walk(child);
                }
            } else if (isTypeScriptSource(child) && !isTestFile(child)) {
                found.push(child);
            }
        }
    };

    walk(packageDirectory);

    return found;
}

/** Every non-test TypeScript source under `packages/`, committed or not. */
const treeSources = readSources(
    presentFiles(['packages']).filter((file) => isTypeScriptSource(file) && !isTestFile(file)),
);

/** Every directory under `packages/` that holds a manifest. */
const manifestDirectories: ReadonlySet<string> = new Set(
    presentFiles(['packages'])
        .filter((file) => path.posix.basename(file) === 'package.json')
        .map((file) => path.posix.dirname(file)),
);

/** A `package.json`, as far as this guard reads one. */
interface PackageManifest {
    readonly name?: string;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
}

/**
 * Read one package's manifest.
 *
 * @param directory - Repo-relative package directory.
 * @returns The parsed manifest.
 * @sideEffect Reads the working tree.
 */
function readManifest(directory: string): PackageManifest {
    const parsed: PackageManifest = JSON.parse(readFileSync(path.join(repoRoot, directory, 'package.json'), 'utf8'));

    return parsed;
}

/** Every named workspace manifest, as `[name, manifest]` pairs, in directory order. */
const namedManifests: ReadonlyArray<readonly [string, WorkspaceManifest]> = [...manifestDirectories]
    .sort()
    .flatMap((directory) => {
        const { name, dependencies, devDependencies } = readManifest(directory);

        return name === undefined ? [] : [[name, { directory, dependencies, devDependencies }] as const];
    });

/** Every workspace package, keyed by name. */
const workspace: ReadonlyMap<string, WorkspaceManifest> = new Map(namedManifests);

/** The packages that adopt the shared policy, discovered. */
const adopters: readonly string[] = [
    ...new Set(
        treeSources
            .filter((source) => source.contents.includes(POLICY_EXPORT) && adoptsSharedPolicy(source))
            .flatMap((source) => packageOf(source.file, manifestDirectories) ?? []),
    ),
].sort();

/**
 * One adopter's scan: the non-test sources under its own `src/` and under the `src/` of every workspace package it
 * ships ({@link workspaceRuntimeClosure}). A cookie read in a shared middleware is as reachable as one in the service,
 * and a scan of the adopter alone passed it (security review F5).
 *
 * @param packageDirectory - Repo-relative package directory.
 * @returns The scanned sources.
 * @sideEffect Reads the working tree.
 */
function scanAdopter(packageDirectory: string): readonly SourceFile[] {
    const { name } = readManifest(packageDirectory);
    const shipped = name === undefined ? [] : workspaceRuntimeClosure(name, workspace);

    return readSources(
        presentFiles([packageDirectory, ...shipped].map((directory) => `${directory}/src`)).filter(
            (file) => isTypeScriptSource(file) && !isTestFile(file),
        ),
    );
}

// ───────────────────────────── the detectors, against shapes ─────────────────────────────

/** A one-file fixture. */
function source(contents: string): SourceFile {
    return { file: 'fixture.ts', contents };
}

describe('findPreconditionBreaks — every shape it must catch', () => {
    it.each<[string, string, PreconditionBreak, string]>([
        ['a cookie read', 'const t = req.cookies["__session"];', 'ambient-credential', 'req.cookies'],
        ['a bracketed cookie read', "const t = request['cookies'];", 'ambient-credential', "request['cookies']"],
        ['a raw cookie header read', 'const t = req.headers.cookie;', 'ambient-credential', 'req.headers.cookie'],
        ['a signed cookie read', 'const t = req.signedCookies.a;', 'ambient-credential', 'req.signedCookies'],
        ['a session read', 'const u = req.session.user;', 'ambient-credential', 'req.session'],
        ['setting a cookie', "res.cookie('a', 'b');", 'ambient-credential', 'res.cookie'],
        ["Express's req.get('cookie')", "const t = req.get('cookie');", 'ambient-credential', "req.get('cookie')"],
        [
            "Express's req.header('Cookie')",
            "const t = req.header('Cookie');",
            'ambient-credential',
            "req.header('Cookie')",
        ],
        [
            "Fetch's headers.get('cookie')",
            "const t = headers.get('cookie');",
            'ambient-credential',
            "headers.get('cookie')",
        ],
        [
            'a Set-Cookie header write',
            "res.setHeader('Set-Cookie', 'a=b');",
            'ambient-credential',
            "res.setHeader('Set-Cookie')",
        ],
        [
            'a cookie-parser import',
            "import cookieParser from 'cookie-parser';",
            'ambient-credential',
            "import 'cookie-parser'",
        ],
        [
            'an express-session import',
            "import session from 'express-session';",
            'ambient-credential',
            "import 'express-session'",
        ],
        [
            'a fastify cookie import',
            "import cookie from '@fastify/cookie';",
            'ambient-credential',
            "import '@fastify/cookie'",
        ],
        ['a cookie re-export', "export { parse } from 'cookie';", 'ambient-credential', "import 'cookie'"],
        ['a cookie require', "const c = require('cookie');", 'ambient-credential', "import 'cookie'"],
        [
            'a dynamic session import',
            "const s = await import('iron-session');",
            'ambient-credential',
            "import 'iron-session'",
        ],
        ['a ws import', "import { WebSocketServer as S } from 'ws';", 'websocket-upgrade', "import 'ws'"],
        ['a socket.io import', "import { Server } from 'socket.io';", 'websocket-upgrade', "import 'socket.io'"],
        [
            'a Nest websockets import',
            "import { OnGatewayInit } from '@nestjs/websockets';",
            'websocket-upgrade',
            "import '@nestjs/websockets'",
        ],
        [
            'a Nest ws platform import',
            "import { WsAdapter } from '@nestjs/platform-ws';",
            'websocket-upgrade',
            "import '@nestjs/platform-ws'",
        ],
        ['a Nest gateway decorator', '@WebSocketGateway()\nclass G {}', 'websocket-upgrade', 'WebSocketGateway'],
        [
            'a message handler decorator',
            "class G { @SubscribeMessage('m') h(): void {} }",
            'websocket-upgrade',
            'SubscribeMessage',
        ],
        [
            'an upgrade listener',
            "server.on('upgrade', (req, socket) => socket.end());",
            'websocket-upgrade',
            "server.on('upgrade')",
        ],
        [
            'a one-shot upgrade listener',
            "server.once('Upgrade', handle);",
            'websocket-upgrade',
            "server.once('Upgrade')",
        ],
        ['an upgrade handoff', 'wss.handleUpgrade(req, socket, head, done);', 'websocket-upgrade', 'wss.handleUpgrade'],
        [
            "Nest's adapter seam",
            'app.useWebSocketAdapter(new WsAdapter(app));',
            'websocket-upgrade',
            'app.useWebSocketAdapter',
        ],
        ['an Upgrade header read', 'const u = req.headers.upgrade;', 'websocket-upgrade', 'req.headers.upgrade'],
        [
            'a bracketed Upgrade header read',
            "const u = req.headers['upgrade'];",
            'websocket-upgrade',
            "req.headers['upgrade']",
        ],
        [
            'a websocket key read',
            "const k = req.get('Sec-WebSocket-Key');",
            'websocket-upgrade',
            "req.get('Sec-WebSocket-Key')",
        ],
        // Clerk's request authenticators read the `__session` COOKIE when no bearer is sent, so either one in an
        // adopter, or in a package it imports, is an ambient credential read by another name (security review F5).
        [
            "@clerk/backend's member-call authenticator",
            'const state = await clerkClient.authenticateRequest(req, { jwtKey });',
            'ambient-credential',
            'clerkClient.authenticateRequest',
        ],
        [
            'a bare authenticateRequest call',
            'const state = await authenticateRequest(req, options);',
            'ambient-credential',
            'authenticateRequest',
        ],
        [
            'an authenticateRequest import',
            "import { authenticateRequest as auth } from '@clerk/backend';",
            'ambient-credential',
            'authenticateRequest',
        ],
        ["Clerk's Express middleware", 'app.use(clerkMiddleware());', 'ambient-credential', 'clerkMiddleware'],
        [
            "a clerkMiddleware import from Clerk's Express SDK",
            "import { requireAuth } from '@clerk/express';",
            'ambient-credential',
            "import '@clerk/express'",
        ],
        [
            "a require of Clerk's Express SDK",
            "const clerk = require('@clerk/express');",
            'ambient-credential',
            "import '@clerk/express'",
        ],
        [
            "a subpath of Clerk's Express SDK",
            "import { getAuth } from '@clerk/express/webhooks';",
            'ambient-credential',
            "import '@clerk/express/webhooks'",
        ],
    ])('catches %s', (_label, contents, kind, what) => {
        expect(findPreconditionBreaks(source(contents))).toContainEqual(expect.objectContaining({ kind, what }));
    });

    it('reports the line of a read nested deep inside a class method', () => {
        const contents = [
            'class Guard {',
            '    public check(req: { headers: Record<string, string> }): boolean {',
            '        if (req.headers) {',
            '            return Boolean(req.headers.cookie);',
            '        }',
            '        return false;',
            '    }',
            '}',
        ].join('\n');

        expect(findPreconditionBreaks(source(contents))).toContainEqual({
            kind: 'ambient-credential',
            what: 'req.headers.cookie',
            line: 4,
        });
    });
});

describe('findPreconditionBreaks — what it must NOT report', () => {
    // ⛔ The property that makes the gate trustworthy. A text search reports every one of these.
    it.each([
        ['a block comment', '/** Reads req.cookies and accepts an upgrade — never. */\nexport const a = 1;'],
        ['a line comment', "// server.on('upgrade') and req.session are forbidden here\nexport const a = 1;"],
        ['a sentence in a string', "export const m = 'req.cookies and req.headers.upgrade are forbidden';"],
        ['a template literal', 'export const m = `cookies: ${1}`;'],
        ['an unrelated property that contains the word', 'const a = policy.cookiePolicyName + x.sessionId;'],
        ['a property that merely starts with upgrade', 'const a = release.upgradeAvailable;'],
        ['an upgrade property that is not a header', 'const a = migration.upgrade;'],
        ['an ordinary stream listener', "socket.on('data', handle);"],
        ['a log line that mentions a cookie', "logger.warn('no cookie was read');"],
        [
            'a module whose name only contains the word',
            "import x from 'cookiecutter';\nimport y from 'news';\nimport z from '@scope/sessionless';",
        ],
        ['an AWS SDK import', "import { S3Client } from '@aws-sdk/client-s3';"],
        ['the bearer header itself', "const b = req.headers['authorization'];"],
        // The networkless bearer check every adopter uses. It reads the token it is handed and nothing else.
        ["@clerk/backend's bearer-only verifier", "import { verifyToken } from '@clerk/backend';\nverifyToken(t, o);"],
        [
            'a Clerk authenticator named in a comment',
            '// never call authenticateRequest or clerkMiddleware\nconst a = 1;',
        ],
        [
            'a Clerk authenticator named in a string',
            "export const banned = ['authenticateRequest', 'clerkMiddleware'];",
        ],
        ['another Clerk package whose name is a prefix', "import type { User } from '@clerk/express-types';"],
    ])('reports nothing for %s', (_label, contents) => {
        expect(findPreconditionBreaks(source(contents))).toEqual([]);
    });
});

describe('readsBearerHeader — finding the authentication entry point', () => {
    it.each([
        ['a bracketed read', "const b = req.headers['authorization'];"],
        ['a dotted read', 'const b = request.headers.authorization;'],
        ['a capitalised bracketed read', "const b = req.headers['Authorization'];"],
        ["Express's req.get", "const b = req.get('Authorization');"],
        ["Fetch's headers.get", "const b = event.headers.get('authorization');"],
    ])('finds %s', (_label, contents) => {
        expect(readsBearerHeader(source(contents))).toBe(true);
    });

    it.each([
        ['a comment', '// reads req.headers.authorization\nexport const a = 1;'],
        ['a string', "export const redact = ['authorization'];"],
        ['a non-header property', 'const a = policy.authorization;'],
        ['setting the header on an outbound call', "fetch(url, { headers: { authorization: 'Bearer x' } });"],
    ])('does not mistake %s for an entry point', (_label, contents) => {
        expect(readsBearerHeader(source(contents))).toBe(false);
    });
});

describe('adoptsSharedPolicy / declaresSharedPolicy — discovering the subjects', () => {
    it.each([
        [
            'a named import and call',
            "import { resolveCorsPolicy } from '@kitchensink/clerk-verify';\nresolveCorsPolicy(i);",
        ],
        ['an aliased import', "import { resolveCorsPolicy as policy } from '@kitchensink/clerk-verify';"],
        ['a namespace call', "import * as cv from '@kitchensink/clerk-verify';\ncv.resolveCorsPolicy(i);"],
        ['an import that is not called yet', "import { resolveCorsPolicy } from '@kitchensink/clerk-verify';"],
    ])('counts %s as adoption', (_label, contents) => {
        expect(adoptsSharedPolicy(source(contents))).toBe(true);
    });

    it.each([
        ['a comment', '// resolveCorsPolicy is the shared policy\nexport const a = 1;'],
        ['a string', "export const name = 'resolveCorsPolicy';"],
        ['a re-export', "export { resolveCorsPolicy } from './corsPolicy.js';"],
        ['the declaration', 'export function resolveCorsPolicy(input: unknown): unknown { return input; }'],
        ['an unrelated import from the same package', "import { verifyClerkToken } from '@kitchensink/clerk-verify';"],
    ])('does not count %s as adoption', (_label, contents) => {
        expect(adoptsSharedPolicy(source(contents))).toBe(false);
    });

    it('finds the declaration and only the declaration', () => {
        expect(
            declaresSharedPolicy(source('export function resolveCorsPolicy(i: unknown): unknown { return i; }')),
        ).toBe(true);
        expect(declaresSharedPolicy(source("import { resolveCorsPolicy } from '@kitchensink/clerk-verify';"))).toBe(
            false,
        );
    });
});

describe('enablesCors — every way to turn CORS on', () => {
    it.each([
        ["Nest's enableCors", 'app.enableCors(options);'],
        ["NestFactory's cors option", 'const app = await NestFactory.create(AppModule, { cors: true });'],
        ['the cors middleware', "import cors from 'cors';"],
    ])('finds %s', (_label, contents) => {
        expect(enablesCors(source(contents))).toBe(true);
    });

    it.each([
        ['a comment', '// app.enableCors() is not called here\nexport const a = 1;'],
        ['a cors key on an unrelated object', 'const o = { cors: true };'],
        ['a module whose name contains the word', "import x from 'cors-anywhere-docs';"],
    ])('does not mistake %s for enabling CORS', (_label, contents) => {
        expect(enablesCors(source(contents))).toBe(false);
    });
});

describe('packageOf and manifestBreaks', () => {
    const manifests = new Set(['packages/services/a', 'packages/services/a/infra', 'packages/shared/b']);

    it('maps a file to its NEAREST manifest', () => {
        expect(packageOf('packages/services/a/src/main.ts', manifests)).toBe('packages/services/a');
        expect(packageOf('packages/services/a/infra/lib/Stack.ts', manifests)).toBe('packages/services/a/infra');
        expect(packageOf('packages/shared/b/src/x.ts', manifests)).toBe('packages/shared/b');
    });

    it('maps a file under no manifest to nothing, and never to a sibling whose name is a prefix', () => {
        expect(packageOf('packages/services/ab/src/main.ts', manifests)).toBeUndefined();
    });

    it('reports cookie, session and WebSocket packages in either dependency block', () => {
        expect(
            manifestBreaks({
                dependencies: { '@nestjs/common': '^11', 'cookie-parser': '^1', ws: '^8' },
                devDependencies: { 'express-session': '^1', vitest: '^4' },
            }),
        ).toEqual(['cookie-parser', 'express-session', 'ws']);
    });

    it('reports nothing for a clean manifest', () => {
        expect(manifestBreaks({ dependencies: { '@nestjs/common': '^11', '@aws-sdk/client-s3': '^3' } })).toEqual([]);
    });

    it("reports Clerk's Express SDK, whose middleware authenticates from the session cookie", () => {
        expect(manifestBreaks({ dependencies: { '@clerk/backend': '^3', '@clerk/express': '^1' } })).toEqual([
            '@clerk/express',
        ]);
    });
});

describe('workspaceRuntimeClosure — the workspace packages an adopter ships', () => {
    /** A manifest table, keyed by package name, the way the real tree is read. */
    const workspace = new Map<string, WorkspaceManifest>([
        [
            '@ks/service',
            {
                directory: 'packages/services/service',
                dependencies: { '@ks/auth': '*', '@ks/logging': '*', express: '^5' },
                devDependencies: { '@ks/test-harness': '*' },
            },
        ],
        ['@ks/auth', { directory: 'packages/shared/auth', dependencies: { '@ks/core': '*', '@clerk/backend': '^3' } }],
        ['@ks/core', { directory: 'packages/shared/core', dependencies: { '@ks/auth': '*' } }],
        ['@ks/logging', { directory: 'packages/shared/logging' }],
        ['@ks/test-harness', { directory: 'packages/tools/test-harness', dependencies: { '@ks/cookie-jar': '*' } }],
        ['@ks/cookie-jar', { directory: 'packages/tools/cookie-jar' }],
    ]);

    it('follows runtime dependencies transitively, across a cycle, and stops at the workspace edge', () => {
        expect(workspaceRuntimeClosure('@ks/service', workspace)).toEqual([
            'packages/shared/auth',
            'packages/shared/core',
            'packages/shared/logging',
        ]);
    });

    // An image ships `dependencies` only. A dev-only package never reaches a request, so scanning it would report
    // test harnesses that read cookies on purpose.
    it('does not follow devDependencies', () => {
        expect(workspaceRuntimeClosure('@ks/service', workspace)).not.toContain('packages/tools/test-harness');
    });

    it('excludes the package itself, which the adopter scan already reads', () => {
        expect(workspaceRuntimeClosure('@ks/core', workspace)).toEqual(['packages/shared/auth']);
    });

    it('is empty for a package with no workspace dependency', () => {
        expect(workspaceRuntimeClosure('@ks/logging', workspace)).toEqual([]);
    });
});

// ───────────────────────────── the real tree ─────────────────────────────

describe('the real tree — discovery', () => {
    // ⛔ NON-VACUITY FIRST. If the walk read nothing, every "found nothing" below would pass.
    it('reads the shared policy’s own declaration, so the walk reaches packages/shared', () => {
        const declarers = treeSources.filter((candidate) => declaresSharedPolicy(candidate)).map(({ file }) => file);

        expect(declarers).toEqual(['packages/shared/clerk-verify/src/corsPolicy.ts']);
    });

    // The closure maps a dependency's NAME to its directory, so two manifests with one name would make it scan the
    // wrong one in silence.
    it('finds every workspace package name exactly once', () => {
        const names = namedManifests.map(([name]) => name);

        expect(names.length).toBeGreaterThan(0);
        expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
    });

    it('discovers at least one adopter, each a package with a manifest', () => {
        expect(adopters.length).toBeGreaterThan(0);

        for (const adopter of adopters) {
            expect(existsSync(path.join(repoRoot, adopter, 'package.json')), adopter).toBe(true);
        }
    });

    it('every package that turns CORS on adopts the shared policy, so none escapes this guard', () => {
        const enabling = [
            ...new Set(
                treeSources
                    .filter((candidate) => enablesCors(candidate))
                    .flatMap((candidate) => packageOf(candidate.file, manifestDirectories) ?? []),
            ),
        ].sort();

        expect(enabling.length).toBeGreaterThan(0);
        expect(enabling.filter((name) => !adopters.includes(name))).toEqual([]);
    });
});

describe.each(adopters)('%s — bearer-only precondition', (adopter) => {
    const scanned = scanAdopter(adopter);
    const scannedFiles = new Set(scanned.map(({ file }) => file));

    // ⛔ NON-VACUITY for the widened scan. Every adopter imports the policy from the package that declares it, so a
    // closure that reached nothing past the adopter would still leave "found nothing" green. The declaring package
    // must be in the scan.
    it('reached the src of the packages it ships, including the one that declares the policy', () => {
        const declaringPackage = treeSources
            .filter((candidate) => declaresSharedPolicy(candidate))
            .flatMap((candidate) => packageOf(candidate.file, manifestDirectories) ?? []);

        expect(declaringPackage).toHaveLength(1);
        expect(
            [...scannedFiles].filter((file) => file.startsWith(`${declaringPackage[0]}/src/`)).length,
        ).toBeGreaterThan(0);
    });

    it('reached the code that reads the bearer, found by an independent walk of the whole package', () => {
        const entryPoints = readSources(walkPackage(adopter))
            .filter((candidate) => readsBearerHeader(candidate))
            .map(({ file }) => file);

        expect(entryPoints.length, `${adopter} reads no Authorization header anywhere`).toBeGreaterThan(0);
        expect(entryPoints.filter((file) => !scannedFiles.has(file))).toEqual([]);
    });

    it('reads no cookie or session, and accepts no WebSocket upgrade, in its src/ or any src/ it ships', () => {
        const findings = scanned.flatMap((candidate) =>
            findPreconditionBreaks(candidate).map(
                (found) => `${candidate.file}:${found.line} — ${found.kind}: ${found.what}`,
            ),
        );

        // If this fails, do not delete the assertion. Read ADR-0047 first: a route that reads an ambient credential or
        // accepts an upgrade makes the shared policy's permissive branches exploitable for this package, and the policy
        // must be re-derived in the same change.
        expect(findings).toEqual([]);
    });

    it('declares no cookie, session or WebSocket package', () => {
        const manifest = JSON.parse(readFileSync(path.join(repoRoot, adopter, 'package.json'), 'utf8')) as Parameters<
            typeof manifestBreaks
        >[0];

        expect(manifestBreaks(manifest)).toEqual([]);
    });
});
