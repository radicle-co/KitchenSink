/**
 * THE VERIFICATION GATE (plan U11 / R15–R18, R21–R24, R61; ADR-0024) — reserve → call → settle → record.
 *
 * DESIGN PATTERNS: **Composition root** over four Ports (the spend ledger, the Bedrock adapter, the settings
 * resolver, the verdict store), each of which is replaced wholesale in the unit suite. Every JUDGEMENT this
 * handler appears to make was already made by a pure module — `decideVerification` chose the aspects,
 * `planReservation` priced the call, `bandFor` collapsed the verdict — so what is left here is ORCHESTRATION
 * and the one thing orchestration owns: which failures are transient and which are terminal.
 *
 * ## ⛔ THE DISTINCTION THIS FILE EXISTS TO GET RIGHT
 *
 * ADR-0024 spends a section on it, so it is repeated where the branches are:
 *
 *  - **TRANSIENT** — a ceiling denial, an unreadable counter, unreadable settings, an unpriced model, a
 *    provider failure. The message returns to the queue and retries under layer 0's `maxReceiveCount` + DLQ.
 *    **No verdict is recorded.** "An exhausted ceiling drains to the DLQ, where it is visible as queue depth
 *    instead of as silently degraded recipes."
 *  - **TERMINAL** — a verdict was read, or the model answered unusably. A row is written and the message is
 *    acknowledged; the money is not spent again.
 *
 * Recording a billing denial as a withheld line would manufacture the wrong-DISAGREE outcome this unit ranks
 * as unacceptable, in bulk, for reasons that have nothing to do with any line's quality — and would invite a
 * cook to correct something we simply declined to check.
 *
 * ## ⚠️ ONE DEPARTURE FROM THE PLAN'S LITERAL WORDING, argued rather than assumed
 *
 * Plan U11 says a provider outage, an access denial and a throttle "each terminate as unresolved". They do
 * not, here: `unresolved` WITHHOLDS nutrition, which is the wrong-DISAGREE direction the same plan calls the
 * unacceptable one — and a provider outage would produce it in bulk, for every line in flight, for a reason
 * that is about AWS rather than about any recipe. So a provider failure retries; if it exhausts the queue's
 * attempts it drains to the DLQ and the line publishes UNVERIFIED, which is precisely today's behaviour and
 * therefore no worse than not having shipped the gate. This is ADR-0024's own argument about billing denials,
 * applied to the failure class next to it.
 *
 * ## ⛔ NOTHING AFTER THE MONEY IS SPENT MAY FAIL THE HANDLER
 *
 * Once `converse` has returned, the call is billed. A throw from the settlement or the verdict write would
 * redeliver the message, which would reserve and call AGAIN — spending twice for one line because a bookkeeping
 * write did not land. Both are therefore metered and swallowed. That is safe in both directions: a standing
 * reservation OVER-counts, and an absent verdict means PUBLISH, i.e. today's behaviour.
 */
import type { SQSHandler, SQSRecord } from 'aws-lambda';
import {
    planReservation,
    actualCostMicros,
    type PricedReservation,
} from '@kitchensink/recipe-core/spend/spend-arithmetic';
import {
    PROVISIONAL_VERIFICATION_THRESHOLDS,
    curatedExactEvidence,
    decideVerification,
    rankedEvidence,
    rememberedEvidence,
    unattributedEvidence,
    type IdentityEvidence,
    type VerificationAspect,
} from '@kitchensink/recipe-core/resolution/verification-gate-policy';
import {
    verifyIngredientLineMessageSchema,
    type VerifyIngredientLineMessage,
} from '@kitchensink/recipe-core/resolution/verification-message';
import { bandFor, type ConfidenceBand } from '@kitchensink/recipe-core/resolution/confidence';
import { verificationKey } from '@kitchensink/recipe-core/resolution/verification-key';
import {
    createBedrockConverseClient,
    createBedrockTransport,
    isBedrockClientError,
    type BedrockConverseClient,
} from '@kitchensink/bedrock-client';
import { createHash } from 'node:crypto';

