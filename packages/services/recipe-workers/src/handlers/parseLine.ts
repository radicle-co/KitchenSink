/**
 * THE SERVICE PARSE LEG — one parse-job line, end to end (plan U8, origin R6/R13, KTD-F).
 *
 * The deployed runtime the parse pipeline never had: corrections → cache → two engines (the CRF Lambda +
 * the GATED, validator-looped LLM leg) → a digest-guarded landing on `recipe_parse_job_lines`. Hosted in
 * recipe-workers because that is where the single Bedrock grantee lives (D6; `llmSpendGuards` asserts the
 * role set, and this handler runs under the SAME role as the verification gate — no second grantee).
 *
 * ## The transient/terminal split, stated once
 *
 *  - **TRANSIENT (throw → SQS redelivery):** anything an ENGINE throws — a ceiling denial or a Bedrock
 *    transport failure in the gated leg, and a CRF invocation that produced no engine answer at all (the
 *    function is gone, the grant does not cover it, it crashed at import, it broke the engine contract).
 *    ADR-0026's 2026-08-31 update names all four, on one ground: none of them is evidence about the
 *    ingredient, and "recording any of them as an outcome would turn an outage into a permanent fact about
 *    a line". The pipeline CONTAINS tier throws (KTD-12), so the handler collects them through the observer
 *    and re-throws AFTER the run, before any landing — and KTD-F's amplification bound is the parse CACHE:
 *    the redelivered message re-reads `ingredient_parse_cache` first and re-pays only the uncached attempts
 *    (asserted in this handler's suite). ⚠️ So a CRF outage costs ONE re-invoke of the CRF per redelivery,
 *    not a second billed Bedrock call: whichever engine answered is already remembered.
 *  - **TERMINAL (landed):** a parse (`parsed` + the proposal), the validator loop's exhaustion
 *    (`unparseable` — R6's recorded state; the line is saved, nothing binds), or both engines absent with
 *    no transient failure (`failed_retryable` — U9's per-line retry re-runs exactly these).
 *  - **DISCARDED (no landing):** a digest mismatch. R17: the landing UPDATE is guarded on the STORED
 *    hash; a message whose recomputed digest does not match — a tampered body, or a line edited after
 *    enqueue — matches zero rows and disappears, because the edit atomically re-enqueued the new phrase.
 */
