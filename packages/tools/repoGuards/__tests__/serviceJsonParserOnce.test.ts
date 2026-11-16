/**
 * ONE PLACE OWNS A SERVICE'S JSON BODY SETUP: `jsonBodyHttpSetup` in `@kitchensink/nest-http-setup`.
 *
 * The ordered setup (CORS, then `express.json`, then `stripBodyParserRefusal`, with Nest's own parser off) is one piece
 * of knowledge. It was written out three times, once per service, and would have changed for the same reasons in all
 * three: a parser registered ahead of CORS answers a browser's refusal with no `access-control-allow-origin`, and a
 * parser with no strip link publishes the request text in its error. Three things hold it there, each read through the
 * TypeScript parser (never a regex over text), so a comment or a string that names a call is not a call:
 *
 * 1. no service calls `express.json(…)` itself;
 * 2. every `NestFactory.create(…)` under a service `src` passes exactly what a `jsonBodyHttpSetup(…)` result's
 *    `nestOptions(…)` returns, which is what guarantees `bodyParser: false` — without it Nest parses the body first and
 *    the refusal is rewritten. A literal around that result is refused, because a key beside it could turn it back on;
 * 3. no service imports `body-parser` or calls `useBodyParser(…)`, the other doors to a second parser.
 *
 * Calls are matched through the import binding, so `response.json(…)` on a Nest response is not mistaken for the parser
 * and a renamed or namespace import is still found.
 *
 * @module
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { valueBindingsOf } from './moduleBindings.js';
import { nestFactoryCreateCalls } from './nestFactoryCreateCalls.js';
import {
    isTestFile,
    moduleSpecifiers,
    parse,
    presentFiles,
    repoRoot,
    SERVICES_ROOT,
    visit,
    type SourceFile,
} from './serviceSources.js';

/** The shared setup's package. */
const SETUP_PACKAGE = '@kitchensink/nest-http-setup';

/**
 * The calls in a source that invoke the JSON parser of the `express` package: `express.json(…)` through a default or
 * namespace import under any local name, or a named `json` import called directly. Pure.
 *
 * @param source - The file to read.
 * @returns The source text of each call, in source order.
 */
function expressJsonCalls(source: SourceFile): readonly string[] {
    const parsed = parse(source);
    const bindings = valueBindingsOf(parsed, (specifier) => specifier === 'express');
    const objects = new Set([...bindings.namespaces, ...bindings.defaults.keys()]);
    const direct = bindings.locals.get('json') ?? new Set<string>();
    const calls: string[] = [];

    visit(parsed, (node) => {
        if (!ts.isCallExpression(node)) {
            return;
        }

        const callee = node.expression;
        const viaObject =
            ts.isPropertyAccessExpression(callee) &&
            callee.name.text === 'json' &&
            ts.isIdentifier(callee.expression) &&
            objects.has(callee.expression.text);

        if (viaObject || (ts.isIdentifier(callee) && direct.has(callee.text))) {
            calls.push(node.getText(parsed));
        }
    });

    return calls;
}

/**
 * The second ways to a second body parser: an import of `body-parser` and a `useBodyParser(…)` call. Pure.
 *
 * @param source - The file to read.
 * @returns A description of each, in source order.
 */
function secondParserUses(source: SourceFile): readonly string[] {
    const parsed = parse(source);
    const uses = moduleSpecifiers(source)
        .filter((specifier) => specifier === 'body-parser')
        .map((specifier) => `imports ${specifier}`);

    visit(parsed, (node) => {
        if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'useBodyParser'
        ) {
            uses.push('calls useBodyParser');
        }
    });

    return uses;
}

/**
 * Whether `name`, imported by `source` from a relative module, is declared there as `jsonBodyHttpSetup(…)`'s result.
 * Pure over the files handed in.
 *
 * @param source - The importing file.
 * @param name - The local binding.
 * @param files - Every file's contents, keyed by repo-relative path.
 * @returns `true` when the binding is a shared setup.
 */
