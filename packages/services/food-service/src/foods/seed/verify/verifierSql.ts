/**
 * The catalog verifier's SQL files, in the order they run (curated catalog plan U6, KTD-3).
 *
 * @pattern Registry — the one list of what `prepare` and `verify` send; `__tests__/verifierSql.test.ts` holds it to the
 *   directory, so a file nobody listed cannot sit unread and a listed file cannot be missing
 *
 * The verifier takes the directory as a parameter (`sqlDir`), as the seeder takes `dataDir`: the build copies `sql/`
 * beside the data, so the seed digest covers a change to either (KTD-4).
 *
 * - {@link PREPARE_SQL} derives the expected catalog from the committed bytes alone. It creates temp functions and temp
 *   tables, so it runs before any transaction, and it never reads a catalog table: an expected state read off the
 *   catalog would agree with the catalog by construction.
 * - {@link REFUSALS_SQL} is one `SELECT` naming each committed input the expected state could not be read from.
 * - {@link CHECK_SQL} compares. Each file is one `SELECT` that only reads, so it runs inside the READ ONLY transaction an
 *   empty plan verifies in (KTD-2), and answers `(table_name, fact, row_count, sample)` per failing fact.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The derivation, in order: the restated rules first, then the expected state built on them. */
export const PREPARE_SQL = [
    'functions.sql',
    'usdaItems.sql',
    'curatedSeed.sql',
    'baseline.sql',
    'expectedCatalog.sql',
    'expectedNutrition.sql',
    'liveCatalog.sql',
] as const;

/** The committed inputs the expected state could not be derived from. */
export const REFUSALS_SQL = 'refusals.sql';

/** The comparisons, one catalog table or one history fact per file. */
export const CHECK_SQL = [
    'checkRoots.sql',
    'checkItems.sql',
    'checkSources.sql',
    'checkFieldProvenance.sql',
    'checkVariants.sql',
    'checkParts.sql',
    'checkCategories.sql',
    'checkPortions.sql',
    'checkNutrition.sql',
    'checkCitations.sql',
    'checkValues.sql',
    'checkSeedHeaders.sql',
    'checkDictionary.sql',
    'checkRetired.sql',
    'checkForwards.sql',
] as const;

/**
 * Read the named files from the verifier's SQL directory.
 *
 * @param sqlDir - The directory the build copies `sql/` into.
 * @param names - The files, in order.
 * @returns Their texts, in the same order.
 * @sideEffect Reads the files.
 */
export async function readVerifierSql(sqlDir: string, names: readonly string[]): Promise<string[]> {
    return Promise.all(names.map(async (name) => readFile(join(sqlDir, name), 'utf8')));
}
