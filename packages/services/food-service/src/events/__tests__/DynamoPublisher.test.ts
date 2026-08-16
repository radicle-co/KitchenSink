/**
 * `DynamoPublisher` (plan U6) — the real substrate adapter.
 *
 * Three of these assertions guard failures that are INVISIBLE in production: a string TTL (nothing ever
 * expires, nothing errors), a millisecond TTL (expiry ~50,000 years out, same symptom), and a sort key
 * without its uniqueness suffix (two messages in one millisecond silently become one, `PutItem` returning
 * 200 to a producer that is fire-and-forget and therefore never told). None of the three would fail a
 * synth, a type-check, or a "TTL is enabled" template assertion.
 */
import { describe, it, expect, vi } from 'vitest';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { OutboundMessage } from '@kitchensink/messaging';
import { publish } from '@kitchensink/messaging';

import { DynamoPublisher, MESSAGE_TTL_DAYS, partitionKeyFor, sortKeyFor, ttlFor } from '../DynamoPublisher.js';

const message: OutboundMessage = {
    groupType: 'food',
    groupId: '01KZKES1FNHBW29N2VZJD7D0TW',
    timestamp: '2026-08-16T12:00:00.000Z',
    kind: 'FoodFetchCompleted',
    payload: { status: 'RESOLVED' },
};

/** A DocumentClient double that records the commands it was handed. */
function stubClient(): { client: DynamoDBDocumentClient; sent: Array<{ input: Record<string, unknown> }> } {
    const sent: Array<{ input: Record<string, unknown> }> = [];
    const client = {
        send: vi.fn((command: { input: Record<string, unknown> }) => {
            sent.push(command);

            return Promise.resolve({});
        }),
    } as unknown as DynamoDBDocumentClient;

    return { client, sent };
}

const fixedClock = { now: () => new Date('2026-08-16T12:00:00.000Z'), newSuffix: () => 'SUFFIX01' };

describe('key composition (KTD-2)', () => {
    it('partitions on <groupType>#<groupId>, so a group is one partition', () => {
        expect(partitionKeyFor(message)).toBe('food#01KZKES1FNHBW29N2VZJD7D0TW');
    });

    it('keeps the two group fields SEPARABLE — an import job has no food id', () => {
        expect(partitionKeyFor({ ...message, groupType: 'recipe-import', groupId: 'job_9' })).toBe(
            'recipe-import#job_9',
        );
    });

    it('sorts on <ISO-8601 ms>#<suffix>, timestamp FIRST so a group query returns in order', () => {
        expect(sortKeyFor(message, 'SUFFIX01')).toBe('2026-08-16T12:00:00.000Z#SUFFIX01');
    });

    it('⛔ two messages in the SAME millisecond get DIFFERENT sort keys', () => {
        // Without the suffix these collide, `PutItem` REPLACES one with the other, and returns 200 — to a
        // producer that is fire-and-forget and therefore never learns a message was destroyed.
        const a = sortKeyFor(message, 'AAAAAAAA');
        const b = sortKeyFor(message, 'BBBBBBBB');

        expect(a).not.toBe(b);
    });

    it('orders lexicographically the same way it orders chronologically', () => {
        const earlier = sortKeyFor({ ...message, timestamp: '2026-08-16T12:00:00.000Z' }, 'Z');
        const later = sortKeyFor({ ...message, timestamp: '2026-08-16T12:00:00.001Z' }, 'A');

        expect([later, earlier].sort()).toEqual([earlier, later]);
    });
});

describe('the TTL attribute', () => {
    it('is a NUMBER, not a string', () => {
        // ⛔ DynamoDB SILENTLY IGNORES a string-typed TTL. Nothing expires, nothing errors, and every
        // template assertion that only checks `TimeToLiveSpecification.Enabled` keeps passing.
        expect(typeof ttlFor(new Date())).toBe('number');
    });

    it('is epoch SECONDS, not milliseconds', () => {
        // A milliseconds value puts the expiry roughly 50,000 years out — indistinguishable from "TTL is
        // configured" until the table has grown for a year.
        const now = new Date('2026-08-16T12:00:00.000Z');
        const expected = Math.floor(now.getTime() / 1000) + MESSAGE_TTL_DAYS * 86_400;

        expect(ttlFor(now)).toBe(expected);
        expect(ttlFor(now)).toBeLessThan(now.getTime());
    });

    it('expires three days out (ADR-0016 retention)', () => {
        const now = new Date('2026-08-16T12:00:00.000Z');

        expect(ttlFor(now) - Math.floor(now.getTime() / 1000)).toBe(3 * 86_400);
    });
});

describe('DynamoPublisher.send', () => {
    it('writes ONE item to the configured table with the composed key and a numeric ttl', async () => {
        const { client, sent } = stubClient();

        await new DynamoPublisher('kitchensink-messages-pr-7', client, fixedClock).send(message);

        expect(sent).toHaveLength(1);
        expect(sent[0]?.input['TableName']).toBe('kitchensink-messages-pr-7');
        const item = sent[0]?.input['Item'] as Record<string, unknown>;
        expect(item['PK']).toBe('food#01KZKES1FNHBW29N2VZJD7D0TW');
        expect(item['SK']).toBe('2026-08-16T12:00:00.000Z#SUFFIX01');
        expect(typeof item['ttl']).toBe('number');
    });

    it('keeps the message fields queryable alongside the key', async () => {
        const { client, sent } = stubClient();

        await new DynamoPublisher('t', client, fixedClock).send(message);

        expect(sent[0]?.input['Item']).toMatchObject({
            groupType: 'food',
            groupId: '01KZKES1FNHBW29N2VZJD7D0TW',
            kind: 'FoodFetchCompleted',
            payload: { status: 'RESOLVED' },
        });
    });

    it('PROPAGATES a write failure rather than swallowing it', async () => {
        // The adapter must NOT hide its own errors: the `publish` port is what contains them, and it is the
        // port's `onError` sink that makes a fire-and-forget producer's failures visible at all. An adapter
        // that swallowed would make that sink permanently silent.
        const client = {
            send: vi.fn().mockRejectedValue(new Error('ProvisionedThroughputExceeded')),
        } as unknown as DynamoDBDocumentClient;

        await expect(new DynamoPublisher('t', client).send(message)).rejects.toThrow(/Provisioned/);
    });

    it('is contained by the port: the producer still does not see the failure', async () => {
        const client = { send: vi.fn().mockRejectedValue(new Error('down')) } as unknown as DynamoDBDocumentClient;
        const onError = vi.fn();

        await expect(publish(new DynamoPublisher('t', client), message, { onError })).resolves.toBeUndefined();
        expect(onError).toHaveBeenCalledOnce();
    });
});
