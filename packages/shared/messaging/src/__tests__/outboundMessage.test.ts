/**
 * The boundary parse for {@link OutboundMessage}.
 *
 * This schema is the substrate's ONE validation point. Producers are fire-and-forget by design (R1.1) — they
 * do not await a consumer and do not observe a failure — so a malformed message is not something anyone
 * finds out about later: it is written, it expires after three days, and nobody ever knew. Parsing at the
 * boundary is what converts that silence into a throw at the call site that caused it.
 *
 * The group key in particular has to be right the FIRST time. A DynamoDB partition and sort key are
 * immutable after table creation (KTD-2), so a message written under a wrong `groupType` is not a bug that
 * can be migrated away — it is a message a consumer will never query for.
 */
import { describe, it, expect } from 'vitest';

import { GROUP_TYPES, parseOutboundMessage, type OutboundMessage } from '../OutboundMessage.js';

const valid: OutboundMessage = {
    groupType: 'food',
    groupId: '01KZKES1FNHBW29N2VZJD7D0TW',
    timestamp: '2026-08-16T00:00:00.000Z',
    kind: 'FoodFetchCompleted',
    payload: { status: 'ready' },
};

describe('parseOutboundMessage', () => {
    it('accepts a well-formed message and returns it', () => {
        expect(parseOutboundMessage(valid)).toEqual(valid);
    });

    it.each(['groupType', 'groupId', 'timestamp'] as const)('rejects a missing %s', (field) => {
        const { [field]: _omitted, ...rest } = valid;

        expect(() => parseOutboundMessage(rest)).toThrow();
    });

    it('rejects a groupType outside the known producer set', () => {
        // The group key is HALF the partition key, and partition keys are immutable after table creation.
        // An unknown producer type does not fail later — it writes into a partition no consumer queries.
        expect(() => parseOutboundMessage({ ...valid, groupType: 'not-a-producer' })).toThrow(/groupType/i);
    });

    it('names every registered producer type, so adding one is a deliberate edit', () => {
        expect([...GROUP_TYPES]).toEqual(['food', 'recipe-import']);
    });

    it('rejects an empty groupId rather than composing a partition key with a dangling separator', () => {
        // `PK = <groupType>#<groupId>`, so an empty id yields the partition `food#` — which is a real,
        // writable partition that silently collects every id-less message from that producer.
        expect(() => parseOutboundMessage({ ...valid, groupId: '' })).toThrow();
    });

    it('rejects a timestamp that is not an ISO-8601 instant', () => {
        // The timestamp is the leading component of the SORT key (`<ISO-8601 ms>#<ULID>`), which is what
        // makes a group's query return in order. A non-lexicographic format sorts wrongly forever.
        expect(() => parseOutboundMessage({ ...valid, timestamp: '16/08/2026' })).toThrow();
        expect(() => parseOutboundMessage({ ...valid, timestamp: 1_755_302_400_000 })).toThrow();
    });

    it('rejects a timestamp with no millisecond component, which would sort out of order', () => {
        // Proven against a real table in food-service's `messageSubstrate.integration.test.ts`:
        // `2026-08-16T12:00:00Z` and `2026-08-16T12:00:00.500Z` are half a second apart, but `.` (0x2E)
        // sorts before `Z` (0x5A), so DynamoDB returns the LATER instant FIRST. Lexical order matches
        // chronological order only while the timestamp is FIXED-WIDTH — the schema is what keeps it so.
        expect(() => parseOutboundMessage({ ...valid, timestamp: '2026-08-16T12:00:00Z' })).toThrow();
    });

    it('rejects sub-millisecond precision, which is the same variable-width defect', () => {
        expect(() => parseOutboundMessage({ ...valid, timestamp: '2026-08-16T12:00:00.123456Z' })).toThrow();
    });

    it('rejects a groupId too large to fit a DynamoDB partition key', () => {
        // A partition key value is capped at 2048 BYTES. An id above the cap is a message that validates,
        // is published fire-and-forget, is rejected by the store with a ValidationException, and is
        // swallowed into the port's error sink — lost, with nothing at the call site to notice.
        expect(() => parseOutboundMessage({ ...valid, groupId: 'x'.repeat(3000) })).toThrow();
    });

    it('accepts a message with no payload — a doorbell need not carry data', () => {
        const { payload: _payload, ...withoutPayload } = valid;

        expect(() => parseOutboundMessage(withoutPayload)).not.toThrow();
    });

    it('rejects an unknown top-level field instead of silently dropping it', () => {
        // A typo'd field name would otherwise be accepted, written, and never read — the producer having
        // been told nothing. Strict is what makes the misspelling loud at the call site.
        expect(() => parseOutboundMessage({ ...valid, groupID: 'oops' })).toThrow();
    });
});
