/**
 * That the CORS POLICY IS ACTUALLY INSTALLED — `src/main.ts` hands `buildCorsPolicy`'s options to
 * `enableCors`, and nothing else.
 *
 * `cors.test.ts` proves the policy decides correctly and `cors-headers.test.ts` proves the middleware emits
 * the right headers, but both construct the options themselves. Neither would notice the failure that actually
 * shipped: the DEFECT lived in the wiring, not in the matcher — `main.ts` was passing a value that degraded to
 * `origin: true` on every deployed non-prod stage. A one-line "simplification" of the call site
 * (`app.enableCors({ origin: true })`, or dropping the call) would leave both other suites green.
 *
 * So this is a SOURCE-TEXT test, deliberately, for the same reason `src/__tests__/main-boot-order.test.ts` is:
 * the guarantee is a property of the entry point's text, and observing it behaviourally would mean booting the
 * real service with a real pool. It parses (AST) rather than greps, so the prose above — which names
 * `enableCors` and `origin: true` — cannot satisfy or defeat it.
 *
 * @module
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';
import ts from 'typescript';

/** `src/main.ts`, parsed. `import.meta.dirname` is `src/config/__tests__`. */
const MAIN_PATH = join(import.meta.dirname, '../../main.ts');

const mainSource = ts.createSourceFile(
    MAIN_PATH,
    readFileSync(MAIN_PATH, 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
);

/**
 * Every call expression in `main.ts` whose callee ends in `.name` or is exactly `name`. Pure.
 *
 * @param name - The function or method name to collect calls to.
 * @returns The source text of each matching call's arguments, one array per call.
 */
function callArgumentsOf(name: string): string[][] {
    const calls: string[][] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            const matches = ts.isPropertyAccessExpression(callee)
                ? callee.name.text === name
                : ts.isIdentifier(callee) && callee.text === name;

            if (matches) {
                calls.push(node.arguments.map((argument) => argument.getText(mainSource)));
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(mainSource);

    return calls;
}

describe('src/main.ts installs the CORS policy', () => {
    // ⛔ NON-VACUITY: if the walk found no `enableCors` call, every assertion below about its argument would
    // pass trivially. This is the assertion that fails if the call is ever deleted.
    it('calls enableCors exactly once', () => {
        expect(callArgumentsOf('enableCors')).toHaveLength(1);
    });

    it('derives the options from buildCorsPolicy, never from an inline literal', () => {
        expect(callArgumentsOf('enableCors')[0]).toEqual(['cors.options']);
    });

    it('builds that policy from the environment, including the azp pattern selectors', () => {
        expect(callArgumentsOf('buildCorsPolicy')).toHaveLength(1);
        expect(callArgumentsOf('buildCorsPolicy')[0]?.[0]).toEqual(
            expect.stringContaining("previewBaseDomain: process.env['CLERK_AZP_PATTERN']"),
        );
    });
});
