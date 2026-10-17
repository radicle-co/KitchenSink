# 0059 — User settings are typed columns in one server table, and defaults live in code

- **Status**: Accepted
- **Date**: 2026-10-10
- **Drivers**: Owner ruling D19 (`docs/design/uiOverhaul/ownerDecisions.md`). The ruling says: a user's app
  preferences are stored on the server, in a new identity `settings` table with its own wire contract, so they follow
  the user across devices. The web "/" search-shortcut switch is the first setting. No preference is kept in browser
  storage.
- **Supersedes**: blueprint decision A18 of the UI overhaul (`docs/architecture/uiOverhaulBlueprint.md`), which kept
  the shortcut preference in web `localStorage`.
- **Relates to**: [ADR-0014](0014-service-owned-api-contracts.md), the wire contract. [ADR-0039](0039-database-role-split.md),
  the service role's grants. [ADR-0057](0057-editor-device-draft-and-outbox-format.md), the outbox this decision does
  not use.

## Context

A18 chose per-device storage for the shortcut switch. Its reasons were that the switch is web only, that it follows
the keyboard in use, and that a server field for one boolean was too much. D19 overturns the choice. A preference
should follow the cook, and a browser's storage is not a place the owner wants preferences kept.

The identity service has no home for a preference. `users`, `accounts` and `profiles` each hold something else. The
shortcut is the first setting and it will not be the last, so the shape of the table is a decision that is costly to
reverse: it is persisted, it is on the wire, and old clients meet new servers.

## Decision

**One table, `settings`, with one row per user and one typed, nullable column per setting.**

```sql
CREATE TABLE settings (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  search_shortcut BOOLEAN,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now());
```

1. **`NULL` means "never chosen".** The service resolves it to the default in code, in the pure function
   `resolveSettings` (`settings/domain/resolveSettings.ts`). No setting column has a `DEFAULT`. A database default
   would be a second copy of the default, and changing it would silently change the value of every user who never
   chose one, with no way to tell them apart from users who did.
2. **The defaults are published on the wire.** `SETTINGS_DEFAULTS` lives in `settings.schema.ts` and ships in
   `@kitchensink/schema-identity`. A client uses it as the placeholder while the first read is in flight. No client
   restates a default.
3. **Reads go through, and no row is made at sign-up.** `GET` with no row returns the defaults and writes nothing.
   The first `PATCH` creates the row.
4. **`PATCH` is one statement.** `INSERT … SELECT … FROM users WHERE users.id = $1 AND users.status = 'active' ON
CONFLICT (user_id) DO UPDATE SET <only the supplied columns>, updated_at = now() RETURNING *`. Two concurrent
   first writes leave one row, because the conflict target is the primary key. A user who is no longer active
   matches no row in the `SELECT`, so nothing is written, and the service answers the same `403 Account is closed`
   the auth layer uses. Personal data is never recreated after an erasure. An empty body writes nothing and returns
   the current settings.
5. **Last write wins, per column.** Two devices that change different settings both keep their change. Two that
   change the same setting keep the later one. A preference is not worth a version token.
6. **Adding a setting is four edits.** A nullable column, a field on the response schema, an optional field on the
   `PATCH` schema, and a default. The server deploys before the clients, because `PATCH` is strict and rejects a key
   it does not know. The response is not strict, so an old client ignores a key it does not know.

### Personal data

The row is personal data. **Erasure deletes it and closure keeps it.** `eraseIdentityRow` deletes the settings row
in the branch that purges the companion rows, beside `accounts` and `profiles`. A closed account is recoverable by an
admin, and its preferences come back with it. `packages/shared/identity-db/src/__tests__/erasureCoverage.test.ts`
enforces the rule. It runs the erasure against a recording database and fails when a table with a user column is
neither deleted or updated nor listed in a retention map with its reason. A new table that holds a user's data
cannot ship without a decision on its erasure.

### Writes are online and optimistic

The client updates its cache at once, sends the `PATCH`, rolls back and shows a localized message when it fails, and
refetches when it settles. Offline, the mutation pauses and resumes. The ADR-0057 outbox is not used: it would keep
the preference in browser storage, which D19 forbids, and a preference does not need the editor's guarantee that
a draft survives a crash.

### Native

Native has no switch. The "/" shortcut is a hardware-keyboard affordance and native has no equivalent yet. The
native Profile screen renders no shortcut row. This is a deliberate gap in the lock-step rule of
`docs/CODING_STANDARDS.md` §14, and the native component test for the Profile screen asserts it. When a native
setting exists, the same endpoint serves it.

## Alternatives rejected

- **A JSONB column.** The database cannot check the types inside it. A partial update needs a `jsonb_set` merge, and
  a concurrent merge needs more care than a column update. A typo in a key is a new setting nobody declared.
- **A key and value table.** Every value becomes untyped text. The service parses it on each read, and a bad value
  is a runtime failure, not a constraint violation. A row per setting makes the first read a scan and the erasure a
  larger delete.
- **A row at sign-up.** It costs a write in the hot path of the first request of every user, for a table that most
  users never change. It also needs a backfill, and a missing row would still have to be handled.
- **Column defaults in the database.** They are the second copy of the default described above.
- **Keep `localStorage` and sync it later.** D19 rules out browser storage for a preference.

## Consequences

- **A first `PATCH` after an erasure is `403`.** This is the intended answer. The user no longer exists as an
  active account.
- **The table adds to the erasure surface.** The coverage guard names the next such table when it appears.
- **A setting that must differ per device does not fit here.** It would need a device key. No current setting needs
  one.

## Verification

- `settings/domain/__tests__/resolveSettings.test.ts` pins the four states of a column.
- `settings/__tests__/settings.schema.test.ts` pins the strict `PATCH` and the unstrict response.
- `settings/__tests__/settings.service.test.ts` proves that a read writes nothing, that a `PATCH` sets only the
  columns it names, and that an inactive user gets `403`.
- `tests/apiRoutePaths.test.ts` proves that the controller has no deprecated alias.
- `tests/e2e/migration0015Settings.e2e.test.ts` is LOCAL e2e on a real Postgres. It proves the key, the foreign key,
  the column type, the service role's grants, and that two concurrent first writes leave one row.
- `packages/shared/identity-db/src/__tests__/erasureCoverage.test.ts` is the coverage guard.
