/**
 * No TanStack query may replace the app-wide retry policy with a bare literal — asserted by DISCOVERY,
 * never by a list.
 *
 * ⛔ WHY THIS GUARD EXISTS. `retry` is ONE option, so a per-query `retry: 1` does not NARROW the client-level
 * predicate, it REPLACES it. The composition point in `@commise/query` cannot see that happening, every test
 * stays green, and the query silently goes back to spending requests on failures that repeating cannot fix —
 * which is the exact defect the policy was written to remove (a `404` costing four requests and ~7s of
 * backoff). It had already happened once, undetected, in `recipeQueries().nutritionBatch`: a numeric
 * `retry: NUTRITION_BATCH_RETRIES` that read as a tightening and was an opt-out.
 *
 * ⛔ IT ENUMERATES NOTHING. The candidate files come from the FILESYSTEM, filtered to the ones that actually
 * build TanStack query options, so a query factory added tomorrow is covered the day it lands. A hand-written
 * list of today's factories would be the shape `natEgressConsumers.test.ts` records as useless: _"a copy of a
 * list cannot detect that the list is incomplete."_
 *
 * ✅ THE FIX FOR A FAILURE IS NOT TO DELETE THE OVERRIDE — a query with a genuine reason to allow fewer
 * attempts keeps that bound, and states what it narrows:
 *
 *     retry: (failureCount, error) => failureCount < MY_BOUND && shouldRetryRecipeServiceFailure(error)
 *
 * ⚠️ SCOPED TO TANSTACK, deliberately. `retry` is also `ky`'s option (`client.ts` sets `retry: 0` to disable
 * the transport's own retries, correctly), and it is an i18n message key (`retry: 'Try again'`) in a dozen
 * message catalogues. Matching `retry:` repo-wide would flag all of those, and a guard that cries wolf gets
 * deleted. So a file is a candidate only if it imports the query-options builders from
 * `@tanstack/react-query`, and only a NUMBER or a BOOLEAN counts as a replacement. Both are read with comments
 * stripped, so a docblock that names `useQuery` or quotes `retry: false` changes nothing: a mutation that must never
 * repeat (plan 002 C5) sets `retry: false` legitimately, and this rule is about queries.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';

import { withoutTsComments } from './roleSplitSources.js';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** The import that makes a file a candidate. */
const TANSTACK_IMPORT = "from '@tanstack/react-query'";

/**
 * Source files that build TanStack query options, each with its code (comments stripped). Tests and fixtures are
 * excluded on purpose: a harness pinning `retry: false` is how a unit suite stays fast and hermetic, and it
 * configures no shipped query.
 *
 * Stripping comments is the expensive step, so a file whose raw text lacks the import is dropped first. Stripping
 * only removes text, so such a file can never be a candidate.
 *
 * @sideEffect Reads the source tree.
 */
const discoverQueryOptionFiles = (): ReadonlyMap<string, string> =>
    new Map(
        globSync('packages/**/src/**/*.{ts,tsx}', {
            cwd: REPO_ROOT,
            ignore: [
                '**/node_modules/**',
                '**/dist/**',
                '**/__tests__/**',
                '**/__fixtures__/**',
                '**/__integration__/**',
                '**/*.test.ts',
                '**/*.test.tsx',
            ],
        })
            .sort()
            .map((file) => [file, readFileSync(path.join(REPO_ROOT, file), 'utf8')] as const)
            .filter(([, text]) => text.includes(TANSTACK_IMPORT))
            .map(([file, text]) => [file, withoutTsComments(text)] as const)
            .filter(([, code]) => buildsQueryOptions(code)),
    );

/**
 * Whether code (comments already stripped) builds options a `QueryClient` will later resolve `retry` from. Pure.
 *
 * @param code - Source with its comments stripped.
 * @returns `true` when it imports TanStack and uses a query-options builder.
 */
function buildsQueryOptions(code: string): boolean {
    return (
        code.includes(TANSTACK_IMPORT) && /\b(queryOptions|infiniteQueryOptions|useQuery|useInfiniteQuery)\b/.test(code)
    );
}

/** A `retry` set to a literal number or boolean — the form that REPLACES the shared predicate. */
const LITERAL_RETRY = /\bretry:\s*(\d+|true|false)\b/g;

/**
 * The literal `retry` overrides in code (comments already stripped). Pure.
 *
 * @param code - Source with its comments stripped.
 * @returns Each override as written.
 */
function literalRetries(code: string): readonly string[] {
    return [...code.matchAll(LITERAL_RETRY)].map((match) => match[0]);
}

describe('the candidate and override readers — the shapes they must and must not see', () => {
    const tanstack = "import { useMutation, useQuery } from '@tanstack/react-query';\n";

    it.each([
        [
            'a query that replaces the policy with a number',
            `${tanstack}useQuery({ queryKey, queryFn, retry: 1 });`,
            true,
            ['retry: 1'],
        ],
        [
            'a query that disables retries',
            `${tanstack}useQuery({ queryKey, queryFn, retry: false });`,
            true,
            ['retry: false'],
        ],
        ['a query that narrows the policy', `${tanstack}useQuery({ retry: (n, e) => n < 1 && veto(e) });`, true, []],
        [
            'a mutation-only hook whose docblock names useQuery and quotes retry: false',
            "import { useMutation } from '@tanstack/react-query';\n/** Not a `useQuery`; `retry: false` (C5). */\nuseMutation({ retry: false });",
            false,
            ['retry: false'],
        ],
        [
            'a comment that quotes an override',
            `${tanstack}// retry: 3 used to be here\nuseQuery({ queryKey });`,
            true,
            [],
        ],
    ] as const)('%s', (_label, source, isCandidate, overrides) => {
        const code = withoutTsComments(source);

        expect(buildsQueryOptions(code)).toBe(isCandidate);
        expect(literalRetries(code)).toEqual(overrides);
    });
});

describe('TanStack query retry overrides', () => {
    const queryOptionFiles = discoverQueryOptionFiles();

    it('finds the query-building files by discovery, and there are enough of them to be a real check', () => {
        // ⛔ Anti-vacuity. A filter that matched nothing would make the assertion below pass in silence.
        expect(queryOptionFiles.size).toBeGreaterThan(2);
    });

    it('leaves the shared retry policy in force — no query replaces it with a bare literal', () => {
        const offenders = [...queryOptionFiles].flatMap(([file, code]) =>
            literalRetries(code).map(
                (literal) => `${file}: ${literal} — narrow the shared predicate instead of replacing it`,
            ),
        );

        expect(
            offenders,
            `these queries opt OUT of the app-wide retry policy rather than narrowing it:\n${offenders.join('\n')}`,
        ).toEqual([]);
    });
});
