/**
 * How a transport reports the publisher's quota reading (ADR-0053 §5): after the source answered and the block the
 * reading earned is written, so a metric is all that is left.
 *
 * @module
 */
import type { CallableApiSourceId } from '../sourceRegister.js';
import type { QuotaReading } from './quotaHeaders.js';
import type { QuotaMetrics } from './transportPorts.js';

/**
 * Report a quota reading, swallowing the sink's own failure: it is a metric, and letting it throw would turn a response
 * already received into a failed call, so measuring the quota would lose the call it measured.
 *
 * @param metrics - The sink.
 * @param source - The source.
 * @param quota - The reading.
 * @sideEffect Emits a metric.
 */
export function reportQuotaReading(metrics: QuotaMetrics, source: CallableApiSourceId, quota: QuotaReading): void {
    try {
        metrics.recordSourceRateLimit(source, quota);
    } catch {
        // Deliberately ignored — see the docstring above.
    }
}
