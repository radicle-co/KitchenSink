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
 * buys less than it costs. Change one, read both.
 *
 * ⛔ THE "IT FAILS SAFE" ARGUMENT IS GONE, and do not restore it. It used to read: the reset is ordered so
 * the food-side clear aborts when this unlink refused, so a guard relaxed on one side alone cannot open a
 * path. That holds for the CONFIRMATION chain — the clear's linkage probe re-derives this command's outcome
 * — and it is FALSE for the target binding below, which is now the larger half of the duplicated surface:
 * the two commands judge DIFFERENT connections, and the clear never re-derives which database this one was
 * pointed at. What replaces it is a GUARD — `operatorTargetCidrParity.test.ts` in `packages/infra/global`
 * asserts both services' constants against the CDK's own CIDR table, in both directions.
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
    /**
     * The database the operator typed back, as `database@host:port` — the token a `--dry-run` prints.
     *
     * ⛔ Required for a run that WRITES. `--stage` and `--confirm` are BOTH the operator's own words, checked
     * against each other; this is the only field checked against the server this process actually reached.
     */
    readonly confirmTarget?: string | undefined;
}

/** Why the destructive-operation guard declined. */
export type UnlinkRefusalReason =
    | 'confirmation-missing'
    | 'confirmation-mismatch'
    | 'production-requires-flag'
    | 'production-flag-off-production'
    | 'target-confirmation-missing'
    | 'target-mismatch'
    | 'stage-database-mismatch'
    | 'stage-environment-mismatch';

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
    /** @returns where this connection actually landed, as the SERVER reports it. */
    describeTarget(): Promise<DatabaseTarget>;
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
    /** The database this run actually reached, as `database@host:port` — a dry run prints it to be pasted. */
    readonly target: string;
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
            'confirm-target': { type: 'string' },
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
        confirmTarget: values['confirm-target'],
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

/** A per-PR logical database, and the `pr-{N}` stage its name is derived from (ADR-0006). */
const PER_PR_DATABASE = /_pr_(?<number>[0-9]+)$/u;

/** A per-PR stage: `pr-{N}`. */
const PER_PR_STAGE = /^pr-(?<number>[0-9]+)$/u;

/**
 * ⛔ WHICH SIDE OF THE PRODUCTION BOUNDARY AN ADDRESS IS ON. ADR-0002 assigns disjoint VPC CIDRs per stage —
 * prod `10.0.0.0/16`, sandbox `10.1.0.0/16`, anything else `10.2.0.0/16` — so the SERVER's own address says
 * which environment a connection reached, whatever the operator declared. It is the only fact available here
 * that can, because prod and sandbox share the logical database name `kitchensink_recipes`.
 *
 * ⚠️ A real coupling to ADR-0002, pinned against `cidrForStage` itself by `operatorTargetCidrParity.test.ts`
 * in `packages/infra/global`, which asserts BOTH services' constants against the CDK's own table.
 */
const PRODUCTION_VPC_PREFIX = '10.0.';

/** The other ranges the same scheme assigns. An address in neither is not ours to judge. */
const NON_PRODUCTION_VPC_PREFIXES = ['10.1.', '10.2.'] as const;

/**
 * The exact string an operator must type back to name the database this process actually opened.
 *
 * ⚠️ A DELIBERATE COPY of food-service's `operatorIntent.ts` — see this module's header for why the two
 * services do not share this policy, and for why the "the drift fails safe" half of that argument does NOT
 * cover this surface. `operatorTargetCidrParity.test.ts` is what covers it instead. Change one, read both.
 *
 * @param target - Where the connection landed.
 * @returns The token to print and to require. Pure.
 */
export function describeTargetToken(target: DatabaseTarget): string {
    return `${target.database}@${target.host}:${target.port}`;
}

/**
 * ⛔ BIND THE OPERATOR'S DECLARATION TO THE DATABASE THE PROCESS ACTUALLY OPENED (PR #91 review).
 *
 * `--stage` and `--confirm` are BOTH the operator's own words, checked against each other — so
 * `--stage prod --allow-prod --confirm prod` was accepted with `DATABASE_URL` pointed at sandbox, and this
 * command then nulled the food links of whichever database the URL had really opened. `describeDatabaseTarget`
 * PRINTED the real target and this module's own docstring called that "the honest limit of {@link decideUnlink},
 * made visible" — a printed target is a courtesy, not a check, and nothing consumed it.
 *
 * Three mechanisms, in this order:
 *
 *  1. **The stage and the database must be able to be true together** — a `pr-{N}` stage belongs on a
 *     `{base}_pr_{N}` database and a named stage does not belong on a per-PR one. No typing, so it guards a
 *     DRY RUN too: reporting on a run that could never be permitted is a lie of its own.
 *  2. **The declared stage must be on the same side of the production boundary as the server**, decided from
 *     ADR-0002's per-stage CIDRs. This is what actually protects production: every other production
 *     protection keys off the stage the operator DECLARED, so declaring `sandbox` switches them all off, and
 *     a `--confirm-target` cannot help because it is pasted from a dry run that read the same wrong
 *     connection. Both directions are refused — both are somebody writing to a database they do not think
 *     they are writing to. It needs no typing, so it guards a dry run too.
 *  3. **A run that WRITES must name the target the server reported.** What this adds over 1 and 2 is what
 *     neither can see: the WRONG SANDBOX, a stale tunnel, another account's instance — the right environment
 *     but not the intended machine. A dry run is never asked to type it.
 *
 * ⚠️ The host is discriminating because of ADR-0002's per-stage VPC CIDRs (prod `10.0.x.x`, sandbox
 * `10.1.x.x`), not by luck — collapsing those ranges would weaken this guard. And `inet_server_addr()` is a
 * private IP, so an RDS failover between the dry run and the write invalidates the token: that fails CLOSED,
 * which is the correct direction. Food-service's `operatorIntent.ts` carries the same note.
 *
 * @param options - The validated CLI options.
 * @param target - Where the connection landed, as the server reports it.
 * @returns The refusal, or `undefined` when the declaration is bound to the target. Pure.
 */
