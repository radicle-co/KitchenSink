# CP-7 — Identity-Stack Remediation (S-I3–S-I7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate the five identity-stack architecture/quality findings from the 2026-07-18 adversarial review (master plan W10-a): fix the silent profile-sync bug (S-I3), adopt a declarative authorization Guard seam (S-I4), enforce the Lambda env config at cold start (S-I5), share the handler prologue via Template-Method wrappers (S-I6), and extract a standalone `identity-db` package so the Lambdas no longer depend on the deployable NestJS service (S-I7).

**Architecture:** `@kitchensink/identity-service` (deployable NestJS), `@kitchensink/identity-webhooks` (Lambdas), `@kitchensink/identity-utils` (plain — holds `provisionCompleteUser`), `@kitchensink/identity-core` (pure domain — `displayName`, `handleSync`). Schema + DAOs currently live INSIDE the deployable service (`packages/services/identity/src/database/`), exported via subpaths — S-I7 extracts them. The fixes are backend NestJS + Lambda; each carries **unit AND integration** tests (services mandate), and the security-relevant ones (S-I3 profile coherence, S-I4 authZ) additionally get e2e where a harness exists.

**Tech Stack:** NestJS 11, AWS Lambda handlers, Drizzle ORM + PostgreSQL 16, zod, svix (webhook verification), `@kitchensink/clerk-verify`. Vitest (unit/integration/e2e). Node 24.

## Global Constraints

_Every task's requirements implicitly include this section._

- **Master-plan fidelity:** the fixes are exactly those specified in master plan W10-a (S-I3–S-I7). Where this plan and the master text differ, the master governs; surface conflicts rather than silently diverging.
- **AuthN stays middleware, authZ moves to guards (S-I4):** `AuthMiddleware` MUST keep populating `req.user` pre-routing (it runs before guards); only the authorization _check_ moves into a `CanActivate` guard. Do NOT move authentication into a guard.
- **`profiles.displayName` is the authoritative display value (decision 6):** the app renders `profiles.displayName` for "by @handle"; `users.name` is a secondary copy. S-I3's fix keeps the two coherent AND gates writes/publishes on the value ACTUALLY stored (so an A→B→A revert is detected).
- **Handle-sync must fire on BOTH displayName-change routes (decision 6):** the Clerk `user.updated` webhook AND identity's `PATCH /v1/users/me`. S-I3 must not break the webhook publish; if `PATCH /v1/users/me` shares the gate bug, fix it too.
- **Env access is bracket-notation only (CLAUDE.md):** `process.env['KEY']`. S-I5 fixes the existing dot-notation violations (`deletionWorker.ts:47`, `reconciliation.ts:23-24`, `common/db.ts:48-49`) as part of the config consolidation.
- **Extraction preserves prod-identical behavior (S-I7):** moving schema/DAOs to a new package is a MECHANICAL refactor — no runtime behavior change, no CDK/infra template diff. Verify the synth is unchanged if the extraction touches anything the infra references.
- **Pattern-first (CLAUDE.md §Design-pattern-first):** S-I4 = Guard (declarative authZ via Reflector metadata); S-I6 = Template-Method wrappers composed around `withObservability`; S-I5 = parse-don't-validate at the boundary (zod at cold start). Name the pattern in the PR/JSDoc.
- **TDD (§7.1):** failing test BEFORE code. Backend non-UI → unit AND integration. Security-relevant paths (S-I3, S-I4) → e2e where a harness exists (`identity/tests/e2e`, `identity-webhooks/tests/e2e`). No new k6 unless a new HTTP surface is added (none is — note in the final review).
- **Standards:** backend kebab `name.type.ts`; named exports; strict TS, zero `any`, no `@ts-ignore`; `import type`; custom errors extend `Error` + `Object.setPrototypeOf` + `is*` guard.
- **Node 24:** prefix commands with `export PATH="$HOME/.nvm/versions/node/v24"*/bin:$PATH`. Identity unit: `npm run test --workspace=packages/services/identity`; integration: `... test:integration`; e2e: `... test:e2e`. Webhooks unit: `npm run test --workspace=packages/services/identity-webhooks`.

