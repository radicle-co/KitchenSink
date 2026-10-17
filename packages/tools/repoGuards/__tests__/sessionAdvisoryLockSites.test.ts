// @vitest-environment node
/**
 * Repo-wide guard: **a blocking SESSION advisory lock is taken and released in one place,
 * `@kitchensink/db-schema-guard`'s `withSessionAdvisoryLock`.**
 *
 * A session lock outlives the transaction that took it, `pg_advisory_lock` waits forever unless `lock_timeout` bounds
 * it, and the bound is a session setting that must be reset. Each hand-written copy of that sequence had to get the
 * order, the reset, the unlock and the error mapping right on its own, and the copies disagreed: the migration engine's
 * reset could replace the lock's own error, and only the helper turned SQLSTATE 55P03 into a typed timeout. So the
 * statements live in the helper, and this guard keeps them there.
 *
 * What it reads: every tracked or untracked production source in the repo, comments included. A comment that spells a
 * call with its parenthesis fails it, which is the safe direction for a guard; prose naming the function without one
 * does not.
 *
 * What it leaves alone, and why:
 *
 * - `pg_advisory_xact_lock`: the transaction releases it, so there is no unlock to forget and no session setting to
 *   restore. `advisoryLockClasses.test.ts` keeps those namespaced.
 * - `pg_try_advisory_lock` and the unlock in the same file: a try-lock never waits, so it has no bound to set or reset,
 *   and the helper has no try form. food's single-drainer worker holds one for its whole lifetime.
 *
 * @pattern Fitness function — an architectural invariant made executable over the real tree
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isTestFile, presentFiles, repoRoot, type SourceFile } from './serviceSources.js';

/** The one module allowed to take and release a blocking session advisory lock. */
const SESSION_LOCK_HELPER = 'packages/shared/db-schema-guard/src/sessionLock.ts';

/** The source languages a database call can be written in here. */
const SOURCE_PATHSPECS = ['*.ts', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs', '*.sql', '*.sh', '*.py'];

/** A blocking session-lock acquire, in either argument form. */
const SESSION_LOCK = /\bpg_advisory_lock\s*\(/iu;

/** A session-lock release, in either argument form. */
const SESSION_UNLOCK = /\bpg_advisory_unlock\s*\(/iu;

/** A non-blocking session-lock acquire, whose release is the caller's. */
const TRY_LOCK = /\bpg_try_advisory_lock\s*\(/iu;

/**
 * Every place a session advisory lock is handled outside the helper. Pure.
 *
 * @param sources - The files to read.
 * @returns One message per offending file and call; empty when every lock goes through the helper.
 */
export function handRolledSessionLocks(sources: readonly SourceFile[]): readonly string[] {
    return sources.flatMap(({ file, contents }) => {
        if (file === SESSION_LOCK_HELPER) {
            return [];
        }

        const findings: string[] = [];

        if (SESSION_LOCK.test(contents)) {
            findings.push(`${file}: takes a session advisory lock by hand — use withSessionAdvisoryLock`);
        }

        if (SESSION_UNLOCK.test(contents) && !TRY_LOCK.test(contents)) {
            findings.push(`${file}: releases a session advisory lock by hand — use withSessionAdvisoryLock`);
        }

        return findings;
    });
}

/**
 * The repo's production sources, read.
 *
 * @returns Every tracked or untracked source outside test directories and build output.
 * @sideEffect Shells out to git and reads the working tree.
 */
function productionSources(): readonly SourceFile[] {
    return presentFiles(SOURCE_PATHSPECS)
        .filter((file) => !file.includes('/dist/') && !file.endsWith('.d.ts') && !isTestFile(file))
        .map((file) => ({ file, contents: readFileSync(path.join(repoRoot, file), 'utf8') }));
}

describe('a session advisory lock is handled only by withSessionAdvisoryLock', () => {
    const sources = productionSources();

    it('reads the tree, and the helper itself still takes and releases the lock the patterns describe', () => {
        // ⛔ NON-VACUITY. A changed spelling would make both patterns match nothing anywhere and pass every file.
        const helper = sources.find(({ file }) => file === SESSION_LOCK_HELPER);

        expect(sources.length).toBeGreaterThan(500);
        expect(helper, `${SESSION_LOCK_HELPER} was not discovered`).toBeDefined();
        expect(SESSION_LOCK.test(helper?.contents ?? '')).toBe(true);
        expect(SESSION_UNLOCK.test(helper?.contents ?? '')).toBe(true);
    });

    it('⛔ finds no hand-written session lock anywhere else', () => {
        expect(handRolledSessionLocks(sources)).toStrictEqual([]);
    });
});

describe('handRolledSessionLocks — the shapes it must and must not see', () => {
    it.each<[string, SourceFile, readonly string[]]>([
        ['the helper itself', { file: SESSION_LOCK_HELPER, contents: "query('SELECT pg_advisory_lock($1)')" }, []],
        [
            'another module of the helper’s own package',
            {
                file: 'packages/shared/db-schema-guard/src/applyMigrations.ts',
                contents: "await client.query('SELECT pg_advisory_lock($1)', [KEY]);",
            },
            [
                'packages/shared/db-schema-guard/src/applyMigrations.ts: takes a session advisory lock by hand — use ' +
                    'withSessionAdvisoryLock',
            ],
        ],
        [
            'a blocking lock elsewhere',
            { file: 'a.ts', contents: "await session.query('SELECT pg_advisory_lock($1)', [KEY]);" },
            ['a.ts: takes a session advisory lock by hand — use withSessionAdvisoryLock'],
        ],
        [
            'a two-argument lock and its unlock',
            {
                file: 'b.ts',
                contents: "query('SELECT pg_advisory_lock($1, $2)'); query('SELECT pg_advisory_unlock($1, $2)');",
            },
            [
                'b.ts: takes a session advisory lock by hand — use withSessionAdvisoryLock',
                'b.ts: releases a session advisory lock by hand — use withSessionAdvisoryLock',
            ],
        ],
        [
            'a bare unlock',
            { file: 'c.ts', contents: "query('SELECT pg_advisory_unlock($1)')" },
            ['c.ts: releases a session advisory lock by hand — use withSessionAdvisoryLock'],
        ],
        [
            'a try-lock and its unlock (a lease the helper has no form for)',
            {
                file: 'd.ts',
                contents: "query('SELECT pg_try_advisory_lock($1, $2)'); query('SELECT pg_advisory_unlock($1, $2)');",
            },
            [],
        ],
        [
            'a try-lock beside a blocking lock',
            {
                file: 'e.ts',
                contents: "query('SELECT pg_try_advisory_lock($1, $2)'); query('SELECT pg_advisory_lock($1)');",
            },
            ['e.ts: takes a session advisory lock by hand — use withSessionAdvisoryLock'],
        ],
        [
            'a transaction-scoped lock',
            { file: 'f.ts', contents: 'sql`SELECT pg_advisory_xact_lock(${CLASS}, hashtext(${key}))`' },
            [],
        ],
        [
            'prose naming the function without a call',
            { file: 'g.ts', contents: '// `pg_advisory_lock` waits forever by default' },
            [],
        ],
        [
            'an upper-case, spaced spelling',
            { file: 'h.sql', contents: 'SELECT PG_ADVISORY_LOCK (7412200228220022);' },
            ['h.sql: takes a session advisory lock by hand — use withSessionAdvisoryLock'],
        ],
    ])('%s', (_label, source, expected) => {
        expect(handRolledSessionLocks([source])).toStrictEqual(expected);
    });
});
