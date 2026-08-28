/**
 * U12a, HALF ONE — the recipe-side UNLINK. Runs FIRST in the two-service catalog reset; the food-side
 * clear (`packages/services/food-service/src/foods/seed/clearCli.ts`) refuses to delete a single row until
 * this has finished. Plan: `docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md` §U12,
 * Sequencing step 4; requirements R44–R46.
 *
 * ── ⛔ WHY THIS RUNS FIRST, AND WHY THE ORDER IS THE UNIT ────────────────────────────────────────────
 * Reseeding the food catalog mints FRESH ULIDs, and `ingredients.food_id` is an opaque cross-service
 * reference with **no foreign key** — nothing in either database can catch a dangling one. Clear the food
 * catalog first and every recipe carries a `food_id` pointing at a deleted row for the whole length of the
 * window, silently. So the reference is dropped before the referent is.
 *
 * This mirrors the discipline the repository already applies to its other two-system destructive
 * operation: `packages/apps/commise/web/scripts/teardownPreviewDomain.ts` deletes DNS *before* releasing
 * the Vercel claim while `createPreviewDomain.ts` takes the claim *before* publishing DNS — "either
 * reversal manufactures the subdomain-takeover window", and a failure in the first step aborts before the
 * second (ADR-0001, "Teardown of the preview address"; ADR-0005). Same shape here: the two halves are
 * ordered mirrors, and this one's exit code is the other one's precondition.
 *
 * ── WHY IT NULLS IN PLACE AND DELETES NOTHING ───────────────────────────────────────────────────────
 * `recipe_ingredients.ingredient_id` is `NOT NULL REFERENCES ingredients(id)` with no `ON DELETE`, so
 * deleting catalog rows raises a foreign-key violation — and forcing it through would take user recipes
 * with it. `food_id` and `food_resolution_status` are nulled on the rows that carry them; every
 * `ingredients` row and every `recipe_ingredients` line survives, which the run PROVES rather than assumes
 * (see {@link assertUnlinkComplete}).
 *
 * `food_resolution_status` goes with `food_id` because it is a verdict ABOUT a catalog that is about to
 * cease to exist: a surviving `RESOLVED` would name nothing, and a surviving `NOT_FOUND` would assert an
 * absence from a catalog that had not been reseeded yet.
 *
 * ── PATTERNS ────────────────────────────────────────────────────────────────────────────────────────
 * Pure Specification ({@link decideUnlink}) + pure post-condition ({@link assertUnlinkComplete}) + a Port
 * ({@link IngredientLinkStore}) with one Drizzle Adapter ({@link createIngredientLinkStore}) + a Command
 * ({@link runIngredientUnlink}) composing them. The pure/impure split is the shape
 * `.github/scripts/deploy-gate.sh` uses (pure `decide`, impure `evaluate`, ADR-0010), and it is what lets
 * every guard branch be proved without a database.
 *
 * Usage (see `README` note in the plan; the food-side clear follows, never precedes):
 *
 *   STAGE=sandbox DATABASE_URL=postgres://… \
 *     npm run ingredients:unlink --workspace=@kitchensink/recipe-service -- --dry-run
 *   STAGE=sandbox DATABASE_URL=postgres://… \
 *     npm run ingredients:unlink --workspace=@kitchensink/recipe-service -- --confirm sandbox
 */
import { parseArgs } from 'node:util';

import { isNotNull, or, sql } from 'drizzle-orm';
import type pg from 'pg';

import type { RecipeDrizzle } from '../database/client.js';
import { withTransaction } from '../database/unitOfWork.js';
import { ingredients, recipeIngredients } from '../database/schema/index.js';
import { IngredientUnlinkIncompleteError, UnlinkRefusedError } from './unlinkCli.errors.js';

/**
 * ⚠️ This guard is a THIRD copy of one policy, and the duplication is deliberate. food-service extracted
 * its two copies into `foods/seed/operatorIntent.ts` when the third appeared; this one stays separate
 * because sharing across the service boundary needs a home neither service owns (`recipe-core` is the
 * recipe domain's types, and an operator-CLI policy does not belong in it), and a package for ~20 lines
 * buys less than it costs. The drift also fails SAFE: the reset is ordered so the food-side clear aborts
 * when this unlink refused, so a guard relaxed on one side alone cannot open a path. Change one, read both.
 *
 * The stage name that means production. Matches `STAGE === 'prod'` as used by both services' env schemas
 * (`config/env.schema.ts`) and by the CDK apps, so there is no second spelling to keep in step.
 */
export const PRODUCTION_STAGE = 'prod';

