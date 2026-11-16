/**
 * That the CORS POLICY IS ACTUALLY INSTALLED — `src/config/httpSetup.ts` hands a policy built by `buildCorsPolicy` to
 * `jsonBodyHttpSetup`, and nothing else, and `src/main.ts` applies that setup.
 *
 * REWRITTEN twice. First when the `enableCors` call moved out of `main.ts` into this service's setup (CORS must be
 * registered BEFORE the JSON parser, since a parser refusal skips every later non-error middleware). Then when the
 * ordered setup (`enableCors`, `express.json`, the strip link) moved into `jsonBodyHttpSetup` in
 * `@kitchensink/nest-http-setup`, which is where its order is now proved; so this file no longer looks for
 * `enableCors` here. It guards what stayed in the service: that the policy is built from the environment by the
 * service's own builder and reaches the shared setup, and that `main.ts` applies the setup. The integration tier proves
 * the headers behaviourally on a parser refusal; these source checks guard the wiring a header test with one allowed
 * origin cannot see.
 *
 * `cors.test.ts` proves the policy decides correctly and `corsHeaders.test.ts` proves the middleware emits
 * the right headers, but both construct the options themselves. Neither would notice the failure that actually
 * shipped: the DEFECT lived in the wiring, not in the matcher — `main.ts` was passing a value that degraded to
 * `origin: true` on every deployed non-prod stage. A one-line "simplification" of the call site
 * (`jsonBodyHttpSetup(() => ({ options: { origin: true }, mode: 'x' }))`, or dropping the call) would leave both other suites green.
 *
 * So this is a SOURCE-TEXT test, deliberately, for the same reason `src/__tests__/mainBootOrder.test.ts` is:
 * the guarantee is a property of the entry point's text, and observing it behaviourally would mean booting the
 * real service with a real pool. It parses (AST) rather than greps, so the prose above — which names
 * `jsonBodyHttpSetup` and `origin: true` — cannot satisfy or defeat it.
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
    // ⛔ `nestOptions` is what turns Nest's own body parser off (`bodyParser: false`). Without it Nest parses the body
    // first, rewrites a malformed one into a `BadRequestException` quoting the request, and the service's parser never
    // sees it. The guard in `repoGuards` holds this for every service; this names the service's own setup.
    it('creates the app with the setup’s nestOptions spread into NestFactory.create', () => {
        expect(callArgumentsOf('create', mainSource)).toHaveLength(1);
        expect(callArgumentsOf('create', mainSource)[0]?.[1]).toMatch(/^\{\s*\.\.\.RECIPE_HTTP_SETUP\.nestOptions\b/);
    });

    it('is applied by src/main.ts exactly once', () => {
        expect(callArgumentsOf('configure', mainSource)).toEqual([['app']]);
    });

    // ⛔ NON-VACUITY: with no `jsonBodyHttpSetup` call, every assertion below about its argument would pass trivially.
    it('builds the setup with jsonBodyHttpSetup exactly once', () => {
        expect(callArgumentsOf('jsonBodyHttpSetup')).toHaveLength(1);
    });

    it('hands it a policy built by buildCorsPolicy, never an inline options literal', () => {
        expect(callArgumentsOf('jsonBodyHttpSetup')[0]?.[0]).toMatch(/^\(\) =>\s*buildCorsPolicy\(/);
    });

    it('builds that policy from the environment, including the azp pattern selectors', () => {
        expect(callArgumentsOf('buildCorsPolicy')).toHaveLength(1);
        expect(callArgumentsOf('buildCorsPolicy')[0]?.[0]).toEqual(
            expect.stringContaining("previewBaseDomain: process.env['CLERK_AZP_PATTERN']"),
        );
    });

    it('does not call enableCors or register a parser itself: the shared setup holds that order', () => {
        expect(callArgumentsOf('enableCors')).toEqual([]);
        expect(callArgumentsOf('json')).toEqual([]);
    });
});
