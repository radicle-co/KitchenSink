// @vitest-environment node
/**
 * Every table in the recipe database that carries a person's identifier must be reached by the account-
 * erasure sweep, or be EXEMPT for a written reason.
 *
 * ## The class of defect this exists for — three instances and counting
 *
 * `ingredient_resolution_mappings` (migration 0021) shipped with `author_id` and `source_phrase` and NO
 * sweep coverage; its own header recorded that as a stated residual and handed it off. `ingredient_resolution
 * _memos` (0021, amended by 0026) shipped with a user's typed phrase and no author column at all, so no
 * predicate existed to sweep on. Both were RETROFITTED, months later, by someone who happened to notice.
 * `ingredient_parse_corrections` (0029) would have been the third.
 *
 * Nothing failed in either case, and nothing could: a table with an owner column and no sweep is a
 * fully-green test suite that quietly retains personal data through a legal erasure request. The symptom is
 * not a crash — it is a right exercised, reported complete, and not honoured. That is exactly the shape a
 * gate has to cover, because review cannot: the sweep lives in `recipe-workers` and the table arrives in
 * `recipe-service`, in a different package, usually in a different change.
 *
 * ## ⛔ THE ROW-LEVEL HOLE THIS GATE ORIGINALLY COULD NOT SEE — and the rule that closes it
 *
 * Everything above reasons per TABLE, and a fourth instance of the defect class arrived that a per-table
 * gate reports as COVERED. `promoteByCorroboration` inserted a `corroboration` binding into
 * `ingredient_resolution_mappings` with `author_id = NULL` — nobody wrote it — carrying a COPY of the
 * promoting cook's typed phrase. The table IS swept, so this gate was green; the sweep's predicate is
 * `WHERE author_id = $owner`, so the ROW was structurally unreachable and that phrase outlived both
 * contributing cooks' erasures. `ingredient_resolution_memos` had the same hole by a different route
 * (a writer that omitted `owner_id` from its statement entirely).
 *
 * The generalisation is mechanical, and it is asserted below. A de-identifying `UPDATE` — one that NULLs
 * columns under an owner-column equality — can only reach rows whose owner column is SET. So every OTHER
 * column that statement nulls must be tied to the predicate's column by a CHECK constraint: *the payload and
 * the person exist together or not at all*. Without that pairing the sweep has a blind spot the shape of
 * "rows with no owner", and no per-table reasoning can see it.
 *
 * ⚠️ The rule also guards the sweep in the OTHER direction — a future edit that clears only one of a pair is
 * refused by the database rather than leaving a previous owner's id beside somebody else's data, which would
 * aim the NEXT erasure at the wrong person. `ingredient_parse_corrections_owner_line_pair` (0029) shipped
 * that reasoning first; migration 0031 brought the other two tables to it.
 *
 * ## What is asserted, and why it is bidirectional
 *
 * The owner-bearing tables are DISCOVERED from the migration files — never enumerated here — and the swept
 * tables are DISCOVERED from the statements `eraseRecipeRows` actually issues. Then:
 *
 *  * every discovered owner-bearing table is swept, or named in {@link EXEMPT_FROM_SWEEP} with its reason;
 *  * every exemption names a table that still EXISTS and still carries an owner column, so an exemption
 *    cannot outlive the thing it excused;
 *  * no exemption is also swept, so an exemption that has quietly been closed is reported rather than left
 *    standing as a lie about the sweep;
 *  * every column a de-identifying statement NULLs is pair-checked against the owner column that statement
 *    keys on, so no row shape can exist that carries the data and not the predicate.
 *
 * A non-vacuity floor guards the discovery itself: if the parser stops finding tables — a syntax change, a
 * moved directory, a renamed function — the gate must go RED rather than pass by finding nothing, which is
 * the failure mode `natEgressConsumers.test.ts` was written against and this file mirrors deliberately.
 *
 * ## ⚠️ WHY THE PARSER AND NOT grep, on BOTH sides
 *
 * Migration headers in this repository are long and quote SQL: 0021's header prints the exact prescribed
 * sweep, `author_id` and all, and 0026's discusses `owner_id` at length. A `grep` over the file would find a
 * table "covered" by a comment ABOUT covering it. Likewise `eraseRecipeRows`' docstring names every table it
 * touches and several it deliberately does not. So SQL comments are stripped before the schema is read, and
 * the sweep side is read from the TypeScript AST — where a comment is a comment and only a real template
 * literal counts.
 *
 * ## ⚠️ SCOPE, stated so it is not over-read
 *
 * This gate covers ONE database and ONE sweep: the recipe database and `eraseRecipeRows`. `identity` and
 * `food` have their own erasure surfaces, which this file makes no claim about. A second database that gains
 * a sweep adds an entry to {@link SWEPT_DATABASES}; the pure predicates below are subject-neutral so that
 * costs one line and no new logic.
 *
 * DESIGN PATTERN: Specification module over four pure parsers — {@link ownerBearingTablesIn},
 * {@link sweptTablesIn}, {@link deIdentifyingStatementsIn} and {@link checkExpressionsFor} are pure verdicts
 * over a source, fired at deliberately-violating fakes below as well as at the working tree.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { parse, presentFiles, repoRoot, visit, type SourceFile } from './serviceSources.js';

/**
 * The column names that make a row attributable to a person in this repository.
 *
 * There is no `users` table (D2), so every one of these holds an app-user ULID directly. A new spelling is
 * the one thing this gate cannot discover, which is why the set is small, closed, and stated here rather
 * than inferred from a shape.
 */
