/**
 * ONE PLACE REGISTERS A SERVICE'S JSON BODY PARSER: `jsonBodyHttpSetup` in `@kitchensink/nest-error-envelope`.
 *
 * The ordered setup (CORS, then `express.json`, then `stripBodyParserRefusal`) is one piece of knowledge. It was written
 * out three times, once per service, and would have changed for the same reasons in all three: a parser registered
 * ahead of CORS answers a browser's refusal with no `access-control-allow-origin`, and a parser with no strip link
 * publishes the request text in its error. A service that calls `express.json(…)` itself has stepped outside that order,
 * so this fails on any such call under any service's `src`.
 *
 * It reads each file through the TypeScript parser (`serviceSources`), so a comment or a string that names
 * `express.json(` is not a call, and it follows the import: only a binding imported from `express` counts, so
 * `response.json(…)` on a Nest response is not mistaken for the parser.
 *
 * @module
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { isTestFile, parse, presentFiles, SERVICES_ROOT, visit, repoRoot, type SourceFile } from './serviceSources.js';

/**
 * The calls in a source that invoke the JSON parser of the `express` package: `express.json(…)` through a default or
 * namespace import under any local name, or a named `json` import called directly. Pure.
 *
 * @param source - The file to read.
 * @returns The source text of each call, in source order.
 */
function expressJsonCalls(source: SourceFile): readonly string[] {
    const parsed = parse(source);
    const expressNamespaces = new Set<string>();
    const jsonFunctions = new Set<string>();

    for (const statement of parsed.statements) {
        if (
            !ts.isImportDeclaration(statement) ||
            !ts.isStringLiteral(statement.moduleSpecifier) ||
            statement.moduleSpecifier.text !== 'express' ||
            statement.importClause === undefined ||
            statement.importClause.isTypeOnly
        ) {
            continue;
        }

        const { name, namedBindings } = statement.importClause;

        if (name !== undefined) {
            expressNamespaces.add(name.text);
        }

        if (namedBindings !== undefined && ts.isNamespaceImport(namedBindings)) {
            expressNamespaces.add(namedBindings.name.text);
        }

        if (namedBindings !== undefined && ts.isNamedImports(namedBindings)) {
            for (const element of namedBindings.elements) {
                if (!element.isTypeOnly && (element.propertyName ?? element.name).text === 'json') {
                    jsonFunctions.add(element.name.text);
                }
            }
        }
    }

    const calls: string[] = [];

    visit(parsed, (node) => {
        if (!ts.isCallExpression(node)) {
            return;
        }

        const callee = node.expression;
        const viaNamespace =
            ts.isPropertyAccessExpression(callee) &&
            callee.name.text === 'json' &&
            ts.isIdentifier(callee.expression) &&
            expressNamespaces.has(callee.expression.text);
        const viaNamedImport = ts.isIdentifier(callee) && jsonFunctions.has(callee.text);

        if (viaNamespace || viaNamedImport) {
            calls.push(node.getText(parsed));
        }
    });

    return calls;
}

describe('expressJsonCalls — what counts as a service parsing its own JSON', () => {
    const source = (contents: string): SourceFile => ({ file: 'packages/services/x/src/a.ts', contents });

    it.each([
        ['a default import', "import express from 'express';\napp.use(express.json({ limit: '1mb' }));"],
        ['a renamed default import', "import e from 'express';\napp.use(e.json());"],
        ['a namespace import', "import * as ex from 'express';\napp.use(ex.json());"],
        ['a named import', "import { json } from 'express';\napp.use(json());"],
        ['a renamed named import', "import { json as parseJson } from 'express';\napp.use(parseJson());"],
    ])('finds %s', (_label, contents) => {
        expect(expressJsonCalls(source(contents))).toHaveLength(1);
    });

    it.each([
        ['a comment', "import express from 'express';\n// app.use(express.json());\nexport const a = 1;"],
        ['a string', "export const a = 'express.json()';"],
        ['a response that answers JSON', 'export const a = (response) => response.json({});'],
        ['an import of the type alone', "import type { json } from 'express';\nexport const a = json;"],
        ['another module’s json', "import other from 'other';\nexport const a = other.json();"],
    ])('does not mistake %s for the parser', (_label, contents) => {
        expect(expressJsonCalls(source(contents))).toEqual([]);
    });
});

describe('no service registers express.json itself', () => {
    const serviceSources = presentFiles([SERVICES_ROOT])
        .filter((file) => /\/src\/.*\.(ts|tsx)$/.test(file) && !isTestFile(file))
        .map((file) => ({ file, contents: readFileSync(path.join(repoRoot, file), 'utf8') }));

    // ⛔ NON-VACUITY: an empty scan would pass for any reason.
    it('scans the services’ production sources', () => {
        expect(serviceSources.length).toBeGreaterThan(100);
    });

    it('⛔ finds no express.json call: the shared jsonBodyHttpSetup holds the one registration', () => {
        const offenders = serviceSources.flatMap((candidate) =>
            expressJsonCalls(candidate).map((call) => `${candidate.file}: ${call}`),
        );

        expect(offenders).toEqual([]);
    });
});
