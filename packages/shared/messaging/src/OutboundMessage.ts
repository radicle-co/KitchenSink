/**
 * The message a producer publishes to the substrate, and its boundary parse (KTD-2, plan U4).
 *
 * ## Why this is a shape change, not a rename
 *
 * This replaces food-service's `EventBusPutInput` (`{ detailType, detail }`), which is EventBridge-shaped —
 * it describes a *bus* rather than a *message*. The substrate is a durable per-group store, so the message
 * has to carry the thing the store is keyed on: the **two-field group key** plus a timestamp.
 *
 * ## Why the group key is TWO fields
 *
 * `PK = <groupType>#<groupId>`. An earlier design keyed on the food id alone, which does not generalise: the
 * two named producers are the food resolution pipeline **and** the recipe import processors, and an import
 * job has no food id. Keeping the producer type explicit also makes "all import messages" a queryable
 * prefix, which a single opaque string would not.
 *
 * ⚠️ **A DynamoDB partition and sort key are immutable after table creation.** A message written under the
 * wrong `groupType` is not a bug that can be migrated away later — it lands in a partition no consumer ever
 * queries, and the 3-day TTL removes the evidence. That is why the type is a closed set parsed here rather
 * than a free string checked nowhere.
 *
 * ## Why the timestamp is an ISO-8601 STRING
 *
 * It is the leading component of the sort key (`<ISO-8601 ms>#<ULID>`), so it must sort lexicographically in
 * the same order it sorts chronologically. ISO-8601 does; epoch millis as a number does not (in a string
 * key), and a locale format does not at all. The ULID suffix is what stops two messages written in the same
 * millisecond replacing each other — `PutItem` REPLACES on an identical `PK+SK` and returns success, which
 * is invisible to a fire-and-forget producer.
 *
 * @module
 */

import { z } from 'zod';

/**
 * Every producer that may write to the substrate.
 *
 * A closed set, and deliberately small. Adding a member is a decision about the partition-key space, which
 * cannot be re-cut after the table exists — so it is a deliberate edit here, pinned by a test, rather than
 * whatever string a caller happened to pass.
 */
export const GROUP_TYPES = ['food', 'recipe-import'] as const;

/** A producer type registered in {@link GROUP_TYPES}. */
export type GroupType = (typeof GROUP_TYPES)[number];

/**
 * An ISO-8601 instant with millisecond precision, in UTC — the sort key's leading component.
 *
 * `z.iso.datetime` is used rather than a hand-rolled regex (library-first): it is the same validator the
 * rest of the repo's wire schemas use for instants, so "what counts as a timestamp" has one definition.
 *
 * ⚠️ **`precision: 3` is load-bearing, not cosmetic.** Bare `z.iso.datetime()` accepts ANY fractional
 * precision — `…T12:00:00Z`, `…T12:00:00.5Z` and `…T12:00:00.123456Z` all pass. Mixed widths destroy the
 * one property the sort key exists for: `.` is 0x2E and `Z` is 0x5A, so `…12:00:00.500Z` sorts BEFORE
 * `…12:00:00Z` while being half a second LATER. Confirmed against a real table — see
 * `packages/services/food-service/tests/messageSubstrate.integration.test.ts`. Lexical order equals
 * chronological order only while every timestamp is the same width, so the boundary pins the width.
 * `Date.prototype.toISOString` already emits exactly this form, so no correct producer is affected.
 */
const isoTimestamp = z.iso.datetime({ precision: 3 });

/**
 * The longest `groupId` that can safely occupy half a partition key.
 *
 * DynamoDB caps a partition key value at **2048 bytes** of UTF-8. The adapter writes
 * `<groupType>#<groupId>`, and the longest registered `groupType` (`recipe-import`) plus the separator
 * costs 14 bytes — leaving 2034. A JS string length counts UTF-16 code units, each of which can encode up
 * to 3 UTF-8 bytes, so 512 units can never exceed 1536 bytes and stays comfortably inside the budget.
 *
 * Without a bound, an oversized id is a message that VALIDATES, is published fire-and-forget, is rejected
 * by the store with a `ValidationException`, and is swallowed by `publish` into `onError` — lost, with
 * nothing at the call site to notice. The boundary, not the store, is where that is caught.
 */
export const MAX_GROUP_ID_LENGTH = 512;

/**
 * The published message contract.
 *
 * `.strict()` on purpose: a producer is fire-and-forget and observes nothing, so a misspelled field would
 * otherwise be silently dropped, written, and expired unread. Strict turns that into a throw at the call
 * site that caused it.
 */
export const outboundMessageSchema = z
    .object({
        /** Which producer wrote this — the first half of the partition key. */
        groupType: z.enum(GROUP_TYPES),
        /** The entity this message is about — the second half of the partition key. */
        groupId: z.string().min(1).max(MAX_GROUP_ID_LENGTH),
        /** When the producer emitted it — the sort key's leading component. */
        timestamp: isoTimestamp,
        /** What happened, in the producer's own vocabulary (e.g. `FoodFetchCompleted`). */
        kind: z.string().min(1),
        /**
         * Optional detail.
         *
         * Optional because the stream record is a DOORBELL (KTD-2): a consumer is woken and then re-queries
         * the group, so a message that carries only "something changed for this group" is a complete
         * message. Nothing downstream is entitled to assume a payload exists.
         */
        payload: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();

/** A message a producer publishes to the substrate. */
export type OutboundMessage = z.infer<typeof outboundMessageSchema>;

/**
 * Parse an unknown value into an {@link OutboundMessage}, throwing on anything malformed. Pure.
 *
 * This is the substrate's only validation point. It runs INSIDE `publish` (see `publish.ts`) rather than
 * being left to callers, because a producer that forgot to validate is exactly the producer whose bad
 * message nobody would ever notice.
 *
 * @param value - The candidate message.
 * @returns The validated message.
 * @throws {z.ZodError} When any field is missing, malformed, or unrecognised.
 */
export function parseOutboundMessage(value: unknown): OutboundMessage {
    return outboundMessageSchema.parse(value);
}
