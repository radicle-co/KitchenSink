# Research: Signed-out Reading of Public Recipes

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-11-09

Phase 0 of the plan. Each entry gives the decision, the reason, and the alternatives that were rejected. The evidence
comes from the code on `docs/im-spec003a`, read on 2026-11-09 by the main session and by `staff-architect` (PLANNING,
then BLUEPRINT). `staff-ux-engineer` (DISCOVER, then DESIGN) supplied R9 and R10.

## What the code does today

These facts drive the decisions. Each was read in the code, not assumed.

- recipe-service runs the Clerk `AuthMiddleware` on every route except the four internal erasure routes
  (`src/app.module.ts`). `app.module.test.ts` pins that list as an exact set.
- The global `UserThrottlerGuard` keys a caller with no principal on `ip:<address>`. Behind the ALB and CloudFront that
  address is shared, so every signed-out reader shares one bucket (`common/throttle/userThrottler.guard.ts`).
- `GET /api/v1/recipes/:id` forwards the caller's bearer token to food, records `recipe_viewed` with an actor, and reads
  impact signals (`recipes/recipes.controller.ts`). A public read must do none of these.
- `isRecipeViewableBy(recipe, viewerId: string)` (`recipes/domain/recipeVisibility.ts`) cannot express an anonymous
  viewer, and has no hold.
- With no caller, `FoodRefsGateway.resolve` marks every ref unreachable (`ingredients/foodRefs.gateway.ts`, about line
  149), and the nutrition gateway reads only its own cache.
- Food's `POST /api/v1/foods/refs/resolve` is per caller, `private, no-store`, and calls `answered.hold` before and after
  the read (ADR-0040). A `svc_*` requester already sees every private food as absent. `marksRealHold` returns true for
  any audience that is not a test audience, `undefined` included (`testPickedRootPolicy.ts`).
- Food's `GET /api/v1/foods/nutrition` is caller-independent and edge-cached on URL and `Origin` (ADR-0020).
- The edge passes `OPTIONS`, `/health*`, `/api/v1/internal/*` and the `/v1` alias through without a Clerk check
  (`packages/shared/edge-verifier/src/edgeRoutes.ts`). It answers `401` to a tokenless call on any other path.
- A public, published recipe can hold no private food. `publicFoodsPolicy.ts` refuses the write, and migration 0064's
  trigger refuses it in the database.
- Suspension is a mark in each user's own signed token (ADR-0081). recipe-service never sees another user's mark.
- Not in code on any branch: 020's hold Specification, 016's rights label and licence acceptance, and the facts-card
  projection.
- Web: `/[locale]/recipes/[id]/page.tsx` is `force-dynamic` and calls `requireSignedIn`. `clerkMiddleware` wraps every
  matched path. The matcher does not exclude `.json` or a path with no extension, so today `/.well-known/*` is
  locale-redirected. Next is 16.3. `revalidateTag(tag, 'max')` serves stale content while it refreshes. Only
  `{ expire: 0 }` purges at once.
- Mobile: `AuthGate`'s `Screen` union is `login | signup | completeSignUp`. The navigator mounts only for a signed-in user.
  `app.config.ts` declares only `webcredentials:` for Clerk, with no `applinks:` and no Android intent filters.
- Collections: a free cook's collection is public by default, and a free cook cannot make it private
  (`collections/domain/collectionVisibilityPolicy.ts`).
- Cook marks write `sessionStorage` (`cookMarksBackend.ts`).

## R1. The shape of a signed-out read

