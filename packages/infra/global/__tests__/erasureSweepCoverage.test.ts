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
 * ## ⛔ THE SECOND ROW-LEVEL HOLE — a person's data on ANOTHER PERSON'S ROW (owner ruling 2026-08-25)
 *
 * The pairing rule above closes "a row with no owner". It does not close "a row with the WRONG owner", and
 * that is where the next instance came from. `collections.source_owner_handle` (migration 0016) freezes the
 * SOURCE owner's display handle when somebody clones their collection — so A's handle is written onto B's
 * row. Erasure's collection statement is `DELETE FROM collections WHERE owner_id = $1`, which reaches A's own
 * collections and, by construction, never the copy of A's name on B's. `collections` counted as SWEPT, every
 * assertion in this file was green, and the same datum was pseudonymized in `recipes` and left intact here.
 * `recipe_versions.editor_handle` was the identical defect one table over, surviving on every KEPT recipe's
 * version rows.
 *
 * Two things had to change, and only the second is a widening of the gate's REACH:
 *
 *  * the verdict had to become PER COLUMN. No per-table statement can express "this table is swept and this
 *    column of it is not", and that sentence is the whole defect.
 *  * the discovery vocabulary had to grow. {@link OWNER_COLUMNS} lists IDENTIFIERS — the things a sweep keys
 *    on — and a handle is not one. So {@link HANDLE_COLUMN} matches the PAYLOAD by shape, and every location
 *    it finds must be written by the sweep or claimed by a person.
 *
 * ⚠️ Stated plainly, because it bounds what this file promises: the vocabulary is still a vocabulary. A
 * personal column that is neither an id nor a handle — an address, a phone number, a free-text note — is
 * invisible to both, exactly as `source_owner_handle` was invisible to the first. This gate narrows the class
 * twice; it does not close it.
 *
 * ## ⛔ THE 2026-08-25 OWNER RULING ON INGREDIENT PHRASES, and what it changed here (ADR-0027)
 *
 * The owner ruled that **an ingredient phrase — the original a cook typed, or a corrected one — is NOT
 * private data.** It is not erasable, no sweep targets it, and migration 0033 removed the three statements
 * this gate was extended to cover, dropped the memo tier's person column, and repealed the two CHECKs the
 * pairing rule above was written around. Two correction tables still carry a `user_id`, deliberately: it is
 * how the installation counts how many DISTINCT people made the same correction, and it is two of the three
 * `WHERE` clauses that authorize those tables.
 *
 * That creates a THIRD verdict this gate did not have — "carries a user column and is deliberately not
 * swept" — and it must not be folded into {@link EXEMPT_FROM_SWEEP}. The two claims are checked differently:
 *
 *  * an EXEMPTION claims a MECHANISM — "erasure still reaches this data by some other means" — and is
 *    verified against that mechanism (`recipe_versions` held the only such entry, on the strength of the
 *    cascade from `recipes`, until the 2026-08-25 handle ruling gave it a sweep statement of its own);
 *  * a RETENTION claims CONTENT — "the only user-derived thing left here is an opaque identifier, kept for a
 *    stated purpose" — which no mechanism can discharge, so it is verified by PINNING the table's whole
 *    current column set. That pin is the only mechanical check on what a retention entry actually asserts:
 *    it is what stops a genuinely personal column (a handle, an address, a free-text note) accreting on a
 *    retained table and never being noticed, which is the failure this whole file exists for.
 *
 * ⛔ One map with two meanings would be one map with two unenforceable meanings. That is why there are two.
 *
 * ## What is asserted, and why it is bidirectional
 *
 * The user-bearing tables are DISCOVERED from the migration files — never enumerated here — and the swept
 * tables are DISCOVERED from the statements `eraseRecipeRows` actually issues. Then:
 *
 *  * every discovered user-bearing table is swept, exempted with its reason, or retained with its ruling —
 *    never none of the three;
 *  * every exemption and every retention names a table that still EXISTS and still carries a user column, so
 *    neither can outlive the thing it excused;
 *  * neither an exemption nor a retention names a table the sweep already reaches, so a claim that has
 *    quietly been closed is reported rather than left standing as a lie about the sweep;
 *  * a retention pins the table's ENTIRE column set, so a new column on a retained table is a decision
 *    somebody has to make rather than a silent addition;
 *  * a retention's reason cites an ADR file that EXISTS on disk — a stricter bar than an exemption's, because
 *    a retention converts "RED unless swept" into "green forever";
 *  * every column a de-identifying statement NULLs is pair-checked against the owner column that statement
 *    keys on, so no row shape can exist that carries the data and not the predicate;
 *  * every discovered HANDLE-bearing `table.column` is WRITTEN by the sweep, or claimed to be destroyed with
 *    the row that carries it — a per-COLUMN verdict, because a handle can sit on a row belonging to somebody
 *    other than the person it names, and every assertion above it reasons per TABLE.
 *
 * A non-vacuity floor guards the discovery itself: if the parser stops finding tables — a syntax change, a
 * moved directory, a renamed function — the gate must go RED rather than pass by finding nothing, which is
 * the failure mode `natEgressConsumers.test.ts` was written against and this file mirrors deliberately.
 *
 * ## ⚠️ THE DISCOVERY IS A FOLD OVER THE ORDERED MIGRATIONS, not a union over them
 *
 * It used to union every table any migration ever gave a user column. That was silently wrong in one
 * direction nobody had hit: a DROPPED column would leave this gate demanding a sweep for something that does
 * not exist, escapable only by hand-writing an exemption asserting a fact the schema already states. 0033 is
 * the first drop, so the parser now REDUCES — honouring `ALTER TABLE … DROP COLUMN` and
 * `ALTER TABLE … RENAME COLUMN` — and the derived set is the CURRENT schema.
 *
 * ⛔ A fold can fail in a direction a union structurally cannot: it can REMOVE a real user column and turn a
 * genuinely unswept personal table green. Two things bound that, and both are asserted below. The fold's
 * result must be a SUBSET of the union (a fold may only ever remove), which catches any parser bug in the
 * add direction for free; and the non-vacuity floor is set against the CURRENT count rather than a historical
 * one, so a fold that spuriously drops a table goes red instead of quietly having room to.
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
 * This gate covers the RECIPE database (`eraseRecipeRows`) and — since plan U17 — the FOOD database
 * (`eraseFoodRows`), each with its own floors and maps on its {@link SWEPT_DATABASES} entry. `identity`
 * has its own erasure surface, which this file makes no claim about. The food entry exists AHEAD of any
 * `food.user_id` column on purpose (R24): U10's authored-foods tables must land RED here until swept or
 * ruled, never silently — verified by mutation on 2026-08-31 (a fake user-keyed food migration turned the
 * gate red naming the table).
 *
 * DESIGN PATTERN: Specification module over eight pure verdicts — {@link columnEffectsIn} (folded by
 * {@link trackedColumnsAfter} for both vocabularies), {@link declaredColumnsIn}, {@link currentColumnsOf},
 * {@link sweptTablesIn}, {@link writtenColumnsIn}, {@link deIdentifyingStatementsIn} and
 * {@link checkExpressionsFor} are pure functions over a source, fired at deliberately-violating fakes below
 * as well as at the working tree.
 */
import { existsSync, readFileSync } from 'node:fs';
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
const OWNER_COLUMNS = [
    'owner_id',
    'author_id',
    'user_id',
    'created_by',
    // The FOOD database's one spelling (plan U17): `fetch_requesters.requester_id` — an app-user ULID
    // since migration 0002 renamed it from the Clerk `sub`. Harmless to the recipe database (no recipe
    // table uses the spelling), and ONE vocabulary beats a per-database one: a spelling is a decision,
    // not a schema fact, and two lists would drift the day a table moves between services.
    'requester_id',
    // U11 (0040): `ingredients.food_owner_id` — the captured privacy fact for a private authored food.
    // An app-user ULID like every other member; the sweep's step 13 reaches it.
    'food_owner_id',
] as const;

