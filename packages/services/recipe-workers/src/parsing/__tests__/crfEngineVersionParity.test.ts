/**
 * THE DEPLOYED PIN AND THE ENGINE'S SELF-REPORT DESCRIBE THE SAME ENGINE — asserted in BOTH directions.
 *
 * ## The defect this is the regression test for
 *
 * `handler.py` reports `importlib.metadata.version("ingredient-parser-nlp")` — the BARE distribution version,
 * `2.3.0`. `RecipeWorkersStack` injects `CRF_ENGINE_VERSION` as the pip REQUIREMENT SPECIFIER,
 * `ingredient-parser-nlp==2.3.0`, because that is what ADR-0025's pin IS. The adapter compared them for
 * equality. `'2.3.0' !== 'ingredient-parser-nlp==2.3.0'` is true forever, so the CRF answer was discarded on
 * EVERY invocation — the third independent failure in this one path, after "never deployed" and "nothing
 * alerting", and the one that would have survived both of those fixes.
 *
 * ⚠️ It was not even quiet: the adapter logged an error per invocation. Nobody was reading, and no metric or
 * alarm existed. That is why the fix ships with a guard rather than with a louder log line.
 *
 * ## ⛔ Why this guard is not "two constants agree"
 *
 * The previous guard on this pin (`packages/infra/global/__tests__/crossAppParserIdentity.test.ts`) asserted
 * `CRF_ENGINE_VERSION` against `requirements.txt` and PASSED throughout — because both carry the `==` form.
 * It compared two copies that agreed while the comparison that mattered disagreed, which is this repository's
 * recurring defect stated exactly: a copy of a value cannot detect that the value changed.
 *
 * So nothing here is hand-typed. Every value is READ:
 *
 *  - the pin, from `requirements.txt` — the file pip actually installs from;
 *  - the declared value, from `RecipeWorkersStack.ts`'s own AST;
 *  - the distribution name, from `handler.py`'s `metadata.version(...)` call;
 *  - and the version the engine reports, FROM A REAL INTERPRETER (`importlib.metadata`), which is the only
 *    reading that is not a claim about the code but an observation of the engine. CI installs the same pin
 *    (`_ci.yml`), and the check skips cleanly on a machine that has not.
 *
 * The reconciliation is then the one the adapter performs at runtime, executed against those readings — so
 * the test reds if EITHER side moves alone, and reds if the adapter's normalization stops agreeing with
 * either.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { parseEnginePin } from '../crfInvoke.js';

/** This file sits at `packages/services/recipe-workers/src/parsing/__tests__`. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const PARSER_PACKAGE = join(REPO_ROOT, 'packages/services/ingredient-parser');
const WORKERS_STACK = join(REPO_ROOT, 'packages/services/recipe-workers/infra/lib/RecipeWorkersStack.ts');

/** The pin `requirements.txt` declares — the only non-comment requirement in it. */
function pinnedRequirement(): string {
    const lines = readFileSync(join(PARSER_PACKAGE, 'requirements.txt'), 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));

    expect(lines, 'requirements.txt must declare exactly one requirement').toHaveLength(1);

    return lines[0] as string;
}

/** The value `RecipeWorkersStack` injects as `CRF_ENGINE_VERSION`, read from its AST rather than by regex. */
function declaredEngineVersion(): string {
    const source = ts.createSourceFile(
        'RecipeWorkersStack.ts',
        readFileSync(WORKERS_STACK, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
    );
    const found: string[] = [];

    const visit = (node: ts.Node): void => {
        if (
            ts.isPropertyAssignment(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === 'CRF_ENGINE_VERSION' &&
            (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))
        ) {
            found.push(node.initializer.text);
        }

        ts.forEachChild(node, visit);
    };

    visit(source);

    expect(found, 'the stack must inject exactly one CRF_ENGINE_VERSION literal').toHaveLength(1);

    return found[0] as string;
}

/** The distribution `handler.py` asks `importlib.metadata` about. */
function distributionHandlerReports(): string {
    const handler = readFileSync(join(PARSER_PACKAGE, 'src/handler.py'), 'utf8');
    const call = /ENGINE_VERSION\s*=\s*metadata\.version\(\s*["']([^"']+)["']\s*\)/u.exec(handler);

    expect(
        call,
        'handler.py must report ENGINE_VERSION from importlib.metadata. If it now formats the version ' +
            'itself, the adapter’s normalization is reading a shape that no longer exists',
    ).not.toBeNull();

    return (call as RegExpExecArray)[1] as string;
}

/** What a real interpreter says the installed engine's version is, or `undefined` when it is not installed. */
function installedVersion(distribution: string): string | undefined {
    try {
        return execFileSync('python3', ['-c', `import importlib.metadata as m; print(m.version("${distribution}"))`], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        return undefined;
    }
}

describe('the caller declares the pin pip installs', () => {
    it('⛔ CRF_ENGINE_VERSION is byte-identical to the requirements.txt pin', () => {
        // Direction 1: the deploy declares what pip installs. Necessary, and — as the defect proved —
        // nowhere near sufficient on its own.
        expect(declaredEngineVersion()).toBe(pinnedRequirement());
    });

    it('⛔ the pin names the SAME distribution the engine reports on', () => {
        // Direction 2. Both sides read: the name out of the pin, the name out of `handler.py`'s own call.
        expect(parseEnginePin(declaredEngineVersion()).distribution).toBe(distributionHandlerReports());
    });
});

describe('the engine’s self-report satisfies the deployed pin', () => {
    it('⛔ handler.py reports the BARE version — the shape the adapter normalizes', () => {
        // The assertion that would have caught the defect at build time. `handler.py` must hand back
        // `metadata.version(...)` UNFORMATTED: the moment it returns `f"{DIST}=={version}"` instead, the
        // adapter's comparison inverts and every answer is refused again — the exact bug, mirrored.
        const handler = readFileSync(join(PARSER_PACKAGE, 'src/handler.py'), 'utf8');

        expect(handler).toMatch(/"engineVersion":\s*ENGINE_VERSION/u);
        expect(
            handler,
            'handler.py must not format ENGINE_VERSION into a requirement specifier — the adapter ' +
                'normalizes the bare version UP to the pinned form, never the other way round',
        ).not.toMatch(/ENGINE_VERSION\s*=\s*f?["'][^"']*==/u);
    });

    it('⛔ a REAL interpreter’s reported version equals the pin’s version half', () => {
        // The only reading here that is an observation rather than a claim about source text. Skipped
        // cleanly where the engine is not installed; `_ci.yml` installs this exact pin, so CI runs it.
        const pin = parseEnginePin(declaredEngineVersion());
        const reported = installedVersion(pin.distribution);

        if (reported === undefined) {
            expect(pin.version.length).toBeGreaterThan(0);

            return;
        }

        // ⛔ This IS the runtime comparison, executed against the live engine. If it fails, the deployed
        // adapter refuses every parse.
        expect(reported).toBe(pin.version);
        // And the identity actually stored stays the canonical pinned form — the one `cookbook-import`'s
        // sidecar writes into the same `ingredient_parse_cache` column.
        expect(`${pin.distribution}==${reported}`).toBe(declaredEngineVersion());
    });
});
