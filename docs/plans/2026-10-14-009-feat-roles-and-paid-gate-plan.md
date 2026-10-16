---
title: 'feat: user roles and the paid-features gate — roles in Clerk public_metadata, one entitlement policy, account.paidFeatures'
type: feat
date: 2026-10-14
status: built — 2026-10-15 (blueprint corrections below supersede D1, D7, D8, D10, D13, D15 where they differ)
---

# User roles and the paid-features gate

## Owner rulings (2026-10-13, amended 2026-10-15)

- Every upsell and every paid feature sits behind a gate. A user who is NOT `superuser`, `vip` or `premium`,
  with the gate flag `false`, sees no paid feature and no upsell. With the flag `true`, such a user sees the upsell
  flows. An entitled role ALWAYS gets the paid features, whatever the flag says.
- Two GitHub variables: `PAID_FEATURES_GATE_SANDBOX` and `PAID_FEATURES_GATE_PROD`. Both stay `false`. The owner
  alone flips them. Nothing in this change creates or sets either.
- Roles live in Clerk `public_metadata.roles`: `admin`, `superuser`, `vip`, `premium`, `default`.
- `default` is WRITTEN at sign-up by the Clerk webhook on `user.created`. "Absent means default" was rejected. So a
  second `public_metadata` writer exists, and the single-writer guard is amended on purpose.
- `admin`: the in-app admin features (not built yet), and later AWS/Sentry admin. It carries every scope but does NOT
  get the paid features free: an admin sees them as a default user does, and the gate decides upsell or hidden (owner
  ruling 2026-10-15). `superuser`: an admin who uses the entire app free (a developer) — every scope plus the paid
  features, never AWS/Sentry. The paid features go to `superuser`, `vip` and `premium` only.
- Roles imply scopes. `admin` and `superuser` → every scope: `admin:users`, `food:admin`, `recipes:import:public`,
  `recipes:mappings:global`, `recipes:parses:global` (owner ruling 2026-10-15; this replaces the earlier default that
  gave `admin` only the admin scopes).
- The test pool holds `default`, `admin`, `premium`, `superuser` and `vip` users. A premium-feature test signs in as a
  DEFAULT or ADMIN user to prove only the upsell shows, and as `premium`/`vip`/`superuser` to prove the paid flow shows.

## Facts read from source

- **One tier source per side already exists.** recipe-service: `isPremiumPrincipal` (`auth/principal.ts`) reads
  `permissions.includes('premium')`, and every tier-dependent rule reads it (`visibilityPolicy`,
  `collectionVisibilityPolicy` through `tieredActingPrincipalOf`, `RecipesService`). identity:
  `subscriptionTierFor(ctx.permissions)` (`users/domain/subscriptionTier.ts`) feeds `account.subscriptionTier` on
  `GET` and `PATCH /users/me`. The DB column `accounts.subscription_tier` is written and read by nothing.
- **Grants are parsed in ONE place for every service:** `verifyClerkToken` (`@kitchensink/clerk-verify`) reads
  `public_metadata.scopes`/`permissions`/`testPrincipal`. identity, recipe, food and the production edge use it. Food
  does NOT depend on `@kitchensink/identity-core`.
- **The scope literals are owned by their services:** `admin:users` (identity `@RequireScopes`), `FOOD_ADMIN_SCOPE`
  (food), `CURATOR_IMPORT_SCOPE`, `CURATOR_MAPPING_SCOPE`, `CURATOR_PARSE_SCOPE` (recipe).
- **The session tokens already carry the whole `public_metadata`.** `testPrincipal` arrives in deployed tokens with
  no template change (ADR-0040), and `commise-native` documents that it carries `public_metadata`. ⚠️ Not verified
  against the Clerk dashboard; if either template maps chosen keys, `roles` never reaches a service.
- **Clients gate on `account.subscriptionTier` only**, through `makeViewer(...).tier` → `canGoPrivate` (six hosts:
  web and native editor, recipe page, collection page) and `toWidgetTier` (both Home surfaces). Nothing displays the
  tier. `useGatedPrivate` / `privateNeedsPremium` (features-recipes) is the client's one decision point
  (ownerDecisions 2026-10-13 §2 names it as where the gate is added).
