/**
 * THE CRF LEG'S FAILURE TAXONOMY, and the metric that makes a vanished engine visible.
 *
 * ## What this suite exists to prevent, stated as the defect it is a regression test for
 *
 * `kitchensink-ingredient-parser-{stage}` had never been deployed to any stage while `RecipeWorkersStack`
 * shipped `RecipeParseLineFunction` into every stage pointing `CRF_FUNCTION_NAME` at it. Nothing went red:
 * this adapter mapped EVERY failure — a function that does not exist included — to `{ unavailable: true }`
 * per line, and ADR-0026 §3 reads that as `single-engine llm`. The two-engine pipeline degraded to one
 * engine behind green checks, and because the LLM leg is UNGATED in `pr-{N}` the absence quietly moved
 * spend onto Bedrock.
 *
 * The distinction this suite pins is the one that was missing:
 *
 *  - **a per-line `status: 'failed'`** is a fact about ONE LINE the engine read and could not parse. The leg
 *    worked. It is absence for that line and NOTHING else.
 *  - **an invocation that produced no engine answer at all** — the function is gone, the role cannot invoke
 *    it, it cold-started into an `ImportError`, it answered something that is not the engine's contract — is
 *    not a per-line outcome. It is the ENGINE being absent, and it must be reported as such.
 *
 * ⛔ Both still reach the comparator as absence. ADR-0026 §3 does not move: an engine that failed is never
 * dissent. What changes is that the systemic class is now REPORTED (a rejection the pipeline surfaces
 * through `onTierFailure`) and COUNTED (an EMF series), instead of being indistinguishable from a line the
 * engine legitimately declined.
 *
 * ⛔ The metric is emitted on BOTH paths — 0 when the leg answered, 1 when it did not. A metric emitted only
 * by the path that works is exactly the blindness ADR-0024 §4 records about its own layer 4 ("it is emitted
 * BY the gated path, so a caller that skips the gate emits nothing"). A CRF that is GONE must produce a
 * POSITIVE datapoint, not an absence of datapoints, or the alarm watching it reports a confident `OK` under
 * `treatMissingData: NOT_BREACHING`.
 */
import { describe, expect, it, vi } from 'vitest';
import { MAX_LINES } from '@kitchensink/ingredient-parser';

import type { EmfMetric } from '../../common/metrics.js';
import {
    CRF_UNAVAILABLE_METRIC_NAME,
    PARSE_METRIC_NAMESPACE,
    createCrfInvokeEngine,
    isCrfEngineUnavailableError,
} from '../crfInvoke.js';

const ENGINE_VERSION = 'ingredient-parser-nlp==2.3.0';
const STAGE = 'sandbox';
const LINE = '2 cups all-purpose flour';

/** One engine result the response schema accepts. */
const okResult = (sentence: string) => ({
    status: 'parsed',
    sentence,
    measure: '2 cups',
    names: ['all-purpose flour'],
    size: null,
    preparation: null,
    comment: null,
});

/** One engine response envelope. `engine` is a literal the schema requires. */
const responseOf = (results: readonly unknown[], engineVersion = ENGINE_VERSION) => ({
    engine: 'crf',
    engineVersion,
    results,
});

/** A Lambda `send` double: `outcome` is thrown, or resolved as the invoke response. */
function clientOf(outcome: unknown | (() => never)) {
    return {
        send: vi.fn().mockImplementation(() => {
            if (typeof outcome === 'function') {
                (outcome as () => never)();
            }

            return Promise.resolve(outcome);
        }),
    };
}

/** An invoke response carrying `body` as its JSON payload. */
const payloadOf = (body: unknown) => ({ Payload: Buffer.from(JSON.stringify(body)) });

function build(outcome: unknown | (() => never)) {
    const emitted: EmfMetric[] = [];
    const client = clientOf(outcome);
    const engine = createCrfInvokeEngine({
        functionName: 'kitchensink-ingredient-parser-sandbox',
        client: client as never,
        declaredEngineVersion: ENGINE_VERSION,
        stage: STAGE,
        emit: (metric) => emitted.push(metric),
    });

    return { engine, emitted, client };
}

