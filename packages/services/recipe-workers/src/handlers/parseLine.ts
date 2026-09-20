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
import { NOVA_2_LITE_MODEL_ID } from '@kitchensink/recipe-core/spend/spend-arithmetic';
import {
    parseLineJobMessageSchema,
    type ParseLineJobMessage,
} from '@kitchensink/recipe-core/parsing/parse-job-message';
import {
    bindsNothing,
    createValidatedLlmEngine,
    runParsePipeline,
    type ParsedLine,
    type ParseEnginePort,
    type ParsePipelineDeps,
} from '@kitchensink/recipe-import-core';
import { createHash } from 'node:crypto';

import { isInvalidPayload, recordInvalidPayload } from '../common/invalidPayload.js';
import { initObservability, withObservability } from '../common/observability.js';
import { logger } from '../common/logger.js';
import { emitMetric, type EmfMetric } from '../common/metrics.js';
import { getRecipeDb, getRecipePool } from '../common/db.js';
import { createSpendLedger } from '../common/verificationSpend.js';
import { isResidencyRefusedError } from '../common/residencyRefused.js';
import { createSsmSettingsLoader, createVerificationSettings } from '../verification/settings.js';
import { createParseCachePort, createParseCorrectionsPort, type ParseQueryable } from '../parsing/parsePorts.js';
import { acquireParseLease, realSleep, releaseParseLease } from '../parsing/parseLease.js';
import { PARSE_METRIC_NAMESPACE, createCrfInvokeEngine } from '../parsing/crfInvoke.js';
import {
    createGatedFoodnessValidator,
    createGatedLlmEngine,
    createGatedMeasurementValidator,
    createGatedRetryPort,
    type GatedLlmDeps,
} from '../parsing/gatedLlm.js';

/**
 * The parse leg's model — **Nova 2 Lite**, chosen on ADR-0026 §9's external gold set (84%/53% exact, against
 * Nova Micro's 64%/30%) and residency-WARRANTED (owner ruling 2026-09-12, ADR-0024 §4b).
 *
 * ⛔ WHAT THE WARRANT ADMITS, because picking this model is inseparable from it. Every inference profile that
 * exists for Nova 2 Lite leaves us-east-1 — `us.` reaches three regions, `global.` reaches wider, and there
 * is no single-region or application profile — while AWS stores prompts and outputs in destination Regions
 * for abuse detection. So running the parse leg on this model means **user recipe text rests in us-east-2
 * and us-west-2**. That is not a side effect of the pin; it IS the decision, and the owner took it knowingly.
 * `residencyClearance` answers `approved` only because a `residencyApproval` is recorded on the registry
 * entry, and the runtime and the IAM policy both read that same field — so revoking the warrant disables
 * this pin in both places at once, with no third edit to forget.
 *
 * ⚠️ 016 still OWNS this determination. The ruling was made ahead of the legal-compliance framework, not
 * instead of it; when 016 is built it may narrow or revoke the warrant, and the registry entry says so where
 * the marker lives. Do not read the approval as the question being closed.
 *
 * ⚠️ WHAT IT COSTS, stated so nobody rediscovers it: Nova 2 Lite is dearer in every token class than the
 * Nova Lite v1 fallback (5.5× on input, 11.5× on output, 5.5× on cache reads), so the ADR-0024 pool
 * stretches less far. The accuracy it buys is ~11 points on the ingredient half and ~12 on the
 * instruction half — the trade §9 makes, payable because residency is warranted.
 *
 * ⛔ IT IS A COMPILE-TIME CONSTANT, deliberately, and that is load-bearing here. A refused parse model does
 * not fail the handler: every line stops landing and simply stays `pending` until its job's TTL sweeps it, so
 * the symptom is a stalled import rather than an error. If this were an SSM value an operator could produce
 * that stall with a parameter edit; because it is a constant, `parseLine.test.ts`'s "the shipped model pins
 * are callable" assertion makes it unreachable without a red build.
 */