- **Paid features and upsells that exist today:** private recipe (editor "Who can see it", recipe ⋯ "Make private"),
  private collection (collection ⋯ "Make private", `visibilityUndo`), and their two upsell sheets
  (`RecipeUpsellSheet`, `CollectionUpsellSheet`, web and native). The Home `SubscriptionNudge` (web and native) is
  wired to `useHomeNudge().trigger()`, which no live widget calls (FR-046 ships the mechanism only).
- **Identity is shared, never per-PR.** It deploys only at `sandbox` and `prod`, so `PAID_FEATURES_GATE_SANDBOX`
  governs the sandbox AND every `pr-{N}` preview. Three paths deploy it: `sandbox-identity-deploy.yml`,
  `prod-deploy.yml`, and the `identity` job of `deployInfra.yml` (through `.github/actions/infra-package`).
- **The webhook's `user.created` payload is not parsed for `public_metadata`** (`idpPayload.schema.ts`), and pool
  users are created by `poolAdmin` WITH their metadata in the same `createUser` call, so `user.created` fires for them
  too.
- **Pool shard lanes cannot carry differing roles.** Playwright assigns spec files to shards; a `web`/`webStub` lane is
  a shard, not a role.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **The entitlement policy** is `@kitchensink/identity-core/src/entitlement.ts`, pure, exported through the package's `index.ts`. It owns: `ROLES` (`admin`, `superuser`, `vip`, `premium`, `default`), `Role`, `parseRoles(unknown): readonly Role[]` (exact strings only; unknown, wrong-case, prefixed and non-array values are dropped, so it fails closed), `ENTITLED_ROLES`, `hasPaidFeatures(roles)`, `ROLE_SCOPES: Record<Role, readonly string[]>`, `scopesForRoles(roles)`, `PAID_FEATURE_ACCESS` (`granted`, `upsell`, `hidden`), `paidFeatureAccess({ roles, gate })`, and `DEFAULT_ROLE_METADATA` + `needsDefaultRole(publicMetadata)` for the webhook. |