/** The validated CLI options for one unlink run. */
export interface UnlinkCliOptions {
    /** The deploy stage whose recipe database this process is pointed at. */
    readonly stage: string;
    /** The stage name the operator typed back, or `undefined` when they typed none. */
    readonly confirm: string | undefined;
    /** Whether the operator explicitly accepted a production run. */
    readonly allowProd: boolean;
    /** Whether to report counts and write nothing. */
    readonly dryRun: boolean;
}

/** Why the destructive-operation guard declined. */
export type UnlinkRefusalReason =
    'confirmation-missing' | 'confirmation-mismatch' | 'production-requires-flag' | 'production-flag-off-production';

/** What the guard decided: refuse outright, report only, or unlink. */
export type UnlinkDecision =
    | { readonly kind: 'refused'; readonly reason: UnlinkRefusalReason }
    | { readonly kind: 'report' }
    | { readonly kind: 'unlink' };

/** The counts one unlink transaction observed about itself. */
export interface UnlinkFacts {
    /** Rows whose `food_id`/`food_resolution_status` were nulled. */
    readonly unlinked: number;
    /** Rows STILL carrying a link once the update had run — must be zero. */
    readonly remainingLinked: number;
    /** `recipe_ingredients` lines before the update. */
    readonly linesBefore: number;
    /** `recipe_ingredients` lines after it — must equal `linesBefore`. */
    readonly linesAfter: number;
}

/** The data-access surface the command needs; one Drizzle adapter implements it. */
export interface IngredientLinkStore {
    /** @returns catalog rows still carrying a `food_id` or a `food_resolution_status`. */
    countLinked(): Promise<number>;
    /** @returns the number of `recipe_ingredients` lines — the row set the unlink must not disturb. */
    countRecipeIngredientLines(): Promise<number>;
    /** Null the links in ONE transaction and report what it observed about itself. */
    unlinkAll(): Promise<UnlinkFacts>;
}

/** What one unlink run did. */
export interface UnlinkResult {
    /** `reported` for a dry run, `unlinked` for a run that wrote. */
    readonly outcome: 'reported' | 'unlinked';
    /** The stage the run was configured for. */
    readonly stage: string;
    /** Rows carrying a link before the run. */
    readonly linkedBefore: number;
    /** Rows actually nulled (always `0` for a dry run). */
    readonly unlinked: number;
    /** `recipe_ingredients` lines — reported so the operator can see the number did not move. */
    readonly recipeIngredientLines: number;
}

/**
 * Parse + validate the CLI options, strictly and up front.
 *
 * `--stage` falls back to `STAGE` but has NO default: a destructive task that guesses which stage it is on
 * has no guard at all, so an unnamed stage is an error rather than `dev`.
 *
 * @param argv - The process arguments (excluding `node` and the script path).
 * @returns The validated options.
 * @throws {Error} when no stage is supplied, or the supplied one is blank.
 */
