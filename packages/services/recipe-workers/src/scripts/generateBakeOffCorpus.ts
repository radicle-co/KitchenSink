/**
 * THE BAKE-OFF CORPUS GENERATOR (plan U11 / KTD-4; owner ruling, 2026-08-23).
 *
 * DESIGN PATTERN: the impure half of the decide/evaluate split, the sibling of `verificationBakeOff.ts`.
 * Everything that DECIDES what a corpus line is lives in the pure `verification/corpusSynthesis.ts`; this file
 * reads the catalog, writes two files, and prints a summary.
 *
 * ## ⛔⛔ WHY THIS EXISTS, AND WHAT ITS OUTPUT IS NOT
 *
 * U11 sized the bake-off against a labelled slice of 2,432 lines from public-domain cookbooks. **ADR-0023
 * forbids anything in this repository from fetching that material** — `gutenberg.org/robots.txt` permits the
 * path, and the site's robot-access policy still says it "is intended for human users only" and that
 * perceived automated access "will result in a temporary or permanent block of your IP address"; robots.txt
 * compliance is not terms-of-use compliance, and the address a VPC Lambda leaves through is shared and
 * stage-level. No operator has supplied the file out of band. So the owner ruled: **substitute a corpus we
 * can generate, and label the results NOT COMPARABLE to U1's annotation protocol.**
 *
 * The substituted corpus is admissible for exactly one reason: **ground truth is known BY CONSTRUCTION.** We
 * build the (line, candidate) pair from a real catalog row, so whether the pair matches is a fact about how it
 * was built. It measures DISCRIMINATION on constructed contrasts. It does NOT measure field accuracy, and no
 * number taken from it may be compared with U1's.
 *
 * ## ⛔ THE CATALOG IS REAL AND IS NOT OPTIONAL
 *
 * The realistic half of the corpus comes from the seeded USDA catalog — 8,094 rows after U12's reseed
 * (`docs/reports/2026-08-22-001-ingredient-resolution-measurement.md` §1). If that database is empty or
 * unreachable this script STOPS and says so, rather than falling back to a hard-coded food list: a hand-written
 * list would make the near-miss class a list of near misses SOMEBODY CHOSE, which is the annotation step this
 * whole exercise exists to avoid.
 *
 * ## ⛔ DO NOT COMMIT THE OUTPUT
 *
 * Write it under a scratch path. It is reproducible from the seed and the catalog digest, both of which the
 * manifest records, so committing it stores megabytes to preserve nothing — and a corpus in the tree is a
 * corpus somebody eventually mistakes for the operator-supplied one.
 *
 * ## Usage
 *
 * ```
 * npx tsx src/scripts/generateBakeOffCorpus.ts \
 *   --catalog-url postgresql://user:pass@localhost:5432/food_load \
 *   --seed 20260823 --size 2432 --out /tmp/bakeoff/corpus.jsonl
 * ```
 *
 * Writes `--out` (JSONL) and `--out`.manifest.json (provenance: seed, catalog digest, class balance).
 *
 * @sideEffect Connects to PostgreSQL, reads the food catalog, writes two files, writes to stdout and stderr.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import pg from 'pg';

import { renderCorpusJsonl } from '../verification/corpus.js';
import { synthesizeBakeOffCorpus, type CatalogRow } from '../verification/corpusSynthesis.js';

/** The plan's corpus size. Kept as the default so the generated corpus has the shape U11 sized against. */
const DEFAULT_TARGET_SIZE = 2432;

/**
 * The rows a resolved ingredient line could actually land on.
 *
 * `tombstoned_at is null` and `status = 'RESOLVED'` because a tombstoned or still-pending row is not a
 * candidate the cascade can return, so offering one as a "near miss" would be a contrast the gate never sees.
 */
const CATALOG_QUERY = `
    select id, name
      from food
     where name is not null
       and tombstoned_at is null
       and status = 'RESOLVED'
`;

/** Raised when the catalog cannot supply a corpus. Matching guard: {@link isCatalogUnavailableError}. */
export class CatalogUnavailableError extends Error {
    public constructor(detail: string) {
        super(`the food catalog cannot supply a corpus: ${detail}`);
        this.name = 'CatalogUnavailableError';
        Object.setPrototypeOf(this, CatalogUnavailableError.prototype);
    }
}

/** Type guard for {@link CatalogUnavailableError}. */
export function isCatalogUnavailableError(error: unknown): error is CatalogUnavailableError {
    return error instanceof CatalogUnavailableError;
}

/**
 * Read every usable row of the food catalog.
 *
 * @param connectionString - A PostgreSQL URL for the food database.
 * @returns The rows.
 * @throws {CatalogUnavailableError} When the catalog holds no rows — the STOP condition, stated loudly rather
 *   than papered over with an invented food list.
 * @sideEffect Opens and closes a PostgreSQL connection.
 */
export async function readFoodCatalog(connectionString: string): Promise<CatalogRow[]> {
    const client = new pg.Client({ connectionString });

    await client.connect();

    try {
        const result = await client.query<CatalogRow>(CATALOG_QUERY);

        if (result.rows.length === 0) {
            throw new CatalogUnavailableError(
                "it returned no rows — seed it with U12's reseed before generating a corpus",
            );
        }

        return result.rows;
    } finally {
        await client.end();
    }
}

/** Read and validate the command line. */
function readOptions(): { catalogUrl: string; seed: number; size: number; out: string } {
    const { values } = parseArgs({
        options: {
            'catalog-url': { type: 'string' },
            seed: { type: 'string' },
            size: { type: 'string' },
            out: { type: 'string' },
        },
    });

    const catalogUrl = values['catalog-url'] ?? process.env['FOOD_DATABASE_URL'];

    if (catalogUrl === undefined || values.out === undefined || values.seed === undefined) {
        throw new Error('usage: --catalog-url <postgres-url> --seed <integer> --out <path.jsonl> [--size <n>]');
    }

    const seed = Number(values.seed);
    const size = Number(values.size ?? DEFAULT_TARGET_SIZE);

    if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(size) || size < 4) {
        throw new Error('--seed must be an integer and --size an integer of at least 4');
    }

    return { catalogUrl, seed, size, out: values.out };
}

/**
 * Generate the corpus and its manifest.
 *
 * @sideEffect Reads the catalog, writes two files, prints a summary.
 */
async function main(): Promise<void> {
    const options = readOptions();
    const rows = await readFoodCatalog(options.catalogUrl);

    process.stderr.write(`read ${String(rows.length)} catalog rows\n`);

    const { lines, manifest } = synthesizeBakeOffCorpus({ rows, seed: options.seed, targetSize: options.size });

    writeFileSync(options.out, renderCorpusJsonl(lines), 'utf8');
    writeFileSync(`${options.out}.manifest.json`, `${JSON.stringify(manifest, null, 4)}\n`, 'utf8');

    for (const [contrastClass, shortfall] of Object.entries(manifest.classShortfalls)) {
        if (shortfall > 0) {
            // ⚠️ Not an error. A class the catalog cannot fill is a fact about the catalog, and the report
            // quotes the achieved balance rather than the requested one.
            process.stderr.write(`shortfall: ${contrastClass} is ${String(shortfall)} lines under target\n`);
        }
    }

    process.stdout.write(`${JSON.stringify({ out: options.out, lines: lines.length, manifest }, null, 4)}\n`);
}

// ⛔ Guarded. `verificationBakeOff.ts` runs on import, which means a test that imports it for one exported
// helper starts spending money. This script reads a database and writes files on import for the same reason,
// so the entry point is gated on being the process's entry module.
if (import.meta.main) {
    await main();
}
