# Data Model: User Authentication

<!-- Implementation note: This data model uses an external identity provider for authentication. See research/ for vendor selection rationale. -->

**Feature**: `002-user-auth`
**Date**: 2026-05-26
**Storage**: RDS PostgreSQL 16 (`db.t4g.small`)
**Source spec**: [spec.md](./spec.md) — Key Entities section

---

## Ownership and access model

- This database is **owned by the Identity Service** (`packages/services/identity/`).
- Drizzle schemas live in `packages/services/identity/src/database/schema/` (owned by Identity Service per Constitution §III).
- Raw Lambda handlers in `packages/services/identity-webhooks/` access the same tables through the Identity Service's schema exports.
- `packages/services/identity/src/types/` is the **types-only** boundary — TypeScript interfaces and DTOs with no database dependencies. Consumers import via `@kitchensink/identity-service/types`.
- Authoritative write paths:
    - Identity Service: profile/account/admin lifecycle writes
    - `user.created` webhook Lambda: user/account/profile bootstrap writes
    - Reconciliation Lambda: repair writes for orphaned IdP users

---

## Entities

### User

Represents a registered Commise user. Canonical identity across all Commise systems.

| Column                  | Type          | Constraints                 | Description                                                                                                           |
| ----------------------- | ------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `id`                    | `TEXT`        | `PRIMARY KEY`               | App-generated ULID (e.g., `01ARZ3NDEKTSV4RRFFQ69G5FAV`). Canonical user identifier across all systems. Never changes. |
| `identity_id`           | `TEXT`        | `UNIQUE NOT NULL`           | IdP `user.id` (e.g., `user_abc123`). Secondary key. Used only for IdP Backend API calls.                              |
| `email`                 | `CITEXT`      | `UNIQUE NOT NULL`           | Synced from IdP during registration via `user.created` webhook. Case-insensitive (requires `citext` extension).       |
| `name`                  | `TEXT`        | `NULL`                      | Display name. Nullable — derived from signup data (email local part or social provider `name` claim).                 |
| `picture`               | `TEXT`        | `NULL`                      | Optional avatar URL.                                                                                                  |
| `status`                | `user_status` | `NOT NULL DEFAULT 'active'` | Enum: `'active'` \| `'suspended'`. Suspended users denied by authorizer (FR-041, FR-042).                             |
| `created_at`            | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()`    | Creation timestamp (ISO 8601 in app layer).                                                                           |
| `updated_at`            | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()`    | Last update timestamp (trigger-managed).                                                                              |
| `deleted_at`            | `TIMESTAMPTZ` | `NULL`                      | Soft-delete marker. Set on account deletion before cascade. Null for active users.                                    |
| `external_id_synced_at` | `TIMESTAMPTZ` | `NULL`                      | Timestamp when the IdP external ID was last synced. Used by reconciliation job.                                       |

> **Historical note** _(superseded)_: The original design used `sub VARCHAR(255) COLLATE "C" PRIMARY KEY` storing the `sub` claim directly as the PK. The current design uses an app-generated ULID as `id TEXT PRIMARY KEY`, with the IdP's `user.id` stored as `identity_id TEXT UNIQUE NOT NULL`.

**Indexes**:

- `users_email_unique` ON `users(email)` — unique constraint index
- `users_identity_id_unique` ON `users(identity_id)` — unique constraint index
- `users_email_idx` ON `users(email)` — query index
- `users_identity_id_idx` ON `users(identity_id)` — query index for IdP Backend API lookups

**Cascade semantics**:

- `users.id` is root for user-owned records.
- Delete of User triggers cascade for Account, Profile, and downstream domain tables (recipes, meal plans, grocery lists, nutrition plans, AI provider configs, agent authorizations) per FR-025.

---

### Account

Account-scoped lifecycle + subscription anchor (subscription feature owns tier transitions).

