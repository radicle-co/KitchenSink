# Implementation Plan: Signed-out Reading of Public Recipes

**Branch**: `docs/im-spec003a` (single-branch directive. `setup-plan.sh` refuses a feature id that is not all digits,
so the template was copied by hand. `.specify/feature.json` pointed at this directory only inside this worktree, and
was put back before the commit.) | **Date**: 2026-11-09 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/003A-signed-out-reading/spec.md`

**Staff runs**: `staff-architect` PLANNING then BLUEPRINT, and `staff-ux-engineer` DISCOVER then DESIGN, all on
2026-11-09. `staff-ux-engineer` SPECIFY is owed before any UI is built, and `staff-architect` REVIEW per unit after.

## Summary

Build the whole signed-out read path for one public recipe, on web and native, and ship it dark.

- recipe-service gains `GET /api/v1/public/recipes/{id}`, always `no-store`. It runs outside the Clerk middleware and
  the per-user throttle. One pure Specification, `openToWeb`, decides the form. Its two halves are `contentOpen`, over
  the row and every content reading, and `authorActive`, over the author standing. Every input is a required, typed
  reading.
- For food names and nutrition, recipe-service signs a short-lived EdDSA token for two new food internal routes that
  copy the contracts of their public twins. Food answers as `svc_public-reader`. That principal sees no private food
  and holds no root.
- For the author's standing, recipe-service asks a new identity internal route with the same token type and its own
  audience. No answer is `unknown`, and `unknown` is closed.
- The web renders `https://commise.app/recipe/{id}/{slug}` on the server with classic ISR: `revalidate = 60` and
  `expireTime: 300`. The route has its own root layout with no Clerk provider, so it sets no cookie. The native app
  opens the same link as a public view when signed out.
- Rate limits sit at the edge of both systems: Vercel Firewall for pages, an AWS WAF web ACL on the recipe distribution
  for the API.
- The readings that 016 and 020 own return `unknown`, so `contentOpen` closes every recipe before any call to food or
  identity. Every public address answers not available until 016 and 020 ship. No 003A code changes when they do.

## Technical Context

**Language/Version**: TypeScript (strict), Node 24.x.
**Primary Dependencies**: NestJS 11 in recipe, food and identity. `@nestjs/throttler` for `@SkipThrottle`. `jose` for
EdDSA, already used by recipe and food, and newly declared by identity. zod. Next.js 16.3 (ISR, route handlers).
`@clerk/nextjs`. Expo 57 with React Navigation 7 and Tamagui. TanStack Query 5. CDK v2 for the key stack, the CloudFront
behaviour and the WAF. No new third-party package.
**Storage**: none new. No table and no migration.
**Testing**: vitest unit and integration, React Testing Library, LOCAL e2e against Postgres, Playwright, Maestro, a
manual k6 scenario, and named production-only checks.
**Target Platform**: recipe, food and identity on ECS Fargate behind the shared ALB, and in production behind
CloudFront. Web on Vercel. iOS and Android.
**Project Type**: three services, two clients, shared packages and infra, in the monorepo.
**Performance Goals**: a cached page under 1 s p95. An uncached public read under 2 s p95, food included (NFR-006).
**Constraints**: the same bytes with and without a credential. No cookie. No cache older than 5 minutes. No private food
can appear. Fail closed on every unknown reading. No new ALB rule, no new VPC Lambda, no interface endpoint.
**Scale/Scope**: about 60 new or changed files across 13 packages (see Build Order). One ADR.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #    | Principle                         | Status | Notes                                                                                                                              |
| ---- | --------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| I    | Correctness and Type Safety       | Pass   | Readings, forms, standing and the gate's `Screen` are discriminated unions. `isRecipeViewableBy` takes a `Viewer` union            |
| II   | Readability and JSDoc             | Pass   | Each new module carries JSDoc and the `@pattern` tags in the register below                                                        |
| III  | Code Organization and Imports     | Pass   | New files sit in their domain folders. Names are camelCase or NestJS `name.type.ts`, checked against `docs/CODING_STANDARDS.md` §1 |
| IV   | Testing Discipline                | Pass   | Every unit lists its failing tests first, per tier. Production-only checks are named, not skipped                                  |
| V    | Monorepo and Workspace Governance | Pass   | No new workspace. Contracts are copied by `contract:generate`. Identity declares `jose`                                            |
| VI   | Formatting and Tooling            | Pass   | Shared configs, unchanged                                                                                                          |
| VII  | Accessibility and UX Consistency  | Pass   | `staff-ux-engineer` SPECIFY before UI. WCAG 2.2 AA, 320 px, house type scale and tokens                                            |
| VIII | Cross-Platform Parity             | Pass   | Web page and native public view ship together, with the DESIGN §3.6 dispositions                                                   |
| IX   | Design Patterns, Seams, Modules   | Pass   | Pattern register below. No mode prop on `RecipeDetailView`: the orchestration layer picks the public render component              |

