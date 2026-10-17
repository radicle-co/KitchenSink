/**
 * The two assertions the manifest exists to make possible.
 *
 * `assertManifestMatches` is the RUNNER's side: it refuses to report a clean run unless the migration set
 * it holds is the one the caller expected. `assertSchemaCurrent` is the CONSUMER's side: a process that
 * reads the schema refuses to start against a database that has not caught up to its own release.
 *
 * Every case below is written so it fails if the check is loosened — an equality softened to a length
 * comparison, a throw softened to a warning, a required expectation made optional.
 */
import { describe, expect, it } from 'vitest';

import {
    SchemaBehindError,
    SchemaManifestMismatchError,
    assertManifestMatches,
    assertSchemaCurrent,
    isSchemaBehindError,
    isSchemaManifestMismatchError,
    missingMigrations,
} from '../index.js';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

describe('assertManifestMatches', () => {
    it('passes silently when the runner holds the set the caller expected', () => {
        expect(() =>
            assertManifestMatches({
                label: 'recipe',
                expected: SHA_A,
                actual: SHA_A,
                migrations: ['0001_init.sql'],
            }),
        ).not.toThrow();
    });

    it('throws when the digests differ, and names BOTH digests and the set it actually holds', () => {
        // The message is the whole point: an operator reading a failed deploy needs to see which set the
        // runner carries, because the answer is always "the previous release's".
        try {
            assertManifestMatches({
                label: 'recipe',
                expected: SHA_A,
                actual: SHA_B,
                migrations: ['0001_init.sql', '0002_more.sql'],
            });
            expect.unreachable('a manifest mismatch must throw');
        } catch (err) {
            expect(isSchemaManifestMismatchError(err)).toBe(true);
            expect(err).toBeInstanceOf(SchemaManifestMismatchError);

            const message = (err as Error).message;

            expect(message).toContain(SHA_A);
            expect(message).toContain(SHA_B);
            expect(message).toContain('0002_more.sql');
            expect(message).toContain('recipe');
        }
    });

    it('rejects a malformed expectation rather than comparing it', () => {
        // A caller that passes an empty string, or a truncated digest, has not proved anything — and a
        // string comparison against garbage would happily "fail closed" for the wrong reason, hiding a
        // broken caller behind a message about a stale runner.
        expect(() =>
            assertManifestMatches({ label: 'recipe', expected: '', actual: SHA_A, migrations: ['0001_init.sql'] }),
        ).toThrow(/not a sha256/iu);
        expect(() =>
            assertManifestMatches({
                label: 'recipe',
                expected: 'a'.repeat(63),
                actual: SHA_A,
                migrations: ['0001_init.sql'],
            }),
        ).toThrow(/not a sha256/iu);
    });

    it('carries the digests as fields, so a caller can report them without parsing the message', () => {
        const error = new SchemaManifestMismatchError({
            label: 'food',
            expected: SHA_A,
            actual: SHA_B,
            migrations: ['0001_init.sql'],
        });

        expect(error.expected).toBe(SHA_A);
        expect(error.actual).toBe(SHA_B);
        expect(error.migrations).toStrictEqual(['0001_init.sql']);
        expect(error.name).toBe('SchemaManifestMismatchError');
    });
});

describe('missingMigrations', () => {
    it('returns the expected migrations the database has not applied, in expected order', () => {
        expect(missingMigrations(['0001', '0002', '0003'], ['0002'])).toStrictEqual(['0001', '0003']);
    });

    it('is empty when the database is exactly current', () => {
        expect(missingMigrations(['0001', '0002'], ['0001', '0002'])).toStrictEqual([]);
    });

    it('is empty when the database is AHEAD — expand-first makes a newer schema safe for older code', () => {
        // ⛔ Not an oversight. Under expand-first migrations a contracting change ships a release LATER
        // than the code that stopped reading the column, so a database ahead of this release is the NORMAL
        // state during a rollout. Treating "ahead" as an error would fail every deploy mid-rollout.
        expect(missingMigrations(['0001'], ['0001', '0002', '0003'])).toStrictEqual([]);
    });
});

describe('assertSchemaCurrent', () => {
    it('resolves when every expected migration is recorded', async () => {
        await expect(
            assertSchemaCurrent({
                label: 'recipe-service',
                expected: ['0001', '0002'],
                readApplied: async () => ['0002', '0001'],
            }),
        ).resolves.toBeUndefined();
    });

    it('throws naming the migrations the database is missing', async () => {
        const failure = assertSchemaCurrent({
            label: 'recipe-service',
            expected: ['0001', '0002', '0003'],
            readApplied: async () => ['0001'],
        });

        await expect(failure).rejects.toBeInstanceOf(SchemaBehindError);

        try {
            await assertSchemaCurrent({
                label: 'recipe-service',
                expected: ['0001', '0002', '0003'],
                readApplied: async () => ['0001'],
            });
            expect.unreachable('a behind schema must throw');
        } catch (err) {
            expect(isSchemaBehindError(err)).toBe(true);
            expect((err as SchemaBehindError).missing).toStrictEqual(['0002', '0003']);
            expect((err as Error).message).toContain('0002');
            expect((err as Error).message).toContain('recipe-service');
        }
    });

    it('refuses an EMPTY expectation instead of passing vacuously', async () => {
        // A consumer that asserts against no migrations at all asserts nothing, and would report a healthy
        // boot against a completely empty database. That is the same silent-success shape the manifest
        // exists to remove, one layer up.
        await expect(
            assertSchemaCurrent({ label: 'recipe-service', expected: [], readApplied: async () => [] }),
        ).rejects.toThrow(/no migrations/iu);
    });

    it('propagates a ledger read failure rather than treating it as "nothing applied"', async () => {
        // ⛔ An unreadable ledger is NOT an empty ledger. Swallowing this would turn "the database is
        // unreachable" into "the database is behind" — a confident, wrong diagnosis on the one path an
        // operator most needs to trust.
        const boom = new Error('connection refused');

        await expect(
            assertSchemaCurrent({
                label: 'recipe-service',
                expected: ['0001'],
                readApplied: async () => {
                    throw boom;
                },
            }),
        ).rejects.toBe(boom);
    });
});
