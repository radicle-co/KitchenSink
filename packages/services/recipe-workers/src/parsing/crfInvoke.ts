/**
 * The CRF engine over a LAMBDA INVOKE (plan U8) — the service leg's adapter for
 * `packages/services/ingredient-parser` (ADR-0025's Python deployable).
 *
 * ⛔ The port takes LINES AND NOTHING ELSE (ADR-0026 §1's independence), and the transport validates the
 * declared engine version against the response's own (the engine-schema contract: a stale declaration is
 * reachable because "nothing orders two CDK apps" — ADR-0022's residual risk).
 *
 * ## ⛔ TWO KINDS OF FAILURE, AND COLLAPSING THEM IS WHAT HID A LAMBDA THAT DID NOT EXIST
 *
 * This adapter used to map every failure — a `ResourceNotFoundException` for a function that had never been
 * deployed included — to `{ unavailable: true }` per line. ADR-0026 §3 reads that as `single-engine llm`, so
 * the two-engine pipeline degraded to one engine with no error, no alarm and green CI, while the UNGATED
 * `pr-{N}` LLM leg silently absorbed the work. It stayed that way across every stage until someone went
 * looking. The two facts it conflated are:
 *
 *  - **PER LINE.** A `status: 'failed'` row is the engine reporting on ONE LINE it read and could not parse.
 *    The leg worked. It is absence for that line and nothing more — never a `ParsedLine` with empty fields,
 *    because "no opinion" and "read it and found no food" are different facts.
 *  - **PER LEG.** An invocation that produced no engine answer at all — the function is gone, the role may
 *    not invoke it, it cold-started into an `ImportError`, it answered something that is not the engine's
 *    contract, or it reported a version this deploy did not ask for — is not a per-line outcome. It is the
 *    ENGINE being absent, and it {@link CrfEngineUnavailableError | REJECTS}.
 *
 * ⛔ ADR-0026 §3 DOES NOT MOVE. A rejected batch still reaches the comparator as absence for every line in
 * it (`consultEngines` contains the rejection under KTD-12), so a failed engine is still silence and never
 * dissent. What the rejection buys is that the pipeline can SEE it: `onTierFailure('crf', …)` fires, and
 * ADR-0026's 2026-08-31 update puts "a CRF invocation failure" in the TRANSIENT set — the line retries
 * instead of landing an outage as its permanent answer. An adapter that returns absence instead of throwing
 * is reported NOWHERE, which is exactly how this shipped.
 *
 * ⚠️ A chunk that fails takes the WHOLE batch's answers with it. That is deliberate: returning chunk 1's
 * parses beside chunk 2's outage is precisely the silent single-engine degradation this module exists to
 * stop, and the parse cache means a redelivery re-pays only for what never landed (KTD-F).
 *
 * ## ⛔ THE AVAILABILITY METRIC IS EMITTED ON BOTH PATHS
 *
 * {@link CRF_UNAVAILABLE_METRIC_NAME} publishes 0 when the leg answered and 1 when it did not, once per
 * invocation. Both halves are load-bearing:
 *
 *  - **The 1 is emitted BY THE CALLER**, so an engine that is entirely gone produces a POSITIVE datapoint
 *    rather than an absence of datapoints. ADR-0024 §4 records the opposite shape as its own layer 4's
 *    blind spot — that metric "is emitted BY the gated path, so a caller that skips the gate emits nothing".
 *    A CRF availability metric emitted only from the working path would repeat the mistake exactly.
 *  - **The 0 keeps the series populated**, so a healthy stage is distinguishable from an idle one and the
 *    alarm's `Sum` is the failure COUNT with no metric-math expression. Without the 0s the alarm sits on a
 *    series that is empty whenever things work and, under `treatMissingData: NOT_BREACHING`, reports a
 *    confident OK — the never-fires defect `serviceInfraWiringInvariants` W4 exists for.
 */
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { engineResponseSchema, MAX_LINES } from '@kitchensink/ingredient-parser';
import { promoteCrfReading, type EngineAnswer, type ParseEnginePort } from '@kitchensink/recipe-import-core';

import { logger } from '../common/logger.js';
import type { EmfMetric } from '../common/metrics.js';

/**
 * The CloudWatch namespace the parse leg publishes under.
 *
 * ⛔ MUST EQUAL `PARSE_METRIC_NAMESPACE` in `infra/lib/RecipeWorkersStack.ts`. The alarm extracts by exact
 * namespace, dimension and metric name, so a divergence here fails nothing at deploy time — it leaves the
 * alarm watching a metric nobody publishes.
 */