/** Every availability datapoint this run published. */
const availability = (emitted: readonly EmfMetric[]): readonly EmfMetric[] =>
    emitted.filter((metric) => metric.name === CRF_UNAVAILABLE_METRIC_NAME);

describe('the CRF leg answered', () => {
    it('publishes a ZERO availability datapoint — the series must have data when healthy', async () => {
        // ⛔ Not "publishes nothing on success". A series that only ever receives a 1 has NO datapoints in a
        // healthy stage, which under NOT_BREACHING reports OK — and leaves an operator unable to tell "the
        // CRF is fine" from "nobody has parsed anything since the alarm was created".
        const { engine, emitted } = build(payloadOf(responseOf([okResult(LINE)])));

        await engine.parse([LINE]);

        expect(availability(emitted)).toEqual([
            {
                namespace: PARSE_METRIC_NAMESPACE,
                name: CRF_UNAVAILABLE_METRIC_NAME,
                unit: 'Count',
                stage: STAGE,
                value: 0,
            },
        ]);
    });

    it('⛔ a per-line `failed` is a fact about the LINE, not about the engine — availability stays 0', async () => {
        // THE CRUX. The engine ran, read the line, and declined it. Counting that as engine absence would
        // make a corpus of hard lines look like an outage, and — the direction that actually matters — would
        // make the alarm's threshold a function of the CORPUS rather than of the deployment.
        const { engine, emitted } = build(
            payloadOf(responseOf([{ status: 'failed', sentence: '...', reason: 'no tokens' }, okResult(LINE)])),
        );

        const answers = await engine.parse(['...', LINE]);

        expect(answers[0]).toEqual({ unavailable: true });
        expect(answers[1]).not.toEqual({ unavailable: true });
        expect(availability(emitted).map((metric) => metric.value)).toEqual([0]);
    });

    it('publishes one datapoint per CHUNK, so the ratio is per invocation', async () => {
        const lines = Array.from({ length: MAX_LINES + 1 }, (_line, index) => `${index} cups flour`);
        const { engine, emitted, client } = build(null);

        client.send.mockImplementation((command: { input: { Payload: Uint8Array } }) => {
            const request = JSON.parse(Buffer.from(command.input.Payload).toString('utf8')) as { lines: string[] };

            return Promise.resolve(payloadOf(responseOf(request.lines.map((line) => okResult(line)))));
        });

        await engine.parse(lines);

        expect(client.send).toHaveBeenCalledTimes(2);
        expect(availability(emitted).map((metric) => metric.value)).toEqual([0, 0]);
    });
});

describe('the CRF leg was UNREACHABLE — not a per-line outcome at all', () => {
    /** Each of these is "no engine answer was produced", and each must reject rather than degrade. */
    const unreachable: readonly [string, unknown | (() => never)][] = [
        [
            'the function does not exist',
            () => {
                throw Object.assign(new Error('Function not found'), { name: 'ResourceNotFoundException' });
            },
        ],
        [
            'the role may not invoke it',
            () => {
                throw Object.assign(new Error('not authorized'), { name: 'AccessDeniedException' });
            },
        ],
        ['it cold-started into an ImportError', { FunctionError: 'Unhandled', Payload: Buffer.from('{}') }],
        ['it answered with no payload at all', {}],
    ];

    it.each(unreachable)('rejects and counts the leg absent: %s', async (_case, outcome) => {
        const { engine, emitted } = build(outcome);

        await expect(engine.parse([LINE])).rejects.toSatisfy(isCrfEngineUnavailableError);
        expect(availability(emitted).map((metric) => metric.value)).toEqual([1]);
    });

    it('names the reason `unreachable`, so an operator is not sent to look at the response shape', async () => {
        const { engine } = build(() => {
            throw new Error('socket hang up');
        });

        await expect(engine.parse([LINE])).rejects.toMatchObject({ reason: 'unreachable' });
    });

    it('⛔ REJECTS rather than returning absence — the pipeline must be able to SEE it', async () => {
        // `runParsePipeline` reports an engine only through `Promise.allSettled`'s rejected branch
        // (`onTierFailure`). An adapter that swallows the failure and returns `unavailable` per line is
        // reported NOWHERE — which is precisely how a Lambda that had never been deployed produced a green
        // pipeline. The rejection is contained by KTD-12 and still reads as absence for every line.
        const { engine } = build({});

        await expect(engine.parse([LINE, LINE])).rejects.toThrow();
    });
});