function isSharedSetup(source: SourceFile, name: string, files: ReadonlyMap<string, string>): boolean {
    for (const statement of parse(source).statements) {
        const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;

        if (
            !ts.isImportDeclaration(statement) ||
            !ts.isStringLiteral(statement.moduleSpecifier) ||
            !statement.moduleSpecifier.text.startsWith('.') ||
            bindings === undefined ||
            !ts.isNamedImports(bindings)
        ) {
            continue;
        }

        const element = bindings.elements.find((candidate) => candidate.name.text === name);

        if (element !== undefined) {
            const target = path.posix.join(
                path.posix.dirname(source.file),
                statement.moduleSpecifier.text.replace(/\.js$/, '.ts'),
            );

            return declaresSharedSetup(target, files.get(target), (element.propertyName ?? element.name).text);
        }
    }

    return false;
}

/**
 * Whether a file declares `exported` as a call of the shared factory. Pure.
 *
 * @param file - The file's repo-relative path.
 * @param contents - Its contents, or `undefined` when it was not found.
 * @param exported - The declared name.
 * @returns `true` when `exported = jsonBodyHttpSetup(…)` with the factory imported from the shared package.
 */
function declaresSharedSetup(file: string, contents: string | undefined, exported: string): boolean {
    if (contents === undefined) {
        return false;
    }

    const declared = parse({ file, contents });
    const factory = valueBindingsOf(declared, (specifier) => specifier === SETUP_PACKAGE).locals.get(
        'jsonBodyHttpSetup',
    );
    let shared = false;

    visit(declared, (node) => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === exported &&
            node.initializer !== undefined &&
            ts.isCallExpression(node.initializer) &&
            ts.isIdentifier(node.initializer.expression) &&
            factory?.has(node.initializer.expression.text) === true
        ) {
            shared = true;
        }
    });

    return shared;
}

/**
 * The `NestFactory.create(…)` calls in a source that do NOT pass exactly a shared setup's `nestOptions(…)` result.
 * Pure over the files handed in.
 *
 * @param source - The file to read.
 * @param files - Every file's contents, keyed by repo-relative path, to resolve the setup's declaration.
 * @returns The source text of each offending call, in source order, and the number of calls seen.
 */
function createCallsWithoutSharedOptions(
    source: SourceFile,
    files: ReadonlyMap<string, string>,
): { readonly seen: number; readonly offenders: readonly string[] } {
    const parsed = parse(source);
    const calls = nestFactoryCreateCalls(parsed);
    const offenders: string[] = [];

    calls.forEach((node) => {
        // The options must be the shared call's result, untouched: any literal around it could set `bodyParser` again,
        // by a plain or a computed key, so no literal is accepted at all.
        const options = node.arguments[1];
        const isSharedOptions =
            options !== undefined &&
            ts.isCallExpression(options) &&
            ts.isPropertyAccessExpression(options.expression) &&
            options.expression.name.text === 'nestOptions' &&
            ts.isIdentifier(options.expression.expression) &&
            isSharedSetup(source, options.expression.expression.text, files);

        if (!isSharedOptions) {
            offenders.push(node.getText(parsed));
        }
    });

    return { seen: calls.length, offenders };
}

const at = (contents: string, file = 'packages/services/x/src/a.ts'): SourceFile => ({ file, contents });

