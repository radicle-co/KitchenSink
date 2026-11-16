/**
 * That the CORS POLICY IS ACTUALLY INSTALLED — `src/config/httpSetup.ts` hands `buildCorsPolicy`'s options to
 * `enableCors`, and nothing else, and `src/main.ts` applies that setup.
 *
 * REWRITTEN when the call moved out of `main.ts`: CORS must be registered BEFORE the service's own JSON parser (a parser
 * refusal skips every later non-error middleware), and the integration and e2e tiers apply the same setup, so the call
 * lives in the one setup they share. The integration tier now proves the headers behaviourally on a parser refusal;
 * these source checks still guard the wiring a header test with one allowed origin cannot see.
 *
 * `cors.test.ts` proves the policy decides correctly and `corsHeaders.test.ts` proves the middleware emits
 * the right headers, but both construct the options themselves. Neither would notice the failure that actually
 * shipped: the DEFECT lived in the wiring, not in the matcher — `main.ts` was passing a value that degraded to
 * `origin: true` on every deployed non-prod stage. A one-line "simplification" of the call site
 * (`app.enableCors({ origin: true })`, or dropping the call) would leave both other suites green.
 *
 * So this is a SOURCE-TEXT test, deliberately, for the same reason `src/__tests__/mainBootOrder.test.ts` is:
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

/** A source file, parsed. `import.meta.dirname` is `src/config/__tests__`. */
function parsed(relativePath: string): ts.SourceFile {
    const path = join(import.meta.dirname, relativePath);

    return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

const setupSource = parsed('../httpSetup.ts');
const mainSource = parsed('../../main.ts');

/**
 * Every call expression in `source` whose callee ends in `.name` or is exactly `name`. Pure.
 *
 * @param name - The function or method name to collect calls to.
 * @param source - The parsed file; the setup by default.
 * @returns The source text of each matching call's arguments, one array per call.
 */
function callArgumentsOf(name: string, source: ts.SourceFile = setupSource): string[][] {
    const calls: string[][] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            const matches = ts.isPropertyAccessExpression(callee)
                ? callee.name.text === name
                : ts.isIdentifier(callee) && callee.text === name;

            if (matches) {
                calls.push(node.arguments.map((argument) => argument.getText(source)));
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(source);

    return calls;
}

describe('the HTTP setup installs the CORS policy', () => {
    it('is applied by src/main.ts exactly once', () => {
        expect(callArgumentsOf('configure', mainSource)).toEqual([['app']]);
    });

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