describe('the CRF leg broke its CONTRACT — it ran, and answered something else', () => {
    it('rejects when the payload is not the engine response, and counts the leg absent', async () => {
        const { engine, emitted } = build(payloadOf(responseOf('not-an-array' as never)));

        await expect(engine.parse([LINE])).rejects.toMatchObject({ reason: 'contract' });
        expect(availability(emitted).map((metric) => metric.value)).toEqual([1]);
    });

    it('rejects on an engine-version mismatch — a row written under the wrong pin is permanent', async () => {
        // The refusal itself is not new (a mis-keyed cache row survives its whole generation, because the
        // write is DO NOTHING). What is new is that it no longer looks like a hard line: this is deploy
        // SKEW between two CDK apps nothing orders (ADR-0022's residual risk), and it is the engine being
        // unusable, not the corpus being difficult.
        const { engine, emitted } = build(payloadOf(responseOf([okResult(LINE)], 'ingredient-parser-nlp==2.2.0')));

        await expect(engine.parse([LINE])).rejects.toMatchObject({ reason: 'contract' });
        expect(availability(emitted).map((metric) => metric.value)).toEqual([1]);
    });
});

describe('a MULTI-CHUNK batch', () => {
    it('⛔ rejects the WHOLE batch when a later chunk is absent, having counted both invocations', async () => {
        // Returning chunk 1's parses beside chunk 2's outage is the silent single-engine degradation this
        // module exists to stop — some lines would land under the outage and nothing downstream could tell
        // which. The cache is what makes the all-or-nothing affordable: a redelivery re-pays only for the
        // lines that never landed (KTD-F).
        const lines = Array.from({ length: MAX_LINES + 1 }, (_line, index) => `${index} cups flour`);
        const { engine, emitted, client } = build(null);
        let call = 0;

        client.send.mockImplementation((command: { input: { Payload: Uint8Array } }) => {
            const request = JSON.parse(Buffer.from(command.input.Payload).toString('utf8')) as { lines: string[] };

            call += 1;

            return call === 1
                ? Promise.resolve(payloadOf(responseOf(request.lines.map((line) => okResult(line)))))
                : Promise.reject(Object.assign(new Error('Function not found'), { name: 'ResourceNotFound' }));
        });

        await expect(engine.parse(lines)).rejects.toSatisfy(isCrfEngineUnavailableError);
        expect(availability(emitted).map((metric) => metric.value)).toEqual([0, 1]);
    });
});

describe('the error type', () => {
    it('⛔ carries NO source line — a CRF failure must not put the cook’s text into CloudWatch', async () => {
        // KTD-14 kept user text out of these tables by design, and `UnreadablePayload` carries an IDENTITY
        // and no error for the same reason. The handler logs `error.message`, and an EMF/stdout line does
        // not pass through the Sentry scrubbers, so the message is a place user text would actually land.
        const secret = 'a pound of my-very-identifying-ingredient';
        const { engine } = build(() => {
            throw new Error('socket hang up');
        });
        const error = await engine.parse([secret]).catch((caught: unknown) => caught);

        expect(String(error)).not.toContain('my-very-identifying-ingredient');
        expect((error as Error).message).toContain('unreachable');
    });

    it('is a real Error subclass with a matching guard, and refuses look-alikes', async () => {
        const { engine } = build({});
        const error = await engine.parse([LINE]).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(Error);
        expect(isCrfEngineUnavailableError(error)).toBe(true);
        expect(isCrfEngineUnavailableError(new Error('unreachable'))).toBe(false);
        expect(isCrfEngineUnavailableError({ reason: 'unreachable' })).toBe(false);
    });
});
