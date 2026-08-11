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
 * These shapes were previously `class-validator` classes in `dto/admin.dto.ts`. Two of them —
 * `AdminUserIdParamDto` and `AdminAuditLogDto` — had NO callers at all: the controller reads `@Param('userId')`
 * as a bare string, so the "validated" param DTO validated nothing. They are deleted rather than translated;
 * publishing a shape no route uses would be a contract that lies about the API's surface.
 *
 * WHY THE STATUS FIELDS ARE LITERALS. `suspendUser` always answers `status: 'suspended'` and the two recovery
 * routes always answer `status: 'active'`. Modelling them as the full `userStatusSchema` would widen the contract
 * to values those routes cannot return, and a client would have to write a branch that can never run.
 */
import { z } from 'zod';

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

/**
 * Query for `GET /api/v1/admin/users`.
 *
 * `limit`/`offset` are strings because they arrive as query parameters; the controller parses them and applies
 * its own defaults (50 / 0). Those defaults are NOT restated here — a default in two places is a default that can
 * disagree.
 */
export const adminListUsersQuerySchema = z.object({
    /** Substring match on email. */
    email: z.string().optional(),
    /** Substring match on the provider-synced name. */
    name: z.string().optional(),
    /** Exact match on the app-user ULID. */
    sub: z.string().optional(),
    /** Page size, as a decimal string. Defaults server-side. */
    limit: z.string().optional(),
    /** Page offset, as a decimal string. Defaults server-side. */
    offset: z.string().optional(),
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
