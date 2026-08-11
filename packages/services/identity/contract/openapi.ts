/**
 * THE IDENTITY API's OpenAPI DOCUMENT — declared from the authored zod, for external consumption.
 *
 * This is the ONE place identity's routes, status codes and security requirements are described for integrators,
 * and it composes the SAME zod the service validates with and the clients import — so a shape cannot appear in the
 * document that the service does not actually serve.
 *
 * WHAT IT IS NOT: a code-generation input, and not the type authority (§15.2.1). Nothing in this repo compiles
 * against `openapi.yaml`; the authority is the zod exported from `@kitchensink/schema-identity`.
 *
 * WHY IT IS HAND-DECLARED RATHER THAN SCRAPED. `@nestjs/swagger` emits no response schema for a handler returning
 * an `interface` (§15.2.5) — and identity's handlers mostly have no declared return type at all (`async
 * getUserMe(ctx)` returns an inferred object literal), so a scraped document would be blind to every response body
 * on the service. Declaring them buys a document whose responses are real, `$ref`'d component schemas.
 *
 * ADDING AN ENDPOINT: add its schemas to a `*.schema.ts`, register the component here, and declare the path.
 * `components` is typed, so referencing a component that does not exist is a `typecheck` failure, and the generator
 * prints every response left without a body schema on each run.
 */
import { buildOpenApiDocument } from '@kitchensink/contract-gen';
import type { OpenApiBuildResult } from '@kitchensink/contract-gen';
import { z } from 'zod';

import { apiErrorSchema } from '../src/common/api-error.schema.js';
import {
    deleteUserMeResponseSchema,
    patchUserMeRequestSchema,
    userProfileAccountSchema,
    userProfileSchema,
    userProfileUserSchema,
} from '../src/users/users.schema.js';
import { avatarPresignResponseSchema } from '../src/users/avatar.schema.js';
import {
    adminListUsersResponseSchema,
    adminReactivateUserResponseSchema,
    adminSuspendUserResponseSchema,
    adminUnsuspendUserResponseSchema,
    adminUserListItemSchema,
    impersonationStartResponseSchema,
    impersonationStopResponseSchema,
} from '../src/admin/admin.schema.js';
import { healthStatusSchema } from '../src/health/health.schema.js';

/** The named component schemas, keyed by the name the document publishes them under. */
const components = {
    ApiError: apiErrorSchema,
    UserProfileUser: userProfileUserSchema,
    UserProfileAccount: userProfileAccountSchema,
    UserProfile: userProfileSchema,
    PatchUserMeRequest: patchUserMeRequestSchema,
    DeleteUserMeResponse: deleteUserMeResponseSchema,
    AvatarPresignResponse: avatarPresignResponseSchema,
    AdminUserListItem: adminUserListItemSchema,
    AdminListUsersResponse: adminListUsersResponseSchema,
    AdminSuspendUserResponse: adminSuspendUserResponseSchema,
    AdminUnsuspendUserResponse: adminUnsuspendUserResponseSchema,
    AdminReactivateUserResponse: adminReactivateUserResponseSchema,
    ImpersonationStartResponse: impersonationStartResponseSchema,
    ImpersonationStopResponse: impersonationStopResponseSchema,
    HealthStatus: healthStatusSchema,
} as const;

/** `401` — the auth middleware found no valid Clerk session token. */
const unauthorized = { description: 'No valid Clerk session token.', schema: 'ApiError' } as const;

/** `403` — authenticated but lacking the `admin:users` scope. */
const forbidden = {
    description: 'Authenticated but lacking the `admin:users` scope (enforced by `ScopesGuard`).',
    schema: 'ApiError',
} as const;

/** `404` — no such user. */
const userNotFound = { description: 'No such user.', schema: 'ApiError' } as const;

/** The `userId` path parameter every admin route takes. */
const userIdParameter = {
    name: 'userId',
    in: 'path',
    description: "The target user's app ULID (NOT the Clerk `sub`).",
    schema: z.string(),
} as const;

/** The five admin routes that act on one user and answer a single shape. */
const adminAction = (
    operationId: string,
    summary: string,
    description: string,
    schema: keyof typeof components & string,
) =>
    ({
        operationId,
        summary,
        description,
        parameters: [userIdParameter],
        responses: {
            '200': { description: 'Done.', schema },
            '401': unauthorized,
            '403': forbidden,
            '404': userNotFound,
        },
    }) as const;

