/**
 * Migration FILENAMES are an ordering contract: the runner applies `.sql` files in lexical order and keys its
 * ledger by filename, so two files sharing a number both apply, in an order decided by whatever follows the
 * number. That order is an accident, and the manifest digest still agrees with it. The runner therefore refuses
 * such a directory outright, before it connects.
 *
 * The predicate is pinned with a fixture table over shapes the tree has never held, because a rule guard that is
 * only exercised on the tree's own shapes cannot tell a right predicate from a weaker one.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
    MigrationNamingError,
    discoverMigrations,
    isMigrationNamingError,
    migrationNamingProblems,
    readMigrationManifest,
} from '../index.js';

const scratch: string[] = [];

afterAll(() => {
    for (const directory of scratch) {
        rmSync(directory, { recursive: true, force: true });
    }
});

/** A scratch migrations directory holding trivial files with the given names. */
function dirWith(names: readonly string[]): string {
    const directory = mkdtempSync(join(tmpdir(), 'migrationNaming-'));

    scratch.push(directory);
    mkdirSync(directory, { recursive: true });

    for (const name of names) {
        writeFileSync(join(directory, name), 'SELECT 1;\n');
    }

    return directory;
}

describe('migrationNamingProblems', () => {
    const table: readonly { readonly why: string; readonly files: readonly string[]; readonly problems: number }[] = [
        { why: 'clean contiguous', files: ['0001_a.sql', '0002_b.sql'], problems: 0 },
        { why: 'a gap is allowed', files: ['0001_a.sql', '0005_b.sql'], problems: 0 },
        { why: 'a first number other than 0000 is allowed', files: ['0004_a.sql'], problems: 0 },
        { why: 'digits inside the snake part are fine', files: ['0001_ingredient_v2_rank.sql'], problems: 0 },
        { why: 'same number, different names', files: ['0054_a.sql', '0054_b.sql'], problems: 1 },
        {
            why: 'three claim one number: one problem for the number',
            files: ['0007_a.sql', '0007_b.sql', '0007_c.sql'],
            problems: 1,
        },
        {
            why: 'two numbers each doubled',
            files: ['0001_a.sql', '0001_b.sql', '0002_a.sql', '0002_b.sql'],
            problems: 2,
        },
        {
            why: 'duplicate at the end of the sequence only',
            files: ['0001_a.sql', '0002_b.sql', '0003_c.sql', '0003_d.sql'],
            problems: 1,
        },
        { why: 'no number', files: ['add_thing.sql'], problems: 1 },
        { why: 'three-digit number', files: ['001_a.sql'], problems: 1 },
        { why: 'five-digit number', files: ['00001_a.sql'], problems: 1 },
        { why: 'no snake part', files: ['0001.sql'], problems: 1 },
        { why: 'hyphenated', files: ['0001_add-thing.sql'], problems: 1 },
        { why: 'upper case', files: ['0001_AddThing.sql'], problems: 1 },
        { why: 'double underscore', files: ['0001__a.sql'], problems: 1 },
        { why: 'trailing underscore', files: ['0001_a_.sql'], problems: 1 },
        {
            why: 'a malformed name does not hide a duplicate',
            files: ['0001_a.sql', '0001_b.sql', 'oops.sql'],
            problems: 2,
        },
    ];

    it.each(table)('$why', ({ files, problems }) => {
        expect(migrationNamingProblems(files)).toHaveLength(problems);
    });

    it('names the contested number and every file claiming it', () => {
        expect(migrationNamingProblems(['0054_b.sql', '0054_a.sql'])).toEqual([
            { kind: 'duplicateNumber', number: '0054', files: ['0054_a.sql', '0054_b.sql'] },
        ]);
    });
});

describe('the runner refuses a badly named directory', () => {
    it('readMigrationManifest throws a MigrationNamingError carrying the problems', () => {
        const directory = dirWith(['0001_a.sql', '0001_b.sql']);

        try {
            readMigrationManifest(directory);
            expect.unreachable('a duplicate number must be refused');
        } catch (error) {
            expect(isMigrationNamingError(error)).toBe(true);
            expect((error as MigrationNamingError).problems).toEqual([
                { kind: 'duplicateNumber', number: '0001', files: ['0001_a.sql', '0001_b.sql'] },
            ]);
        }
    });

    it('discoverMigrations refuses it too', () => {
        expect(() => discoverMigrations(dirWith(['bad.sql']))).toThrow(MigrationNamingError);
    });

    it('accepts a clean directory', () => {
        expect(discoverMigrations(dirWith(['0002_b.sql', '0001_a.sql'])).map((m) => m.name)).toEqual([
            '0001_a',
            '0002_b',
        ]);
    });

    it('ignores non-sql files', () => {
        expect(discoverMigrations(dirWith(['0001_a.sql', 'README.md']))).toHaveLength(1);
    });
});
