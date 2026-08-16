/**
 * The message substrate against a REAL DynamoDB (plan U4/U5/U6, KTD-2).
 *
 * ## What this tier exists to prove, and why the unit tier structurally cannot
 *
 * `DynamoPublisher`'s unit suite hands the adapter a `DynamoDBDocumentClient` double and asserts on the
 * object literal the adapter passed it. That proves the adapter builds the object its author intended. It
 * cannot prove any of the following, because every one of them is a property of the *service*:
 *
 * - **That DynamoDB accepts the item at all.** A double's `send` resolves for any argument. The real
 *   marshaller rejects several shapes the type system permits — see the doorbell test below, which is the
 *   defect this suite was written to catch.
 * - **That the TTL lands as a `N`.** `typeof value === 'number'` in the test process says nothing about the
 *   attribute type in the table. DynamoDB **silently ignores a string-typed TTL**: no error, no failed put,
 *   items simply never expire. Only reading the attribute back and inspecting its DynamoDB *type* proves it.
 * - **That the sort key actually sorts.** `[b, a].sort()` asserts JavaScript's collation. `Query` asserts
 *   DynamoDB's, which is what production depends on.
 * - **That the group key partitions.** Nothing in a unit test can distinguish a partition key that isolates
 *   groups from a string that merely looks like one.
 * - **That the adapter and the CDK stack agree on attribute names.** The table here is created from the
 *   SYNTHESIZED `FoodServiceStack` template (`tests/support/messageTable.ts`), so a rename on either side
 *   turns this suite red instead of failing in production with `ValidationException`.
 *
 * ## Harness
 *
 * LocalStack DynamoDB at `AWS_ENDPOINT_URL` (default `http://localhost:4566`). Each test writes under its
 * own freshly-generated group id, so the specs are order-independent and share one table without
 * interfering.
 */
