/**
 * Migration `0055_author_usernames` — the byline's username copies — asserted against a real PostgreSQL.
 *
 * ⛔ WHY THIS TIER. A unit test cannot observe a migration that did not apply, and the decision's claims are
 * properties of the database (plan 2026-10-15-010 D7): each copy is plain `text` (the recipe database has no
 * `citext`, and a display copy is never a lookup key), nullable with NO default (a row whose author has no username
 * carries none, and nothing may invent one), and reachable by the service role through ADR-0039's default privileges.
 * Also pinned: `collections` carries NO username copy — a username is never frozen onto a clone (D7).
 *
 * Runs as `recipe_app`, the role the service holds; catalog reads use `pg_catalog`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();

/** The three copies 0055 adds, as `[table, column]`. */
const USERNAME_COLUMNS = [
    ['author_handles', 'username'],
    ['recipes', 'author_username'],
    ['recipe_versions', 'editor_username'],
] as const;

describe('migration 0055 — author usernames', () => {
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 2 });
    });

    afterAll(async () => {
        await pool.end();
    });

    it.each(USERNAME_COLUMNS)('%s.%s is plain text, nullable, with NO default', async (table, column) => {
        const { rows } = await pool.query<{ type: string; not_null: boolean; has_default: boolean }>(
            `SELECT format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null, a.atthasdef AS has_default
               FROM pg_attribute a
              WHERE a.attrelid = $1::regclass AND a.attname = $2 AND NOT a.attisdropped`,
            [`public.${table}`, column],
        );

        expect(rows).toEqual([{ type: 'text', not_null: false, has_default: false }]);
    });

    it.each(USERNAME_COLUMNS)('the service role can SELECT, INSERT and UPDATE %s.%s', async (table, column) => {
        const { rows } = await pool.query<Record<string, boolean>>(
            `SELECT has_column_privilege(current_user, $1, $2, 'SELECT') AS "select",
                    has_column_privilege(current_user, $1, $2, 'INSERT') AS "insert",
                    has_column_privilege(current_user, $1, $2, 'UPDATE') AS "update"`,
            [`public.${table}`, column],
        );

        expect(rows).toEqual([{ select: true, insert: true, update: true }]);
    });

    it('⛔ freezes NO username onto collections — a clone resolves its source owner’s username when read', async () => {
        const { rows } = await pool.query<{ column: string }>(
            `SELECT a.attname AS column
               FROM pg_attribute a
              WHERE a.attrelid = 'public.collections'::regclass AND a.attname LIKE '%username%' AND NOT a.attisdropped`,
        );

        expect(rows).toEqual([]);
    });
});