const OWNER_COLUMNS = ['owner_id', 'author_id', 'user_id', 'created_by'] as const;

/** One database whose owner-bearing tables are gated, and the sweep that must reach them. */
interface SweptDatabase {
    /** Repo-relative migrations directory whose files define the schema. */
    readonly migrations: string;
    /** Repo-relative source declaring the sweep. */
    readonly sweepFile: string;
    /** The exported function whose statements ARE the sweep. */
    readonly sweepFunction: string;
}

/** The databases this gate covers. See the module docstring's scope note before adding one. */
const SWEPT_DATABASES: readonly SweptDatabase[] = [
    {
        migrations: 'packages/services/recipe-service/src/database/migrations',
        sweepFile: 'packages/services/recipe-workers/src/handlers/accountErasureWorker.ts',
        sweepFunction: 'eraseRecipeRows',
    },
];

/**
 * Tables that carry an owner column and are DELIBERATELY not swept by a statement of their own.
 *
 * ⛔ An exemption is a claim that erasure still reaches the data by some OTHER means, and it is checked in
 * both directions below: it must name a table that exists and still carries an owner column, and it must not
 * name a table the sweep already touches. "It seemed fine" is not an entry.
 */
const EXEMPT_FROM_SWEEP: ReadonlyMap<string, string> = new Map([
    [
        'recipe_versions',
        // `eraseRecipeRows`' own docstring, verbatim in substance: mutations are owner-only and `created_by`
        // cannot diverge from its recipe's `owner_id`, so the recipe DELETE cascades over it. A "defensive"
        // delete here would destroy the version history of a user who never asked to be erased, if that
        // invariant ever broke.
        'covered by the cascade from `recipes`; `created_by` cannot diverge from the recipe’s `owner_id`',
    ],
]);

/**
 * The fewest owner-bearing tables a working discovery must find.
 *
 * A floor, never the list — the point of discovery is that the list is not written down. It exists so a
 * parser that silently stops matching goes RED instead of green, which is the failure a gate over a derived
 * set is most exposed to.
 */
const MINIMUM_OWNER_BEARING_TABLES = 6;

/**
 * The fewest de-identifying statements a working parse must find.
 *
 * Same role as {@link MINIMUM_OWNER_BEARING_TABLES}: the pairing assertion iterates a DERIVED set, so a
 * parser that silently stops matching would satisfy it vacuously. Three today — the curated mapping tier,
 * the memo tier and the parse-correction tier.
 */
const MINIMUM_DE_IDENTIFYING_STATEMENTS = 3;

/**
 * Strip SQL comments so prose about a column is never read as a column.
 *
 * @param sql - Raw migration text.
 * @returns The same text with `--` lines and `/* *\/` blocks blanked. Pure.
 */
