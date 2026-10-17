// @vitest-environment node
/**
 * Repo-wide guard: **no migration carries an UNQUALIFIED `DELETE`/`UPDATE`** — a whole-table statement with
 * no `WHERE` — unless it is a RECORDED exception saying what stops it running.
 *
 * ## The finding this is built on, and why it is not what it first looks like
 *
 * Every migration in this repo is applied by a ledger runner (`src/lambdas/migrate/handler.ts`): a name
 * present in `schema_migrations` is skipped, and the ledger insert shares the migration's transaction. That
 * ledger — not the SQL — is what makes re-running a deploy safe, and it is why the individual `.sql` files
 * are deliberately NOT written with `IF NOT EXISTS`.
 *
 * Auditing all 68 files against "would this double-apply data if it ran twice" returned **zero**. But four
 * of them carried destructive DML that was unreachable on a re-run for a reason nobody chose: a
 * `CREATE TABLE`, `ADD COLUMN` or `RENAME COLUMN` ABOVE it errors first, and the runner's `BEGIN`/`ROLLBACK`
 * takes the DML down with it. Two of those were unqualified whole-table wipes.
 *
 * ⛔ **That is what makes "just add `IF NOT EXISTS` everywhere" the dangerous repair rather than merely a
 * redundant one.** Hardening the DDL above such a statement does not make the file idempotent — it UNMASKS
 * the wipe and makes a re-run destroy the table's contents. The instinct is to harden the loud half and
 * never read the quiet half; this gate is here so the quiet half is read first.
 *
 * ## The two wipes were SCRUBBED, not documented in place (owner ruling 2026-09-02)
 *
 * The first draft of this gate RECORDED both statements with the DDL line that protected each, on the
 * grounds that rewriting applied history has a blast radius and they could not fire today. The owner ruled
 * the other way — _"I don't want hidden bombs in the app"_ — and the ruling is the better call: a guard that
 * an editor defeats by making an otherwise-reasonable change to a line they are not looking at is a bomb
 * whether or not it is currently armed, and a comment does not disarm it.
 *
 * So `0041_ingredient_source_phrase.sql`'s `DELETE FROM ingredient_resolution_memos;` and
 * `0002_fetch_requesters_rekey.sql`'s `DELETE FROM "fetch_requesters";` are gone. Behaviour-preserving on
 * every reachable path, verified rather than argued: `schema_migrations` is `name TEXT PRIMARY KEY` with NO
 * checksum and the skip is a pure name match, so a body edit cannot reach a database that already ran the
 * file; and on a fresh database the target tables hold 0 rows when the file runs (measured over the full
 * ordered set — no migration inserts into any of them). Both services' schemas dump byte-identical to their
 * pre-scrub baseline. Each file keeps the reasoning as history at the point someone would go to re-add it.
 *
 * ## Nothing is enumerated
 *
 * Migration directories are DISCOVERED from the working tree — every `.sql` file in any `migrations`
 * directory under `packages/services` — so a fourth service's SQL is covered the day it lands. The one list
 * is {@link UNQUALIFIED_BY_HISTORY}, and it is now EMPTY: the rule is absolute, and adding an entry reds a
 * test of its own so it has to be argued rather than slipped in.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { presentFiles, repoRoot } from './serviceSources.js';

/** A recorded unqualified statement: what it is, and what currently prevents it running. */
interface RecordedException {
    /** A distinctive fragment of the statement, matched case-insensitively. */
    readonly statement: string;
    /** What stops it executing today — and therefore what must not be "hardened" above it. */
    readonly protectedBy: string;
}

/**
 * Migrations carrying an unqualified whole-table statement, and what keeps it unreachable.
 *
 * ⛔ **EMPTY, and that is the point** — the rule is currently ABSOLUTE. The two historical entries this map
 * was built to record were SCRUBBED on 2026-09-02 rather than documented in place (owner ruling: _"I don't
 * want hidden bombs in the app"_), because a statement that is safe only while a DDL line above it errors
 * first is a guard a future editor defeats without ever looking at it.
 *
 * The mechanism is kept rather than deleted with its last entry, for one reason: without it, the next person
 * who meets a genuinely-unavoidable case has no way to record WHY, and the reachable move becomes weakening
 * the regex — which removes the check for every file at once. An entry here is a decision that reds
 * `records NO exception at all` and must be argued; weakening {@link UNQUALIFIED_DML} is not.
 */
