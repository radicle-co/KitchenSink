/**
 * THE `/api/v1/admin/users` WIRE CONTRACT — authored here and copied into `@kitchensink/schema-identity`
 * (`docs/CODING_STANDARDS.md` §15.2).
 *
 * Every route under this prefix requires the `admin:users` scope, enforced by a CONTROLLER-level `ScopesGuard`
 * (`@UseGuards(ScopesGuard) @RequireScopes('admin:users')`) rather than an app-wide guard, which keeps its blast
 * radius to this controller. The scope comes from the signature-verified session token's `public_metadata` — there
 * is deliberately no trusted-header path, because the service is fronted by a public ALB and a client-suppliable
 * header would be forgeable (PR #39).
 *
 * These shapes were previously `class-validator` classes in `dto/admin.dto.ts`. `AdminAuditLogDto` had NO
 * callers at all and was deleted rather than translated; publishing a shape no route uses would be a contract
 * that lies about the API's surface.
 *
 * ⚠️ `AdminUserIdParamDto` WAS DELETED FOR THAT SAME REASON AND IS NOW BACK — because the reason it was unused
 * was the DEFECT, not the justification. The controller read `@Param('userId')` as a bare string, so the five
 * action routes handed an arbitrary caller-supplied string straight into `eq(users.id, …)`. Drizzle
 * parameterises, so it was never injectable, but nothing checked the FORMAT of a path parameter on an
 * admin-privileged route, and the published document described it as a bare `z.string()`. It is re-authored
 * here as {@link adminUserIdParamSchema}, bound through `dto/adminUserId.param.dto.ts`, and asserted to be
 * REACHED by `tests/adminParamValidation.test.ts` (§15.4(1): path params go through the pipe).
 *
 * WHY THE STATUS FIELDS ARE LITERALS. `suspendUser` always answers `status: 'suspended'` and the two recovery
 * routes always answer `status: 'active'`. Modelling them as the full `userStatusSchema` would widen the contract
 * to values those routes cannot return, and a client would have to write a branch that can never run.
 */
import { z } from 'zod';

/**
 * The `{userId}` path parameter shared by the five admin action routes
 * (`suspend` / `unsuspend` / `reactivate` / `impersonation/start` / `impersonation/stop`).
 *
 * `z.ulid()` rather than `z.string()`: `users.id` is only ever written by `newUserId()` (`ulidx.ulid()`), so a
 * value that is not a ULID cannot name a row — it is a malformed request, and the honest answer is a `400` at
 * the boundary instead of a database round-trip and a `404`. Crockford base32 excludes `I`, `L`, `O` and `U`,
 * which is why several older test fixtures in this repo were not the ULIDs they looked like.
 *
 * Two deliberate loosenesses, so nobody "tightens" them by accident:
 *
 * - **Case-insensitive.** `z.ulid()` accepts a lowercase form. It is a well-formed ULID that simply matches no
 *   row (`users.id` is `VARCHAR COLLATE "C"` and every stored id is upper-case), so it answers `404`. Do NOT
 *   normalise with `.toUpperCase()`: that would make two distinct parameter values address one user.
 * - **`z.object`, not `z.strictObject`.** Nest hands `@Param()` exactly the route's own parameters, so there is
 *   no client-supplied surface for a strict object to reject, and a route that later adds a second path
 *   parameter must not start failing on it.
 */
export const adminUserIdParamSchema = z.object({
    /** The target user's app ULID (NOT the Clerk `sub`). */
    userId: z.ulid(),
});

/** The `{userId}` path parameter of the admin action routes. */
export type AdminUserIdParam = z.infer<typeof adminUserIdParamSchema>;

/** One row in the admin user list. Deliberately narrow — an admin search result, not a full profile. */
export const adminUserListItemSchema = z.object({
    /** The app user's ULID. Named `sub` for historical reasons; it is NOT the Clerk `sub`. */
    sub: z.string(),
    /** Primary email. */
    email: z.string(),
    /** Name as synced from the identity provider, or `null`. */
    name: z.string().nullable(),
    /** Avatar URL as synced from the identity provider, or `null`. */
    picture: z.string().nullable(),
    /** Lifecycle status, as stored. */
    status: z.string(),
});

/** One row in the admin user list. */
export type AdminUserListItem = z.infer<typeof adminUserListItemSchema>;

/** The largest page an admin list request may ask for — a bound on the work one request can cause. */
export const MAX_ADMIN_LIST_LIMIT = 200;

/** The longest filter string accepted. `users.email` is `varchar(320)`; `name` is `text`, so this is the app's. */
const MAX_FILTER_LENGTH = 320;

/**
 * Query for `GET /api/v1/admin/users`.
 *
 * ⚠️ THIS SCHEMA WAS WRITTEN AND THEN NEVER WIRED UP. The controller read five bare `@Query()` strings instead,
 * and the global `ZodValidationPipe` passes through any parameter whose metatype is not a Zod DTO — so nothing
 * validated these at all. The consequence reached the database: `limit` was parsed with
 * `Number.parseInt(limit, 10)`, which answers `NaN` for `?limit=abc`, and the service's `filters.limit ?? 50`
 * does NOT catch `NaN` (`??` only tests null/undefined). So `query.limit(NaN).offset(NaN)` went to drizzle, and
 * `NaN` was echoed back in the response. That is exactly the "no data reaches a database unvalidated" case.
 *
 * `limit`/`offset` are therefore COERCED and BOUNDED here rather than left as strings for the controller to
 * parse. `z.coerce.number().int()` rejects `abc` and `2.5` instead of truncating, and the published contract now
 * describes them as the integers they are. Defaults are still NOT restated here — the service owns `50`/`0`, so
 * both fields stay `.optional()` and a default cannot disagree with itself across two files.
 */
