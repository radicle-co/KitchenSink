// @vitest-environment node
/**
 * `EXPECTED_TABLES` in `roleDb.ts` is DERIVED-CHECKED, not taken on somebody's word.
 *
 * ## ⛔ Why this exists — the omission direction is the silent one
 *
 * That array is the post-migration validation's expectation list: `applyMigrations` refuses an EMPTY list
 * and a MISSING table, and says nothing at all about a table the workers touch that nobody added. So the
 * roster's own claim — "every entry carries real SQL in this package" — was unenforced in exactly the
 * direction that under-validates, and it was FALSE when measured: `recipe_verification_attempts` is
 * `INSERT`ed, `UPDATE`d and `DELETE`d by `src/verification/verdictStore.ts` and was not in the list.
 *
 * This is the house rule one level up from `natEgressConsumers.test.ts`'s: *a copy of a list cannot detect
 * that the list is incomplete*. So the set is DISCOVERED from the SQL this package actually issues and
 * compared for EQUALITY — both directions, because each one catches a different defect:
 *
 *   * a discovered table missing from the roster is a dependency the tier never validates;
 *   * a roster entry nothing references is the "FALSE prose rather than a failing test" the roster's own
 *     docstring warns about.
 *
 * ## ⚠️ What this can and cannot see
 *
 * It reads table names out of `FROM` / `INTO` / `UPDATE` / `JOIN` in template literals and plain strings
 * across this package's `src/` and this directory's suites. A table reached only through an identifier
 * built at run time is invisible to it, exactly as it is to a reader — that is a bounded limit, not a hole,
 * and no such construction exists in this package today. A NON-VACUITY floor guards the discovery itself:
 * if the reader stops matching, this file must go RED rather than pass by finding nothing.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EXPECTED_TABLES } from './roleDb.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The two trees whose SQL defines what this package depends on. */
const ROOTS = [path.join(here, '..', '..', 'src'), here] as const;

/**
 * Tables named by a SQL clause that REACHES one — `FROM x`, `INTO x`, `UPDATE x`, `JOIN x`.
 *
 * ⚠️ Comments are stripped first, for the reason every reader in this repo strips them: this package's
 * docstrings quote their own SQL (`verdictStore.ts`'s `@sideEffect` tags name three tables in prose), and
 * an unstripped read would count a DESCRIPTION of a write as a write.
 *
 * @param source - One file's text.
 * @returns The table names it reaches. Pure.
 */
function tablesReachedIn(source: string): readonly string[] {
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

    return [
        ...new Set(
            [...stripped.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+"?([a-z_][a-z0-9_]*)"?/gi)].flatMap((match) =>
                match[1] === undefined ? [] : [match[1].toLowerCase()],
            ),
        ),
    ];
}

/** Every `.ts` file under `dir`, recursively. */
function sourcesUnder(dir: string): readonly string[] {
    return readdirSync(dir).flatMap((entry) => {
        const full = path.join(dir, entry);

        if (statSync(full).isDirectory()) {
            return entry === 'node_modules' || entry === 'dist' ? [] : sourcesUnder(full);
        }

        return full.endsWith('.ts') ? [full] : [];
    });
}

/** Every table this package's own SQL reaches, intersected with the recipe schema the roster describes. */
function discoveredTables(): readonly string[] {
    const reached = new Set<string>();

    for (const root of ROOTS) {
        for (const file of sourcesUnder(root)) {
            for (const table of tablesReachedIn(readFileSync(file, 'utf8'))) {
                reached.add(table);
            }
        }
    }

    // ⚠️ Intersected with the roster's own vocabulary is NOT circular, and the alternative is worse: the
    // regex also matches `information_schema.columns`, `pg_constraint`, CTE names and local aliases, none
    // of which are recipe tables. What the intersection cannot do is hide a MISSING entry — a table absent
    // from the roster is absent from the intersection too, so the one direction this file exists for is
    // untouched. It is the SUPERFLUOUS direction that is weakened, and that direction is also covered by
    // the migration-side check below.
    return [...reached].filter((table) => (EXPECTED_TABLES as readonly string[]).includes(table)).sort();
}

/** Every table the recipe migrations CREATE, folded over `DROP TABLE`. */
function tablesInSchema(): readonly string[] {
    const dir = path.join(here, '..', '..', '..', 'recipe-service', 'src', 'database', 'migrations');
    const live = new Set<string>();

    for (const file of readdirSync(dir).sort()) {
        const sql = readFileSync(path.join(dir, file), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/--[^\n]*/g, ' ');

        // ⛔ DROPS BEFORE CREATES, WITHIN A FILE — the same ordering `trackedColumnsAfter` uses and for the
        // same reason: `0051_ingredient_grain.sql` DROPs `ingredients` and CREATEs a different table under
        // that name in one file, so the reverse order deletes the entry the CREATE just made and reports a
        // live table as gone. MEASURED — this fold had that bug and said `ingredients` no longer exists.
        for (const match of sql.matchAll(/\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^;]+)/gi)) {
            for (const name of (match[1] ?? '').replace(/\b(?:CASCADE|RESTRICT)\b/gi, '').split(',')) {
                const table = /^\s*"?([a-z_][a-z0-9_]*)"?\s*$/i.exec(name);

                if (table?.[1] !== undefined) {
                    live.delete(table[1]);
                }
            }
        }

        for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) {
            if (match[1] !== undefined) {
                live.add(match[1]);
            }
        }
    }

    return [...live].sort();
}

describe('EXPECTED_TABLES is derived-checked, not asserted', () => {
    it('⛔ finds tables at all — a vacuous pass here would hide every assertion below', () => {
        expect(discoveredTables().length).toBeGreaterThan(5);
        expect(tablesInSchema().length).toBeGreaterThan(15);
    });

    it('⛔ every table this package issues SQL against is in the roster', () => {
        // The direction the engine is blind to: a missing entry is a dependency the tier never validates,
        // and nothing else in the repo reports it.
        const reached = new Set<string>();

        for (const root of ROOTS) {
            for (const file of sourcesUnder(root)) {
                for (const table of tablesReachedIn(readFileSync(file, 'utf8'))) {
                    reached.add(table);
                }
            }
        }

        const schema = new Set(tablesInSchema());
        const missing = [...reached].filter(
            (table) => schema.has(table) && !(EXPECTED_TABLES as readonly string[]).includes(table),
        );

        expect(missing, 'these recipe tables are used here but absent from EXPECTED_TABLES').toEqual([]);
    });

    it('⛔ every roster entry still EXISTS in the recipe schema', () => {
        // `recipe_ingredients` sat in this roster after migration 0051 dropped it, and took the whole
        // integration tier down at post-migration validation rather than reporting itself here.
        const schema = new Set(tablesInSchema());

        expect((EXPECTED_TABLES as readonly string[]).filter((table) => !schema.has(table))).toEqual([]);
    });

    it('⛔ every roster entry is actually reached by this package`s SQL', () => {
        // The roster's own claim, finally enforced: an entry nothing references is the "FALSE prose rather
        // than a failing test" its docstring warns about.
        const discovered = new Set(discoveredTables());

        expect((EXPECTED_TABLES as readonly string[]).filter((table) => !discovered.has(table))).toEqual([]);
    });
});
