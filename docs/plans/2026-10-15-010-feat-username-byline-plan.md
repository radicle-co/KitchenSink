---
title: 'feat: usernames as the public byline — the Clerk username carried from sign-up to every "@handle"'
type: feat
date: 2026-10-15
status: blueprinted — staff-architect BLUEPRINT and staff-ux-engineer SPECIFY (2026-10-15) folded in below
---

# Usernames as the public byline

## Owner rulings (2026-10-13)

- The Clerk USERNAME is the public byline. Every "@handle" the apps render is the username.
- Sign-up collects first name, last name, username and email — typed, or from a social sign-up, asking only for what
  the provider did not supply. Both Clerk instances already require all four, so no Clerk setting changes.
- The display name stays PUBLIC, shown alongside the username, filled from first + last name (D22 unchanged: the cook
  can change it in Profile).
- Sign-in by email OR username stays.
- No in-app username rename yet. Clerk is the authority for usernames.
- Both session tokens carry `"username": "{{user.username}}"` (`commise-native` and the web default token, both
  instances; verified live by minted tokens).

## Facts read from source

- **Nothing carries a username today.** `VerifiedClerkClaims` (`@kitchensink/clerk-verify`) maps `first_name`,
  `last_name`, `email`, `image_url`; no `username`. The Clerk webhook boundary schema (`idpPayload.schema.ts`) models
  no `username`. `profiles` has no username column.
- **"@handle" renders the DISPLAY NAME.** `profiles.displayName` is denormalized into the recipe DB as
  `recipes.author_handle`, `recipe_versions.editor_handle` and `collections.source_owner_handle` (frozen at clone
  time), and kept in a sparse read model `author_handles(user_id, display_name, source_timestamp)`. Clients render
  `'@{handle}'` / `'by @{handle}'` / `copiedFrom` over it — so today a card reads "@Brandon Webb".
- **The handle-sync fan-out.** identity's `PATCH /api/v1/users/me` and the webhook's `user.updated` publish
  `{ userId, displayName, sourceTimestamp }` (`@kitchensink/identity-core` `handleSyncMessageSchema`) to the global SNS
  topic, ONLY when the display name changed. `recipe-workers` `handleSyncWorker` applies it monotonically on
  `source_timestamp` and fans out to `recipes` + `recipe_versions` by owner. The same apply logic exists a second
  time in `recipe-service` `AuthorHandlesDal.applyRename`. A failed publish leaves `profiles.handle_sync_owed_at` set.
- **The recipe write path seeds from the TOKEN, not the read model.** `RecipesService` create/update/version writes
  `deriveDisplayName(principal)`; only the collection clone reads `AuthorHandlesDal.findHandle`. Migration 0015's
  header claims the read model closes write-time staleness; the code does not use it on recipe writes.
- **The webhook publishes Clerk's name even when the cook overrode it.** It publishes `buildDisplayName(data)` only
  when `syncNameAndPicture` reports the name changed. A username-only change would publish nothing.
- **Erasure.** identity's `eraseIdentityRow` deletes the `profiles` row (a username column goes with it); closure keeps
  it (as it keeps `display_name`). In the recipe DB the erasure worker scrubs every kept `author_handle` /
  `editor_handle` / `source_owner_handle` to a ULID pseudonym and deletes the `author_handles` row.
- **The erasure guard is blind to a username column.** `erasureSweepCoverage.test.ts` discovers handle-bearing columns
  by SHAPE, `HANDLE_COLUMN = /^(?:[a-z0-9_]+_)?handle$|^display_name$/`, with `MINIMUM_HANDLE_BEARING_COLUMNS = 4`. A
  column named `author_username` would not be discovered, so an unscrubbed username would pass green.
- **`citext` exists only in identity** (`0005_identity_reset.sql`; `users.email` is `citext` via a `customType` in
  `identity-db/src/schema/users.ts`).
- **Web sign-up already asks for all four.** `<SignUp>` renders what the instance requires; `signUp.spec.ts` fills
  first name, last name and username. `SignUpForm.tsx`'s docstring wrongly says username and names are OFF.
- **Native sign-up is broken today.** `screens/signup.tsx` sends only `emailAddress` + password; with three required
  fields missing, `missingFields` is non-empty and every native sign-up ends on `additionalVerification`. Native has
  no social sign-in yet (`appConfig.test.ts`), so "ask only for what Google did not supply" is web-only today and must
  be the shape native adopts when One Tap lands. `@clerk/expo` 4.6.0's `signUp.create` takes `firstName`, `lastName`,
  `username`, `emailAddress`, `password`.