function stripSqlComments(sql: string): string {
    return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/**
 * The parenthesised body that opens at `start`, respecting nesting.
 *
 * @param text - The text to scan.
 * @param start - Index of the opening parenthesis.
 * @returns The body between the matching parentheses, or `''` when unbalanced. Pure.
 */
function balancedBody(text: string, start: number): string {
    let depth = 0;

    for (let i = start; i < text.length; i += 1) {
        if (text[i] === '(') {
            depth += 1;
        } else if (text[i] === ')') {
            depth -= 1;

            if (depth === 0) {
                return text.slice(start + 1, i);
            }
        }
    }

    return '';
}

/**
 * The tables one migration file declares (or extends) with an owner-identifying column.
 *
 * Reads both spellings that occur in this repository: a `CREATE TABLE` whose body declares the column, and
 * an `ALTER TABLE … ADD COLUMN` that adds one later (migration 0026's shape). Quoting is optional on both,
 * because both styles are present in the tree.
 *
 * @param source - One migration file.
 * @returns The table names it makes owner-bearing. Pure.
 */
function ownerBearingTablesIn(source: SourceFile): readonly string[] {
    const sql = stripSqlComments(source.contents);
    const owned = new Set<string>();
    const ownerColumn = new RegExp(`"?\\b(?:${OWNER_COLUMNS.join('|')})\\b"?`);

    for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi)) {
        const body = balancedBody(sql, sql.indexOf('(', (match.index ?? 0) + match[0].length - 1));

        if (ownerColumn.test(body) && match[1] !== undefined) {
            owned.add(match[1]);
        }
    }

    for (const match of sql.matchAll(
        new RegExp(
            `ALTER\\s+TABLE\\s+"?([a-z_][a-z0-9_]*)"?\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?(?:${OWNER_COLUMNS.join('|')})\\b`,
            'gi',
        ),
    )) {
        if (match[1] !== undefined) {
            owned.add(match[1]);
        }
    }

    return [...owned];
}

/**
 * The tables the named function's SQL actually MUTATES.
 *
 * Reads the TEMPLATE LITERALS inside the function's declaration, so the docstring above it — which names
 * every table it touches and several it deliberately leaves alone — contributes nothing. Only `UPDATE`,
 * `DELETE FROM` and `INSERT INTO` count: a table the sweep merely reads is not a table the sweep erases.
 *
 * @param source - The source declaring the sweep.
 * @param functionName - The declaration whose statements are read.
 * @returns The table names its statements mutate. Pure.
 */
function sweptTablesIn(source: SourceFile, functionName: string): readonly string[] {
    const swept = new Set<string>();

    for (const text of statementTextsIn(source, functionName)) {
        // ⛔ MUTATING forms only. A bare `FROM` would count a table the sweep merely READS — the removed-
        // set `SELECT … FROM recipes` is one — as covered, which is a false NEGATIVE in the one direction
        // that matters: a table this sweep looks at but never erases would be reported as reached.
        for (const match of text.matchAll(/\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+"?([a-z_][a-z0-9_]*)"?/gi)) {
            if (match[1] !== undefined) {
                swept.add(match[1]);
            }
        }
    }

    return [...swept];
}

/**
 * The SQL text of every template literal inside the named function's declaration.
 *
 * Interpolations become ` ? `, so a bound parameter can never be mistaken for a literal and a fragment
 * spliced in from ANOTHER template literal (the sweep's shared `ownerOnly` predicate is one) contributes to
 * its own text rather than to this statement's. Read from the AST for the reason the header gives: the
 * docstring above the function names every table it touches and several it deliberately does not.
 *
 * @param source - The source declaring the sweep.
 * @param functionName - The declaration whose statements are read.
 * @returns One string per template literal. Pure.
 */
function statementTextsIn(source: SourceFile, functionName: string): readonly string[] {
    const texts: string[] = [];

    visit(parse(source), (node) => {
        if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== functionName) {
            return;
        }

        visit(node, (inner) => {
            if (!ts.isTemplateLiteral(inner)) {
                return;
            }

            texts.push(
                ts.isNoSubstitutionTemplateLiteral(inner)
                    ? inner.text
                    : [inner.head.text, ...inner.templateSpans.map((span) => span.literal.text)].join(' ? '),
            );
        });
    });

    return texts;
}

