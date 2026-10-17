import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { emitMetric } from '../metrics.js';

describe('emitMetric', () => {
    let log: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        // Freeze the EMF timestamp so the emitted line is deterministic and byte-comparable.
        vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('emits exactly one EMF log line per call', () => {
        emitMetric({
            namespace: 'Commise/RecipeArchive',
            name: 'PendingArchiveBacklog',
            unit: 'Count',
            stage: 'sandbox',
            value: 42,
        });

        expect(log).toHaveBeenCalledTimes(1);
    });

    it('emits the EMF envelope byte-for-byte, key order and all, for a Count metric', () => {
        // This exact string is contractual: CloudWatch extracts the metric by the namespace, the single
        // `Stage` dimension, and the metric name in this envelope. A drift here silently blinds an alarm.
        emitMetric({
            namespace: 'Commise/RecipeArchive',
            name: 'PendingArchiveBacklog',
            unit: 'Count',
            stage: 'sandbox',
            value: 250,
        });

        expect(log.mock.calls[0]?.[0]).toBe(
            JSON.stringify({
                _aws: {
                    Timestamp: 1_700_000_000_000,
                    CloudWatchMetrics: [
                        {
                            Namespace: 'Commise/RecipeArchive',
                            Dimensions: [['Stage']],
                            Metrics: [{ Name: 'PendingArchiveBacklog', Unit: 'Count' }],
                        },
                    ],
                },
                Stage: 'sandbox',
                PendingArchiveBacklog: 250,
            }),
        );
    });

    it('emits the EMF envelope byte-for-byte for a Seconds metric', () => {
        emitMetric({
            namespace: 'Commise/RecipeErasure',
            name: 'OldestErasureJobAgeSeconds',
            unit: 'Seconds',
            stage: 'prod',
            value: 7200,
        });

        expect(log.mock.calls[0]?.[0]).toBe(
            JSON.stringify({
                _aws: {
                    Timestamp: 1_700_000_000_000,
                    CloudWatchMetrics: [
                        {
                            Namespace: 'Commise/RecipeErasure',
                            Dimensions: [['Stage']],
                            Metrics: [{ Name: 'OldestErasureJobAgeSeconds', Unit: 'Seconds' }],
                        },
                    ],
                },
                Stage: 'prod',
                OldestErasureJobAgeSeconds: 7200,
            }),
        );
    });

    it('keys the metric value under the metric name, not a fixed literal', () => {
        // The value field is the metric name itself (`[name]: value`), so a caller that renames the
        // metric renames the value key with it — proving the two can never drift apart.
        emitMetric({
            namespace: 'Commise/RecipeErasure',
            name: 'ArchiveOrphansDeleted',
            unit: 'Count',
            stage: 'sandbox',
            value: 3,
        });

        const parsed = JSON.parse(log.mock.calls[0]?.[0] as string) as Record<string, unknown>;
        expect(parsed['ArchiveOrphansDeleted']).toBe(3);
        expect(parsed['Stage']).toBe('sandbox');
        expect(parsed['_aws']).toMatchObject({
            CloudWatchMetrics: [{ Metrics: [{ Name: 'ArchiveOrphansDeleted' }] }],
        });
    });

    /**
     * ATTRIBUTION WITHOUT PARTITIONING (U36) — a second dimension SET, never a second dimension on the only set.
     *
     * ⛔ THE MISTAKE THIS SHAPE EXISTS TO AVOID, and it has already shipped in this repo:
     * `source-rolling-window-count` publishes under a `source` dimension and nothing else, so prod and every
     * preview co-mingle into one series and no datapoint can be attributed to either. A dimension is cheap now
     * and expensive to retrofit after an incident.
     *
     * ⛔ AND THE MISTAKE ON THE OTHER SIDE. EMF publishes ONLY the dimension sets its directive lists — there is
     * no dimensionless rollup to fall back on. Appending `CallSite` to the single `['Stage']` set would therefore
     * DELETE the aggregate series, and `VerificationSpendAlarm` — which selects `Stage` alone — would sit at a
     * permanently confident `OK` with `treatMissingData: NOT_BREACHING` and no datapoints. Two sets publish both:
     * the aggregate the ceiling alarms on, and the per-call-site breakdown that answers "who burned it".
     */
    describe('the call-site dimension', () => {
        it('publishes the aggregate series AND the per-call-site series, in that order', () => {
            emitMetric({
                namespace: 'Commise/RecipeVerification',
                name: 'VerificationSpendMicros',
                unit: 'None',
                stage: 'prod',
                value: 116,
                dimensions: { CallSite: 'verification-gate' },
            });

            const parsed = JSON.parse(log.mock.calls[0]?.[0] as string) as {
                _aws: { CloudWatchMetrics: { Dimensions: string[][] }[] };
            };

            expect(parsed._aws.CloudWatchMetrics[0]?.Dimensions).toEqual([['Stage'], ['Stage', 'CallSite']]);
        });

        it('carries the dimension VALUE as a top-level field, or CloudWatch discards the whole record', () => {
            emitMetric({
                namespace: 'Commise/RecipeVerification',
                name: 'VerificationSpendMicros',
                unit: 'None',
                stage: 'prod',
                value: 116,
                dimensions: { CallSite: 'verification-gate' },
            });

            const parsed = JSON.parse(log.mock.calls[0]?.[0] as string) as Record<string, unknown>;

            expect(parsed['CallSite']).toBe('verification-gate');
            expect(parsed['Stage']).toBe('prod');
            expect(parsed['VerificationSpendMicros']).toBe(116);
        });

        it('gives two call sites two SERIES, not two numbers in one', () => {
            const emitFor = (callSite: string): void =>
                emitMetric({
                    namespace: 'Commise/RecipeVerification',
                    name: 'VerificationSpendMicros',
                    unit: 'None',
                    stage: 'prod',
                    value: 116,
                    dimensions: { CallSite: callSite },
                });

            emitFor('verification-gate');
            emitFor('ingredient-parse');

            const values = log.mock.calls.map(
                (call: unknown[]) => (JSON.parse(call[0] as string) as Record<string, unknown>)['CallSite'],
            );

            // The whole point of KTD-17: ONE pool, but the pool's consumers are distinguishable when it empties.
            expect(values).toEqual(['verification-gate', 'ingredient-parse']);
        });

        it('emits the ORIGINAL envelope byte-for-byte when no dimension is supplied', () => {
            // ⛔ The regression assertion for every metric that predates U36. The sweepers' alarms select `Stage`
            // and nothing else; a directive that grew a second set for them would republish their series under a
            // shape their alarms do not watch.
            emitMetric({
                namespace: 'Commise/RecipeArchive',
                name: 'PendingArchiveBacklog',
                unit: 'Count',
                stage: 'sandbox',
                value: 250,
            });

            expect(log.mock.calls[0]?.[0]).toBe(
                JSON.stringify({
                    _aws: {
                        Timestamp: 1_700_000_000_000,
                        CloudWatchMetrics: [
                            {
                                Namespace: 'Commise/RecipeArchive',
                                Dimensions: [['Stage']],
                                Metrics: [{ Name: 'PendingArchiveBacklog', Unit: 'Count' }],
                            },
                        ],
                    },
                    Stage: 'sandbox',
                    PendingArchiveBacklog: 250,
                }),
            );
        });

        it('drops a facet whose value is undefined rather than declaring a dimension the line lacks', () => {
            // `JSON.stringify` omits an `undefined` field, so declaring the key anyway would ship a directive
            // naming a dimension the record does not carry — which CloudWatch rejects, discarding the metric.
            // Silently losing a metric is the worst failure an emitter can have.
            emitMetric({
                namespace: 'Commise/RecipeVerification',
                name: 'VerificationSettleFailures',
                unit: 'Count',
                stage: 'prod',
                value: 1,
                dimensions: { CallSite: undefined },
            });

            const parsed = JSON.parse(log.mock.calls[0]?.[0] as string) as {
                _aws: { CloudWatchMetrics: { Dimensions: string[][] }[] };
            };

            expect(parsed._aws.CloudWatchMetrics[0]?.Dimensions).toEqual([['Stage']]);
            expect(Object.keys(parsed)).not.toContain('CallSite');
        });
    });
});
