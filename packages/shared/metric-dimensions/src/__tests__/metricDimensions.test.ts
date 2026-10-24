/**
 * The published language of a custom metric's stage: the dimension NAME, the reader of the deploy stage, and the
 * dimension map an alarm or dashboard selects with. Emitters and infrastructure both import these, so a test that
 * pins them pins both ends of the wire at once.
 */
import { describe, expect, it } from 'vitest';

import { METRIC_STAGE_DIMENSION, metricStage, stageDimensions } from '../metricDimensions.js';

describe('METRIC_STAGE_DIMENSION', () => {
    it('is the literal CloudWatch dimension name `Stage` (the wire contract, capital S)', () => {
        expect(METRIC_STAGE_DIMENSION).toBe('Stage');
    });
});

describe('metricStage', () => {
    it('reads STAGE from the environment it is given', () => {
        expect(metricStage({ STAGE: 'prod' })).toBe('prod');
        expect(metricStage({ STAGE: 'pr-91', NODE_ENV: 'production' })).toBe('pr-91');
    });

    it('answers `unknown` for an absent or blank STAGE: a metric with no stage is still emitted, never dropped', () => {
        // CloudWatch discards a record whose directive names a dimension the line does not carry, and rejects an
        // empty dimension value, so the absent case must still be a non-empty string.
        expect(metricStage({})).toBe('unknown');
        expect(metricStage({ STAGE: '' })).toBe('unknown');
        expect(metricStage({ STAGE: '   ' })).toBe('unknown');
    });

    it('does not fall back to NODE_ENV: that is a runtime mode, not a deploy stage', () => {
        expect(metricStage({ NODE_ENV: 'production' })).toBe('unknown');
    });

    it('reads process.env by default', () => {
        const before = process.env['STAGE'];

        process.env['STAGE'] = 'pr-404';

        try {
            expect(metricStage()).toBe('pr-404');
        } finally {
            if (before === undefined) {
                delete process.env['STAGE'];
            } else {
                process.env['STAGE'] = before;
            }
        }
    });
});

describe('stageDimensions', () => {
    it('is the dimension map an alarm or dashboard selects the stage with', () => {
        expect(stageDimensions('prod')).toStrictEqual({ Stage: 'prod' });
    });

    it('carries the stage verbatim, so a pr-N stage selects only its own series', () => {
        expect(stageDimensions('pr-91')).toStrictEqual({ Stage: 'pr-91' });
    });
});
