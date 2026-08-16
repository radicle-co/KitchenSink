/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the identity service, which AUTHORS the wire contract. Edit the
 * source and regenerate: `npm run contract:generate --workspace=@kitchensink/identity-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/identity/src/users/users.schema.ts

/**
 * THE `/api/v1/users/me` WIRE CONTRACT — authored here, in the service, and copied verbatim into
 * `@kitchensink/schema-identity` (`docs/CODING_STANDARDS.md` §15.2).
 *
 * WHAT THIS FILE REPLACES, and why it matters more here than anywhere else in the repo. The viewer's profile
 * contract used to be expressed as `class-validator` DTO classes in `dto/user.dto.ts` plus domain interfaces in
 * `types/user.ts`/`types/account.ts`/`types/profile.ts`, and web, mobile AND the shared
 * `@commise/features-account` package all reached for them by declaring a RUNTIME dependency on
 * `@kitchensink/identity-service` — the whole NestJS service package, with drizzle, `pg`, the AWS SDK and
 * `@sentry/nestjs` in its graph. The types erase at compile time, so nothing broke; the dependency EDGE from the
 * mobile bundle to a server package is what was wrong, and it is exactly the inversion §15.2's leaf package
 * exists to remove.
 *
 * ⚠️ CORRECTION (this text, and commit `9507e4ed`, previously described that removal as COMPLETE while it was
 * only half done). When the seam was introduced, only `@commise/features-account` was repointed. Both apps kept
 * declaring `@kitchensink/identity-service` and kept importing types from it in nine source files — mobile even
 * pulling the deliberately-unpublished, branded `UserReadDto`. All three consumers now import the published leaf,
 * and the boundary is no longer a claim in a comment: `packages/infra/global/__tests__/appServiceDependency.test.ts`
 * fails the build if any `packages/apps/**` manifest or source names ANY `packages/services/*` package, type-only
 * imports included. That gate exists because nothing else could see this: the ratchet
 * (`scripts/boundariesRatchet.mjs`) reports UNDECLARED dependencies, and these were declared.
 *
 * IDS ARE PLAIN STRINGS ON THE WIRE, and that is a decision rather than an omission. The service brands them
 * internally (`UserId = string & { __brand: 'UserId' }`, minted and checked by `@kitchensink/identity-db`), and
 * the brand is a SERVER-SIDE invariant: it exists so service code cannot pass an account id where a user id
 * belongs. A client receives an opaque identifier it echoes back; publishing the brand into a leaf package would
 * force every consumer to cast at the boundary — ceremony that asserts an invariant the client cannot actually
 * establish. `UserId` remains assignable to `string`, so the service's own handlers still satisfy these shapes.
 * Measured, not asserted: the ONE app-side `as UserId` cast (in web's `AccountEditForm` test) DISAPPEARED when
 * that file moved onto the published `UserProfile` — the brand's reach into a client was pure ceremony, exactly
 * as claimed here.
 *
 * IMPORT RESTRICTION (enforced by `@kitchensink/contract-gen`): this file may import ONLY `zod` and flat sibling
 * `*.schema.js` modules — no `types/`, no drizzle schema, no Nest symbol.
 *
 * Dates are ISO-8601 strings, never `Date` (CODING_STANDARDS).
 */
import { z } from 'zod';

/**
 * Account lifecycle status.
 *
 * `active` normal · `suspended` admin-blocked, recoverable · `tombstoned` self-service closure, recoverable by
 * an admin (CR-002 U2) · `erased` GDPR erasure, terminal. Pinned to the database enum by
 * `src/users/__tests__/users.schema.test.ts`.
 */
export const userStatusSchema = z.enum(['active', 'suspended', 'tombstoned', 'erased']);

/** Account lifecycle status. */
export type UserStatus = z.infer<typeof userStatusSchema>;

/** Subscription tier. */
export const accountTierSchema = z.enum(['free', 'premium']);

/** Subscription tier. */
export type AccountTier = z.infer<typeof accountTierSchema>;

/** The `user` half of the viewer's profile — identity plus the display fields from their profile row. */
export const userProfileUserSchema = z.object({
    /** The app user's ULID. Opaque to a client. */
    id: z.string(),
    /** Primary email, as synced from Clerk. */
    email: z.string(),
    /** Display name, or the empty string when the profile row has none yet. */
    displayName: z.string(),
    /** Avatar URL, or `null` when unset or scrubbed by a closure/erasure. */
    avatarUrl: z.string().nullable(),
    /** Lifecycle status. A `suspended`/`tombstoned` viewer is shown a block, not the app. */
    status: userStatusSchema,
    /** ISO-8601 creation timestamp. */
    createdAt: z.string(),
    /** ISO-8601 last-update timestamp. */
    updatedAt: z.string(),
});

