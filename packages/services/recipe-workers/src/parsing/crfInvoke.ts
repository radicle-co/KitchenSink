/**
 * The CRF engine over a LAMBDA INVOKE (plan U8) — the service leg's adapter for
 * `packages/services/ingredient-parser` (ADR-0025's Python deployable).
 *
 * ⛔ The port takes LINES AND NOTHING ELSE (ADR-0026 §1's independence), and the transport validates the
 * declared engine version against the response's own (the engine-schema contract: a stale declaration is
 * reachable because "nothing orders two CDK apps" — ADR-0022's residual risk).
 *
 * ⛔ FAILURE IS PER LINE at the wire (a batch of 200 must not lose 199 parses), and a failed row maps to
 * `EngineUnavailable` for that line — never a `ParsedLine` with empty fields. A whole-invocation failure
 * maps every line to absence: the pipeline reads that as `single-engine llm`, never as dissent.
 */
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { engineResponseSchema, MAX_LINES } from '@kitchensink/ingredient-parser';
import { promoteCrfReading, type EngineAnswer, type ParseEnginePort } from '@kitchensink/recipe-import-core';

import { logger } from '../common/logger.js';

/** What the adapter needs. */
export interface CrfInvokeOptions {
    /** The parser Lambda's function name (env `CRF_FUNCTION_NAME`, set by the stack). */
    readonly functionName: string;
    /** The Lambda client, injected so the unit tier drives every outcome. */
    readonly client: Pick<LambdaClient, 'send'>;
    /** The engine version the STACK declares — asserted against the response's own. */
    readonly declaredEngineVersion: string;
}

/**
 * Build the CRF leg over the parser Lambda.
 *
 * @param options - The function name, client, and declared version.
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

/** @sideEffect One Lambda invocation. */
async function invokeChunk(options: CrfInvokeOptions, lines: readonly string[]): Promise<readonly EngineAnswer[]> {
    const absent = lines.map<EngineAnswer>(() => ({ unavailable: true }));

    let payload: unknown;

    try {
        const response = await options.client.send(
            new InvokeCommand({
                FunctionName: options.functionName,
                Payload: Buffer.from(JSON.stringify({ lines: [...lines] })),
            }),
        );

        if (response.FunctionError !== undefined || response.Payload === undefined) {
            logger.error('CRF invoke failed', { functionError: response.FunctionError ?? 'no payload' });

            return absent;
        }

        payload = JSON.parse(Buffer.from(response.Payload).toString('utf8'));
    } catch (error) {
        logger.error('CRF invoke failed', { error: error instanceof Error ? error.message : String(error) });

        return absent;
    }

    const parsed = engineResponseSchema.safeParse(payload);

    if (!parsed.success) {
        logger.error('CRF response failed the engine schema; the whole chunk is absent');

        return absent;
    }

    if (parsed.data.engineVersion !== options.declaredEngineVersion) {
        // ⛔ The contract on the adapter: a row written under the wrong version is permanent within its
        // generation, so a version mismatch refuses the whole answer rather than caching it wrongly.
        logger.error('CRF engine version mismatch; refusing the answer', {
            declared: options.declaredEngineVersion,
            reported: parsed.data.engineVersion,
        });

        return absent;
    }

    return parsed.data.results.map((result, index) => {
        const line = lines[index] as string;

        if (result.status === 'failed') {
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