export const PARSE_LEG_MODEL_ID = NOVA_2_LITE_MODEL_ID;

/**
 * The gauge published once per LANDING ATTEMPT: `1` when the update matched no rows, `0` when it landed.
 *
 * ⛔ MUST EQUAL the `metricName` of `RecipeParseLandingDiscardAlarm` in `infra/lib/RecipeWorkersStack.ts`.
 * The alarm extracts by exact namespace, dimension and metric name, so a divergence fails nothing at deploy
 * time — it leaves the alarm watching a metric nobody publishes, which is a permanent, confident `OK`.
 * `serviceInfraWiringInvariants` W3 asserts the pairing from the alarm's side.
 *
 * ## ⛔ WHY A 0/1 GAUGE AND NOT A COUNT OF DISCARDS
 *
 * A count cannot tell an incident from a busy day. The discard is a NORMAL outcome — R17 guards the landing
 * on the stored digest, so every edited line legitimately discards the message its edit superseded — and it
 * ran at roughly a tenth of landings before the incident. What went wrong on 2026-09-11 was the RATIO
 * (~11% → 99.9%), and a rate needs a denominator. Emitting a datapoint on BOTH outcomes gives CloudWatch
 * both numbers from one series: `Sum` is the discards, `SampleCount` is the attempts, so the alarm can
 * divide, and the same `SampleCount` is what lets it decline to judge a quiet queue at all.
 *
 * ⛔ EMITTED AT THE LANDING AND NOWHERE ELSE. A residency refusal and a transient engine failure attempt no
 * landing; emitting for either would make `SampleCount` mean "messages handled" instead of "landings
 * attempted", and the ratio would read LOW during exactly the engine outage that produces the most
 * non-attempts. `parseLine.test.ts` asserts both silences.
 */
export const PARSE_LANDING_DISCARDED_METRIC_NAME = 'ParseLandingDiscarded';

/**
 * How long a refused caller waits before parsing anyway.
 *
 * ⚠️ ONE wait, not a poll, and it is deliberately NOT a correctness boundary. If the holder's parse outlasts
 * it the refused caller wakes, misses the cache and asks the engines — costing exactly one duplicate call,
 * which is what the whole system did before the lease existed. That is why a plain wait is preferred to a
 * poll.
 *
 * ⛔ ON ONE PATH IT IS WORSE THAN THE OLD BEHAVIOUR, and saying "degrades to pre-lease" without this would
 * be false. A line ANOTHER owner has already answered still reaches the queue — copy-forward is per-owner
 * while the cache is global — so two of those in flight together make one of them wait here before reaching
 * a cache that was always going to hit. On that path the wait is pure loss, not a degradation. It is
 * recorded rather than fixed because the only fix is a second copy of the pipeline's own cache read inside
 * this handler, which is the duplicated knowledge DRY governs.
 *
 * ⛔ THIS NUMBER IS NOT MEASURED, AND IS PROBABLY SHORTER THAN A PARSE. `consumerConcurrency.ts` reasons
 * about "five concurrent ~1-second calls", and one validated attempt is at least three SEQUENTIAL Bedrock
 * calls (the parse, the foodness judge, the measurement judge), which the retry rules may repeat up to
 * four times. So the realistic case is the loser waking early, missing the cache and asking — which is why
 * the bound, not the saving, is what this is documented by.
 *
 * ⚠️ Raising it is not obviously right either: the wait is paid by a caller that may be serving a cook, and
 * a longer one costs latency on every refusal to save a call on some of them. Sizing it needs a
 * parse-duration distribution for this leg, which nobody has — `PARSE_METRIC_NAMESPACE` already exists, so
 * the fix is a duration metric and then a p95, after which this paragraph goes away.
 * `parseLeg.integration.test.ts` pins the consequence in both directions meanwhile, so whichever way the
 * number moves, the trade stays observable instead of asserted.
 */
const PARSE_LEASE_WAIT_MS = 1_500;

