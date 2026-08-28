/**
 * U12a, HALF TWO — the food-catalog CLEAR. Runs SECOND in the two-service catalog reset, and refuses to
 * delete anything until the recipe-side unlink
 * (`packages/services/recipe-service/src/ingredients/unlinkCli.ts`) has finished. Plan:
 * `docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md` §U12, Sequencing step 4;
 * requirements R44–R47.
 *
 * ── ⛔ THE ORDER IS THE UNIT ─────────────────────────────────────────────────────────────────────────
 * The reseed that follows mints FRESH ULIDs, and `ingredients.food_id` is an opaque cross-service
 * reference with **no foreign key** — nothing in either database can catch a dangling one. So the
 * reference is dropped before the referent is: this task ASKS the recipe database how many links remain
 * and aborts on anything but zero, before one food row is deleted. That check is not advisory and not
 * skippable — `--recipe-database-url` is required, and a probe that cannot answer fails CLOSED
 * ({@link RecipeLinkageUnreadableError}), the same posture ADR-0024 takes for an unreadable spend counter.
 *
 * The discipline is copied from this repository's other two-system destructive operation:
 * `packages/apps/commise/web/scripts/teardownPreviewDomain.ts` and its mirror `createPreviewDomain.ts`
 * (ADR-0001 "Teardown of the preview address", ADR-0005) — "either reversal manufactures the
 * subdomain-takeover window", and a failure in the first step aborts before the second.
 *
 * ── WHY THIS TASK READS ANOTHER SERVICE'S DATABASE ──────────────────────────────────────────────────
 * It is the one thing that makes the ordering a MECHANISM rather than a line in a runbook. The read is
 * two statements inside a `BEGIN TRANSACTION READ ONLY` over a connection the OPERATOR supplies — this
 * process cannot write to the recipe database even if it tried, and the food service's own
 * `food_app`/`DATABASE_URL` is never that connection. Nothing else here knows anything about the recipe
 * schema.
 *
 * ── WHAT IS CLEARED, AND WHAT IS NOT ────────────────────────────────────────────────────────────────
 * `DELETE FROM food` and the eight tables that cascade off it. The two dictionaries — `nutrient` and
 * `food_category` — are deliberately LEFT: they hold no per-food data, they are keyed by natural keys the
 * reseed finds-or-creates, and emptying them would only force the next import to re-mint identical rows.
 * `source_call_log` (a rolling rate-limit ledger) and `source_sync_metadata` are operational, not catalog,
 * and no code reads the latter today.
 *
 * ── PATTERNS ────────────────────────────────────────────────────────────────────────────────────────
 * Pure Specification ({@link decideClear}) + pure post-condition ({@link assertCatalogCleared}) + two
 * Ports ({@link RecipeLinkageProbe}, {@link FoodCatalogStore}) with one Adapter each + a Command
 * ({@link runCatalogClear}) that composes them in the one order that is safe to be interrupted. The
 * pure/impure split mirrors `.github/scripts/deploy-gate.sh` (pure `decide`, impure `evaluate`, ADR-0010).
 *
 * Usage (the recipe-side unlink runs FIRST — this will refuse otherwise):
 *
 *   STAGE=sandbox DATABASE_URL=postgres://…/kitchensink_food \
 *   RECIPE_DATABASE_URL=postgres://…/kitchensink_recipes \
 *     npm run catalog:clear --workspace=packages/services/food-service -- --dry-run
 *   … same, then -- --confirm sandbox
 */
import { parseArgs } from 'node:util';

