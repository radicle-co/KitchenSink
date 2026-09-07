/**
 * Analytics plan U4 — the ONE shared payload contract for the client analytics door (origin R1's seam).
 *
 * ## Where this lives and why (KTD3)
 *
 * A SUBPATH export of `@kitchensink/recipe-core` (`./analytics/event-payload`), matching the
 * `verification-message` precedent — both clients and the recipe service import it, so neither
 * redeclares a wire shape. ⛔ Deliberately NOT under the recipe service's source tree with a
 * `.schema.ts` name: contract discovery is blunt on purpose (every `.schema.ts` file under the
 * service's src is wire contract), and this route is OFF the domain contract by design — the ingest
 * controller imports its zod from here, and any service-local helper uses a non-`.schema.ts` filename.
 *
 * ## Evolution rule: ADDITIVE ONLY (origin R8)
 *
 * A new event family is a NEW member beside `queryOutcomeEventSchema` (a discriminated union on `type`
 * when the second family arrives) plus a migration extending the store's CHECK — never a breaking
 * reshape of an existing member. Deployed mobile clients emit old shapes for months; the ingest door
 * must keep accepting every shape it ever accepted.
 *
 * ## The bounds (KTD4b) — sized under the `fetch keepalive` quota, and exported from HERE
 *
 * Web delivery rides `keepalive`, and the Fetch spec caps AGGREGATE in-flight keepalive bodies at
 * 64 KiB — an over-quota send REJECTS IMMEDIATELY, which a swallowing emitter turns into systematic
 * silent loss of exactly the richest events. The caps below put a worst-case serialized batch under
 * half the quota (asserted by this module's test), leaving room for a second concurrent flush. The
 * emitter (`queryOutcome.model.ts`) digests/truncates served lists to fit; the ingest route enforces
 * the same numbers because both import THESE constants — one arithmetic, two enforcement points.
 *
 * ## No actor field, structurally (R12's sibling rule)
 *
 * The actor is ALWAYS the verified token's principal. Every object is `strictObject`, so a smuggled
 * `userId` is a 400, not a silently-stripped key — and the test walks the key inventory to keep it so.
 */
import { z } from 'zod';

/**
 * Max events per batch POST. 8, not a rounder 10, because the module's own arithmetic test serializes
 * the WORST-case batch and demands it under HALF the 64 KiB keepalive quota — at 10 it measured 35 KiB.
 */
export const MAX_EVENTS_PER_BATCH = 8;

/** Max digested suggestions recorded per served list (and the ceiling on a pick's position). */
export const MAX_SERVED_LIST_ENTRIES = 20;

/** Max recorded query length, in characters. */
export const MAX_QUERY_LENGTH = 200;

/** Max digested suggestion label length, in characters. */
export const MAX_SUGGESTION_LABEL_LENGTH = 80;

/**
 * One served suggestion, DIGESTED for the wire: which section it rendered in, what the cook read, and
 * (for catalog hits) the opaque food id a later analysis can join on. Never the full suggestion object.
 */
export const servedSuggestionDigestSchema = z.strictObject({
    /** The picker section: the cook's own ingredients (`local`) or the food catalog (`catalog`). */
    group: z.enum(['local', 'catalog']),
    /** The display text the cook actually read, truncated by the emitter to the label cap. */
    label: z.string().min(1).max(MAX_SUGGESTION_LABEL_LENGTH),
    /** The opaque food id (catalog suggestions only). */
    foodId: z.string().min(1).max(64).optional(),
});

/**
 * The settled outcome of one search session (KTD6): a pick with its group + position-in-group (AE1),
 * or an explicit no-pick (AE2 — the capture-rate denominator).
 */
export const queryOutcomeSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('no_pick') }),
    z.strictObject({
        kind: z.literal('pick'),
        /** Which section the picked row rendered in. */
        group: z.enum(['local', 'catalog']),
        /** 1-based position WITHIN that group — the ranking-quality signal U15 had to reconstruct. */
        positionInGroup: z.number().int().min(1).max(MAX_SERVED_LIST_ENTRIES),
        /** The picked suggestion's opaque food id, when it has one. */
        foodId: z.string().min(1).max(64).optional(),
    }),
]);

/** One settled ingredient-search outcome (origin R1; AE1/AE2). */
export const queryOutcomeEventSchema = z.strictObject({
    /** The one client-door family. A literal so a server-door type fails the SCHEMA, not just the gate. */
    type: z.literal('query_outcome'),
    /** Client-minted AT OCCURRENCE, reused on retry (KTD5) — the idempotency key, never optional. */
    eventId: z.uuid(),
    /** When the search settled, on the client's clock — recorded, never trusted for retention. */
    occurredAt: z.iso.datetime({ offset: true }),
    /** The final settled query text (blanked later by erasure, alongside the actor id). */
    query: z.string().min(1).max(MAX_QUERY_LENGTH),
    /** The list the server answered with, digested. */
    served: z.array(servedSuggestionDigestSchema).max(MAX_SERVED_LIST_ENTRIES).readonly(),
    outcome: queryOutcomeSchema,
});

/** The ingest door's request body: a small batch of settled outcomes. */
export const analyticsEventBatchSchema = z.strictObject({
    events: z.array(queryOutcomeEventSchema).min(1).max(MAX_EVENTS_PER_BATCH).readonly(),
});

export type ServedSuggestionDigest = z.infer<typeof servedSuggestionDigestSchema>;
export type QueryOutcome = z.infer<typeof queryOutcomeSchema>;
export type QueryOutcomeEvent = z.infer<typeof queryOutcomeEventSchema>;
export type AnalyticsEventBatch = z.infer<typeof analyticsEventBatchSchema>;
