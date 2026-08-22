/**
 * U12b — the food-catalog RESEED. Runs after U12a's two-service clear and puts the catalog back from the
 * operator-downloaded USDA bulk extractions. Plan
 * `docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md` §U12, Sequencing step 5;
 * requirements R44–R47.
 *
 * ── WHY A RESEED CARRIES A CLEAR'S GUARD ────────────────────────────────────────────────────────────
 * It is less destructive than a clear and it is still a BULK WRITE against shared data: thousands of
 * `food` rows with FRESH ULIDs, on a stage the operator named from a shell. So it takes the same
 * discipline U12a's clear takes and for the same reasons — a stage that must be NAMED with no default, a
 * `--confirm` that must EQUAL the resolved stage, production refused without `--allow-prod` and
 * `--allow-prod` REJECTED anywhere else, a `--dry-run` that writes nothing and needs no confirmation, and
 * the server's own `inet_server_addr()` / `current_database()` printed before the first write
 * (`describeDatabaseTarget`, reused from `clearCli.ts` — the honest limit of the guard, made visible).
 *
 * ── ⛔ THE POST-CONDITION RUNS AFTER THE WRITE, AND CANNOT UNDO IT ───────────────────────────────────
 * U12a's clear asserts INSIDE its transaction, so a residue rolls back. A reseed cannot: ~8k foods are
 * ~8k transactions (each takes a per-name advisory lock and touches the shared nutrient dictionary), so
 * {@link assertCatalogReseeded} can only report. That is why it reports EVERY violated check at once and
 * why its error names the remedy — the import is idempotent, so fixing the cause and re-running is safe.
 *
 * ── ⚠️ WHAT THIS RESEED DOES NOT DO: LAND ALIASES ───────────────────────────────────────────────────
 * The plan sequences U12b before the ranking work because "U2's alias verification is unobservable until
 * rows carry additionalDescriptions". U2 then MEASURED that USDA publishes those only for Survey (FNDDS)
 * foods, and the roster this reseed ships (`catalogDatasets.ts`) enables Foundation + SR Legacy, which
 * carry none. **So `food.aliases` is NULL across the whole reseeded catalog and this reseed does not, by
 * itself, make U2 observable.** Whether to add FNDDS is a product decision (composite prepared dishes
 * competing with ingredient rows) recorded in the roster and left to the owner. Every run REPORTS the
 * position it is in (`aliasesExpected`, `foodsWithAliases`) rather than leaving it to be inferred.
 *
 * ── PATTERNS ────────────────────────────────────────────────────────────────────────────────────────
 * Pure Specification ({@link decideReseed}) + pure post-condition ({@link assertCatalogReseeded}) +
 * three Ports ({@link CatalogSourceReader}, {@link CatalogSeeder}, {@link CatalogInventory}) with one
 * Adapter each + a Command ({@link runCatalogReseed}) composing them. The same shape as `clearCli.ts`,
 * whose pure/impure split follows `.github/scripts/deploy-gate.sh` (pure `decide`, impure `evaluate`,
 * ADR-0010). The dataset selection is a Registry (`catalogDatasets.ts`) rather than a constant, so
 * changing WHICH datasets the catalog holds is configuration.
 *
 * Usage (the clear runs FIRST — see `README.md` in this directory for the full two-service runbook):
 *
 *   STAGE=sandbox DATABASE_URL=postgres://…/kitchensink_food \
 *     npm run catalog:reseed --workspace=packages/services/food-service -- \
 *       --dir tmp/fdc/FoodData_Central_sr_legacy_food_csv_2018-04 \
 *       --dir tmp/fdc/FoodData_Central_foundation_food_csv_2026-04-30 --dry-run
 *   … same, then -- --confirm sandbox
 */
import { parseArgs } from 'node:util';

import { isNotNull, ne, sql, type SQL } from 'drizzle-orm';

