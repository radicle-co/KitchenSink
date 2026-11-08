// @vitest-environment node
/**
 * Repo-wide guard (ADR-0081): every caller of `verifyClerkToken` turns a suspended account into a `403`, and only the
 * edge may let one through.
 *
 * The refusal lives once, in `@kitchensink/clerk-verify`. But the verifier throws `ClerkAccountSuspendedError`, and a
 * caller whose catch maps EVERY error to `401` (the shape all four adopters had) would answer a suspended account with
 * the wrong status and, in food, count it toward the per-source 401 cap. So each production caller must CALL
 * `isClerkAccountSuspendedError(...)` inside the `catch` that wraps its verifier call, unless it has opted out with
 * `allowSuspended`. The opt-out property is allowed in exactly one file, whatever its value.
 *
 * ## Read with the TypeScript parser, not with a regular expression
 *
 * The first version of this guard matched text, and each of these defeated it: a renamed import
 * (`isClerkAccountSuspendedError as isSuspended`), a namespace import (`cv.verifyClerkToken(...)`), an import that is
 * never called, a call that sits outside the catch (so the arm exists but never runs for the verifier's failure), and
 * `allowSuspended: false` or a shorthand `allowSuspended` slipping past a pattern written for `: true`. The parser
 * resolves the import bindings and walks to the enclosing `try`/`catch`, so these are structure, not spelling.
 *
 * ## Derived, never enumerated
 *
 * Every tracked source file is parsed. A new service that verifies a token is found without anyone adding it to a
 * list. The verifier package itself and unit-test files are out of scope (a test double decides nothing).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { isUnitTestFile, repoRoot } from './serviceSources.js';

/** The only adopter that takes no authorization decision, so the only one that may carry `allowSuspended`. */
const EDGE_ADAPTER = 'packages/shared/edge-verifier/src/clerkEdgeVerifier.ts';

/** The verifier package: it defines the rule, so it neither calls nor opts out of it. */
const VERIFIER_PACKAGE = 'packages/shared/clerk-verify/';

/** This guard names every pattern it hunts for. */
const SELF = 'packages/tools/repoGuards/__tests__/suspendedGateAdopters.test.ts';

const VERIFIER_MODULE = '@kitchensink/clerk-verify';

/** What the parser found in one file. */
export interface FileAnalysis {
    /** How many calls to the verifier the file makes (through any import alias or a namespace import). */
    readonly verifierCalls: number;
    /** How many of those sit inside a `try` whose `catch` CALLS the suspended-account guard. */
    readonly mappedVerifierCalls: number;
    /** How many `allowSuspended` properties (assignment, shorthand or quoted) the file declares, whatever the value. */
    readonly allowSuspendedProperties: number;
}

/** The local names this file gave the two exports, and any namespace it imported the package as. */
interface Bindings {
    readonly verifier: ReadonlySet<string>;
    readonly guard: ReadonlySet<string>;
    readonly namespaces: ReadonlySet<string>;
}

function bindingsOf(file: ts.SourceFile): Bindings {
    const verifier = new Set<string>();
    const guard = new Set<string>();
    const namespaces = new Set<string>();

    for (const statement of file.statements) {
        if (
            !ts.isImportDeclaration(statement) ||
            !ts.isStringLiteral(statement.moduleSpecifier) ||
            statement.moduleSpecifier.text !== VERIFIER_MODULE
        ) {
            continue;
        }

        const named = statement.importClause?.namedBindings;

        if (named !== undefined && ts.isNamespaceImport(named)) {
            namespaces.add(named.name.text);
        }

        if (named !== undefined && ts.isNamedImports(named)) {
            for (const element of named.elements) {
                // `import { a as b }`: the exported name is `propertyName` when renamed, else `name`.
                const exported = (element.propertyName ?? element.name).text;

                if (exported === 'verifyClerkToken') {
                    verifier.add(element.name.text);
                }

                if (exported === 'isClerkAccountSuspendedError') {
                    guard.add(element.name.text);
                }
            }
        }
    }

    return { verifier, guard, namespaces };
}

/** Whether `call` calls one of `names` directly, or `<namespace>.<exportName>`. */
function callsExport(
    call: ts.CallExpression,
    names: ReadonlySet<string>,
    namespaces: ReadonlySet<string>,
    exportName: string,
): boolean {
    const callee = call.expression;

    if (ts.isIdentifier(callee)) {
        return names.has(callee.text);
    }

    return (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        namespaces.has(callee.expression.text) &&
        callee.name.text === exportName
    );
}

function containsGuardCall(node: ts.Node, bindings: Bindings): boolean {
    let found = false;

    const visit = (child: ts.Node): void => {
        if (
            ts.isCallExpression(child) &&
            callsExport(child, bindings.guard, bindings.namespaces, 'isClerkAccountSuspendedError')
        ) {
            found = true;

            return;
        }

        ts.forEachChild(child, visit);
    };

    visit(node);

    return found;
}

