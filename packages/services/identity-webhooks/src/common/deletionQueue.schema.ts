/**
 * The deletion queue's message contract — OUR OWN wire shape, unlike the Clerk payload in
 * `idpPayload.schema.ts`.
 *
 * ⚠️ WHY THIS EXISTS, AND WHY IT IS A SECURITY FIX RATHER THAN A TIDY-UP. `deletion-worker` read its message
 * with `JSON.parse(record.body) as IdpDeletionMessage` and then branched on `message.event` in a `switch` whose
 * `default` arm performs a FULL GDPR ERASURE plus a cross-service fan-out (a JWT-authenticated
 * `POST /api/v1/internal/account/erasure` to both recipe and food).
 *
 * The `event` field is typed `'closure' | 'reactivation' | 'erasure' | undefined`, and `undefined` legitimately
 * means "the `user.deleted` webhook path" — so the `default` arm has to erase. But nothing checked the value at
 * RUNTIME. A cast cannot narrow a string. So ANY value that was not exactly one of the three literals —
 * a typo, a case difference (`'Closure'`), a renamed event, a producer/consumer version skew, a field
 * misspelled by a future enqueuer — fell through `default` and erased the account. The most destructive
 * operation in the system was the DEFAULT for unrecognised input.
 *
 * The schema below closes that: `event`, when present, must be one of the three literals, and anything else is
 * a rejected message rather than an erasure. Absence still means the webhook path, so the legitimate behaviour
 * is unchanged — what changes is that "absent" and "unrecognised" are no longer the same thing.
 *
 * DISPOSITION ON AN INVALID MESSAGE: it THROWS, so SQS retries and then routes to the DLQ (which is alarmed).
 * That is the opposite of the Clerk webhook's acknowledge-and-alarm, and deliberately so — the difference is
 * the producer. Every enqueuer of this queue is our OWN code (`tombstone-sweep`, `identityWebhook`), so an
 * invalid message is a bug on our side that a human must see, not a third party's payload we merely have to
 * tolerate. There is no external retry schedule to get stuck in.
 */
import { z } from 'zod';

/**
 * The lifecycle events this queue carries, as a value object.
 *
 * Exported so the worker's `switch` and this validator name the SAME set — a second list in the handler is how
 * the two drift back apart.
 */
export const DELETION_EVENTS = ['closure', 'reactivation', 'erasure'] as const;

/** One of the deletion queue's explicit lifecycle events. */
export type DeletionEvent = (typeof DELETION_EVENTS)[number];

/**
 * A deletion-queue message.
 *
 * `z.object` (strip) rather than `strictObject`, matching the other queue consumers: a producer deployed ahead
 * of this worker must be able to add a field without poisoning the queue. Every field the worker ACTS on is
 * validated, which is the property that matters.
 */
export const idpDeletionMessageSchema = z.object({
    /**
     * The Clerk identity id (`user_…`). Required and non-empty: it is the predicate for
     * `userDao.findByIdentityId` and the argument to Clerk's `banUser` / `unbanUser` / erasure calls.
     *
     * NOT ULID-validated — this is Clerk's id, not an app-user ULID, and the two families are different. It is
     * bounded and non-empty instead, which is what rules out the empty-string case that would make
     * `findByIdentityId('')` quietly match nothing and report success.
     */
    identityId: z.string().min(1).max(255),
    /**
     * The app-user id, present on the `erasure` leg. Used as the fan-out's JWT subject and `ownerId`, so it is
     * bounded and non-empty when supplied; the worker separately refuses to fan out without it.
     *
     * Deliberately not ULID-strict: `users.id` is a plain collated `varchar` primary key, so tightening the
     * shape here could refuse a legitimate legacy id. The receiving services validate the signed token.
     */
    userId: z.string().min(1).max(255).optional(),
    /**
     * WHICH lifecycle event this is. **Absent means the `user.deleted` webhook full-erasure path** (see the
     * module doc); present, it must be exactly one of {@link DELETION_EVENTS}.
     *
     * This single line is the fix: an unrecognised value is now a rejected message instead of an erasure.
     */
    event: z.enum(DELETION_EVENTS).optional(),
    /** When the message was enqueued (ISO-8601). Becomes the fan-out's idempotency `eventId`. */
    enqueuedAt: z.iso.datetime().optional(),
});

/** A validated deletion-queue message. */
export type IdpDeletionMessage = z.infer<typeof idpDeletionMessageSchema>;
