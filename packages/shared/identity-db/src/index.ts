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
export { userStatusEnum, users, accounts, profiles, webhookEvents, lifecycleEvents } from './schema/index.js';
export type { NewUserRow, UserRow, AccountRow, NewAccountRow, NewProfileRow, ProfileRow } from './schema/index.js';
export type { NewWebhookEventRow, WebhookEventRow } from './schema/index.js';
export type {
    NewLifecycleEventRow,
    LifecycleEventRow,
    LifecycleEventType,
    LifecycleTriggerSource,
} from './schema/index.js';

export { UserDAO, AccountDAO, hasProcessedWebhookEvent, recordOnce } from './dao/index.js';

export { eraseIdentityRow, type EraseIdentityInput } from './eraseIdentityRow.js';

export { newUserId, isUserId } from './ulid.js';
export type { UserId } from './ulid.js';
