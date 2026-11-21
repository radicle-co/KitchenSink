# Implementation Plan: Signed-out Reading of Public Recipes

**Branch**: `docs/im-spec003a` (single-branch directive. `setup-plan.sh` refuses a feature id that is not all digits,
so the template was copied by hand. `.specify/feature.json` pointed at this directory only inside this worktree, and
was put back before the commit.) | **Date**: 2026-11-09 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/003A-signed-out-reading/spec.md`

**Owner answers**: all eight of the spec's questions were answered on 2026-11-09 and are applied here (spec,
Clarifications, Session 2026-11-09).

**Staff runs**: `staff-architect` PLANNING then BLUEPRINT, and `staff-ux-engineer` DISCOVER then DESIGN, all on
2026-11-09. `staff-ux-engineer` SPECIFY is owed before any UI is built, and `staff-architect` REVIEW per unit after.

## Summary

Build the whole signed-out read path for one public recipe, on web and native, and ship it dark.

- recipe-service gains `GET /api/v1/public/{locale}/recipes/{id}`, always `no-store` (owner 2026-11-20: the locale is a
  path segment, because the web forwards no query). It runs outside the Clerk middleware and
  the per-user throttle. One pure Specification, `openToWeb`, decides the form. Its two halves are `contentOpen`, over
  the row and every content reading, and `authorActive`, over the author standing. Every input is a required, typed
  reading.
- For food names and nutrition, recipe-service signs a short-lived EdDSA token for two new food internal routes that
  copy the contracts of their public twins. Food answers as `svc_public-reader`. That principal sees no private food
  and holds no root.
- For the author's standing, recipe-service asks a new identity internal route with the same token type and its own
  audience. No answer is `unknown`, and `unknown` is closed.
- The web renders `https://commise.app/{locale}/recipe/{id}/{slug}` on the server with no ISR (owner 2026-11-20). The
  page sends `Vercel-CDN-Cache-Control: s-maxage=60, stale-while-revalidate=240` from `next.config` with no `Vary: Accept-Language`, and the CDN caches it under the cache key (FR-015). The middleware 308-strips every parameter except one well-formed share mark, and `_rsc` only with the `RSC: 1` header. The route has its own root layout with no Clerk provider, so it sets no cookie. The page's own
  words follow the locale in the address. The native app opens the same link as a public view when signed out.
- Rate limits sit at the edge of both systems: Vercel Firewall for pages (held as code, unit U11), an AWS WAF web ACL on the recipe distribution
  for the API.
- The readings that 016 and 020 own return `unknown`, so `contentOpen` closes every recipe before any call to food or
  identity. Every public address answers not available until 016 and 020 ship. No 003A code changes when they do.

## Technical Context

**Language/Version**: TypeScript (strict), Node 24.x.
**Primary Dependencies**: NestJS 11 in recipe, food and identity. `@nestjs/throttler` for `@SkipThrottle`. `jose` for
EdDSA, already used by recipe and food, and newly declared by identity. zod. Next.js 16.3 (server render, route handlers).
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

