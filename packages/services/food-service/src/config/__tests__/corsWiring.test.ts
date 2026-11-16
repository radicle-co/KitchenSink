/**
 * That the CORS policy is actually INSTALLED: `src/config/httpSetup.ts` hands `corsPolicyFromEnv` to
 * `jsonBodyHttpSetup` and nothing else, and `src/main.ts` applies that setup before `listen` (plan 002 S4, ADR-0047).
 *
 * REWRITTEN twice. First when the `enableCors` call moved out of `main.ts` into this service's setup (CORS must be
 * registered BEFORE the JSON parser, since a parser refusal skips every later non-error middleware). Then when the
 * ordered setup (`enableCors`, `express.json`, the strip link) moved into `jsonBodyHttpSetup` in
 * `@kitchensink/nest-http-setup`, which is where its order is now proved; so this file no longer looks for
 * `enableCors` here. It guards what stayed in the service: that its own policy reaches the shared setup and that
 * `main.ts` applies the setup before `listen`. `tests/bodyParser.integration.test.ts` proves the headers behaviourally on
 * a parser refusal.
 *
 * `cors.test.ts` proves the adapter decides correctly and `tests/foodCors.integration.test.ts` proves the headers on
 * food's real routes, but both install the policy themselves. Neither would notice the failure recipe already
 * shipped once: a defect in the WIRING, where `main.ts` passed a value that degraded to `origin: true`. A one-line
 * "simplification" here (`jsonBodyHttpSetup(() => ({ options: { origin: true }, mode: 'x' }))`, or dropping the call) would leave both green.
 *
 * So this reads the SOURCE of the setup and of the entry point, for the reason `contract/__tests__/mainBootOrder.test.ts`
 * gives: importing `main.ts` would boot a real app with a real pool. It parses rather than greps, so prose that names
 * `jsonBodyHttpSetup` can neither satisfy nor defeat it.
 *
 * @module
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** `src/config/httpSetup.ts` and `src/main.ts`. `import.meta.dirname` is `src/config/__tests__`. */
const SETUP_PATH = join(import.meta.dirname, '../httpSetup.ts');
const MAIN_PATH = join(import.meta.dirname, '../../main.ts');

/** A source file, parsed. */
function parse(path: string): ts.SourceFile {
    return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true);
}

const setup = parse(SETUP_PATH);
const main = parse(MAIN_PATH);

/** One call: its position and its arguments' source text. */
interface CallSite {
    readonly position: number;
    readonly arguments: readonly string[];
}

/**
 * Every call in `source` whose callee is `name` or ends in `.name`. Pure.
 *
 * @param name - The function or method name.
 * @param source - The parsed file.
 * @returns Each call, in source order.
 */
function callsOf(name: string, source: ts.SourceFile): readonly CallSite[] {
    const calls: CallSite[] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            const matches = ts.isPropertyAccessExpression(callee)
                ? callee.name.text === name
                : ts.isIdentifier(callee) && callee.text === name;

            if (matches) {
                calls.push({
                    position: node.getStart(source),
                    arguments: node.arguments.map((a) => a.getText(source)),
                });
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(source);

    return calls;
}

describe('the HTTP setup installs the CORS policy', () => {
    // ⛔ NON-VACUITY: with no `jsonBodyHttpSetup` call, every assertion below about its argument would pass.
    it('builds the setup with jsonBodyHttpSetup exactly once', () => {
        expect(callsOf('jsonBodyHttpSetup', setup)).toHaveLength(1);
    });

    it('hands it the policy resolved through the one shared reader, never an inline options literal', () => {
        expect(callsOf('jsonBodyHttpSetup', setup)[0]?.arguments).toEqual(['corsPolicyFromEnv']);
    });

    it('does not call enableCors or register a parser itself: the shared setup holds that order', () => {
        expect(callsOf('enableCors', setup)).toEqual([]);
        expect(callsOf('json', setup)).toEqual([]);
    });
});

describe('src/main.ts applies the HTTP setup', () => {
    // ⛔ `nestOptions` is what turns Nest's own body parser off (`bodyParser: false`). Without it Nest parses the body
    // first, rewrites a malformed one into a `BadRequestException` quoting the request, and the service's parser never
    // sees it. The guard in `repoGuards` holds this for every service; this names the service's own setup.
    it('creates the app with the setup’s nestOptions spread into NestFactory.create', () => {
        expect(callsOf('create', main)).toHaveLength(1);
        expect(callsOf('create', main)[0]?.arguments[1]).toMatch(/^\{\s*\.\.\.FOOD_HTTP_SETUP\.nestOptions\b/);
    });

    it('applies it exactly once', () => {
        expect(callsOf('configure', main).map((call) => call.arguments)).toEqual([['app']]);
    });

    it('applies it before the app listens, so no request is ever served without it', () => {
        const configure = callsOf('configure', main)[0]?.position ?? Number.POSITIVE_INFINITY;
        const listen = callsOf('listen', main)[0]?.position ?? Number.NEGATIVE_INFINITY;

        expect(callsOf('listen', main)).toHaveLength(1);
        expect(configure).toBeLessThan(listen);
    });
});