**Decision**: a public, read-only endpoint in recipe-service, `GET /api/v1/public/recipes/{id}`, always answered
`no-store`. The web server renders the page from it with Next's classic incremental static regeneration (ISR):
`revalidate = 60` on the page, `generateStaticParams()` returning `[]`, and `expireTime: 300` in `next.config.ts`. Next
then sends `Cache-Control: s-maxage=60, stale-while-revalidate=240`, so the oldest copy anyone can be served is 300
seconds old, with no purge. The native app calls the endpoint directly. This is 021 FR-106 Option A with one cache layer
(the architect's "A-prime").

**Why ISR and not `'use cache'`.** `'use cache'` and `cacheLife` work only with `cacheComponents: true`, which is off in
`next.config.ts`. Turning it on changes the whole app: it removes `dynamic` and `revalidate` from 14 `force-dynamic`
pages and turns on navigation checks (Next 16.3 docs, `migrating-to-cache-components.md`). Its default `expire` is one
year, so the CDN would get a stale window of about a year (`cdn-caching.md`). That breaks FR-013. `expireTime` covers
the whole app, but this page is the app's only ISR page.

**Why a failed read renders and never throws.** When a refresh throws, Next keeps serving the last good page, for as
long as the failures last. That can keep a page up after an exit event. So a food or identity failure renders the
unavailable state as a normal page, which replaces the cached copy within 60 seconds (FR-008).

**Rationale**: one cache, and it forgets within 5 minutes by itself, so no purge has to succeed for an exit event to
show (FR-013). The rule runs at request time, so 020's "last approved version" works without pushing anything.

**Alternatives rejected**:

- **021 Option B, snapshots pushed to a CDN.** A missed delete leaves a page up for ever, which is the dangerous
  direction. It needs an outbox, a worker, a reconciliation sweep and an alarm, and a second source of truth.
- **Caching on the API too.** It needs an ordered purge (CloudFront first, then the web host) and a confirmation alarm.
  Without the order, the web host refreshes from a CloudFront copy that is not purged yet.
- **A URL-only cache on the recipe API.** ADR-0020 calls that a new decision. With one cache it is not needed.

**Flip condition**: render or API load that needs a cache life longer than 5 minutes. Then build the ordered purge with
`revalidateTag(tag, { expire: 0 })`. Never `'max'`, which serves the old page once more while it refreshes.

## R2. Food names and nutrition with no user credential

**Decision**: recipe-service signs a short-lived EdDSA token, and food answers it on a new internal route,
two new internal routes that copy the contracts of their public twins, `POST /api/v1/internal/foods/refs/resolve` and
`GET /api/v1/internal/foods/nutrition`. Food reads the token as the `svc_public-reader` principal, which sees catalog
and promoted foods only. recipe's gateways parse the answers unchanged. A new answer audience, `publicReader`, places no hold. The route sits under `/api/v1/internal/*`,
so the edge passes it through with no change.

**Rationale**: The capability is small: names and nutrition of foods that are not private. A leaked key reveals nothing
that is not already on a public recipe. Food already treats a `svc_*` requester as a stranger to every private food.
The token follows the erasure-token precedent (`recipe-core/src/serviceErasureToken.ts`): asymmetric, networkless,
pinned issuer, audience and algorithm, and a short life. 021 FR-106 rejected a machine credential on the web tier
because it puts broad read power next to the browser. This credential sits in recipe-service and grants no recipe read,
so that rejection does not reach it.

**The hold**: suppose a public read held the roots it names. Then any stranger who reads a test principal's public
recipe makes that root impossible to purge, which defeats ADR-0040. `publicReader` therefore places no hold. That is safe, because
any real cook who bound the root already holds it through their own signed-in answers.

**Alternatives rejected**:

- **A public, credential-free read on food.** It opens a new unauthenticated surface on food and makes the curated
  catalog readable by anyone, against `016-FR-030`. The owner ruled on 2026-11-09 (spec Q2) that catalog food
  names and nutrition are not public data, so this option stays rejected.
- **Clerk M2M.** The erasure token's argument against it (an ambient capability that cannot be bound to one target)
  does not apply to a read with no target. It loses on two practical counts: no M2M issuer is wired, and it adds a Clerk
  dependency and secret to recipe-service.
- **Store food names on the recipe at publish time.** Plan 002 R9 forbids storing food names in the recipe database. A
  variant that reads names from the version snapshot is allowed by R52, but the snapshot write is best-effort and can
  drop rows. A line saved during a food outage never gets its name.

## R3. The open-to-web rule while its inputs do not exist

**Decision**: one pure Specification, `evaluateOpenToWeb`, with an SQL form. Each input is a required, typed reading
(`open`, `closed` or `unknown`), and `unknown` is closed. The producers that 016 and 020 own return `unknown` until those
features ship. So the feature ships dark. The owner confirmed on 2026-11-09 that it stays dark until 016 and 020 ship
(spec Q1).

**Rationale**: It is the only state that keeps 021 FR-001 (the owner's 2026-11-03 ruling) without a waiver. Making each
input required means that a missing producer is a compile error, so no future change can open a recipe by forgetting
an input.

**Two kinds of missing input**: a fixed value is allowed only where the missing feature makes the closed state
impossible. One case remains: rule 8, restriction. recipe-service has no takedown or restriction table, so no recipe
can be restricted today, and the reading is fixed at `none` until 016's notice and action work ships. Author standing
is not such a case: suspension exists (ADR-0081), so it is a real reading (R4).

**The SQL form is deferred.** `021-FR-001` asks for an SQL form of the rule. 003A reads one recipe by id, so no query
needs it. The first slice that reads a set (the sitemap or a creator page list) adds it with a test that holds the two
forms equal (spec FR-001).

**Alternatives rejected** (owner ruling 2026-11-09, spec Q1):

- **A facts-only form for recipes written in the editor, opened early.** It waived the hold for facts only. The owner
  kept the feature dark instead, so no conditional unit is planned.
- **The full page for recipes written in the editor, opened early.** It waived the hold and the licence, and a recipe
  pasted into the editor counts as written there.

## R4. Author standing

**Decision**: recipe-service asks identity on each origin miss of a public read, through `AuthorStandingPort` and its
identity adapter. Identity answers on a new internal route to a recipe-signed token with its own audience. No answer,
or an error, reads as `unknown`, which is closed. The contract is in
[contracts/publicReaderToken.md](contracts/publicReaderToken.md).

**Rationale**: ADR-0081 replaced a status call with a better source, the caller's own signed token. A public read has
no author token: the reader asks, and the author is not part of the request. So that source does not exist here.
ADR-0081 also rejected a status call on every USER request, because every read and write then gains a
dependency. A public read is different. It is cached for 5 minutes on the web, it is rare by comparison, and failing
closed is the right answer for it. The synchronous read shows a suspension within the cache life with no new data to
keep in step.

**Alternatives rejected**:

- **A read model in recipe fed by identity's status events.** It keeps a second copy of identity's state, and a missed
  event leaves a suspended author's page open, which is the dangerous direction. It needs an outbox, delivery, a
  backfill and a reconciliation sweep.

**Owed later.** When 021 section C adds sitemaps and IndexNow, a suspension must push an exit event (`021-FR-074`).
A pull cannot do that. Then a recipe leg joins the deletion worker's lifecycle fan-out and feeds an `author_standings`
table behind the same port. Only the adapter changes.

**Recipes left public at erasure** (owner ruling 2026-11-09, spec Q8). Account closure has no recipe leg today
(`deletionWorker.ts`): it bans the user at Clerk and marks the identity row `tombstoned`. Erasure deletes a cook's
recipes, except the ones it keeps public: those the cook elected to donate and those already public. Kept recipes carry
a pseudonymous handle, `user_{ULID}` (`recipe-core/src/accountErasure.ts`), which embeds the user id. The owner ruled
that a recipe left public at erasure stays open signed out, with no author name, and `021-FR-002` rule 7 is amended for
that case only. So `authorActive` passes `erased`, and the projection shows no author and never the handle. Every
public published recipe of an erased author is one the erasure kept, because the erasure removes every other owner-only
recipe in the same transaction. The spec records the reading that both kinds of kept recipe are covered.

- **Trust the reader's token.** A reader's token says nothing about the author.
- **Treat standing as always active.** Suspension exists, so that opens a suspended cook's recipes.

## R5. Caching and purge

**Decision**: the page is the only cache (R1). The API is always `no-store`. The CloudFront behaviour for
`/api/v1/public/recipes/*` on the recipe distribution uses `CACHING_DISABLED` and an origin-request policy that forwards
no `Authorization` header, no cookie and no query string. The page never reads `searchParams`, cookies or headers, so
the cache key is the path plus the page language (R8), and a share mark cannot split it.

**Rationale**: the one cache forgets within 5 minutes by itself, so the bound holds without a purge (FR-013). ADR-0020's
"URL-only recipe behaviour" decision is not needed, because nothing on the API is cached.

**What cannot be proven on a preview**: previews have no CloudFront and no WAF (ADR-0020). The CloudFront passthrough,
the WAF rate limit and the production web cache are proven in production only. A preview does show the page's own
`Cache-Control` header, which the Playwright suite checks.

## R6. Rate limits

**Decision**:

- **Web pages**: a Vercel Firewall rate limit per real client address, answering `429` with `Retry-After`. No challenge
  action, because a challenge sets a cookie.
- **API**: an AWS WAF web ACL on the recipe distribution with a rate rule scoped to `/api/v1/public/recipes/*`, so native
  clients are limited per address.
- **Origin**: the public controller is `@SkipThrottle()`, so the per-user throttle's shared fallback bucket never sees a
  signed-out read.
- **Web server to API**: Vercel's server fetches come from shared addresses. A secret header lifts only the API's
  per-address limit for page renders, and grants no read (owner ruling 2026-11-09, spec Q4). The WAF rule accepts the
  current and the previous value, so the secret rotates with no failed render.
- **Crawlers**: verified on the web host by each operator's published method (021 FR-064). Crawlers never call the API.

**Alternatives rejected**: a limit at the origin keyed on a forwarded address header, because a client can set that
header. A per-user limit, because a signed-out reader has no user.

## R7. CORS and the bearer-only precondition

**Decision**: no browser calls the public endpoint. Only the web server and the native app call it. The service keeps
its shared CORS policy (ADR-0047). `bearerOnlyPrecondition` stays green with no waiver.

**Watch item**: if the API cache is ever turned on, the public route must send no CORS headers, or the cache key must
include `Origin`. Otherwise the cache serves one origin's allow header to another.

## R8. The public address and app links

**Decision**: `https://commise.app/recipe/{id}/{slug}`, with no locale. A wrong or missing slug redirects with `308`
only when the recipe is open. `/.well-known/` is excluded from the middleware. `/recipe/*` is handled by the middleware
before Clerk and never reaches `clerkMiddleware`: it picks the page language and rewrites to the internal
`/publicRecipe/{lang}/{id}/{slug}` (owner ruling 2026-11-09, spec Q3). The page's own words follow the first supported
locale in `Accept-Language`, else English. The ISR cache key is the internal path, so it is the public path plus the
language from a closed set, never the raw header. The response sends `Vary: Accept-Language`. One pure parser, `parsePublicRecipePath`, serves the web route, the middleware exclusion, the native
gate, the native link config and the association files.

The association files are served by route handlers at `/.well-known/apple-app-site-association` and
`/.well-known/assetlinks.json`, and associate `/recipe/*` only. On native, the auth gate gains a `publicRecipe` state
that exists only with its link. Signed in, React Navigation's `linking` maps the same path to the existing recipe
screen.

The public route has its own root layout (`app/publicRecipe/layout.tsx`) with no `ClerkProvider`, so nothing on the page
can start a Clerk session. A signed-out reader's account action returns through the in-app address
`/{locale}/recipes/{id}?then=save|saveCopy|rate`, which `safeReturnPath` already accepts, so that parser does not change.

**Rationale**: A locale-free address never changes when a second locale ships. Choosing the language from a closed set
keeps the cache bounded: one entry per recipe per supported locale.
The slug redirect only for open recipes keeps a closed recipe's title private.

**One-way doors**: the address form, the cache key (path plus language), the association files' path set, team id, bundle id and signing fingerprints, and
the native gate's state.

## R9. The signed-out actions

**Decision** (owner ruling 2026-11-09, spec Q5): the same actions a signed-in reader has on another cook's public
recipe: "Save" (the app's normal save to a collection), "Save a copy" and "Rate this recipe". After sign-in, each behaves
exactly as it does everywhere else in the app. The pending action travels in the return path as a value from a closed
set (`save`, `saveCopy`, `rate`), parsed like `?done=`.

**What changed**: DESIGN had left plain "Save" out of 003A. The owner pointed out that no such restriction exists in
code or specs, and reversed it. No private bookmark feature is planned. "Start cooking" and "Add to plan" do not exist
yet (008, 006), so they are not offered.

## R10. Page structure

**Decision** (from `staff-ux-engineer` DESIGN): direction A, the reader view without owner controls, with the account
actions where they already are. Direction C applies to the facts card's method area: a card that says "{n} steps on
{site}" with "Open the full recipe on {site}" as the page's one filled button. Direction B, a sticky action dock, was
rejected because it reads as a third prompt and covers the recipe (021 FR-050).

`staff-ux-engineer` SPECIFY runs next, before any UI is built. It turns the state table and the §3.6 dispositions into
the committed design, on phone, tablet and desktop.

## R11. Indexing

**Decision**: every public page sends `noindex` until 021 section C ships. Every non-production page sends `noindex`
always, as a header and a meta tag.

**Rationale**: A page must not be indexable before the removal machinery (sitemap removal and IndexNow, 021 FR-074)
exists. The owner confirmed it on 2026-11-09 (spec Q7). 021 owes its removal: `021-FR-020a` makes removing it part of
021 section C's done, and task P003A-01 carries it.

## R12. Photos

**Decision**: public forms carry each photo's thumbnail only. A photo with no thumbnail is left out.

**Rationale**: an original upload can carry GPS data in its metadata (`021-FR-071`). The cover projection today falls
back from the thumbnail to the original (`COALESCE(thumbnail_key, s3_key)`), which would leak it. A stripped
full-size image is owed before the full form shows large photos.

## R13. The signing key

**Decision**: a provisioner Lambda in `infra/global` (`PublicReaderKeyStack`, one per base stage) generates the Ed25519
pair inside AWS. The private key goes to Secrets Manager, and its ARN and the public key go to SSM. It follows the
remote-search key's precedent, and shares that handler's pure key-generation module.

**Rationale**: no person handles the private key, and a stage gets its key from its own deploy.

**Alternative rejected**: an operator-made key, as the erasure key was. It needs a manual step per stage and a person
who has seen the private key.
