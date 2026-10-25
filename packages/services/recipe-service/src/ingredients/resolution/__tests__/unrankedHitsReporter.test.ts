/**
 * The lexical tier's rung-less-hit report: one EMF count per resolution that saw name hits with no rung, and a warning
 * at most once per interval, so a food that stopped publishing rungs is visible without flooding the log.
 */
import { describe, expect, it, vi } from 'vitest';

import { MAPPING_PROMOTION_NAMESPACE } from '../mappingPromotionAudit.js';
import { UNRANKED_HITS_METRIC, UnrankedHitsReporter } from '../unrankedHitsReporter.js';

describe('UnrankedHitsReporter', () => {
    it('emits one Stage-dimensioned count carrying how many hits had no rung', () => {
        const lines: string[] = [];
        const reporter = new UnrankedHitsReporter(
            'sandbox',
            (line) => lines.push(line),
            vi.fn(),
            () => 0,
        );

        reporter.onUnrankedHits(3);

        expect(lines).toHaveLength(1);
        const parsed = JSON.parse(lines[0] ?? '{}') as Record<string, unknown> & {
            _aws: { CloudWatchMetrics: { Namespace: string; Metrics: { Name: string }[] }[] };
        };

        expect(parsed._aws.CloudWatchMetrics[0]?.Namespace).toBe(MAPPING_PROMOTION_NAMESPACE);
        expect(parsed._aws.CloudWatchMetrics[0]?.Metrics[0]?.Name).toBe(UNRANKED_HITS_METRIC);
        expect(parsed['Stage']).toBe('sandbox');
        expect(parsed[UNRANKED_HITS_METRIC]).toBe(1);
        expect(parsed['unrankedHits']).toBe('3');
    });

    it('warns at most once per interval, while the metric counts every occurrence', () => {
        let now = 0;
        const warn = vi.fn();
        const lines: string[] = [];
        const reporter = new UnrankedHitsReporter(
            'sandbox',
            (line) => lines.push(line),
            warn,
            () => now,
        );

        reporter.onUnrankedHits(1);
        now = 30_000;
        reporter.onUnrankedHits(1);
        now = 60_001;
        reporter.onUnrankedHits(1);

        expect(lines).toHaveLength(3);
        expect(warn).toHaveBeenCalledTimes(2);
        expect(warn.mock.calls[0]?.[0]).toMatch(/no rung/);
    });
});