import {
    QueryCommand as RawQueryCommand,
    DescribeTimeToLiveCommand,
    type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulidx';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { publish, type OutboundMessage } from '@kitchensink/messaging';

import { DynamoPublisher, MESSAGE_TTL_DAYS, partitionKeyFor } from '../src/events/DynamoPublisher.js';
import {
    ensureMessageTable,
    localDynamoClient,
    messageTableDefinition,
    type MessageTableDefinition,
} from './support/messageTable.js';

const client = localDynamoClient();
const documentClient = DynamoDBDocumentClient.from(client);

let table: MessageTableDefinition;

beforeAll(async () => {
    table = messageTableDefinition();
    await ensureMessageTable(client, table);
});

// The table is deliberately LEFT IN PLACE. Dropping it here would force the next run to recreate it, and
// `DeleteTable` is asynchronous by AWS contract — recreating across that window is what made this suite
// fail 2 runs in 5 with `ResourceInUseException`. Isolation comes from every spec generating its own
// `groupId`, not from an empty table, so a reused table cannot affect an assertion.
afterAll(() => {
    client.destroy();
});

/**
 * Build a message for a group nobody else in this file writes to.
 *
 * @param overrides - Fields to replace.
 * @returns A valid message.
 */
function makeMessage(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
    return {
        groupType: 'food',
        groupId: ulid(),
        timestamp: '2026-08-16T12:00:00.000Z',
        kind: 'FoodFetchCompleted',
        payload: { status: 'RESOLVED' },
        ...overrides,
    };
}

/**
 * Read every item in a group, oldest first, exactly as feature 014's doorbell consumer will.
 *
 * This is the plan's "pre-freeze verification" read (U5), kept as a test rather than the throwaway script
 * the plan proposed — the key schema is immutable after creation, so the read that justifies it should be
 * the read that keeps running.
 *
 * @param groupKey - The composed partition key.
 * @returns The group's items in sort-key order.
 * @sideEffect Queries DynamoDB.
 */
async function queryGroup(groupKey: string): Promise<Record<string, unknown>[]> {
    const result = await documentClient.send(
        new QueryCommand({
            TableName: table.tableName,
            KeyConditionExpression: '#pk = :pk',
            ExpressionAttributeNames: { '#pk': table.partitionKeyAttribute },
            ExpressionAttributeValues: { ':pk': groupKey },
            ScanIndexForward: true,
        }),
    );

    return result.Items ?? [];
}

describe('a real PutItem under the key schema the CDK stack freezes', () => {
    it('persists the message, and every field survives the round trip', async () => {
        const message = makeMessage({ kind: 'FoodFetchCompleted', payload: { status: 'RESOLVED', attempts: 2 } });

        await new DynamoPublisher(table.tableName, documentClient).send(message);

        const [item] = await queryGroup(partitionKeyFor(message));
        expect(item).toMatchObject({
            groupType: 'food',
            groupId: message.groupId,
            timestamp: '2026-08-16T12:00:00.000Z',
            kind: 'FoodFetchCompleted',
            payload: { status: 'RESOLVED', attempts: 2 },
        });
    });

    it('accepts the table name the infrastructure helper composes', async () => {
        // `kitchensink-messages-pr-4242` has to be a LEGAL DynamoDB table name, not merely the right string.
        // The name helper's unit test asserts the characters; only a real `CreateTable` proves the service
        // accepts them, and this suite would have failed in `beforeAll` if it did not.
        expect(table.tableName).toMatch(/^kitchensink-messages-/);

        const message = makeMessage();
        await new DynamoPublisher(table.tableName, documentClient).send(message);

        expect(await queryGroup(partitionKeyFor(message))).toHaveLength(1);
    });

    it('persists a DOORBELL message that carries no payload at all', async () => {
        // KTD-2: "a message that carries only 'something changed for this group' is a COMPLETE message", and
        // `payload` is optional in the schema for exactly that reason. `lib-dynamodb` skips a TOP-LEVEL
        // `undefined` in `Item`, so this case survives without `removeUndefinedValues` — which is precisely
        // what makes the nested case below so easy to miss.
        const message = makeMessage();
        delete (message as { payload?: unknown }).payload;
        const onError = vi.fn();

        await publish(new DynamoPublisher(table.tableName, documentClient), message, { onError });

        expect(onError).not.toHaveBeenCalled();
        const [item] = await queryGroup(partitionKeyFor(message));
        expect(item).toMatchObject({ kind: 'FoodFetchCompleted', groupId: message.groupId });
        expect(item).not.toHaveProperty('payload');
    });

    it('⛔ persists a payload holding an undefined field, instead of silently losing the message', async () => {
        // `payload` is `z.record(z.string(), z.unknown())`, and `z.unknown()` ACCEPTS `undefined` — so
        // `{ lastError: undefined }` passes the boundary. `@aws-sdk/util-dynamodb` then THROWS on an
        // undefined inside a map unless the DocumentClient was built with `removeUndefinedValues: true`,
        // `publish` swallows the throw to `onError`, and the message is gone with nobody told.
        //
        // The adapter builds its OWN client here — no injected DocumentClient — because that constructor is
        // where the marshalling options live and where the deployed worker's behaviour is decided. Injecting
        // a correctly-configured client would test the test's configuration, not production's.
        const message = makeMessage({ payload: { status: 'RESOLVED', lastError: undefined } });
        const onError = vi.fn();

        await publish(new DynamoPublisher(table.tableName), message, { onError });

        expect(onError).not.toHaveBeenCalled();
        const [item] = await queryGroup(partitionKeyFor(message));
        expect(item?.['payload']).toEqual({ status: 'RESOLVED' });
    });
});

describe('the TTL attribute, read back from the table', () => {
    /**
     * Fetch one item with the LOW-LEVEL client, so attribute TYPE TAGS are visible.
     *
     * The DocumentClient exists to hide `{ N: '…' }` behind a JS number — which is precisely the
     * information this describe block needs, so it must not be used here. `AttributeValue` is the SDK's
     * own discriminated union over those tags and is returned unchanged: re-typing the map would throw
     * away the one distinction these tests are here to make.
     *
     * @param message - The message whose item to read.
     * @returns The raw attribute map.
     * @throws {Error} When nothing was written — otherwise a lost message reads as a passing type check.
     * @sideEffect Queries DynamoDB.
     */
    async function rawItemFor(message: OutboundMessage): Promise<Record<string, AttributeValue>> {
        const result = await client.send(
            new RawQueryCommand({
                TableName: table.tableName,
                KeyConditionExpression: '#pk = :pk',
                ExpressionAttributeNames: { '#pk': table.partitionKeyAttribute },
                ExpressionAttributeValues: { ':pk': { S: partitionKeyFor(message) } },
            }),
        );

        const item = result.Items?.[0];

        if (item === undefined) {
            throw new Error(`No item was written for ${partitionKeyFor(message)}.`);
        }

        return item;
    }

    /**
     * Pull one attribute out of a written item.
     *
     * @param item - The raw attribute map.
     * @param name - The attribute to read.
     * @returns The attribute, still carrying its DynamoDB type tag.
     * @throws {Error} When the attribute is absent.
     */
    function attributeOf(item: Record<string, AttributeValue>, name: string): AttributeValue {
        const value = item[name];

        if (value === undefined) {
            throw new Error(`The written item carries no '${name}' attribute.`);
        }

        return value;
    }

    it('⛔ is typed N, not S — DynamoDB silently ignores a string TTL', async () => {
        // This is the highest-value assertion in the file. A string TTL produces NO error, NO failed put and
        // NO template diff: the table simply grows forever. `typeof x === 'number'` in the test process
        // cannot see it, because the marshaller is what decides the stored type.
        const message = makeMessage();
        await new DynamoPublisher(table.tableName, documentClient).send(message);

        const attribute = attributeOf(await rawItemFor(message), table.ttlAttribute);

        // The tag itself is the assertion. `{ S: '1786...' }` is what a string TTL looks like on the wire,
        // and DynamoDB accepts it without complaint — it just never expires anything.
        expect(Object.keys(attribute)).toEqual(['N']);
    });

    it('is written under the attribute name the table expires on', async () => {
        // The adapter hardcodes `ttl`; the stack configures `timeToLiveAttribute`. Nothing else checks that
        // those two strings are the same one, and a divergence is invisible — items are written, the table
        // reports TTL enabled, and nothing expires.
        const described = await client.send(new DescribeTimeToLiveCommand({ TableName: table.tableName }));
        const message = makeMessage();
        await new DynamoPublisher(table.tableName, documentClient).send(message);

        const attributeName = described.TimeToLiveDescription?.AttributeName;

        expect(attributeName).toBe(table.ttlAttribute);
        expect(await rawItemFor(message)).toHaveProperty(attributeName ?? 'ttl');
    });

    it('holds epoch SECONDS three days out, not milliseconds', async () => {
        // Milliseconds would put the expiry ~50,000 years away and read exactly like "TTL is configured".
        const message = makeMessage();
        const before = Math.floor(Date.now() / 1000);

        await new DynamoPublisher(table.tableName, documentClient).send(message);

        const attribute = attributeOf(await rawItemFor(message), table.ttlAttribute);

        // Narrowed through `AttributeValue`'s own discriminant rather than re-typed: if the tag is not
        // `N` the value is NaN, and every comparison below fails loudly instead of silently coercing.
        const stored = Number('N' in attribute ? attribute.N : Number.NaN);
        const expected = before + MESSAGE_TTL_DAYS * 86_400;

        expect(stored).toBeGreaterThanOrEqual(expected);
        expect(stored).toBeLessThanOrEqual(expected + 60);
    });

    it('does NOT hide an already-expired item from a Query (plan U7)', async () => {
        // Expiry is a background sweep, not a read-time filter: DynamoDB guarantees deletion only "within a
        // few days" of the timestamp, and until then an expired item is returned by every Query. U7 requires
        // consumers to carry their own TTL filter expression for this reason. Pinning the premise here means
        // that requirement is not merely asserted in prose.
        const message = makeMessage();
        const longExpired = { now: () => new Date('2020-01-01T00:00:00.000Z') };

        await new DynamoPublisher(table.tableName, documentClient, longExpired).send(message);

        expect(await queryGroup(partitionKeyFor(message))).toHaveLength(1);
    });
});

describe('the sort key orders a group chronologically (KTD-2)', () => {
    it('returns messages oldest-first when they were written out of order', async () => {
        const groupId = ulid();
        const chronological = [
            '2026-08-16T12:00:00.000Z',
            '2026-08-16T12:00:01.000Z',
            '2026-08-16T12:00:02.000Z',
            '2026-08-16T12:00:03.000Z',
        ];
        // Suffixes DESCEND as the timestamps ascend, so a sort key composed the other way round
        // (`<suffix>#<timestamp>`) returns the group in exactly reverse order rather than by luck: a real
        // ULID suffix is itself time-ordered and would mask that mutation.
        const suffixes = ['SFXD', 'SFXC', 'SFXB', 'SFXA'];
        const writeOrder = [2, 0, 3, 1];

        for (const index of writeOrder) {
            const publisher = new DynamoPublisher(table.tableName, documentClient, {
                newSuffix: () => suffixes[index] ?? '',
            });
            await publisher.send(makeMessage({ groupId, timestamp: chronological[index] }));
        }

        const items = await queryGroup(`food#${groupId}`);

        expect(items.map((item) => item['timestamp'])).toEqual(chronological);
    });

    it('keeps BOTH messages when two are written in the same millisecond', async () => {
        // `PutItem` REPLACES on an identical PK+SK and returns 200. Without the ULID suffix the second write
        // destroys the first, and the fire-and-forget producer is never told. The real `ulid` is used here —
        // no injected suffix — because the default is what production runs.
        const message = makeMessage();
        const publisher = new DynamoPublisher(table.tableName, documentClient);

        await publisher.send(message);
        await publisher.send(message);

        expect(await queryGroup(partitionKeyFor(message))).toHaveLength(2);
    });

    it('⛔ misorders a group when timestamp precision varies — which is why the boundary fixes it', async () => {
        // `2026-08-16T12:00:00Z` and `2026-08-16T12:00:00.500Z` are half a second apart, but `.` (0x2E)
        // sorts BEFORE `Z` (0x5A), so the LATER instant comes back FIRST. Lexical order equals chronological
        // order only while the timestamp is fixed-width, so `OutboundMessage` must reject any other
        // precision at the boundary — the adapter, which does not validate, is used here deliberately to
        // demonstrate the failure the schema now prevents.
        const groupId = ulid();
        const publisher = new DynamoPublisher(table.tableName, documentClient, { newSuffix: () => 'SFX' });

        await publisher.send({ ...makeMessage({ groupId }), timestamp: '2026-08-16T12:00:00Z' });
        await publisher.send({ ...makeMessage({ groupId }), timestamp: '2026-08-16T12:00:00.500Z' });

        const items = await queryGroup(`food#${groupId}`);

        expect(items.map((item) => item['timestamp'])).toEqual(['2026-08-16T12:00:00.500Z', '2026-08-16T12:00:00Z']);
    });

    it('⛔ rejects a timestamp whose precision would break that ordering, before it is written', async () => {
        const onError = vi.fn();
        const message = { ...makeMessage(), timestamp: '2026-08-16T12:00:00Z' };

        await expect(
            publish(new DynamoPublisher(table.tableName, documentClient), message, { onError }),
        ).rejects.toThrow();

        // A malformed message is the CALLER's bug and must be loud — it must NOT be routed to the
        // infrastructure error sink, where it would be indistinguishable from DynamoDB being down.
        expect(onError).not.toHaveBeenCalled();
        expect(await queryGroup(partitionKeyFor(message))).toHaveLength(0);
    });
});

describe('the group key partitions as KTD-2 intends', () => {
    it('returns one group`s messages and no others', async () => {
        const sharedId = ulid();
        const publisher = new DynamoPublisher(table.tableName, documentClient);

        await publisher.send(makeMessage({ groupType: 'food', groupId: sharedId, kind: 'FoodFetchCompleted' }));
        await publisher.send(makeMessage({ groupType: 'food', groupId: sharedId, kind: 'FetchFailed' }));
        // Same entity id, different producer — the case a single-field group key would have collapsed.
        await publisher.send(makeMessage({ groupType: 'recipe-import', groupId: sharedId, kind: 'ImportStarted' }));
        await publisher.send(makeMessage({ groupType: 'food', groupId: ulid(), kind: 'FoodFetchCompleted' }));

        const foodGroup = await queryGroup(`food#${sharedId}`);

        expect(foodGroup.map((item) => item['kind']).sort()).toEqual(['FetchFailed', 'FoodFetchCompleted']);
        expect(foodGroup.every((item) => item['groupType'] === 'food')).toBe(true);
    });

    it('isolates the other producer`s group under the same entity id', async () => {
        const sharedId = ulid();
        const publisher = new DynamoPublisher(table.tableName, documentClient);

        await publisher.send(makeMessage({ groupType: 'food', groupId: sharedId }));
        await publisher.send(makeMessage({ groupType: 'recipe-import', groupId: sharedId, kind: 'ImportStarted' }));

        const importGroup = await queryGroup(`recipe-import#${sharedId}`);

        expect(importGroup).toHaveLength(1);
        expect(importGroup[0]).toMatchObject({ groupType: 'recipe-import', kind: 'ImportStarted' });
    });

    it('cannot be prefix-queried by producer type — a partition key is exact-match only', async () => {
        // `OutboundMessage`'s module doc claims the two-field key "makes 'all import messages' a queryable
        // prefix". DynamoDB does not allow that: a partition key condition must be equality, and
        // `begins_with` on it is a ValidationException. Reaching every import group means a Scan. Pinned
        // here so the rationale is not mistaken for a capability by whoever builds feature 014.
        const failure = await documentClient
            .send(
                new QueryCommand({
                    TableName: table.tableName,
                    KeyConditionExpression: 'begins_with(#pk, :prefix)',
                    ExpressionAttributeNames: { '#pk': table.partitionKeyAttribute },
                    ExpressionAttributeValues: { ':prefix': 'recipe-import#' },
                }),
            )
            .then(
                () => undefined,
                (error: unknown) => error,
            );

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).name).toBe('ValidationException');
    });
});

