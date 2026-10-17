/**
 * Guard: the block reasons the transport writes are exactly the reasons `source_backoff` accepts (migration 0019,
 * ADR-0053 §5). A reason the CHECK refuses would make the ledger throw on the first block of that kind, and the
 * transport would withhold the response that earned it; a reason the CHECK admits and the code never writes is a
 * set kept twice that has already drifted.
 *
 * The constraint is read from the migrations in order, so a later migration that redefines it is the one compared.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { sourceBackoff } from '../../../db/schema/operational.js';
import { BLOCK_REASONS } from '../blockRule.js';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');

/** The constraint 0019 names. */
const CONSTRAINT = 'source_backoff_reason_known';

/**
 * The quoted values a named `CHECK (… IN (…))` constraint admits, from the last statement that defines it. Pure.
 *
 * @param sqlTexts - Migration texts, in apply order.
 * @param constraint - The constraint name.
 * @returns The values, in written order.
 * @throws {Error} when no text defines the constraint with an `IN` list.
 */
function checkedValues(sqlTexts: readonly string[], constraint: string): readonly string[] {
    const definition = new RegExp(
        `CONSTRAINT\\s+"?${constraint}"?\\s+CHECK\\s*\\(\\s*"?\\w+"?\\s+IN\\s*\\(([^)]*)\\)`,
        'giu',
    );
    let last: string | undefined;

    for (const text of sqlTexts) {
        for (const match of text.matchAll(definition)) {
            last = match[1];
        }
    }

    if (last === undefined) {
        throw new Error(`no migration defines ${constraint} with an IN list`);
    }

    return [...last.matchAll(/'([^']*)'/gu)].map((value) => value[1] ?? '');
}

describe('checkedValues (the reader this guard relies on)', () => {
    it.each([
        ['quoted names', `CONSTRAINT "c" CHECK ("reason" IN ('a', 'b'))`, ['a', 'b']],
        ['bare names and no spaces', `CONSTRAINT c CHECK (reason IN('a','b','c'))`, ['a', 'b', 'c']],
        ['a line break inside the list', `CONSTRAINT "c"\n  CHECK ("reason" IN ('a',\n 'b'))`, ['a', 'b']],
    ])('reads %s', (_, sql, expected) => {
        expect(checkedValues([sql], 'c')).toEqual(expected);
    });

    it('takes the last definition when a later migration redefines the constraint', () => {
        const first = `CONSTRAINT "c" CHECK ("reason" IN ('a'))`;
        const later = `ALTER TABLE t ADD CONSTRAINT "c" CHECK ("reason" IN ('a', 'z'))`;

        expect(checkedValues([first, later], 'c')).toEqual(['a', 'z']);
    });

    it('refuses when no migration defines the constraint, rather than comparing against nothing', () => {
        expect(() => checkedValues([`CONSTRAINT "other" CHECK ("reason" IN ('a'))`], 'c')).toThrow(/no migration/u);
    });
});

describe('BLOCK_REASONS and source_backoff', () => {
    it('admits exactly the reasons the transport writes', () => {
        const texts = readdirSync(MIGRATIONS)
            .filter((name) => name.endsWith('.sql'))
            .sort()
            .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'));

        expect([...checkedValues(texts, CONSTRAINT)].sort()).toEqual([...BLOCK_REASONS].sort());
    });

    it('is described the same way by the Drizzle model, which restates the CHECK', () => {
        const check = getTableConfig(sourceBackoff).checks.find((candidate) => candidate.name === CONSTRAINT);
        const rendered = check === undefined ? '' : new PgDialect().sqlToQuery(check.value).sql;

        expect([...rendered.matchAll(/'([^']*)'/gu)].map((value) => value[1]).sort()).toEqual(
            [...BLOCK_REASONS].sort(),
        );
    });
});