- **Pool users already have usernames** (`poolAdmin.ts` writes `username` on `createUser`).

## Decisions (as blueprinted)

The draft D1–D13 went to staff-architect (BLUEPRINT) and staff-ux-engineer (SPECIFY). Four drafts changed: D3 is `text`,
D6 needs a database clock, D7 freezes no username onto `collections`, and the read model is seeded at creation.

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1   | `VerifiedClerkClaims.username?` from `asNonEmptyString(payload['username'])`; recipe-service `Principal.username?`. Consumers parse it with `parseUsername` (D2) and drop an invalid value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D2   | `@kitchensink/identity-core`: `MAX_USERNAME_LENGTH = 64` (Clerk documents 4–64, customisable), `usernameSchema = z.string().min(1).max(64)` (no trim, no case fold — store what Clerk sends), `parseUsername`, `BylineSnapshot`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D3   | identity `0016_profiles_username.sql`: `ALTER TABLE profiles ADD COLUMN username text;` — nullable, no default, NO unique index. **Not `citext`** (the prior design): nothing looks a user up by username, and `citext` would hide a case-only rename from SQL comparison. No unique index because Clerk is the authority and a swapped pair arriving out of order must not fail a sync.                                                                                                                                                                                                                                                                                                                              |
| D4   | The username is seeded on every create path (read-through create and heal, webhook `user.created`, reconciliation). No heal-on-read: a second writer working from a token up to 60 s stale.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D5   | `UserDAO.syncNameAndPicture` → `syncProviderFields(userId, { name, picture, username, now })`, row-locked, returning `{ byline?: BylineSnapshot }` only when the display name OR the username changed. The snapshot carries the PROFILE's display name, so a username-only change never overwrites a cook's own display name with Clerk's.                                                                                                                                                                                                                                                                                                                                                                            |
| D6   | **The handle-sync message is a full snapshot** `{ userId, displayName, username: string \| null, sourceTimestamp }`, `username` a required key. Every producer takes it from the `RETURNING` of the statement that changed the profile, and that statement stamps `updated_at = handle_sync_owed_at = profileClock` — `GREATEST(date_trunc('milliseconds', statement_timestamp()), profiles.updated_at + 1 ms)`. The row lock serialises writers, so the last writer always carries the highest key and the whole state; a process clock would let PATCH stamp T1, the webhook T2 > T1, PATCH commit last, and the consumer refuse the newer state for good. Milliseconds because a JS `Date` truncates microseconds. |
| D6a  | PATCH `displayName` becomes `.trim().min(1).max(100)`: with snapshots a blank display name would fail every later sync.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D6b  | `provisionCompleteUser` seeds the profile's `username` and clock, and its result carries `createdByline` only when THIS call inserted the profile; the create paths publish it. `author_handles` becomes complete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D6c  | One shared step `publishOwedByline(publisher, settle, snapshot)` publishes then settles the owed marker conditionally on its stamp. `UsersService.clearHandleSyncOwed` / `recordHandleSyncFailure` (duplicates of `UserDAO.settleHandleSync`) are deleted.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D6d  | `AuthorHandlesDal.applyRename` has no production caller (the worker's `applyHandleRename` is the live consumer) and is deleted; its e2e cases move to recipe-workers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D7   | recipe `0055_author_usernames.sql`: `author_handles.username`, `recipes.author_username`, `recipe_versions.editor_username` — `text`, nullable. **No `collections.source_owner_username`.** The W5 freeze was argued for a display name, a label; a username is a reusable identifier Clerk lets a user change, so a frozen `@name` could come to point at a different person. The collection read resolves `sourceOwnerUsername` at read time through the source collection's owner in `author_handles`; a deleted source yields none. The frozen display name stays.                                                                                                                                                |
| D8   | Recipe writes read the read model FIRST, inside the write transaction (`findByline … FOR SHARE`), through a pure `resolveByline(readModel, principal)` (per field: read model, else token claim). Applies to the display name too, which makes migration 0015's write-time claim true and stops a cook's own display name being replaced by Clerk's on their next recipe.                                                                                                                                                                                                                                                                                                                                             |
| D9   | Wire/TS fields renamed for what they hold: `authorHandle→authorDisplayName`, `editorHandle→editorDisplayName`, `sourceOwnerHandle→sourceOwnerDisplayName` (export fields and Drizzle property names too). **SQL columns keep their names** (a rename is a contracting migration under ADR-0035). Added: `authorUsername?`, `editorUsername?`, `sourceOwnerUsername?`, export `username`/`authorUsername`/`editorUsername`, identity `user.username: string \| null`.                                                                                                                                                                                                                                                  |
| D10  | Erasure clears the username copies to **NULL**, never a pseudonym: `user_<ULID>` is a legal Clerk username. The `author_handles` row delete covers its column. identity: erasure deletes `profiles`, closure keeps the username as it keeps `display_name`.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D10a | `erasureSweepCoverage`: `HANDLE_COLUMN` widens to `username`; `MINIMUM_HANDLE_BEARING_COLUMNS` 4 → 7; `author_handles.username` joins `HANDLE_COLUMNS_DELETED_WITH_THEIR_ROW`; a de-identifying `SET … = NULL` keyed on a NOT NULL owner column counts as paired (`notNullColumnsOf`, with a fixture table).                                                                                                                                                                                                                                                                                                                                                                                                          |
| D11  | One pure `bylineOf` in `@commise/features-recipes/src/byline/` returns `person` (username, display name?), `name`, `former` (erased author — recognised by `isPseudonymizedAuthorHandle`, exported beside the function that writes the pseudonym), `source`, or `none`; every surface renders it through an exhaustive switch. Copy: `@{handle} ({displayName})`, `@{handle}`, `{displayName}` (never prefixed "@"), "a former member"/"Former member". Each user string is bidi-isolated. The avatar initial comes from the username, else the display name. Compact Discover cards hide the disc.                                                                                                                   |
| D12  | Profile shows `@username` read-only under the display name (web and native header; web Account group row); hidden when absent. `nameHint` becomes "Shown next to your username on recipes you publish."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D13  | Native sign-up collects first name, last name, username, email, password in one `signUp.create`, with per-field errors routed by Clerk's `meta.paramName`. A finish step driven by `signUp.missingFields` (a `SIGN_UP_FIELDS` registry + pure `signUpFieldPlan`) asks only for what is missing, so a future social sign-up re-asks nothing. `@commise/ui` `Input` gains `given-name`/`family-name` and `autoCorrect`. Web: Clerk's `<SignUp>` already asks for all four — docstring fix only.                                                                                                                                                                                                                         |