Re-checked after Phase 1: unchanged. Two deviations are argued under Complexity Tracking.

## Decisions

Each is argued in [research.md](research.md), with the rejected alternatives and the flip condition.

| #   | Decision                                                                                                  | Research | One-way door?                      |
| --- | --------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------- |
| D1  | Public endpoint, always `no-store`. The web page is the one cache: classic ISR, forgotten within 300 s    | R1, R5   | No                                 |
| D2  | recipe-signed EdDSA token. Two food internal routes that copy their public twins. No hold                 | R2, R13  | Yes: issuer, audiences, key        |
| D3  | `openToWeb` = `contentOpen` and `authorActive`, with required readings. Ship dark (I0). SQL form deferred | R3       | No                                 |
| D4  | Author standing from identity on each origin miss, behind a port, fail closed                             | R4       | Yes: the internal route's contract |
| D5  | Per-address limits at Vercel and at a WAF on the recipe distribution. `@SkipThrottle` at the origin       | R6       | No                                 |
| D6  | No browser calls the endpoint. CORS unchanged                                                             | R7       | No                                 |
| D7  | `/recipe/{id}/{slug}`, no locale. Association files for `/recipe/*` only. Native gate state               | R8       | Yes: the address and the files     |
| D8  | Signed-out actions are "Save a copy" and "Rate" only. The return goes to the in-app address with `?then=` | R8, R9   | No                                 |
| D9  | Direction A, with the facts card's method card                                                            | R10      | No                                 |
| D10 | `noindex` until 021 section C                                                                             | R11      | No                                 |
| D11 | Thumbnails only on public forms                                                                           | R12      | No                                 |

**Where the plan departs from the spec or from 021**, each recorded in the spec too:

- **SQL form deferred** (spec FR-001). 003A reads one id. The first set reader adds the SQL form with an equality test.
- **A failed read renders, it never throws** (spec FR-008). This is stricter than `021-FR-065`, which allows a stale
  copy for up to an hour.
- **The API is never cached** (spec FR-013). Only the page is.
- **Erased authors stay closed** until the owner rules on donated recipes (spec FR-012, Q8).

## One-way doors

- **The public address** `https://commise.app/recipe/{id}/{slug}`. Shared links and search results hold it. Adding a
  locale later means a redirect for every shared link.
- **The association files**: the path set, team id, bundle id, package name and signing fingerprints. Apple caches the
  file at its CDN.
- **The `PublicRecipeView` wire contract**, parsed by native builds in the wild.
- **The token contracts**: the issuer and the two audiences, the algorithm, the key, and the three internal routes.
- **The cache key**: the path alone.
- **The CloudFront behaviour path and the WAF association** on the recipe distribution.

Two-way doors: the cache durations, the rate thresholds, I0 against I1, `noindex` until 021 section C, and the
rate-exemption header (U8).

## Pattern Register