| D2  | **The gate changes what is SHOWN, never who is ALLOWED.** `paidFeatureAccess` = `granted` if `hasPaidFeatures(roles)`, else `upsell` if `gate`, else `hidden`. Server authorization reads roles only, under both gate values, so recipe-service never reads the flag.                                                                                                                                                                                                                                                                                                                                                                                              |
| D3  | **Roles → scopes is applied ONCE, in `verifyClerkToken`.** `VerifiedClerkClaims` gains `roles: readonly Role[]`, and `scopes` becomes the explicit `public_metadata.scopes` UNION `scopesForRoles(roles)`. Every service and the edge get the expansion through the one parser, food included. New edge `clerk-verify → identity-core` (identity-core is `sideEffects: false`, depends on `zod` + `ulidx`). Explicit scopes keep working (the linkage lane relies on them).                                                                                                                                                                                        |
| D4  | **`ROLE_SCOPES`** — `admin` and `superuser` → all five scopes (owner ruling 2026-10-15, which answered Q1); `vip`, `premium`, `default` → none. A guard proves `admin` and `superuser` each EQUAL every scope literal a service defines, found by searching the services' sources, not by a hand-kept list. `ENTITLED_ROLES` is `superuser`, `vip`, `premium`: `admin` is not entitled.                                                                                                                                                                                                                                                                            |
| D5  | **recipe-service** — `Principal` gains `roles`. `isPremiumPrincipal` becomes `hasPaidFeatures(principal.roles)`; `PREMIUM_PERMISSION` is deleted. The policies' `isPremium: boolean` inputs are unchanged (ADR-0023 shape: a policy takes facts, not a principal).                                                                                                                                                                                                                                                                                                                                                                                                 |
| D6  | **identity** — `subscriptionTier.ts` and its `PREMIUM_PERMISSION` are deleted. `AuthorizerContext` gains `roles`. `GET` and `PATCH /users/me` return `account.paidFeatures` from `paidFeatureAccess({ roles: ctx.roles, gate: config.PAID_FEATURES_GATE })`. `account.subscriptionTier` is REMOVED from the wire (nothing displays it, and keeping it leaves clients a second thing to gate on). Server deploys before clients; nothing is live, so no expand step.                                                                                                                                                                                                |
| D7  | **Wire contract** — `paidFeaturesSchema = z.enum(['granted','upsell','hidden'])` in `users.schema.ts` (import rule: zod only), copied by `contract:generate` to `@kitchensink/schema-identity`, `CONTRACT_HASH` + `openapi.yaml` regenerated. A unit test pins `paidFeaturesSchema.options` to identity-core's `PAID_FEATURE_ACCESS`.                                                                                                                                                                                                                                                                                                                              |
| D8  | **The gate in identity** — `PAID_FEATURES_GATE: z.enum(['true','false']).default('false')` in `env.schema.ts`, read as a boolean. ONLY identity reads it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D9  | **Deploy wiring** — `.github/scripts/resolvePaidFeaturesGate.sh STAGE`: `prod` → `PAID_FEATURES_GATE_PROD`, `sandbox` → `PAID_FEATURES_GATE_SANDBOX`, anything else → `false`; only the exact string `true` counts; exported through `safeEnv.sh`. The `vars.*` arrive through `env:`, never inlined in `run:`. Called before the identity deploy in all three paths. `infra/bin/app.ts` reads `process.env['PAID_FEATURES_GATE'] === 'true'` at synth into a REQUIRED `paidFeaturesGate: boolean` prop; the stack emits `PAID_FEATURES_GATE: 'true' \| 'false'` explicitly. A guard asserts every workflow that deploys the identity app runs the resolver.       |
| D10 | **The webhook writer** — after `user.created` is processed, `ensureDefaultRole` (identity-webhooks `common/identityClient.ts`) reads the user FRESH from Clerk and, only when `needsDefaultRole` (no `roles` key at all), merges `{ roles: ['default'] }` with `updateUserMetadata`. It never overwrites a present `roles`, so a pool user created with its roles keeps them. A failure THROWS: the event is not recorded, svix retries, and every step before it is idempotent. It runs on the email-collision and missing-email paths too (roles belong to the Clerk user, not the local row).                                                                   |
| D11 | **Single-writer guard** — `metadataSingleWriter.test.ts` becomes an allowlist of two, each with its reason. The webhook writer is pinned to the merge shape (`updateUserMetadata`) and to the `roles` key only. `poolAdmin.ts`'s header is amended to say it is no longer the only writer.                                                                                                                                                                                                                                                                                                                                                                         |
| D12 | **Pool roster** — `PoolLane.premium` becomes a REQUIRED `roles: readonly Role[]`, written on every lane (`default` everywhere except the existing premium lanes, which become `premium`). `PoolSlotMetadata` carries `roles` and keeps `permissions: []` (revokes the old grant). `metadataSatisfies` checks `roles`. A new tier `roles` (appended) holds one lane per role: `roledefault`, `roleadmin`, `rolepremium`, `rolesuperuser`, `rolevip`, password sign-in. Its users are used READ-ONLY (no write a reset would owe), the webStub argument.                                                                                                             |
| D13 | **Client mapping, one place** — `@commise/features-account/src/paidFeatures.ts`: `paidFeatureAccessOf(profileQuery)` → `{ status: 'loading' } \| { status: 'settled', paidFeatures }`; a FAILED profile read is `hidden` (fail closed: no paid feature, no upsell). Every host passes the result down; no surface reads `subscriptionTier` again.                                                                                                                                                                                                                                                                                                                  |
| D14 | **Client surfaces** (states per the UX spec) — `useGatedPrivate` takes `paidFeatures` instead of `mayGoPrivate`; `privateNeedsPremium` stays the one "needs the upsell" rule; a new `offersPrivate(paidFeatures, current)` decides whether Private is shown at all. Editor visibility field, recipe ⋯ menu (`detailMenuOf` gains `paidFeatures`), collection ⋯ menu and `useCollectionVisibility`, both upsell sheets, Home nudge (`trigger` is a no-op unless `upsell`) and Home widget tier (`granted` → `pro`). Web and native in the same change.                                                                                                              |
| D15 | **recipe-core** `canGoPrivate` / `Viewer.tier` lose their client callers. Decision deferred to the blueprint: delete them, or keep them for the server.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Blueprint corrections, as built

The `staff-architect` BLUEPRINT pass and one scaled `staff-ux-engineer` SPECIFY answer changed these decisions. Where a
row above disagrees, this list wins.

