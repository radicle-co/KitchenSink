/**
 * Analytics plan U4 — the client-door ingest controller (origin R1, R12, R13; AE3; KTD3/KTD5/KTD9).
 *
 * The controller's four jobs, each pinned here:
 *  1. The actor is ALWAYS the verified token's principal — nothing in a batch can attribute an event to
 *     anyone else (a smuggled actor field fails the strict schema and that EVENT is dropped, logged).
 *  2. Door binding (R12/AE3): a server-door family (`recipe_saved`…) in the batch is DROPPED and
 *     logged, never landed — the client cannot mint credit-bearing events.
 *  3. Per-event validation with drop-and-log: one bad event never voids the good ones beside it, but a
 *     malformed ENVELOPE (not a batch at all, or over the batch cap) is a 400.
 *  4. The dedup-rate signal (KTD5): the response carries accepted vs landed, and the controller logs
 *     when they diverge — a persistently high dedup rate is the id-minting-bug alarm.
 *
 * Plus the KTD3 structural pin: NO file matching `*.schema.ts` may exist under `src/analytics/` —
 * contract discovery is blunt on purpose, and this route is off the domain contract BY DESIGN.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { AnalyticsIngestController } from '../ingest.controller.js';
import type { AnalyticsService } from '../analytics.service.js';

const OWNER = '01JU4INGESTCONTROLLERUSER0';
const EVENT_ID = '99999999-9999-4999-8999-000000000f01';

function fakeAnalytics(landed = 1): { ingestBatch: ReturnType<typeof vi.fn> } {
    return { ingestBatch: vi.fn().mockResolvedValue({ landed, shed: false }) };
}

function makeController(analytics: { ingestBatch: ReturnType<typeof vi.fn> }): AnalyticsIngestController {
    return new AnalyticsIngestController(analytics as unknown as AnalyticsService);
}

function pickEvent(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        type: 'query_outcome',
        eventId: EVENT_ID,
        occurredAt: '2026-09-01T12:00:00.000Z',
        query: 'salt',
        served: [{ group: 'catalog', label: 'Salt, table', foodId: 'food-0001' }],
        outcome: { kind: 'pick', group: 'catalog', positionInGroup: 1, foodId: 'food-0001' },
        ...over,
    };
}

describe('AnalyticsIngestController (U4)', () => {
    it('lands a well-formed batch under the TOKEN principal and reports accepted vs landed', async () => {
        const analytics = fakeAnalytics(1);
        const controller = makeController(analytics);

        const result = await controller.ingest(OWNER, { events: [pickEvent()] });

        expect(analytics.ingestBatch).toHaveBeenCalledTimes(1);
        const [userId, events] = analytics.ingestBatch.mock.calls[0] as [string, unknown[]];
        expect(userId).toBe(OWNER);
        expect(events).toHaveLength(1);
        expect(result).toEqual({ accepted: 1, landed: 1 });
    });

    it('drops a SERVER-DOOR family from the batch and lands the rest (R12/AE3 — no client-minted credit)', async () => {
        const analytics = fakeAnalytics(1);
        const controller = makeController(analytics);

        const result = await controller.ingest(OWNER, {
            events: [
                pickEvent({ eventId: '99999999-9999-4999-8999-000000000f02' }),
                pickEvent({ type: 'recipe_saved' }),
            ],
        });

        const [, events] = analytics.ingestBatch.mock.calls[0] as [string, unknown[]];
        expect(events).toHaveLength(1);
        expect(result.accepted).toBe(1);
    });

    it('drops an event smuggling an actor field — strict schema, attribution stays the token (AE3)', async () => {
        const analytics = fakeAnalytics(0);
        const controller = makeController(analytics);

        const result = await controller.ingest(OWNER, { events: [pickEvent({ userId: 'someone-else' })] });

        expect(analytics.ingestBatch).not.toHaveBeenCalled();
        expect(result).toEqual({ accepted: 0, landed: 0 });
    });

    it('refuses a malformed envelope with 400 — not a batch at all', async () => {
        const controller = makeController(fakeAnalytics());

        await expect(controller.ingest(OWNER, { nonsense: true })).rejects.toThrow(BadRequestException);
        await expect(controller.ingest(OWNER, 'not-an-object')).rejects.toThrow(BadRequestException);
    });

    it('refuses an over-cap batch with 400 (R13 payload bound)', async () => {
        const controller = makeController(fakeAnalytics());
        const events = Array.from({ length: 9 }, (_unused, index) =>
            pickEvent({ eventId: `99999999-9999-4999-8999-00000000000${index}` }),
        );

        await expect(controller.ingest(OWNER, { events })).rejects.toThrow(BadRequestException);
    });

    it('⛔ KTD3: no *.schema.ts file exists under src/analytics — the route stays off the domain contract', () => {
        const analyticsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
        const offending = readdirSync(analyticsDir, { recursive: true })
            .map(String)
            .filter((name) => name.endsWith('.schema.ts'));

        expect(offending).toEqual([]);
    });
});
