// @vitest-environment node
/**
 * Repo-wide guard: the CloudFront edge grants CORS credentials exactly when a service behind it does (ADR-0047 §3,
 * plan 002 C1).
 *
 * ## Why the edge's value is derived and not chosen
 *
 * The edge answers a request with no valid token with its own `401`, for every service it fronts, from ONE bundle
 * built with ONE policy. A browser shows a credentialed fetch's response only when it carries
 * `Access-Control-Allow-Credentials: true`. So if any service grants credentials, because some browser client of it
 * sends `credentials: 'include'`, the edge must grant them too, or that client reads the `401` as a network error.
 * If none does, granting them only widens what an admitted origin could read. The edge's value is therefore the OR
 * over every other adopter's, and this guard holds it there in both directions: an edge granting credentials no adopter
 * grants turns red, and a new adopter that grants credentials turns the edge's `false` red.
 *
 * ## How it reads the adopters
 *
 * It finds every call to `resolveCorsPolicy` in the tree's non-test sources and reads the `credentials` property of
 * the object literal passed to it, through the TypeScript AST. An absent property is `false`, the policy's default. A
 * value that is not a boolean literal fails, because a guard that cannot read the value must not guess it.
 *
 * ⚠️ A spread (`{ ...input, deployed }`) is not followed. Every adopter today spreads a configuration object whose
 * type omits `credentials` (identity's `Omit<…, 'deployed' | 'credentials'>`), so a spread cannot carry it there, but
 * the guard trusts that rather than proving it.
 *
 * @see docs/architecture/decisions/0047-shared-cors-policy.md
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
    isTestFile,
    objectProperties,
    parse,
    presentFiles,
    repoRoot,
    visit,
    type SourceFile,
} from './serviceSources.js';

/** The shared policy's exported name. */
const POLICY_EXPORT = 'resolveCorsPolicy';

/** The package whose call is the edge's: the Lambda@Edge verifier's decision code. */
const EDGE_PACKAGE = 'packages/shared/edge-verifier';

/** What one call to the policy asks for. */
type CredentialsRequest =
    { readonly line: number; readonly credentials: boolean } | { readonly line: number; readonly undecidable: string };

/** The line a node starts on, 1-based. */
function lineOf(file: ts.SourceFile, node: ts.Node): number {
    return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

/** Whether a call's callee is the policy, bare or as a member. */
function callsPolicy(call: ts.CallExpression): boolean {
    const callee = call.expression;

    return (
        (ts.isIdentifier(callee) && callee.text === POLICY_EXPORT) ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === POLICY_EXPORT)
    );
}

/**
 * The credentials one call's argument asks for. Pure.
 *
 * @param argument - The call's first argument.
 * @returns `true`/`false`, or why it cannot be read.
 */
function requestedCredentials(argument: ts.Expression | undefined): boolean | { readonly undecidable: string } {
    if (argument === undefined || !ts.isObjectLiteralExpression(argument)) {
        return { undecidable: 'its argument is not an object literal' };
    }

    if (
        argument.properties.some((property) => property.name !== undefined && ts.isComputedPropertyName(property.name))
    ) {
        return { undecidable: 'a computed key may name credentials' };
    }

    const value = objectProperties(argument).get('credentials');

    if (value === undefined) {
        return false;
    }

    if (value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword) {
        return value.kind === ts.SyntaxKind.TrueKeyword;
    }

    return { undecidable: 'credentials is not a boolean literal' };
}

/**
 * Every call to the policy in one source, with the credentials each asks for. Pure.
 *
 * @param source - The file to read.
 * @returns One request per call, in source order.
 */
function credentialsRequests(source: SourceFile): readonly CredentialsRequest[] {
    const file = parse(source);
    const requests: CredentialsRequest[] = [];

    visit(file, (node) => {
        if (ts.isCallExpression(node) && callsPolicy(node)) {
            const credentials = requestedCredentials(node.arguments[0]);
            const line = lineOf(file, node);

            requests.push(typeof credentials === 'boolean' ? { line, credentials } : { line, ...credentials });
        }
    });

    return requests;
}

/**
 * What the edge must ask for, given every other adopter's answer. Pure.
 *
 * @param others - Each other adopter's credentials.
 * @returns `true` when any other adopter grants credentials.
 */
function requiredEdgeCredentials(others: readonly boolean[]): boolean {
    return others.some((credentials) => credentials);
}

/** A one-file fixture. */
function source(contents: string): SourceFile {
    return { file: 'fixture.ts', contents };
}