import { food } from '../../db/schema/index.js';
import type { FoodDrizzle } from '../../database/database.module.js';
import type { CanonicalCandidate } from '../../sources/foodSourceAdapter.js';
import { streamBulkCandidates } from '../../sources/usda/bulk/usdaBulk.reader.js';
import type { BulkDataType } from '../../sources/usda/bulk/usdaBulk.types.js';
import { SilentWorkerLogger } from '../../worker/SilentWorkerLogger.js';
import type { WorkerLogger } from '../../worker/workerLogger.js';
import type { BulkSeedResult } from './bulkSeed.service.js';
import { CATALOG_DATASETS, enabledDataTypes, expectsAliases, type CatalogDataset } from './catalogDatasets.js';
import { CatalogReseedRefusedError, CatalogReseedUnverifiedError } from './reseedCli.errors.js';
import { parseLimit, take } from './seedCli.js';

import { PRODUCTION_STAGE } from './clearCli.js';

// Re-exported rather than redeclared: "which stage name means production" is ONE piece of knowledge, and
// U12a's clear already owns it. A second spelling is exactly how the two halves of one reset drift apart.
export { PRODUCTION_STAGE };

/** The validated CLI options for one reseed run. */
export interface ReseedCliOptions {
    /** The deploy stage whose food database this process is pointed at. */
    readonly stage: string;
    /** The stage name the operator typed back, or `undefined` when they typed none. */
    readonly confirm: string | undefined;
    /** Whether the operator explicitly accepted a production run. */
    readonly allowProd: boolean;
    /** Whether to report what would be imported and write nothing. */
    readonly dryRun: boolean;
    /** The extracted USDA bulk directories to import, in order. One per downloaded dataset. */
    readonly dirs: readonly string[];
    /** Optional cap on candidates taken from EACH directory — the bounded smoke run. */
    readonly limit: number | undefined;
    /** The dataset roster this run imports under (see `catalogDatasets.ts`). */
    readonly datasets: readonly CatalogDataset[];
}

/** Why the destructive-operation guard declined. */
export type ReseedRefusalReason =
    | 'confirmation-missing'
    | 'confirmation-mismatch'
    | 'production-requires-flag'
    | 'production-flag-off-production'
    | 'no-dataset-enabled';

/** What the guard decided: refuse outright, report only, or reseed. */
export type ReseedDecision =
    | { readonly kind: 'refused'; readonly reason: ReseedRefusalReason }
    | { readonly kind: 'report' }
    | { readonly kind: 'reseed' };

/** The bulk-extraction side of the reseed. */
export interface CatalogSourceReader {
    /**
     * Stream one extracted bulk directory as canonical candidates, under the run's selected data types.
     *
     * @param dir - The extracted bulk directory.
     * @returns The candidates that directory yields.
     */
    readCandidates(dir: string): AsyncIterable<CanonicalCandidate>;
}

/** The import side — satisfied structurally by `BulkSeedService`. */
export interface CatalogSeeder {
    /**
     * Import a candidate stream as golden records.
     *
     * @param candidates - The candidates.
     * @returns The run's tallies.
     */
    seed(candidates: AsyncIterable<CanonicalCandidate>): Promise<BulkSeedResult>;
}

/** The read-side counts the post-condition judges the reseed by. */
export interface CatalogInventory {
    /** @returns how many golden records the catalog holds. */
    countFoods(): Promise<number>;
    /** @returns how many golden records are NOT marked `origin = 'bulk'`. */
    countFoodsNotOriginBulk(): Promise<number>;
    /** @returns how many golden records carry curated aliases (U2). */
    countFoodsWithAliases(): Promise<number>;
}

/** The command's three ports. */
export interface CatalogReseedDeps {
    /** The bulk-extraction reader. */
    readonly source: CatalogSourceReader;
    /** The importer. */
    readonly seeder: CatalogSeeder;
    /** The catalog's read-side counts. */
    readonly inventory: CatalogInventory;
}

