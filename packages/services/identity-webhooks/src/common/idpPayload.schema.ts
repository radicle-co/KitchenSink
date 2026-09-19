/**
 * ⚠️ DELIBERATE — A THIRD-PARTY BOUNDARY SHAPE. This models CLERK'S webhook payload, which is an API we do
 * NOT serve and do not own (`docs/CODING_STANDARDS.md` §15.3, the same codified exception
 * `packages/clients/usda/src/schemas.ts` carries).
 *
 * Two consequences follow, and both are the point rather than an oversight:
 *
 *  1. **It does NOT belong in `packages/schemas/identity`.** That package publishes OUR contract, generated
 *     from schemas identity itself authors and serves. Clerk's payload is neither ours to publish nor stable
 *     on our release cycle, so putting it there would assert authorship of a shape a third party can change
 *     without telling us.
 *  2. **It is TOLERANT (`z.looseObject`), not strict.** Clerk adds fields to `UserJSON` routinely. A strict
 *     schema would turn every such addition into a rejected payload for every user, so unknown keys are
 *     preserved rather than refused, and only the fields these handlers actually consume are modelled.
 *
 * WHY IT EXISTS AT ALL. `verifyWebhook` returned `wh.verify(...) as IdpWebhookEvent` and the handler then did
 * `payload.data as unknown as IdentityUserData` — a double cast, which silences the compiler entirely. So the
 * signature was verified and the SHAPE was never checked, while the values reached `db.update(users)`,
 * `userDao.syncNameAndPicture`, an outbound Clerk `setExternalId` call, and an SNS publish consumed by
 * recipe-workers. **A signature proves Clerk SENT it; it proves nothing about what is in it.**
 *
 * BOUNDS COME FROM THE COLUMNS these values land in, per the owner's rule that the database schema is the
 * minimum level of validation:
 *  - `users.email` is `varchar(320) NOT NULL` → an email is REQUIRED and capped at 320 (the RFC 5321 maximum).
 *    Note what this changes: an email-less payload previously reached the insert and violated `NOT NULL`,
 *    producing a 500 and therefore an svix retry loop that could never succeed. It is now a clean rejection.
 *  - `users.name` / `users.picture` / `profiles.display_name` are unbounded `text`, so those carry the app's
 *    own display-name bound instead (see {@link MAX_DISPLAY_NAME_LENGTH}).
 */
import { z } from 'zod';

/**
 * The maximum length of `users.email` — `varchar(320)`, which is the RFC 5321 maximum address length.
 *
 * The format is deliberately NOT validated beyond non-emptiness. Clerk has already verified the address (it
 * is the identity provider; that is its job), so re-deriving "what a valid email looks like" here would add a
 * second opinion whose only possible effect is to reject a real, Clerk-verified user whose address our regex
 * happens to dislike. The column's length is a storage constraint and IS enforced; the semantics are Clerk's.
 */
export const MAX_EMAIL_LENGTH = 320;

/**
 * The maximum length accepted for a name component.
 *
 * `users.name` and `profiles.display_name` are unbounded `text`, so the column imposes no ceiling. This bound
 * matches the 100 characters identity's own `patchUserMeRequestSchema` allows for a `displayName`, so a name
 * arriving via Clerk cannot exceed what a user could have set through identity's own API. `buildDisplayName`
 * joins first + last, so each component is bounded separately and the join is bounded by construction.
 */
export const MAX_DISPLAY_NAME_LENGTH = 100;

/** One Clerk email address entry. Tolerant of the many fields Clerk carries that we never read. */
const emailAddressSchema = z.looseObject({
    /** The address itself — bounded by `users.email`'s `varchar(320)`. */
    email_address: z.string().min(1).max(MAX_EMAIL_LENGTH),
});

/**
 * A name component (`first_name` / `last_name`).
 *
 * `.nullable().optional()` because Clerk genuinely sends `null` for an unset name, and the handler already
 * coalesces (`data.first_name ?? ''`). Modelling that faithfully keeps a legitimate no-first-name user
 * working; what it no longer admits is a non-string (an object, an array) reaching a `text` column.
 */
const nameComponentSchema = z.string().max(MAX_DISPLAY_NAME_LENGTH).nullable().optional();

/**
 * The Clerk `id` (the `sub`) — REQUIRED and non-empty, with NO sentinel fallback.
 *
 * This replaces `(payload.data as { id?: string }).id ?? 'unknown'`. That fallback meant a payload with no id
 * was logged and traced as though `'unknown'` were an identity, and `recordOnce(db, svixId, identityId, …)`
 * persisted it. An id is what identifies the user whose row is about to be written or deleted, so its absence
 * makes the payload invalid rather than defaultable — per the owner's rule that an id is always required
 * except on a create/upsert that generates one, which this is not (Clerk mints it).
 */
const clerkIdSchema = z.string().min(1);

