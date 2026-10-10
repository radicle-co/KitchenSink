/**
 * That the CORS policy is actually INSTALLED: `src/main.ts` hands `corsPolicyFromEnv`'s options to `enableCors`,
 * before `listen`, and nothing else (plan 002 S4, ADR-0047).
 *
 * `cors.test.ts` proves the adapter decides correctly and `tests/foodCors.integration.test.ts` proves the headers on
 * food's real routes, but both install the policy themselves. Neither would notice the failure recipe already
 * shipped once: a defect in the WIRING, where `main.ts` passed a value that degraded to `origin: true`. A one-line
 * "simplification" here (`app.enableCors({ origin: true })`, or dropping the call) would leave both green.
 *
 * So this reads the entry point's SOURCE, for the reason `contract/__tests__/mainBootOrder.test.ts` gives: importing
 * `main.ts` would boot a real app with a real pool. It parses rather than greps, so the prose in `main.ts` that names
 * `enableCors` can neither satisfy nor defeat it.
 *
 * @module
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** `src/main.ts`. `import.meta.dirname` is `src/config/__tests__`. */
const MAIN_PATH = join(import.meta.dirname, '../../main.ts');

const main = ts.createSourceFile(MAIN_PATH, readFileSync(MAIN_PATH, 'utf8'), ts.ScriptTarget.ES2022, true);

/** One call in `main.ts`: its position and its arguments' source text. */
interface CallSite {
    readonly position: number;
    readonly arguments: readonly string[];
}

/**
 * Every call in `main.ts` whose callee is `name` or ends in `.name`. Pure.
 *
 * @param name - The function or method name.
 * @returns Each call, in source order.
 */
function callsOf(name: string): readonly CallSite[] {
    const calls: CallSite[] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            const matches = ts.isPropertyAccessExpression(callee)
                ? callee.name.text === name
                : ts.isIdentifier(callee) && callee.text === name;

            if (matches) {
                calls.push({ position: node.getStart(main), arguments: node.arguments.map((a) => a.getText(main)) });
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(main);

    return calls;
}

describe('src/main.ts installs the CORS policy', () => {
    // ⛔ NON-VACUITY: with no `enableCors` call at all, every assertion below about its argument would pass.
    it('calls enableCors exactly once', () => {
        expect(callsOf('enableCors')).toHaveLength(1);
    });

    it('passes the resolved policy, never an inline literal', () => {
        expect(callsOf('enableCors')[0]?.arguments).toEqual(['cors.options']);
    });

    it('resolves that policy through the one shared reader, from the environment', () => {
        expect(callsOf('corsPolicyFromEnv')).toHaveLength(1);
        expect(callsOf('corsPolicyFromEnv')[0]?.arguments).toEqual([]);
    });

    it('installs CORS before the app listens, so no request is ever served without it', () => {
        const enable = callsOf('enableCors')[0]?.position ?? Number.POSITIVE_INFINITY;
        const listen = callsOf('listen')[0]?.position ?? Number.NEGATIVE_INFINITY;

        expect(callsOf('listen')).toHaveLength(1);
        expect(enable).toBeLessThan(listen);
    });

    it('logs which origin rule is live, so the posture is observable after a deploy', () => {
        expect(callsOf('log').some((call) => call.arguments.some((text) => text.includes('cors.mode')))).toBe(true);
    });
});