- **Specification**: `openToWeb`, a composite AND of `contentOpen` and `authorActive`. Pure. It takes the hold reading as
  a required input. `isRecipeViewableBy(recipe, viewer: Viewer)`, where `Viewer = { kind: 'anonymous' } | { kind:
'user'; id }`, so every call site must say which it is.
- **Value Object**: the readings (`HoldReading`, `RightsLabelReading`, `LicenceReading`, `ModerationReading`,
  `AuthorStanding`), and `PublicRecipePath` with its one parser, shared by web and native.
- **Null Object**: `ModerationReading` only, fixed at `none`, because recipe-service has no restriction table and the
  closed state cannot happen yet. Every other unbuilt reading is `unknown`, never a Null Object.
- **Projection / DTO**: `publicRecipeProjection`, one per form. The Specification decides the form, and the projection
  decides the fields. They are tested apart.
- **Strategy**: `FoodCredential = CallerToken | PublicReaderCredential`, inside the existing food **Gateway**, which stays
  the **Anti-Corruption Layer** over food's wire shape.
- **Ports and Adapters**: `AuthorStandingPort`, with the identity gateway as today's adapter. A push-fed read model can
  replace the adapter later with no change to the port.
- **State**: the native auth gate's `Screen` union gains `{ kind: 'publicRecipe'; recipeId }`. Its render map stays an
  exhaustive switch (**Visitor**).
- **Proxy**: `React.lazy` loads the signed-in layer on the web page only when a Clerk cookie already exists.
- **Visitor**: an exhaustive switch over `form` on web and native. An unknown `form` renders not available.
- **Adapter**: `publicDetailModel` turns a `PublicRecipeView` into the props of the existing detail sections, so the
  render leaves are reused, not forked.
- **Intent already satisfied, add nothing**: `memoryCookMarksBackend()` already exists for the cook-marks port. ISR is
  the cache-aside. TanStack Query caches the native fetch. `PASSTHROUGH_PATH_PATTERNS` stays the one authority for the
  edge's global passthrough. Food's existing request and response schemas serve the internal twins.
- **Preserved**: the `ApiExceptionFilter` error envelope, the `recipeDetail.assembler.ts` Assembler behind a Facade,
  ADR-0040's hold for every signed-in answer, and the single sign-out command (ADR-0009).

## Project Structure

### Documentation (this feature)

```text
specs/003A-signed-out-reading/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── publicRecipeRead.md
│   ├── publicReaderToken.md
│   └── publicAddressAndAppLinks.md
└── checklists/requirements.md
```

### Source Code

New (N) and changed (C) files, by package. Names are checked against `docs/CODING_STANDARDS.md` §1.