/** The user fields `user.created` / `user.updated` consume. */
const identityUserDataSchema = z.looseObject({
    /** Clerk's user id (the `sub`) — required. */
    id: clerkIdSchema,
    /**
     * The user's email addresses. At least one is REQUIRED because `users.email` is `NOT NULL`, and the
     * handler reads `email_addresses[0]`.
     *
     * ⚠️ KNOWN LIMITATION, pre-existing and unchanged: a phone-only Clerk signup has no email address and
     * cannot be provisioned. Previously that failed as a `NOT NULL` violation mid-insert (a 500, retried by
     * svix until exhaustion); it is now a clean, alarmed rejection. Either way the user is not created — that
     * is a product gap, not something this schema introduces.
     */
    email_addresses: z.array(emailAddressSchema).min(1),
    /** Given name, or `null` when unset. */
    first_name: nameComponentSchema,
    /** Family name, or `null` when unset. */
    last_name: nameComponentSchema,
    /** Avatar URL. Optional and nullable; written to the nullable `users.picture` / `profiles.avatar_url`. */
    image_url: z.string().max(2048).nullable().optional(),
});

/** The user fields `user.deleted` consumes — the id ALONE, and it is required. */
const identityUserDeletedSchema = z.looseObject({
    /**
     * Clerk's user id. Required for the same reason as above, but the stakes are higher: this keys a
     * DELETE. A delete on a fabricated id is worse than a rejected payload — it either erases nothing while
     * reporting success, or erases the wrong row.
     */
    id: clerkIdSchema,
});

/**
 * The verified Clerk webhook event, discriminated on `type`.
 *
 * A discriminated union rather than one permissive object, so each event type is validated against exactly
 * what its handler reads: `user.deleted` genuinely carries only an id (Clerk sends a `deleted` object, not a
 * full user), so requiring an email there would reject every real deletion. The previous single
 * `IdentityUserData` cast could not express that distinction — which is why `handleUserDeleted` had its own
 * separate `as unknown as { id: string }`.
 */
export const idpWebhookEventSchema = z.discriminatedUnion('type', [
    z.looseObject({ type: z.literal('user.created'), data: identityUserDataSchema }),
    z.looseObject({ type: z.literal('user.updated'), data: identityUserDataSchema }),
    z.looseObject({ type: z.literal('user.deleted'), data: identityUserDeletedSchema }),
]);

/** A signature-verified AND shape-validated Clerk webhook event. */
export type IdpWebhookEvent = z.infer<typeof idpWebhookEventSchema>;

/**
 * The event types this service ACTS on. Derived from the union above, so there is no second list to keep in
 * lockstep — adding an arm to the union extends this set automatically.
 */
export const HANDLED_EVENT_TYPES: ReadonlySet<string> = new Set(
    idpWebhookEventSchema.options.map((option) => option.shape.type.value),
);

/**
 * The minimal envelope every Clerk delivery shares: just enough to decide whether we handle this event at all.
 *
 * WHY THIS IS A SEPARATE, EARLIER PARSE. `idpWebhookEventSchema` is a discriminated union, so it REJECTS an
 * event type it has no arm for. Running it as the only check would reclassify a merely-UNHANDLED event (say a
 * `session.created`, which arrives whenever someone widens the subscription list in the Clerk dashboard) as an
 * invalid payload — turning a quiet, correct no-op into an ERROR-level alarm. Unhandled and invalid are
 * genuinely different: one means "not our business", the other means "Clerk's contract moved and user records
 * are diverging". Splitting the parse keeps that distinction, and keeps full compile-time narrowing in the
 * dispatch, which a catch-all arm in the union would have destroyed (`type` would widen to `string`).
 */
export const idpEventEnvelopeSchema = z.looseObject({
    /** The Clerk event type, e.g. `user.created`. Required and non-empty on every genuine delivery. */
    type: z.string().min(1),
});

/** The user payload of a `user.created` / `user.updated` event. */
export type IdentityUserData = z.infer<typeof identityUserDataSchema>;

/**
 * Why an inbound payload was rejected.
 *
 * ONE rejection PATH, but the reason travels as a FIELD — because the disposition is identical (acknowledge,
 * do not retry, alarm) while the diagnosis is not. `signature` means the caller is not Clerk, or our signing
 * secret is wrong; `shape` means Clerk sent something we cannot read, i.e. their payload contract changed and
 * user records are silently going out of sync. An alert can threshold the two differently without either one
 * getting its own code path to invert.
 */
export type WebhookRejectionReason = 'signature' | 'shape';

/**
 * The zod issue PATHS from a failed parse — e.g. `['data', 'email_addresses']`.
 *
 * Paths and codes only, never values: the payload carries the user's email address and legal name, so the
 * body must not reach a log line (and this Lambda's logs are forwarded off-account to Sentry, which makes
 * that a data-protection question rather than a stylistic one).
 *
 * @param error - The zod error from a failed parse.
 * @returns One `path: code` string per issue, safe to log. Pure.
 */
export const describeIssues = (error: z.ZodError): string[] =>
    error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`);