import { requireEnv } from '../common/config.js';
import { getRecipeDb } from '../common/db.js';
import { logger } from '../common/logger.js';
import { emitMetric, type EmfMetric } from '../common/metrics.js';
import { createSpendLedger, isSpendGated, type SpendLedger } from '../common/verificationSpend.js';
import {
    VERIFICATION_MAX_INPUT_TOKENS,
    VERIFICATION_MAX_OUTPUT_TOKENS,
    buildVerificationPrompt,
    isPromptTooLargeError,
} from '../verification/prompt.js';
import { readVerdict } from '../verification/verdict.js';
import {
    createVerificationSettings,
    createSsmSettingsLoader,
    type VerificationSettingsResolver,
} from '../verification/settings.js';
import { createVerdictStore, type VerdictStore } from '../verification/verdictStore.js';

/** The EMF namespace every metric below is published under. The alarms extract by exact namespace. */
export const VERIFICATION_METRIC_NAMESPACE = 'Commise/RecipeVerification';

/**
 * The dollar metric ADR-0024's layer 4 alarms on, in MICRO-dollars.
 *
 * ⛔ Layer 4 detects counter BUGS, not a bypass — an earlier draft of the ADR claimed otherwise and was
 * corrected. This metric is emitted BY the gated path, so a caller that skipped the gate emits nothing. The
 * bypass control is IAM (layer 4b): `bedrock:InvokeModel` on exactly one execution role, asserted by a guard
 * test. A permission nobody else holds cannot be bypassed; a metric nobody else emits cannot notice.
 */
export const SPEND_METRIC_NAME = 'VerificationSpendMicros';

/**
 * WHO the spend is attributed to — the `CallSite` dimension's value for this gate (U36 / KTD-17).
 *
 * ⛔ ATTRIBUTION, NOT PARTITIONING. The owner's 2026-08-24 ruling makes ADR-0024's $100/month a single global
 * pool shared with the ingredient parse leg and 017's capture tiers, first come first served. Not capping per
 * consumer makes it MORE important to know which one spent, not less: when the pool empties, "who burned it"
 * is the first question and a dimensionless {@link SPEND_METRIC_NAME} cannot answer it.
 *
 * ⚠️ The dimension rides on the METRIC and nowhere else. Nothing about the reservation — the ceiling, the
 * worst case, the headroom, or the counter row (keyed on the period alone) — may learn about the call site, or
 * one pool silently becomes several of unstated size. `source-rolling-window-count` is the cautionary case in
 * the other direction: it carries a `source` dimension and no `stage`, so prod and every preview co-mingle
 * into one series and no call can be attributed at all.
 */
export const VERIFICATION_CALL_SITE = 'verification-gate';

/** Fires when a settlement failed, i.e. a reservation stands unrefunded. ADR-0024 asks for exactly this. */
export const SETTLE_FAILURE_METRIC_NAME = 'VerificationSettleFailures';

/**
 * Fires when a response reported cache tokens.
 *
 * ⚠️ ADR-0024 §5: at ~660 input tokens prompt caching CANNOT engage on any candidate (Claude Haiku 4.5's
 * minimum is 4,096), so this should be zero forever. A non-zero value means the prompt grew past the
 * threshold and the cost model needs revisiting — a signal, not an assumption.
 */
export const CACHE_TOKENS_METRIC_NAME = 'VerificationCacheTokensObserved';

/** How long a cached SSM read stays fresh. See `verification/settings.ts` for why this is not "cold start". */
const SETTINGS_TTL_MS = 60_000;

/** Where a verdict is written. Narrow on purpose: the handler must not be able to reach anything else. */
export type { VerdictStore };

