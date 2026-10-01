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
 * `@tanstack/react-query`, and only a NUMBER or a BOOLEAN counts as a replacement.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/**
 * Source files that build TanStack query options. Tests and fixtures are excluded on purpose: a harness
 * pinning `retry: false` is how a unit suite stays fast and hermetic, and it configures no shipped query.
 */
const queryOptionFiles = (): readonly string[] =>
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
        .filter((file) => {
            const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');

            // The builders that produce an options object a `QueryClient` will later resolve `retry` from.
            return (
                source.includes("from '@tanstack/react-query'") &&
                /\b(queryOptions|infiniteQueryOptions|useQuery|useInfiniteQuery)\b/.test(source)
            );
        })
        .sort();

/** A `retry` set to a literal number or boolean — the form that REPLACES the shared predicate. */
const LITERAL_RETRY = /\bretry:\s*(\d+|true|false)\b/g;

describe('TanStack query retry overrides', () => {
    it('finds the query-building files by discovery, and there are enough of them to be a real check', () => {
        // ⛔ Anti-vacuity. A filter that matched nothing would make the assertion below pass in silence.
        expect(queryOptionFiles().length).toBeGreaterThan(2);
    });

    it('leaves the shared retry policy in force — no query replaces it with a bare literal', () => {
        const offenders = queryOptionFiles().flatMap((file) => {
            const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');

            return [...source.matchAll(LITERAL_RETRY)].map(
                (match) => `${file}: ${match[0]} — narrow the shared predicate instead of replacing it`,
            );
        });

        expect(
            offenders,
            `these queries opt OUT of the app-wide retry policy rather than narrowing it:\n${offenders.join('\n')}`,
        ).toEqual([]);
    });
});