describe('expressJsonCalls — what counts as a service parsing its own JSON', () => {
    it.each([
        ['a default import', "import express from 'express';\napp.use(express.json({ limit: '1mb' }));"],
        ['a renamed default import', "import e from 'express';\napp.use(e.json());"],
        ['a namespace import', "import * as ex from 'express';\napp.use(ex.json());"],
        ['a named import', "import { json } from 'express';\napp.use(json());"],
        ['a renamed named import', "import { json as parseJson } from 'express';\napp.use(parseJson());"],
    ])('finds %s', (_label, contents) => {
        expect(expressJsonCalls(at(contents))).toHaveLength(1);
    });

    it.each([
        ['a comment', "import express from 'express';\n// app.use(express.json());\nexport const a = 1;"],
        ['a string', "export const a = 'express.json()';"],
        ['a response that answers JSON', 'export const a = (response) => response.json({});'],
        ['a type-only import', "import type { json } from 'express';\nexport const a = json;"],
        ['a type-only named import', "import { type json } from 'express';\nexport const a = json;"],
        ['another module’s json', "import other from 'other';\nexport const a = other.json();"],
    ])('does not mistake %s for the parser', (_label, contents) => {
        expect(expressJsonCalls(at(contents))).toEqual([]);
    });
});

describe('secondParserUses — the other doors to a second body parser', () => {
    it.each([
        ['an import of body-parser', "import { json } from 'body-parser';"],
        ['a default import of body-parser', "import bodyParser from 'body-parser';"],
        ['a useBodyParser call', "app.useBodyParser('json', { limit: '1mb' });"],
    ])('finds %s', (_label, contents) => {
        expect(secondParserUses(at(contents))).toHaveLength(1);
    });

    it.each([
        ['a comment', "// app.useBodyParser('json');\nexport const a = 1;"],
        ['a module that only contains the name', "import x from 'body-parser-docs';"],
    ])('does not mistake %s', (_label, contents) => {
        expect(secondParserUses(at(contents))).toEqual([]);
    });
});

describe('createCallsWithoutSharedOptions — Nest must be created with the shared nestOptions', () => {
    const setupFile = 'packages/services/x/src/config/httpSetup.ts';
    const shared = `import { jsonBodyHttpSetup } from '${SETUP_PACKAGE}';\nexport const X_SETUP = jsonBodyHttpSetup(() => policy());\n`;
    const files = (setup: string): ReadonlyMap<string, string> => new Map([[setupFile, setup]]);
    const main = (create: string): SourceFile =>
        at(
            `import { NestFactory } from '@nestjs/core';\nimport { X_SETUP } from './config/httpSetup.js';\nawait ${create};\n`,
            'packages/services/x/src/main.ts',
        );

    it('accepts the options the shared setup returns', () => {
        const result = createCallsWithoutSharedOptions(
            main('NestFactory.create(AppModule, X_SETUP.nestOptions({ logger }))'),
            files(shared),
        );

        expect(result).toEqual({ seen: 1, offenders: [] });
    });

    it.each([
        ['no options', 'NestFactory.create(AppModule)'],
        ['options without the spread', 'NestFactory.create(AppModule, { logger })'],
        ['a hand-written bodyParser: false', 'NestFactory.create(AppModule, { bodyParser: false, logger })'],
        ['a spread of another member', 'NestFactory.create(AppModule, { ...X_SETUP.configure, logger })'],
        // The verification review's probes: a property beside the shared options overrides them.
        [
            'bodyParser: true beside the spread',
            'NestFactory.create(AppModule, { ...X_SETUP.nestOptions, bodyParser: true })',
        ],
        [
            'a computed bodyParser key beside the spread',
            "NestFactory.create(AppModule, { ...X_SETUP.nestOptions, ['bodyParser']: true })",
        ],
        [
            'bodyParser: true beside the returned options',
            'NestFactory.create(AppModule, { ...X_SETUP.nestOptions({ logger }), bodyParser: true })',
        ],
        [
            'a computed bodyParser key beside the returned options',
            "NestFactory.create(AppModule, { ...X_SETUP.nestOptions({}), ['bodyParser']: true })",
        ],
        ['another member called', 'NestFactory.create(AppModule, X_SETUP.configure({ logger }))'],
    ])('flags %s', (_label, create) => {
        const result = createCallsWithoutSharedOptions(main(create), files(shared));

        expect(result.seen).toBe(1);
        expect(result.offenders).toHaveLength(1);
    });

    it('flags a setup that is not the shared factory’s result', () => {
        const hand = 'export const X_SETUP = { nestOptions: { bodyParser: false }, configure: () => undefined };\n';
        const result = createCallsWithoutSharedOptions(
            main('NestFactory.create(AppModule, X_SETUP.nestOptions({}))'),
            files(hand),
        );

        expect(result.offenders).toHaveLength(1);
    });

    it('flags a setup whose file cannot be found', () => {
        const result = createCallsWithoutSharedOptions(
            main('NestFactory.create(AppModule, X_SETUP.nestOptions({}))'),
            new Map(),
        );

        expect(result.offenders).toHaveLength(1);
    });

    // Other spellings of the same call are counted, so none is a way past the check.
    it.each([
        ['an element access', "NestFactory['create'](AppModule)"],
        ['a local alias of NestFactory', 'F.create(AppModule)', 'const F = NestFactory;\n'],
        ['an alias of an alias', 'G.create(AppModule)', 'const F = NestFactory;\nconst G = F;\n'],
    ])('counts and flags %s', (_label, create, before = '') => {
        const source = main(create);
        const result = createCallsWithoutSharedOptions(
            { ...source, contents: source.contents.replace('await ', `${before}await `) },
            files(shared),
        );

        expect(result).toMatchObject({ seen: 1, offenders: [expect.any(String)] });
    });

    it.each([
        ['an element access', "NestFactory['create'](AppModule, X_SETUP.nestOptions({}))"],
        ['a renamed import', 'F.create(AppModule, X_SETUP.nestOptions({}))'],
    ])('accepts %s that passes the shared options', (_label, create) => {
        const source = main(create);
        const renamed = create.startsWith('F.')
            ? { ...source, contents: source.contents.replace('{ NestFactory }', '{ NestFactory as F }') }
            : source;

        expect(createCallsWithoutSharedOptions(renamed, files(shared))).toEqual({ seen: 1, offenders: [] });
    });

    it('ignores a create that is not NestFactory’s', () => {
        const result = createCallsWithoutSharedOptions(
            at("import { Other } from 'other';\nOther.create(AppModule);"),
            new Map(),
        );

        expect(result).toEqual({ seen: 0, offenders: [] });
    });
});

