/**
 * ADR-0106: the read rule's fourth term, `recipe_is_from_person(r.id)`, must survive every later replacement of
 * `recipe_held_from_readers`. A migration that rewrites the function body from an older copy would drop the term, and a
 * recipe the cook was told is hidden (a correction to a from-person answer, cleared) would be readable again. The newest
 * definition in the ordered migrations is the one the database runs, so it is the one this guard reads.
 *
 * Limit, stated: the guard sees the term in the body's CODE (comments and string literals blanked). A neutralised term such as
 * `false AND recipe_is_from_person(r.id)` passes here, and the LOCAL e2e truth table (`recipeHeldFromReaders.e2e.test.ts`) is
 * what catches it.
 *
 * ✅ THE FIX FOR A FAILURE: keep `OR recipe_is_from_person(r.id)` in the new body, with the three terms it joins.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { newestHeldFromReadersBody, type NamedSql } from './heldFromReadersBody.js';
import { repoRoot } from './serviceSources.js';

const TERM_BODY = '$$ BEGIN RETURN a OR recipe_is_from_person(r.id); END $$';
const NO_TERM_BODY = '$$ BEGIN RETURN a OR b; END $$';
const create = (body: string, name = 'recipe_held_from_readers') =>
    `CREATE OR REPLACE FUNCTION ${name}(r recipes) RETURNS boolean AS ${body} LANGUAGE plpgsql;`;

const keeps = (files: readonly NamedSql[]): boolean => newestHeldFromReadersBody(files)?.keepsFromPerson === true;

describe('the detector: one fixture per way the term can be lost', () => {
    it.each<[string, readonly NamedSql[], boolean]>([
        ['the newest definition lacks the term', [{ name: '0098.sql', text: create(NO_TERM_BODY) }], false],
        ['the newest definition has the term', [{ name: '0100.sql', text: create(TERM_BODY) }], true],
        [
            'an older file has it and the newest lacks it (the newest wins, not any file)',
            [
                { name: '0100.sql', text: create(TERM_BODY) },
                { name: '0101.sql', text: create(NO_TERM_BODY) },
            ],
            false,
        ],
        [
            'files are ordered by name, not by the order given',
            [
                { name: '0101.sql', text: create(TERM_BODY) },
                { name: '0100.sql', text: create(NO_TERM_BODY) },
            ],
            true,
        ],
        [
            'an ALTER ... PARALLEL SAFE line is present but the body lacks the term',
            [
                {
                    name: '0100.sql',
                    text: `${create(NO_TERM_BODY)}\nALTER FUNCTION recipe_held_from_readers(recipes) PARALLEL SAFE; -- recipe_is_from_person(r.id)`,
                },
            ],
            false,
        ],
        [
            'the term is only in a -- comment in the body',
            [{ name: '0100.sql', text: create('$$ BEGIN RETURN a; -- recipe_is_from_person(r.id)\nEND $$') }],
            false,
        ],
        [
            'the term is only in a block comment in the body',
            [{ name: '0100.sql', text: create('$$ BEGIN RETURN a; /* recipe_is_from_person(r.id) */ END $$') }],
            false,
        ],
        [
            'the term is only in a sibling statement',
            [{ name: '0100.sql', text: `${create(NO_TERM_BODY)}\nSELECT recipe_is_from_person(x);` }],
            false,
        ],
        [
            'the function is schema-qualified and lacks the term',
            [{ name: '0100.sql', text: create(NO_TERM_BODY, 'public.recipe_held_from_readers') }],
            false,
        ],
        [
            'the function is schema-qualified and has the term',
            [{ name: '0100.sql', text: create(TERM_BODY, 'public.recipe_held_from_readers') }],
            true,
        ],
        [
            'the name is quoted and lacks the term',
            [{ name: '0100.sql', text: create(NO_TERM_BODY, '"recipe_held_from_readers"') }],
            false,
        ],
        [
            'a named dollar tag with the term passes',
            [{ name: '0100.sql', text: create('$body$ BEGIN RETURN a OR recipe_is_from_person(r.id); END $body$') }],
            true,
        ],
        [
            'the term is only in a string literal',
            [{ name: '0100.sql', text: create("$$ BEGIN RETURN 'recipe_is_from_person(r.id)'; END $$") }],
            false,
        ],
        [
            'a DROP after the newest CREATE leaves no definition',
            [
                { name: '0100.sql', text: create(TERM_BODY) },
                { name: '0101.sql', text: 'DROP FUNCTION IF EXISTS recipe_held_from_readers(recipes);' },
            ],
            false,
        ],
        [
            'a RENAME after the newest CREATE leaves no definition',
            [
                { name: '0100.sql', text: create(TERM_BODY) },
                { name: '0101.sql', text: 'ALTER FUNCTION recipe_held_from_readers(recipes) RENAME TO other_name;' },
            ],
            false,
        ],
    ])('%s', (_label, files, expected) => {
        expect(keeps(files)).toBe(expected);
    });

    it('answers undefined when no migration defines the function', () => {
        expect(newestHeldFromReadersBody([{ name: '0001.sql', text: 'SELECT 1;' }])).toBeUndefined();
    });
});

describe('the real migrations', () => {
    it('the newest definition of recipe_held_from_readers keeps the from-person term', () => {
        const dir = path.join(repoRoot, 'packages/services/recipe-service/src/database/migrations');
        const files = readdirSync(dir)
            .filter((file) => file.endsWith('.sql'))
            .map((file) => ({ name: file, text: readFileSync(path.join(dir, file), 'utf8') }));

        expect(newestHeldFromReadersBody(files)).toMatchObject({ keepsFromPerson: true });
    });
});