```text
packages/services/recipe-service/
  src/publicRead/domain/openToWebInputs.ts            N  reading types
  src/publicRead/domain/openToWebSpecification.ts     N  contentOpen, authorActive, openToWeb
  src/publicRead/domain/pendingReadings.ts            N  I0 producers: unknown, and moderation fixed at none
  src/publicRead/domain/authorStandingPort.ts         N
  src/publicRead/domain/publicRecipeProjection.ts     N  pure projection per form
  src/publicRead/authorStanding.gateway.ts            N  identity adapter, fails closed
  src/publicRead/publicReaderToken.signer.ts          N
  src/publicRead/dal/publicRecipes.dal.ts             N  one row by id, thumbnails only
  src/publicRead/publicRecipes.service.ts             N  orchestration
  src/publicRead/publicRecipes.controller.ts          N
  src/publicRead/publicRecipes.schema.ts              N  the wire contract
  src/publicRead/publicRead.module.ts                 N
  src/ingredients/foodCredential.ts                   N  Strategy
  src/ingredients/FoodServiceClients.factory.ts       C
  src/ingredients/foodRefs.gateway.ts                 C
  src/ingredients/foodNutrition.gateway.ts            C
  src/recipes/domain/recipeVisibility.ts              C  Viewer union, and every call site
  src/app.module.ts                                   C  module and the one exclusion
  src/config/env.schema.ts                            C  signing key, key id, identity URL
  infra/lib/RecipeServiceStack.ts                     C  secret and identity URL
packages/services/food-service/
  src/foods/publicRead.controller.ts                  N  two internal routes
  src/auth/publicReader.guard.ts                      N
  src/auth/publicReaderAuth.service.ts                N  current and previous key id
  src/foods/domain/testPickedRootPolicy.ts            C  publicReader audience, no hold
  src/foods/foods.module.ts, src/config/env.schema.ts C
  infra/lib/FoodServiceStack.ts                       C  public key from SSM
packages/services/identity/
  src/accounts/authorStanding.controller.ts           N
  src/accounts/authorStanding.service.ts              N
  src/accounts/authorStanding.schema.ts               N
  src/auth/guards/publicReader.guard.ts               N
  src/auth/publicReaderAuth.service.ts                N
  src/auth/middleware/auth.middleware.ts              C  exempts exactly the standing path
  package.json                                        C  declares jose
packages/shared/identity-db/src/dao/user.dao.ts       C  standingsOf(ids)
packages/shared/identity-core/src/authorStandingToken.ts  N
packages/shared/recipe-core/src/publicReaderToken.ts  N
packages/shared/edge-verifier/src/edgeRoutes.ts       C  PUBLIC_READ_PATH_PATTERNS, recipe only
packages/clients/food-service/src/client.ts           C  apiPrefix
packages/clients/recipe-service/src/publicRecipes.ts  N  plus queries.ts and hooks.ts (C)
packages/schemas/recipe, packages/schemas/identity    C  regenerated copies
packages/infra/global/
  lib/platform/PublicReaderKeyStack.ts                N
  src/publicReaderSigningKey/handler.ts               N  Ed25519 provisioner, not in the VPC
  lib/platform/EdgeStack.ts                           C  recipe-only behaviour, WAF web ACL
packages/apps/commise/features/recipes/src/public/
  publicRecipePath.ts                                 N  Value Object, shared by web and native
  publicReturnAction.ts                               N  saveCopy | rate
  publicDetailModel.ts                                N  Adapter to the detail sections
  PublicRecipeBody.tsx, .native.tsx                   N
  PublicNotAvailable.tsx, .native.tsx                 N
  PublicSignUpSheet.tsx, .native.tsx                  N
packages/apps/commise/i18n                            C  publicRecipe.* keys
packages/apps/commise/web/
  src/app/recipe/layout.tsx                           N  root layout, no ClerkProvider
  src/app/recipe/[id]/[[...slug]]/page.tsx            N  ISR, no searchParams, cookies or headers
  src/app/recipe/[id]/[[...slug]]/not-found.tsx       N
  src/app/.well-known/apple-app-site-association/route.ts  N
  src/app/.well-known/assetlinks.json/route.ts        N
  src/lib/appLinks.ts                                 N  pure
  src/lib/publicRecipeLoader.ts                       N
  src/components/publicRecipe/SignedInLayer.tsx       N  React.lazy
  src/middleware.ts                                   C  excludes /recipe/ and /.well-known/
  next.config.ts                                      C  expireTime 300, X-Robots-Tag noindex on /recipe/*
  src/lib/requireSignedIn.ts, src/app/[locale]/recipes/[id]/page.tsx  C  signed-out visitor to /recipe/{id}
packages/apps/commise/mobile/
  src/components/AuthGate.tsx                         C  publicRecipe state
  src/linking/publicLinkSource.ts                     N  @sideEffect, subscribes to Linking
  src/navigation/linkingConfig.ts                     N
  src/navigation/RootNavigator.tsx                    C  signed-in linking, pending-link hand-off
  src/screens/publicRecipe/PublicRecipeScreen.tsx     N  orchestration
  app.config.ts                                       C  applinks and intent filter, production builds only
packages/tools/repoGuards/__tests__/
  publicReadNoCredential.test.ts                      N
  internalRouteGuards.test.ts                         N
```

