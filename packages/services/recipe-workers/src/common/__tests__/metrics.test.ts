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
});