/** Everything the handler talks to, injected. */
export interface VerificationDeps {
    /** The deploy stage — the ONLY input to the prod-only ceiling ruling. */
    readonly stage: string;
    readonly settings: VerificationSettingsResolver;
    readonly ledger: SpendLedger;
    readonly bedrock: BedrockConverseClient;
    readonly store: VerdictStore;
    /** Metric sink, injected so the unit suite can read what was published. */
    readonly emit: (metric: EmfMetric) => void;
    /** Clock, injected so the period key is testable across a month boundary. */
    readonly now: () => Date;
}

/** Rebuild the policy's evidence value from the message's inputs. */
function evidenceFrom(message: VerifyIngredientLineMessage): IdentityEvidence {
    switch (message.evidenceKind) {
        case 'curated-exact':
            return curatedExactEvidence();
        case 'remembered':
            return rememberedEvidence();
        case 'ranked':
            return rankedEvidence(message.shortlist);
        case 'unattributed':
            // What the recipe write path sends: the persisted line records no cascade provenance, so there is
            // none to rebuild. It opens no skip door, which is KTD-3's default and the safe direction.
            return unattributedEvidence();
    }
}

/** Publish one metric under this gate's namespace. */
function publish(deps: VerificationDeps, name: string, value: number, unit: EmfMetric['unit'] = 'Count'): void {
    deps.emit({ namespace: VERIFICATION_METRIC_NAMESPACE, name, unit, stage: deps.stage, value });
}

/**
 * Publish the dollar metric, attributed to this call site.
 *
 * Separate from {@link publish} rather than an extra parameter on it: only the SPEND metric is a claim on
 * ADR-0024's shared pool, and only a claim on a shared pool needs a claimant. The settle-failure and
 * cache-token metrics are facts about this worker alone, and giving them a `CallSite` would double their
 * billed series to say nothing.
 *
 * @param deps - The handler's collaborators.
 * @param micros - The period's reserved total, or this call's actual cost where the counter is bypassed.
 * @sideEffect Emits one EMF line.
 */
function publishSpend(deps: VerificationDeps, micros: number): void {
    deps.emit({
        namespace: VERIFICATION_METRIC_NAMESPACE,
        name: SPEND_METRIC_NAME,
        // CloudWatch has no currency unit — see `common/metrics.ts`. The denomination is in the metric NAME.
        unit: 'None',
        stage: deps.stage,
        value: micros,
        dimensions: { CallSite: VERIFICATION_CALL_SITE },
    });
}

/**
 * Settle, metering (and swallowing) a failure.
 *
 * ⛔ NEVER RETRIED, and never allowed to fail the handler. `reserved_micros + $delta` is not idempotent with a
 * negative delta, so a retried settle double-refunds; and a throw here would redeliver a message whose call
 * was already billed.
 *
 * @param deps - The handler's collaborators.
 * @param plan - The plan the reservation was taken under, carrying its captured period.
 * @param actualMicros - What the call cost. Zero for an outcome with no billed response.
 * @sideEffect Writes to `verification_spend`; emits a metric on failure.
 */
