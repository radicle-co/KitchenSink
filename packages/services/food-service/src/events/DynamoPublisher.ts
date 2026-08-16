/**
 * `DynamoPublisher` — the real substrate adapter (R1.1/R1.3/R1.4, plan U6).
 *
 * Writes one item per message to the per-stage table, composing the KTD-2 key. It is the only place in the
 * producer half that knows DynamoDB exists; everything upstream depends on the `publish` port.
 *
 * ## Why `lib-dynamodb`'s DocumentClient and not the low-level client
 *
 * The TTL attribute **must** be a NUMBER. DynamoDB silently IGNORES a string-typed TTL — nothing expires,
 * nothing errors, and the table grows forever while every test that checks "TTL is enabled" keeps passing.
 * The DocumentClient marshals a JS `number` to `N` without the caller hand-writing `{ N: '…' }`, which is
 * exactly the hand-marshalling step where that bug gets introduced. `removeUndefinedValues` is on because a
 * message's `payload` is optional and the raw client rejects an explicit `undefined`.
 *
 * ## Why the ULID suffix is not optional
 *
 * `PutItem` REPLACES on an identical `PK+SK` and returns HTTP 200. With `SK = <timestamp>` alone, two
 * messages written in the same millisecond silently become one — and the producer is fire-and-forget, so
 * nobody is told. `SK = <ISO-8601 ms>#<ULID>` makes the collision impossible while keeping the lexical
 * ordering a group's `Query` depends on.
 *
 * @implements R1.1 R1.3 R1.4
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulidx';
import type { MessagePublisher, OutboundMessage } from '@kitchensink/messaging';

/** How long a message survives before DynamoDB reaps it (ADR-0016's window, R1.5). */
export const MESSAGE_TTL_DAYS = 3;

const SECONDS_PER_DAY = 86_400;

/** Injectable clock + id generator, so the composed key is assertable without freezing global time. */
export interface DynamoPublisherClock {
    /** Current instant (defaults to `() => new Date()`). */
    readonly now?: () => Date;
    /** Fresh sort-key suffix (defaults to a `ulid`). */
    readonly newSuffix?: () => string;
}

/**
 * Compose the partition key for a message. Pure.
 *
 * `<groupType>#<groupId>` — two fields, per KTD-2, because the named producers are food's resolution
 * pipeline AND the recipe import processors, and an import job has no food id.
 *
 * @param message - The message being written.
 * @returns The partition key.
 */
export function partitionKeyFor(message: OutboundMessage): string {
    return `${message.groupType}#${message.groupId}`;
}

/**
 * Compose the sort key for a message. Pure.
 *
 * @param message - The message being written.
 * @param suffix - The uniqueness suffix (a ULID in production).
 * @returns The sort key, `<ISO-8601 ms>#<suffix>`.
 */
export function sortKeyFor(message: OutboundMessage, suffix: string): string {
    return `${message.timestamp}#${suffix}`;
}

/**
 * Compute the TTL attribute value: epoch SECONDS, as a number. Pure.
 *
 * ⚠️ Seconds, not milliseconds — DynamoDB interprets the TTL attribute as a Unix timestamp in seconds, and
 * a milliseconds value puts the expiry ~50,000 years out, which reads as "TTL is configured" while nothing
 * ever expires.
 *
 * @param now - The instant the message is written.
 * @returns The epoch-seconds expiry.
 */
export function ttlFor(now: Date): number {
    return Math.floor(now.getTime() / 1000) + MESSAGE_TTL_DAYS * SECONDS_PER_DAY;
}

export class DynamoPublisher implements MessagePublisher {
    private readonly doc: DynamoDBDocumentClient;

    /**
     * @param tableName - The per-stage table, resolved from SSM at deploy time (never hardcoded).
     * @param client - Optional injected client (tests pass a double; production builds one).
     * @param clock - Optional clock/suffix overrides for deterministic key assertions.
     */
    public constructor(
        private readonly tableName: string,
        client?: DynamoDBDocumentClient,
        private readonly clock: DynamoPublisherClock = {},
    ) {
        this.doc = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
    }

    /**
     * Write one message to the substrate.
     *
     * MAY throw — the `publish` port contains the failure and reports it to `onError`. This adapter
     * deliberately does not swallow it itself: an adapter that hid its own errors would make the port's
     * error sink permanently silent, and the sink is the only way a fire-and-forget producer's failures
     * ever become visible.
     *
     * @param message - The validated message.
     * @sideEffect Performs a DynamoDB `PutItem`.
     */
    public async send(message: OutboundMessage): Promise<void> {
        const now = (this.clock.now ?? (() => new Date()))();
        const suffix = (this.clock.newSuffix ?? ulid)();

        await this.doc.send(
            new PutCommand({
                TableName: this.tableName,
                Item: {
                    PK: partitionKeyFor(message),
                    SK: sortKeyFor(message, suffix),
                    ttl: ttlFor(now),
                    groupType: message.groupType,
                    groupId: message.groupId,
                    timestamp: message.timestamp,
                    kind: message.kind,
                    payload: message.payload,
                },
            }),
        );
    }
}
