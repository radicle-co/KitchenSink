// @vitest-environment node
/**
 * Repo-wide guard: every caller of `establishSession` — or of `leaseSession`, the test-pool Facade over it — signs
 * in ONE AT A TIME and waits for it.
 *
 * ## Why, when the function now serializes itself
 *
 * `@kitchensink/e2e-fixtures`' `establishSession` holds a module-level queue through its post-create pause, so
 * concurrent calls in one process can no longer crowd Clerk's 5-creates-per-10-s window (a breach was measured
 * to cost `Retry-After: 600`). That makes a fan-out CORRECT — and invisible: a `Promise.all` over twenty
 * identities would silently take a minute of queued pauses while reading as parallel, and an un-awaited call
 * would let a process exit, or a CI step move on, before its sign-in (and its pause) finished, which is the
 * cross-process spacing the pause exists for. So a caller that fans out or fires and forgets is still a design
 * error, and this fails it.
 *
 * ## Why discovered, not listed
 *
 * The callers are found in the git index, never named here: a list of four files cannot notice a fifth.
 * `provisionPool.ts`, `e2e-seed`'s `provision.ts`, `seedCatalog.ts` and `resetPool.ts`, and the linkage credential
 * minter are what it finds today, and the non-vacuity assertion fails if discovery ever stops finding them.
 *
 * ⚠️ `leaseSession` joined the pattern when the fixed test pool replaced run-minted users (owner ruling
 * 2026-09-13): every tier now signs in through it, so a guard that only knew `establishSession(` would have found
 * no caller at all and asserted nothing about the fan-out it exists to prevent.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isUnitTestFile, repoRoot } from './serviceSources.js';

/** The modules that DEFINE the sign-in functions — their own references are not callers. */
const DEFINITIONS: ReadonlySet<string> = new Set([
    'packages/tools/e2e-fixtures/src/clerkSession.ts',
    'packages/tools/e2e-fixtures/src/leaseSession.ts',
]);

/** A call that performs a throttled sign-in. */
const SIGN_IN_CALL = /\b(?:establishSession|leaseSession)\(/gu;

/** Every tracked source file that calls a sign-in function, test files excluded. */
function callers(): readonly { readonly file: string; readonly source: string }[] {
    return execFileSync(
        'git',
        ['grep', '-l', '-E', '(establishSession|leaseSession)\\(', '--', '*.ts', '*.mts', '*.js', '*.mjs'],
        { cwd: repoRoot, encoding: 'utf8' },
    )
        .split('\n')
        .filter((file) => file !== '' && !DEFINITIONS.has(file))
        .filter((file) => !isUnitTestFile(file))
        .map((file) => ({ file, source: readFileSync(path.join(repoRoot, file), 'utf8') }));
}

/** Call sites of `establishSession(` in source, excluding comments. */
function callSites(source: string): readonly { readonly index: number; readonly line: string }[] {
    const code = source
        .replace(/\/\*[\s\S]*?\*\//gu, (block) => ' '.repeat(block.length))
        .replace(/\/\/.*$/gmu, (line) => ' '.repeat(line.length));

    return [...code.matchAll(SIGN_IN_CALL)].map((match) => ({
        index: match.index,
        line: code.slice(code.lastIndexOf('\n', match.index) + 1, code.indexOf('\n', match.index)),
    }));
}

describe('callers of establishSession sign in one at a time', () => {
    const found = callers();

    it('finds the callers (non-vacuity — every assertion below iterates them)', () => {
        expect(found.map(({ file }) => file)).toEqual(
            expect.arrayContaining([
                'packages/tools/loadtest/provisionPool.ts',
                'packages/tools/e2e-seed/src/provision.ts',
                'packages/tools/e2e-seed/src/seedCatalog.ts',
                'packages/tools/e2e-seed/src/resetPool.ts',
                'packages/tools/cross-service-e2e/scripts/mintLinkageCredentials.ts',
            ]),
        );
    });

    it('awaits every call directly', () => {
        const unawaited = found.flatMap(({ file, source }) =>
            callSites(source)
                .filter(({ index }) => !/await\s+$/u.test(source.slice(Math.max(0, index - 20), index)))
                .map(({ line }) => `${file}: ${line.trim()}`),
        );

        expect(unawaited, 'an un-awaited sign-in lets the caller move on before its create pause ends').toEqual([]);
    });

    it('never fans sign-ins out through Promise combinators or an iterator callback', () => {
        const fanning = found.flatMap(({ file, source }) => {
            const offences: string[] = [];

            if (/Promise\.(?:all|allSettled|race|any)\s*\(/u.test(source)) {
                offences.push(`${file}: uses a Promise combinator alongside a sign-in`);
            }

            for (const { index, line } of callSites(source)) {
                // An async iterator callback opened shortly before the call. Indirection through a helper is not
                // followed — the function's own queue is what keeps that case correct.
                const before = source.slice(Math.max(0, index - 300), index);

                if (/\.(?:map|forEach|flatMap)\(\s*async\b/u.test(before)) {
                    offences.push(`${file}: ${line.trim()} — inside an iterator callback`);
                }
            }

            return offences;
        });

        expect(fanning).toEqual([]);
    });
});
