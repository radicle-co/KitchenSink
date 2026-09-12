/**
 * Unit tests for the promotion audit signal (plan U10 / R20).
 *
 * ⚠️ THE DURABLE AUDIT RECORD IS THE ROW, NOT THIS. A `corroboration` mapping cites both agreeing mappings,
 * so every promotion is enumerable by `SELECT` for as long as the table exists — which is what makes ADR-0023's
 * "reviewable after the fact" answer to collusion actually true here. This emitter is the ALERTING half: it
 * is what makes a burst of promotions visible without anyone running a query, and it is asserted against the
 * emitted line rather than a spy on a logger, so a mutant that emitted nothing would fail.
 *
 * ⛔ THE SPLIT BETWEEN THE TWO SINKS IS THE REQUIREMENT, not a style choice. `emfIdentifierDimensionRepoGate`
 * forbids a per-user or per-request identifier in ANY EMF dimension — every distinct dimension-value
 * combination is a separately billed custom metric with 15-month retention, and the EMF line bypasses the
 * Sentry scrubbers that pseudonymise user ids. So:
 *
 *  - the METRIC carries a count, dimensioned by stage alone — chartable, alarmable, one metric forever;
 *  - the identifiers the plan asks the signal to carry (mapping id, both corroborating author ids, the
 *    normalized key) go on the SCRUBBED structured log line beside it.
 *
 * Putting the ids into an EMF property instead would fix the bill and leave the privacy hazard fully intact,
 * which is exactly the "obvious optimisation" that gate exists to pre-empt.
 */
import { describe, expect, it, vi } from 'vitest';

import {
    MappingPromotionAudit,
    MAPPING_PROMOTION_METRIC,
    MAPPING_PROMOTION_NAMESPACE,
} from '../mappingPromotionAudit.js';

const PROMOTION = {
    mappingId: '99999999-9999-4999-8999-999999999999',
    corroboratingAuthorIds: ['01JU10AUDIT00000000AUTHA', '01JU10AUDIT00000000AUTHB'],
    normalizedKey: 'plain flour',
} as const;

/** Parse the single EMF line an emission wrote. */
function emitted(lines: string[]): Record<string, unknown> {
    expect(lines).toHaveLength(1);

    return JSON.parse(lines[0]!) as Record<string, unknown>;
}

describe('MappingPromotionAudit — the metric half', () => {
    it('emits ONE EMF line under the alarm’s namespace and metric name', () => {
        const lines: string[] = [];
        new MappingPromotionAudit('test', lines.push.bind(lines), vi.fn()).recordPromotion(PROMOTION);

        const line = emitted(lines);
        const aws = line['_aws'] as { CloudWatchMetrics: { Namespace: string; Metrics: { Name: string }[] }[] };

        expect(aws.CloudWatchMetrics[0]!.Namespace).toBe(MAPPING_PROMOTION_NAMESPACE);
        expect(aws.CloudWatchMetrics[0]!.Metrics[0]!.Name).toBe(MAPPING_PROMOTION_METRIC);
        expect(line[MAPPING_PROMOTION_METRIC]).toBe(1);
    });

    it('⛔ dimensions the metric by STAGE ALONE — never by an identifier', () => {
        const lines: string[] = [];
        new MappingPromotionAudit('sandbox', lines.push.bind(lines), vi.fn()).recordPromotion(PROMOTION);

        const line = emitted(lines);
        const aws = line['_aws'] as { CloudWatchMetrics: { Dimensions: string[][] }[] };

        // A dimension keyed by author or by phrase would have cardinality equal to the user base (or the
        // vocabulary): thousands of separately billed one-datapoint "metrics" that aggregate to nothing.
        expect(aws.CloudWatchMetrics[0]!.Dimensions).toEqual([['Stage']]);
        expect(line['Stage']).toBe('sandbox');
    });

    it('⛔ carries NO author id, mapping id or phrase anywhere in the EMF line', () => {
        const lines: string[] = [];
        new MappingPromotionAudit('test', lines.push.bind(lines), vi.fn()).recordPromotion(PROMOTION);

        // Property, not just dimension: the EMF line goes straight to stdout and bypasses the Sentry
        // scrubbers, so an identifier there sits in CloudWatch for 15 months outside every scrubber.
        const serialized = lines[0]!;

        for (const identifier of [PROMOTION.mappingId, ...PROMOTION.corroboratingAuthorIds, PROMOTION.normalizedKey]) {
            expect(serialized).not.toContain(identifier);
        }
    });
});

describe('MappingPromotionAudit — the reviewable half', () => {
    it('logs the mapping id, BOTH corroborating author ids and the normalized key', () => {
        const log = vi.fn();
        new MappingPromotionAudit('test', vi.fn(), log).recordPromotion(PROMOTION);

        expect(log).toHaveBeenCalledTimes(1);
        const [, context] = log.mock.calls[0] as [string, Record<string, unknown>];

        expect(context).toMatchObject({
            mappingId: PROMOTION.mappingId,
            corroboratingAuthorIds: PROMOTION.corroboratingAuthorIds,
            normalizedKey: PROMOTION.normalizedKey,
        });
    });

    it('names both promoters even when more than two authors agree', () => {
        const log = vi.fn();
        new MappingPromotionAudit('test', vi.fn(), log).recordPromotion({
            ...PROMOTION,
            corroboratingAuthorIds: ['a', 'b', 'c'],
        });

        const [, context] = log.mock.calls[0] as [string, Record<string, unknown>];

        expect(context['corroboratingAuthorIds']).toEqual(['a', 'b', 'c']);
    });
});