/** The derived document plus its response-schema coverage report. */
export const identityOpenApiDocument: OpenApiBuildResult = buildOpenApiDocument({
    title: 'Commise Identity API',
    version: '1.0.0',
    description:
        "The viewer's own profile and the admin user-management surface. Authentication is a Clerk SESSION " +
        'token verified IN THIS SERVICE by `AuthMiddleware` → `ClerkAuthService` (networkless, via the public ' +
        '`CLERK_JWT_KEY`, with `azp` enforced against an anchored pattern). There is deliberately NO ' +
        'trusted-header path: the service is fronted by a public ALB, so a client-suppliable ' +
        '`x-authorizer-context` would be forgeable (PR #39). On a first request the middleware ' +
        'read-through-CREATES the user, account and profile from the token claims, so a freshly signed-up ' +
        "viewer never sees a 404. Admin scopes come from the signed token's `public_metadata`. Every path is " +
        'also served under the DEPRECATED `/v1/*` alias held by consumers configured outside this repo — the ' +
        'Clerk dashboard webhook URL and already-shipped mobile builds (ADR-0011); only the canonical ' +
        '`/api/v1/*` form is documented. Error bodies are ALWAYS the shared `{ code, message, details? }` ' +
        'envelope: the `@Catch()`-all filter rewrites every failure into it (ARCH-PS-2).',
    servers: [
        { url: 'https://identity.commise.app', description: 'production' },
        {
            url: 'https://identity.sandbox.commise.app',
            description: 'sandbox — the SINGLE shared identity service every PR preview signs in against (ADR-0001)',
        },
    ],
    securitySchemes: {
        clerkSession: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description:
                'A Clerk session token, verified in-process. Admin routes additionally require the ' +
                "`admin:users` scope from the token's `public_metadata`.",
        },
    },
    defaultSecurity: ['clerkSession'],
    components,
    paths: {
        '/api/v1/users/me': {
            get: {
                operationId: 'getUserMe',
                summary: "Read the signed-in viewer's profile",
                description:
                    'Read-through: on a first request the auth middleware has already created the user, account ' +
                    'and profile rows from the verified token claims, so this does not 404 for a new signup.',
                responses: {
                    '200': { description: "The viewer's profile.", schema: 'UserProfile' },
                    '401': unauthorized,
                    '404': userNotFound,
                },
            },
            patch: {
                operationId: 'patchUserMe',
                summary: "Update the signed-in viewer's profile",
                description:
                    'Partial update of `displayName` and/or `avatarUrl`. An UNKNOWN FIELD IS A `400` — the body ' +
                    'schema is strict. A `displayName` change also publishes a handle-sync event so the recipe ' +
                    'service corrects its denormalized author handles; a failed publish does not fail the rename ' +
                    '(reconciliation backstops it). An empty object `{}` is an accepted no-op, but a request ' +
                    'with NO BODY AT ALL is a `400` — a write that carries nothing is malformed, not a success.',
                requestBody: { description: 'The fields to change.', schema: 'PatchUserMeRequest' },
                responses: {
                    '200': { description: 'The updated profile.', schema: 'UserProfile' },
                    '400': {
                        description:
                            'Validation failure — over-long `displayName`, non-URL `avatarUrl`, an unknown ' +
                            'field, or an absent body. `details.fields` carries the individual messages, each ' +
                            'prefixed with the field it names; `message` is those same messages joined.',
                        schema: 'ApiError',
                    },
                    '401': unauthorized,
                    '404': userNotFound,
                },
            },
            delete: {
                operationId: 'deleteUserMe',
                summary: 'Close the signed-in viewer’s account',
                description:
                    '`202`, not `204`: closure is asynchronous. It tombstones the user, scrubs the avatar, writes ' +
                    'an append-only audit row in the SAME transaction as the state change, and hands the durable, ' +
                    'reversible Clerk ban to the deletion-worker (the only holder of the Clerk secret). ' +
                    'RECOVERABLE by an admin via the reactivate route — this is closure, not GDPR erasure.',
                responses: {
                    '202': { description: 'Closure initiated.', schema: 'DeleteUserMeResponse' },
                    '401': unauthorized,
                    '404': userNotFound,
                },
            },
        },
        '/api/v1/users/me/avatar/presign': {
            post: {
                operationId: 'presignAvatarUpload',
                summary: 'Get a presigned S3 PUT URL for an avatar',
                description:
                    'Image bytes NEVER traverse this service. `type` and `size` are baked into the signature as ' +
                    '`ContentType`/`ContentLength`, so S3 itself rejects an upload that does not match what was ' +
                    'presigned. The URL expires in 5 minutes. The admitted MIME types and the size cap are ' +
                    'enforced by the service and reported in the `400`, deliberately NOT restated in this ' +
                    'document — a copy of a security rule that can disagree with the enforcer is worse than none.',
                parameters: [
                    {
                        name: 'type',
                        in: 'query',
                        required: true,
                        description: "The image's MIME type. Must be one of the admitted image types.",
                        schema: z.string(),
                    },
                    {
                        name: 'size',
                        in: 'query',
                        required: true,
                        description: "The image's exact byte length, as a decimal string.",
                        schema: z.string(),
                    },
                ],
                responses: {
                    '200': {
                        description: 'The presigned PUT URL and the resulting public URL.',
                        schema: 'AvatarPresignResponse',
                    },
                    '400': {
                        description: 'Unadmitted `type`, or a `size` outside the permitted range.',
                        schema: 'ApiError',
                    },
                    '401': unauthorized,
                },
            },
        },
        '/api/v1/admin/users': {
            get: {
                operationId: 'adminListUsers',
                summary: 'Search users (admin)',
                description:
                    'Substring match on email/name, exact match on `sub`. Echoes the EFFECTIVE `limit`/`offset` ' +
                    'including the server-applied defaults, so a caller paginating need not reimplement them.',
                parameters: [
                    { name: 'email', in: 'query', description: 'Substring match on email.', schema: z.string() },
                    {
                        name: 'name',
                        in: 'query',
                        description: 'Substring match on the synced name.',
                        schema: z.string(),
                    },
                    { name: 'sub', in: 'query', description: 'Exact match on the app-user ULID.', schema: z.string() },
                    { name: 'limit', in: 'query', description: 'Page size, decimal string.', schema: z.string() },
                    { name: 'offset', in: 'query', description: 'Page offset, decimal string.', schema: z.string() },
                ],
                responses: {
                    '200': { description: 'The matching users.', schema: 'AdminListUsersResponse' },
                    '401': unauthorized,
                    '403': forbidden,
                },
            },
        },
        '/api/v1/admin/users/{userId}/suspend': {
            post: adminAction(
                'adminSuspendUser',
                'Suspend a user (admin)',
                'Blocks the account. Recoverable via the unsuspend route.',
                'AdminSuspendUserResponse',
            ),
        },
        '/api/v1/admin/users/{userId}/unsuspend': {
            post: adminAction(
                'adminUnsuspendUser',
                'Lift a suspension (admin)',
                'Returns a suspended account to `active`.',
                'AdminUnsuspendUserResponse',
            ),
        },
        '/api/v1/admin/users/{userId}/reactivate': {
            post: adminAction(
                'adminReactivateUser',
                'Recover a CLOSED account (admin)',
                'Admin-mediated recovery of a tombstoned account (CR-002 U2). Self-service recovery is not ' +
                    'buildable — `@clerk/backend` has no server-side sign-in-attempt verification and a banned ' +
                    'user cannot sign in to be verified — so a support agent verifies the owner out-of-band and ' +
                    'calls this. Clears the tombstone and writes the audit row in ONE transaction.',
                'AdminReactivateUserResponse',
            ),
        },
        '/api/v1/admin/users/{userId}/impersonation/start': {
            post: adminAction(
                'adminStartImpersonation',
                'Begin an impersonation session (admin)',
                'Audited. The returned `sessionId` correlates the audit trail; the impersonated session is ' +
                    'itself BLOCKED from privileged surfaces on the client.',
                'ImpersonationStartResponse',
            ),
        },
        '/api/v1/admin/users/{userId}/impersonation/stop': {
            post: adminAction(
                'adminStopImpersonation',
                'End an impersonation session (admin)',
                'Audited counterpart to the start route.',
                'ImpersonationStopResponse',
            ),
        },
        '/health': {
            get: {
                operationId: 'getHealth',
                summary: 'Liveness probe',
                description:
                    'Static. Deliberately does NOT touch the database — a transient RDS blip must not make ECS ' +
                    'kill an otherwise-healthy container.',
                security: [],
                responses: { '200': { description: 'The process is up.', schema: 'HealthStatus' } },
            },
        },
        '/health/ready': {
            get: {
                operationId: 'getReadiness',
                summary: 'Readiness probe',
                description:
                    'Probes the database so the ALB can drain an instance whose database is unreachable ' +
                    '(ARCH-PS-3). The cause is deliberately swallowed: it can embed connection strings.',
                security: [],
                responses: {
                    '200': { description: 'Ready to serve traffic.', schema: 'HealthStatus' },
                    '503': { description: 'Database not reachable (`NOT_READY`).', schema: 'ApiError' },
                },
            },
        },
    },
});