/** The after-state the post-condition judges — every number it needs, and nothing else. */
export interface ReseedObservation {
    /** Golden records before the run. */
    readonly foodsBefore: number;
    /** Golden records after the run. */
    readonly foodsAfter: number;
    /** Candidates whose persist threw. */
    readonly failed: number;
    /** Golden records not marked `origin = 'bulk'`. */
    readonly foodsNotOriginBulk: number;
    /** Golden records carrying curated aliases. */
    readonly foodsWithAliases: number;
    /** Whether the roster promised aliases would land. */
    readonly aliasesExpected: boolean;
}

/** What one reseed run did. */
export interface CatalogReseedResult {
    /** `reported` for a dry run, `reseeded` for a run that imported. */
    readonly outcome: 'reported' | 'reseeded';
    /** The stage the run was configured for. */
    readonly stage: string;
    /** The `data_type`s the roster selected. */
    readonly dataTypes: readonly BulkDataType[];
    /** The extracted bulk directories that were read. */
    readonly dirs: readonly string[];
    /** Candidates consumed from the extractions. */
    readonly candidates: number;
    /** Foods brought to RESOLVED (always `0` for a dry run). */
    readonly seeded: number;
    /** Already-RESOLVED foods re-merged in place (always `0` for a dry run). */
    readonly refreshed: number;
    /** Already-RESOLVED foods skipped as unchanged (always `0` for a dry run). */
    readonly unchanged: number;
    /** Candidates whose persist threw (always `0` for a dry run). */
    readonly failed: number;
    /** Golden records before the run. */
    readonly foodsBefore: number;
    /** Golden records after the run (equal to `foodsBefore` for a dry run). */
    readonly foodsAfter: number;
    /** Golden records carrying curated aliases after the run. */
    readonly foodsWithAliases: number;
    /** ⚠️ Whether the roster promised aliases — `false` today, and that is the FNDDS consequence. */
    readonly aliasesExpected: boolean;
    /** Whether a real run would import anything right now — a dry run's headline answer. */
    readonly wouldProceed: boolean;
}

/**
 * Parse + validate the CLI options, strictly and up front.
 *
 * `--stage` falls back to `STAGE` but has NO default: a bulk write that guesses which stage it is on has
 * no guard at all. `--dir` is repeatable — one extracted download per dataset — and falls back to
 * `USDA_BULK_DIR`.
 *
 * @param argv - The process arguments (excluding `node` and the script path).
 * @param datasets - The dataset roster (defaults to the shipped {@link CATALOG_DATASETS}).
 * @returns The validated options.
 * @throws {Error} when no stage or no directory is supplied, or `--limit` is not a positive integer.
 */
export function parseReseedArgs(
    argv: readonly string[],
    datasets: readonly CatalogDataset[] = CATALOG_DATASETS,
): ReseedCliOptions {
    const { values } = parseArgs({
        args: [...argv],
        options: {
            stage: { type: 'string' },
            confirm: { type: 'string' },
            'allow-prod': { type: 'boolean', default: false },
            'dry-run': { type: 'boolean', default: false },
            dir: { type: 'string', multiple: true },
            limit: { type: 'string' },
        },
        allowPositionals: false,
    });

    const stage = (values.stage ?? process.env['STAGE'] ?? '').trim();

    if (!stage) {
        throw new Error(
            'Missing --stage (or STAGE): name the deploy stage whose food database this run is pointed at. ' +
                'There is deliberately no default — an unnamed stage is the hazard this task guards against.',
        );
    }

    const fromEnv = process.env['USDA_BULK_DIR'];
    const dirs = (values.dir ?? (fromEnv === undefined ? [] : [fromEnv])).map((dir) => dir.trim()).filter(Boolean);

    if (dirs.length === 0) {
        throw new Error(
            'Missing --dir (or USDA_BULK_DIR): the directory holding an extracted USDA bulk download. Pass ' +
                '--dir once per dataset; see README.md in this directory for the download step.',
        );
    }

    return {
        stage,
        confirm: values.confirm,
        allowProd: values['allow-prod'],
        dryRun: values['dry-run'],
        dirs,
        limit: parseLimit(values.limit),
        datasets,
    };
}