describe('what the store refuses, and therefore what the boundary must', () => {
    it('⛔ refuses an oversized group id at the BOUNDARY, not at the store', async () => {
        // A DynamoDB partition key value is capped at 2048 BYTES, and the adapter writes
        // `<groupType>#<groupId>` into it. With no upper bound on `groupId` an oversized id is a message
        // that VALIDATES, is published fire-and-forget, is rejected by the service with a
        // ValidationException, and is swallowed into `onError` — lost, with nothing at the call site told.
        //
        // The store's refusal is real: writing the same id through the ADAPTER (which does not validate)
        // is asserted below, so this pairing shows both what the store does and where it must be prevented.
        const onError = vi.fn();
        const message = makeMessage({ groupId: 'x'.repeat(3000) });

        await expect(
            publish(new DynamoPublisher(table.tableName, documentClient), message, { onError }),
        ).rejects.toThrow();

        // A malformed message is the CALLER's bug and must be loud. Routing it to the infrastructure sink
        // would make it indistinguishable from DynamoDB being down.
        expect(onError).not.toHaveBeenCalled();
    });

    it('⛔ is refused by the real store when the boundary is bypassed — the reason the bound exists', async () => {
        const message = makeMessage({ groupId: 'x'.repeat(3000) });

        const failure = await new DynamoPublisher(table.tableName, documentClient).send(message).then(
            () => undefined,
            (error: unknown) => error,
        );

        expect((failure as Error).name).toBe('ValidationException');
    });
});
