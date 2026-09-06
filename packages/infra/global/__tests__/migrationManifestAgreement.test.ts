/**
 * Repo-wide guard: the TWO migration-manifest implementations agree, byte for byte.
 *
 * ## Why there are two, and why that is the point
 *
 * A migration runner reads its OWN bundled `.sql`, diffs it against `schema_migrations`, and returns
 * `applied: []` when there is nothing to do. When the runner is a PREVIOUS release's — which it is whenever
 * it is invoked before the deploy that ships it — its directory does not hold the new migrations, so
 * `applied: []` means "I have never heard of them" and is byte-identical to "everything is already
 * applied". ADR-0022 recorded that as the reason the apply had to move INSIDE the deploy.
 *
 * The manifest closes it directly: the caller states which migration set it expects, and a runner holding a
 * different set fails loudly instead of reporting a clean run. That only works if the two sides — CI's
 * `run-migrations.sh` reading the working tree, and `@kitchensink/db-schema-guard` inside the shipped
 * bundle — compute the same value from the same files.
 *
 * ⛔ They are DELIBERATELY separate implementations. A single shared helper can be wrong identically on
 * both sides and still agree; two cannot, because sha256 has exactly one right answer. This guard is what
 * makes that claim checkable rather than aspirational.
 *
 * ⚠️ It asserts the RENDERED TEXT as well as the final digest. A digest-only check would tell you the two
 * disagree and nothing about where — and the plausible divergences (the two-space mode indicator, sort
 * collation, a missing trailing newline) are all differences in the text.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';

import { formatManifest, readMigrationManifest, sha256Hex } from '@kitchensink/db-schema-guard';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const SCRIPT = join(REPO_ROOT, '.github', 'scripts', 'run-migrations.sh');

/** Every real service migrations directory, found rather than listed. */
function serviceMigrationDirs(): readonly string[] {
    const dirs = globSync('packages/services/*/src/**/migrations/*.sql', {
        cwd: REPO_ROOT,
        ignore: '**/node_modules/**',
    }).map((file) => join(REPO_ROOT, file, '..'));

    return [...new Set(dirs)].sort();
}

/**
 * The digest `run-migrations.sh manifest` computes for a directory.
 *
 * @param dir - The migrations directory.
 * @returns The trimmed stdout plus the exit status.
 * @sideEffect Spawns `bash`.
 */
function shellManifest(dir: string): { readonly sha: string; readonly status: number } {
    const result = spawnSync('bash', [SCRIPT, 'manifest', dir], { encoding: 'utf8' });

    return { sha: result.stdout.trim(), status: result.status ?? -1 };
}

/**
 * The raw `sha256sum *.sql` rendering the shell half digests — the text the TypeScript half must reproduce.
 *
 * @param dir - The migrations directory.
 * @returns The concatenated `sha256sum` lines.
 * @sideEffect Spawns `bash`.
 */
function shellRendering(dir: string): string {
    const result = spawnSync(
        'bash',
        ['-c', 'cd "$1" && LC_ALL=C ls -1 -- *.sql | LC_ALL=C sort | tr "\\n" "\\0" | xargs -0 -r sha256sum', '_', dir],
        { encoding: 'utf8' },
    );

    return result.stdout;
}

/** A scratch migrations directory holding `files` (name → SQL body). */
function makeMigrationsDir(files: Readonly<Record<string, string>>): string {
    const dir = mkdtempSync(join(tmpdir(), 'manifest-agreement-'));

    mkdirSync(dir, { recursive: true });

    for (const [name, body] of Object.entries(files)) {
        writeFileSync(join(dir, name), body);
    }

    return dir;
}