/**
 * The columns that hold a person's DISPLAY HANDLE — their name as other people read it.
 *
 * ## ⛔ WHY THIS IS A SECOND VOCABULARY AND NOT FOUR MORE ENTRIES IN {@link OWNER_COLUMNS}
 *
 * An owner column is a PREDICATE: it is how a sweep REACHES a row. A handle column is PAYLOAD: it is what a
 * sweep has to CLEAR, and it is useless as a predicate — `author_handles.display_name` is identity's
 * `profiles.displayName`, which carries no uniqueness constraint anywhere, so keying on the value would let
 * one person's erasure rewrite an unrelated person's row. Merging the two sets would feed handle spellings
 * into {@link deIdentifyingStatementsIn}'s "keyed on" regex and quietly bless exactly that.
 *
 * ## ⛔ THE INSTANCE THIS WAS ADDED FOR, and why the per-TABLE assertions could not see it
 *
 * `collections.source_owner_handle` (migration 0016) freezes the source owner's handle at clone time — so it
 * sits on the CLONER's row. Erasure's collection statement is `DELETE FROM collections WHERE owner_id = $1`,
 * which reaches the erased user's OWN collections and, by construction, not a copy of their handle on
 * somebody else's. `collections` therefore counted as SWEPT and every table-level assertion in this file was
 * green while the handle survived. `recipe_versions.editor_handle` was the same defect one table over: a KEPT
 * (truly-public or donated) recipe's version rows are not reached by the cascade, so they too kept the
 * cleartext. Both are now swept; the assertion below is what turns the THIRD one RED the day it lands.
 *
 * ⚠️ A PATTERN, not a closed list — deliberately the opposite choice from {@link OWNER_COLUMNS}. The closed
 * list is defensible there because an owner column must be one the sweep can key on, and adding a spelling is
 * a decision somebody takes. A handle column is discovered by SHAPE, and the whole reason this hole existed
 * is that nobody wrote `source_owner_handle` down. A false positive costs one line of adjudication, which is
 * the friction this file exists to create.
 *
 * ⚠️ `display_name` is matched EXACTLY, not as a `*_name` suffix. `collections.source_collection_name` is a
 * collection's title — authored content of the same kind as a kept public recipe's title, which erasure keeps
 * by design — and sweeping every `_name` column would drag it in without anybody deciding to.
 */
const HANDLE_COLUMN = /^(?:[a-z0-9_]+_)?handle$|^display_name$/;

/** One database whose owner-bearing tables are gated, and the sweep that must reach them. */
interface SweptDatabase {
    /** Repo-relative migrations directory whose files define the schema. */
    readonly migrations: string;
    /** Repo-relative source declaring the sweep. */
    readonly sweepFile: string;
    /** The exported function whose statements ARE the sweep. */
    readonly sweepFunction: string;
    /**
     * The fewest user-bearing tables a working discovery must find in THIS database — the non-vacuity
     * floor, per database because the databases are different sizes and slack in one must not hide a
     * spurious drop in the other. Keep it EXACT (zero slack): it must be raised in the same change as any
     * migration adding a user-bearing table.
     */
    readonly minimumOwnerBearingTables: number;
    /** The fewest handle-bearing `table.column` locations — same posture, per database. May be 0. */
    readonly minimumHandleBearingColumns: number;
    /** This database's {@link EXEMPT_FROM_SWEEP}-shaped map. */
    readonly exemptFromSweep: ReadonlyMap<string, string>;
    /** This database's {@link RETAINED_BY_RULING}-shaped map. */
    readonly retainedByRuling: ReadonlyMap<string, { readonly why: string; readonly columns: readonly string[] }>;
    /** This database's {@link HANDLE_COLUMNS_DELETED_WITH_THEIR_ROW}-shaped map. */
    readonly handleColumnsDeletedWithTheirRow: ReadonlyMap<string, string>;
}

/**
 * Tables that carry an owner column and are DELIBERATELY not swept by a statement of their own.
 *
 * ⛔ An exemption is a claim that erasure still reaches the data by some OTHER means, and it is checked in
 * both directions below: it must name a table that exists and still carries an owner column, and it must not
 * name a table the sweep already touches. "It seemed fine" is not an entry.
 *
 * ⚠️ **Currently EMPTY, and that is a true statement about the sweep rather than an emptied map.** Its one
 * entry was `recipe_versions`, on the claim that the cascade from `recipes` covered it. That claim was only
 * ever about `created_by`; the `editor_handle` beside it survived on every KEPT recipe's versions, and the
 * owner ruling of 2026-08-25 added a statement that writes it. A swept table may not hold an exemption (the
 * assertion below), so the entry went with the fix. The assertions over this map are therefore STANDING
 * RULES that fire the day an exemption returns — the same posture, and for the same reason, as the deleted
 * `MINIMUM_DE_IDENTIFYING_STATEMENTS` constant discussed further down.
 */
const EXEMPT_FROM_SWEEP: ReadonlyMap<string, string> = new Map([]);

/**
 * Handle-bearing `table.column` locations the sweep deliberately does not WRITE, because erasure destroys the
 * whole row that carries them.
 *
 * ⛔ A column-level claim, and it needs its own map for the reason the module docstring gives about the two
 * table-level ones: an entry here says something a table-level entry cannot say, and a map with two meanings
 * is a map with two unenforceable meanings. The claim is narrow — "this handle goes with its row" — and it is
 * checked in both directions below, exactly as {@link EXEMPT_FROM_SWEEP}'s is.
 *
 * ⚠️ This is the ONE place a `DELETE` may stand in for a pseudonym write, and the difference from
 * `collections` is the whole point. `DELETE FROM author_handles WHERE user_id = $1` removes the row that IS
 * the erased user's; `DELETE FROM collections WHERE owner_id = $1` removes the erased user's collections
 * while their handle sits on somebody else's. Syntactically the two statements are the same shape, which is
 * why the distinction has to be written down by a person rather than inferred.
 */
const HANDLE_COLUMNS_DELETED_WITH_THEIR_ROW: ReadonlyMap<string, string> = new Map([
    [
        'author_handles.display_name',
        'the row IS the erased user’s (`DELETE FROM author_handles WHERE user_id = $1`), so the cleartext ' +
            'goes with it; no other person’s row carries this column',
    ],
]);

/**
 * Tables that carry a user column which is deliberately NOT swept, because the column is not erasable
 * personal data — a claim about CONTENT, unlike {@link EXEMPT_FROM_SWEEP}'s claim about a mechanism.
 *
 * ⛔ An entry is a RULING, and it is the strongest thing this file accepts on a human's word, so it carries
 * the strictest checks: the reason must cite an ADR file that exists, and `columns` pins the table's ENTIRE
 * current column set. That pin is the point. Without it an entry would silently excuse every FUTURE column
 * on the table too, and both of these tables are under active development — a handle, an address or a
 * free-text note landing beside the id would be exactly the "right exercised, reported complete, and not
 * honoured" failure this file was written about, wearing a green check.
 *
 * ⚠️ Adding a column to a retained table therefore costs one line here. That is deliberate friction, not an
 * oversight: it is the only moment anybody is forced to ask whether the new column is personal data.
 */
const RETAINED_BY_RULING: ReadonlyMap<string, { readonly why: string; readonly columns: readonly string[] }> = new Map([
    [
        'ingredient_resolution_mappings',
        {
            why:
                '`user_id` is the DISTINCT-USER corroboration counter and two of the three WHERE clauses ' +
                'that authorize this table; the phrase beside it is not private data — owner ruling ' +
                '2026-08-25, docs/architecture/decisions/0027-ingredient-phrase-is-not-personal-data.md',
            columns: [
                'id',
                'normalized_key',
                'source_phrase',
                'food_id',
                'scope',
                'origin',
                'user_id',
                'surfacing',
                'corroborated_a',
                'corroborated_b',
                'superseded_at',
                'superseded_by',
                'created_at',
            ],
        },
    ],
    [
        'ingredient_parse_corrections',
        {
            why:
                '`user_id` plays the identical role one tier down — the distinct-cook count and the ' +
                'supersede predicate; the corrected line is not private data — owner ruling 2026-08-25, ' +
                'docs/architecture/decisions/0027-ingredient-phrase-is-not-personal-data.md',
            columns: [
                'id',
                'normalized_key',
                'source_line',
                'corrected_facts',
                'scope',
                'origin',
                'user_id',
                'surfacing',
                'corroborated_a',
                'corroborated_b',
                'superseded_at',
                'superseded_by',
                'created_at',
            ],
        },
    ],
]);