| Column              | Type          | Constraints                                              | Description                                                                                        |
| ------------------- | ------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `id`                | `UUID`        | `PRIMARY KEY`, `DEFAULT gen_random_uuid()`               | Account identifier.                                                                                |
| `user_id`           | `TEXT`        | `UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE` | 1:1 FK to User (`UNIQUE` enforces one account per user).                                           |
| `subscription_tier` | `TEXT`        | `NOT NULL DEFAULT 'free'`                                | Enum: `'free'` \| `'premium'`; managed by subscription feature (Commise FR-040/FR-041 dependency). |
| `created_at`        | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()`                                 | Creation timestamp.                                                                                |
| `updated_at`        | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()`                                 | Last update timestamp.                                                                             |

**Indexes**:

- `accounts_user_id_idx` ON `accounts(user_id)`
- `accounts_user_id_unique` ON `accounts(user_id)` — unique constraint index

**Notes**:

- Account is created atomically with User and Profile at signup bootstrap.
- Cascades with user deletion via FK.

---

### Profile

Profile record linked 1:1 with User for profile-oriented reads/updates in the Identity Service.

| Column         | Type          | Constraints                                              | Description                 |
| -------------- | ------------- | -------------------------------------------------------- | --------------------------- |
| `id`           | `UUID`        | `PRIMARY KEY`, `DEFAULT gen_random_uuid()`               | Profile identifier.         |
| `user_id`      | `TEXT`        | `UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE` | 1:1 FK to User.             |
| `display_name` | `TEXT`        | `NOT NULL`                                               | User-editable display name. |
| `avatar_url`   | `TEXT`        | `NULL`                                                   | Optional avatar URL.        |
| `bio`          | `TEXT`        | `NULL`                                                   | Optional user bio.          |
| `updated_at`   | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()`                                 | Last update timestamp.      |

**Indexes**:

- `profiles_user_id_unique` ON `profiles(user_id)` — unique constraint index

**Notes**:

- Profile is initialized from signup data and updated via profile/account edit APIs.
- No `created_at` column — use `users.created_at` for the user's registration timestamp.

---

### WebhookEvent

Idempotency table for processed IdP webhook deliveries. Prevents duplicate processing of retried Svix deliveries.

| Column        | Type          | Constraints              | Description                                                                                    |
| ------------- | ------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| `svix_id`     | `TEXT`        | `PRIMARY KEY`            | Svix delivery ID. Unique per webhook delivery attempt. Used to deduplicate retried deliveries. |
| `received_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Timestamp when the webhook was received and processed.                                         |

**Notes**:

- Before processing any webhook, the handler checks for an existing `svix_id` row. If found, the delivery is a duplicate and is acknowledged without reprocessing.
- No FK to `users` — the event record is written before the user record exists (during the `user.created` flow).

---

### AuthSession (client-side contract — not a DB table)

Represents secure client session state.

| Field          | Type     | Description                                                                                                              |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `accessToken`  | `string` | JWT bearer token for API calls.                                                                                          |
| `sessionToken` | `string` | Session token used for silent renewal.                                                                                   |
| `expiresAt`    | `string` | ISO 8601 access token expiry timestamp.                                                                                  |
| `userId`       | `string` | App-generated ULID — the canonical Commise user identifier, extracted from the `https://commise.io/userId` custom claim. |

> **Historical note** _(superseded)_: The original design used `sub` (subject claim) as the sole identity field in AuthSession, and `refreshToken` for silent renewal. The current design uses `userId` (ULID) as the identity field and `sessionToken` for renewal.

Storage policy remains platform-specific (FR-006, FR-007, FR-008):

- Web: httpOnly secure cookie via IdP SDK
- Mobile: Keychain/Keystore via `expo-secure-store` + secure storage

---

## SQL reference (Drizzle-aligned)

