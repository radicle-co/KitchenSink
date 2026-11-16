/**
 * That the HTTP setup is actually INSTALLED, in the order that keeps a parser refusal readable by a browser:
 * `src/config/httpSetup.ts` registers CORS, then the JSON parser, then the strip link, and `src/main.ts` applies it
 * before `listen`.
 *
 * `tests/bodyParser.integration.test.ts` proves the behaviour through the harness, which applies the setup itself. It
 * cannot see `main.ts` dropping the call, because importing `main.ts` would boot a real app with a real pool (the
 * reason `mainBootOrder.test.ts` reads source too). It parses rather than greps, so prose that names these calls can
 * neither satisfy nor defeat it.
 *
 * @module
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** A source file, parsed. `import.meta.dirname` is `src/config/__tests__`. */
function parse(relativePath: string): ts.SourceFile {
    const path = join(import.meta.dirname, relativePath);

    return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true);
}

const setup = parse('../httpSetup.ts');
const main = parse('../../main.ts');

/**
 * The source position of every call in `source` whose callee is `name` or ends in `.name`. Pure.
 *
 * @param name - The function or method name.
 * @param source - The parsed file.
 * @returns Each call's start position, in source order.
 */
function positionsOf(name: string, source: ts.SourceFile): readonly number[] {
    const found: number[] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            const matches = ts.isPropertyAccessExpression(callee)
                ? callee.name.text === name
                : ts.isIdentifier(callee) && callee.text === name;

            if (matches) {
                found.push(node.getStart(source));
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(source);

    return found;
}

describe('the HTTP setup', () => {
    // ⛔ NON-VACUITY: the order assertion needs both calls to exist.
    it('registers CORS before the JSON parser, so a parser refusal still carries its headers', () => {
        const cors = positionsOf('enableCors', setup);
        const parser = positionsOf('json', setup);

        expect([cors.length, parser.length]).toEqual([1, 1]);
        expect(cors[0]).toBeLessThan(parser[0] ?? Number.NEGATIVE_INFINITY);
    });

    it('links the strip step directly after the parser, the only place a refusal can still be stripped', () => {
        expect(setup.getText()).toMatch(/app\.use\(express\.json\([^;]*\);\s*app\.use\(stripBodyParserRefusal\);/);
    });
});

describe('src/main.ts applies the HTTP setup', () => {
    it('applies it exactly once, before the app listens', () => {
        const configure = positionsOf('configure', main);
        const listen = positionsOf('listen', main);

        expect(configure).toHaveLength(1);
        expect(listen).toHaveLength(1);
        expect(configure[0]).toBeLessThan(listen[0] ?? Number.NEGATIVE_INFINITY);
    });
});