/**
 * The fewest user-bearing tables a working discovery must find.
 *
 * A floor, never the list — the point of discovery is that the list is not written down. It exists so a
 * parser that silently stops matching goes RED instead of green, which is the failure a gate over a derived
 * set is most exposed to.
 *
 * ⚠️ Raised from 6 to 8 when the discovery became a FOLD (see the module docstring), and 8 → 9 when U11's
 * 0040 gave `ingredients` its `food_owner_id`. The current schema has exactly nine, so the slack a fold
 * could use to spuriously drop a table is ZERO — one spurious drop goes red. That is deliberate, and it is
 * the cost: this constant must be raised in the same change as any migration adding a user-bearing table,
 * or the gate goes red on the addition rather than on a defect.
 */
const MINIMUM_OWNER_BEARING_TABLES = 9;

/**
 * The fewest handle-bearing `table.column` locations a working discovery must find.
 *
 * A floor, never the list — the same posture as {@link MINIMUM_OWNER_BEARING_TABLES} and for the same reason:
 * a shape predicate that silently stops matching must go RED rather than pass by finding nothing, and a
 * per-column dimension is more exposed to that than a per-table one, because it depends on the clause parser
 * as well as on the pattern.
 *
 * ⚠️ The current schema has exactly four (`recipes.author_handle`, `recipe_versions.editor_handle`,
 * `collections.source_owner_handle`, `author_handles.display_name`), so the slack is ZERO and a migration
 * that adds a fifth must raise this in the same change.
 */
const MINIMUM_HANDLE_BEARING_COLUMNS = 4;

/**
 * The databases this gate covers. See the module docstring's scope note before adding one.
 *
 * ⛔ THE FOOD ENTRY IS U17's WHOLE POINT, and it ships BEFORE any `food.user_id` column exists (R24's
 * precondition, made a real dependency edge by the round-2 review): U10's authored-foods migration must
 * land RED here until its table is swept or ruled, never silently. Today the food database's one
 * user-bearing table is `fetch_requesters` (`requester_id`, an app-user ULID since its 0002 rename), and
 * its sweep is `eraseFoodRows` — the raw-SQL sweep function `UserErasureService.eraseUser` issues, shaped
 * like `eraseRecipeRows` precisely so this parser can read its statements.
 */
const SWEPT_DATABASES: readonly SweptDatabase[] = [
    {
        migrations: 'packages/services/recipe-service/src/database/migrations',
        sweepFile: 'packages/services/recipe-workers/src/handlers/accountErasureWorker.ts',
        sweepFunction: 'eraseRecipeRows',
        minimumOwnerBearingTables: MINIMUM_OWNER_BEARING_TABLES,
        minimumHandleBearingColumns: MINIMUM_HANDLE_BEARING_COLUMNS,
        exemptFromSweep: EXEMPT_FROM_SWEEP,
        retainedByRuling: RETAINED_BY_RULING,
        handleColumnsDeletedWithTheirRow: HANDLE_COLUMNS_DELETED_WITH_THEIR_ROW,
    },
    {
        migrations: 'packages/services/food-service/src/db/migrations',
        sweepFile: 'packages/services/food-service/src/foods/eraseFoodRows.ts',
        sweepFunction: 'eraseFoodRows',
        // Exactly `fetch_requesters` + `food` (0013's authored-foods user_id, plan U10) — zero slack,
        // like the recipe floor. This went 1 → 2 in the same change as 0013, exactly as the entry's own
        // comment demanded.
        minimumOwnerBearingTables: 2,
        // The food schema carries no display handles. A first one arriving must raise this floor in the
        // same change that adjudicates it.
        minimumHandleBearingColumns: 0,
        exemptFromSweep: new Map(),
        retainedByRuling: new Map(),
        handleColumnsDeletedWithTheirRow: new Map(),
    },
];

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
 * The clause text of every `ALTER TABLE <table>` statement in one source, up to its `;`.
 *
 * ⛔ THIS EXISTS BECAUSE `ALTER TABLE` TAKES A COMMA-SEPARATED CLAUSE LIST, and this repository already
 * writes one — `0016_collection_source_provenance.sql` adds three columns under a single
 * `ALTER TABLE collections`. Every parser here used to anchor its clause pattern directly to
 * `ALTER TABLE <t>`, which sees the FIRST clause and no other. MEASURED while fixing this: a probe adding
 * `user_id` in clause position 2 to an unswept table left the whole gate GREEN — a user-bearing table
 * invisible to the check that exists to find exactly that.
 *
 * ⚠️ Splitting on `;` is sound HERE and would not be in general: comments are stripped before this runs,
 * and no migration in this tree puts a semicolon inside a string literal or a dollar-quoted body within an
 * `ALTER TABLE`. If one ever does, this is the line that needs a real tokenizer.
 *
 * @param sql - Comment-stripped migration text.
 * @param table - The table whose statements are wanted, or `undefined` for every table.
 * @returns One entry per matching statement: the table it alters, and its clause text. Pure.
 */