**Structure Decision**: no new workspace. Each new file sits in the domain folder of the service or app that owns it.
The mobile `screens/` layout and the `features-recipes` export map were not checked by BLUEPRINT and are checked at the
start of U7.

## Build Order

Each unit is test-first (CLAUDE.md, TEST-FIRST IS LAW). Write the failing tests in every tier named, watch them fail,
then write the code. Each unit leaves the tree green and the feature dark.

| Unit                 | Content                                                                                                  | Failing tests first                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **U0**               | Reading types, `pendingReadings`, the `openToWeb` composite, and the `Viewer` union with every call site | **Unit**: every `021-FR-002` rule closes on its own. Each `unknown` closes. I0 gives `notAvailable` for every row. `contentOpen` runs before `authorActive`. A type test (`expectTypeOf`) shows that dropping an input fails to compile. **Integration**: the existing visibility call sites keep their behaviour                                                                                                                                                                                                                                                                                                                                |
| **U1**               | Token contracts, `PublicReaderKeyStack` and its provisioner, the signer                                  | **Unit**: claims built and parsed, the 120 s cap, `kid`. **Infra synth**: the secret is not in the template, the SSM outputs exist, the provisioner is not in the VPC                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **U2**               | Food internal routes and the `publicReader` audience                                                     | **Unit**: the verifier refuses a wrong `iss`, `aud`, `alg` or `sub`, an expired token, and a window over 120 s. `marksRealHold(publicReader)` is `false`. **Integration (mocked)**: a private food is `absent`. No hold is written. `no-store`. No `/v1` alias. **LOCAL e2e**: against Postgres, a test-picked root stays unheld after a public read                                                                                                                                                                                                                                                                                             |
| **U3**               | Identity standing route                                                                                  | **Unit**: the verifier, as U2. The status mapping is total. **Integration (mocked)**: an unknown id is `unknown`. More than 24 ids is `400`. The middleware exempts exactly this path. **LOCAL e2e**: the DAO returns each of the four statuses                                                                                                                                                                                                                                                                                                                                                                                                  |
| **U4**               | The recipe public endpoint                                                                               | **Unit**: each form's allowlist, failing on any forbidden key. Thumbnails only. No remote call when `contentOpen` closes. Identity or food down gives `503`. **Integration**: the same bytes with and without `Authorization`. One `404` for malformed, private, draft, deleted and missing ids. `no-store`. No analytics. Signer-to-verifier round trips with the real food and identity verifiers. **LOCAL e2e**: real row reads. **DEPLOYED e2e** (`publicRecipe.e2e.test.ts`): every seeded recipe answers `404`, a forged or missing internal token answers `401`, and `/v1/public/…` answers `404`. **k6** (manual): `publicRecipeRead.js` |
| **U5**               | CloudFront behaviour and WAF (production)                                                                | **Synth**: the guards under "Guards". **Production only**: a run past the limit gets `429` with `Retry-After`. The same bytes with and without a token                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **U6**               | Web public page, association files, middleware, the signed-out redirect from the in-app address          | **Component**: every FR-023 state from fixtures, including `full` and `factsCard`, which I0 cannot reach. **Page test**: the page reads no `searchParams`, cookies or headers. **Unit**: `appLinks.ts`, `publicRecipePath.ts`. **Playwright** (`publicRecipe.spec.ts`, on a preview): one `404` page, no `Set-Cookie`, an empty cookie jar, `Cache-Control: s-maxage=60, stale-while-revalidate=240`, `noindex`, and the association files `200` JSON with no redirect where configured                                                                                                                                                          |
| **U7**               | Native gate, public view and links                                                                       | **Component**: the gate's transitions and every screen state. **Unit**: the parser shared with web. **Maestro**: `publicRecipeLinkSignedOut.yaml` (link, not-available view, close, sign-in) and `publicRecipeLinkSignedIn.yaml`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **U8** (removable)   | The Vercel rate-exemption header (spec Q4)                                                               | **Unit and synth**: one environment value, one header in `publicRecipeLoader`, one WAF scope-down statement. Removing it is three lines                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **U9**               | Sign-up sheet and return                                                                                 | **Component**: the sheet's contents, its focus order and closing. The confirmation is offered once. A forged `then` does nothing. **Unit**: `publicReturnAction.ts`. **Playwright and Maestro**: the return flow from the in-app address, signed in, with `?then=saveCopy`                                                                                                                                                                                                                                                                                                                                                                       |
| **U10**              | Measurement (`021-FR-080` to `021-FR-083`)                                                               | **Unit**: the referrer class is a closed set. The share mark's presence is read without loosening `analyticsRedaction.ts`. **Playwright**: a page view writes nothing to cookies or storage                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **U-I1** (on ruling) | Facts-only form for editor-written recipes (spec Q1)                                                     | A code change and a new ADR, never a switch. **Unit**: `user_created` gives `factsCard` with no photo or prose, and every other source stays closed. Playwright and Maestro open-page flows become possible                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**What the dark build reaches.** `contentOpen` closes before any remote call, so U2, U3 and the signing key carry no
production traffic until 016 and 020 ship (or until I1). Their positive path is proven by LOCAL e2e and the
cross-package integration tests. Their deployed checks are negative only. A positive deployed test is owed on the day
the first gate opens. e2e uses no fakes, so Playwright and Maestro cannot show an open page while the feature is dark.

