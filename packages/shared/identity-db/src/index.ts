/**
 * `@kitchensink/identity-db` — the identity domain's persistence layer, standalone from the
 * deployable NestJS service (S-I7). Mirrors `@kitchensink/recipe-core`'s shape: a plain,
 * framework-free shared package (no Nest DI, no HTTP) that both the identity-service (NestJS,
 * ECS/Fargate) and identity-webhooks (raw Lambda handlers) depend on directly, instead of the
 * Lambdas reaching into the deployable service's `database/*` subpaths. This is the
 * Repository pattern's data-mapping half: Drizzle `pgTable` schema (the mapping) plus DAO
 * classes/functions (the repository surface) — no query-building leaks into either consumer.
 *
 * Deliberately excluded (stay in `packages/services/identity`, Nest-coupled): `DrizzleProvider`/
 * `DatabaseModule` (the NestJS connection-pool provider) and the numbered SQL migrations — neither
 * is schema/DAO code a Lambda needs, and moving them would pull Nest into the Lambda bundle.
 */
export { accounts } from './schema/accounts.js';
export { lifecycleEvents } from './schema/lifecycleEvents.js';
export { profiles } from './schema/profiles.js';
export { userStatusEnum, users } from './schema/users.js';
export { webhookEvents } from './schema/webhookEvents.js';
export type { AccountRow, NewAccountRow } from './schema/accounts.js';
export type { NewProfileRow, ProfileRow } from './schema/profiles.js';
export type { NewUserRow, UserRow } from './schema/users.js';
export type { NewWebhookEventRow, WebhookEventRow } from './schema/webhookEvents.js';
export type {
    LifecycleEventRow,
    LifecycleEventType,
    LifecycleTriggerSource,
    NewLifecycleEventRow,
} from './schema/lifecycleEvents.js';

export { AccountDAO } from './dao/account.dao.js';
export { UserDAO } from './dao/user.dao.js';
export { hasProcessedWebhookEvent, recordOnce } from './dao/webhookEvents.dao.js';

export { eraseIdentityRow, type EraseIdentityInput } from './eraseIdentityRow.js';

export { newUserId, isUserId } from './ulid.js';
export type { UserId } from './ulid.js';

/** The database surface the DAOs accept — see the module docstring for why it is a structural Pick. */
export type { IdentityWriter } from './identityWriter.js';
