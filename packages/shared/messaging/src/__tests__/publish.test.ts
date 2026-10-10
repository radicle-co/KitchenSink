/**
 * The `publish` port's contract (plan U4).
 *
 * The whole point of the port is a guarantee producers cannot verify for themselves: publishing is
 * fire-and-forget, so a producer never learns whether its message landed. These tests are therefore the
 * only place the guarantee is checked — and they are written to fail if it is weakened in either direction,
 * because both directions are real bugs:
 *
 *   - a failure that PROPAGATES turns a message-store blip into a failed food resolution;
 *   - a failure that VANISHES turns the same blip into silence nobody can debug.
 */
import { describe, it, expect, vi } from 'vitest';

import { publish, type MessagePublisher } from '../publish.js';
import { InMemoryPublisher } from '../InMemoryPublisher.js';
import { ConsolePublisher } from '../ConsolePublisher.js';
import type { OutboundMessage } from '../OutboundMessage.js';

const message = (overrides: Partial<OutboundMessage> = {}): OutboundMessage => ({
    groupType: 'food',
    groupId: '01KZKES1FNHBW29N2VZJD7D0TW',
    timestamp: '2026-08-16T00:00:00.000Z',
    kind: 'FoodFetchCompleted',
    ...overrides,
});

/** An adapter that never settles — models a store that accepted the write but has not answered. */
const neverSettles: MessagePublisher = { send: () => new Promise<void>(() => undefined) };

describe('publish', () => {
    it('resolves without awaiting any consumer', async () => {
        // R1.1: the producer does not wait for anyone to read. A consumer does not exist yet at all (the
        // substrate ships producer-only), so anything that blocked on one would block forever.
        const publisher = new InMemoryPublisher();

        await expect(publish(publisher, message())).resolves.toBeUndefined();
        expect(publisher.messages).toHaveLength(1);
    });

    it('does NOT propagate an adapter failure to the caller', async () => {
        // The regression this prevents: a food resolution that genuinely succeeded being reported as failed
        // because the message store was briefly unavailable.
        const failing: MessagePublisher = { send: vi.fn().mockRejectedValue(new Error('DynamoDB is down')) };

        await expect(publish(failing, message())).resolves.toBeUndefined();
    });

    it('reports the swallowed failure to onError, with the message that failed', async () => {
        // Swallowing WITHOUT this is the actual defect — an invisible failure is worse than a loud one.
        const error = new Error('ProvisionedThroughputExceeded');
        const failing: MessagePublisher = { send: vi.fn().mockRejectedValue(error) };
        const onError = vi.fn();
        const sent = message();

        await publish(failing, sent, { onError });

        expect(onError).toHaveBeenCalledWith(error, sent);
    });

    it('THROWS on a malformed message — a caller bug is not an infrastructure event', async () => {
        // ⛔ MUTATION GUARD. Collapsing the parse into the same try/catch as the adapter call would make a
        // typo'd field indistinguishable from the store being down: both would resolve silently, and the
        // producer would never learn its messages have been unreadable since the day it shipped.
        const publisher = new InMemoryPublisher();

        await expect(publish(publisher, { groupType: 'food' } as unknown as OutboundMessage)).rejects.toThrow();
        expect(publisher.messages).toHaveLength(0);
    });

    it('validates BEFORE the adapter sees anything, so no adapter can persist an invalid message', async () => {
        const send = vi.fn();

        await expect(
            publish({ send }, { ...message(), groupType: 'unknown' } as unknown as OutboundMessage),
        ).rejects.toThrow();
        expect(send).not.toHaveBeenCalled();
    });

    it('does not block the caller on an adapter that never settles', async () => {
        // Fire-and-forget is about the CALLER's control flow. This asserts the port adds no barrier of its
        // own; a hanging adapter is the adapter's problem (U6 gives the real one a timeout).
        const raced = await Promise.race([
            publish(neverSettles, message()).then(() => 'published' as const),
            new Promise<'still-pending'>((resolve) => setTimeout(() => resolve('still-pending'), 10)),
        ]);

        expect(raced).toBe('still-pending');
    });
});

describe('InMemoryPublisher', () => {
    it('captures messages in publication order', async () => {
        const publisher = new InMemoryPublisher();

        await publish(publisher, message({ kind: 'first', timestamp: '2026-08-16T00:00:00.000Z' }));
        await publish(publisher, message({ kind: 'second', timestamp: '2026-08-16T00:00:01.000Z' }));

        expect(publisher.messages.map((m) => m.kind)).toEqual(['first', 'second']);
    });

    it('hands out a copy, so a test mutating the result cannot corrupt later assertions', async () => {
        const publisher = new InMemoryPublisher();
        await publish(publisher, message());

        (publisher.messages as OutboundMessage[]).length = 0;

        expect(publisher.messages).toHaveLength(1);
    });

    it('clear() empties the buffer', async () => {
        const publisher = new InMemoryPublisher();
        await publish(publisher, message());

        publisher.clear();

        expect(publisher.messages).toHaveLength(0);
    });
});

describe('ConsolePublisher', () => {
    it('logs the message to the injected sink instead of persisting it', async () => {
        const log = vi.fn();
        const sent = message();

        await publish(new ConsolePublisher(log), sent);

        expect(log).toHaveBeenCalledWith(sent);
    });
});
