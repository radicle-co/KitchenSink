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
} from '../emfMetrics.js';

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

        /**
         * ⛔ THE ASSERTION ABOVE IS A TAUTOLOGY ON ITS OWN — it restates the declaration it reads, so a name
         * declared and never published passes it forever. That is not hypothetical: T-181 is marked `[x]` done
         * and says all of these are "emitted via CloudWatch EMF to stdout", while TWO of them are emitted by
         * nothing. This test drives every recorder and reads the names back off the real EMF lines, so the
         * emitted set is measured rather than asserted from the constant block.
         *
         * `source-api-success-rate` (US-10 / `spec.md` "per-source success rate", `plan.md`) and
         * `auth-401-rate` (FR-052 auth load-shed signal, and the thing that surfaces a misconfigured
         * `CLERK_JWT_KEY`) have NO recorder and NO call site. They are listed here so the gap is visible
         * instead of disguised by a named constant, and the CDK does not chart or alarm either one — so
         * `serviceInfraWiringInvariants.test.ts`'s W3 (alarm name must be emitted somewhere) cannot see
         * this direction of the drift.
         *
         * ⚠️ Implementing one means MOVING its name from `pending` to `emitted` here. Both need a call site,
         * not just a recorder: a rate needs its denominator, so each must be emitted on every request /
         * every source call the way `recordLocalStoreServe` is, and each needs its dashboard widget.
         */
        it('emits every metric name it declares, except the two that are declared and unimplemented', () => {
            const lines: string[] = [];
            const metrics = new FoodMetrics((line) => lines.push(line));

            metrics.recordResolutionLatencySeconds(1);
            metrics.recordQueueDepth(1);
            metrics.recordUnresolvedBacklog(1);
            metrics.recordTombstoneCount(1);
            metrics.recordPendingAgeSeconds(1);
            metrics.recordInFlightLeases(1);
            metrics.recordWorkerError(1);
            metrics.recordLocalStoreServe(true);
            metrics.recordSourceWindowCount('usda', 1);

            const emitted = new Set(
                lines.flatMap((line) =>
                    (JSON.parse(line) as EmfPayload)._aws.CloudWatchMetrics.flatMap((directive) =>
                        directive.Metrics.map((metric) => metric.Name),
                    ),
                ),
            );
            const pending = Object.values(FOOD_METRIC).filter((name) => !emitted.has(name));

            expect([...emitted].sort()).toEqual([
                'food-fetch-pending-age-seconds',
                'food-fetch-queue-depth',
                'food-in-flight-leases',
                'food-local-store-serve-rate',
                'food-resolution-latency-seconds',
                'food-tombstone-count',
                'food-unresolved-backlog',
                'food-worker-error-count',
                'source-rolling-window-count',
            ]);
            expect(pending).toEqual([FOOD_METRIC.sourceApiSuccessRate, FOOD_METRIC.auth401Rate]);
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

        /**
         * A dimension with no value must not be DECLARED, because CloudWatch would then look for a field
         * `JSON.stringify` has already dropped and reject the whole line — losing the metric silently, which
         * is the worst outcome for an emitter whose only job is to make a failure visible. Reachable now that
         * `dimensions` is an allowlisted PARTIAL bag: `{ source: undefined }` typechecks.
         */
        it('declares no dimension for a facet whose value is absent', () => {
            const payload = buildEmf({
                metrics: [{ name: FOOD_METRIC.sourceRollingWindowCount, value: 1, unit: 'Count' }],
                dimensions: { source: undefined },
                timestamp: 1,
            });

            expect(payload._aws.CloudWatchMetrics[0].Dimensions).toEqual([[]]);
            expect(Object.keys(payload)).not.toContain('source');
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
