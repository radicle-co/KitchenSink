/**
 * The REVOCATION DRAIN (plan U3, R14) — the scheduled worker that re-verifies what a revoked band skipped.
 *
 * ⛔ Revocation itself only flips a band's state (`bandPolicy.ts` → `BandAuthorityStore`); it enqueues
 * NOTHING. The skips table is the backlog: each row stores the READY `VerifyIngredientLineMessage` the
 * producer built at skip time, so this drain sends verbatim and never rebuilds a message — the DRY line
 * ADR-0026 draws around message construction, held here too.
 *
 * ⛔ WHY BATCHES ARE SIZED AGAINST HEADROOM, not a fixed rate: a staple band's epoch can be thousands of
 * binds, and every drained message costs one gate reservation. A bulk enqueue would burn ADR-0024's
 * shared $100 pool in one tick and drain the rest to the DLQ — losing the re-verifications revocation
 * exists to perform. So each tick claims at most {@link DRAIN_HEADROOM_FRACTION} of the REMAINING period
 * headroom (leaving the rest for live traffic), and an exhausted ceiling yields a budget of zero: the
 * drain PAUSES and the backlog simply waits for the next period. Nothing is lost — undrained rows are
 * re-read every tick.
 *
 * ⚠️ Send-then-mark, per skip: a crash between the two redelivers (re-sends) that one message, and the
 * gate's content-keyed verdict store makes the duplicate a cheap no-op upsert — the safe direction. The
 * reverse order would mark a message drained that was never sent, silently losing a re-verification.
 */
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { BandAuthorityStore } from '@kitchensink/recipe-core/resolution/band-authority-store';
import { planReservation } from '@kitchensink/recipe-core/spend/spend-arithmetic';
import { PENDING_VERIFICATION_MAX_AGE_HOURS } from '@kitchensink/recipe-core/resolution/verification-gate-policy';

import { requireEnv } from '../common/config.js';
import { getRecipePool } from '../common/db.js';
import { logger } from '../common/logger.js';
import { isSpendGated } from '../common/verificationSpend.js';
import { expireParseJobs } from '../parsing/parseJobExpiry.js';
import {
    createSsmSettingsLoader,
    createVerificationSettings,
    type VerificationSettingsResolver,
} from '../verification/settings.js';
import {
    VERIFICATION_INPUT_TOKEN_CEILING,
    VERIFICATION_MAX_OUTPUT_TOKENS,
} from '@kitchensink/recipe-core/resolution/verification-prompt';

/** The flat per-tick cap, binding when headroom is plentiful (and in ungated stages, where it is all there is). */
export const DRAIN_MAX_BATCH = 50;

/**
 * How much of the REMAINING period headroom one tick may claim. A fraction, not the whole, so the drain
 * can never starve live verification traffic of the pool they share.
 */
export const DRAIN_HEADROOM_FRACTION = 0.25;

/** Everything the drain talks to, injected. */
export interface BandDrainDeps {
    readonly stage: string;
    readonly settings: VerificationSettingsResolver;
    readonly store: Pick<BandAuthorityStore, 'undrainedRevokedSkips' | 'markDrained'>;
    /** The period's `reserved_micros`, read from `verification_spend` (0 when the row is absent). */
    readonly reservedForPeriod: (period: string) => Promise<number>;
    /**
     * Aged verdict-less rows from the pending re-drive substrate (0037, plan U4c), oldest first, up to
     * `limit` — rows past the age bound whose verification key has no verdict and that were not re-driven
     * within the bound already.
     */
    readonly agedRedrives: (limit: number) => Promise<readonly { verificationKey: string; message: unknown }[]>;
    /** Stamp one row's `last_driven_at` after its re-send. */
    readonly markRedriven: (verificationKey: string) => Promise<void>;
    /** Send one stored message to the verification queue, verbatim. */
    readonly send: (message: unknown) => Promise<void>;
    readonly now: () => Date;
}

/**
 * Drain one budget-sized batch of a revoked band's skips back into the verification queue.
 *
 * @param deps - The drain's collaborators.
 * @returns How many were sent, and the budget the tick ran under.
 * @sideEffect Reads the spend counter and the band tables, sends SQS messages, marks skips drained.
 */
