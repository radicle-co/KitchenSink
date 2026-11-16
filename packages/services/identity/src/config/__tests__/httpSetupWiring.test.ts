/**
 * That the HTTP setup is actually INSTALLED: `src/config/httpSetup.ts` hands a policy built by `buildCorsPolicy` from the
 * environment to `jsonBodyHttpSetup`, and `src/main.ts` applies the setup before `listen`.
 *
 * The ordered setup itself (CORS, then `express.json`, then the strip link) lives once, in `jsonBodyHttpSetup` in
 * `@kitchensink/nest-error-envelope`, where its order is proved on a real Nest app. This file replaced a check of that
 * order in this service when it moved, so it asserts only what stayed here: the service's own policy and its entry point.
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
    // ⛔ NON-VACUITY: with no `jsonBodyHttpSetup` call, every assertion below about its argument would pass.
    it('builds the setup with jsonBodyHttpSetup exactly once', () => {
        expect(positionsOf('jsonBodyHttpSetup', setup)).toHaveLength(1);
    });

    it('hands it a policy built by buildCorsPolicy from the environment, including the azp pattern selectors', () => {
        const text = setup.getText();

        expect(positionsOf('buildCorsPolicy', setup)).toHaveLength(1);
        expect(text).toMatch(/jsonBodyHttpSetup\(\(\) =>\s*buildCorsPolicy\(/);
        expect(text).toContain("authorizedPartiesRaw: process.env['CLERK_AUTHORIZED_PARTIES']");
        expect(text).toContain("previewBaseDomain: process.env['CLERK_AZP_PATTERN']");
    });

    it('does not call enableCors or register a parser itself: the shared setup holds that order', () => {
        expect(positionsOf('enableCors', setup)).toEqual([]);
        expect(positionsOf('json', setup)).toEqual([]);
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
