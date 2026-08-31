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

import { requireEnv } from '../common/config.js';
import { getRecipePool } from '../common/db.js';
import { logger } from '../common/logger.js';
import { isSpendGated } from '../common/verificationSpend.js';
import {
    createSsmSettingsLoader,
    createVerificationSettings,
    type VerificationSettingsResolver,
} from '../verification/settings.js';
import { VERIFICATION_MAX_INPUT_TOKENS, VERIFICATION_MAX_OUTPUT_TOKENS } from '../verification/prompt.js';

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
        maxInputTokens: VERIFICATION_MAX_INPUT_TOKENS,
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

    if (skips.length > 0) {
        logger.info('band drain swept', { claimed: skips.length, sent, budget });
    }

    return { sent, budget };
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
};