const UNQUALIFIED_BY_HISTORY: ReadonlyMap<string, RecordedException> = new Map();

/** A statement that names a table and no `WHERE`. */
const UNQUALIFIED_DML = /^\s*(?:delete\s+from|update)\s+[^\s;]+/iu;

/**
 * Reduce a migration file to its top-level statements.
 *
 * `--` comments go first (a commented-out `DELETE` is documentation, and several files carry exactly that),
 * then dollar-quoted bodies — a plpgsql trigger or function body is per-ROW logic executing under the
 * trigger's own `WHERE`, not a migration-time wipe, and splitting on the `;` inside one would produce
 * fragments that are not statements at all.
 *
 * @param sql - The file's text.
 * @returns The top-level statements, comments and function bodies removed.
 */
export function topLevelStatements(sql: string): readonly string[] {
    return sql
        .replace(/\$\$[\s\S]*?\$\$/gu, ' ')
        .replace(/--[^\n]*/gu, ' ')
        .split(';')
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);
}

/**
 * ⛔ Unqualified whole-table `DELETE`/`UPDATE` statements a migration would run.
 *
 * @param file - Repo-relative path, used for the message and to look up an exception.
 * @param sql - The file's text.
 * @param recorded - The recorded historical exceptions.
 * @returns One message per unqualified statement that is not recorded.
 */
export function unqualifiedDml(
    file: string,
    sql: string,
    recorded: ReadonlyMap<string, RecordedException> = UNQUALIFIED_BY_HISTORY,
): readonly string[] {
    const exception = recorded.get(file);

    // ⛔ Written out rather than folded into a `?? <sentinel>` default, which is what this line used to be.
    // A sentinel here has to be a string no SQL statement can contain, and getting that wrong fails OPEN:
    // with `' '` as the default every multi-word statement "matches the exception" and the gate reports
    // NOTHING — silently, for every file with no recorded entry, which since the map was emptied is all of
    // them. `undefined` means "no exception", so say that.
    const isRecorded = (statement: string): boolean =>
        exception !== undefined && statement.toLowerCase().includes(exception.statement);

    return topLevelStatements(sql)
        .filter((statement) => UNQUALIFIED_DML.test(statement) && !/\bwhere\b/iu.test(statement))
        .filter((statement) => !isRecorded(statement))
        .map(
            (statement) =>
                `${file}: \`${statement.replace(/\s+/gu, ' ').slice(0, 80)}\` has no WHERE. A migration is ` +
                'applied once by the schema_migrations ledger, so a whole-table statement here is a wipe ' +
                'waiting for the first re-run — give it a WHERE, or record it in UNQUALIFIED_BY_HISTORY ' +
                'with what keeps it unreachable',
        );
}

/**
 * Every migration `.sql` in the repo.
 *
 * @returns Repo-relative paths, sorted.
 * @sideEffect Shells out to git.
 */
const migrationFiles = (): readonly string[] => [...presentFiles(['packages/services/**/migrations/*.sql'])].sort();