export function refuseUnboundTarget(
    options: UnlinkCliOptions,
    target: DatabaseTarget,
): UnlinkRefusalReason | undefined {
    const stageNumber = PER_PR_STAGE.exec(options.stage)?.groups?.['number'];
    const databaseNumber = PER_PR_DATABASE.exec(target.database)?.groups?.['number'];

    if (stageNumber !== databaseNumber) {
        return 'stage-database-mismatch';
    }

    const reachedProduction = target.host.startsWith(PRODUCTION_VPC_PREFIX);
    const reachedKnownEnvironment =
        reachedProduction || NON_PRODUCTION_VPC_PREFIXES.some((prefix) => target.host.startsWith(prefix));

    // No opinion outside the CIDR scheme: a laptop, a docker bridge or a CI container is not addressed by
    // ADR-0002, and refusing there would break every local run of this task while closing nothing.
    if (reachedKnownEnvironment && (options.stage === PRODUCTION_STAGE) !== reachedProduction) {
        return 'stage-environment-mismatch';
    }

    if (options.dryRun) {
        return undefined;
    }

    if (options.confirmTarget === undefined) {
        return 'target-confirmation-missing';
    }

    return options.confirmTarget.trim() === describeTargetToken(target) ? undefined : 'target-mismatch';
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

    // ⛔ BIND THE DECLARATION TO THE REAL DATABASE, before a single row is read. The descriptor comes from the
    // server itself, so this is the first point at which the run's stage claim is checked against anything but
    // itself. A dry run reaches here too: it must refuse an impossible stage/database pairing, and it must
    // report the token the destructive run will have to name.
    const liveTarget = await store.describeTarget();
    const unbound = refuseUnboundTarget(options, liveTarget);

    if (unbound !== undefined) {
        throw new UnlinkRefusedError(unbound, options.stage, describeTargetToken(liveTarget));
    }

    const target = describeTargetToken(liveTarget);
    const linkedBefore = await store.countLinked();
    const recipeIngredientLines = await store.countRecipeIngredientLines();

    if (decision.kind === 'report') {
        return {
            outcome: 'reported',
            stage: options.stage,
            linkedBefore,
            unlinked: 0,
            recipeIngredientLines,
            target,
        };
    }

    const facts = await store.unlinkAll();

    assertUnlinkComplete(facts);

    return {
        outcome: 'unlinked',
        stage: options.stage,
        linkedBefore,
        unlinked: facts.unlinked,
        recipeIngredientLines: facts.linesAfter,
        target,
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
 * ⚠️ CORRECTED. This used to say `--stage` is a declaration that "nothing binds ... to the database this
 * process actually opened", and called putting the target in front of the operator the honest limit of the
 * guard. That WAS true and is no longer: {@link refuseUnboundTarget} consumes this descriptor and refuses on
 * it, so what it returns is a guard's input rather than a courtesy. Do not restore the old sentence — it is
 * exactly what a future reader would use to conclude that nothing checks the target.
 *
 * @param pool - The pool to interrogate.
 * @returns Where that pool actually landed.
 * @sideEffect One read query.
 */
export async function describeDatabaseTarget(pool: pg.Pool): Promise<DatabaseTarget> {
    const { rows } = await pool.query<{ host: string | null; port: number; database: string; user: string }>(
        `SELECT host(inet_server_addr()) AS host, inet_server_port() AS port,
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
 * @param pool - The same connection, for the target descriptor the binding guard reads.
 * @returns The store port.
 */
export function createIngredientLinkStore(db: RecipeDrizzle, pool: pg.Pool): IngredientLinkStore {
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
        // ⚠️ ONE reader for "where am I?", asked through the POOL. This adapter briefly carried a SECOND,
        // inline copy of the same statement so it could keep a single Drizzle parameter — which is the
        // duplication the food-side half of this same change removed, and a second spelling of the question
        // is a second answer free to disagree with the one the guard judged.
        describeTarget: async (): Promise<DatabaseTarget> => describeDatabaseTarget(pool),
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
