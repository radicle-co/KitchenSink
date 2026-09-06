/**
 * The migration MANIFEST — the thing that makes "nothing was pending" provable.
 *
 * ⛔ WHAT IS ACTUALLY BEING TESTED, and why it is not "hashing works". A migration runner reads its OWN
 * bundled `.sql` directory, diffs it against the `schema_migrations` ledger, applies the difference, and
 * returns `applied: []` when there is none. When the runner is a PREVIOUS release's — which it is whenever
 * it is invoked before the deploy that ships it — its directory does not contain the new migrations, so
 * `applied: []` means "I have never heard of them" and is byte-identical to "everything is applied". That
 * is the silent no-op ADR-0022 recorded, and no caller can currently tell the two apart.
 *
 * The manifest closes it by making the runner state WHICH migration set it holds. Every assertion below is
 * chosen so it fails if that property is lost, not merely if the hash changes.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    EmptyMigrationSetError,
    digestManifest,
    formatManifest,
    isEmptyMigrationSetError,
    isManifestSha,
    readMigrationManifest,
} from '../index.js';

/** A scratch migrations directory holding `files` (name → SQL body). */
function makeMigrationsDir(files: Readonly<Record<string, string>>): string {
    const dir = mkdtempSync(join(tmpdir(), 'db-schema-guard-'));

    mkdirSync(dir, { recursive: true });

    for (const [name, body] of Object.entries(files)) {
        writeFileSync(join(dir, name), body);
    }

    return dir;
}

const TWO_MIGRATIONS = {
    '0001_init.sql': 'CREATE TABLE a ();\n',
    '0002_more.sql': 'CREATE TABLE b ();\n',
};

describe('formatManifest', () => {
    it('orders by migration name, not by the order it was handed', () => {
        const text = formatManifest([
            { name: '0002_more.sql', sha256: 'b'.repeat(64) },
            { name: '0001_init.sql', sha256: 'a'.repeat(64) },
        ]);

        expect(text).toBe(`${'a'.repeat(64)}  0001_init.sql\n${'b'.repeat(64)}  0002_more.sql\n`);
    });

    it('emits the sha256sum line shape — two spaces, trailing newline — so a second implementation can reproduce it', () => {
        // ⛔ Load-bearing, not cosmetic. The CI half of this check is `sha256sum *.sql | sha256sum`, and GNU
        // coreutils prints `<hash><space><mode-indicator><name>` where the text-mode indicator is a space.
        // A one-space or newline-less rendering here makes the two implementations disagree on every run,
        // which reads as a stale runner on a deploy that is perfectly fine.
        expect(formatManifest([{ name: '0001_init.sql', sha256: 'a'.repeat(64) }])).toBe(
            `${'a'.repeat(64)}  0001_init.sql\n`,
        );
    });
});

describe('digestManifest', () => {
    it('is a 64-character lowercase hex sha256', () => {
        expect(isManifestSha(digestManifest('anything'))).toBe(true);
    });

    it('rejects a digest that is not 64 lowercase hex', () => {
        expect(isManifestSha('')).toBe(false);
        expect(isManifestSha('A'.repeat(64))).toBe(false);
        expect(isManifestSha('a'.repeat(63))).toBe(false);
        expect(isManifestSha(`${'a'.repeat(64)} `)).toBe(false);
    });
});

describe('readMigrationManifest', () => {
    it('digests the same set identically no matter what order the filesystem returns it in', () => {
        // Two directories, same content, files written in opposite orders.
        const forward = makeMigrationsDir(TWO_MIGRATIONS);
        const backward = makeMigrationsDir({
            '0002_more.sql': TWO_MIGRATIONS['0002_more.sql'],
            '0001_init.sql': TWO_MIGRATIONS['0001_init.sql'],
        });

        expect(readMigrationManifest(forward).sha).toBe(readMigrationManifest(backward).sha);
    });

    it('CHANGES when a migration is added — the stale-runner case the ledger cannot see', () => {
        const before = readMigrationManifest(makeMigrationsDir(TWO_MIGRATIONS));
        const after = readMigrationManifest(
            makeMigrationsDir({ ...TWO_MIGRATIONS, '0003_new.sql': 'CREATE TABLE c ();\n' }),
        );

        expect(after.sha).not.toBe(before.sha);
        expect(after.migrations).toStrictEqual(['0001_init.sql', '0002_more.sql', '0003_new.sql']);
    });

    it('CHANGES when a migration keeps its name and changes its body', () => {
        // The `schema_migrations` ledger is keyed by NAME with no checksum, so an edited migration is
        // invisible to it forever. The manifest is the only thing in the system that sees this.
        const before = readMigrationManifest(makeMigrationsDir(TWO_MIGRATIONS));
        const after = readMigrationManifest(
            makeMigrationsDir({ ...TWO_MIGRATIONS, '0002_more.sql': 'CREATE TABLE b (id int);\n' }),
        );

        expect(after.sha).not.toBe(before.sha);
    });

    it('CHANGES when a migration is renamed but its body is untouched', () => {
        const before = readMigrationManifest(makeMigrationsDir(TWO_MIGRATIONS));
        const after = readMigrationManifest(
            makeMigrationsDir({
                '0001_init.sql': TWO_MIGRATIONS['0001_init.sql'],
                '0002_renamed.sql': TWO_MIGRATIONS['0002_more.sql'],
            }),
        );

        expect(after.sha).not.toBe(before.sha);
    });

    it('ignores everything that is not `.sql`, so stray files cannot move the digest', () => {
        const bare = readMigrationManifest(makeMigrationsDir(TWO_MIGRATIONS));
        const cluttered = readMigrationManifest(
            makeMigrationsDir({ ...TWO_MIGRATIONS, 'README.md': '# notes\n', '.keep': '' }),
        );

        expect(cluttered.sha).toBe(bare.sha);
        expect(cluttered.migrations).toStrictEqual(['0001_init.sql', '0002_more.sql']);
    });

    it('REFUSES an empty migration set rather than digesting the empty string', () => {
        // sha256('') is a perfectly valid 64-hex digest, so an empty bundle would AGREE with an empty tree
        // and the guard would certify a runner carrying no migrations at all. Fail closed at both ends.
        const dir = makeMigrationsDir({ 'README.md': '# no sql here\n' });

        expect(() => readMigrationManifest(dir)).toThrow(EmptyMigrationSetError);

        try {
            readMigrationManifest(dir);
            expect.unreachable('readMigrationManifest must refuse an empty migration set');
        } catch (err) {
            expect(isEmptyMigrationSetError(err)).toBe(true);
            expect((err as Error).message).toContain(dir);
        }
    });
});