/** One de-identifying statement: the columns it clears, and the owner column it can reach rows by. */
interface DeIdentifyingStatement {
    /** The table being de-identified. */
    readonly table: string;
    /** The owner column the statement's `WHERE` keys on — the ONLY rows it can reach. */
    readonly ownerColumn: string;
    /** Every column the statement sets to `NULL`, the owner column included. */
    readonly nulledColumns: readonly string[];
}

/**
 * Every `UPDATE … SET x = NULL … WHERE <owner> = ?` the named function issues.
 *
 * ⛔ Both halves of the shape are REQUIRED, and each exclusion is deliberate rather than incidental:
 *
 *  * **`= NULL`, not any `SET`.** The sweep's author-handle scrub writes a PSEUDONYM rather than clearing a
 *    column, and the donate-flip writes a visibility — neither leaves a row shape that can hide data.
 *  * **An owner-column EQUALITY in the `WHERE`.** The clone-detach `UPDATE` nulls `cloned_from_id` under a
 *    subquery on recipe ids; it is not attributing anything to a person, so pairing it against an owner
 *    column would be meaningless. Only a statement that reaches rows BY their owner has the blind spot.
 *
 * @param source - The source declaring the sweep.
 * @param functionName - The declaration whose statements are read.
 * @returns One entry per de-identifying statement. Pure.
 */
function deIdentifyingStatementsIn(source: SourceFile, functionName: string): readonly DeIdentifyingStatement[] {
    const found: DeIdentifyingStatement[] = [];
    const ownerColumn = `(?:${OWNER_COLUMNS.join('|')})`;

    for (const text of statementTextsIn(source, functionName)) {
        const update = new RegExp(
            `\\bUPDATE\\s+"?([a-z_][a-z0-9_]*)"?\\s+SET\\s+([\\s\\S]*?)\\sWHERE\\s([\\s\\S]*)`,
            'i',
        ).exec(text);

        if (update === null) {
            continue;
        }

        const [, table, assignments = '', predicate = ''] = update;
        const nulledColumns = [...assignments.matchAll(/"?([a-z_][a-z0-9_]*)"?\s*=\s*NULL\b/gi)].flatMap(
            (match) => match[1] ?? [],
        );
        const keyedOn = new RegExp(`"?(${ownerColumn})"?\\s*=\\s*\\?`, 'i').exec(predicate);

        if (table === undefined || nulledColumns.length === 0 || keyedOn === null || keyedOn[1] === undefined) {
            continue;
        }

        found.push({ table, ownerColumn: keyedOn[1], nulledColumns });
    }

    return found;
}

/**
 * Every `CHECK (…)` expression declared for one table across a set of migrations.
 *
 * Both spellings this repository uses are read: a `CONSTRAINT … CHECK (…)` inside the `CREATE TABLE` body,
 * and a later `ALTER TABLE … ADD CONSTRAINT … CHECK (…)`. Comments are stripped first, for the header's
 * reason — 0021's own header prints the prescribed sweep, `author_id` and all.
 *
 * @param sources - The migration files.
 * @param table - The table whose constraints are wanted.
 * @returns The text inside each `CHECK`. Pure.
 */