export function parseUnlinkArgs(argv: readonly string[]): UnlinkCliOptions {
    const { values } = parseArgs({
        args: [...argv],
        options: {
            stage: { type: 'string' },
            confirm: { type: 'string' },
            'allow-prod': { type: 'boolean', default: false },
            'dry-run': { type: 'boolean', default: false },
        },
        allowPositionals: false,
    });

    const stage = (values.stage ?? process.env['STAGE'] ?? '').trim();

    if (!stage) {
        throw new Error(
            'Missing --stage (or STAGE): name the deploy stage whose recipe database this run is pointed at. ' +
                'There is deliberately no default — an unnamed stage is the hazard this task guards against.',
        );
    }

    return {
        stage,
        confirm: values.confirm,
        allowProd: values['allow-prod'],
        dryRun: values['dry-run'],
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
 *  3. A run that writes must name the stage back (`--confirm`), and production needs `--allow-prod` on top.
 *
 * @param options - The validated CLI options.
 * @returns The decision.
 */
export function decideUnlink(options: UnlinkCliOptions): UnlinkDecision {
    const isProduction = options.stage === PRODUCTION_STAGE;

    if (options.allowProd && !isProduction) {
        return { kind: 'refused', reason: 'production-flag-off-production' };
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

    return { kind: 'unlink' };
}

/**
 * The unlink's post-condition — the guarantee, not a log line. Called INSIDE the transaction (so a
 * violation rolls back) and again by the command (so the contract holds whatever adapter is supplied).
 *
 * @param facts - What the transaction observed about itself.
 * @throws {IngredientUnlinkIncompleteError} when a link survived, or the `recipe_ingredients` line count moved.
 */
export function assertUnlinkComplete(facts: UnlinkFacts): void {
    if (facts.remainingLinked !== 0) {
        throw new IngredientUnlinkIncompleteError(
            `${facts.remainingLinked} ingredient row(s) still carry a food link after the update; ` +
                'the food-side clear must not run against this state',
            facts,
        );
    }

    if (facts.linesAfter !== facts.linesBefore) {
        throw new IngredientUnlinkIncompleteError(
            `the recipe_ingredients line count moved from ${facts.linesBefore} to ${facts.linesAfter}; ` +
                'this task must not add or remove a line, and a change means something else was writing',
            facts,
        );
    }
}

/**
 * Run one unlink: decide, read the counts, then (unless this is a dry run) null the links and prove it.
 *
 * @param store - The data-access port.
 * @param options - The validated CLI options.
 * @returns What the run did.
 * @throws {UnlinkRefusedError} when the guard declines — before the database is touched at all.
 * @throws {IngredientUnlinkIncompleteError} when the post-conditions do not hold.
 * @sideEffect Reads and (unless `dryRun`) writes the recipe database.
 */
export async function runIngredientUnlink(
    store: IngredientLinkStore,
    options: UnlinkCliOptions,
): Promise<UnlinkResult> {
    const decision = decideUnlink(options);

    if (decision.kind === 'refused') {
        throw new UnlinkRefusedError(decision.reason, options.stage);
    }

    const linkedBefore = await store.countLinked();
    const recipeIngredientLines = await store.countRecipeIngredientLines();

    if (decision.kind === 'report') {
        return { outcome: 'reported', stage: options.stage, linkedBefore, unlinked: 0, recipeIngredientLines };
    }

    const facts = await store.unlinkAll();

    assertUnlinkComplete(facts);

    return {
        outcome: 'unlinked',
        stage: options.stage,
        linkedBefore,
        unlinked: facts.unlinked,
        recipeIngredientLines: facts.linesAfter,
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
 * ⛔ This is the honest limit of {@link decideUnlink}, made visible. `--stage`/`STAGE` is a DECLARATION by
 * the operator; nothing binds it to the database this process actually opened. What CAN be done is put the
 * real target in front of the operator before anything is written — which is what makes `--dry-run` a check
 * rather than a formality.
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

/** The predicate for "this catalog row still points at the food service" — one authority, used four times. */
const LINKED = or(isNotNull(ingredients.foodId), isNotNull(ingredients.foodResolutionStatus));

/**
 * The Drizzle adapter for {@link IngredientLinkStore}.
 *
 * `unlinkAll` runs as ONE transaction: count, update, re-count, and assert. The assertion is inside the
 * transaction on purpose — a surviving link or a moved line count rolls the whole thing back instead of
 * committing a half-done reset and reporting success.
 *
 * `ingredients.search_vector` is NOT recomputed here, and that is correct: it is derived from `name`
 * (`to_tsvector('english', name)`, maintained by `IngredientsDal` — there is no trigger on this table) and
 * this task does not touch `name`.
 *
 * @param db - The schema-typed Drizzle client.
 * @returns The store port.
 */
export function createIngredientLinkStore(db: RecipeDrizzle): IngredientLinkStore {
    const countLinkedWith = async (reader: Pick<RecipeDrizzle, 'select'>): Promise<number> => {
        const [row] = await reader
            .select({ count: sql<number>`count(*)::int` })
            .from(ingredients)
            .where(LINKED);

        return row?.count ?? 0;
    };

    const countLinesWith = async (reader: Pick<RecipeDrizzle, 'select'>): Promise<number> => {
        const [row] = await reader.select({ count: sql<number>`count(*)::int` }).from(recipeIngredients);

        return row?.count ?? 0;
    };

    return {
        countLinked: async (): Promise<number> => countLinkedWith(db),
        countRecipeIngredientLines: async (): Promise<number> => countLinesWith(db),
        unlinkAll: async (): Promise<UnlinkFacts> =>
            withTransaction(db, async (tx) => {
                const linesBefore = await countLinesWith(tx);
                // `rowCount`, not `.returning()`: nothing here needs the ids of the rows it unlinked.
                const updated = await tx
                    .update(ingredients)
                    .set({ foodId: null, foodResolutionStatus: null })
                    .where(LINKED);
                const facts: UnlinkFacts = {
                    unlinked: updated.rowCount ?? 0,
                    remainingLinked: await countLinkedWith(tx),
                    linesBefore,
                    linesAfter: await countLinesWith(tx),
                };

                assertUnlinkComplete(facts);

                return facts;
            }),
    };
}