/**
 * What taking the lease told us.
 *
 * ⛔ THREE STATES, BECAUSE TWO WOULD CONFLATE THE ONE DISTINCTION THAT CHANGES WHAT TO DO NEXT. `refused`
 * means another invocation holds it, so waiting is worth it — the holder is mid-parse and the cache is
 * about to be filled. `unavailable` means the lease could not be consulted at all, so there is no holder to
 * wait for and waiting is pure delay, added on every message at exactly the moment the database is already
 * struggling. Collapsing them into a boolean makes a database blip cost every line an extra wait.
 */
type LeaseOutcome = { readonly kind: 'held'; readonly fence: string } | { readonly kind: 'refused' | 'unavailable' };

/**
 * Take the lease, answering `unavailable` rather than throwing.
 *
 * ⛔ THE LEASE MAY COST A BILLED CALL, NEVER AN ANSWER. A database blip while taking it must not fail a
 * parse that would otherwise have succeeded — the mechanism is an optimisation over a system that is
 * already correct without it, so the failure degrades to the pre-lease behaviour (both callers parse).
 *
 * ⛔ THE LEASE IS THE HANDLER TIMEOUT, not a number of its own. `RecipeWorkersStack.ts` declares a family
 * that "only means anything together" — handler timeout 150s, queue visibility 180s, claim lease equal to
 * the handler timeout — and this is the same class of number: how long before another actor may proceed.
 * Reusing `claimLeaseSeconds` puts it in that family instead of beside it.
 *
 * ⚠️ It also makes the duration safe in the direction that matters. Because a refusal is not a denial, an
 * over-long lease costs approximately nothing (the refused caller waits once and parses anyway) while an
 * UNDER-short one costs the duplicate the lease exists to prevent.
 *
 * ⛔ AND THE COUPLING IS MONOTONE IN THE SAFE DIRECTION, which is what makes reusing the number correct
 * rather than merely convenient. This lease is stamped at ACQUIRE time — after R17, after the claim, after
 * the allowance check — and then runs for the handler's full length, so it cannot expire while its holder
 * is alive whether that timeout is later raised or cut. ⚠️ The consequence, stated because it is the part
 * a reader needs: a row therefore OUTLIVES a killed holder by the pre-acquire elapsed time. That is the
 * harmless direction — a stale row is taken over by the next acquirer, and the fenced release means its
 * original holder cannot delete the successor.
 *
 * @param deps - The handler's dependencies, for the pool and the lease duration.
 * @param lineDigest - The line to serialise on.
 * @returns Which of the three outcomes occurred.
 * @sideEffect One conditional upsert; swallows its rejection.
 */
async function takeParseLease(deps: ParseLineDeps, lineDigest: string): Promise<LeaseOutcome> {
    try {
        const grant = await acquireParseLease(deps.pool, lineDigest, deps.claimLeaseSeconds);

        if (grant.held) {
            return { kind: 'held', fence: grant.fence };
        }

        // ⛔ COUNTED, not just logged. Refusal and unavailability are both invisible in CloudWatch
        // otherwise — indistinguishable from a healthy run — and the second is the one that matters: a
        // missing table or a missing grant makes EVERY line `unavailable` forever while the system looks
        // fine. The sibling degradation in `processParseLine` (`ParseClaimRefused`) already counts for this reason.
        emitMetric({
            namespace: 'Commise/RecipeWorkers',
            name: 'ParseLeaseRefused',
            unit: 'Count',
            stage: deps.stage,
            value: 1,
        });

        return { kind: 'refused' };
    } catch (error) {
        logger.warn('parse-line could not consult the parse lease; parsing without it', {
            error: error instanceof Error ? error.message : String(error),
        });
        emitMetric({
            namespace: 'Commise/RecipeWorkers',
            name: 'ParseLeaseUnavailable',
            unit: 'Count',
            stage: deps.stage,
            value: 1,
        });

        return { kind: 'unavailable' };
    }
}

