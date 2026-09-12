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
 * The app-user id. Bounded and non-empty; deliberately not ULID-strict, because `users.id` is a plain
 * collated `varchar` primary key and tightening the shape here could refuse a legitimate legacy id. The
 * receiving services validate the signed token.
 */
const userIdSchema = z.string().min(1).max(255);

/**
 * The fields every variant carries.
 *
 * `z.object` (strip) rather than `strictObject`, matching the other queue consumers: a producer deployed ahead
 * of this worker must be able to add a field without poisoning the queue. Every field the worker ACTS on is
 * validated, which is the property that matters.
 */
const deletionMessageBaseSchema = z.object({
    /**
     * The Clerk identity id (`user_…`). Required and non-empty: it is the predicate for
     * `userDao.findByIdentityId` and the argument to Clerk's `banUser` / `unbanUser` / erasure calls.
     *
     * NOT ULID-validated — this is Clerk's id, not an app-user ULID, and the two families are different. It is
     * bounded and non-empty instead, which is what rules out the empty-string case that would make
     * `findByIdentityId('')` quietly match nothing and report success.
     */
    identityId: z.string().min(1).max(255),
    /** When the message was enqueued (ISO-8601). Becomes the fan-out's idempotency `eventId`. */
    enqueuedAt: z.iso.datetime().optional(),
});

/**
 * The `erasure` variant — the one leg whose subject is the APP user, not the Clerk identity.
 *
 * `userId` is REQUIRED here, and that requirement is the whole point of the union. The fan-out signs a
 * service-principal token with it and both downstream services key their erasure on it; without it there is
 * nothing to erase. Every producer sets it (identity's `SqsService` types it required; the tombstone-sweep
 * copies `tombstone.id`), so an erasure without one is a producer bug. The worker used to catch that case at
 * runtime with `warn` + `return` — and a `return` is an ACKNOWLEDGEMENT to Lambda's SQS event source, so the
 * message was deleted, never retried, never DLQ'd, and that user's recipe/food erasure was skipped silently and
 * permanently. Rejecting it at parse time puts it on the same path as every other invalid message: throw,
 * retry, DLQ, alarm. The handler's `userId` narrows to `string` and its runtime check ceased to exist.
 */
const erasureMessageSchema = deletionMessageBaseSchema.extend({
    event: z.literal('erasure'),
    userId: userIdSchema,
});

/**
 * Every other variant: the two Clerk-side lifecycle mutations, and — with `event` ABSENT — the `user.deleted`
 * webhook full-erasure path (see the module doc). `userId` is informational here (correlation/logging).
 *
 * `z.enum(DELETION_EVENTS).exclude(['erasure'])` rather than a second literal list, so this validator and the
 * worker's `switch` keep naming ONE set; a fourth event added to {@link DELETION_EVENTS} lands here by default.
 */
const lifecycleMessageSchema = deletionMessageBaseSchema.extend({
    /**
     * WHICH lifecycle event this is. **Absent means the `user.deleted` webhook full-erasure path**; present, it
     * must be one of {@link DELETION_EVENTS} — and `erasure` is the sibling variant above, so a message that
     * SAYS `erasure` is judged by that variant's rules, never by this one's laxer `userId`.
     *
     * This is the line that made an unrecognised value a rejected message instead of an erasure.
     */
    event: z.enum(DELETION_EVENTS).exclude(['erasure']).optional(),
    userId: userIdSchema.optional(),
});

/**
 * A deletion-queue message: a tagged union over `event`.
 *
 * `z.union` rather than `z.discriminatedUnion`, because one variant's discriminant is legitimately ABSENT
 * (the webhook path) and the `erasure` variant must win on its literal before the lifecycle variant is tried.
 * Ordering is therefore load-bearing: `erasure` first.
 */
export const idpDeletionMessageSchema = z.union([erasureMessageSchema, lifecycleMessageSchema]);

/** A validated deletion-queue message. Narrowing on `event === 'erasure'` yields a required `userId`. */
export type IdpDeletionMessage = z.infer<typeof idpDeletionMessageSchema>;