import { getTableName, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type pg from 'pg';

import {
    fetchQueue,
    fetchRequesters,
    food,
    foodCandidates,
    foodCategoryAssignment,
    foodFieldProvenance,
    foodNutrients,
    foodPortions,
    foodSources,
} from '../../db/schema/index.js';
import { decideConfirmation, refuseMisplacedProdFlag } from './operatorIntent.js';
import type { FoodDrizzle } from '../../database/database.module.js';
import {
    CatalogClearIncompleteError,
    CatalogClearRefusedError,
    RecipeLinkageRemainingError,
    RecipeLinkageUnreadableError,
} from './clearCli.errors.js';

/**
 * The stage name that means production. Matches `STAGE === 'prod'` as used by this service's env schema
 * (`config/env.schema.ts`) and by the CDK apps, so there is no second spelling to keep in step.
 */
export { PRODUCTION_STAGE } from './operatorIntent.js';

/**
 * `food` plus every table that hangs off it with `ON DELETE CASCADE`. Enumerated for the runtime
 * post-condition, but NAMED through `getTableName` so a schema rename cannot drift from it — and the
 * membership of this list is itself checked against `pg_constraint` by
 * `tests/catalogClear.integration.test.ts`, so a table added to the schema and not to this list fails
 * there rather than being silently left behind.
 */
export const CASCADING_CATALOG_TABLES: readonly PgTable[] = [
    food,
    foodSources,
    foodNutrients,
    foodPortions,
    foodFieldProvenance,
    foodCandidates,
    foodCategoryAssignment,
    fetchQueue,
    fetchRequesters,
];

/** The recipe-side columns the linkage probe reads. Absent → the probe fails closed. */
const REQUIRED_LINK_COLUMNS = ['food_id', 'food_resolution_status'] as const;

/** The validated CLI options for one clear run. */
export interface ClearCliOptions {
    /** The deploy stage whose food database this process is pointed at. */
    readonly stage: string;
    /** The stage name the operator typed back, or `undefined` when they typed none. */
    readonly confirm: string | undefined;
    /** Whether the operator explicitly accepted a production run. */
    readonly allowProd: boolean;
    /** Whether to report counts and write nothing. */
    readonly dryRun: boolean;
    /** Connection string for the RECIPE database, whose linkage count is this run's precondition. */
    readonly recipeDatabaseUrl: string;
}

/** Why the destructive-operation guard declined. */
export type ClearRefusalReason =
    'confirmation-missing' | 'confirmation-mismatch' | 'production-requires-flag' | 'production-flag-off-production';

/** What the guard decided: refuse outright, report only, or clear. */
export type ClearDecision =
    | { readonly kind: 'refused'; readonly reason: ClearRefusalReason }
    | { readonly kind: 'report' }
    | { readonly kind: 'clear' };

/** Table name → rows still present after the delete. Only non-empty tables appear. */
export type CatalogResidual = Readonly<Record<string, number>>;

/** The read-only window onto the recipe service's database that makes the ordering enforceable. */
export interface RecipeLinkageProbe {
    /** @returns recipe ingredient rows still referencing the food catalog. */
    countLinkedIngredients(): Promise<number>;
}

/** The food-side data-access surface the command needs. */
export interface FoodCatalogStore {
    /** @returns how many golden records the catalog holds. */
    countFoods(): Promise<number>;
    /** Delete every food (and everything cascading off it) in ONE transaction. @returns rows deleted. */
    deleteAllFoods(): Promise<number>;
}

/** The command's two ports. */
export interface CatalogClearDeps {
    /** The recipe-side linkage probe. */
    readonly linkage: RecipeLinkageProbe;
    /** The food-side catalog store. */
    readonly catalog: FoodCatalogStore;
}

/** What one clear run did. */
export interface CatalogClearResult {
    /** `reported` for a dry run, `cleared` for a run that deleted. */
    readonly outcome: 'reported' | 'cleared';
    /** The stage the run was configured for. */
    readonly stage: string;
    /** Recipe ingredient rows still referencing the catalog. */
    readonly remainingLinkedIngredients: number;
    /** Golden records before the run. */
    readonly foodsBefore: number;
    /** Golden records deleted (always `0` for a dry run). */
    readonly foodsDeleted: number;
    /** Whether a destructive run would be permitted right now — a dry run's headline answer. */
    readonly wouldProceed: boolean;
}

/**
 * Parse + validate the CLI options, strictly and up front.
 *
 * `--stage` falls back to `STAGE` but has NO default: a destructive task that guesses which stage it is on
 * has no guard at all. `--recipe-database-url` is required even for a dry run — the whole point of the dry
 * run is to answer "would the clear be permitted?", which is a question about the recipe database.
 *
 * @param argv - The process arguments (excluding `node` and the script path).
 * @returns The validated options.
 * @throws {Error} when no stage or no recipe database is supplied, or the stage is blank.
 */
export function parseClearArgs(argv: readonly string[]): ClearCliOptions {
    const { values } = parseArgs({
        args: [...argv],
        options: {
            stage: { type: 'string' },
            confirm: { type: 'string' },
            'allow-prod': { type: 'boolean', default: false },
            'dry-run': { type: 'boolean', default: false },
            'recipe-database-url': { type: 'string' },
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

    const recipeDatabaseUrl = (values['recipe-database-url'] ?? process.env['RECIPE_DATABASE_URL'] ?? '').trim();

    if (!recipeDatabaseUrl) {
        throw new Error(
            'Missing --recipe-database-url (or RECIPE_DATABASE_URL): this task must read the recipe database to ' +
                'confirm the recipe-side unlink has already run. It is required for a dry run too — "would the ' +
                'clear be permitted?" is a question about that database.',
        );
    }

    return {
        stage,
        confirm: values.confirm,
        allowProd: values['allow-prod'],
        dryRun: values['dry-run'],
        recipeDatabaseUrl,
    };
}

/**
 * The destructive-operation guard, as a pure function of the options (R45).
 *
 * Three mechanisms, in this order:
 *
 *  1. `--allow-prod` on a stage that is NOT production is an ERROR, not a no-op. A flag that is harmless
 *     when wrong becomes a flag operators paste every time, and then it guards nothing.
 *  2. A dry run needs no confirmation — it writes nothing, and refusing to let an operator LOOK is how
 *     they end up running the destructive form to find out.
 *  3. A run that deletes must name the stage back (`--confirm`), and production needs `--allow-prod` on top.
 *
 * @param options - The validated CLI options.
 * @returns The decision.
 */
export function decideClear(options: ClearCliOptions): ClearDecision {
    const misplacedFlag = refuseMisplacedProdFlag(options);

    if (misplacedFlag !== undefined) {
        return { kind: 'refused', reason: misplacedFlag };
    }

    const confirmation = decideConfirmation(options);

    if (confirmation === 'report') {
        return { kind: 'report' };
    }

    return confirmation === 'proceed' ? { kind: 'clear' } : { kind: 'refused', reason: confirmation };
}

/**
 * The clear's post-condition: every catalog table came away with the food rows. Called INSIDE the
 * transaction, so a residue rolls back rather than committing a half-cleared catalog.
 *
 * @param residual - Table name → rows counted after the delete.
 * @throws {CatalogClearIncompleteError} when any table still holds rows.
 */
export function assertCatalogCleared(residual: CatalogResidual): void {
    const remaining = Object.fromEntries(Object.entries(residual).filter(([, rows]) => rows !== 0));

    if (Object.keys(remaining).length > 0) {
        throw new CatalogClearIncompleteError(remaining);
    }
}

/**
 * Run one clear: decide, ask the recipe database whether the unlink has finished, then (unless this is a
 * dry run, and unless links remain) delete the catalog.
 *
 * ⛔ The probe is the FIRST thing that happens after the guard, on every path, and a non-zero count aborts
 * before `countFoods` — let alone before a delete. Do not reorder these awaits.
 *
 * @param deps - The linkage probe and the catalog store.
 * @param options - The validated CLI options.
 * @returns What the run did.
 * @throws {CatalogClearRefusedError} when the guard declines — before either database is touched.
 * @throws {RecipeLinkageRemainingError} when the recipe side is not yet unlinked.
 * @throws {RecipeLinkageUnreadableError} when the probe cannot answer — it fails closed.
 * @sideEffect Reads the recipe database, and reads and (unless `dryRun`) deletes from the food database.
 */
export async function runCatalogClear(deps: CatalogClearDeps, options: ClearCliOptions): Promise<CatalogClearResult> {
    const decision = decideClear(options);

    if (decision.kind === 'refused') {
        throw new CatalogClearRefusedError(decision.reason, options.stage);
    }

    // ⛔ ORDER — the recipe side's proof, before anything else touches the food catalog.
    const remainingLinkedIngredients = await deps.linkage.countLinkedIngredients();

    if (decision.kind === 'report') {
        return {
            outcome: 'reported',
            stage: options.stage,
            remainingLinkedIngredients,
            foodsBefore: await deps.catalog.countFoods(),
            foodsDeleted: 0,
            wouldProceed: remainingLinkedIngredients === 0,
        };
    }

    if (remainingLinkedIngredients > 0) {
        throw new RecipeLinkageRemainingError(remainingLinkedIngredients);
    }

    const foodsBefore = await deps.catalog.countFoods();
    const foodsDeleted = await deps.catalog.deleteAllFoods();

    return {
        outcome: 'cleared',
        stage: options.stage,
        remainingLinkedIngredients,
        foodsBefore,
        foodsDeleted,
        wouldProceed: true,
    };
}

/** Which server and database a connection actually reached. */
export interface DatabaseTarget {
    /** The server's address as the server itself reports it, or `local` for a unix-socket connection. */
    readonly host: string;
    /** The server's port. */
    readonly port: number;
    /** The database this connection is attached to. */
    readonly database: string;
    /** The role the connection authenticated as. */
    readonly user: string;
}

/**
 * Ask the SERVER where it is, rather than restating the connection string.
 *
 * ⛔ This is the honest limit of the guard above, made visible. `--stage`/`STAGE` is a DECLARATION by the
 * operator; nothing binds it to the database this process actually opened, and the per-stage logical
 * database name is `kitchensink_food` on BOTH prod and sandbox (only `pr-{N}` stages get a suffix), so no
 * automatic check can tell those two apart. What CAN be done is put the real target in front of the
 * operator before anything is deleted — which is what makes `--dry-run` a check rather than a formality.
 *
 * @param pool - The pool to interrogate.
 * @returns Where that pool actually landed.
 * @sideEffect One read query.
 */
export async function describeDatabaseTarget(pool: pg.Pool): Promise<DatabaseTarget> {
    const { rows } = await pool.query<{ host: string | null; port: number; database: string; user: string }>(
        `SELECT inet_server_addr()::text AS host, inet_server_port() AS port,
                current_database() AS database, current_user AS user`,
    );
    const row = rows[0];

    if (!row) {
        throw new Error('Could not determine which database this connection reached.');
    }

    // `inet_server_addr()` is NULL over a unix socket — the connection is local by construction.
    return { host: row.host ?? 'local', port: row.port, database: row.database, user: row.user };
}

/**
 * The `pg` adapter for {@link RecipeLinkageProbe} — the ONLY place this service reads the recipe schema.
 *
 * Runs inside `BEGIN TRANSACTION READ ONLY`, so the session physically cannot write to the recipe database
 * regardless of what the supplied role is granted. Asserts the columns exist BEFORE counting, because a
 * probe pointed at the wrong database would otherwise answer "no rows" and read as permission to delete
 * the entire catalog.
 *
 * @param pool - A pool over the recipe service's database (the operator supplies the connection string).
 * @returns The probe port.
 * @sideEffect Opens a read-only transaction on the recipe database.
 */
export function createRecipeLinkageProbe(pool: pg.Pool): RecipeLinkageProbe {
    return {
        countLinkedIngredients: async (): Promise<number> => {
            const client = await pool.connect();

            try {
                await client.query('BEGIN TRANSACTION READ ONLY');

                const columns = await client.query<{ column_name: string }>(
                    `SELECT column_name FROM information_schema.columns
                      WHERE table_name = 'ingredients'
                        AND table_schema = ANY (current_schemas(false))
                        AND column_name = ANY ($1::text[])`,
                    [[...REQUIRED_LINK_COLUMNS]],
                );
                const found = new Set(columns.rows.map((row) => row.column_name));
                const missing = REQUIRED_LINK_COLUMNS.filter((column) => !found.has(column));

                if (missing.length > 0) {
                    throw new RecipeLinkageUnreadableError(
                        `the database has no ${missing.map((column) => `ingredients.${column}`).join(' and no ')}`,
                    );
                }

                const linked = await client.query<{ n: number }>(
                    `SELECT count(*)::int AS n FROM ingredients
                      WHERE food_id IS NOT NULL OR food_resolution_status IS NOT NULL`,
                );

                await client.query('COMMIT');

                return linked.rows[0]?.n ?? 0;
            } catch (error: unknown) {
                await client.query('ROLLBACK').catch(() => undefined);

                throw error;
            } finally {
                client.release();
            }
        },
    };
}

/**
 * The Drizzle adapter for {@link FoodCatalogStore}.
 *
 * `deleteAllFoods` runs as ONE transaction: delete, re-count every cascading table, assert. The assertion
 * is inside the transaction on purpose — a residue rolls the delete back instead of leaving the catalog
 * half-cleared.
 *
 * @param db - The schema-typed Drizzle client for the food database.
 * @returns The store port.
 */
export function createFoodCatalogStore(db: FoodDrizzle): FoodCatalogStore {
    const countRows = async (reader: Pick<FoodDrizzle, 'select'>, table: PgTable): Promise<number> => {
        const [row] = await reader.select({ count: sql<number>`count(*)::int` }).from(table);

        return row?.count ?? 0;
    };

    return {
        countFoods: async (): Promise<number> => countRows(db, food),
        deleteAllFoods: async (): Promise<number> =>
            db.transaction(async (tx) => {
                // `rowCount`, not `.returning()`: the catalog is ~8k rows and nothing here needs their ids.
                const deleted = await tx.delete(food);
                const residual: Record<string, number> = {};

                for (const table of CASCADING_CATALOG_TABLES) {
                    residual[getTableName(table)] = await countRows(tx, table);
                }

                assertCatalogCleared(residual);

                return deleted.rowCount ?? 0;
            }),
    };
}
