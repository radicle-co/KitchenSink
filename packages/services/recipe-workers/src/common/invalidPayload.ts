import { ZodError } from 'zod';

import { logger } from './logger.js';
import { emitMetric } from './metrics.js';

/**
 * The queues whose consumers can reject a payload on shape. Closed on purpose: the value reaches a log line
 * an operator reads to find WHICH producer is sending junk, and a free string would let two consumers spell
 * the same queue differently.
 */
export type InvalidPayloadQueue = 'parse' | 'verification' | 'archive' | 'handle-sync';

/** What a consumer knows about a payload it refused. */
export interface InvalidPayloadRecord {
    readonly stage: string;
    readonly queue: InvalidPayloadQueue;
    readonly messageId: string;
    readonly error: unknown;
}

/**
 * Whether an error means "this payload can never become valid", as opposed to "the world was briefly
 * unavailable".
 *
 * ⛔ GR-018 §18-b draws exactly this line: an invalid payload "cannot become valid by being sent again.
 * Retrying it converts a producer's bug into sustained load and buries the signal that would have found it",
 * while "the retry that IS legitimate is a transient-dependency failure — a database timeout, a 5xx from a
 * callee." Only the two shape failures answer true here: a body that is not JSON, and a body that is JSON but
 * fails its schema. Everything else — including an unrecognised error — is treated as transient, because
 * acknowledging real work is the worse mistake of the two.
 *
 * @param error - The thrown value, as caught.
 * @returns True when the payload itself is the defect. Pure.
 */
export function isInvalidPayload(error: unknown): boolean {
    return error instanceof ZodError || error instanceof SyntaxError;
}

/**
 * Record a refused payload: one counted metric and one log line carrying the reason.
 *
 * The metric is deliberately dimensioned by `Stage` alone. EMF bills every distinct dimension VALUE
 * combination as its own custom metric, and the queue is low-cardinality but the producer's message ids are
 * not — so the queue and the id travel in the log, where they cost nothing, and the metric stays a single
 * countable series per stage.
 *
 * @param record - The stage, queue, message id and the error that refused it.
 * @sideEffect Emits one EMF metric line and one error log line.
 */
export function recordInvalidPayload(record: InvalidPayloadRecord): void {
    emitMetric({
        namespace: 'Commise/RecipeWorkers',
        name: 'InvalidPayload',
        unit: 'Count',
        stage: record.stage,
        value: 1,
    });

    logger.error('invalid payload refused once and completed — never redelivered (GR-018 §18-b)', {
        queue: record.queue,
        messageId: record.messageId,
        reason: String(record.error),
    });
}