### Patterns

Introduced: Event-Carried State Transfer (the byline snapshot; its "highest key carries the whole state" contract is
`profileClock` + `RETURNING`), Policy (`bylinePolicy`), Registry (`SIGN_UP_FIELDS`). Preserved: Port + SNS Adapter +
Null Object (publisher), Read Model (`author_handles`, now complete), Idempotent Receiver (the worker's monotonic
guard), Anti-Corruption Layer (`idpPayload`, clerk-verify). Already satisfied: the leaves' exhaustive switch over
`bylineOf` is Visitor.

### One-way doors

The handle-sync message shape; `profiles.username` and the 0055 columns; "a username is never frozen"; NULL on
erasure.

## Test tiers

| Tier                 | Where                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                 | clerk-verify claim mapping; identity-core schema + bound; webhook schema; DAO sync; publisher; worker parse/apply; byline rule; i18n; sign-up. |
| Integration (mocked) | identity `GET /users/me` + read-through create; webhook `user.updated` publish; recipe create/clone seeds username; export.                    |
| LOCAL e2e (real DB)  | identity `0016` migrated schema; recipe `0055` migrated schema + worker apply + erasure scrub.                                                 |
| Component            | every byline state on web and native; Profile username; native sign-up fields, errors, busy.                                                   |
| Playwright / Maestro | Discover byline shows "@username" (written, not run); native sign-up flow (written, not run).                                                  |
| Guards               | `erasureSweepCoverage` discovers the username columns.                                                                                         |

## Open questions for the owner

1. Is Clerk's "Allow users to change username" on in both instances? If so, renames happen from day one through
   Clerk's own pages. The update path handles them either way; the owner may want it off until in-app rename exists.
2. D7 deviates from the W5 clone freeze for the username half only (the display name stays frozen). Reversible: no
   column is added.
3. Native sign-in still labels its field "Email" only (`mobile/src/screens/login.tsx`), so "sign in by email or
   username" works on native only by typing a username into an Email field. Follow-up: label "Email or username",
   `autoComplete="username"`, identifier-neutral errors.