/**
 * Give the lease back, never failing the parse that just succeeded.
 *
 * ⚠️ A release that throws leaves a row one lease-duration from expiring, which costs at most one
 * duplicate parse of one line. Re-raising here would instead fail a line that already has its answer.
 *
 * @param deps - The handler's dependencies, for the pool.
 * @param lineDigest - The line to release.
 * @param fence - The `leased_until` this caller was granted; a release without it could delete a LATER
 *     holder's live lease.
 * @sideEffect One DELETE; swallows its rejection.
 */
async function dropParseLease(deps: ParseLineDeps, lineDigest: string, fence: string): Promise<void> {
    try {
        await releaseParseLease(deps.pool, lineDigest, fence);
    } catch (error) {
        logger.warn('parse-line could not release the parse lease; it will expire', {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

/** Everything the handler talks to, injected — the `verifyLine.ts` discipline. */
export interface ParseLineDeps {
    readonly stage: string;
    readonly gated: GatedLlmDeps;
    readonly crf: ParseEnginePort<'crf'>;
    readonly pool: ParseQueryable;
    readonly digest: HexDigest;
    /**
     * Publishes one EMF metric. REQUIRED, never optional: an optional emitter keeps every call site
     * compiling and is exactly how a detector ships wired to nothing.
     */
    readonly emit: (metric: EmfMetric) => void;
    /** The parse model's bare id — a field so the suite can pin behaviour without the registry. */
    readonly parseModelId: string;
    /**
     * How long a claim holds the line, in seconds — the CLAIM LEASE (U6).
     *
     * ⛔ It is the handler's OWN timeout, and both halves of that matter. A duplicate delivered while the
     * first attempt is still running is refused, because the first attempt cannot outlive this. A genuine
     * redelivery is admitted, because SQS only makes one after the queue's visibility timeout, which the
     * stack sets ABOVE the handler timeout for exactly that margin. Setting it here from the stack's own
     * `timeout` is what keeps the two from being independently chosen numbers that drift into agreeing on
     * nothing.
     */
    readonly claimLeaseSeconds: number;
    /**
     * Deliveries a line may claim before it becomes user-retryable (U6).
     *
     * ⛔ NOT the queue's `maxReceiveCount` — they count different things, and U8 made the difference
     * visible by raising that one to survive a nine-hour nightly database stop. A RECEIVE is spent whenever
     * SQS hands the message over, including when this handler cannot reach the database at all; an ATTEMPT
     * is recorded only by a successful CLAIM, which needs that database. So an outage spends receives and
     * never a line's allowance.
     *
     * Past the allowance the line becomes `failed_retryable`, which is precisely the population
     * `POST :id/retry` re-drives, and the message completes rather than dead-lettering with nothing written
     * on the line itself — an import stuck `pending` until its TTL, with no signal and no action.
     */
    readonly deliveryAllowance: number;
    /**
     * How a refused caller waits for the holder, injected.
     *
     * ⛔ IT IS A COLLABORATOR, so it obeys this interface's own rule — everything the handler talks to is
     * injected. An inline `setTimeout` left the one branch the three-state split exists for unobservable:
     * a test could see that `unavailable` released nothing, but so did `refused`, so the two cases had
     * identical assertions and collapsing the states back into a boolean passed them both.
     */
    readonly sleep: (milliseconds: number) => Promise<void>;
}

/**
 * Why a line was made `failed_retryable` without an engine ever answering (U6).
 *
 * A code rather than prose because the retry surface reads it: "we kept trying and could not get to it" is
 * a different thing to tell a cook than "we read this line and could not understand it", and only the
 * second is the `unparseable` the pipeline produces.
 */
export const DELIVERY_ALLOWANCE_EXHAUSTED = 'delivery_allowance_exhausted';

/**
 * Claim one line ahead of any paid work: assert the job is unexpired, the stored digest matches, the line is
 * still claimable and no other delivery holds the lease — and record this delivery.
 *
 * ⛔ ONE STATEMENT, and every conjunct earns its place. `j.expires_at > now()` refuses work for a job whose
 * sweep will discard the answer; `l.status = 'pending'` refuses a line already parsed; `l.line_digest = $3`
 * refuses a message for a phrase that has since been edited; the `last_received_at` term is the lease that
 * refuses a concurrent duplicate. Splitting them into a SELECT and then an UPDATE would make every one of
 * them a check-then-act — the row lock this statement takes is what makes two simultaneous deliveries
 * resolve to one claim rather than two.
 *
 * ⚠️ `COALESCE(attempts, 0)` because migration 0046 is EXPAND-FIRST (ADR-0035): rows written by the release
 * before it carry NULL, and no backfill ran. `RETURNING` gives the POST-increment value, which is the number
 * the allowance is compared against.
 *
 * @param deps - The handler's dependencies (pool + lease).
 * @param message - The delivered message.
 * @param storedDigest - The digest recomputed from the message's own line.
 * @returns The attempt number this delivery claimed, or `undefined` when the claim was refused.
 * @sideEffect Updates `recipe_parse_job_lines` (attempts/last_received_at/updated_at).
 */
async function claimLine(
    deps: ParseLineDeps,
    message: ParseLineJobMessage,
    storedDigest: string,
): Promise<number | undefined> {
    const claimed = await deps.pool.query(
        `UPDATE recipe_parse_job_lines l
            SET attempts = COALESCE(l.attempts, 0) + 1,
                last_received_at = now(),
                updated_at = now()
           FROM recipe_parse_jobs j
          WHERE l.job_id = $1
            AND l.line_index = $2
            AND l.line_digest = $3
            AND l.status = 'pending'
            AND j.id = l.job_id
            AND j.expires_at > now()
            AND (l.last_received_at IS NULL OR l.last_received_at < now() - make_interval(secs => $4))
        RETURNING l.attempts`,
        [message.jobId, message.lineIndex, storedDigest, deps.claimLeaseSeconds],
    );

    return (claimed.rows[0] as { attempts: number } | undefined)?.attempts;
}

/** How one line's landing is classified. Exported for the landing-split tests — pure. */
export function landingOf(parsed: ParsedLine | null): { status: string; proposal: ParsedLine | null } {
    if (parsed === null) {
        return { status: 'failed_retryable', proposal: null };
    }

    if (bindsNothing(parsed)) {
        // R6's recorded terminal state: the proposal is KEPT, nothing binds, and the cook can still edit
        // the line. `unparseable` is terminal and offers no retry, but it keeps the proposal, so nothing is
        // lost — only the false claim that the line was read. What counts as binding nothing, and why a
        // MIXED exhaustion (foods that survived, beside a `not_a_food` record of the ones dropped) is NOT
        // this case, is stated once on `bindsNothing`.
        //
        // ⛔ Pinned by `__tests__/parseLine.test.ts`, "a MIXED-exhaustion line — kept foods beside a
        // not_a_food record — lands 'parsed', not 'unparseable'".
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

    // ⛔ THE CLAIM, ahead of every engine (U6). Until this landed, a delivery paid for its CRF invoke and
    // its gated Bedrock call and only then discovered the job had expired, or the line was already parsed,
    // or another delivery of the same line was mid-flight. Zero rows IS the refusal, and the message
    // completes having invoked nothing.
    const attempt = await claimLine(deps, message, recomputed);

    if (attempt === undefined) {
        logger.info('parse-line claim refused; nothing was invoked', {
            jobId: message.jobId,
            lineIndex: message.lineIndex,
        });
        emitMetric({
            namespace: 'Commise/RecipeWorkers',
            name: 'ParseClaimRefused',
            unit: 'Count',
            stage: deps.stage,
            value: 1,
        });

        return;
    }

    // ⛔ Past the allowance, STOP — and say so on the line. A line that keeps being redelivered without
    // landing is invisible today: it stays `pending` until its job's TTL sweeps the whole import, with no
    // signal and nothing the cook can do. `failed_retryable` is exactly the population the retry endpoint
    // re-drives, and completing here means the message never dead-letters with the line left silent.
    if (attempt > deps.deliveryAllowance) {
        await deps.pool.query(
            `UPDATE recipe_parse_job_lines
                SET status = 'failed_retryable', failure_code = $4, updated_at = now()
              WHERE job_id = $1 AND line_index = $2 AND line_digest = $3 AND status = 'pending'`,
            [message.jobId, message.lineIndex, recomputed, DELIVERY_ALLOWANCE_EXHAUSTED],
        );
        await deps.pool.query(PARSE_JOB_AGGREGATE_SQL, [message.jobId]);
        logger.warn('parse-line exhausted its delivery allowance; the line is now user-retryable', {
            jobId: message.jobId,
            lineIndex: message.lineIndex,
            attempts: attempt,
        });

        return;
    }

    // ⛔ SERIALISE THIS LINE AGAINST ANY OTHER INVOCATION ASKING ABOUT IT RIGHT NOW. Every other dedup
    // layer needs an answer to already exist — copy-forward, the cache, and the pipeline's own collapse of
    // a line repeated inside one paste. The case none of them covers is two submissions of a
    // never-answered digest in flight together: both read the cache, both miss, both call the engines.
    //
    // ⚠️ IT IS AN OPTIMISATION AND IS TREATED AS ONE. A refusal means "somebody else is asking", never "do
    // not ask", so the wait is bounded and the parse proceeds either way. Treating it as a denial would
    // strand a cook's line behind a holder that crashed — strictly worse than the duplicate call this
    // avoids. A lease that cannot be CONSULTED is different again — there is no holder to wait for, so that
    // case parses immediately rather than adding a wait to every line while the database is struggling.
    const lease = await takeParseLease(deps, recomputed);

    if (lease.kind === 'refused') {
        // One bounded wait, not a poll: the holder is mid-parse and the pipeline below reads the cache
        // first, so a holder that has since landed costs this line no engine call at all. The trade is
        // Lambda milliseconds against a billed model call; see `PARSE_LEASE_WAIT_MS` for what is and
        // is not measured about it.
        //
        // ⚠️ IT IS PAID EVEN WHEN THE ANSWER ALREADY EXISTS. The cache read lives inside the pipeline
        // below, so a line another owner has already answered still waits here before hitting that cache —
        // on that path the wait is pure loss rather than a degradation to pre-lease behaviour. Peeking at
        // the cache first would put a second copy of the pipeline's own read in this handler, which is the
        // duplicated knowledge DRY governs, so the cost is recorded rather than paid to avoid.
        await deps.sleep(PARSE_LEASE_WAIT_MS);
    }

    try {
        await parseAndLand(deps, message, recomputed);
    } finally {
        if (lease.kind === 'held') {
            await dropParseLease(deps, recomputed, lease.fence);
        }
    }
}

/**
 * Run the pipeline for one line and land whatever it produced.
 *
 * Extracted so the lease above can wrap it in a `try`/`finally` without indenting the whole body — the
 * release must happen on every path, including a throw the handler re-raises for redelivery.
 *
 * @param deps - The handler's dependencies.
 * @param message - The line being parsed.
 * @param recomputed - The digest recomputed from this message's own line (R17).
 * @sideEffect Calls the engines, writes the cache, and lands the line.
 */
async function parseAndLand(deps: ParseLineDeps, message: ParseLineJobMessage, recomputed: string): Promise<void> {
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

    const discarded = (landed as { rowCount?: number }).rowCount === 0;

    // ⛔ BOTH OUTCOMES PUBLISH — see `PARSE_LANDING_DISCARDED_METRIC_NAME`. The `0` is not noise, it is
    // the denominator: without it the alarm can only count discards, and a count means something different
    // at every traffic level. It sits AFTER the update and BEFORE the early return so neither branch can
    // skip it.
    deps.emit({
        namespace: PARSE_METRIC_NAMESPACE,
        name: PARSE_LANDING_DISCARDED_METRIC_NAME,
        unit: 'Count',
        stage: deps.stage,
        value: discarded ? 1 : 0,
    });

    if (discarded) {
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
        emit: emitMetric,
        parseModelId: PARSE_LEG_MODEL_ID,
        // ⛔ Both come from the STACK, which owns the queue and the function they describe: the lease is the
        // function's own `timeout` and the allowance is its `CLAIM_ATTEMPT_ALLOWANCE`. Defaulting them
        // here would make this the second place either number lives, and the failure of a copy that drifts
        // is silent — a lease longer than the visibility timeout refuses every genuine redelivery.
        claimLeaseSeconds: requirePositiveEnv('PARSE_CLAIM_LEASE_SECONDS'),
        deliveryAllowance: requirePositiveEnv('PARSE_DELIVERY_ALLOWANCE'),
        sleep: realSleep,
    };

    return cachedDeps;
}

/**
 * Read a positive integer from the environment, failing CLOSED.
 *
 * ⚠️ There is no default on purpose. Both callers describe infrastructure this process does not own, and a
 * fallback would let the handler run happily against a queue whose real numbers it had never been told —
 * the shape of defect `FOOD_LEASE_TIMEOUT_SECONDS` had when three copies of `30` outvoted the configured
 * one.
 *
 * @param name - The variable's name.
 * @returns The parsed value.
 * @throws When the variable is absent or not a positive integer.
 * @sideEffect Reads `process.env`.
 */
function requirePositiveEnv(name: string): number {
    const parsed = Number(process.env[name]);

    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }

    return parsed;
}

/**
 * SQS entry point. `batchSize: 1` — one record is one line, and a DLQ message maps to one un-landed line.
 *
 * @sideEffect Everything {@link processParseLine} does.
 */
const rawHandler: SQSHandler = async (event) => {
    const stage = process.env['STAGE'];
    const region = process.env['AWS_REGION'];

    if (stage === undefined || region === undefined) {
        throw new Error('STAGE and AWS_REGION are required');
    }

    // Built on the FIRST valid message, not before the loop: a batch that is entirely junk (the case the
    // block below exists for) then constructs no Bedrock client, no Lambda client and no database pool.
    let deps: ParseLineDeps | undefined;

    for (const record of event.Records) {
        // ⛔ GR-018 §18-b: a body that is not JSON, or is JSON the schema refuses, CANNOT become valid by
        // being sent again. It used to throw here, which redelivered it up to `maxReceiveCount` (20 on this
        // queue) before the DLQ — twenty deliveries of a message that was never going to land, and the
        // producer bug buried under them. It is now recorded once and completed. A TRANSIENT failure inside
        // `processParseLine` — an engine, Bedrock, the database — still throws, which is what redelivery is
        // for; the two are told apart by `isInvalidPayload`, never by a catch-all.
        let message: ParseLineJobMessage;

        try {
            message = parseRecord(record);
        } catch (error) {
            if (!isInvalidPayload(error)) {
                throw error;
            }

            recordInvalidPayload({ stage, queue: 'parse', messageId: record.messageId, error });
            continue;
        }

        deps ??= productionDeps(stage, region);
        await processParseLine(deps, message);
    }
};

// Re-exported so the suite can assert transience classification without reaching into the module.
export { isBedrockClientError };

/**
 * ⛔ WRAPPED, so a thrown error becomes a Sentry ISSUE rather than only a log line (plan U16).
 *
 * The log drain (U15) already carries this function's stdout to Sentry, and a forwarded log line is a log
 * line: it does not group, it carries no stack trace Sentry can symbolicate, and nothing alerts on it.
 * Errors and logs are different products, and only one of them pages anybody.
 *
 * ⚠️ Inert without a DSN — `withObservability` hands back the handler it was given — so local runs, the
 * unit suite and any stage whose parameter is unwritten behave exactly as before.
 */
initObservability();

export const handler = withObservability(rawHandler);