| #   | Decision                                                                                                                                                                                                                                                                    | Research | One-way door?                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------- |
| D1  | Public endpoint, always `no-store`. The web page is the one cache: `Vercel-CDN-Cache-Control` (`s-maxage`) at the CDN with no ISR and no `Vary: Accept-Language`, forgotten within 300 s (owner 2026-11-20)                                                                 | R1, R5   | No                                            |
| D2  | recipe-signed EdDSA token. Two food internal routes that copy their public twins. No hold                                                                                                                                                                                   | R2, R13  | Yes: issuer, audiences, key                   |
| D3  | `openToWeb` = `contentOpen` and `authorActive`, with required readings. Ship dark until 016 and 020 ship (owner, Q1). SQL form deferred                                                                                                                                     | R3       | No                                            |
| D4  | Author standing from identity on each origin miss, behind a port, fail closed                                                                                                                                                                                               | R4       | Yes: the internal route's contract            |
| D5  | Per-address limits at Vercel and at a WAF on the recipe distribution. `@SkipThrottle` at the origin                                                                                                                                                                         | R6       | No                                            |
| D6  | No browser calls the endpoint. CORS unchanged                                                                                                                                                                                                                               | R7       | No                                            |
| D7  | `/{locale}/recipe/{id}/{slug}`, locale in the path (owner 2026-11-20, reverses Q3). Page words in that locale, cache key per FR-015, no `Vary: Accept-Language`. Two addresses kept (in-app and public). Association files for `/{locale}/recipe/*` only. Native gate state | R8       | Yes: the address, the cache key and the files |
| D8  | Signed-out actions are "Save" to a collection, "Save a copy" and "Rate", the same as signed in (owner, Q5). The return goes to the in-app address with `?then=`                                                                                                             | R8, R9   | No                                            |
| D9  | Direction A. The facts card's method card is withdrawn (2026-11-15, ADR-0093)                                                                                                                                                                                               | R10      | No                                            |
| D10 | `noindex` until 021 section C                                                                                                                                                                                                                                               | R11      | No                                            |
| D11 | Thumbnails only on public forms                                                                                                                                                                                                                                             | R12      | No                                            |

**Where the plan departs from the spec or from 021**, each recorded in the spec too:

- **SQL form deferred** (spec FR-001). 003A reads one id. The first set reader adds the SQL form with an equality test.
- **A failed read renders, it never throws** (spec FR-008). This is stricter than `021-FR-065`, which allows a stale
  copy for up to an hour.
- **The API is never cached** (spec FR-013). Only the page is.
- **A recipe left public at erasure stays open, with no author name** (spec FR-012, owner ruling Q8). `021-FR-002`
  rule 7 is amended for that case.

## One-way doors

- **The public address** `https://commise.app/{locale}/recipe/{id}/{slug}` (owner 2026-11-20). Shared links and search
  results hold it. A new locale adds addresses and breaks none.
- **The public read route** `GET /api/v1/public/{locale}/recipes/{id}`. The locale is a path segment, and native builds
  call it (owner 2026-11-20, 003B C-31).
- **The association files**: the path set, team id, bundle id, package name and signing fingerprints. Apple caches the
  file at its CDN.
- **The `PublicRecipeView` wire contract**, parsed by native builds in the wild.
- **The token contracts**: the issuer and the two audiences, the algorithm, the key, and the three internal routes.
- **The cache key**: the rule in FR-015 (owner 2026-11-20).
- **The CloudFront behaviour path and the WAF association** on the recipe distribution.

Two-way doors: the cache durations, the rate thresholds, and `noindex` until 021 section C (which `021-FR-020a` owes
the removal of).

## Pattern Register

- **Specification**: `openToWeb`, a composite AND of `contentOpen` and `authorActive`. Pure. It takes the hold reading as
  a required input. `isRecipeViewableBy(recipe, viewer: Viewer)`, where `Viewer = { kind: 'anonymous' } | { kind: 'user';
id: string }`, so every call site must say which it is. U0 declares no market field. 003B T383 later adds a required
  `shown: PublicVersionsShown` to both arms (C-31).
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
- **Intent already satisfied, add nothing**: `memoryCookMarksBackend()` already exists for the cook-marks port. The CDN's
  `Vercel-CDN-Cache-Control` is the cache-aside (no ISR, owner 2026-11-20). TanStack Query caches the native fetch. `PASSTHROUGH_PATH_PATTERNS` stays the one authority for the
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
  src/publicRead/domain/pendingReadings.ts            N  dark-build producers: unknown, and moderation fixed at none
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
  publicReturnAction.ts                               N  save | saveCopy | rate
  publicDetailModel.ts                                N  Adapter to the detail sections
  PublicRecipeBody.tsx, .native.tsx                   N
  PublicNotAvailable.tsx, .native.tsx                 N
  PublicSignUpSheet.tsx, .native.tsx                  N