export const PARSE_METRIC_NAMESPACE = 'Commise/RecipeParse';

/**
 * Whether the CRF leg was unusable for one invocation: `1` absent, `0` answered.
 *
 * ⚠️ 1 IS ONLY EVER SYSTEMIC ABSENCE. A line the engine READ and declined publishes a 0, because it is a fact
 * about the line and not about the leg — ADR-0026 §3's distinction, carried in the CLASSIFICATION rather than
 * left for the alarm to re-derive. That is what lets the alarm be a plain `Sum` over one period: every
 * datapoint in this series is already abnormal, so the count needs no ratio and no metric-math expression
 * (which `serviceInfraWiringInvariants` W3/W4 would both skip). The 0s are still published — they are what
 * distinguish a healthy stage from an idle one.
 */
export const CRF_UNAVAILABLE_METRIC_NAME = 'CrfEngineUnavailable';

/**
 * Why one CRF invocation produced no engine answer.
 *
 * The two lead to different first moves, which is the whole reason they are not one value: `unreachable`
 * sends an operator to the function and its grant, `contract` sends them to what the two CDK apps disagree
 * about. Neither is a fact about the line.
 */
export type CrfUnavailableReason = 'unreachable' | 'contract';

/**
 * The CRF leg produced no engine answer for a whole invocation.
 *
 * ⛔ THROWN rather than returned as per-line absence, so `runParsePipeline` reports it through
 * `onTierFailure` and the handler can classify it as transient. It still resolves to absence for every line
 * in the batch — the pipeline's `Promise.allSettled` contains it (KTD-12) — so ADR-0026 §3's "an engine that
 * failed is not a disagreement" holds unchanged.
 */
export class CrfEngineUnavailableError extends Error {
    /** Which class of absence this is. */
    public readonly reason: CrfUnavailableReason;

    /**
     * @param reason - Which class of absence this is.
     * @param message - What an operator needs to know, carrying NO line text (KTD-14).
     */
    public constructor(reason: CrfUnavailableReason, message: string) {
        super(message);
        this.name = 'CrfEngineUnavailableError';
        this.reason = reason;
        Object.setPrototypeOf(this, CrfEngineUnavailableError.prototype);
    }
}

/**
 * Whether a caught value is a {@link CrfEngineUnavailableError}.
 *
 * @param value - The caught value.
 * @returns `true` when it is one. Pure.
 */
export function isCrfEngineUnavailableError(value: unknown): value is CrfEngineUnavailableError {
    return value instanceof CrfEngineUnavailableError;
}

/** What the adapter needs. */
export interface CrfInvokeOptions {
    /** The parser Lambda's function name (env `CRF_FUNCTION_NAME`, set by the stack). */
    readonly functionName: string;
    /** The Lambda client, injected so the unit tier drives every outcome. */
    readonly client: Pick<LambdaClient, 'send'>;
    /** The engine version the STACK declares — asserted against the response's own. */
    readonly declaredEngineVersion: string;
    /**
     * The deploy stage.
     *
     * ⛔ The dimension the availability alarm selects. A metric published under the wrong stage is a metric
     * no alarm sees — the `Stage`-mismatch defect the archive backlog alarm shipped with.
     */
    readonly stage: string;
    /**
     * Where the availability datapoint goes. A port, like `GatedLlmDeps.emit`, so the unit tier observes the
     * series without reading stdout.
     */
    readonly emit: (metric: EmfMetric) => void;
}

/**
 * Build the CRF leg over the parser Lambda.
 *
 * @param options - The function name, client, declared version, stage, and metric sink.
 * @returns The port. Chunks to the Lambda's own `MAX_LINES` — a transport fact, owned here.
 */
export function createCrfInvokeEngine(options: CrfInvokeOptions): ParseEnginePort<'crf'> {
    return {
        engine: 'crf',
        engineVersion: options.declaredEngineVersion,
        async parse(lines): Promise<readonly EngineAnswer[]> {
            const answers: EngineAnswer[] = [];

            for (let start = 0; start < lines.length; start += MAX_LINES) {
                const chunk = lines.slice(start, start + MAX_LINES);
                answers.push(...(await invokeChunk(options, chunk)));
            }

            return answers;
        },
    };
}

/**
 * Record whether this invocation got an engine answer.
 *
 * @param options - Carries the stage and the sink.
 * @param unavailable - `true` when the leg produced nothing usable.
 * @sideEffect Publishes one EMF datapoint.
 */
