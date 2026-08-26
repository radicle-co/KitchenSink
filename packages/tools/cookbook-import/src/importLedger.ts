/**
 * The import LEDGER — the tool's own record of what it has already created.
 *
 * DESIGN PATTERN: **Local idempotency projection**. `POST /api/v1/recipes` assigns the id server-side and
 * has no natural key, so there is nothing to make the create itself idempotent. Without a ledger, the third
 * run of this tool leaves three copies of every recipe, and a run interrupted by a rate-limit storm cannot
 * be resumed — only restarted, on top of what it already wrote.
 *
 * The key is `{ebookId}::{title}` — the book plus the heading, which is what actually identifies a recipe
 * in a printed cookbook. The value is the recipe id the service assigned, so the ledger doubles as the
 * audit trail linking a public recipe row back to the page it came from.
 *
 * ⚠️ It is written after EVERY create, not once at the end. A crash between the create and the write is the
 * only way to duplicate a recipe, and that window is one file append wide; buffering to the end would make
 * the window the whole run.
 *
 * @sideEffect Reads and writes a JSON file.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** What the ledger remembers about one imported recipe. */
export interface LedgerEntry {
    /** The recipe id the service assigned. */
    readonly recipeId: string;
    /** When it was created, ISO 8601. */
    readonly importedAt: string;
}

/** The identity of a recipe within the corpus: the book, plus the heading it was printed under. */
export function ledgerKey(ebookId: number, title: string): string {
    return `${ebookId}::${title}`;
}

/** A ledger held in memory, persisted on every write. */
export class ImportLedger {
    private readonly path: string;
    private readonly entries: Map<string, LedgerEntry>;

    private constructor(path: string, entries: Map<string, LedgerEntry>) {
        this.path = path;
        this.entries = entries;
    }

    /**
     * Load the ledger, treating an absent file as an empty one.
     *
     * ⚠️ A CORRUPT file THROWS rather than starting empty. Silently continuing from zero would re-import
     * everything the ledger was there to protect, which is the exact failure it exists to prevent — and it
     * would do it while reporting success.
     *
     * @param path - Where the ledger lives.
     * @returns The loaded ledger.
     * @throws {Error} When the file exists but is not readable as a ledger.
     * @sideEffect Reads the filesystem.
     */
    public static load(path: string): ImportLedger {
        if (!existsSync(path)) {
            return new ImportLedger(path, new Map());
        }

        const raw = readFileSync(path, 'utf-8');

        try {
            const parsed = JSON.parse(raw) as Record<string, LedgerEntry>;

            return new ImportLedger(path, new Map(Object.entries(parsed)));
        } catch (error) {
            throw new Error(
                `cookbook-import: ledger at ${path} is unreadable. Refusing to continue: starting from an ` +
                    `empty ledger would duplicate every recipe it records.`,
                { cause: error },
            );
        }
    }

    /** Whether this recipe has already been imported. */
    public has(ebookId: number, title: string): boolean {
        return this.entries.has(ledgerKey(ebookId, title));
    }

    /** The recorded entry, if any. */
    public get(ebookId: number, title: string): LedgerEntry | undefined {
        return this.entries.get(ledgerKey(ebookId, title));
    }

    /** How many recipes the ledger records. */
    public get size(): number {
        return this.entries.size;
    }

    /**
     * Record a created recipe and persist immediately.
     *
     * @param ebookId - The book it came from.
     * @param title - The heading it was printed under.
     * @param recipeId - The id the service assigned.
     * @sideEffect Writes the ledger file.
     */
    public record(ebookId: number, title: string, recipeId: string): void {
        this.entries.set(ledgerKey(ebookId, title), { recipeId, importedAt: new Date().toISOString() });
        this.persist();
    }

    /**
     * Write the whole ledger.
     *
     * @sideEffect Creates the parent directory if needed and writes the file.
     */
    private persist(): void {
        mkdirSync(dirname(this.path), { recursive: true });
        // ⚠️ `mode` is not decoration. CodeQL flagged this write `js/insecure-temporary-file` (2026-08-26)
        // because the README showed operators a `--ledger /tmp/…` path, and a world-readable file in a
        // shared temp dir names every recipe this operator imported. The ledger is a PERSISTENT resume
        // record, not a temp file, so the usual cure (an exclusive create under a random name) would break
        // the resumption it exists for — restricting the mode is the fix that fits what the file is. The
        // README now suggests a project-local path for the same reason.
        writeFileSync(this.path, `${JSON.stringify(Object.fromEntries(this.entries), null, 4)}\n`, {
            encoding: 'utf-8',
            mode: 0o600,
        });
    }
}