/**
 * The destructive-operation guard, as a pure function of the options (R45).
 *
 * Four mechanisms, in this order:
 *
 *  1. `--allow-prod` on a stage that is NOT production is an ERROR, not a no-op — including on a dry run.
 *     A flag that is harmless when wrong becomes a flag operators paste every time, and then it guards
 *     nothing.
 *  2. A roster that enables no dataset is refused rather than run: the import would read every file,
 *     select nothing, and fail its own post-condition minutes later.
 *  3. A dry run needs no confirmation — it writes nothing, and refusing to let an operator LOOK is how
 *     they end up running the destructive form to find out.
 *  4. A run that writes must name the stage back (`--confirm`), and production needs `--allow-prod` too.
 *
 * @param options - The validated CLI options.
 * @returns The decision.
 */
export function decideReseed(options: ReseedCliOptions): ReseedDecision {
    const isProduction = options.stage === PRODUCTION_STAGE;

    if (options.allowProd && !isProduction) {
        return { kind: 'refused', reason: 'production-flag-off-production' };
    }

    if (enabledDataTypes(options.datasets).length === 0) {
        return { kind: 'refused', reason: 'no-dataset-enabled' };
    }

    if (options.dryRun) {
        return { kind: 'report' };
    }

    if (options.confirm === undefined) {
        return { kind: 'refused', reason: 'confirmation-missing' };
    }

    if (options.confirm !== options.stage) {
        return { kind: 'refused', reason: 'confirmation-mismatch' };
    }

    if (isProduction && !options.allowProd) {
        return { kind: 'refused', reason: 'production-requires-flag' };
    }

    return { kind: 'reseed' };
}

/**
 * The reseed's post-condition — four checks over the observed after-state (R46, R47).
 *
 * ⚠️ It runs AFTER the write and cannot roll it back, so it evaluates ALL four and reports every failure
 * at once: the operator has no second chance to interrogate this state.
 *
 * The origin check is conditioned on having STARTED empty, which is the sequenced case (U12a's clear runs
 * first). A reseed onto an already-populated catalog is a legitimate resume-after-crash, and the live
 * acquisition path legitimately leaves `origin = 'live'` rows there — failing on those would punish the
 * documented recovery path for a state this run did not create.
 *
 * @param observation - The after-state.
 * @throws {CatalogReseedUnverifiedError} when any check fails.
 */
export function assertCatalogReseeded(observation: ReseedObservation): void {
    const failures: string[] = [];

    if (observation.foodsAfter === 0) {
        failures.push(
            'the catalog is EMPTY after the run — no candidate was imported. Check that --dir points at an ' +
                'extracted bulk directory holding the roster’s data types',
        );
    }

    if (observation.failed > 0) {
        failures.push(`${observation.failed} candidate(s) failed to persist and were skipped`);
    }

    if (observation.foodsBefore === 0 && observation.foodsNotOriginBulk > 0) {
        failures.push(
            `${observation.foodsNotOriginBulk} row(s) are not marked origin='bulk' although the catalog was ` +
                'empty before this run, so every row in it came from this reseed (R47)',
        );
    }

    if (observation.aliasesExpected && observation.foodsWithAliases === 0) {
        failures.push(
            'the roster enables an alias-carrying dataset but NO row carries aliases. USDA ships curated ' +
                'additional descriptions in food_attribute.csv / food_attribute_type.csv, which the bulk ' +
                'reader does not read — enabling the dataset is not sufficient on its own',
        );
    }

    if (failures.length > 0) {
        throw new CatalogReseedUnverifiedError(failures);
    }
}

/**
 * Run one reseed: decide, count what is there, import every configured extraction in order, then verify.
 *
 * @param deps - The reader, the seeder and the inventory.
 * @param options - The validated CLI options.
 * @returns What the run did.
 * @throws {CatalogReseedRefusedError} when the guard declines — before any port is touched.
 * @throws {CatalogReseedUnverifiedError} when the produced catalog fails the post-condition.
 * @sideEffect Reads local bulk files and (unless `dryRun`) writes golden records.
 */