function alterClausesIn(sql: string, table?: string): readonly { table: string; clauses: string }[] {
    const name = table === undefined ? '([a-z_][a-z0-9_]*)' : `(${table})`;
    const found: { table: string; clauses: string }[] = [];

    for (const match of sql.matchAll(new RegExp(`ALTER\\s+TABLE\\s+(?:ONLY\\s+)?"?${name}"?\\s`, 'gi'))) {
        const start = (match.index ?? 0) + match[0].length;
        const end = sql.indexOf(';', start);

        if (match[1] !== undefined) {
            found.push({ table: match[1], clauses: sql.slice(start, end === -1 ? sql.length : end) });
        }
    }

    return found;
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

/** Leading words of a `CREATE TABLE` clause that introduces a constraint rather than a column. */
const NOT_A_COLUMN: ReadonlySet<string> = new Set([
    'constraint',
    'check',
    'primary',
    'unique',
    'foreign',
    'exclude',
    'like',
]);

/**
 * The columns DECLARED by a `CREATE TABLE` body — its clauses that define a column rather than a constraint.
 *
 * ⚠️ Splits on TOP-LEVEL commas, not on newlines, and that is load-bearing in both directions. Real
 * migrations in this tree write one column per line; the deliberately-violating fakes below write a whole
 * table on one line. A newline split reads the fakes as a single `id` column, which would silently disarm
 * every case that drives this parser at a violation. Depth tracking is what makes the comma split safe over
 * `varchar(255)` and `numeric(10, 2)`.
 *
 * @param body - The parenthesised body of a `CREATE TABLE`, comments already stripped.
 * @returns The declared column names, in declaration order. Pure.
 */
function declaredColumnsIn(body: string): readonly string[] {
    const columns: string[] = [];
    let depth = 0;
    let start = 0;

    const take = (clause: string): void => {
        const definition = /^\s*"?([a-z_][a-z0-9_]*)"?\s+[a-z]/i.exec(clause);

        if (definition?.[1] !== undefined && !NOT_A_COLUMN.has(definition[1].toLowerCase())) {
            columns.push(definition[1]);
        }
    };

    for (let i = 0; i < body.length; i += 1) {
        if (body[i] === '(') {
            depth += 1;
        } else if (body[i] === ')') {
            depth -= 1;
        } else if (body[i] === ',' && depth === 0) {
            take(body.slice(start, i));
            start = i + 1;
        }
    }

    take(body.slice(start));

    return columns;
}

/**
 * What one migration file does to the columns a predicate TRACKS: which tables it gives one, and which it
 * takes one away from.
 *
 * ⚠️ Parameterized by the predicate rather than hardcoding {@link OWNER_COLUMNS}, because two different
 * vocabularies are folded over the same DDL — owner columns (a sweep's predicate) and handle columns (a
 * sweep's payload). One tested fold, two subjects; a copy for the second would be a copy of every subtlety
 * the comments below record.
 *
 * Reads the four spellings that occur in this repository — a `CREATE TABLE` whose body declares the column,
 * an `ALTER TABLE … ADD COLUMN` that adds one later (0026's shape), an `ALTER TABLE … DROP COLUMN` that
 * removes one (0033's), and an `ALTER TABLE … RENAME COLUMN` that changes which spelling a table carries
 * (0033's again). Quoting is optional on all four, because every style is present in the tree.
 *
 * ⚠️ Comments are stripped FIRST, and that is load-bearing for the two new forms in a way it was not for the
 * two old ones: this repository's migration headers quote their own `ALTER` statements in prose — 0031's
 * prints its backfills, 0033's prints what it drops — so an unstripped read would let a DESCRIPTION of a drop
 * remove a real column from the derived schema. Asserted directly by a fake below.
 *
 * @param source - One migration file.
 * @param tracked - Whether a column name is one this fold follows.
 * @returns The `[table, column]` pairs it introduces and retires. PAIRS, not tables — see
 *   `userBearingTablesAfter` for why a table leaves the set only when its last one goes. Pure.
 */
function columnEffectsIn(
    source: SourceFile,
    tracked: (column: string) => boolean,
): {
    readonly gained: readonly (readonly [string, string])[];
    readonly lost: readonly (readonly [string, string])[];
} {
    const sql = stripSqlComments(source.contents);
    const gained: [string, string][] = [];
    const lost: [string, string][] = [];
    const isUserColumn = tracked;

    for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi)) {
        const body = balancedBody(sql, sql.indexOf('(', (match.index ?? 0) + match[0].length - 1));

        for (const column of declaredColumnsIn(body)) {
            if (match[1] !== undefined && isUserColumn(column)) {
                gained.push([match[1], column]);
            }
        }
    }

    // ⛔ Every `ALTER` form below reads the statement's WHOLE clause list — see `alterClausesIn`. A pattern
    // anchored to `ALTER TABLE <t> ADD COLUMN <user>` sees only the first clause, which is how a user column
    // in position 2+ became invisible to this gate.
    for (const { table, clauses } of alterClausesIn(sql)) {
        for (const add of clauses.matchAll(/\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) {
            if (add[1] !== undefined && isUserColumn(add[1])) {
                gained.push([table, add[1]]);
            }
        }

        for (const drop of clauses.matchAll(/\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) {
            if (drop[1] !== undefined && isUserColumn(drop[1])) {
                lost.push([table, drop[1]]);
            }
        }

        // A RENAME is BOTH — it retires one spelling and may introduce another. Tracked per COLUMN rather
        // than per table, so a table carrying two user columns that loses one stays user-bearing.
        for (const rename of clauses.matchAll(
            /\bRENAME\s+COLUMN\s+"?([a-z_][a-z0-9_]*)"?\s+TO\s+"?([a-z_][a-z0-9_]*)"?/gi,
        )) {
            const [, from, to] = rename;

            if (from === undefined || to === undefined) {
                continue;
            }

            if (isUserColumn(from)) {
                lost.push([table, from]);
            }

            if (isUserColumn(to)) {
                gained.push([table, to]);
            }
        }
    }

    return { gained, lost };
}

/**
 * The tables that carry a user column AFTER the whole ordered migration set has been applied.
 *
 * ⛔ A FOLD, not a union, and the order therefore matters — see the module docstring for why it changed. The
 * caller is responsible for supplying the sources in APPLY order; {@link migrationsOf} sorts them.
 *
 * @param migrations - The migration files, in apply order.
 * @returns The user-bearing table names, sorted. Pure.
 */
function userBearingTablesAfter(migrations: readonly SourceFile[]): readonly string[] {
    return [...trackedColumnsAfter(migrations, isOwnerColumn).keys()].sort();
}

/** Whether a column name is one a sweep can KEY ON — an identifier for a person. Pure. */
function isOwnerColumn(column: string): boolean {
    return (OWNER_COLUMNS as readonly string[]).includes(column);
}

/** Whether a column name HOLDS a person's display handle — payload a sweep must clear. Pure. */
function isHandleColumn(column: string): boolean {
    return HANDLE_COLUMN.test(column);
}

/**
 * The tracked columns each table carries AFTER the whole ordered migration set has been applied.
 *
 * ⛔ A FOLD, not a union, and the order therefore matters — see the module docstring for why it changed. The
 * caller is responsible for supplying the sources in APPLY order; {@link migrationsOf} sorts them.
 *
 * ⛔ Keyed by table to a SET OF COLUMNS, never to a bare table flag. A table leaves the derived set only when
 * its LAST tracked column goes — subtracting the table on any drop would take a two-tracked-column table out
 * on losing one of them, which is the fold's one genuinely dangerous direction.
 *
 * @param migrations - The migration files, in apply order.
 * @param tracked - Whether a column name is one this fold follows.
 * @returns Table name → the tracked columns it still carries. Pure.
 */
function trackedColumnsAfter(
    migrations: readonly SourceFile[],
    tracked: (column: string) => boolean,
): ReadonlyMap<string, ReadonlySet<string>> {
    const carried = new Map<string, Set<string>>();

    for (const source of migrations) {
        const { gained, lost } = columnEffectsIn(source, tracked);

        for (const [table, column] of lost) {
            const columns = carried.get(table);

            if (columns !== undefined) {
                columns.delete(column);

                if (columns.size === 0) {
                    carried.delete(table);
                }
            }
        }

        for (const [table, column] of gained) {
            const columns = carried.get(table) ?? new Set<string>();

            columns.add(column);
            carried.set(table, columns);
        }
    }

    return carried;
}

/**
 * Every `table.column` holding a person's display handle AFTER the whole ordered migration set has been
 * applied.
 *
 * ⛔ Per COLUMN, not per table, and that is the entire point of this dimension. A handle can sit on a row
 * belonging to somebody OTHER than the person it names (`collections.source_owner_handle` is exactly that),
 * so its table is reached by the sweep while the datum is not. A per-table verdict reports that as covered —
 * which is what it did, for as long as the defect stood.
 *
 * @param migrations - The migration files, in apply order.
 * @returns The `table.column` locations, sorted. Pure.
 */
function handleBearingColumnsAfter(migrations: readonly SourceFile[]): readonly string[] {
    return [...trackedColumnsAfter(migrations, isHandleColumn)]
        .flatMap(([table, columns]) => [...columns].map((column) => `${table}.${column}`))
        .sort();
}

/**
 * The tables any migration EVER gave a user column — the pre-fold union.
 *
 * Kept only so the fold can be checked against it: a fold may remove and must never add, and comparing the
 * two is what catches a parser bug in the add direction without anyone enumerating a table.
 *
 * @param migrations - The migration files.
 * @returns The union's table names, sorted. Pure.
 */
function userBearingTablesEver(migrations: readonly SourceFile[]): readonly string[] {
    return [
        ...new Set(
            migrations.flatMap((source) => columnEffectsIn(source, isOwnerColumn).gained.map(([table]) => table)),
        ),
    ].sort();
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
 * The `table.column` locations the named function's SQL actually WRITES — the left-hand side of every `SET`
 * assignment in every `UPDATE` it issues.
 *
 * ⛔ WRITES, not "mentions". A column named only in a `WHERE` is one the sweep reads to FIND a row, not one
 * it clears, and counting that would report `collections.source_owner_handle` as covered by any statement
 * that merely filtered on it.
 *
 * ⛔ And a `DELETE` deliberately does NOT count, which is the whole distinction this dimension exists to
 * draw. `DELETE FROM collections WHERE owner_id = $1` and `DELETE FROM author_handles WHERE user_id = $1` are
 * the same shape; the first removes the erased user's own rows while their handle sits on somebody else's,
 * the second removes the row that IS the handle. No parser can tell those apart, so the one legitimate case
 * is written down by a person in {@link HANDLE_COLUMNS_DELETED_WITH_THEIR_ROW} instead of being inferred.
 *
 * @param source - The source declaring the sweep.
 * @param functionName - The declaration whose statements are read.
 * @returns The `table.column` locations it assigns to. Pure.
 */
function writtenColumnsIn(source: SourceFile, functionName: string): readonly string[] {
    const written = new Set<string>();

    for (const text of statementTextsIn(source, functionName)) {
        const update = /\bUPDATE\s+"?([a-z_][a-z0-9_]*)"?\s+SET\s+([\s\S]*?)(?:\sWHERE\s[\s\S]*)?$/i.exec(text);
        const [, table, assignments] = update ?? [];

        if (table === undefined || assignments === undefined) {
            continue;
        }

        // Anchored to a clause boundary — the start of the SET list or a comma — so `now()` in
        // `updated_at = now()` cannot be read as an assignment target of its own.
        for (const assignment of assignments.matchAll(/(?:^|,)\s*"?([a-z_][a-z0-9_]*)"?\s*=/g)) {
            if (assignment[1] !== undefined) {
                written.add(`${table}.${assignment[1]}`);
            }
        }
    }

    return [...written].sort();
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
 * Every `CHECK (…)` expression IN FORCE on one table after the whole ordered migration set has been applied.
 *
 * Three spellings this repository uses are read: a `CONSTRAINT <name> CHECK (…)` inside the `CREATE TABLE`
 * body, a later `ALTER TABLE … ADD CONSTRAINT <name> CHECK (…)`, and an `ALTER TABLE … DROP CONSTRAINT
 * <name>` that retires one. Comments are stripped first, for the header's reason — 0021's own header prints
 * the prescribed sweep, `author_id` and all.
 *
 * ⛔ A FOLD, not a union, for the reason the module docstring gives about table discovery — and here the
 * union failed in the MORE dangerous direction. It reported a DROPPED CHECK as still present, so a table
 * whose pairing constraint had been repealed would satisfy `pairChecked` on the strength of DDL that no
 * longer runs, and the pairing assertion — this file's stated defence against the corroboration-binding
 * class of defect — would pass vacuously. Migration 0033 drops three CHECKs, which is what made a latent
 * defect a live one.
 *
 * ⚠️ Keyed on CONSTRAINT NAME, because that is what `DROP CONSTRAINT` names. An unnamed inline `CHECK` in a
 * `CREATE TABLE` body cannot be dropped by name and is retained unconditionally; every constraint in this
 * tree is named, which is itself why the convention is worth keeping.
 *
 * @param sources - The migration files, in apply order.
 * @param table - The table whose constraints are wanted.
 * @returns The text inside each `CHECK` still in force. Pure.
 */
function checkExpressionsFor(sources: readonly SourceFile[], table: string): readonly string[] {
    const named = new Map<string, string>();
    const anonymous: string[] = [];

    const checksIn = (body: string): readonly string[] => {
        const found: string[] = [];

        for (const check of body.matchAll(/\bCHECK\s*\(/gi)) {
            found.push(balancedBody(body, body.indexOf('(', (check.index ?? 0) + check[0].length - 1)));
        }

        return found;
    };

    for (const source of sources) {
        const sql = stripSqlComments(source.contents);
        const create = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?${table}"?\\s*\\(`, 'i').exec(sql);

        if (create !== null) {
            const body = balancedBody(sql, sql.indexOf('(', create.index + create[0].length - 1));

            for (const clause of body.split(/,\s*(?=CONSTRAINT\b)/i)) {
                const name = /^\s*CONSTRAINT\s+"?([a-z_][a-z0-9_]*)"?/i.exec(clause);

                for (const expression of checksIn(clause)) {
                    if (name?.[1] !== undefined) {
                        named.set(name[1], expression);
                    } else {
                        anonymous.push(expression);
                    }
                }
            }
        }

        for (const { clauses } of alterClausesIn(sql, table)) {
            for (const add of clauses.matchAll(
                /\bADD\s+CONSTRAINT\s+"?([a-z_][a-z0-9_]*)"?([\s\S]*?)(?=,\s*(?:ADD|DROP|RENAME|ALTER)\b|$)/gi,
            )) {
                const [, name, definition] = add;
                const [expression] = definition === undefined ? [] : checksIn(definition);

                if (name !== undefined && expression !== undefined) {
                    named.set(name, expression);
                }
            }

            for (const drop of clauses.matchAll(/\bDROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) {
                if (drop[1] !== undefined) {
                    named.delete(drop[1]);
                }
            }
        }
    }

    return [...anonymous, ...named.values()];
}

/**
 * Every column one table carries AFTER the whole ordered migration set has been applied.
 *
 * The same fold `userBearingTablesAfter` performs, over ALL columns rather than only the user-identifying
 * ones: `CREATE TABLE` seeds the set, `ADD COLUMN` grows it, `DROP COLUMN` shrinks it, `RENAME COLUMN`
 * substitutes. It exists to discharge the one claim a {@link RETAINED_BY_RULING} entry makes that no
 * mechanism can — that nothing personal has accreted beside the retained id.
 *
 * ⚠️ Constraint clauses inside the `CREATE TABLE` body are skipped by requiring a column definition to START
 * a line and to be followed by a TYPE word; `CONSTRAINT`, `CHECK`, `PRIMARY`, `UNIQUE` and `FOREIGN` are
 * excluded by name. Comments are stripped first, for the header's reason.
 *
 * @param migrations - The migration files, in apply order.
 * @param table - The table whose columns are wanted.
 * @returns The column names, sorted. Pure.
 */
function currentColumnsOf(migrations: readonly SourceFile[], table: string): readonly string[] {
    const columns = new Set<string>();

    for (const source of migrations) {
        const sql = stripSqlComments(source.contents);
        const create = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?${table}"?\\s*\\(`, 'i').exec(sql);

        if (create !== null) {
            const body = balancedBody(sql, sql.indexOf('(', create.index + create[0].length - 1));

            // ⚠️ The SAME clause parser the user-column fold uses — one authoritative reading of what a
            // `CREATE TABLE` body declares. Two copies had already drifted apart on newline-vs-comma.
            for (const column of declaredColumnsIn(body)) {
                columns.add(column);
            }
        }

        // ⛔ The WHOLE clause list of each statement — see `alterClausesIn`. Reading only the first clause
        // is what let a personal column ride into a RETAINED table beside an innocuous one.
        for (const { clauses } of alterClausesIn(sql, table)) {
            for (const add of clauses.matchAll(/\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) {
                if (add[1] !== undefined) {
                    columns.add(add[1]);
                }
            }

            for (const drop of clauses.matchAll(/\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) {
                if (drop[1] !== undefined) {
                    columns.delete(drop[1]);
                }
            }

            for (const rename of clauses.matchAll(
                /\bRENAME\s+COLUMN\s+"?([a-z_][a-z0-9_]*)"?\s+TO\s+"?([a-z_][a-z0-9_]*)"?/gi,
            )) {
                if (rename[1] !== undefined && rename[2] !== undefined) {
                    columns.delete(rename[1]);
                    columns.add(rename[2]);
                }
            }
        }
    }

    return [...columns].sort();
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
    return userBearingTablesAfter(migrationsOf(database));
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

    // ⛔ SORTED HERE, explicitly. `presentFiles` de-duplicates through a `Set`, and a set union is
    // order-independent — a FOLD is not. The numeric filename prefix IS the apply order, exactly as
    // `recipe-service/src/lambdas/migrate/handler.ts`'s `discoverMigrations` derives it ("sorted by filename
    // so the numeric prefix drives a deterministic order"). Relying on git's listing order instead would make
    // this gate's correctness depend on an undocumented implementation detail of `git ls-files`.
    return [...files].sort().map((file) => readSource(file));
}

describe('account-erasure sweep coverage', () => {
    for (const database of SWEPT_DATABASES) {
        describe(database.sweepFunction, () => {
            it('reaches every user-bearing table, or exempts / retains it for a written reason', () => {
                const owned = ownerBearingTables(database);
                const swept = new Set(sweptTablesIn(readSource(database.sweepFile), database.sweepFunction));

                expect(
                    owned.length,
                    'fewer user-bearing tables than this database is known to have — discovery has broken',
                ).toBeGreaterThanOrEqual(database.minimumOwnerBearingTables);
                expect(
                    swept.size,
                    `${database.sweepFunction} addresses no tables — the parser has broken`,
                ).toBeGreaterThan(0);

                // ⛔ A table here is user data with no route to erasure and no decision about it. Add a
                // statement to the sweep, an exemption SAYING how erasure reaches it, or a retention citing
                // the ADR that ruled it need not be erased — never none of the three.
                expect(
                    owned.filter(
                        (table) =>
                            !swept.has(table) &&
                            !database.exemptFromSweep.has(table) &&
                            !database.retainedByRuling.has(table),
                    ),
                ).toEqual([]);
            });

            it('⛔ WRITES every handle-bearing column, or deletes the row that carries it, per COLUMN', () => {
                const handles = handleBearingColumnsAfter(migrationsOf(database));
                const written = new Set(writtenColumnsIn(readSource(database.sweepFile), database.sweepFunction));

                expect(
                    handles.length,
                    'fewer handle-bearing columns than this database is known to have — discovery has broken',
                ).toBeGreaterThanOrEqual(database.minimumHandleBearingColumns);

                if (database.minimumHandleBearingColumns > 0) {
                    // ⚠️ Conditional on purpose: the food sweep is pure row deletion (no UPDATE anywhere),
                    // so an unconditional floor would be a false claim about it. The floor's job — catching
                    // a wiring break — is carried for that database by the `swept.size > 0` assertion above,
                    // which reads the SAME statementTextsIn over the SAME declaration.
                    expect(
                        written.size,
                        `${database.sweepFunction} assigns to no columns — the parser has broken`,
                    ).toBeGreaterThan(0);
                }

                // ⛔ Each entry here is a COPY of a person's display name that survives their erasure. The
                // table-level assertion above cannot see one: `collections` is swept, and the handle it kept
                // was on a bystander's row. Pseudonymize it in the sweep, or record in
                // `HANDLE_COLUMNS_DELETED_WITH_THEIR_ROW` that erasure destroys the row that holds it.
                expect(
                    handles.filter(
                        (location) =>
                            !written.has(location) && !database.handleColumnsDeletedWithTheirRow.has(location),
                    ),
                ).toEqual([]);
            });

            it('carries no handle-column claim for a column that is gone, or one the sweep already writes', () => {
                const handles = new Set(handleBearingColumnsAfter(migrationsOf(database)));
                const written = new Set(writtenColumnsIn(readSource(database.sweepFile), database.sweepFunction));

                // Both directions, exactly as the table-level maps are checked. A claim outliving its column
                // excuses nothing and would silently cover a future column that reused the name; a claim about
                // a column the sweep now writes reads as "erasure does not clear this", the opposite of true.
                expect([...database.handleColumnsDeletedWithTheirRow.keys()].filter((at) => !handles.has(at))).toEqual(
                    [],
                );
                expect([...database.handleColumnsDeletedWithTheirRow.keys()].filter((at) => written.has(at))).toEqual(
                    [],
                );
            });

            it('⛔ never REMOVES a table the union found — a fold may only ever subtract', () => {
                const migrations = migrationsOf(database);
                const ever = new Set(userBearingTablesEver(migrations));
                const now = userBearingTablesAfter(migrations);

                expect(ever.size, 'the union found nothing — the parser has broken').toBeGreaterThanOrEqual(
                    database.minimumOwnerBearingTables,
                );

                // ⛔ The one direction a fold can fail that a union cannot: inventing a table, or mis-parsing a
                // rename into a table nobody declared, would put something in the CURRENT set that no
                // migration ever created — and it would be checked against a sweep for a table that does not
                // exist, or worse, silently satisfy a retention entry.
                expect(now.filter((table) => !ever.has(table))).toEqual([]);
            });

            it('⛔ pins every RETAINED table’s whole column set, so a new column is a decision', () => {
                const migrations = migrationsOf(database);
                const owned = new Set(ownerBearingTables(database));

                for (const [table, entry] of database.retainedByRuling) {
                    if (!owned.has(table)) {
                        continue;
                    }

                    // ⛔ THE ONLY MECHANICAL CHECK ON WHAT A RETENTION ACTUALLY CLAIMS. The ruling is that the
                    // one user-derived thing left on this table is an opaque id; that claim is false the
                    // moment a handle, an address or a free-text note lands beside it, and nothing else here
                    // would notice.
                    expect(currentColumnsOf(migrations, table), `${table}: a column changed under a retention`).toEqual(
                        [...entry.columns].sort(),
                    );
                }
            });

            it('⛔ pairs every column its de-identifying statements NULL with the owner they key on', () => {
                const statements = deIdentifyingStatementsIn(readSource(database.sweepFile), database.sweepFunction);
                const migrations = migrationsOf(database);

                // ⚠️ THERE IS NO `MINIMUM_DE_IDENTIFYING_STATEMENTS` ANY MORE. After ADR-0027 the sweep
                // issues ZERO de-identifying statements (the pseudonym write is not one; the clone-detach is
                // not keyed on a person), so any positive floor would be false.
                //
                // ⛔ The substantive reason it is DELETED rather than set to `0` — the vacuity it guarded is
                // still closed, somewhere else. That constant existed so a WIRING failure (a renamed
                // `sweepFunction`, a moved file, a changed AST shape) could not make this assertion pass by
                // finding nothing. That failure is now caught by the sibling assertion in this same describe
                // block: `expect(swept.size, '… the parser has broken').toBeGreaterThan(0)` reads the SAME
                // `statementTextsIn` over the SAME declaration in the SAME file, so any wiring break that
                // would empty this list empties that one too, and goes red there. A floor of `0` would add
                // nothing on top of that — a constant named MINIMUM that enforces nothing reads as reviewed
                // and is not.
                //
                // What guards the PARSER itself (as opposed to the wiring) is the three fake-driven cases
                // below, which drive `deIdentifyingStatementsIn` at fixed inputs and assert its EXACT output
                // structure rather than a count — strictly stronger than a floor on that axis. The assertion
                // here is now a STANDING RULE that fires the day a de-identifying statement returns, and the
                // fakes prove it can fire.
                //
                // ⚠️ Stated honestly: on the one axis where nothing replaces it — a parser that silently
                // stops matching while the wiring still resolves — this file is weaker than it was.
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

            it('carries no exemption or retention for a table that no longer bears a user column', () => {
                const owned = new Set(ownerBearingTables(database));

                // A claim outliving its table is a claim about nothing, and it would silently excuse a FUTURE
                // table that happened to reuse the name. ⚠️ This is also the assertion that would have caught
                // a lazier version of ADR-0027 — leaving `ingredient_resolution_memos` in a map after 0033
                // dropped its person column.
                expect([...database.exemptFromSweep.keys()].filter((table) => !owned.has(table))).toEqual([]);
                expect([...database.retainedByRuling.keys()].filter((table) => !owned.has(table))).toEqual([]);
            });

            it('carries no exemption or retention for a table the sweep already reaches', () => {
                const swept = new Set(sweptTablesIn(readSource(database.sweepFile), database.sweepFunction));

                // A closed gap left standing as an exemption reads as "erasure does not touch this", which is
                // the opposite of the truth and the sort of note a later reader reasons correctly from. For a
                // RETENTION it is worse: a sweep against a retained table means somebody added an erasable
                // column there, and that has to be re-adjudicated rather than silently coexist with a ruling
                // that says the table holds nothing erasable.
                expect([...database.exemptFromSweep.keys()].filter((table) => swept.has(table))).toEqual([]);
                expect([...database.retainedByRuling.keys()].filter((table) => swept.has(table))).toEqual([]);
            });
        });
    }

    it('⛔ FAILS a handle-bearing column on a table the sweep never writes, and NAMES the column', () => {
        // ⛔ THE EXACT SHAPE THAT SHIPPED. The table IS swept — `DELETE FROM notes WHERE owner_id = $1`, the
        // same statement `collections` gets — and the handle is on a row the predicate cannot reach, because
        // it names the row's SOURCE rather than its owner. Every table-level assertion in this file reports
        // this as covered.
        const migration = {
            file: 'fake/0099_provenance.sql',
            contents: `
                -- The handle here is frozen from the SOURCE owner, so it sits on the cloner's row.
                ALTER TABLE "notes"
                    ADD COLUMN "last_pulled_at" timestamptz,
                    ADD COLUMN "source_owner_handle" text,
                    ADD COLUMN "source_collection_name" text;
            `,
        };
        const sweep = {
            file: 'fake/sweep.ts',
            contents: `
                export const eraseRows = async (tx) => {
                    await tx.execute(sql\`DELETE FROM notes WHERE owner_id = \${ownerId}\`);
                    await tx.execute(sql\`UPDATE recipes SET author_handle = \${pseudonym} WHERE owner_id = \${ownerId}\`);
                };
            `,
        };

        const handles = handleBearingColumnsAfter([migration]);
        const written = new Set(writtenColumnsIn(sweep, 'eraseRows'));

        // Discovered by SHAPE — nobody wrote `source_owner_handle` into a vocabulary — and reported as a
        // COLUMN, so the failure says which datum survived rather than which table to go and read.
        expect(handles).toEqual(['notes.source_owner_handle']);
        // ⚠️ `source_collection_name` is NOT here. A collection's name is authored content, of the same kind
        // as a kept public recipe's title, and a `*_name` pattern would have swept it in without a decision.
        expect(handles).not.toContain('notes.source_collection_name');
        expect(handles.filter((at) => !written.has(at) && !HANDLE_COLUMNS_DELETED_WITH_THEIR_ROW.has(at))).toEqual([
            'notes.source_owner_handle',
        ]);
        // …and the sweep's own pseudonym write IS recognised as covering the column it assigns to, so the
        // verdict tracks the statement rather than something incidental about the fake.
        expect(written.has('recipes.author_handle')).toBe(true);
    });

    it('⛔ counts a column WRITTEN by the sweep, never one it merely filters on', () => {
        const sweep = {
            file: 'fake/sweep.ts',
            contents: `
                export const eraseRows = async (tx) => {
                    await tx.execute(sql\`
                        UPDATE collections SET source_owner_handle = \${pseudonym}, updated_at = now()
                        WHERE source_owner_handle IS NOT NULL
                          AND source_collection_id IN (SELECT id FROM collections WHERE owner_id = \${ownerId})
                    \`);
                    await tx.execute(sql\`
                        UPDATE notes SET body = 'x' WHERE editor_handle = \${handle}
                    \`);
                };
            `,
        };

        // `notes.editor_handle` appears only in a WHERE — the sweep READS it to find a row and never clears
        // it, which is a false NEGATIVE in the one direction that matters. `updated_at = now()` is an
        // assignment; `now()` is not.
        expect(writtenColumnsIn(sweep, 'eraseRows')).toEqual([
            'collections.source_owner_handle',
            'collections.updated_at',
            'notes.body',
        ]);
    });

    it('⛔ reads every clause of the REAL 0016 ALTER, not just its first', () => {
        // ⛔ The fake above proves the parser handles the FORM; this proves it against the FILE the defect
        // actually came through. 0016 adds three columns under one `ALTER TABLE collections`, and while the
        // parser was anchored to `ALTER TABLE <t> ADD COLUMN <x>` the second and third were invisible.
        const columns = new Set(currentColumnsOf(migrationsOf(SWEPT_DATABASES[0]!), 'collections'));

        expect([...columns].filter((column) => column.startsWith('source_') || column === 'last_pulled_at').sort()) //
            .toEqual(['last_pulled_at', 'source_collection_id', 'source_collection_name', 'source_owner_handle']);
    });

    it('states a real reason for every exemption', () => {
        // An exemption is one of three places this gate accepts a human's word. A blank or throwaway entry
        // would turn "no route to erasure" into "somebody typed something", which is worse than no gate at all
        // because it reads as reviewed.
        for (const [table, why] of EXEMPT_FROM_SWEEP) {
            expect(why.trim().length, `the exemption for ${table} must say how erasure reaches it`).toBeGreaterThan(20);
        }
    });

    it('states a real reason for every handle column claimed to go with its row', () => {
        // ⛔ Non-vacuity FIRST, unlike the exemption case above. That map is legitimately empty today (nothing
        // is exempt), and its assertion is a standing rule. This one makes a live claim about a real column
        // that a real `DELETE` covers, so an emptied map here means the claim was dropped rather than settled.
        expect(HANDLE_COLUMNS_DELETED_WITH_THEIR_ROW.size, 'the handle-column claims have been emptied') //
            .toBeGreaterThan(0);

        for (const [location, why] of HANDLE_COLUMNS_DELETED_WITH_THEIR_ROW) {
            expect(location, `${location} must name a table and a column`).toMatch(
                /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/,
            );
            expect(
                why.trim().length,
                `the claim for ${location} must say which statement destroys the row that carries it`,
            ).toBeGreaterThan(20);
        }
    });

    it('⛔ requires every RETENTION to cite an ADR that actually exists on disk', () => {
        // ⛔ A STRICTER BAR THAN AN EXEMPTION'S, deliberately. An exemption says erasure still happens by
        // another route — a claim the sweep itself can be read against. A retention says erasure need not
        // happen at all, converting "RED unless swept" into "green forever", and the only thing standing
        // behind that is a decision somebody made. So the entry must name where that decision is written, and
        // the file must be there — a citation to a document nobody wrote is the same as no reason at all.
        expect(RETAINED_BY_RULING.size, 'no retentions to check — the map has been emptied').toBeGreaterThan(0);

        for (const [table, entry] of RETAINED_BY_RULING) {
            const cited = /docs\/architecture\/decisions\/\d{4}-[a-z0-9-]+\.md/.exec(entry.why);

            expect(cited, `the retention for ${table} must cite an ADR path`).not.toBeNull();
            expect(
                cited !== null && existsSync(path.join(repoRoot, cited[0])),
                `the retention for ${table} cites ${cited?.[0] ?? '(nothing)'}, which does not exist`,
            ).toBe(true);
            expect(entry.columns.length, `the retention for ${table} must pin its columns`).toBeGreaterThan(0);
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

        const owned = userBearingTablesAfter([migration]);
        const swept = new Set(sweptTablesIn(sweep, 'eraseRows'));

        expect(owned).toEqual(['widgets']);
        // Named in the docstring, named in a SQL comment, and swept by neither — which is precisely how
        // `ingredient_resolution_mappings` and `ingredient_resolution_memos` both shipped. ⚠️ And it is not
        // rescued by either escape hatch: neither map names `widgets`, so this is the RED the gate exists for.
        expect(
            owned.filter(
                (table: string) => !swept.has(table) && !EXEMPT_FROM_SWEEP.has(table) && !RETAINED_BY_RULING.has(table),
            ),
        ).toEqual(['widgets']);
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
            userBearingTablesAfter([
                {
                    file: 'fake/0100_prose.sql',
                    contents: `
                    -- This table deliberately carries NO owner_id; the prescribed sweep would have been
                    --   UPDATE "notes" SET author_id = NULL WHERE author_id = $1;
                    CREATE TABLE "notes" ("id" uuid PRIMARY KEY, "body" text NOT NULL);
                `,
                },
            ]),
        ).toEqual([]);
    });

    it('reads a column added by a later ALTER, not only one declared at CREATE', () => {
        expect(
            userBearingTablesAfter([
                {
                    file: 'fake/0101_alter.sql',
                    contents: `ALTER TABLE "memos" ADD COLUMN IF NOT EXISTS "owner_id" text;`,
                },
            ]),
        ).toEqual(['memos']);
    });

    it('⛔ HONOURS a later DROP COLUMN, so a gate cannot demand a sweep for a column that is gone', () => {
        // ⛔ The fold's whole reason for existing (ADR-0027 / migration 0033). Under the old union this
        // returned `['memos']`, and the only way to go green was to hand-write an exemption asserting a fact
        // the schema already stated.
        const create = {
            file: 'fake/0026_add.sql',
            contents: `ALTER TABLE "memos" ADD COLUMN "owner_id" text;`,
        };
        const drop = {
            file: 'fake/0033_drop.sql',
            contents: `ALTER TABLE "memos" DROP COLUMN IF EXISTS "owner_id";`,
        };

        expect(userBearingTablesAfter([create])).toEqual(['memos']);
        expect(userBearingTablesAfter([create, drop])).toEqual([]);
        // …and the union still remembers it, which is what the subset assertion is checked against.
        expect(userBearingTablesEver([create, drop])).toEqual(['memos']);
    });

    it('⛔ HONOURS a RENAME between two user spellings, and one AWAY from a user column', () => {
        const created = {
            file: 'fake/0021_create.sql',
            contents: `CREATE TABLE "mappings" ("id" uuid PRIMARY KEY, "author_id" varchar(255));`,
        };

        expect(
            userBearingTablesAfter([
                created,
                {
                    file: 'fake/0033_rename.sql',
                    contents: `ALTER TABLE "mappings" RENAME COLUMN "author_id" TO "user_id";`,
                },
            ]),
        ).toEqual(['mappings']);

        // Renamed to something that is NOT a user column: the table stops being user-bearing.
        expect(
            userBearingTablesAfter([
                created,
                {
                    file: 'fake/0034_rename.sql',
                    contents: `ALTER TABLE "mappings" RENAME COLUMN "author_id" TO "curator_note";`,
                },
            ]),
        ).toEqual([]);
    });

    it('⛔ IGNORES a DROP COLUMN that only appears in a comment — this repo’s headers quote their own SQL', () => {
        // ⚠️ THE FOLD'S MOST DANGEROUS FAILURE MODE, and the mirror of the CHECK-in-prose case above.
        // `0031`'s header prints its backfills and `0033`'s prints what it drops; a parser reading prose would
        // remove a live column from the derived schema and turn a genuinely unswept table GREEN.
        const create = {
            file: 'fake/0026_add.sql',
            contents: `ALTER TABLE "memos" ADD COLUMN "owner_id" text;`,
        };
        const prose = {
            file: 'fake/0099_prose.sql',
            contents: `
                -- The repair considered and REJECTED was
                --   ALTER TABLE "memos" DROP COLUMN "owner_id";
                -- …which would have removed the question rather than answering it.
                /* ALTER TABLE "memos" RENAME COLUMN "owner_id" TO "curator_note"; */
                ALTER TABLE "memos" ADD COLUMN IF NOT EXISTS "verified_by" text;
            `,
        };

        expect(userBearingTablesAfter([create, prose])).toEqual(['memos']);
    });

    it('⛔ reads EVERY clause of a multi-clause ALTER — the form 0016 already writes', () => {
        // ⛔ THE HOLE A REVIEW FOUND, demonstrated against a form already in this tree:
        // `0016_collection_source_provenance.sql` adds three columns under ONE `ALTER TABLE collections`.
        // Every parser here used to anchor on `ALTER TABLE <t> ADD COLUMN <x>`, so it saw the FIRST clause
        // and no other. MEASURED before the fix: a probe adding `user_id` in clause position 2 to an unswept
        // table left the whole gate GREEN — a user-bearing table invisible to the check that exists to find
        // exactly that.
        const multi = {
            file: 'fake/0016_multi.sql',
            contents: `
                ALTER TABLE "notes"
                    ADD COLUMN "last_pulled_at" timestamptz,
                    ADD COLUMN "body" text,
                    ADD COLUMN "user_id" varchar(255);
            `,
        };

        expect(userBearingTablesAfter([multi])).toEqual(['notes']);
        expect(currentColumnsOf([multi], 'notes')).toEqual(['body', 'last_pulled_at', 'user_id']);
    });

    it('⛔ subtracts a COLUMN, not a table — a second user column keeps the table in scope', () => {
        // A table with two user columns that loses one must STAY user-bearing. Subtracting the table on any
        // drop is the fold's one genuinely dangerous direction, and neither stated bound catches it: the
        // `fold ⊆ union` check permits any removal, and the floor is a COUNT, so one spurious drop paired
        // with one genuine addition would pass silently.
        const created = {
            file: 'fake/0001_create.sql',
            contents: `CREATE TABLE "notes" ("id" uuid PRIMARY KEY, "owner_id" text, "created_by" text);`,
        };
        const dropped = { file: 'fake/0002_drop.sql', contents: `ALTER TABLE "notes" DROP COLUMN "owner_id";` };
        const both = { file: 'fake/0003_drop.sql', contents: `ALTER TABLE "notes" DROP COLUMN "created_by";` };

        expect(userBearingTablesAfter([created])).toEqual(['notes']);
        expect(userBearingTablesAfter([created, dropped])).toEqual(['notes']);
        expect(userBearingTablesAfter([created, dropped, both])).toEqual([]);
    });

    it('⛔ FORGETS a CHECK that a later migration DROPPED — a repealed constraint is not a pairing', () => {
        // ⛔ The union's failure in the MORE dangerous direction, and the reason `checkExpressionsFor` became
        // a fold like its two siblings. A dropped CHECK reported as present lets `pairChecked` return true on
        // the strength of DDL that no longer runs — so the pairing assertion, this file's stated defence
        // against the corroboration-binding class of defect, would pass vacuously. 0033 drops three CHECKs,
        // which is what turned this from latent into live.
        const added = {
            file: 'fake/0031_add.sql',
            contents: `ALTER TABLE "notes" ADD CONSTRAINT "notes_pair" CHECK (("user_id" IS NULL) = ("body" IS NULL));`,
        };
        const dropped = {
            file: 'fake/0033_drop.sql',
            contents: `ALTER TABLE "notes" DROP CONSTRAINT IF EXISTS "notes_pair";`,
        };

        expect(pairChecked([added], 'notes', 'user_id', 'body')).toBe(true);
        expect(pairChecked([added, dropped], 'notes', 'user_id', 'body')).toBe(false);
    });

    it('⛔ reads a RETAINED table’s columns from the SQL, honouring every later ALTER', () => {
        // The pin that discharges a retention's actual claim. It must track ADD, DROP and RENAME, or an
        // entry would silently excuse a column nobody listed.
        const migrations = [
            {
                file: 'fake/0021_create.sql',
                contents: `
                    CREATE TABLE "mappings" (
                        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                        "author_id" varchar(255),
                        "source_phrase" text,
                        CONSTRAINT "mappings_pair" CHECK ("author_id" IS NOT NULL)
                    );
                `,
            },
            {
                file: 'fake/0033_rename.sql',
                contents: `ALTER TABLE "mappings" RENAME COLUMN "author_id" TO "user_id";`,
            },
            { file: 'fake/0034_add.sql', contents: `ALTER TABLE "mappings" ADD COLUMN "surfacing" text;` },
            { file: 'fake/0035_drop.sql', contents: `ALTER TABLE "mappings" DROP COLUMN "source_phrase";` },
        ];

        // ⚠️ `CONSTRAINT …` is not a column, and a fold that counted it would make every retention entry in
        // this file wrong in a way that reads as a typo.
        expect(currentColumnsOf(migrations, 'mappings')).toEqual(['id', 'surfacing', 'user_id']);
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