function checkExpressionsFor(sources: readonly SourceFile[], table: string): readonly string[] {
    const expressions: string[] = [];

    for (const source of sources) {
        const sql = stripSqlComments(source.contents);
        const create = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?${table}"?\\s*\\(`, 'i').exec(sql);
        const bodies: string[] = [];

        if (create !== null) {
            bodies.push(balancedBody(sql, sql.indexOf('(', create.index + create[0].length - 1)));
        }

        for (const alter of sql.matchAll(
            new RegExp(`ALTER\\s+TABLE\\s+"?${table}"?\\s+ADD\\s+CONSTRAINT[\\s\\S]*?CHECK\\s*\\(`, 'gi'),
        )) {
            bodies.push(`CHECK (${balancedBody(sql, sql.indexOf('(', alter.index + alter[0].length - 1))})`);
        }

        for (const body of bodies) {
            for (const check of body.matchAll(/\bCHECK\s*\(/gi)) {
                expressions.push(balancedBody(body, body.indexOf('(', (check.index ?? 0) + check[0].length - 1)));
            }
        }
    }

    return expressions;
}

/**
 * Whether some CHECK on `table` mentions BOTH columns — i.e. makes one without the other unrepresentable.
 *
 * @param sources - The migration files.
 * @param table - The table.
 * @param first - One column.
 * @param second - The other.
 * @returns True when a single constraint ties them together. Pure.
 */
function pairChecked(sources: readonly SourceFile[], table: string, first: string, second: string): boolean {
    const mentions = (expression: string, column: string): boolean =>
        new RegExp(`"?\\b${column}\\b"?`).test(expression);

    return checkExpressionsFor(sources, table).some(
        (expression) => mentions(expression, first) && mentions(expression, second),
    );
}

/**
 * Read one repo-relative file.
 *
 * @param file - Repo-relative path.
 * @returns The source, read. Impure.
 * @sideEffect Reads the working tree.
 */
function readSource(file: string): SourceFile {
    return { file, contents: readFileSync(path.join(repoRoot, file), 'utf8') };
}

/**
 * Every owner-bearing table in one database's migrations.
 *
 * The FILES are discovered from git, so a migration that lands tomorrow is covered the day it does and
 * cannot opt out by not being listed.
 *
 * ⛔ {@link presentFiles}, NOT `trackedFiles` — and this is not a style preference. `trackedFiles` reports
 * the INDEX, so a migration that exists on disk but has not been committed is INVISIBLE to it, which is
 * exactly the window in which someone is still writing the sweep that should reach it. Measured here while
 * building this gate: with `trackedFiles`, deleting the parse-correction sweep left the gate GREEN.
 *
 * @param database - The database to read.
 * @returns Its owner-bearing table names, sorted. Impure.
 * @sideEffect Shells out to git and reads the working tree.
 */
function ownerBearingTables(database: SweptDatabase): readonly string[] {
    return [...new Set(migrationsOf(database).flatMap((source) => ownerBearingTablesIn(source)))].sort();
}

/**
 * Every migration file of one database, read.
 *
 * The FILES are discovered from git, so a migration that lands tomorrow is covered the day it does and
 * cannot opt out by not being listed. See {@link ownerBearingTables} for why {@link presentFiles} and not
 * `trackedFiles`.
 *
 * @param database - The database to read.
 * @returns Its migrations. Impure.
 * @sideEffect Shells out to git and reads the working tree.
 */
function migrationsOf(database: SweptDatabase): readonly SourceFile[] {
    const files = presentFiles([database.migrations]).filter((file) => file.endsWith('.sql'));

    expect(
        files.length,
        `no migrations found under ${database.migrations} — the gate has stopped discovering`,
    ).toBeGreaterThan(0);

    return files.map((file) => readSource(file));
}

describe('account-erasure sweep coverage', () => {
    for (const database of SWEPT_DATABASES) {
        describe(database.sweepFunction, () => {
            it('reaches every owner-bearing table, or exempts it for a written reason', () => {
                const owned = ownerBearingTables(database);
                const swept = new Set(sweptTablesIn(readSource(database.sweepFile), database.sweepFunction));

                expect(
                    owned.length,
                    'fewer owner-bearing tables than this database is known to have — discovery has broken',
                ).toBeGreaterThanOrEqual(MINIMUM_OWNER_BEARING_TABLES);
                expect(
                    swept.size,
                    `${database.sweepFunction} addresses no tables — the parser has broken`,
                ).toBeGreaterThan(0);

                // ⛔ A table here is personal data with no route to erasure. Add a statement to the sweep, or
                // add an exemption above SAYING how erasure reaches it — never neither.
                expect(owned.filter((table) => !swept.has(table) && !EXEMPT_FROM_SWEEP.has(table))).toEqual([]);
            });

            it('⛔ pairs every column its de-identifying statements NULL with the owner they key on', () => {
                const statements = deIdentifyingStatementsIn(readSource(database.sweepFile), database.sweepFunction);
                const migrations = migrationsOf(database);

                expect(
                    statements.length,
                    `${database.sweepFunction} de-identifies nothing — the parser has broken`,
                ).toBeGreaterThanOrEqual(MINIMUM_DE_IDENTIFYING_STATEMENTS);

                const unpaired = statements.flatMap((statement) =>
                    statement.nulledColumns
                        .filter((column) => column !== statement.ownerColumn)
                        .filter((column) => !pairChecked(migrations, statement.table, statement.ownerColumn, column))
                        .map((column) => `${statement.table}.${column} ↮ ${statement.ownerColumn}`),
                );

                // ⛔ Each entry is a column this sweep clears on rows it can reach, sitting in a table where a
                // row with NO owner may still carry it — and such a row is invisible to `WHERE <owner> = $1`
                // forever. That is exactly how a `corroboration` binding kept a cook's typed phrase through
                // their erasure. Add a CHECK tying the two columns together (see 0029 and 0031), which also
                // makes a half-run sweep a row the database refuses.
                expect(unpaired).toEqual([]);
            });

            it('carries no exemption for a table that no longer bears an owner column', () => {
                const owned = new Set(ownerBearingTables(database));

                // An exemption outliving its table is a claim about nothing, and it would silently excuse a
                // FUTURE table that happened to reuse the name.
                expect([...EXEMPT_FROM_SWEEP.keys()].filter((table) => !owned.has(table))).toEqual([]);
            });

            it('carries no exemption for a table the sweep already reaches', () => {
                const swept = new Set(sweptTablesIn(readSource(database.sweepFile), database.sweepFunction));

                // A closed gap left standing as an exemption reads as "erasure does not touch this", which is
                // the opposite of the truth and the sort of note a later reader reasons correctly from.
                expect([...EXEMPT_FROM_SWEEP.keys()].filter((table) => swept.has(table))).toEqual([]);
            });
        });
    }

    it('states a real reason for every exemption', () => {
        // An exemption is the one place this gate accepts a human's word. A blank or throwaway entry would
        // turn "no route to erasure" into "somebody typed something", which is worse than no gate at all
        // because it reads as reviewed.
        for (const [table, why] of EXEMPT_FROM_SWEEP) {
            expect(why.trim().length, `the exemption for ${table} must say how erasure reaches it`).toBeGreaterThan(20);
        }
    });

    it('⛔ FAILS a table that carries an owner column and no sweep statement', () => {
        const migration = {
            file: 'fake/0099_new_table.sql',
            contents: `
                -- The sweep for "widgets" is described in this comment and nowhere else.
                CREATE TABLE "widgets" (
                    "id" uuid PRIMARY KEY,
                    "owner_id" varchar(255),
                    "payload" jsonb NOT NULL
                );
            `,
        };
        const sweep = {
            file: 'fake/sweep.ts',
            contents: `
                /** Sweeps recipes and widgets. */
                export const eraseRows = async (tx) => {
                    await tx.execute(sql\`DELETE FROM recipes WHERE owner_id = \${ownerId}\`);
                };
            `,
        };

        const owned = ownerBearingTablesIn(migration);
        const swept = new Set(sweptTablesIn(sweep, 'eraseRows'));

        expect(owned).toEqual(['widgets']);
        // Named in the docstring, named in a SQL comment, and swept by neither — which is precisely how
        // `ingredient_resolution_mappings` and `ingredient_resolution_memos` both shipped.
        expect(owned.filter((table) => !swept.has(table))).toEqual(['widgets']);
    });

    it('⛔ FAILS the exact shape that shipped: a phrase nulled under an owner the row need not have', () => {
        // `ingredient_resolution_mappings` as 0021 created it, and the sweep as step 10 writes it. The table
        // IS swept, so the coverage assertions above were green — and a `corroboration` row with
        // `author_id = NULL` carrying `source_phrase` was unreachable by that predicate forever.
        const migration = {
            file: 'fake/0021_mappings.sql',
            contents: `
                CREATE TABLE "mappings" (
                    "id" uuid PRIMARY KEY,
                    "author_id" varchar(255),
                    "source_phrase" text,
                    CONSTRAINT "mappings_supersession_coherent"
                        CHECK ("superseded_by" IS NULL OR "superseded_at" IS NOT NULL)
                );
            `,
        };
        const sweep = {
            file: 'fake/sweep.ts',
            contents: `
                export const eraseRows = async (tx) => {
                    await tx.execute(sql\`
                        UPDATE mappings SET superseded_at = now(), author_id = NULL, source_phrase = NULL
                        WHERE author_id = \${ownerId} AND superseded_at IS NULL
                    \`);
                };
            `,
        };
        const [statement] = deIdentifyingStatementsIn(sweep, 'eraseRows');

        expect(statement).toEqual({
            table: 'mappings',
            ownerColumn: 'author_id',
            nulledColumns: ['author_id', 'source_phrase'],
        });
        expect(pairChecked([migration], 'mappings', 'author_id', 'source_phrase')).toBe(false);

        // …and the same migration WITH the pairing constraint passes, so the verdict tracks the constraint
        // rather than something incidental about the fake.
        expect(
            pairChecked(
                [
                    {
                        file: 'fake/0031_pair.sql',
                        contents: `ALTER TABLE "mappings" ADD CONSTRAINT "mappings_phrase_needs_owner"
                                       CHECK (("author_id" IS NULL) = ("source_phrase" IS NULL));`,
                    },
                ],
                'mappings',
                'author_id',
                'source_phrase',
            ),
        ).toBe(true);
    });

    it('⛔ ignores an UPDATE that writes a value rather than clearing one, and one not keyed on an owner', () => {
        const sweep = {
            file: 'fake/sweep.ts',
            contents: `
                export const eraseRows = async (tx) => {
                    await tx.execute(sql\`
                        UPDATE recipes SET author_handle = \${pseudonym} WHERE owner_id = \${ownerId}
                    \`);
                    await tx.execute(sql\`
                        UPDATE recipes SET cloned_from_id = NULL WHERE cloned_from_id IN (SELECT id FROM x)
                    \`);
                    await tx.execute(sql\`
                        UPDATE memos SET owner_id = NULL, source_phrase = NULL WHERE owner_id = \${ownerId}
                    \`);
                };
            `,
        };

        // A pseudonym is not a blind spot — the row shape it leaves still carries its owner. Neither is a
        // statement that reaches rows by something other than a person; there is no owner to pair against.
        expect(deIdentifyingStatementsIn(sweep, 'eraseRows')).toEqual([
            { table: 'memos', ownerColumn: 'owner_id', nulledColumns: ['owner_id', 'source_phrase'] },
        ]);
    });

    it('reads a CHECK from the SQL and not from a header quoting one', () => {
        expect(
            pairChecked(
                [
                    {
                        file: 'fake/0099_prose.sql',
                        contents: `
                            -- The pairing this table needs would be
                            --   CHECK (("owner_id" IS NULL) = ("source_line" IS NULL))
                            -- and it is deliberately NOT added here.
                            CREATE TABLE "notes" ("id" uuid PRIMARY KEY, "owner_id" text, "source_line" text);
                        `,
                    },
                ],
                'notes',
                'owner_id',
                'source_line',
            ),
        ).toBe(false);
    });

    it('reads a column from SQL but not from the prose describing it', () => {
        expect(
            ownerBearingTablesIn({
                file: 'fake/0100_prose.sql',
                contents: `
                    -- This table deliberately carries NO owner_id; the prescribed sweep would have been
                    --   UPDATE "notes" SET author_id = NULL WHERE author_id = $1;
                    CREATE TABLE "notes" ("id" uuid PRIMARY KEY, "body" text NOT NULL);
                `,
            }),
        ).toEqual([]);
    });

    it('reads a column added by a later ALTER, not only one declared at CREATE', () => {
        expect(
            ownerBearingTablesIn({
                file: 'fake/0101_alter.sql',
                contents: `ALTER TABLE "memos" ADD COLUMN IF NOT EXISTS "owner_id" text;`,
            }),
        ).toEqual(['memos']);
    });

    it('reads the sweep’s MUTATIONS, not its docstring and not the tables it merely reads', () => {
        const swept = sweptTablesIn(
            {
                file: 'fake/docstring.ts',
                contents: `
                    /**
                     * Deletes from recipes, collections and author_handles, and deliberately never touches
                     * the shared ingredients table.
                     */
                    export const eraseRows = async (tx) => {
                        await tx.execute(sql\`SELECT id FROM widgets WHERE owner_id = \${ownerId}\`);
                        await tx.execute(sql\`DELETE FROM collections WHERE owner_id = \${ownerId}\`);
                    };
                `,
            },
            'eraseRows',
        );

        // `widgets` is READ, never erased — counting it would report a table as reached by a sweep that
        // only looks at it, which is the false negative this gate cannot afford.
        expect([...swept]).toEqual(['collections']);
    });
});