/** The `user` half of the viewer's profile. */
export type UserProfileUser = z.infer<typeof userProfileUserSchema>;

/** The `account` half of the viewer's profile — the billing/entitlement record. */
export const userProfileAccountSchema = z.object({
    /** The account's ULID. */
    id: z.string(),
    /** The owning user's ULID. */
    userId: z.string(),
    /** Subscription tier. */
    subscriptionTier: accountTierSchema,
    /** ISO-8601 creation timestamp. */
    createdAt: z.string(),
    /** ISO-8601 last-update timestamp. */
    updatedAt: z.string(),
});

/** The `account` half of the viewer's profile. */
export type UserProfileAccount = z.infer<typeof userProfileAccountSchema>;

/** Body for `GET /api/v1/users/me` and `PATCH /api/v1/users/me` — the signed-in viewer's profile. */
export const userProfileSchema = z.object({
    /** Identity + display fields. */
    user: userProfileUserSchema,
    /** Billing/entitlement record. */
    account: userProfileAccountSchema,
});

/** The signed-in viewer's profile (`user` + `account`). */
export type UserProfile = z.infer<typeof userProfileSchema>;

/**
 * Request body for `PATCH /api/v1/users/me`.
 *
 * STRICT (`z.strictObject`) on purpose, and the strictness is load-bearing rather than stylistic. The global pipe
 * this replaces ran with `whitelist: true, forbidNonWhitelisted: true`, so an unknown field was a `400` — the
 * property `tests/appValidation.test.ts` and `tests/e2e/usersValidation.e2e.test.ts` both pin. zod v4's
 * `z.object()` STRIPS unknown keys silently instead of rejecting them, so using it here would have quietly
 * downgraded a rejecting boundary to a permissive one on a route that writes user data.
 *
 * `avatarUrl` accepts `null` (clearing the avatar) as well as an absolute URL. Validation is now `z.url()`, which
 * requires a scheme; class-validator's `@IsUrl()` accepted a bare `example.com/x.png`. That is a deliberate
 * TIGHTENING: the value is rendered as an image source and every real avatar URL comes back from this service's
 * own presign route as an `https://` S3 URL.
 */
export const patchUserMeRequestSchema = z.strictObject({
    /** New display name, ≤100 characters. */
    displayName: z.string().max(100).optional(),
    /** New avatar URL (absolute, with a scheme), or `null` to clear it. */
    avatarUrl: z.union([z.url(), z.null()]).optional(),
});

/** Request body for `PATCH /api/v1/users/me`. */
export type UserUpdateInput = z.infer<typeof patchUserMeRequestSchema>;

/**
 * Body for `DELETE /api/v1/users/me` (`202 Accepted`).
 *
 * `202`, not `204`: closure is asynchronous. The durable, reversible Clerk ban is handed to the deletion-worker
 * (the only holder of the Clerk secret), so the response acknowledges the request rather than its completion —
 * which is why it HAS a body at all.
 */
export const deleteUserMeResponseSchema = z.object({
    /** The closed account's app-user ULID. Named `sub` for historical reasons; it is NOT the Clerk `sub`. */
    sub: z.string(),
    /** ISO-8601 timestamp of the tombstone. */
    deletedAt: z.string(),
    /** Human-readable acknowledgement. */
    message: z.string(),
});

/** Body for `DELETE /api/v1/users/me`. */
export type DeleteUserMeResponse = z.infer<typeof deleteUserMeResponseSchema>;

/**
 * Response body for `POST /api/v1/users/me/erasure` (`202 Accepted`) — plan U2.
 *
 * Deliberately its OWN shape rather than a reuse of {@link deleteUserMeResponseSchema}: the two actions
 * differ in the one way a client must not confuse, and the field name is where that shows. A closure
 * reports `deletedAt` (recoverable); an erasure reports `erasedAt` (irreversible). Sharing the schema
 * would let a UI render "closed" copy for an erasure by simply not noticing.
 */
export const eraseUserMeResponseSchema = z.object({
    /** The erased account's app-user ULID. Named `sub` to match the closure response's field. */
    sub: z.string(),
    /** ISO-8601 timestamp at which the identity row was scrubbed. */
    erasedAt: z.string(),
    /** Human-readable acknowledgement. */
    message: z.string(),
});

/** Body for `POST /api/v1/users/me/erasure`. */
export type EraseUserMeResponse = z.infer<typeof eraseUserMeResponseSchema>;