## Inheritance manifest (consumed / current state — from the CP-7 scout)

- **S-I3 bug:** `identity-webhooks/src/handlers/identityWebhook.ts:145-201` `handleUserUpdated` — gate `displayName !== existing.name || newPicture !== existing.picture` reads the `users` row (`existing`, via `UserDAO.findByIdentityId`), but writes `profiles` (172-179) and never updates `users.name`/`users.picture`. The handle-sync publish (187-197) is gated the same way. `provisionCompleteUser` (`utils/identity/src/provisioning.ts:110`) upserts users then `ensureAccountAndProfile` with `onConflictDoNothing` (does NOT update an existing profile). `UserDAO.upsertByIdentityId` updates users only; `UserDAO.updateProfile` (misnamed) writes users too. `profiles` schema: `profiles.ts:13-14` (`displayName`, `avatarUrl`). Tests: `identityWebhook.test.ts` (only a one-way `user.updated` case at :244, NO A→B→A).
- **S-I4:** `admin/admin.service.ts` `assertAdmin(ctx)` at lines 19/53/73/93/123; def 145-149 (`ctx.scopes.includes('admin:users') || ctx.permissions.includes('admin:users')`). `AuthorizerContext` (`types/jwt.ts:18-25`). `req.user` set by `AuthMiddleware.use` (`auth/middleware/auth.middleware.ts:108`) = `resolveOrCreateFromClaims` (scopes/permissions from the signed token). Admin controller (`admin/admin.controller.ts`, `v1/admin/users`) injects `@CurrentAuthorizerContext() ctx` per route. NO existing Nest guards in identity (only recipe-service's `ThrottlerGuard`); recipe-service's `resolveCurrentPrincipal`/`CurrentPrincipal` (`auth/currentPrincipal.decorator.ts`) is the closest fail-closed decorator seam.
- **S-I5:** `identity-webhooks/src/config/env.ts` — `EnvironmentSchema` + `resolveEnvironment()` (23-25), ZERO call sites. Hand-rolled `requireEnv` (`common/config.ts:17-25`, truthiness-only), used in `identityWebhook.ts:59,217,229` + `migrate.ts:57`. Dot-notation violations: `deletionWorker.ts:47`, `reconciliation.ts:23-24`, `common/db.ts:48-49`.
- **S-I6:** copy-pasted env-guard+`getDb` prologue in `deletionWorker.ts:45-57` + `reconciliation.ts:21-39` (+ `identityWebhook.ts:229-230` variant). `withObservability` (`common/observability.ts:74-91`) is the sole shared wrapper (applied by webhook/deletion/reconciliation, NOT migrate). The svix 3-case `switch` (`identityWebhook.ts:250-272`) is exhaustive — LEAVE it.
- **S-I7:** schema/DAOs in `packages/services/identity/src/database/` (plain Drizzle, no Nest DI except `DrizzleProvider`/`DatabaseModule` which are NOT exported). `identity/package.json` exports `./database/schema`, `./database/dao`, `./database/ulid`. `identity-webhooks/package.json` depends on `@kitchensink/identity-service: "*"`. Consumers reach schema/dao via those subpaths. Mirror model: `@kitchensink/recipe-core` (standalone pure package). Two byte-identical param decorators: `auth/decorators/currentUser.decorator.ts` `CurrentUser` (6-14) + `CurrentAuthorizerContext` (16-26) — collapse `CurrentUser` (the controller uses `CurrentAuthorizerContext`). Unwrapped `migrate` handler: `handlers/migrate.ts:56`.

---

### Task 1: S-I3 — Fix the silent profile-sync bug (A→B→A) + coherent users/profiles update

**The defect:** `handleUserUpdated` gates the `profiles` write on `users.name`/`users.picture`, which this path never updates — so the baseline never moves and an A→B→A revert (and its handle-sync publish) is silently skipped, freezing `profiles.displayName` at B.

**Design ruling (resolve in this task, documented):** on `user.updated`, keep `users` and `profiles` COHERENT and gate on the value ACTUALLY stored. Concretely: read the current `profiles` row (the authoritative display source); compute the incoming `displayName` (via the existing `buildDisplayName`/`deriveDisplayName`) + `avatarUrl`; write `profiles` when they differ from the CURRENT PROFILE values (not `users.name`); AND update `users.name`/`users.picture` to match so the tables stay coherent (no stale duplicate). Publish the handle-sync when `profiles.displayName` actually changed. This makes A→B→A correct (B→A sees stored B ≠ incoming A → writes A + publishes).

**Files:**

- Modify: `packages/services/identity-webhooks/src/handlers/identityWebhook.ts` — `handleUserUpdated`.
- Add/modify: a DAO method that updates an EXISTING profile's `displayName`/`avatarUrl` (the scout found none exists — `updateProfile` misleadingly writes `users`). Add e.g. `UserDAO.syncNameAndPicture(identityId, { name, picture })` (or a focused method) that, in ONE transaction, updates `users.name`/`users.picture` AND `profiles.displayName`/`avatarUrl` coherently and returns whether `displayName` changed (to gate the publish). Put it where the other DAOs live (`packages/services/identity/src/database/dao/`). Reading the CURRENT profile is required to gate correctly — either the method returns the prior value or the handler reads it first.
- Check: does `PATCH /v1/users/me` (identity service `UsersService`/controller) share the same gate bug? If it gates a profile update on a stale baseline, fix it consistently (decision 6 requires both routes correct). Find + quote it; fix if buggy.
- Test: `identity-webhooks/src/handlers/__tests__/identityWebhook.test.ts` (unit) + an integration test (real DB) if the webhooks package has an integration harness, else the identity integration suite (`packages/services/identity/tests/*.integration.test.ts`) exercising the DAO method against a real DB.

- [ ] **Step 1: Write the failing test — the A→B→A sequence.** Unit (mock DAO/db): `user.updated` name A→B writes `profiles.displayName=B` AND `users.name=B` and publishes handle-sync(B); then B→A (with the store now holding B) writes `profiles.displayName=A` AND `users.name=A` and publishes handle-sync(A) — the REVERT is NOT skipped. Assert the publish fires on BOTH transitions. Also: a no-op update (same name) does NOT write or publish. (This test MUST FAIL against the current code — the revert is currently skipped.)
- [ ] **Step 2: Run — expect FAIL** (revert skipped / users.name never updated).
- [ ] **Step 3: Implement** the DAO method (coherent users+profiles update in one tx, returns displayName-changed) + rewire `handleUserUpdated` to gate on the current profile value + publish on displayName change. Keep the email-change path. Fix `PATCH /v1/users/me` if it shares the bug.
- [ ] **Step 4: Run unit — expect PASS.**
- [ ] **Step 5: Integration test (real DB):** provision a user, apply update A→B→A through the DAO/handler, assert `profiles.displayName` ends at A (not stuck at B) and `users.name` is coherent. Run if the DB harness is available, else author + CI-note.
- [ ] **Step 6: Commit** — `fix(identity): coherent users/profiles sync on user.updated so an A→B→A rename is not silently dropped`.

---

### Task 2: S-I4 — Declarative authorization Guard seam (`ScopesGuard` + `@RequireScopes`)

**Files:**

- Create: `packages/services/identity/src/auth/guards/scopes.guard.ts` — a `ScopesGuard implements CanActivate` reading required scopes from `Reflector` metadata and checking them against `req.user`'s `scopes`/`permissions` (the same `admin:users` check `assertAdmin` did). Throw `ForbiddenException` when unsatisfied. Fail-closed if `req.user` is absent.
- Create: `packages/services/identity/src/auth/decorators/requireScopes.decorator.ts` — `@RequireScopes(...scopes: string[])` = `SetMetadata(SCOPES_METADATA_KEY, scopes)`.
- Modify: `packages/services/identity/src/admin/admin.controller.ts` — apply `@UseGuards(ScopesGuard)` + `@RequireScopes('admin:users')` (per-route or controller-level; per the master, declarative + unforgettable). Wire `ScopesGuard` as a provider (or `APP_GUARD` scoped appropriately — but a controller-level guard is fine and less blast-radius than a global one; do NOT make it global if that would gate non-admin routes).
- Modify: `packages/services/identity/src/admin/admin.service.ts` — DELETE the five `assertAdmin(ctx)` calls + the `assertAdmin` method. KEEP the `ctx: AuthorizerContext` parameter WHERE it is still used for actor identity (e.g. `startImpersonation`/`stopImpersonation` need the impersonator's identity) — the guard replaces the AUTHZ CHECK, not the actor threading. Confirm which methods still need `ctx` and keep it only there.
- Test: `packages/services/identity/src/auth/guards/__tests__/scopes.guard.test.ts` (unit) + an admin authZ test (an e2e/integration hitting an admin route without the scope → 403, with the scope → allowed) in the identity e2e/integration suite.

- [ ] **Step 1: Write failing guard unit tests** — `ScopesGuard.canActivate` returns true when `req.user.scopes` (or `.permissions`) includes the required scope; throws `ForbiddenException` when it lacks all required scopes; fail-closed (throws) when `req.user` is absent. Use a mock `ExecutionContext` + `Reflector`.
- [ ] **Step 2: Run — expect FAIL** (guard doesn't exist).
- [ ] **Step 3: Implement** the guard + decorator + wire the controller + delete the five `assertAdmin` calls (keeping `ctx` where used for identity).
- [ ] **Step 4: Run — expect PASS**; run the admin service/controller unit tests (adapt any that relied on `assertAdmin` throwing internally — the check now lives in the guard; the service methods no longer throw Forbidden, so those assertions move to the guard test).
- [ ] **Step 5: authZ e2e/integration** — an admin route denies a non-admin caller (403) and allows an admin caller. Run if the harness is available, else author + CI-note.
- [ ] **Step 6: Commit** — `refactor(identity): declarative admin authZ via ScopesGuard + @RequireScopes, delete imperative assertAdmin`.

---

### Task 3: S-I5 — Enforce the Lambda env config at cold start (typed config, delete `requireEnv`)

**Files:**

- Modify: `packages/services/identity-webhooks/src/config/env.ts` — ensure `EnvironmentSchema`/`resolveEnvironment()` covers every env var the handlers actually read (audit the handlers: `DB_SECRET_ARN`, `IDP_SECRET_KEY`/`AUTH_SECRET_ARN`, `STAGE`, `DB_POOL_MAX`, the webhook signing secret, etc.). Extend the schema so `resolveEnvironment()` is the single typed source.
- Modify: each handler module (`identityWebhook.ts`, `deletionWorker.ts`, `reconciliation.ts`, `migrate.ts`, and `common/db.ts`) — call `resolveEnvironment()` ONCE at module load (cold start), consume the typed config, and DELETE the hand-rolled `requireEnv` (`common/config.ts`) + the per-handler truthiness guards. Misconfig now fails at cold start, not first request.
- Fix the **dot-notation violations** as part of this: `deletionWorker.ts:47`, `reconciliation.ts:23-24`, `common/db.ts:48-49` → bracket notation (or, better, read from the typed config so there's no raw `process.env` at all).
- Test: `packages/services/identity-webhooks/src/config/__tests__/env.test.ts` (extend — schema accepts a valid env, rejects a missing-required one via the `.refine`) + adapt/replace the handler tests that mocked `requireEnv` / raw `process.env` to the typed-config path.

- [ ] **Step 1: Write failing tests** — `resolveEnvironment()` parses a complete valid env into the typed shape; rejects (throws a ZodError) when a required var (e.g. neither `IDP_SECRET_KEY` nor `AUTH_SECRET_ARN`, or missing `DB_SECRET_ARN`) is absent. A handler-level test asserting the handler reads the typed config (no `requireEnv`). Ensure these fail against the current unused-schema state.
- [ ] **Step 2: FAIL → Step 3: Implement** — extend the schema to the full env surface; call `resolveEnvironment()` at module load in each handler; delete `requireEnv`; fix dot-notation. Preserve the exact error/envelope behavior consumers expect where it's load-bearing (e.g. the error envelope on a genuinely missing var — but now at cold start).
- [ ] **Step 4: PASS** + full webhooks unit suite green (adapt tests).
- [ ] **Step 5: Commit** — `refactor(identity-webhooks): enforce typed env config at cold start, delete hand-rolled requireEnv`.

---

### Task 4: S-I6 — Shared handler pipeline via Template-Method wrappers

Builds on Task 3's typed config.

**Files:**

- Create: `packages/services/identity-webhooks/src/common/handlerPipeline.ts` (or extend `common/`) — Template-Method wrappers composed AROUND `withObservability`: `withDb(handler)` (resolves the typed config + warm-cached `getDb` + constructs the DAO context, passing it to the inner handler) and `withVerifiedWebhook(handler)` (the svix verification prologue for the webhook). Compose so a handler is `withObservability(withDb(...))` etc. Keep `withObservability` as the outermost/existing wrapper.
- Modify: `deletionWorker.ts`, `reconciliation.ts`, `identityWebhook.ts` — replace the copy-pasted env-guard+`getDb` prologue with the shared wrapper(s). LEAVE the svix 3-case `switch` (`identityWebhook.ts:250-272`) — it's an exhaustive-union dispatch, correct as-is.
- Test: `common/__tests__/handlerPipeline.test.ts` (the wrappers: `withDb` provides a db/DAO to the inner handler and short-circuits/throws coherently on a config error; `withVerifiedWebhook` rejects an unverified payload) + confirm the three handlers' existing tests still pass through the new composition.

- [ ] **Step 1: Write failing wrapper unit tests** — `withDb` calls the inner handler with a resolved db/DAO context and propagates the inner result; on a missing-config it fails coherently (matching the prior error behavior, now centralized). `withVerifiedWebhook` passes a verified event through and rejects an unverified one.
- [ ] **Step 2: FAIL → Step 3: Implement** the wrappers + refactor the three handlers to compose them. Preserve the request-id / error-envelope semantics.
- [ ] **Step 4: PASS** + the three handlers' unit + e2e (`identity-webhooks/tests/e2e`) tests green (no behavior change).
- [ ] **Step 5: Commit** — `refactor(identity-webhooks): share the handler prologue via withDb/withVerifiedWebhook Template-Method wrappers`.

---

### Task 5: S-I7 — Extract the `identity-db` package (+ collapse param decorators, wrap migrate)

**The biggest, most mechanical task — do it LAST so the import sweep lands after the logic fixes.**

**Files:**

- Create: `packages/shared/identity-db/` (mirror `packages/shared/recipe-core`'s package structure) — a standalone package holding the plain-Drizzle schema (`schema/{users,accounts,profiles,webhook_events}.ts` + index), the DAOs (`dao/{user,account,webhook-events}.dao.ts` + index), and `ulid.ts`. `package.json` with `drizzle-orm` (+ whatever the DAOs need) as deps, NO Nest, exports `.` (+ subpaths matching current consumers). NAME it per the workspace convention (`@kitchensink/identity-db` or `@commise/...` — check the §5.1 platform/product naming split the repo adopted in commit 68fcd6f; MATCH it).
- Move: the schema/DAO/ulid files from `packages/services/identity/src/database/` into the new package (use `git mv` to preserve history). Leave `DrizzleProvider`/`DatabaseModule` (the Nest-coupled pieces) in the identity service — they now import schema from the new package.
- Update EVERY import: identity-service internals, and identity-webhooks (`db.ts`, `provisioning.ts`, `identityWebhook.ts`, `deletionWorker.ts`, `reconciliation.ts`, `migrate.ts`, `webhook-events` consumers) — repoint `@kitchensink/identity-service/database/{schema,dao,ulid}` → the new package. Remove the `@kitchensink/identity-service` runtime dep from `identity-webhooks/package.json` if nothing else in it is needed (verify — `handle-sync-publisher` is another identity-service export the webhooks may use; if so, keep that dep or move that too). Update the identity-service `package.json` exports (drop the now-moved `./database/*` subpaths, or re-export from the new package for back-compat — prefer dropping + updating consumers).
- Also in this task (the S-I7 "minor batch"): collapse the two byte-identical param decorators (`auth/decorators/currentUser.decorator.ts` — remove `CurrentUser`, keep `CurrentAuthorizerContext`, or unify into one; update any importer); wrap the `migrate` handler (`handlers/migrate.ts:56`) in `withObservability` (parity with the other three) OR add a justify-comment if there's a reason it's unwrapped (there isn't per the scout — wrap it).
- Test: the moved DAOs' tests move WITH them into the new package (`packages/shared/identity-db/src/**/__tests__/`); every consumer's tests still pass with the new imports. Run identity + identity-webhooks + the new package's suites.

- [ ] **Step 1: Scaffold** the new package (package.json, tsconfig, vitest config — mirror `recipe-core`), `git mv` the schema/dao/ulid + their tests in, fix the new package's internal imports, and make it build + test green in isolation.
- [ ] **Step 2: Sweep the imports** across identity-service + identity-webhooks to the new package; update the two package.jsons (exports + deps). Collapse the param decorators; wrap `migrate`.
- [ ] **Step 3: Verify** — `npm run typecheck` monorepo 35/35 (now 36 packages — confirm the new package is picked up); identity unit + integration, identity-webhooks unit + e2e, and the new `identity-db` suite all green. **Confirm no CDK/infra synth diff** (the extraction is mechanical — `npm run infra:synth` for identity + webhooks should be unchanged; run it or reason about why nothing infra-referenced moved).
- [ ] **Step 4: Commit** — `refactor(identity): extract standalone identity-db package; collapse param decorators; wrap migrate handler`.

---

## Self-review (author checklist — completed)

- **Spec coverage:** S-I3 (Task 1), S-I4 (Task 2), S-I5 (Task 3), S-I6 (Task 4), S-I7 (Task 5). Each is a distinct master-plan item; ordering puts the real bug (S-I3) first, S-I5 before its dependent S-I6, and the big mechanical extraction (S-I7) last.
- **Decisions resolved in-plan:** S-I3 source-of-truth = `profiles.displayName` authoritative, keep `users` coherent, gate on the stored value (fixes A→B→A) + also fix `PATCH /v1/users/me` if it shares the bug; S-I4 guard is controller-scoped (not global) + keeps `ctx` where used for actor identity; S-I5 reads from typed config (no raw `process.env`), fixing the dot-notation; S-I6 composes around `withObservability`, leaves the svix switch; S-I7 mirrors `recipe-core`, drops the moved subpaths, and must prove no infra synth diff.
- **Test tiers:** unit + integration for every task (services mandate); e2e for the security-relevant S-I3/S-I4 where a harness exists; no new k6 (no new HTTP surface — noted).
- **No placeholders:** exact files, the exact bug + fix, the exact test cases (A→B→A, guard allow/deny/fail-closed, schema accept/reject), acceptance signals.
