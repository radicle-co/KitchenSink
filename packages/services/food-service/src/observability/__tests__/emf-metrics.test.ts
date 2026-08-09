/**
 * Unit suite for the worker EMF metric emitter (T-181). Asserts the exact CloudWatch Embedded Metric
 * Format JSON shape (so CloudWatch auto-extracts the metrics from the worker log group with no extra
 * IAM), the canonical metric-name constants, the namespace, the dimension-set encoding, and that the
 * typed recorder methods produce the right name/unit/dimension on a single stdout line.
 *
 * @implements SC-002 SC-006 US-10
 */
import { describe, it, expect, vi } from 'vitest';

import {
    buildEmf,
    emitMetric,
    FoodMetrics,
    FOOD_METRIC,
    FOOD_METRIC_NAMESPACE,
    type EmfPayload,
} from '../emf-metrics.js';

describe('emf-metrics', () => {
    describe('FOOD_METRIC names', () => {
        it('exposes the canonical metric-name literals (the dashboard/alarm contract)', () => {
            expect(FOOD_METRIC_NAMESPACE).toBe('Commise/Food');
            expect(FOOD_METRIC).toEqual({
                fetchQueueDepth: 'food-fetch-queue-depth',
                resolutionLatencySeconds: 'food-resolution-latency-seconds',
                sourceRollingWindowCount: 'source-rolling-window-count',
                sourceApiSuccessRate: 'source-api-success-rate',
                unresolvedBacklog: 'food-unresolved-backlog',
                tombstoneCount: 'food-tombstone-count',
                localStoreServeRate: 'food-local-store-serve-rate',
                auth401Rate: 'auth-401-rate',
                pendingAgeSeconds: 'food-fetch-pending-age-seconds',
                inFlightLeases: 'food-in-flight-leases',
                workerErrorCount: 'food-worker-error-count',
            });
        });
    });

    describe('buildEmf', () => {
        it('encodes a single dimensionless metric with the default namespace', () => {
            const payload = buildEmf({
                metrics: [{ name: FOOD_METRIC.fetchQueueDepth, value: 7, unit: 'Count' }],
                timestamp: 1_700_000_000_000,
            });

            expect(payload).toEqual({
                _aws: {
                    Timestamp: 1_700_000_000_000,
                    CloudWatchMetrics: [
                        {
                            Namespace: 'Commise/Food',
                            Dimensions: [[]],
                            Metrics: [{ Name: 'food-fetch-queue-depth', Unit: 'Count' }],
                        },
                    ],
                },
                'food-fetch-queue-depth': 7,
            } satisfies EmfPayload);
        });

        it('encodes a dimensioned metric with the dimension key in the dimension set and as a top-level field', () => {
            const payload = buildEmf({
                metrics: [{ name: FOOD_METRIC.sourceRollingWindowCount, value: 42, unit: 'Count' }],
                dimensions: { source: 'usda' },
                timestamp: 1_700_000_000_000,
            });

            expect(payload._aws.CloudWatchMetrics[0].Dimensions).toEqual([['source']]);
            expect(payload['source']).toBe('usda');
            expect(payload['source-rolling-window-count']).toBe(42);
        });
    });

    describe('emitMetric', () => {
        it('writes exactly one EMF JSON line containing the _aws envelope', () => {
            const lines: string[] = [];
            emitMetric(
                { metrics: [{ name: FOOD_METRIC.tombstoneCount, value: 3, unit: 'Count' }], timestamp: 1 },
                (line) => lines.push(line),
            );

            expect(lines).toHaveLength(1);

            const parsed = JSON.parse(lines[0]!) as EmfPayload;

            expect(parsed._aws.CloudWatchMetrics[0].Namespace).toBe('Commise/Food');
            expect(parsed['food-tombstone-count']).toBe(3);
        });
    });

    describe('FoodMetrics recorder', () => {
        it('records resolution latency in seconds (dimensionless)', () => {
            const sink = vi.fn();
            new FoodMetrics(sink).recordResolutionLatencySeconds(1.5);

            const parsed = JSON.parse(sink.mock.calls[0]![0] as string) as EmfPayload;

            expect(parsed._aws.CloudWatchMetrics[0].Metrics).toEqual([
                { Name: 'food-resolution-latency-seconds', Unit: 'Seconds' },
            ]);
            expect(parsed['food-resolution-latency-seconds']).toBe(1.5);
            expect(parsed._aws.CloudWatchMetrics[0].Dimensions).toEqual([[]]);
        });

        it('records per-source rolling-window count under a source dimension', () => {
            const sink = vi.fn();
            new FoodMetrics(sink).recordSourceWindowCount('usda', 12);

            const parsed = JSON.parse(sink.mock.calls[0]![0] as string) as EmfPayload;

            expect(parsed._aws.CloudWatchMetrics[0].Dimensions).toEqual([['source']]);
            expect(parsed['source']).toBe('usda');
            expect(parsed['source-rolling-window-count']).toBe(12);
        });

        /**
         * T-199(b) — SC-004 ("local-store serve rate > 80%") / SC-005. Emitted as ONE observation per
         * read (`100` served / `0` not) rather than a pre-computed ratio: a single API task cannot see the
         * rolling window SC-004 is defined over, and a horizontally scaled service would have as many
         * private ratios as tasks. CloudWatch does the aggregation — `Average` over any period IS the
         * serve-rate percentage, so the SC-004 bar reads directly as `> 80`, and `Sum / 100` is the served
         * read count SC-005 asks for.
         */
        it('records a served local-store read as 100 Percent (the CloudWatch Average is the serve rate)', () => {
            const sink = vi.fn();
            new FoodMetrics(sink).recordLocalStoreServe(true);

            const parsed = JSON.parse(sink.mock.calls[0]![0] as string) as EmfPayload;

            expect(parsed._aws.CloudWatchMetrics[0].Metrics).toEqual([
                { Name: 'food-local-store-serve-rate', Unit: 'Percent' },
            ]);
            expect(parsed['food-local-store-serve-rate']).toBe(100);
            expect(parsed._aws.CloudWatchMetrics[0].Dimensions).toEqual([[]]);
        });

        it('records an unserved read as 0 Percent (so it counts against the rate, not out of it)', () => {
            const sink = vi.fn();
            new FoodMetrics(sink).recordLocalStoreServe(false);

            const parsed = JSON.parse(sink.mock.calls[0]![0] as string) as EmfPayload;

            expect(parsed['food-local-store-serve-rate']).toBe(0);
            expect(parsed._aws.CloudWatchMetrics[0].Metrics[0]!.Unit).toBe('Percent');
        });

        it('records the operational snapshot gauges (queue depth, backlog, tombstone, pending age)', () => {
            const sink = vi.fn();
            const metrics = new FoodMetrics(sink);
            metrics.recordQueueDepth(11);
            metrics.recordUnresolvedBacklog(4);
            metrics.recordTombstoneCount(2);
            metrics.recordPendingAgeSeconds(360);

            const names = sink.mock.calls.map((call) => {
                const parsed = JSON.parse(call[0] as string) as EmfPayload;

                return parsed._aws.CloudWatchMetrics[0].Metrics[0]!.Name;
            });

            expect(names).toEqual([
                'food-fetch-queue-depth',
                'food-unresolved-backlog',
                'food-tombstone-count',
                'food-fetch-pending-age-seconds',
            ]);
        });
    });
});