describe('migration manifest — shell and TypeScript agree', () => {
    it('produces the same digest for the same migration set', () => {
        const dir = makeMigrationsDir({
            '0001_init.sql': 'CREATE TABLE a ();\n',
            '0002_more.sql': 'CREATE TABLE b ();\n',
        });
        const shell = shellManifest(dir);

        expect(shell.status).toBe(0);
        expect(shell.sha).toBe(readMigrationManifest(dir).sha);
    });

    it('renders the same TEXT, so a future disagreement names the line it happened on', () => {
        const dir = makeMigrationsDir({
            '0001_init.sql': 'CREATE TABLE a ();\n',
            '0002_more.sql': 'CREATE TABLE b ();\n',
            '0010_later.sql': 'CREATE TABLE c ();\n',
        });

        // ⛔ This is the assertion that pins the two-space mode indicator and the trailing newline. Drop
        // either from `formatManifest` and this fails here, at the rendering, rather than as an opaque
        // digest mismatch on a deploy.
        expect(formatManifest(readMigrationManifest(dir).entries)).toBe(shellRendering(dir));
    });

    it('agrees on ordering that is NOT the order the files were created in', () => {
        // Both halves sort under C collation. `0010` before `0002` is the classic way a hand-rolled
        // numeric sort and a lexical one diverge — here both must be lexical, because that is what the
        // runner's own `readdir().sort()` apply order already is.
        const dir = makeMigrationsDir({
            '0010_later.sql': 'CREATE TABLE c ();\n',
            '0002_more.sql': 'CREATE TABLE b ();\n',
            '0001_init.sql': 'CREATE TABLE a ();\n',
        });

        expect(readMigrationManifest(dir).migrations).toStrictEqual([
            '0001_init.sql',
            '0002_more.sql',
            '0010_later.sql',
        ]);
        expect(shellManifest(dir).sha).toBe(readMigrationManifest(dir).sha);
    });

    it('agrees that a body edit under an unchanged name is a DIFFERENT set', () => {
        // The `schema_migrations` ledger is keyed by name with no checksum, so this is the one difference
        // the ledger can never see. Both halves must see it.
        const before = makeMigrationsDir({ '0001_init.sql': 'CREATE TABLE a ();\n' });
        const after = makeMigrationsDir({ '0001_init.sql': 'CREATE TABLE a (id int);\n' });

        expect(shellManifest(before).sha).not.toBe(shellManifest(after).sha);
        expect(shellManifest(before).sha).toBe(readMigrationManifest(before).sha);
        expect(shellManifest(after).sha).toBe(readMigrationManifest(after).sha);
    });

    it('both halves REFUSE an empty migration set instead of digesting the empty string', () => {
        // `sha256('')` is a well-formed digest, so an empty bundle would agree with an empty tree and
        // certify a runner carrying no migrations at all. Neither half may return it.
        const dir = makeMigrationsDir({ 'README.md': '# no sql here\n' });
        const shell = shellManifest(dir);

        expect(shell.status).not.toBe(0);
        expect(shell.sha).not.toBe(sha256Hex(''));
        expect(() => readMigrationManifest(dir)).toThrow(/empty migration set/iu);
    });

    it('the shell half fails on a directory that does not exist, rather than printing a digest', () => {
        const missing = shellManifest(join(tmpdir(), 'manifest-agreement-does-not-exist'));

        expect(missing.status).toBe(1);
        expect(missing.sha).toBe('');
    });

    it('is misuse — never success — to ask for a manifest with no directory', () => {
        const result = spawnSync('bash', [SCRIPT, 'manifest'], { encoding: 'utf8' });

        expect(result.status).toBe(2);
    });

    it('agrees on every REAL service migrations directory, not only on fixtures', () => {
        // ⛔ The fixtures above isolate specific divergences; this one is the whole population. Real
        // migration filenames carry numeric prefixes, underscores and long descriptive tails, and that is
        // exactly the kind of set where a locale-sensitive sort or an escaping bug in one half shows up and
        // nowhere else.
        const dirs = serviceMigrationDirs();

        // Anti-vacuity: a glob that matched nothing would satisfy the loop below in silence.
        expect(dirs.length).toBeGreaterThanOrEqual(3);

        for (const dir of dirs) {
            const shell = shellManifest(dir);

            expect(shell.status, `run-migrations.sh manifest failed for ${dir}`).toBe(0);
            expect(shell.sha, `manifest disagreement for ${dir}`).toBe(readMigrationManifest(dir).sha);
        }
    });
});