describe('no migration carries an unqualified whole-table DELETE or UPDATE', () => {
    it('discovers the migration sets at all — all three services', () => {
        // ⛔ The ANCHOR. The assertion below is a flatMap over this list; a glob that stopped matching would
        // turn it into an assertion over nothing and the gate would go green having read no SQL.
        const files = migrationFiles();

        expect(files.length).toBeGreaterThan(60);
        expect(files.some((file) => file.includes('/recipe-service/'))).toBe(true);
        expect(files.some((file) => file.includes('/identity/'))).toBe(true);
        expect(files.some((file) => file.includes('/food-service/'))).toBe(true);
    });

    it('⛔ finds no unrecorded whole-table statement', () => {
        const violations = migrationFiles().flatMap((file) =>
            unqualifiedDml(file, readFileSync(path.join(repoRoot, file), 'utf8')),
        );

        expect(
            violations,
            'the ledger makes a re-run a no-op only while the file is never re-executed; an unqualified ' +
                'DELETE is what turns one cleared ledger row into data loss',
        ).toStrictEqual([]);
    });

    it('keeps every recorded exception LIVE — the file and an EXECUTED statement must still be there', () => {
        // ⛔ Both halves. An entry for a deleted file is a licence a future file of that name inherits; an
        // entry whose statement has been rewritten is a warning about code that no longer exists, and the
        // `protectedBy` note — which is the thing telling the next reader not to harden the DDL above it —
        // would be pointing at nothing.
        //
        // ⛔ Matched against `topLevelStatements`, NEVER the raw text — and that is not a detail. This check
        // read the whole file until 2026-09-02, and when the two recorded statements were actually DELETED
        // it stayed GREEN, because the scrub note left behind quotes each removed statement in a COMMENT.
        // A gate that a file's own prose about a statement can satisfy is the exact trap
        // `reclaimableStackImports.test.ts` records for text gates. Comments are stripped before matching, so
        // only a statement the runner would EXECUTE keeps an exception alive.
        const stale = [...UNQUALIFIED_BY_HISTORY.entries()]
            .filter(([file, exception]) => {
                if (!migrationFiles().includes(file)) {
                    return true;
                }

                const executed = topLevelStatements(readFileSync(path.join(repoRoot, file), 'utf8'));

                return !executed.some((statement) => statement.toLowerCase().includes(exception.statement));
            })
            .map(([file]) => file);

        expect(stale, 'delete the entry rather than leaving a licence behind').toStrictEqual([]);
    });

    it('records NO exception at all — the rule is currently absolute', () => {
        // ⛔ The two historical entries were SCRUBBED on 2026-09-02 (owner ruling: "I don't want hidden bombs
        // in the app"), so there is nothing left that is safe only because a DDL line above it errors first.
        //
        // The mechanism is deliberately KEPT rather than deleted with its last entry, and this assertion is
        // what stops that being a quiet licence: adding an entry now reds HERE, so it has to be argued in
        // review instead of appearing as a one-line map addition. Its behaviour stays proven by the fakes
        // below, which pass their own map — so an empty map here can never make the escape hatch vacuous.
        expect(
            [...UNQUALIFIED_BY_HISTORY.keys()],
            'a new exception is a decision, not a way to make this suite green — scrub the statement or ' +
                'give it a WHERE',
        ).toStrictEqual([]);
    });
});

describe('the gate fires — at statements built to break it', () => {
    it('catches an unqualified DELETE', () => {
        expect(unqualifiedDml('m.sql', 'DELETE FROM widgets;', new Map())).toStrictEqual([
            expect.stringContaining('has no WHERE') as unknown as string,
        ]);
    });

    it('catches an unqualified UPDATE', () => {
        expect(unqualifiedDml('m.sql', 'UPDATE widgets SET status = 1;', new Map())).toStrictEqual([
            expect.stringContaining('has no WHERE') as unknown as string,
        ]);
    });

    it('passes a qualified statement, a commented-out one, and one inside a function body', () => {
        // All three are shapes the real migration set actually contains, and a gate that failed any of them
        // would be deleted within a week rather than fixed.
        expect(unqualifiedDml('m.sql', 'UPDATE widgets SET status = 1 WHERE status IS NULL;', new Map())).toStrictEqual(
            [],
        );
        expect(unqualifiedDml('m.sql', '-- DELETE FROM widgets;\nSELECT 1;', new Map())).toStrictEqual([]);
        expect(
            unqualifiedDml(
                'm.sql',
                'CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN DELETE FROM widgets; RETURN NEW; END; $$ LANGUAGE plpgsql;',
                new Map(),
            ),
        ).toStrictEqual([]);
    });

    it('forgives exactly the recorded statement, and nothing else in the same file', () => {
        // ⛔ The exception is keyed on the STATEMENT, not the file. A file with a recorded wipe that later
        // grows a SECOND one must still red — otherwise one recorded line becomes a standing licence for the
        // whole file.
        const recorded = new Map([
            ['m.sql', { statement: 'delete from widgets', protectedBy: 'the ADD COLUMN above' }],
        ]);

        expect(unqualifiedDml('m.sql', 'DELETE FROM widgets;', recorded)).toStrictEqual([]);
        expect(unqualifiedDml('m.sql', 'DELETE FROM widgets;\nDELETE FROM gadgets;', recorded)).toStrictEqual([
            expect.stringContaining('gadgets') as unknown as string,
        ]);
    });
});