export async function drainRevokedBands(deps: BandDrainDeps): Promise<{ sent: number; budget: number }> {
    const settings = await deps.settings.resolve();
    const plan = planReservation({
        modelId: settings.modelId,
        ceilingMicros: settings.ceilingMicros,
        // ⛔ THE CEILING, not a per-call bound: this tick has no prompt in hand — it is sizing a BATCH from
        // the period's remaining headroom — so it must assume the widest prompt the builder would accept.
        maxInputTokens: VERIFICATION_INPUT_TOKEN_CEILING,
        maxOutputTokens: VERIFICATION_MAX_OUTPUT_TOKENS,
        nowUtc: deps.now(),
    });

    if (plan.kind === 'unpriced') {
        // With no rate there is no worst case, so the batch cannot be sized. The gate would refuse these
        // messages anyway — sending them would only convert a paused backlog into DLQ depth.
        logger.warn('band drain skipped: the verification model is not priced', { modelId: plan.modelId });

        return { sent: 0, budget: 0 };
    }

    let budget = DRAIN_MAX_BATCH;

    if (isSpendGated(deps.stage)) {
        const reserved = await deps.reservedForPeriod(plan.period);
        const headroomMicros = settings.ceilingMicros - reserved;
        budget = Math.min(DRAIN_MAX_BATCH, Math.floor((headroomMicros * DRAIN_HEADROOM_FRACTION) / plan.worstMicros));

        if (budget <= 0) {
            logger.info('band drain paused: no spend headroom this period', { period: plan.period });

            return { sent: 0, budget: 0 };
        }
    }

    const skips = await deps.store.undrainedRevokedSkips(budget);
    let sent = 0;

    for (const skip of skips) {
        // Per-skip try/catch, never per-batch: one throttled send must not strand the rest, and a failed
        // skip stays undrained for the next tick — the row-as-truth design is what makes that safe.
        try {
            await deps.send(skip.message);
            await deps.store.markDrained([skip.id]);
            sent += 1;
        } catch (error) {
            logger.error('band drain could not re-send a skipped verification', {
                skipId: skip.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    // KTD-A (plan U4c): the OTHER backlog — withholding lines whose verdicts never landed. Same budget,
    // strictly after the revoked skips (a revocation is a measured judgement that binds were wrong; an aged
    // pending line is merely unchecked), and a tick whose skips consumed the budget re-drives nothing.
    const remaining = budget - skips.length;
    let redriven = 0;

    if (remaining > 0) {
        const redrives = await deps.agedRedrives(remaining);

        for (const redrive of redrives) {
            try {
                await deps.send(redrive.message);
                await deps.markRedriven(redrive.verificationKey);
                sent += 1;
                redriven += 1;
            } catch (error) {
                logger.error('band drain could not re-drive a pending verification', {
                    verificationKey: redrive.verificationKey,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }

    if (skips.length > 0 || redriven > 0) {
        logger.info('band drain swept', { claimed: skips.length, sent, redriven, budget });
    }

    return { sent, budget };
}

/** The minimal query surface the re-drive reads need — `pg.Pool` satisfies it structurally. */
export interface RedriveQueryable {
    query(text: string, params: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * The pending re-drive substrate's read half (0037, plan U4c), exported so the integration tier can
 * exercise the REAL SQL — the interval cast and the verdict join are claims about the database.
 *
 * @param pool - The recipe database pool, or any queryable double.
 * @returns The two reads the drain consumes. @sideEffect The returned methods read/write the substrate.
 */
export function createRedriveReads(pool: RedriveQueryable): {
    agedRedrives: (limit: number) => Promise<readonly { verificationKey: string; message: unknown }[]>;
    markRedriven: (verificationKey: string) => Promise<void>;
} {
    return {
        async agedRedrives(limit: number): Promise<readonly { verificationKey: string; message: unknown }[]> {
            // ⛔ The no-verdict check is a same-key LEFT JOIN against the verdict store's own primary key —
            // no derivation anywhere, so it cannot drift from what the worker writes. The age bound is the
            // SHARED constant the read side renders pending against, and the last-driven window equals it
            // so each stranded line is re-asked at most once per bound.
            const result = await pool.query(
                `SELECT r.verification_key, r.message
                   FROM recipe_ingredient_verification_redrive r
                   LEFT JOIN recipe_ingredient_verifications v ON v.verification_key = r.verification_key
                  WHERE v.verification_key IS NULL
                    AND r.created_at < now() - ($2 || ' hours')::interval
                    AND (r.last_driven_at IS NULL OR r.last_driven_at < now() - ($2 || ' hours')::interval)
                  ORDER BY r.created_at ASC
                  LIMIT $1`,
                [limit, String(PENDING_VERIFICATION_MAX_AGE_HOURS)],
            );

            return (result.rows as { verification_key: string; message: unknown }[]).map((row) => ({
                verificationKey: row.verification_key,
                message: row.message,
            }));
        },
        async markRedriven(verificationKey: string): Promise<void> {
            await pool.query(
                'UPDATE recipe_ingredient_verification_redrive SET last_driven_at = now() WHERE verification_key = $1',
                [verificationKey],
            );
        },
    };
}

/** How long a cached SSM read stays fresh — mirrors `verifyLine.ts`. */
const SETTINGS_TTL_MS = 60_000;

const sqs = new SQSClient({});

/** Cached across warm invocations. */
let cachedDeps: BandDrainDeps | undefined;

/** Wire the real collaborators. @sideEffect Constructs SDK clients and the database pool on first call. */
function productionDeps(stage: string, region: string, queueUrl: string): BandDrainDeps {
    if (cachedDeps !== undefined) {
        return cachedDeps;
    }

    const pool = getRecipePool();
    const store = new BandAuthorityStore(async (text, params) => {
        const result = await pool.query(text, [...params]);

        return result.rows as readonly Record<string, unknown>[];
    });

    cachedDeps = {
        stage,
        settings: createVerificationSettings({
            load: createSsmSettingsLoader({ stage, region }),
            ttlMs: SETTINGS_TTL_MS,
            now: () => Date.now(),
        }),
        store,
        async reservedForPeriod(period: string): Promise<number> {
            const result = await pool.query('SELECT reserved_micros FROM verification_spend WHERE period = $1', [
                period,
            ]);
            const row = result.rows[0] as { reserved_micros: string | number } | undefined;

            return row === undefined ? 0 : Number(row.reserved_micros);
        },
        ...createRedriveReads(pool),
        async send(message: unknown): Promise<void> {
            await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
        },
        now: () => new Date(),
    };

    return cachedDeps;
}

/**
 * Scheduled entry point.
 *
 * @sideEffect Everything {@link drainRevokedBands} does.
 */
export const handler = async (): Promise<void> => {
    const stage = requireEnv('STAGE');
    const region = requireEnv('AWS_REGION');
    const queueUrl = requireEnv('INGREDIENT_VERIFICATION_QUEUE_URL');

    await drainRevokedBands(productionDeps(stage, region, queueUrl));
    // Plan U9: the parse-job TTL sweep rides this tick (see `parseJobExpiry.ts` for why it is not its own
    // Lambda). Pure SQL, no spend — deliberately OUTSIDE the drain's headroom budget.
    await expireParseJobs(getRecipePool());
};