import type { SQSHandler, SQSRecord } from 'aws-lambda';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { createBedrockConverseClient, createBedrockTransport, isBedrockClientError } from '@kitchensink/bedrock-client';
import { lineDigest, type HexDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import { PARSE_JOB_AGGREGATE_SQL } from '@kitchensink/recipe-core/parsing/parse-job-aggregate';
import { NOVA_LITE_MODEL_ID } from '@kitchensink/recipe-core/spend/spend-arithmetic';
import {
    parseLineJobMessageSchema,
    type ParseLineJobMessage,
} from '@kitchensink/recipe-core/parsing/parse-job-message';
import {
    createValidatedLlmEngine,
    runParsePipeline,
    type ParsedLine,
    type ParseEnginePort,
    type ParsePipelineDeps,
} from '@kitchensink/recipe-import-core';
import { createHash } from 'node:crypto';

import { logger } from '../common/logger.js';
import { emitMetric } from '../common/metrics.js';
import { getRecipeDb, getRecipePool } from '../common/db.js';
import { createSpendLedger } from '../common/verificationSpend.js';
import { isResidencyRefusedError } from '../common/residencyRefused.js';
import { createSsmSettingsLoader, createVerificationSettings } from '../verification/settings.js';
import { createParseCachePort, createParseCorrectionsPort, type ParseQueryable } from '../parsing/parsePorts.js';
import { createCrfInvokeEngine } from '../parsing/crfInvoke.js';
import {
    createGatedFoodnessValidator,
    createGatedLlmEngine,
    createGatedMeasurementValidator,
    createGatedRetryPort,
    type GatedLlmDeps,
} from '../parsing/gatedLlm.js';

/**
 * The parse leg's model — **Nova Lite v1**, the best RESIDENCY-CLEAR option (ADR-0024 §4b, owner ruling
 * 2026-09-04).
 *
 * ⛔ IT WAS `amazon.nova-2-lite-v1:0`, chosen on ADR-0026 §9's external gold set (84%/53% exact, against Nova
 * Micro's 64%/30%), and that choice is REVERSED here on a ground §9 never weighed. Every inference profile
 * that exists for Nova 2 Lite leaves us-east-1 — `us.` reaches three regions, `global.` reaches wider, and
 * there is no single-region or application profile — while AWS stores prompts and outputs in destination
 * Regions for abuse detection. Whether user recipe text may go there is feature 016's determination, and it
 * has not been made, so `residencyClearance` answers `unapproved` and both the runtime and the IAM policy now
 * refuse it. Selecting a model on accuracy never made it residency-clear.
 *
 * ⚠️ THE TRADE, stated so nobody has to rediscover it: on the same gold set Nova Lite v1 scores 73/41 static
 * and 82/52 with retrieval, so this ships an accuracy REGRESSION of roughly 11 points on the ingredient half
 * and 12 on the instruction half against the static prompt. It is cheaper in every token class (5.5× on
 * input, 11.5× on output, 5.5× on cache reads), so the ADR-0024 pool stretches further; that is a consolation,
 * not the reason. The way back is for 016 to record a `residencyApproval` on the Nova 2 Lite registry entry —
 * one edit, carrying its date and reference — after which this constant moves back in its own commit.
 *
 * ⛔ IT IS A COMPILE-TIME CONSTANT, deliberately, and that is load-bearing here. A refused parse model does
 * not fail the handler: every line stops landing and simply stays `pending` until its job's TTL sweeps it, so
 * the symptom is a stalled import rather than an error. If this were an SSM value an operator could produce
 * that stall with a parameter edit; because it is a constant, `parseLine.test.ts`'s "the shipped model pins
 * are callable" assertion makes it unreachable without a red build.
 */
export const PARSE_LEG_MODEL_ID = NOVA_LITE_MODEL_ID;

/** Everything the handler talks to, injected — the `verifyLine.ts` discipline. */
export interface ParseLineDeps {
    readonly stage: string;
    readonly gated: GatedLlmDeps;
    readonly crf: ParseEnginePort<'crf'>;
    readonly pool: ParseQueryable;
    readonly digest: HexDigest;
    /** The parse model's bare id — a field so the suite can pin behaviour without the registry. */
    readonly parseModelId: string;
}

/** How one line's landing is classified. Exported for the landing-split tests — pure. */
export function landingOf(parsed: ParsedLine | null): { status: string; proposal: ParsedLine | null } {
    if (parsed === null) {
        return { status: 'failed_retryable', proposal: null };
    }

    if (parsed.foods.length === 0 && parsed.reviewReasons.includes('not_a_food')) {
        // R6's recorded terminal state — the proposal is kept, nothing binds. ⚠️ BOTH conjuncts (amended
        // 2026-08-31): mixed exhaustion now keeps the foods the foodness judge PASSED while `not_a_food`
        // records only the dropped ones, so the reason alone no longer means "nothing usable here".
        return { status: 'unparseable', proposal: parsed };
    }

    return { status: 'parsed', proposal: parsed };
}

/**
 * Process one parse-job line.
 *
 * @throws When a gated leg failed transiently — the message redelivers.
 * @sideEffect Reads/writes the parse cache, calls the CRF Lambda and Bedrock, lands the proposal.
 */
export async function processParseLine(deps: ParseLineDeps, message: ParseLineJobMessage): Promise<void> {
    // ⛔ R17, first: recompute the digest from the line THIS message carries. A mismatch is poison-shaped
    // (a tampered body) or a stale message for an edited line — either way, TERMINAL discard: the edit
    // path re-enqueued the new phrase, and retrying this one can never land.
    const recomputed = lineDigest(message.sourceLine, deps.digest);

    if (recomputed !== message.lineDigest) {
        logger.warn('parse-line digest mismatch; the landing is discarded', {
            jobId: message.jobId,
            lineIndex: message.lineIndex,
        });

        return;
    }

    const transientFailures: unknown[] = [];
    const pipelineDeps: ParsePipelineDeps = {
        corrections: createParseCorrectionsPort(deps.pool),
        cache: createParseCachePort(deps.pool),
        engines: {
            crf: deps.crf,
            llm: createValidatedLlmEngine({
                inner: createGatedLlmEngine(deps.gated, deps.parseModelId),
                retry: createGatedRetryPort(deps.gated, deps.parseModelId),
                foodness: createGatedFoodnessValidator(deps.gated),
                measurement: createGatedMeasurementValidator(deps.gated, deps.parseModelId),
            }),
        },
        digest: deps.digest,
    };

    const [outcome] = await runParsePipeline(
        [message.sourceLine],
        pipelineDeps,
        { userId: message.userId },
        {
            onTierFailure: (tier, error) => {
                // The pipeline contains throws (KTD-12); the handler decides transience. Everything an
                // ENGINE throws is transient by construction — the gated leg rejects on a denial, a throttle
                // or a 5xx, and `crfInvoke` rejects only when the invocation produced no engine answer at
                // all; both return absence for a deterministic per-line outcome instead. So a captured
                // engine failure re-throws after the run.
                //
                // ⛔ Stated as "not a STORE tier" rather than as the pair `'crf' | 'llm'`, and that is the
                // point: `ParsePipelineTier` is `'corrections' | 'cache' | ParseEngine`, so a future engine
                // is transient by construction rather than by whoever remembers to extend a literal union.
                // The CRF was missing from exactly such a list — the handler collected `tier === 'llm'`
                // alone, so a line parsed during a CRF outage landed the LLM's single-engine reading as its
                // PERMANENT answer, which is ADR-0026's 2026-08-31 rule ("a CRF invocation failure" is in
                // the transient set) read backwards.
                if (tier !== 'corrections' && tier !== 'cache') {
                    transientFailures.push(error);
                }

                logger.warn('parse tier failed', {
                    tier,
                    error: error instanceof Error ? error.message : String(error),
                });
            },
            onUnreadablePayload: (payload) => {
                logger.warn('parse tier row unreadable', { tier: payload.tier });
            },
        },
    );

    // ⛔ A FOURTH CLASS, ahead of the transient re-throw: REFUSED (ADR-0024 §4b). A residency refusal shares
    // the transient set's property that nothing may LAND — a merge produced while an engine was silenced by
    // a deployment fault must not become this line's permanent answer — and none of its property that a
    // retry could help: it is deterministic in (model, region), so redelivering it would burn the queue's
    // whole `maxReceiveCount` to reach the same answer and would report a standing product decision as DLQ
    // depth. So it lands nothing AND re-throws nothing.
    //
    // ⚠️ Checked over the whole collection rather than the first element: a run can carry a CRF outage AND a
    // refusal, and the refusal's disposition wins because nothing can land until the model is cleared either
    // way — while re-throwing the outage would put a permanently-failing message on the redelivery path.
    //
    // ⚠️ ACCEPTED CONSEQUENCE, stated rather than discovered: the line stays `pending` until `expireParseJobs`
    // sweeps its job. U9's per-line retry only re-runs `failed_retryable`, so nothing picks it up sooner —
    // which is correct, because landing `failed_retryable` would record a fact about the LINE for a fault
    // about the DEPLOY. The `logger.error` in `gatedLlm.ts` is what makes the stall visible.
    const refusal = transientFailures.find(isResidencyRefusedError);

    if (refusal !== undefined) {
        logger.error('parse-line refused: the parse model is not cleared for residency; nothing was landed', {
            jobId: message.jobId,
            lineIndex: message.lineIndex,
            ...refusal.refusal,
        });

        return;
    }

    if (transientFailures.length > 0) {
        // ⛔ BEFORE any landing: a single-engine merge produced under a transient outage must not become
        // this line's permanent answer. The cache keeps whatever succeeded, so the redelivery re-pays only
        // what is missing (KTD-F).
        const first = transientFailures[0];

        throw first instanceof Error ? first : new Error(String(first));
    }

    const { status, proposal } = landingOf(outcome?.parsed ?? null);

    // R17: guarded on the STORED digest — an edited line's stale landing matches zero rows.
    const landed = await deps.pool.query(
        `UPDATE recipe_parse_job_lines
            SET status = $4,
                proposal = $5::jsonb,
                llm_attempts = $6,
                updated_at = now()
          WHERE job_id = $1 AND line_index = $2 AND line_digest = $3`,
        [
            message.jobId,
            message.lineIndex,
            recomputed,
            status,
            proposal === null ? null : JSON.stringify(proposal),
            proposal?.llmAttempts ?? null,
        ],
    );

    if ((landed as { rowCount?: number }).rowCount === 0) {
        logger.info('parse landing discarded — the stored line moved on (edit re-drives its own message)', {
            jobId: message.jobId,
            lineIndex: message.lineIndex,
        });

        return;
    }

    // Job aggregate: terminal when no line is pending; partial when any line is retryable. The rule is
    // SHARED with the producer's enqueue-failure path — one statement, in recipe-core, so the two writers
    // cannot drift (see PARSE_JOB_AGGREGATE_SQL's docstring).
    await deps.pool.query(PARSE_JOB_AGGREGATE_SQL, [message.jobId]);
}

/** Parse one SQS record body. Throws on anything invalid — the DLQ is for poison. */
function parseRecord(record: SQSRecord): ParseLineJobMessage {
    return parseLineJobMessageSchema.parse(JSON.parse(record.body));
}

/** Cached across warm invocations. */
let cachedDeps: ParseLineDeps | undefined;

/** @sideEffect Constructs SDK clients and the database pool on first call. */
function productionDeps(stage: string, region: string): ParseLineDeps {
    if (cachedDeps !== undefined) {
        return cachedDeps;
    }

    const pool = getRecipePool();
    const crfFunctionName = process.env['CRF_FUNCTION_NAME'];
    const crfEngineVersion = process.env['CRF_ENGINE_VERSION'];

    if (crfFunctionName === undefined || crfEngineVersion === undefined) {
        throw new Error('CRF_FUNCTION_NAME and CRF_ENGINE_VERSION are required');
    }

    cachedDeps = {
        stage,
        gated: {
            stage,
            // The Lambda's own region — the same value the stack's residency derivation used at synth time.
            deployRegion: region,
            settings: createVerificationSettings({
                load: createSsmSettingsLoader({ stage, region }),
                ttlMs: 60_000,
                now: () => Date.now(),
            }),
            ledger: createSpendLedger(getRecipeDb()),
            bedrock: createBedrockConverseClient(createBedrockTransport({ region }).send),
            emit: emitMetric,
            now: () => new Date(),
        },
        crf: createCrfInvokeEngine({
            functionName: crfFunctionName,
            client: new LambdaClient({}),
            declaredEngineVersion: crfEngineVersion,
            // The stage the availability alarm's `Stage` dimension selects, and the sink it reads. A
            // datapoint published under the wrong stage is a datapoint no alarm sees.
            stage,
            emit: emitMetric,
        }),
        pool: {
            query: async (text, params) => pool.query(text, params),
        },
        digest: (value) => createHash('sha256').update(value).digest('hex'),
        parseModelId: PARSE_LEG_MODEL_ID,
    };

    return cachedDeps;
}

/**
 * SQS entry point. `batchSize: 1` — one record is one line, and a DLQ message maps to one un-landed line.
 *
 * @sideEffect Everything {@link processParseLine} does.
 */
export const handler: SQSHandler = async (event) => {
    const stage = process.env['STAGE'];
    const region = process.env['AWS_REGION'];

    if (stage === undefined || region === undefined) {
        throw new Error('STAGE and AWS_REGION are required');
    }

    const deps = productionDeps(stage, region);

    for (const record of event.Records) {
        await processParseLine(deps, parseRecord(record));
    }
};

// Re-exported so the suite can assert transience classification without reaching into the module.
export { isBedrockClientError };