## Guards

| Guard                                               | Change                                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recipe-service/src/__tests__/app.module.test.ts`   | The exact set of `AuthMiddleware` exclusions gains the public GET. Its doc comment says why                                                       |
| `edgeRoutes.test.ts` (edge-verifier)                | `PUBLIC_READ_PATH_PATTERNS` is recipe only. The handler's global list does not change                                                             |
| `EdgeStack.test.ts`                                 | The behaviour exists only on recipe, with no function and `CACHING_DISABLED`. It forwards no `Authorization`, cookie or query. WAF on recipe only |
| `edgeSharedCacheRoutes.test.ts`                     | Pins that the public path is not a shared-cache path, so adding a cache later must change this test on purpose                                    |
| `bearerOnlyPrecondition.test.ts`                    | No change. Stays green with no waiver                                                                                                             |
| `natEgressConsumers.test.ts`, `dbUserGrantRegister` | No change. The provisioner is not in the VPC, and there is no new database grant                                                                  |
| `imageRuntimeDependencies.test.ts`                  | Identity declares `jose`                                                                                                                          |
| New: `publicReadNoCredential.test.ts`               | An AST check over `recipe-service/src/publicRead/**`: no `authorization`, `CallerBearerToken`, `CurrentPrincipal`, principal or cookie read       |
| New: `internalRouteGuards.test.ts`                  | Every `api/v1/internal/*` controller in recipe, food and identity carries a token guard                                                           |
| Web `tests/middleware.test.ts`                      | `/recipe/` and `/.well-known/` are never locale-redirected or wrapped by Clerk. `/recipes/` still is                                              |
| Mobile `AuthGate.native.test.tsx`                   | Still no landing member. `publicRecipe` exists only from a link                                                                                   |

## The ADR owed

One new ADR at the next free number (0089 when this plan was written): "Signed-out recipe reads". ADR-0020 and
ADR-0040 are not edited, because `adrHygiene` forbids editing an accepted ADR. The new ADR amends them.

1. **Context**: `021-FR-106`, ADR-0020's URL-only rule, and ADR-0081.
2. **Decision**:
    - shape A-prime: classic ISR with `expireTime` as the bound, and an API that is always `no-store`;
    - a recipe-signed public-reader token, the food internal routes, and no hold (amends ADR-0040);
    - author standing as a synchronous identity read behind a port, with ADR-0081's reasoning separated from this case;
    - a recipe-only passthrough and a WAF (amends ADR-0020 §1 and §2);
    - the fail-closed readings of the dark build;
    - the removable rate-exemption header, which grants no read and so is not `021-FR-106`'s credential.
3. **Alternatives**: CDN snapshots, a public food read, Clerk M2M, names stored at publish (and from the version
   snapshot), `cacheComponents`, and a status read model.
4. **Consequences**: previews have no WAF. The SQL form is owed. The push-fed standing is owed with IndexNow. The full
   form needs a stripped full-size image.

## Test Matrix

| Tier         | Where it runs            | What it proves in 003A                                                                |
| ------------ | ------------------------ | ------------------------------------------------------------------------------------- |
| Unit         | CI                       | The rule, the readings, the projections, the parsers, the token verifiers, the guards |
| Integration  | CI (mocked dependencies) | Each route's closed cases, failed reads, no credential read, no hold written          |
| Component    | CI                       | Every FR-023 state on web and native, with readings set by the test                   |
| LOCAL e2e    | Developer machine only   | The food read and the standing read against real data, and the full public read       |
| Playwright   | Selected by impact       | No cookie, the same bytes, `noindex`, `Cache-Control`, not available, the return flow |
| Maestro      | Selected by impact       | The link opens the public view signed out and the recipe screen signed in             |
| DEPLOYED e2e | Sandbox up, by hand      | The dark state on a real preview, and the internal routes refuse a forged token       |
| k6           | Manual dispatch only     | The public read under load, as a regression detector                                  |
| Production   | Once, after first deploy | CloudFront passthrough, WAF `429`, Vercel cache and limit, association file checks    |

No deployed tier can prove an open page while the feature is dark. That is stated, not hidden. A test-only way to open
a recipe on a deployed stage is refused, because it is also a way to open one in production.

## Risks

- **A stale page after an exit event.** Bounded by `expireTime: 300`. A failed refresh renders the unavailable state
  instead of throwing, so an outage cannot extend a stale copy. Vercel's handling of `expireTime` is checked by the
  Playwright header test on a preview and in production.
- **A food outage.** A full recipe shows each line's own words. A facts card shows the unavailable state.
- **An identity outage.** Every public read is unavailable until identity answers. Accepted: fail closed.
- **Scraping by id.** UUIDs and the per-address limits. The sitemap stays the only list.
- **A leaked signing key.** It reveals non-private food names and author standings by id. Rotate with the verifiers'
  two-key window.
- **A leaked exemption header.** It lifts the API limit only. The Vercel limit still applies.
- **A cookie on a signed-out visit.** The route has no Clerk provider and is outside the Clerk middleware. Playwright
  checks the cookie jar. It is assumed, not verified, that clerk-js sets a cookie when it loads for a signed-out
  visitor, which is why it never loads there.
- **Built and idle.** The food route, the identity route and the key carry no production traffic until a gate opens.
  Their deployed checks are negative only until then.

## Owed before build

- `staff-ux-engineer` SPECIFY for every FR-023 state, on phone, tablet and desktop, web and native, including the I0
  not-available and unavailable states.
- `cfo-1` prices the WAF, the Vercel Firewall rule and the rendering (`021-FR-066`).
- `ts-1` writes the tracking plan for U10.
- `sec-aud-1` reviews the tokens, the WAF and the cookie behaviour.
- Owner answers to the spec's open questions. Each has a default, so none blocks the dark build.

## Open questions for the owner

See the spec, "Open questions for the owner" (Q1 to Q8).

## Complexity Tracking

| Deviation                                                  | Why needed                                                          | Simpler alternative rejected because                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| recipe-service becomes a token signer, not only a verifier | A public read has no user credential to forward to food or identity | A public food read opens the catalog to anyone. Clerk M2M adds a secret and a dependency |
| Two edge rate limits (Vercel and WAF) instead of one       | Pages and the API are served by different systems                   | One limit leaves either native clients or page loads unlimited                           |