packages/apps/commise/i18n                            C  publicRecipe.* keys
packages/apps/commise/web/
  src/app/[locale]/recipe/[id]/[[...slug]]/page.tsx   N  server render, no ISR, no searchParams, cookies or headers; layout with no ClerkProvider, html lang = locale
  src/app/[locale]/recipe/[id]/[[...slug]]/not-found.tsx  N
  src/app/.well-known/apple-app-site-association/route.ts  N
  src/app/.well-known/assetlinks.json/route.ts        N
  src/lib/appLinks.ts                                 N  pure
  src/lib/publicRecipeLoader.ts                       N
  src/components/publicRecipe/SignedInLayer.tsx       N  React.lazy
  src/middleware.ts                                   C  /{locale}/recipe/*: never Clerk; a locale-less address redirects; a bare en has its locale replaced. /.well-known/ excluded
  next.config.ts                                      C  Vercel-CDN-Cache-Control s-maxage 60 with stale-while-revalidate 240 and X-Robots-Tag noindex on /{locale}/recipe/*, no Vary: Accept-Language
  firewall/publicPageRateRule.ts                      N  pure: the page rate rule as data; `firewall:apply` and `firewall:check` (drift) are its scripts (U11)
  src/app/[locale]/recipes/[id]/page.tsx             C  signed-out: public read 200 → /{locale}/recipe/{id}/{slug}, else sign-in
  src/app/appDocument.tsx                             C  a document shell variant without ClerkProvider
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
start of U7. Checked after BLUEPRINT: the web app has no `app/layout.tsx`. `[locale]/layout.tsx` is a root layout that
mounts `ClerkProvider` through `appDocument.tsx`. So the public route can be a second root layout with no Clerk, and
no route group is needed. `requireSignedIn.ts` does not change. Only the recipe detail page changes (spec FR-027).

## Build Order

Each unit is test-first (CLAUDE.md, TEST-FIRST IS LAW). Write the failing tests in every tier named, watch them fail,
then write the code. Each unit leaves the tree green and the feature dark.

| Unit    | Content                                                                                                          | Failing tests first                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **U0**  | Reading types, `pendingReadings`, the `openToWeb` composite, and the `Viewer` union with every call site         | **Unit**: every `021-FR-002` rule closes on its own. Each `unknown` closes. The dark build gives `notAvailable` for every row. An `erased` standing passes `authorActive` and `suspended`, `closed` and `unknown` fail it. `contentOpen` runs before `authorActive`. A type test (`expectTypeOf`) shows that dropping an input fails to compile. **Integration**: the existing visibility call sites keep their behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **U1**  | Token contracts, `PublicReaderKeyStack` and its provisioner, the signer                                          | **Unit**: claims built and parsed, the 120 s cap, `kid`. **Infra synth**: the secret is not in the template, the SSM outputs exist, the provisioner is not in the VPC                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **U2**  | Food internal routes and the `publicReader` audience                                                             | **Unit**: the verifier refuses a wrong `iss`, `aud`, `alg` or `sub`, an expired token, and a window over 120 s. `marksRealHold(publicReader)` is `false`. **Integration (mocked)**: a private food is `absent`. No hold is written. `no-store`. No `/v1` alias. **LOCAL e2e**: against Postgres, a test-picked root stays unheld after a public read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **U3**  | Identity standing route                                                                                          | **Unit**: the verifier, as U2. The status mapping is total. **Integration (mocked)**: an unknown id is `unknown`. More than 24 ids is `400`. The middleware exempts exactly this path. **LOCAL e2e**: the DAO returns each of the four statuses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **U4**  | The recipe public endpoint                                                                                       | Needs 003B T389 (`SHIPPED_LOCALES` in recipe-core). **Unit**: each form's allowlist, failing on any forbidden key. Thumbnails only. No remote call when `contentOpen` closes. Identity or food down gives `503`. A recipe whose author is `erased` projects no author and no pseudonym. **Integration**: the same bytes with and without `Authorization`. One `404` for malformed, private, draft, deleted and missing ids. `no-store`. The route is `GET /api/v1/public/{locale}/recipes/{id}`, with the locale as a path segment. The address without a locale answers `404`. A locale that is not shipped or is malformed answers the one `404` body. No query string or header changes the answer. No analytics. Signer-to-verifier round trips with the real food and identity verifiers. **LOCAL e2e**: real row reads. **DEPLOYED e2e** (`publicRecipe.e2e.test.ts`): every seeded recipe answers `404`, a forged or missing internal token answers `401`, and `/v1/public/…` answers `404`. **k6** (manual): `publicRecipeRead.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **U5**  | CloudFront behaviour and WAF (production)                                                                        | **Synth**: the guards under "Guards". **Production only**: a run past the limit gets `429` with `Retry-After`. The same bytes with and without a token                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **U6**  | Web public page, locale redirects, association files, middleware, the open-only redirect from the in-app address | Needs 003B T389, which ships `en-US`. **Component**: every FR-023 state from fixtures, including `full`, which the dark build cannot reach. **Page test**: the page reads no `searchParams`, cookies or headers. In a pseudo build the page calls the API with `DEFAULT_ROUTE_LOCALE`. **Unit**: the `next.config` `headers()` entry for `/{locale}/recipe/*` carries `Vercel-CDN-Cache-Control: s-maxage=60, stale-while-revalidate=240` and `X-Robots-Tag: noindex`, and no `Cache-Control`; `appLinks.ts` and `publicRecipePath.ts`; the middleware 308-strips every query parameter except one well-formed share mark, keeps `_rsc` only with the `RSC: 1` header and strips it otherwise; and the middleware sends `/{locale}/recipe/*` to the page and never to Clerk, redirects a locale-less `/recipe/` address (the bare-`en` and no-match rules are T389's). **Playwright** (`publicRecipe.spec.ts`, on a preview): one `404` page, no `Set-Cookie`, an empty cookie jar, no `Vary: Accept-Language` header, `noindex`, two requests that differ only in the share mark return the same body, a repeat of the same share-marked URL is `x-vercel-cache: HIT` (the only cache assertion: the browser-visible `Cache-Control` carries no `s-maxage`), a URL with a random parameter redirects `308` to the bare address, the association files `200` JSON with no redirect where configured, and a signed-out visitor at the in-app address of a public recipe lands on sign-in, signs in, and sees the recipe (FR-027) |
| **U7**  | Native gate, public view and links                                                                               | Needs 003B T389 (mobile `resolveLocale`). **Component**: the gate's transitions and every screen state. **Unit**: the parser shared with web. A signed-out native read sends `en-US` in the path. **Maestro**: `publicRecipeLinkSignedOut.yaml` (link, not-available view, close, sign-in) and `publicRecipeLinkSignedIn.yaml`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **U8**  | The web server's rate-exemption header (owner ruling Q4)                                                         | **Unit and synth**: one secret in the web host's environment, one header in `publicRecipeLoader`, one WAF scope-down statement that matches the current and the previous value, so the secret rotates with no failed render. The runbook step: add the new value to the WAF rule, then the web host, then remove the old one. **Budget rule**: a WAF rule keyed on the exemption header, as one bucket, answers `429` past its ceiling; the page then shows the FR-016 try-again state; ADR-0062's alarm fires; and a synth test shows the exempt rule cannot stand without the budget rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **U9**  | Sign-up sheet and return                                                                                         | **Component**: the sheet's contents, its focus order and closing. The returned action is offered once. A forged `then` does nothing. **Unit**: `publicReturnAction.ts` (`save`, `saveCopy`, `rate`). **Playwright and Maestro**: the return flow from the in-app address, signed in, with `?then=save` (the app's normal save to a collection) and `?then=saveCopy`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **U10** | Measurement (`021-FR-080` to `021-FR-083`), web and native                                                       | **Unit**: the referrer class is a closed set. The share mark's presence is read without loosening `analyticsRedaction.ts`. **Playwright**: a page view writes nothing to cookies or storage. **Native**: unit and integration show the public view emits the same closed-set event and writes nothing to device storage. No Maestro flow, because measurement has no screen behaviour for a flow to see                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **U11** | The page rate rule as code (Vercel Firewall)                                                                     | **Unit** (first): `web/firewall/publicPageRateRule.ts` builds the rule for `/{locale}/recipe/*` (per-address key, ceiling, `429` with `Retry-After`, no cookie, no challenge), and the drift check fails when the live configuration differs. **Scripts**: `firewall:apply` writes it through the Vercel REST `PATCH /v1/security/firewall/config` (`vercel.json` cannot rate-limit), and `firewall:check` reports drift. **Production only**: the check passes against production after the first apply                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**What the dark build reaches.** `contentOpen` closes before any remote call, so U2, U3 and the signing key carry no
production traffic until 016 and 020 ship. Their positive path is proven by LOCAL e2e and the
cross-package integration tests. Their deployed checks are negative only. A positive deployed test is owed on the day
the first gate opens. e2e uses no fakes, so Playwright and Maestro cannot show an open page while the feature is dark.

## Guards

| Guard                                               | Change                                                                                                                                                                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recipe-service/src/__tests__/app.module.test.ts`   | The exact set of `AuthMiddleware` exclusions gains the public GET. Its doc comment says why                                                                                                                           |
| `edgeRoutes.test.ts` (edge-verifier)                | `PUBLIC_READ_PATH_PATTERNS` is recipe only. The handler's global list does not change                                                                                                                                 |
| `EdgeStack.test.ts`                                 | The behaviour exists only on recipe, with no function and `CACHING_DISABLED`. It forwards no `Authorization`, cookie, query or viewer-country header (C-31: the market comes from the URL locale). WAF on recipe only |
| `edgeSharedCacheRoutes.test.ts`                     | Pins that the public path is not a shared-cache path, so adding a cache later must change this test on purpose                                                                                                        |
| `bearerOnlyPrecondition.test.ts`                    | No change. Stays green with no waiver                                                                                                                                                                                 |
| `natEgressConsumers.test.ts`, `dbUserGrantRegister` | No change. The provisioner is not in the VPC, and there is no new database grant                                                                                                                                      |
| `imageRuntimeDependencies.test.ts`                  | Identity declares `jose`                                                                                                                                                                                              |
| New: `publicReadNoCredential.test.ts`               | An AST check over `recipe-service/src/publicRead/**`: no `authorization`, `CallerBearerToken`, `CurrentPrincipal`, principal or cookie read                                                                           |
| New: `internalRouteGuards.test.ts`                  | Every `api/v1/internal/*` controller in recipe, food and identity carries a token guard                                                                                                                               |
| Web `tests/middleware.test.ts`                      | `/{locale}/recipe/` is never wrapped by Clerk, a locale-less `/recipe/` redirects, and `/.well-known/` is never redirected. `/recipes/` still goes through Clerk                                                      |
| Mobile `AuthGate.native.test.tsx`                   | Still no landing member. `publicRecipe` exists only from a link                                                                                                                                                       |

## The ADR owed

One new ADR at the next free number (0089 when this plan was written): "Signed-out recipe reads". ADR-0020 and
ADR-0040 are not edited, because `adrHygiene` forbids editing an accepted ADR. The new ADR amends them.

1. **Context**: `021-FR-106`, ADR-0020's URL-only rule, and ADR-0081.
2. **Decision**:
    - shape A-prime: a CDN-cached server render (`Vercel-CDN-Cache-Control`, no ISR) as the bound, and an API that is always `no-store`;
    - a recipe-signed public-reader token, the food internal routes, and no hold (amends ADR-0040);
    - author standing as a synchronous identity read behind a port, with ADR-0081's reasoning separated from this case;
    - a recipe-only passthrough and a WAF (amends ADR-0020 §1 and §2);
    - the fail-closed readings of the dark build;
    - the rotated rate-exemption header (owner ruling Q4), which grants no read and so is not `021-FR-106`'s credential;
    - the locale in the address, the cache key (FR-015), and the read route `GET /api/v1/public/{locale}/recipes/{id}` (owner 2026-11-20, reverses Q3, amends `021-FR-062`);
    - an `erased` author standing opens a recipe left public at erasure, shown with no author (owner ruling Q8).
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
| Web only     | By nature                | Link previews (US7) and the association files exist only on the web                   |
| DEPLOYED e2e | Sandbox up, by hand      | The dark state on a real preview, and the internal routes refuse a forged token       |
| k6           | Manual dispatch only     | The public read under load, as a regression detector                                  |
| Production   | Once, after first deploy | CloudFront passthrough, WAF `429`, Vercel cache and limit, association file checks    |

No deployed tier can prove an open page while the feature is dark. That is stated, not hidden. A test-only way to open
a recipe on a deployed stage is refused, because it is also a way to open one in production.

## Risks

- **A stale page after an exit event.** Bounded by `s-maxage=60` in `Vercel-CDN-Cache-Control` plus `stale-while-revalidate=240`, which is 300 s. A
  failed render shows the unavailable state instead of throwing, so an outage cannot extend a stale copy. The CDN's
  handling of the header is checked by the `headers()` unit test of U6 and by a Playwright `x-vercel-cache: HIT` check on a preview and in production. The cache life stays unproven until that production check runs.
- **A food outage.** A full recipe shows each line's own words.
- **An identity outage.** Every public read is unavailable until identity answers. Accepted: fail closed.
- **Scraping by id.** UUIDs and the per-address limits. The sitemap stays the only list.
- **A leaked signing key.** It reveals non-private food names and author standings by id. Rotate with the verifiers'
  two-key window.
- **A leaked exemption header.** It lifts the API limit only. The Vercel limit still applies, and the secret rotates.
- **A cache split by language.** The key is the one FR-015 states, and the locale in the path is the only language input
  to it.
- **Crawlers at a locale-less address.** They are redirected to the negotiated locale, else `en-US`. 021's search work
  owns the question once pages are indexable in more than one language (`021-FR-020a`).
- **A cookie on a signed-out visit.** The route has no Clerk provider and is outside the Clerk middleware. Playwright
  checks the cookie jar. It is assumed, not verified, that clerk-js sets a cookie when it loads for a signed-out
  visitor, which is why it never loads there.
- **Built and idle.** The food route, the identity route and the key carry no production traffic until a gate opens.
  Their deployed checks are negative only until then.

## Owed before build

- `staff-ux-engineer` SPECIFY for every FR-023 state, on phone, tablet and desktop, web and native, including the
  not-available and unavailable states, and the comments list on the full page once comments ship (FR-025).
- `cfo-1` prices the WAF, the Vercel Firewall rule and the rendering (`021-FR-066`).
- `ts-1` writes the tracking plan for U10.
- `sec-aud-1` reviews the tokens, the WAF and the cookie behaviour.

## Open questions for the owner

None. The owner answered all eight on 2026-11-09 (spec, Clarifications).

## Complexity Tracking

| Deviation                                                  | Why needed                                                          | Simpler alternative rejected because                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| recipe-service becomes a token signer, not only a verifier | A public read has no user credential to forward to food or identity | A public food read opens the catalog to anyone. Clerk M2M adds a secret and a dependency |
| Two edge rate limits (Vercel and WAF) instead of one       | Pages and the API are served by different systems                   | One limit leaves either native clients or page loads unlimited                           |