/** The decided values of a fixture, or the reasons it could not be read. */
function readFixture(contents: string): readonly (boolean | string)[] {
    return credentialsRequests(source(contents)).map((request) =>
        'credentials' in request ? request.credentials : request.undecidable,
    );
}

describe('credentialsRequests — what each call shape asks for', () => {
    it.each<[string, string, readonly (boolean | string)[]]>([
        ['an explicit true', 'resolveCorsPolicy({ deployed: true, credentials: true });', [true]],
        ['an explicit false', 'resolveCorsPolicy({ deployed: true, credentials: false });', [false]],
        [
            'no credentials property: the default',
            'resolveCorsPolicy({ ...clerk, deployed: isDeployed(stage) });',
            [false],
        ],
        ['a quoted key', "resolveCorsPolicy({ 'credentials': true });", [true]],
        ['a member call', 'shared.resolveCorsPolicy({ credentials: true });', [true]],
        ['a shorthand property', 'resolveCorsPolicy({ credentials });', ['credentials is not a boolean literal']],
        ['a variable', 'resolveCorsPolicy({ credentials: grants });', ['credentials is not a boolean literal']],
        ['a computed key', "resolveCorsPolicy({ ['credentials']: true });", ['a computed key may name credentials']],
        ['a non-literal argument', 'resolveCorsPolicy(input);', ['its argument is not an object literal']],
        ['two calls', 'resolveCorsPolicy({}); resolveCorsPolicy({ credentials: true });', [false, true]],
    ])('reads %s', (_label, contents, expected) => {
        expect(readFixture(contents)).toEqual(expected);
    });

    it.each([
        ['a comment', '// resolveCorsPolicy({ credentials: true })\nexport const a = 1;'],
        ['a string', "export const a = 'resolveCorsPolicy({ credentials: true })';"],
        ['an import', "import { resolveCorsPolicy } from '@kitchensink/clerk-verify';"],
        ['the declaration', 'export function resolveCorsPolicy(input: unknown): unknown { return input; }'],
    ])('finds no call in %s', (_label, contents) => {
        expect(readFixture(contents)).toEqual([]);
    });
});

describe('requiredEdgeCredentials — the OR over the other adopters', () => {
    it.each<[readonly boolean[], boolean]>([
        [[false, false, true], true],
        [[false, false], false],
        [[true, true], true],
    ])('%j → %s', (others, expected) => {
        expect(requiredEdgeCredentials(others)).toBe(expected);
    });
});

// ───────────────────────────── the real tree ─────────────────────────────

/** Every call to the policy in the tree's non-test sources, by file. */
const calls = presentFiles(['packages'])
    .filter((file) => /\.[cm]?ts$/u.test(file) && !file.endsWith('.d.ts') && !isTestFile(file))
    .map((file) => ({ file, contents: readFileSync(path.join(repoRoot, file), 'utf8') }))
    .filter((candidate) => candidate.contents.includes(POLICY_EXPORT))
    .flatMap((candidate) => credentialsRequests(candidate).map((request) => ({ file: candidate.file, request })));

const edgeCalls = calls.filter(({ file }) => file.startsWith(`${EDGE_PACKAGE}/src/`));
const otherCalls = calls.filter(({ file }) => !file.startsWith(`${EDGE_PACKAGE}/src/`));

describe('the real tree — the edge grants credentials exactly when another adopter does', () => {
    // ⛔ NON-VACUITY FIRST. An empty walk makes the OR false and would pass an edge that asks for nothing.
    it('finds exactly one call in the edge package and at least one elsewhere', () => {
        expect(edgeCalls.map(({ file }) => file)).toHaveLength(1);
        expect(otherCalls.length).toBeGreaterThan(0);
    });

    it('reads every call', () => {
        const unread = calls.flatMap(({ file, request }) =>
            'undecidable' in request ? [`${file}:${request.line} — ${request.undecidable}`] : [],
        );

        expect(unread).toEqual([]);
    });

    it("sets the edge's credentials to the OR over every other adopter's", () => {
        const decided = (request: CredentialsRequest): boolean => 'credentials' in request && request.credentials;
        const others = otherCalls.map(({ file, request }) => `${file}:${request.line} → ${String(decided(request))}`);
        const edge = edgeCalls[0];

        expect(edge, 'no edge call to compare').toBeDefined();
        expect(
            edge !== undefined && decided(edge.request),
            `the edge (${edge?.file ?? '?'}) must ask for credentials exactly when one of these does:\n${others.join('\n')}`,
        ).toBe(requiredEdgeCredentials(otherCalls.map(({ request }) => decided(request))));
    });
});