/** Whether `node` sits inside the `try` BLOCK of a try statement whose `catch` clause calls the guard. */
function isMappedByEnclosingCatch(node: ts.Node, bindings: Bindings): boolean {
    for (let current: ts.Node | undefined = node; current?.parent !== undefined; current = current.parent) {
        const parent: ts.Node = current.parent;

        if (ts.isTryStatement(parent) && parent.tryBlock === current && parent.catchClause !== undefined) {
            if (containsGuardCall(parent.catchClause, bindings)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Parse one source file and report how it uses the verifier and the opt-out.
 *
 * @param source - The file's text.
 * @param fileName - Its name, which chooses the script kind.
 * @returns The counts. Pure.
 */
export function analyzeSource(source: string, fileName = 'sample.ts'): FileAnalysis {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const bindings = bindingsOf(file);
    let verifierCalls = 0;
    let mappedVerifierCalls = 0;
    let allowSuspendedProperties = 0;

    const visit = (node: ts.Node): void => {
        if (
            ts.isCallExpression(node) &&
            callsExport(node, bindings.verifier, bindings.namespaces, 'verifyClerkToken')
        ) {
            verifierCalls += 1;

            if (isMappedByEnclosingCatch(node, bindings)) {
                mappedVerifierCalls += 1;
            }
        }

        const name = ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) ? node.name : undefined;

        if (
            name !== undefined &&
            ((ts.isIdentifier(name) && name.text === 'allowSuspended') ||
                (ts.isStringLiteral(name) && name.text === 'allowSuspended'))
        ) {
            allowSuspendedProperties += 1;
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return { verifierCalls, mappedVerifierCalls, allowSuspendedProperties };
}

interface Analyzed extends FileAnalysis {
    readonly file: string;
}

function sourceFiles(): readonly string[] {
    return (
        execFileSync('git', ['ls-files', '--', '*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.mjs'], {
            cwd: repoRoot,
            encoding: 'utf8',
        })
            .split('\n')
            .filter((file) => file !== '' && file !== SELF)
            .filter((file) => !file.startsWith(VERIFIER_PACKAGE) && !isUnitTestFile(file))
            // Test support and e2e fixtures call the verifier to build a request, not to answer one.
            .filter(
                (file) =>
                    !/\/(?:tests?|__tests__|__fixtures__|support)\//u.test(file) && !file.includes('node_modules/'),
            )
    );
}

function analyzeRepo(): readonly Analyzed[] {
    const found: Analyzed[] = [];

    for (const file of sourceFiles()) {
        let source: string;

        try {
            source = readFileSync(path.join(repoRoot, file), 'utf8');
        } catch {
            continue;
        }

        // Cheap pre-filter: only parse a file that can possibly matter.
        if (!source.includes('verifyClerkToken') && !source.includes('allowSuspended')) {
            continue;
        }

        found.push({ file, ...analyzeSource(source, file) });
    }

    return found;
}

describe('every verifyClerkToken caller answers a suspended account (ADR-0081)', () => {
    const found = analyzeRepo();
    const callers = found.filter((entry) => entry.verifierCalls > 0);

    it('finds the four adopters (non-vacuity)', () => {
        const files = callers.map((entry) => entry.file);

        for (const suffix of [
            'services/identity/src/auth/clerkAuth.service.ts',
            'services/recipe-service/src/auth/clerkAuth.service.ts',
            'services/food-service/src/auth/foodAuth.guard.ts',
            'shared/edge-verifier/src/clerkEdgeVerifier.ts',
        ]) {
            expect(
                files.some((file) => file.endsWith(suffix)),
                suffix,
            ).toBe(true);
        }
    });

    it('⛔ each verifier call is inside a try whose catch CALLS isClerkAccountSuspendedError, or the file is the edge', () => {
        const unmapped = callers
            .filter((entry) => entry.file !== EDGE_ADAPTER && entry.mappedVerifierCalls < entry.verifierCalls)
            .map((entry) => entry.file);

        expect(
            unmapped,
            'a caller whose catch answers every error with 401 gives a suspended account the wrong status; call ' +
                '`isClerkAccountSuspendedError(error)` in the catch around the verifier and answer 403 ACCOUNT_SUSPENDED',
        ).toStrictEqual([]);
    });

    it('⛔ no file but the edge adapter declares an allowSuspended property, whatever its value', () => {
        const declaring = found.filter((entry) => entry.allowSuspendedProperties > 0).map((entry) => entry.file);

        expect(declaring).toStrictEqual([EDGE_ADAPTER]);
    });
});

describe('the analysis itself (fixtures: each gap the regex version had)', () => {
    const header = (names: string): string => `import { ${names} } from '@kitchensink/clerk-verify';\n`;

    it('counts a mapped call: the guard is CALLED in the catch around the verifier', () => {
        const result = analyzeSource(
            header('verifyClerkToken, isClerkAccountSuspendedError') +
                `async function v(t: string) {
                    try { return await verifyClerkToken(t, cfg); }
                    catch (error) { if (isClerkAccountSuspendedError(error)) { throw new Error('403'); } throw new Error('401'); }
                }`,
        );

        expect(result).toMatchObject({ verifierCalls: 1, mappedVerifierCalls: 1 });
    });

    it('resolves import aliases for BOTH the verifier and the guard', () => {
        const result = analyzeSource(
            header('verifyClerkToken as verify, isClerkAccountSuspendedError as isSuspended') +
                `async function v(t: string) {
                    try { return await verify(t, cfg); }
                    catch (error) { if (isSuspended(error)) { throw new Error('403'); } throw new Error('401'); }
                }`,
        );

        expect(result).toMatchObject({ verifierCalls: 1, mappedVerifierCalls: 1 });
    });

    it('resolves a namespace import', () => {
        const result = analyzeSource(
            `import * as cv from '@kitchensink/clerk-verify';
             async function v(t: string) {
                 try { return await cv.verifyClerkToken(t, cfg); }
                 catch (error) { if (cv.isClerkAccountSuspendedError(error)) { throw new Error('403'); } throw error; }
             }`,
        );

        expect(result).toMatchObject({ verifierCalls: 1, mappedVerifierCalls: 1 });
    });

    it('⛔ an import alone does not count: the guard is imported and never called', () => {
        const result = analyzeSource(
            header('verifyClerkToken, isClerkAccountSuspendedError') +
                `async function v(t: string) {
                    try { return await verifyClerkToken(t, cfg); }
                    catch { throw new Error('401'); }
                }`,
        );

        expect(result).toMatchObject({ verifierCalls: 1, mappedVerifierCalls: 0 });
    });

    it('⛔ a guard call OUTSIDE the catch around the verifier does not count', () => {
        const result = analyzeSource(
            header('verifyClerkToken, isClerkAccountSuspendedError') +
                `function other(e: unknown) { return isClerkAccountSuspendedError(e); }
                 async function v(t: string) {
                    try { return await verifyClerkToken(t, cfg); }
                    catch { throw new Error('401'); }
                }`,
        );

        expect(result).toMatchObject({ verifierCalls: 1, mappedVerifierCalls: 0 });
    });

    it('⛔ a guard call in a catch that wraps a DIFFERENT try does not count', () => {
        const result = analyzeSource(
            header('verifyClerkToken, isClerkAccountSuspendedError') +
                `async function v(t: string) {
                    try { doSomethingElse(); } catch (e) { if (isClerkAccountSuspendedError(e)) { throw e; } }
                    return await verifyClerkToken(t, cfg);
                }`,
        );

        expect(result).toMatchObject({ verifierCalls: 1, mappedVerifierCalls: 0 });
    });

    it('⛔ a guard call in the try BLOCK or the finally block does not map the verifier', () => {
        const result = analyzeSource(
            header('verifyClerkToken, isClerkAccountSuspendedError') +
                `async function v(t: string) {
                    try { isClerkAccountSuspendedError(t); return await verifyClerkToken(t, cfg); }
                    catch { throw new Error('401'); }
                    finally { isClerkAccountSuspendedError(t); }
                }`,
        );

        expect(result).toMatchObject({ verifierCalls: 1, mappedVerifierCalls: 0 });
    });

    it('does not mistake a same-named function from another module for the verifier', () => {
        const result = analyzeSource(
            `import { verifyClerkToken } from './elsewhere.js';
             export const x = () => verifyClerkToken('t');`,
        );

        expect(result.verifierCalls).toBe(0);
    });

    it('ignores a mention in a comment or a string', () => {
        const result = analyzeSource(
            `// verifyClerkToken(t) allowSuspended: true
             export const note = 'verifyClerkToken(t) { allowSuspended: true }';`,
        );

        expect(result).toStrictEqual({ verifierCalls: 0, mappedVerifierCalls: 0, allowSuspendedProperties: 0 });
    });

    it.each([
        ['true', `verify(t, { jwtKey, allowSuspended: true });`],
        ['false', `verify(t, { jwtKey, allowSuspended: false });`],
        ['a computed value', `verify(t, { jwtKey, allowSuspended: process.env['X'] === '1' });`],
        ['shorthand', `const allowSuspended = true; verify(t, { jwtKey, allowSuspended });`],
        ['a quoted key', `verify(t, { jwtKey, 'allowSuspended': true });`],
    ])('⛔ flags an allowSuspended property whatever its value: %s', (_label, body) => {
        expect(analyzeSource(`const verify = (..._a: unknown[]) => undefined; ${body}`).allowSuspendedProperties).toBe(
            1,
        );
    });

    it('does not flag the word as a variable, a type member read, or an access', () => {
        expect(
            analyzeSource(`const config = { jwtKey }; const read = config.allowSuspended; let allowSuspended;`)
                .allowSuspendedProperties,
        ).toBe(0);
    });
});