function publishAvailability(options: CrfInvokeOptions, unavailable: boolean): void {
    options.emit({
        namespace: PARSE_METRIC_NAMESPACE,
        name: CRF_UNAVAILABLE_METRIC_NAME,
        unit: 'Count',
        stage: options.stage,
        value: unavailable ? 1 : 0,
    });
}

/**
 * Give up on this invocation: count the leg absent, log the cause, and reject.
 *
 * @param options - Carries the stage, the sink and the function name.
 * @param reason - Which class of absence this is.
 * @param detail - What an operator needs, carrying no line text.
 * @returns Never — it always throws.
 * @throws {CrfEngineUnavailableError} Always. That is the point.
 * @sideEffect Publishes the datapoint and writes one log line.
 */
function abandon(options: CrfInvokeOptions, reason: CrfUnavailableReason, detail: string): never {
    publishAvailability(options, true);
    logger.error('the CRF leg produced no engine answer', {
        reason,
        detail,
        functionName: options.functionName,
    });

    throw new CrfEngineUnavailableError(reason, `CRF leg ${reason}: ${detail}`);
}

/**
 * Read one chunk.
 *
 * @param options - The adapter's collaborators.
 * @param lines - At most `MAX_LINES` lines.
 * @returns One answer per line, in order. A line the engine declined is `{ unavailable: true }`.
 * @throws {CrfEngineUnavailableError} When the invocation produced no engine answer at all.
 * @sideEffect One Lambda invocation, plus one availability datapoint.
 */
async function invokeChunk(options: CrfInvokeOptions, lines: readonly string[]): Promise<readonly EngineAnswer[]> {
    let payload: unknown;

    try {
        const response = await options.client.send(
            new InvokeCommand({
                FunctionName: options.functionName,
                Payload: Buffer.from(JSON.stringify({ lines: [...lines] })),
            }),
        );

        if (response.FunctionError !== undefined) {
            // The function RAN and threw — an unhandled exception the Python handler did not convert into a
            // per-line `failed`. On a first deploy that is an `ImportError` from the packaged wheels
            // (ADR-0025's untested arm64/CPython 3.13 path), which fails every invocation identically.
            return abandon(options, 'unreachable', `the function returned ${response.FunctionError}`);
        }

        if (response.Payload === undefined) {
            return abandon(options, 'unreachable', 'the invocation returned no payload');
        }

        payload = JSON.parse(Buffer.from(response.Payload).toString('utf8'));
    } catch (error) {
        if (isCrfEngineUnavailableError(error)) {
            throw error;
        }

        // `ResourceNotFoundException` (the function does not exist — the defect this module's header
        // records), `AccessDeniedException` (the role's grant does not cover it), a throttle, a socket
        // failure, or a payload that is not JSON. None of them is evidence about an ingredient.
        return abandon(options, 'unreachable', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown');
    }

    const parsed = engineResponseSchema.safeParse(payload);

    if (!parsed.success) {
        // ⚠️ The zod issues are NOT relayed: they quote the payload, which carries the cook's own food names
        // (KTD-14). The identity of the failure is the function; the payload is in its own log group.
        return abandon(options, 'contract', 'the response did not satisfy the engine schema');
    }

    if (parsed.data.engineVersion !== options.declaredEngineVersion) {
        // ⛔ A row written under the wrong version is permanent within its generation (the cache write is
        // `DO NOTHING`), so a mismatch refuses the whole answer rather than caching it wrongly. It is also
        // deploy SKEW between two CDK apps nothing orders (ADR-0022's residual risk) — the engine being
        // unusable, not the corpus being difficult.
        return abandon(
            options,
            'contract',
            `declared ${options.declaredEngineVersion}, reported ${parsed.data.engineVersion}`,
        );
    }

    publishAvailability(options, false);

    return parsed.data.results.map((result, index) => {
        const line = lines[index] as string;

        if (result.status === 'failed') {
            // ⛔ PER LINE, and the leg is HEALTHY. Counted nowhere near the availability series: the engine
            // read this line and declined it, and folding that in would make the alarm's threshold a
            // property of the corpus rather than of the deployment.
            return { unavailable: true };
        }

        return promoteCrfReading(
            {
                sentence: result.sentence,
                measure: result.measure,
                names: result.names,
                size: result.size,
                preparation: result.preparation,
                comment: result.comment,
            },
            line,
        );
    });
}