```sql
-- Requires: CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE user_status AS ENUM ('active', 'suspended');

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  identity_id TEXT UNIQUE NOT NULL,
  email CITEXT UNIQUE NOT NULL,
  name TEXT,
  picture TEXT,
  status user_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  external_id_synced_at TIMESTAMPTZ
);

CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_tier TEXT NOT NULL DEFAULT 'free' CHECK (subscription_tier IN ('free', 'premium')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_events (
  svix_id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX users_email_idx ON users(email);
CREATE INDEX users_identity_id_idx ON users(identity_id);
CREATE INDEX accounts_user_id_idx ON accounts(user_id);
CREATE INDEX profiles_user_id_unique ON profiles(user_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## Entity lifecycle

```text
IdP signup
  |
  +--> IdP fires user.created webhook (Svix delivery)
          |
          +--> webhook_events INSERT (svix_id) — idempotency check
          |
          +--> user.created webhook Lambda
                - Generate ULID → users.id
                - INSERT users (id, identity_id, email, name, picture)
                - INSERT accounts (user_id = users.id)
                - INSERT profiles (user_id = users.id, display_name)

Authenticated API request
  |
  +--> API Gateway REQUEST authorizer Lambda
        - Verify IdP JWT (signature, exp, aud, iss)
        - Extract https://commise.io/userId → userId (ULID)
        - Extract sub → identityUserId
        - Check users.status — deny 403 if suspended
        - Inject context: userId, identityUserId, email, status
  |
  +--> Identity Service (ECS) uses context.userId for DB operations

Account deletion
  |
  +--> Identity Service DELETE user transaction
        - DELETE users WHERE id = ? (cascades accounts/profiles/owned data)
        - Enqueue IdP deletion message (SQS)
  |
  +--> deletion-worker Lambda retries IdP delete (max 5) then DLQ

Nightly reconciliation
  |
  +--> EventBridge Scheduler triggers reconciliation Lambda
        - Fetch IdP users created in reconciliation window
        - Diff against DB users by identity_id
        - Repair missing rows (users/accounts/profiles) with new ULID
```

---

## Mapping to requirements

| Entity / Field                                      | Requirement coverage                                       | Notes                                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `users.id` (ULID PK)                                | REQ-013, REQ-015, FR-013, FR-015                           | App-generated ULID is the canonical identifier; surfaced via `https://commise.io/userId` custom claim |
| `users.identity_id` (secondary key)                 | REQ-013, FR-013                                            | IdP `user.id`; used for IdP Backend API calls and reconciliation                                      |
| Atomic create: `users + accounts + profiles`        | REQ-014, FR-014                                            | Signup bootstrap path via `user.created` webhook                                                      |
| `users.status`                                      | REQ-041, REQ-042, FR-041, FR-042                           | Suspension state enforced in authorizer                                                               |
| Cascading delete from `users`                       | REQ-025, FR-025                                            | Removes owned records on account deletion                                                             |
| Reconciliation repair writes                        | REQ-017, FR-017                                            | Backfills missing records from IdP; keyed by `identity_id`                                            |
| `webhook_events.svix_id`                            | FR-013, FR-016                                             | Idempotency for IdP webhook retries                                                                   |
| Token/user identity contract (`AuthSession.userId`) | REQ-006, REQ-007, REQ-008, REQ-040, FR-006..FR-008, FR-040 | Consumed by web/mobile clients and APIs; ULID extracted from `https://commise.io/userId` custom claim |

---

## Notes and invariants

1. `users.id` (ULID) is the only canonical user identifier across Commise systems. It is app-generated at signup and never changes.
2. `users.identity_id` is the IdP `user.id`. It is stored as a secondary key and used only for IdP Backend API calls (e.g., deletion, suspension).
3. No `app_metadata` writeback to the IdP is required for the canonical user ID — the ULID is generated by the Commise backend and injected into tokens via an IdP JWT template custom claim.
4. Profile/account/user 1:1 boundaries are preserved for clear module ownership.
5. All timestamp fields are ISO 8601 at interface boundaries (NFR-010).
6. Storage engine remains RDS PostgreSQL 16 for this feature; Aurora DSQL is out of scope.
7. The `citext` extension must be enabled on the database before running migrations (`CREATE EXTENSION IF NOT EXISTS citext`).
