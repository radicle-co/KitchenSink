/**
 * Unit tests for the service's ONE CloudWatch EMF envelope.
 *
 * The envelope's shape is fixed by the AWS EMF spec, and CloudWatch extracts by exact namespace, dimension
 * set and metric name — so what is asserted here is the emitted BYTES, not "an emitter was called". A line
 * whose directive drifts is not a degraded metric: CloudWatch discards the record, the alarm sees no
 * datapoints, and under `treatMissingData: NOT_BREACHING` it reports a permanent, confident `OK`.
 *
 * ⛔ The `Stage`-only dimension set is a rule, not a default — see the module docstring and
 * `packages/infra/global/__tests__/emfIdentifierDimensionRepoGate.test.ts`. It is asserted here so a facet
 * added "just for this one metric" fails a test rather than multiplying the billed series count.
 */
import { describe, it, expect, vi } from 'vitest';

import { buildStageCountMetricLine, resolveMetricStage } from '../emfMetricLine.js';

/** The parsed shape of one emitted line. */
interface EmfLine {
    _aws: {
        Timestamp: number;
        CloudWatchMetrics: { Namespace: string; Dimensions: string[][]; Metrics: { Name: string; Unit: string }[] }[];
    };
    Stage: string;
    [key: string]: unknown;
}

/**
 * Emit and parse one line.
 *
 * @param input - The metric to render.
 * @returns The parsed line.
 */
function emit(input: Parameters<typeof buildStageCountMetricLine>[0]): EmfLine {
    return JSON.parse(buildStageCountMetricLine(input)) as EmfLine;
}

describe('buildStageCountMetricLine', () => {
    it('publishes the metric under the given namespace and name, as a Count of one occurrence', () => {
        const line = emit({ namespace: 'Commise/Test', metricName: 'a-thing-happened', stage: 'prod' });
        const directive = line._aws.CloudWatchMetrics[0];

        expect(directive?.Namespace).toBe('Commise/Test');
        expect(directive?.Metrics).toEqual([{ Name: 'a-thing-happened', Unit: 'Count' }]);
        // The value rides a field NAMED for the metric — that pairing is what makes the record extractable.
        expect(line['a-thing-happened']).toBe(1);
    });

    it('⛔ dimensions by Stage ALONE, and carries the stage value the directive names', () => {
        const line = emit({ namespace: 'Commise/Test', metricName: 'a-thing-happened', stage: 'sandbox' });

        expect(line._aws.CloudWatchMetrics[0]?.Dimensions).toEqual([['Stage']]);
        expect(line.Stage).toBe('sandbox');
    });

    it('stamps a millisecond epoch timestamp', () => {
        const before = Date.now();
        const line = emit({ namespace: 'Commise/Test', metricName: 'a-thing-happened', stage: 'prod' });

        expect(line._aws.Timestamp).toBeGreaterThanOrEqual(before);
        expect(line._aws.Timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('⛔ writes a context property as a plain FIELD and never as a dimension', () => {
        const line = emit({
            namespace: 'Commise/Test',
            metricName: 'a-thing-happened',
            stage: 'prod',
            properties: { ownerId: '01JU00000000000000000OWNER' },
        });

        expect(line['ownerId']).toBe('01JU00000000000000000OWNER');
        // The whole point of the property channel: it does not multiply the billed series count. A
        // build that appended context keys to the directive would turn one metric into one per owner.
        expect(line._aws.CloudWatchMetrics[0]?.Dimensions).toEqual([['Stage']]);
    });

    it('renders exactly one line — the record CloudWatch extracts is one JSON object per line', () => {
        const rendered = buildStageCountMetricLine({
            namespace: 'Commise/Test',
            metricName: 'a-thing-happened',
            stage: 'prod',
            properties: { ownerId: 'o1' },
        });

        expect(rendered).not.toContain('\n');
    });

    it('does not let a context property overwrite the metric value or the Stage dimension', () => {
        // A property bag is caller-supplied; a key collision would silently replace the value the alarm
        // reads with a string, and CloudWatch would discard the record.
        const line = emit({
            namespace: 'Commise/Test',
            metricName: 'a-thing-happened',
            stage: 'prod',
            properties: { Stage: 'spoofed', 'a-thing-happened': 'spoofed' },
        });

        expect(line.Stage).toBe('prod');
        expect(line['a-thing-happened']).toBe(1);
    });
});

describe('resolveMetricStage', () => {
    it('prefers STAGE', () => {
        expect(resolveMetricStage({ STAGE: 'pr-91', NODE_ENV: 'test' })).toBe('pr-91');
    });

    it('falls back to NODE_ENV when STAGE is unset', () => {
        expect(resolveMetricStage({ NODE_ENV: 'test' })).toBe('test');
    });

    it('⚠️ still yields a stage when neither is set — a metric with no stage is emitted, never dropped', () => {
        // Alarms fail toward firing. Returning `undefined` here would produce a line with no `Stage` field
        // while the directive still declares the dimension, which CloudWatch discards outright.
        expect(resolveMetricStage({})).toBe('unknown');
    });

    it('reads process.env by default', () => {
        // The no-argument form is what every emitter's constructor default uses; a signature that only
        // worked when handed an environment would leave the production path untested.
        vi.stubEnv('STAGE', 'pr-404');

        try {
            expect(resolveMetricStage()).toBe('pr-404');
        } finally {
            vi.unstubAllEnvs();
        }
    });
});
