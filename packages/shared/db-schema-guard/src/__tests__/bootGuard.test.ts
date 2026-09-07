/**
 * The BOOT guard — a process that reads the schema refusing to serve against a database behind its release.
 *
 * ## What it is for, given the pipeline already orders the migration
 *
 * The pipeline applies the schema before it deploys anything that reads it, so the ordinary release path is
 * already covered. This exists for the paths that are NOT a release:
 *
 *  - a database restored from a snapshot taken before a migration, with the tasks left running;
 *  - a task that scales out long after such a restore;
 *  - a stack deployed by hand, outside a pipeline, which gets no barrier at all.
 *
 * That is exactly the case the migration safety net was kept for — "a stage whose schema is behind for a
 * reason no code change explains" — and it is the one case a pipeline step structurally cannot see.
 *
 * ## Why `warn` exists and is the default
 *
 * ⛔ A boot assertion that fails closed can crash-loop an entire service, so the mode it ships in matters
 * more than the check. It reports for a soak, and the flip to `enforce` is one environment variable once
 * the reports read clean. In `warn` NOTHING may throw — including the packaging faults below — because a
 * guard that takes a service down while it is supposed to be observing is worse than no guard.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { VerifySchemaCurrentOptions } from '../index.js';
import { SchemaBehindError, schemaCurrencyMode, verifySchemaCurrent } from '../index.js';

/** The two arguments every case supplies, over defaults for the rest. */
type Case = Pick<VerifySchemaCurrentOptions, 'migrationsDir' | 'readApplied'> & Partial<VerifySchemaCurrentOptions>;

/** A scratch migrations directory holding `files` (name → SQL body). */
function makeMigrationsDir(files: Readonly<Record<string, string>>): string {
    const dir = mkdtempSync(join(tmpdir(), 'boot-guard-'));

    mkdirSync(dir, { recursive: true });

    for (const [name, body] of Object.entries(files)) {
        writeFileSync(join(dir, name), body);
    }

    return dir;
}

const TWO = { '0001_init.sql': 'CREATE TABLE a ();\n', '0002_more.sql': 'CREATE TABLE b ();\n' };

describe('schemaCurrencyMode', () => {
    it('defaults to warn — the mode a soak runs in', () => {
        expect(schemaCurrencyMode(undefined)).toBe('warn');
        expect(schemaCurrencyMode('')).toBe('warn');
    });

    it('reads enforce, case- and whitespace-insensitively', () => {
        expect(schemaCurrencyMode('enforce')).toBe('enforce');
        expect(schemaCurrencyMode('  ENFORCE  ')).toBe('enforce');
    });

    it('⛔ treats an UNRECOGNISED value as warn, never as enforce', () => {
        // A typo in a deploy variable must not silently arm a check that can crash-loop a service. Failing
        // toward the observing mode is the direction where being wrong is cheap.
        expect(schemaCurrencyMode('enforced')).toBe('warn');
        expect(schemaCurrencyMode('strict')).toBe('warn');
        expect(schemaCurrencyMode('true')).toBe('warn');
    });
});

describe('verifySchemaCurrent — enforce', () => {
    const enforce = (overrides: Case): VerifySchemaCurrentOptions => ({
        label: 'recipe-service',
        mode: 'enforce',
        report: vi.fn(),
        ...overrides,
    });

    it('resolves silently when the database has every migration this release ships', async () => {
        const report = vi.fn();

        await expect(
            verifySchemaCurrent(
                enforce({
                    migrationsDir: makeMigrationsDir(TWO),
                    readApplied: async () => ['0001_init', '0002_more'],
                    report,
                }),
            ),
        ).resolves.toBeUndefined();

        expect(report).not.toHaveBeenCalled();
    });

    it('THROWS naming the missing migrations', async () => {
        await expect(
            verifySchemaCurrent(
                enforce({ migrationsDir: makeMigrationsDir(TWO), readApplied: async () => ['0001_init'] }),
            ),
        ).rejects.toBeInstanceOf(SchemaBehindError);
    });

    it('THROWS when the migrations were never packaged into the image', async () => {
        // ⛔ A missing directory is a PACKAGING fault, and the tempting reading — "no migrations, so nothing
        // to be behind" — is the vacuous pass this whole area keeps producing. Under enforce it is a
        // refusal.
        await expect(
            verifySchemaCurrent(enforce({ migrationsDir: join(tmpdir(), 'nope'), readApplied: async () => [] })),
        ).rejects.toThrow();
    });

    it('THROWS when the ledger cannot be read — an unreadable database is not an empty one', async () => {
        await expect(
            verifySchemaCurrent(
                enforce({
                    migrationsDir: makeMigrationsDir(TWO),
                    readApplied: async () => {
                        throw new Error('connection refused');
                    },
                }),
            ),
        ).rejects.toThrow(/connection refused/u);
    });

    it('accepts a database AHEAD of this release', async () => {
        // Expand-first makes a newer schema the normal state mid-rollout; refusing here would take the old
        // tasks down during every deploy.
        await expect(
            verifySchemaCurrent(
                enforce({
                    migrationsDir: makeMigrationsDir(TWO),
                    readApplied: async () => ['0001_init', '0002_more', '0003_later'],
                }),
            ),
        ).resolves.toBeUndefined();
    });
});

describe('verifySchemaCurrent — warn', () => {
    const warn = (overrides: Case): VerifySchemaCurrentOptions => ({
        label: 'recipe-service',
        mode: 'warn',
        report: vi.fn(),
        ...overrides,
    });

    it('⛔ NEVER throws on a behind schema — it reports and lets the service serve', async () => {
        const report = vi.fn();
        const options = warn({
            migrationsDir: makeMigrationsDir(TWO),
            readApplied: async () => ['0001_init'],
            report,
        });

        await expect(verifySchemaCurrent(options)).resolves.toBeUndefined();
        expect(report).toHaveBeenCalledTimes(1);
        expect(String(report.mock.calls[0]?.[0])).toContain('0002_more');
    });

    it('⛔ NEVER throws on a packaging fault either', async () => {
        // The soak's whole point is to observe without risk. A guard that takes a service down while it is
        // supposed to be watching is worse than no guard.
        const report = vi.fn();

        await expect(
            verifySchemaCurrent(warn({ migrationsDir: join(tmpdir(), 'nope'), readApplied: async () => [], report })),
        ).resolves.toBeUndefined();
        expect(report).toHaveBeenCalledTimes(1);
    });

    it('⛔ NEVER throws on an unreadable ledger either', async () => {
        const report = vi.fn();

        await expect(
            verifySchemaCurrent(
                warn({
                    migrationsDir: makeMigrationsDir(TWO),
                    readApplied: async () => {
                        throw new Error('connection refused');
                    },
                    report,
                }),
            ),
        ).resolves.toBeUndefined();
        expect(String(report.mock.calls[0]?.[0])).toContain('connection refused');
    });

    it('says nothing at all when the schema is current — a soak must be readable', async () => {
        const report = vi.fn();

        await verifySchemaCurrent(
            warn({
                migrationsDir: makeMigrationsDir(TWO),
                readApplied: async () => ['0001_init', '0002_more'],
                report,
            }),
        );

        expect(report).not.toHaveBeenCalled();
    });

    it('names the MODE in what it reports, so a log line says whether it would have refused', async () => {
        const report = vi.fn();

        await verifySchemaCurrent(warn({ migrationsDir: makeMigrationsDir(TWO), readApplied: async () => [], report }));

        expect(String(report.mock.calls[0]?.[0])).toMatch(/warn/iu);
    });
});
