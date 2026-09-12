/**
 * Analytics plan U4 — the client-door event payload (origin R1, R11, R13; KTD4b/KTD5).
 *
 * Three properties are load-bearing enough to pin structurally:
 *
 * 1. **NO actor-shaped field exists anywhere in the schema.** The actor is ALWAYS the verified token's
 *    principal — a payload field for it would be an attribution-spoofing surface (the accepted-risk
 *    paragraph covers data QUALITY, never identity). Pinned by walking the schema's key inventory.
 * 2. **Every bound is real.** The batch, query, served list, and label caps exist because web delivery
 *    rides `fetch keepalive`, whose spec caps aggregate in-flight bodies at 64 KiB and REJECTS an
 *    over-quota send immediately — a swallowing emitter would turn that into systematic silent loss of
 *    exactly the richest events (KTD4b). The caps are exported FROM this module so the emitter and the
 *    ingest route share one arithmetic.
 * 3. **The event id is required and UUID-shaped** (KTD5's idempotency key, minted at occurrence).
 */
import { describe, expect, it } from 'vitest';

import * as barrel from '../../index.js';
import {
    MAX_EVENTS_PER_BATCH,
    MAX_QUERY_LENGTH,
    MAX_SERVED_LIST_ENTRIES,
    MAX_SUGGESTION_LABEL_LENGTH,
    analyticsEventBatchSchema,
    queryOutcomeEventSchema,
} from '../eventPayload.js';

const EVENT_ID = '99999999-9999-4999-8999-000000000e01';

function pickEvent(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        type: 'query_outcome',
        eventId: EVENT_ID,
        occurredAt: '2026-09-01T12:00:00.000Z',
        query: 'salt',
        served: [
            { group: 'local', label: 'Salt' },
            { group: 'catalog', label: 'Salt, table', foodId: 'food-0001' },
        ],
        outcome: { kind: 'pick', group: 'catalog', positionInGroup: 1, foodId: 'food-0001' },
        ...over,
    };
}

describe('queryOutcomeEventSchema (U4)', () => {
    it('accepts a well-formed pick (AE1: query, served list, group, position-in-group)', () => {
        expect(queryOutcomeEventSchema.safeParse(pickEvent()).success).toBe(true);
    });

    it('accepts a no-pick outcome (AE2: the capture-rate denominator)', () => {
        const parsed = queryOutcomeEventSchema.safeParse(pickEvent({ outcome: { kind: 'no_pick' } }));

        expect(parsed.success).toBe(true);
    });

    it('rejects an unknown event type — the client door carries ONE family', () => {
        expect(queryOutcomeEventSchema.safeParse(pickEvent({ type: 'recipe_saved' })).success).toBe(false);
    });

    it('rejects an absent or malformed event id (KTD5 — the idempotency key is not optional)', () => {
        expect(queryOutcomeEventSchema.safeParse(pickEvent({ eventId: undefined })).success).toBe(false);
        expect(queryOutcomeEventSchema.safeParse(pickEvent({ eventId: 'not-a-uuid' })).success).toBe(false);
    });

    it('rejects an oversized query, served list, and label (KTD4b bounds)', () => {
        expect(queryOutcomeEventSchema.safeParse(pickEvent({ query: 'q'.repeat(MAX_QUERY_LENGTH + 1) })).success).toBe(
            false,
        );

        const oversizedList = Array.from({ length: MAX_SERVED_LIST_ENTRIES + 1 }, (_unused, index) => ({
            group: 'local',
            label: `Entry ${index}`,
        }));
        expect(queryOutcomeEventSchema.safeParse(pickEvent({ served: oversizedList })).success).toBe(false);

        const oversizedLabel = [{ group: 'local', label: 'x'.repeat(MAX_SUGGESTION_LABEL_LENGTH + 1) }];
        expect(queryOutcomeEventSchema.safeParse(pickEvent({ served: oversizedLabel })).success).toBe(false);
    });

    it('rejects a pick whose position exceeds the served-list cap', () => {
        const outcome = { kind: 'pick', group: 'catalog', positionInGroup: MAX_SERVED_LIST_ENTRIES + 1 };

        expect(queryOutcomeEventSchema.safeParse(pickEvent({ outcome })).success).toBe(false);
    });

    it('⛔ has NO actor-shaped field, at any depth — the actor is the TOKEN, never the payload', () => {
        // Walk the accepted shape's keys: none may smell like an actor/user/owner identifier.
        const forbidden = /user|actor|owner|principal|sub\b/i;
        const sample = pickEvent();
        const keys: string[] = [];

        const walk = (value: unknown, path: string): void => {
            if (Array.isArray(value)) {
                for (const item of value) {
                    walk(item, path);
                }

                return;
            }

            if (value !== null && typeof value === 'object') {
                for (const [key, child] of Object.entries(value)) {
                    keys.push(key);
                    walk(child, `${path}.${key}`);
                }
            }
        };

        walk(sample, '$');

        for (const key of keys) {
            expect(key).not.toMatch(forbidden);
        }

        // And a smuggled one is REFUSED, not stripped: strictObject fails on unknown keys, so an
        // attribution attempt is a 400 the client sees rather than a silently-ignored field.
        expect(queryOutcomeEventSchema.safeParse(pickEvent({ userId: 'someone-else' })).success).toBe(false);
    });
});

describe('analyticsEventBatchSchema (U4)', () => {
    it('accepts 1..MAX_EVENTS_PER_BATCH events and rejects an empty or oversized batch', () => {
        const one = { events: [pickEvent()] };

        expect(analyticsEventBatchSchema.safeParse(one).success).toBe(true);

        expect(analyticsEventBatchSchema.safeParse({ events: [] }).success).toBe(false);

        const oversized = { events: Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => pickEvent()) };
        expect(analyticsEventBatchSchema.safeParse(oversized).success).toBe(false);
    });

    it('a worst-case batch serializes comfortably under the 64 KiB keepalive quota (KTD4b arithmetic)', () => {
        const worstEvent = pickEvent({
            query: 'q'.repeat(MAX_QUERY_LENGTH),
            served: Array.from({ length: MAX_SERVED_LIST_ENTRIES }, (_unused, index) => ({
                group: 'catalog',
                label: 'l'.repeat(MAX_SUGGESTION_LABEL_LENGTH),
                foodId: `food-${String(index).padStart(4, '0')}-0000-0000-000000000000`,
            })),
        });
        const body = JSON.stringify({ events: Array.from({ length: MAX_EVENTS_PER_BATCH }, () => worstEvent) });

        // Headroom is the point: the quota is AGGREGATE across in-flight keepalive sends, so one batch
        // must stay well under it or a second concurrent flush rejects immediately and silently.
        expect(Buffer.byteLength(body, 'utf8')).toBeLessThan(32 * 1024);
    });

    it('⛔ KTD3: the payload stays OUT of the recipe-core barrel — the barrel is inside the contract corpus', () => {
        // A barrel export would put this off-contract wire shape inside the contract's demanded-symbol
        // reach; consumers import the `analytics/event-payload` SUBPATH instead, on purpose.
        for (const key of Object.keys(barrel)) {
            expect(key).not.toMatch(/analytics|queryOutcome|eventBatch|servedSuggestion/i);
        }
    });
});
