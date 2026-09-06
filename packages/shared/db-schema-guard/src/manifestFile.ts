/**
 * Reading and writing a migration manifest against a real directory.
 *
 * Split from `manifest.ts` on purpose: everything there is a pure function of its inputs and is exercised
 * without touching a filesystem, while everything here performs I/O and is marked `@sideEffect`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { EmptyMigrationSetError } from './errors.js';
import type { ManifestEntry } from './manifest.js';
import { digestManifest, formatManifest, sha256Hex } from './manifest.js';

/** A directory's manifest: its entries, the rendered text, and the digest of that text. */
export interface MigrationManifest {
    /** The migration filenames, in apply order. */
    readonly migrations: readonly string[];
    /** The per-file entries, in apply order. */
    readonly entries: readonly ManifestEntry[];
    /** The canonical manifest text. */
    readonly text: string;
    /** The digest of {@link MigrationManifest.text}. */
    readonly sha: string;
    /**
     * Each migration's SQL, keyed by filename.
     *
     * ⛔ Read ONCE, alongside the bytes that were digested, and applied from here — never re-read from disk
     * at apply time. The manifest's whole claim is that what ran is what was digested, and two reads of the
     * same path are two chances for that to stop being true.
     */
    readonly bodies: ReadonlyMap<string, string>;
}

/**
 * Compute the manifest of a migrations directory.
 *
 * ⚠️ Only `.sql` counts, so anything an operator or a build step leaves in the directory — a README, a
 * `.keep`, an editor backup — cannot move the digest. Everything the two implementations disagree about is
 * a real difference in the migration set.
 *
 * @param migrationsDir - The directory holding the ordered `.sql` migrations.
 * @returns The directory's manifest.
 * @throws {EmptyMigrationSetError} when the directory holds no `.sql` files.
 * @sideEffect Reads the migrations directory and every `.sql` file in it.
 */
export function readMigrationManifest(migrationsDir: string): MigrationManifest {
    const migrations = readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort();

    if (migrations.length === 0) {
        throw new EmptyMigrationSetError(migrationsDir);
    }

    const bodies = new Map<string, string>();
    const entries = migrations.map((name) => {
        const bytes = readFileSync(join(migrationsDir, name));

        bodies.set(name, bytes.toString('utf8'));

        return { name, sha256: sha256Hex(bytes) };
    });
    const text = formatManifest(entries);

    return { migrations, entries, text, sha: digestManifest(text), bodies };
}