export async function runCatalogReseed(
    deps: CatalogReseedDeps,
    options: ReseedCliOptions,
): Promise<CatalogReseedResult> {
    const decision = decideReseed(options);

    if (decision.kind === 'refused') {
        throw new CatalogReseedRefusedError(decision.reason, options.stage);
    }

    const dataTypes = enabledDataTypes(options.datasets);
    const aliasesExpected = expectsAliases(options.datasets);
    const foodsBefore = await deps.inventory.countFoods();

    if (decision.kind === 'report') {
        let candidates = 0;

        for (const dir of options.dirs) {
            for await (const _candidate of take(deps.source.readCandidates(dir), options.limit)) {
                candidates += 1;
            }
        }

        return {
            outcome: 'reported',
            stage: options.stage,
            dataTypes,
            dirs: options.dirs,
            candidates,
            seeded: 0,
            refreshed: 0,
            unchanged: 0,
            failed: 0,
            foodsBefore,
            foodsAfter: foodsBefore,
            foodsWithAliases: await deps.inventory.countFoodsWithAliases(),
            aliasesExpected,
            wouldProceed: candidates > 0,
        };
    }

    const tally = { total: 0, seeded: 0, refreshed: 0, unchanged: 0, failed: 0 };

    // Sequentially, one extraction at a time: the importer is deliberately sequential per food (each
    // transaction takes the per-name advisory lock and touches the shared nutrient dictionary), so
    // interleaving directories would buy contention rather than throughput.
    for (const dir of options.dirs) {
        const result = await deps.seeder.seed(take(deps.source.readCandidates(dir), options.limit));

        tally.total += result.total;
        tally.seeded += result.seeded;
        tally.refreshed += result.refreshed;
        tally.unchanged += result.unchanged;
        tally.failed += result.failed;
    }

    const foodsAfter = await deps.inventory.countFoods();
    const foodsNotOriginBulk = await deps.inventory.countFoodsNotOriginBulk();
    const foodsWithAliases = await deps.inventory.countFoodsWithAliases();

    assertCatalogReseeded({
        foodsBefore,
        foodsAfter,
        failed: tally.failed,
        foodsNotOriginBulk,
        foodsWithAliases,
        aliasesExpected,
    });

    return {
        outcome: 'reseeded',
        stage: options.stage,
        dataTypes,
        dirs: options.dirs,
        candidates: tally.total,
        seeded: tally.seeded,
        refreshed: tally.refreshed,
        unchanged: tally.unchanged,
        failed: tally.failed,
        foodsBefore,
        foodsAfter,
        foodsWithAliases,
        aliasesExpected,
        wouldProceed: true,
    };
}

/**
 * The bulk-file adapter for {@link CatalogSourceReader}.
 *
 * @param options - The selected data types and an optional logger.
 * @returns The reader port.
 */
export function createBulkSourceReader(options: {
    readonly dataTypes: readonly BulkDataType[];
    readonly logger?: WorkerLogger;
}): CatalogSourceReader {
    const logger = options.logger ?? new SilentWorkerLogger();

    return {
        readCandidates: (dir: string): AsyncIterable<CanonicalCandidate> =>
            streamBulkCandidates({ dir, logger, dataTypes: options.dataTypes }),
    };
}

/**
 * The Drizzle adapter for {@link CatalogInventory}.
 *
 * Three counts rather than one grouped query: they are read once per run, they are what the
 * post-condition and the run's own report are stated in, and a `count(*) FILTER (...)` here would trade
 * that legibility for nothing measurable.
 *
 * @param db - The schema-typed Drizzle client for the food database.
 * @returns The inventory port.
 */
export function createCatalogInventory(db: FoodDrizzle): CatalogInventory {
    const count = async (where?: SQL): Promise<number> => {
        const [row] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(food)
            .where(where);

        return row?.count ?? 0;
    };

    return {
        countFoods: async (): Promise<number> => count(),
        countFoodsNotOriginBulk: async (): Promise<number> => count(ne(food.origin, 'bulk')),
        countFoodsWithAliases: async (): Promise<number> => count(isNotNull(food.aliases)),
    };
}