async function settleQuietly(deps: VerificationDeps, plan: PricedReservation, actualMicros: number): Promise<void> {
    try {
        await deps.ledger.settle({ plan, actualMicros });
    } catch (error) {
        publish(deps, SETTLE_FAILURE_METRIC_NAME, 1);
        logger.error('verification settle failed; the reservation stands unrefunded', {
            period: plan.period,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

/**
 * Record a verdict, metering (and swallowing) a failure.
 *
 * Safe to swallow because ABSENCE OF A VERDICT MEANS PUBLISH: a lost verdict degrades to the behaviour the
 * system had before this gate existed, rather than manufacturing a withholding.
 *
 * @param deps - The handler's collaborators.
 * @param row - The verdict to store.
 * @sideEffect Writes to `recipe_ingredient_verifications`.
 */
async function recordQuietly(deps: VerificationDeps, row: Parameters<VerdictStore['recordVerdict']>[0]): Promise<void> {
    try {
        await deps.store.recordVerdict(row);
    } catch (error) {
        logger.error('verification verdict write failed; the line will publish unverified', {
            band: row.band,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

/**
 * Verify one line.
 *
 * @param deps - The handler's collaborators.
 * @param message - The already-parsed message.
 * @throws When the outcome is TRANSIENT and the message must return to the queue.
 * @sideEffect Reads SSM, writes the spend counter, calls Bedrock, writes the verdict store.
 */
export async function processVerification(deps: VerificationDeps, message: VerifyIngredientLineMessage): Promise<void> {
    // 1. Re-run the pure policy. ⛔ The message carries INPUTS, never conclusions: a producer bug, an older
    //    producer release or a replayed message must not be able to skip an identity check silently.
    const decision = decideVerification({
        sourceLine: message.sourceLine,
        evidence: evidenceFrom(message),
        thresholds: PROVISIONAL_VERIFICATION_THRESHOLDS,
    });

    if (decision.kind === 'skip') {
        logger.info('verification skipped', { reason: decision.reason });

        return;
    }

    if (decision.kind === 'reject') {
        // Unreachable while the transport bound equals the policy's, and TERMINAL rather than a throw when it
        // is not: the condition is deterministic, so retrying it five times would only fill the DLQ slower.
        logger.warn('verification refused an over-cap line', { observedChars: decision.observedChars });

        return;
    }

    // 2. Settings, then the price. Both TRANSIENT on failure — with no ceiling and no rate there is no worst
    //    case, so there is nothing to reserve and the call must not be made.
    const settings = await deps.settings.resolve();
    const plan = planReservation({
        modelId: settings.modelId,
        ceilingMicros: settings.ceilingMicros,
        maxInputTokens: VERIFICATION_MAX_INPUT_TOKENS,
        maxOutputTokens: VERIFICATION_MAX_OUTPUT_TOKENS,
        nowUtc: deps.now(),
    });

    if (plan.kind === 'unpriced') {
        // ⛔ Membership of the rate table IS authorization: with no rate there is no worst case, so an
        // unpriced model can only ever cost a denial, never uncounted spend.
        throw new Error(`verification model '${plan.modelId}' is not priced by the rate table; refusing to call it`);
    }

    // 3. The prompt, built BEFORE the reservation so an over-large one costs nothing.
    let prompt: ReturnType<typeof buildVerificationPrompt>;

    try {
        prompt = buildVerificationPrompt({
            sourceLine: message.sourceLine,
            candidateFoodName: message.candidateFoodName,
            quantityLow: message.quantityLow,
            quantityHigh: message.quantityHigh,
            unit: message.unit,
            // ⛔ U7/U11 — when the line's measure was RESTATED, this is the pair the model is shown, and the
            // three fields above are not rendered at all. `one gill of milk` persists as `0.5 cup`, and
            // asking the model whether those agree manufactures a DISAGREE about a correct parse.
            ...(message.statedMeasure === undefined ? {} : { statedMeasure: message.statedMeasure }),
            aspects: decision.aspects,
        });
    } catch (error) {
        if (isPromptTooLargeError(error)) {
            logger.warn('verification prompt exceeded its bound; the line was not checked', {
                observedChars: error.observedChars,
            });

            return;
        }

        throw error;
    }

    // 4. Reserve — PROD ONLY (ADR-0024 §3, owner ruling 2026-08-21). Sandbox and every pr-{N} call ungated,
    //    bounded by layers 0–2 at `reservedConcurrency = 1` and ~1s per call.
    const gated = isSpendGated(deps.stage);

    if (gated) {
        const reservation = await deps.ledger.reserve(plan);

        if (reservation.kind === 'denied') {
            // ⛔ TRANSIENT. Not a judgement about this line, so no verdict is recorded — the message retries
            // and, if the ceiling stays exhausted, drains to the DLQ where it is visible as queue depth.
            throw new Error(`verification ceiling reached for ${reservation.period}; the call was not made`);
        }

        publishSpend(deps, reservation.reservedMicros);
    }

    // 5. The call.
    let outcome: Awaited<ReturnType<BedrockConverseClient['converse']>>;

    try {
        outcome = await deps.bedrock.converse({
            // ⛔ THE ADDRESS, NOT THE IDENTITY (U35). `plan.modelId` is what the model IS — the registry key,
            // and what the verdict and the memo record below. `plan.invocationId` is how Bedrock is REACHED,
            // which for a profile-only model is an `inference-profile` id that is not a model id at all.
            // Passing `modelId` here is what made Claude Haiku 4.5 fail in both directions at once: the bare
            // id is refused with `ValidationException`, and its profile id has no rate-table entry.
            invocationId: plan.invocationId,
            systemPrompt: prompt.system,
            userMessage: prompt.user,
            maxOutputTokens: VERIFICATION_MAX_OUTPUT_TOKENS,
        });
    } catch (error) {
        if (gated && isBedrockClientError(error) && error.settlement === 'refund-full') {
            await settleQuietly(deps, plan, 0);
        }

        // ⛔ TRANSIENT, and NO verdict — see the file docstring's "one departure".
        throw error;
    }

    // 6. Settle from what was actually billed, BEFORE recording anything.
    const usage = outcome.usage;

    if (usage !== undefined) {
        if ((usage.cacheReadInputTokens ?? 0) > 0 || (usage.cacheWriteInputTokens ?? 0) > 0) {
            publish(deps, CACHE_TOKENS_METRIC_NAME, 1);
        }

        if (gated) {
            await settleQuietly(deps, plan, actualCostMicros(plan.rate, usage));
        }
    } else if (gated) {
        // ⛔ COST UNKNOWN is not zero. Settling at zero here would refund a call that really spent; leaving
        // the worst case standing over-counts, which is ADR-0024's accepted direction.
        logger.warn('verification response carried no readable usage; the reservation stands', {
            period: plan.period,
        });
    }

    if (!gated) {
        // The dollar metric is emitted in EVERY stage — it costs one log line and it is the only visibility on
        // the ungated ~$88/month/stage exposure ADR-0024 accepts.
        publishSpend(deps, usage === undefined ? 0 : actualCostMicros(plan.rate, usage));
    }

    // 7. Read the answer, and record it. Every path from here is TERMINAL.
    const key = verificationKey(
        {
            sourceLine: message.sourceLine,
            foodId: message.foodId,
            quantityLow: message.quantityLow,
            quantityHigh: message.quantityHigh,
            unit: message.unit,
            // ⛔ IN THE KEY, not merely in the prompt, and `null` — never omitted — when the line was not
            // restated. It changes what the model was SHOWN and therefore what it concluded, so a restated
            // line and its un-restated self are different judgements. Sharing a key across them would serve
            // the pre-0027 false DISAGREE to the corrected line forever, because absence of a verdict is the
            // only thing that publishes. This is why `VERIFICATION_KEY_VERSION` is `v2`.
            statedMeasure: message.statedMeasure ?? null,
        },
        (input) => createHash('sha256').update(input).digest('hex'),
    );

    const reading =
        outcome.kind === 'answered'
            ? readVerdict(outcome.text, outcome.stopReason)
            : ({ kind: 'unreadable', reason: outcome.reason } as const);

    if (reading.kind === 'unreadable') {
        // ⛔ `inconclusive`, NEVER an agreement, and never a contradiction either. A structured-output failure
        // is recorded for the bake-off rather than silently retried (plan U11) — and `inconclusive` publishes,
        // so a model that cannot answer leaves the line exactly as the gate found it.
        logger.warn('verification answer was unreadable', { reason: reading.reason });
        await recordQuietly(deps, verdictRow(message, plan, decision.aspects, 'abstain', 'low', 'inconclusive', key));

        return;
    }

    const band: ConfidenceBand = bandFor(reading.outcome);
    await recordQuietly(
        deps,
        verdictRow(message, plan, decision.aspects, reading.outcome.verdict, reading.outcome.certainty, band, key),
    );

    // ⛔ A MEMO ONLY WHEN IDENTITY WAS ACTUALLY CHECKED. `ingredient_resolution_memos` records that a MODEL
    // agreed this phrase means this food, and it then answers for every future cook. An `agree` from a run
    // that only asked about quantity would launder a curated human assertion — or a lexical guess — into a
    // machine verification that never happened.
    if (band === 'verified' && decision.aspects.includes('identity')) {
        try {
            await deps.store.rememberAgreement({
                sourceLine: message.sourceLine,
                foodId: message.foodId,
                modelId: plan.modelId,
                // Carried so account erasure can reach the phrase (migration 0026). `undefined` on a message
                // from a producer that predates the field; the memo is written regardless.
                ownerId: message.ownerId,
            });
        } catch (error) {
            logger.error('verification memo write failed', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}

/** Assemble the row, so the seven-argument shape is written once rather than at three call sites. */
function verdictRow(
    message: VerifyIngredientLineMessage,
    plan: PricedReservation,
    aspects: readonly VerificationAspect[],
    verdict: string,
    certainty: string,
    band: ConfidenceBand,
    verificationKeyValue: string,
): Parameters<VerdictStore['recordVerdict']>[0] {
    return {
        verificationKey: verificationKeyValue,
        verdict,
        certainty,
        band,
        aspects,
        modelId: plan.modelId,
        foodId: message.foodId,
    };
}

/**
 * SQS entry point.
 *
 * `batchSize: 1` in the stack, so one record is one line and a DLQ message maps to exactly one unverified
 * line. A malformed body throws, which is correct: it is poison, and the DLQ is where poison belongs.
 *
 * @param event - The SQS event.
 * @sideEffect Everything {@link processVerification} does.
 */
export const handler: SQSHandler = async (event) => {
    const stage = requireEnv('STAGE');
    const region = requireEnv('AWS_REGION');
    const deps = productionDeps(stage, region);

    for (const record of event.Records) {
        await processVerification(deps, parseRecord(record));
    }
};

/** Parse one SQS record body. Throws on anything that is not a valid message — the DLQ is for poison. */
function parseRecord(record: SQSRecord): VerifyIngredientLineMessage {
    return verifyIngredientLineMessageSchema.parse(JSON.parse(record.body));
}

/** Cached across warm invocations, exactly as `getRecipeDb` is. */
let cachedDeps: VerificationDeps | undefined;

/**
 * Wire the real collaborators.
 *
 * ⛔ The Bedrock client is constructed here rather than at module scope so a construction failure is a
 * classifiable HANDLER error — a throw during INIT produces no structured log and no metric, leaving layer 4
 * blind while the queue drains.
 *
 * @param stage - The deploy stage.
 * @param region - The AWS region.
 * @returns The production dependency bundle.
 * @sideEffect Constructs SDK clients and a database pool on first call.
 */
function productionDeps(stage: string, region: string): VerificationDeps {
    if (cachedDeps !== undefined) {
        return cachedDeps;
    }

    // Imported lazily so the unit suite never loads the AWS SDK.
    const db = getRecipeDb();

    cachedDeps = {
        stage,
        settings: createVerificationSettings({
            load: createSsmSettingsLoader({ stage, region }),
            ttlMs: SETTINGS_TTL_MS,
            now: () => Date.now(),
        }),
        ledger: createSpendLedger(db),
        bedrock: createBedrockConverseClient(createBedrockTransport({ region }).send),
        store: createVerdictStore(db),
        emit: emitMetric,
        now: () => new Date(),
    };

    return cachedDeps;
}