describe('every service uses the shared JSON body setup', () => {
    const paths = presentFiles([SERVICES_ROOT]).filter(
        (file) => /\/src\/.*\.(ts|tsx)$/.test(file) && !isTestFile(file),
    );
    const files = new Map(paths.map((file) => [file, readFileSync(path.join(repoRoot, file), 'utf8')] as const));
    const sources = paths.map((file) => ({ file, contents: files.get(file) ?? '' }));

    // ⛔ NON-VACUITY: an empty scan would pass for any reason.
    it('scans the services’ production sources', () => {
        expect(sources.length).toBeGreaterThan(100);
    });

    it('⛔ finds no express.json call: the shared jsonBodyHttpSetup holds the one registration', () => {
        const offenders = sources.flatMap((candidate) =>
            expressJsonCalls(candidate).map((call) => `${candidate.file}: ${call}`),
        );

        expect(offenders).toEqual([]);
    });

    it('⛔ creates every Nest app with exactly the options the shared setup’s nestOptions returns', () => {
        const results = sources.map((candidate) => ({
            file: candidate.file,
            ...createCallsWithoutSharedOptions(candidate, files),
        }));

        // The three browser-facing services each create one app; a fourth that does not use the setup is a failure below.
        expect(results.reduce((total, { seen }) => total + seen, 0)).toBeGreaterThanOrEqual(3);
        expect(results.flatMap(({ file, offenders }) => offenders.map((call) => `${file}: ${call}`))).toEqual([]);
    });

    it('⛔ never opens a second door to a body parser', () => {
        const offenders = sources.flatMap((candidate) =>
            secondParserUses(candidate).map((use) => `${candidate.file}: ${use}`),
        );

        expect(offenders).toEqual([]);
    });
});