- **D1/D3 — the role vocabulary lives in `@kitchensink/clerk-verify/src/roles.ts`**, not identity-core: it is the
  grammar of the signed claim, it imports nothing, and food depends only on clerk-verify. It is exported through the
  package barrel (a `./roles` subpath was tried and removed: the house import rule admits only declared subpaths, and
  no bundle needs the roles alone). The gate-aware `paidFeatureAccess` is identity-only
  (`identity/src/users/domain/paidFeatureAccess.ts`) and returns the wire type, so no constant needs pinning (D7).
- **D8 — the gate is read once at boot** through `paidFeaturesGateProvider`, never per request.
- **D10 — a 404 converges.** A user Clerk no longer holds answers `absent` instead of failing every svix retry.
- **D12 — the `roles` tier is read-only by rule**, stated in `POOL_TIERS`; `rolesuperuser` holds the global curator
  scopes, so a write as it would reach global data.
- **D13 — `paidFeatureStateOf(profile)`** returns one flat union: `loading | granted | upsell | hidden`.
- **D14 — UX spec.** Loading FAILS CLOSED (the wait-then-decide branch is deleted). Under `hidden` or `loading` the
  editor shows `RecipeVisibilityStatement` ("Who can see it: Public") in place of the radio group; the ⋯ menus leave
  Make private out; a thing ALREADY private stays private, may go back to private, and under `hidden` its Public card
  says the choice is final. The Home nudge is offered only under `upsell`. The collection menu is built once
  (`collectionMenuItems`).
- **D15 — deleted.** `canGoPrivate`, `Viewer.tier`, `Tier`, `tierSchema` and `rankTier` had client callers only.
- **Maestro** — `recipes/paidFeaturesByRole.yaml` is in `FLOW_PLAN`, on both platform lanes (Q3): the only per-platform
  door, `MAESTRO_PLATFORM_EXCLUSIONS`, admits only flows that reach an Android-only command. It spends up to five
  Clerk email-code verifications per platform per run, which the budget guard names.
- **Q5 — the make-public confirm.** A downgraded owner (`hidden`, `upsell`; `loading` too) confirms before a private
  recipe goes public, in the editor and on the recipe page's ⋯ menu (`useMakePublicConfirm`,
  `RecipeMakePublicDialog`), and the Public card says beforehand what it costs (`makePublicConsequence`).
- **A write decides from the profile's own answer** (`knownPaidFeaturesOf`), never the display state: a failed read
  shows as `hidden` but is not a refusal, so the Private is sent and the server decides.
- **The stuck save.** The editor asks the gate with `heldVisibility` (Private only while the draft keeps it), so a
  downgraded owner who leaves Private is not offered it back. A Private the server is known to refuse
  (`privateRefusalOf`: `hidden`, `upsell`) is never sent: a create goes out public, the publish follow-up is skipped,
  and the finish notice says the recipe stayed public (`EditorFinish.privateRefused`).

## Tests, by tier (each written red first)

- **identity-core** unit: `parseRoles` partitions; `paidFeatureAccess` 5 roles × 2 gate values (table); `scopesForRoles`
  union and dedupe; `needsDefaultRole`.
- **clerk-verify** unit: `roles` parsed from signed `public_metadata` only (not a top-level claim, not
  `unsafe_metadata`); scopes = explicit ∪ implied; unknown roles grant nothing.
- **identity** unit + integration (mocked): `GET`/`PATCH /users/me` `paidFeatures` for every role × gate; env parse;
  schema pin. LOCAL e2e: a self-signed token per role through the booted app.
- **identity infra** unit: the stack emits `PAID_FEATURES_GATE` from the prop, both values.
- **workflows**: resolver script truth table (the `resolveAlarmsEnabled.test.ts` shape) and the every-identity-deploy
  guard.
- **recipe-service** unit + integration (mocked): every role on the private-recipe and private-collection writes
  (`default`/`admin` refused; `premium`/`vip`/`superuser` allowed); a `premium` PERMISSION alone no longer grants.
- **food-service / identity admin / recipe curator**: a `superuser` token passes each scope check; a guard that each
  service's scope constant is in `ROLE_SCOPES.superuser`.