export const adminListUsersQuerySchema = z.object({
    /** Substring match on email. Bounded — it becomes a `LIKE` pattern. */
    email: z.string().max(MAX_FILTER_LENGTH).optional(),
    /** Substring match on the provider-synced name. Bounded for the same reason. */
    name: z.string().max(MAX_FILTER_LENGTH).optional(),
    /** Exact match on the app-user ULID. */
    sub: z.string().max(MAX_FILTER_LENGTH).optional(),
    /** Page size. A positive integer, capped at {@link MAX_ADMIN_LIST_LIMIT}. Defaults server-side. */
    limit: z.coerce.number().int().min(1).max(MAX_ADMIN_LIST_LIMIT).optional(),
    /** Page offset. A non-negative integer. Defaults server-side. */
    offset: z.coerce.number().int().min(0).optional(),
});

/** Query for `GET /api/v1/admin/users`. */
export type AdminListUsersQuery = z.infer<typeof adminListUsersQuerySchema>;

/**
 * Body for `GET /api/v1/admin/users`.
 *
 * Echoes the EFFECTIVE `limit`/`offset` — the parsed values including the server-applied defaults — so a caller
 * paginating does not have to reimplement the defaulting rule to know where it is.
 */
export const adminListUsersResponseSchema = z.object({
    /** The matching rows. */
    users: z.array(adminUserListItemSchema),
    /** The effective page size actually applied. */
    limit: z.number(),
    /** The effective offset actually applied. */
    offset: z.number(),
});

/** Body for `GET /api/v1/admin/users`. */
export type AdminListUsersResponse = z.infer<typeof adminListUsersResponseSchema>;

/** Body for `POST /api/v1/admin/users/{userId}/suspend`. */
export const adminSuspendUserResponseSchema = z.object({
    /** The suspended user's app ULID. */
    sub: z.string(),
    /** Always `suspended` — the only status this route produces. */
    status: z.literal('suspended'),
    /** ISO-8601 timestamp of the suspension. */
    suspendedAt: z.string(),
});

/** Body for `POST /api/v1/admin/users/{userId}/suspend`. */
export type AdminSuspendUserResponse = z.infer<typeof adminSuspendUserResponseSchema>;

/** Body for `POST /api/v1/admin/users/{userId}/unsuspend`. */
export const adminUnsuspendUserResponseSchema = z.object({
    /** The restored user's app ULID. */
    sub: z.string(),
    /** Always `active`. */
    status: z.literal('active'),
    /** ISO-8601 timestamp of the restoration. */
    unsuspendedAt: z.string(),
});

/** Body for `POST /api/v1/admin/users/{userId}/unsuspend`. */
export type AdminUnsuspendUserResponse = z.infer<typeof adminUnsuspendUserResponseSchema>;

/**
 * Body for `POST /api/v1/admin/users/{userId}/reactivate`.
 *
 * Admin-mediated recovery of a CLOSED (tombstoned) account (CR-002 U2). Self-service recovery is not buildable —
 * `@clerk/backend` has no server-side sign-in-attempt verification and a banned user cannot sign in to be
 * verified — so a support agent verifies the owner out-of-band and calls this.
 */
export const adminReactivateUserResponseSchema = z.object({
    /** The reactivated user's app ULID. */
    sub: z.string(),
    /** Always `active`. */
    status: z.literal('active'),
    /** ISO-8601 timestamp of the reactivation. */
    reactivatedAt: z.string(),
});

/** Body for `POST /api/v1/admin/users/{userId}/reactivate`. */
export type AdminReactivateUserResponse = z.infer<typeof adminReactivateUserResponseSchema>;

/** Body for `POST /api/v1/admin/users/{userId}/impersonation/start`. */
export const impersonationStartResponseSchema = z.object({
    /** The acting admin's app ULID. */
    impersonatorSub: z.string(),
    /** The impersonated user's app ULID. */
    impersonatedSub: z.string(),
    /** The impersonation session's id, for correlating the audit trail. */
    sessionId: z.string(),
    /** ISO-8601 timestamp the session began. */
    startedAt: z.string(),
});

/** Body for `POST /api/v1/admin/users/{userId}/impersonation/start`. */
export type ImpersonationStartResponse = z.infer<typeof impersonationStartResponseSchema>;

/** Body for `POST /api/v1/admin/users/{userId}/impersonation/stop`. */
export const impersonationStopResponseSchema = z.object({
    /** The acting admin's app ULID. */
    impersonatorSub: z.string(),
    /** The impersonated user's app ULID. */
    impersonatedSub: z.string(),
    /** ISO-8601 timestamp the session ended. */
    stoppedAt: z.string(),
    /** Human-readable acknowledgement. */
    message: z.string(),
});

/** Body for `POST /api/v1/admin/users/{userId}/impersonation/stop`. */
export type ImpersonationStopResponse = z.infer<typeof impersonationStopResponseSchema>;
