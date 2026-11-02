// @vitest-environment node
/**
 * Repo-wide guard (ADR-0081): every caller of `verifyClerkToken` turns a suspended account into a `403`, and only the
 * edge may let one through.
 *
 * The refusal lives once, in `@kitchensink/clerk-verify`. But the verifier throws `ClerkAccountSuspendedError`, and a
 * caller whose catch maps EVERY error to `401` (the shape all four adopters had) would answer a suspended account with
 * the wrong status and, in food, count it toward the per-source 401 cap. So each production caller must name
 * `isClerkAccountSuspendedError`, unless it has opted out with `allowSuspended`, and the opt-out is held to the one
 * adopter that takes no authorization decisions.
 *
 * ## Derived, never enumerated
 *
 * Every tracked source file is scanned, comments blanked. A new service that verifies a token is found without anyone
 * adding it to a list. The verifier package itself and unit-test files are out of scope (a test double decides nothing).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isUnitTestFile, repoRoot } from './serviceSources.js';
import { withoutComments } from './sourceComments.js';

/** The only adopter that takes no authorization decision, so the only one that may pass `allowSuspended`. */
const EDGE_ADAPTER = 'packages/shared/edge-verifier/src/clerkEdgeVerifier.ts';

/** The verifier package: it defines the rule, so it neither calls nor opts out of it. */
const VERIFIER_PACKAGE = 'packages/shared/clerk-verify/';

/** This guard names every pattern it hunts for. */
const SELF = 'packages/tools/repoGuards/__tests__/suspendedGateAdopters.test.ts';

const CALLS_VERIFIER = /\bverifyClerkToken\s*\(/u;
const MAPS_SUSPENDED = /\bisClerkAccountSuspendedError\b/u;
const OPTS_OUT = /\ballowSuspended\s*:\s*true\b/u;

interface Adopter {
    readonly file: string;
    readonly mapsSuspended: boolean;
    readonly optsOut: boolean;
}

function code(source: string, file = 'sample.ts'): string {
    return withoutComments(file, source);
}

function adopters(): readonly Adopter[] {
    const files = execFileSync('git', ['ls-files', '--', '*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.mjs'], {
        cwd: repoRoot,
        encoding: 'utf8',
    })
        .split('\n')
        .filter((file) => file !== '' && file !== SELF)
        .filter((file) => !file.startsWith(VERIFIER_PACKAGE) && !isUnitTestFile(file))
        // Test support and e2e fixtures call the verifier to build a request, not to answer one.
        .filter(
            (file) => !/\/(?:tests?|__tests__|__fixtures__|support)\//u.test(file) && !file.includes('node_modules/'),
        );
    const found: Adopter[] = [];

    for (const file of files) {
        let source: string;

        try {
            source = code(readFileSync(path.join(repoRoot, file), 'utf8'), file);
        } catch {
            continue;
        }

        if (CALLS_VERIFIER.test(source)) {
            found.push({ file, mapsSuspended: MAPS_SUSPENDED.test(source), optsOut: OPTS_OUT.test(source) });
        }
    }

    return found;
}

describe('every verifyClerkToken caller answers a suspended account (ADR-0081)', () => {
    const found = adopters();

    it('finds the four adopters (non-vacuity)', () => {
        const files = found.map((adopter) => adopter.file);

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

    it('⛔ each caller maps ClerkAccountSuspendedError, or has opted out with allowSuspended', () => {
        const unmapped = found.filter((adopter) => !adopter.mapsSuspended && !adopter.optsOut).map((a) => a.file);

        expect(
            unmapped,
            'a caller whose catch answers every error with 401 gives a suspended account the wrong status; map ' +
                '`isClerkAccountSuspendedError` to 403 ACCOUNT_SUSPENDED',
        ).toStrictEqual([]);
    });

    it('⛔ only the edge adapter opts out of the suspended refusal', () => {
        const optOuts = found.filter((adopter) => adopter.optsOut).map((adopter) => adopter.file);

        expect(optOuts).toStrictEqual([EDGE_ADAPTER]);
    });

    it('the matchers see a call, a mapping and an opt-out, and ignore a comment (mutation check)', () => {
        expect(CALLS_VERIFIER.test(code('await verifyClerkToken(token, { jwtKey });'))).toBe(true);
        expect(MAPS_SUSPENDED.test(code('if (isClerkAccountSuspendedError(error)) { throw x; }'))).toBe(true);
        expect(OPTS_OUT.test(code('verifyClerkToken(t, { jwtKey, allowSuspended: true })'))).toBe(true);
        expect(MAPS_SUSPENDED.test(code('// isClerkAccountSuspendedError is mentioned here only\nconst x = 1;'))).toBe(
            false,
        );
        expect(OPTS_OUT.test(code('// allowSuspended: true\nconst x = 1;'))).toBe(false);
    });
});