- **identity-webhooks** unit + integration (mocked Clerk): writes `default` when `roles` absent; never overwrites;
  failure rethrows and the event is not recorded; a redelivery after an admin set a role leaves it alone.
- **e2e-fixtures** unit: roster roles, metadata, the new tier, `metadataSatisfies` on `roles`.
- **UI** component tests for every surface × {loading, granted, upsell, hidden} + failed profile, web and native.
- **Playwright**: mocked specs per state (`mockRecipeApi`'s `/users/me` serves `paidFeatures`); one deployed spec over
  the `roles` tier asserting the UI matches what `/users/me` reports, plus the two gate-free invariants (`default` and
  `admin` are never `granted`; an entitled role is always `granted`). Written, not run.
- **Maestro**: the same two flows (default and admin, entitled) on the `roles` tier. Written, not run.

## Open questions for the owner

- **Q1.** Answered (owner ruling 2026-10-15): `admin` gets every scope, as `superuser` does, and no paid features.
- **Q2.** Should the Clerk session-token templates (web and `commise-native`) be checked in the dashboard for a
  whole-object `public_metadata` mapping? This change assumes it. If either maps chosen keys, `roles` never arrives and
  every check fails closed to no paid features.
- **Q3.** Answered: `recipes/paidFeaturesByRole.yaml` joins the Maestro plan, on both lanes.
- **Q4.** Answered: GR-012 AC-012-c (v3.5.1) and ADR-0017 consequence 3 name `hasPaidFeatures` as the one shared
  check.
- **Q5.** Answered: the confirm is built for recipes (see the corrections above).

## Follow-up tasks

- **T1 — the collection make-public confirm.** A downgraded owner's ⋯ Make public on a private collection is one tap and
  cannot be undone (`collections/detailModel.ts`). Give it the same confirm through `useMakePublicConfirm`, with its own
  copy in `collections/messages.ts` ("Make this collection public?"), web and native; the UX SPECIFY pass recommends it.
- **T2 — a downgraded-owner pool lane** (seeded `premium`, then downgraded by `poolAdmin`), so
  `recipes/makePublicConfirm.yaml` can leave `KNOWN_UNRUN_FLOWS`, and a confirm → statement leg can be added to it.
- **T3 — the refusal notice is INLINE, on the recipe page (done 2026-10-16; `docs/design/uiOverhaul/buildSpec.md`
  §6.4).** An earlier version of this task kept it a finish snackbar, on the premise that the inline slot cannot
  receive state across the editor's hand-off. That premise was wrong. Web already carries the finish in `?done=`, and
  native carries it as a `RecipeDetail` route param (`privateRefused`). The snackbar now says only how the editor
  finished. One slot in `RecipeDetailBody` (`visibilityNotice`, an assertive `LiveRegion` under the rating and
  visibility line) says all three refusals and the generic failure, decided in one pure function
  (`visibilityNoticeOf`). The claim in the link is not trusted: the sentence shows only for the owner of a public recipe
  whose profile refuses Private, and the words come from the profile, never from the link.

## Operations after merge (the owner's, not this change's)

1. Deploy identity before the clients (`subscriptionTier` left the wire).
2. Run `poolAdmin --apply`: it writes `roles` to every lane, revokes the old `premium` permission, and creates the
   five `roles` users. Until then the signer and k6 lanes lose private writes.
3. To flip a gate: set `PAID_FEATURES_GATE_SANDBOX` or `_PROD`, then dispatch the identity deploy.

## Pattern register

- `@pattern Specification` — `paidFeatureAccess` / `hasPaidFeatures`, pure predicates over roles and the gate.
- `@pattern Parser` + `@pattern Registry` (clerk-verify `roles.ts`) — `ROLE_SCOPES`, a typed `Record` over the `Role` union (a role with no entry is a compile error).
- `@pattern Parser` (parse, don't validate) — `parseRoles` at the token boundary, inside `verifyClerkToken`.
- `@pattern Policy` — the unchanged `visibilityPolicy` / `collectionVisibilityPolicy`, fed by the new derivation.
- `@pattern Adapter` — `paidFeatureAccessOf`, profile query → the surfaces' state.
- Already the pattern, nothing added: `useGatedPrivate` stays the one client decision point (ownerDecisions §2).
