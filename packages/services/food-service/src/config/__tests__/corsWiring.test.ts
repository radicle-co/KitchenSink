/**
 * That the CORS policy is actually INSTALLED: `src/config/httpSetup.ts` hands `corsPolicyFromEnv`'s options to
 * `enableCors` and nothing else, and `src/main.ts` applies that setup before `listen` (plan 002 S4, ADR-0047).
 *
 * REWRITTEN when the call moved out of `main.ts`: CORS must be registered BEFORE the service's own JSON parser (a parser
 * refusal skips every later non-error middleware), and the mocked integration and e2e tiers apply the same setup, so the
 * call lives in the one setup they share. `tests/bodyParser.integration.test.ts` proves the headers behaviourally on a
 * parser refusal; these source checks still guard the wiring a header test with one allowed origin cannot see.
 *
 * `cors.test.ts` proves the adapter decides correctly and `tests/foodCors.integration.test.ts` proves the headers on
 * food's real routes, but both install the policy themselves. Neither would notice the failure recipe already
 * shipped once: a defect in the WIRING, where `main.ts` passed a value that degraded to `origin: true`. A one-line
 * "simplification" here (`app.enableCors({ origin: true })`, or dropping the call) would leave both green.
 *
 * So this reads the SOURCE of the setup and of the entry point, for the reason `contract/__tests__/mainBootOrder.test.ts`
 * gives: importing `main.ts` would boot a real app with a real pool. It parses rather than greps, so prose that names
 * `enableCors` can neither satisfy nor defeat it.
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
    // ⛔ NON-VACUITY: with no `enableCors` call at all, every assertion below about its argument would pass.
    it('calls enableCors exactly once', () => {
        expect(callsOf('enableCors', setup)).toHaveLength(1);
    });

    it('passes the resolved policy, never an inline literal', () => {
        expect(callsOf('enableCors', setup)[0]?.arguments).toEqual(['cors.options']);
    });

    it('resolves that policy through the one shared reader, from the environment', () => {
        expect(callsOf('corsPolicyFromEnv', setup)).toHaveLength(1);
        expect(callsOf('corsPolicyFromEnv', setup)[0]?.arguments).toEqual([]);
    });

    it('logs which origin rule is live, so the posture is observable after a deploy', () => {
        expect(callsOf('log', setup).some((call) => call.arguments.some((text) => text.includes('cors.mode')))).toBe(
            true,
        );
    });

    it('registers CORS before the JSON parser, so a parser refusal still carries its headers', () => {
        const cors = callsOf('enableCors', setup)[0]?.position ?? Number.POSITIVE_INFINITY;
        const parser = callsOf('json', setup)[0]?.position ?? Number.NEGATIVE_INFINITY;

        expect(callsOf('json', setup)).toHaveLength(1);
        expect(cors).toBeLessThan(parser);
    });
});

describe('src/main.ts applies the HTTP setup', () => {
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
