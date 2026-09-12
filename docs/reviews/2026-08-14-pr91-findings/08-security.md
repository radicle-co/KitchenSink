# 08 — Security review

**Scope**: `/home/brandon/Development/KitchenSink` @ `chore/code-quality-enforcement-phase-1-2` (working tree, 2026-08-14).
**Frameworks applied**: OWASP ASVS 5.0 (V1 architecture, V4 access control, V5 validation, V7 errors/logging, V12 files, V13 API), OWASP API Top 10 2023 (API1 BOLA, API3 BOPLA, API4 unrestricted resource consumption, API6 business-flow, API7 SSRF), plus this repo's own **ADR-0014** (service-owned contracts) and **ADR-0015** (parse-don't-validate at every boundary, storage schema as the floor).
**Posture**: read-only. No exploit was executed against any deployed system. Three claims were verified by running the repository's own code locally in-process (F-SEC1, F-SEC5, D-4); the rest are verified by code reading and are labelled as such.

**Result: 3 HIGH, 5 MED, 6 LOW, 6 dismissed.** No CRITICAL. The authentication core (Clerk verification, `azp` enforcement, the service-principal erasure token, the svix webhook pipeline) is genuinely strong and I found nothing wrong with it. Every finding below is in the layers _around_ auth: resource consumption, authorization on one shared-write route, a validation-scheme gap, and boundary parsing that ADR-0015 requires but three route families still hand-roll.

---

## F-SEC1

**Severity**: HIGH
**File**: `packages/services/food-service/src/auth/auth-load-shedder.ts:62`, `:97-99`, `:139-143`, `:146-163`; entered from `packages/services/food-service/src/auth/food-auth.guard.ts:116-125`, `:145`
**Title**: The auth load-shedder's failure map is keyed on an attacker-chosen header and is never evicted — unauthenticated memory-exhaustion DoS, and the rate cap it exists to enforce never fires.

**Exploit scenario.** An unauthenticated attacker sends to any `https://food-*.commise.app/api/v1/foods/...`:

```
Authorization: Bearer x
X-Forwarded-For: 198.51.100.<counter++>
```

The ALB **appends** to `X-Forwarded-For`; it does not strip a client-supplied one, so `sourceKey()` (`:80`) takes `.split(',')[0]` and returns the attacker's own string. Two things follow from one request:

1. `shouldShed(freshKey)` (`:97`) → `recentFailures` finds no entry → `0` → **never sheds**. The per-source 401-rate cap (`DEFAULT_SHED_THRESHOLD = 100`) is bypassed for free by incrementing a counter.
2. Verification fails, so `recordFailure(freshKey)` (`:139`) does `failures.set(newKey, [now])`. Nothing ever removes it: `recentFailures` (`:146`) is the **only** deleter and it prunes **only the key it is asked about**, which is never revisited. There is no size cap, no TTL sweep, no LRU.

Measured, running the real class in-process:

```
map entries after 500k distinct XFF values: 500000
heap growth MB: 139.7
shouldShed still false for the attacker: false
```

The API task is `memoryLimitMiB: 1024` (`packages/services/food-service/infra/lib/food-service-stack.ts:370`), so roughly **3.5M requests ⇒ OOM-kill of the task**. A malformed bearer fails before any RSA work, so throughput is bounded only by the network; at 1000 rps that is under an hour. Per-PR stages run **one** API task (ADR-0010), so the preview is fully down; prod loses a task per attacker per hour and the shedder that was supposed to prevent exactly this is the thing that dies.

**Why it happens.** The class docstring (`:16-19`) anticipates spoofing and dismisses it — _"spoofing it only spreads an attacker's own flood across buckets, against which the global concurrency bound still holds."_ That reasoning is right about **CPU** and silent about **memory**: the concurrency bound caps in-flight verifications, but nothing caps the _cardinality of the bucket set_. Unbounded-key maps are the standard failure mode of any per-source counter that trusts a client header, and the header trust is the root: `UserThrottlerGuard` in recipe-service reasons the opposite way and refuses `X-Forwarded-For` for precisely this reason (`packages/services/recipe-service/src/common/throttle/user-throttler.guard.ts:17-26`). The two services disagree about the same header.

**Smallest fix.** Two lines, in this order:

1. In `sourceKey` (`:79-87`), drop the `X-Forwarded-For` branch and key on `input.ip` only — matching recipe's already-argued position. All flooders then share one bucket, which fails toward _more_ shedding.
2. Independently, bound the map so a future key source cannot reintroduce the leak: cap `failures.size` (e.g. `MAX_TRACKED_SOURCES = 10_000`) and refuse new keys — or sweep — once at the cap. Fail toward shedding, not toward admitting.

Add a regression test asserting `failures.size` stays bounded across 1e6 distinct keys.

**Verified**: empirically. Instantiated the real `AuthLoadShedder` and drove 500,000 distinct source keys through `shouldShed` + `recordFailure`; output above. Header-append (not replace) is documented ALB behaviour; not probed against the live ALB.

---

## F-SEC2

**Severity**: HIGH
**File**: `packages/services/food-service/src/foods/foods.schema.ts:279-282`; consumed at `packages/services/food-service/src/foods/foods.service.ts:336-360`; route `packages/services/food-service/src/foods/foods.controller.ts:169-181`
**Title**: `PATCH /api/v1/foods/{id}` accepts an unbounded, un-deduplicated `candidateIds` array and makes one outbound source call per element — on the one route deliberately exempt from admission control, in a service with no rate limiter.

**Exploit scenario.** Any authenticated user finds an `UNRESOLVED` food (`GET /api/v1/foods/{id}/candidates` is open to every authenticated caller) and sends:

```
PATCH /api/v1/foods/{unresolvedId}
{"candidateIds": ["<one real candidate id>", "<the same id>", ... ×3000]}
```

`resolveFoodRequestSchema` is `z.array(z.string()).min(1)` — **no `.max()`, no `.uuid()`/ULID shape, no dedup**. `patchResolve` (`:336-344`) resolves each element through `byId.get(...)`, so a repeated id is a valid pick _every time_, and the loop at `:351-360` performs, per element:

```ts
const window = await this.limiter.tryRecord(source);
if (!window.allowed) throw new FetchUnavailableError(...);
refetched.push(await this.registry.adapterFor(source).fetchByKey(pick.externalKey));
```

At the 100 kB Express body default a ULID array holds ~3,300 entries — **~3,300 sequential outbound USDA calls from one request**. The USDA FDC key quota is 1,000 requests/hour, and `RollingWindowLimiter` is a **per-source 60-minute** window (`packages/services/food-service/src/sources/rolling-window-limiter.ts:2-7`). One request therefore drains the entire hour's budget, and every legitimate ingredient fetch for every user gets `FetchUnavailableError` → `503` for the rest of the window. It is repeatable each window: on the `FetchUnavailableError` path the food stays `UNRESOLVED` (`:348`, "a re-fetch failure aborts WITHOUT clearing the candidate set"), so the same target is reusable.

Nothing intercepts this. `AdmissionService`'s own docstring states resolves are _"never admitted through here and are never shed"_ (`packages/services/food-service/src/foods/admission.service.ts:2-4`), and food-service has **no** `@nestjs/throttler` dependency at all (verified: `grep throttler packages/services/food-service/package.json` → no match).

**Why it happens.** The contract file bounds the two _name_ surfaces carefully (`MAX_FOOD_NAME_LENGTH`, and a documented reason the batch cap lives in the controller) but treats `candidateIds` as a shape rather than as a **work multiplier**. ADR-0015 §5 makes the _storage_ schema the floor; it says nothing about the floor for a field whose length is a count of outbound calls, so the review lens that caught `servings: 9999999999` did not point here.

**Smallest fix.** In `resolveFoodRequestSchema` (`:279-282`):

```ts
candidateIds: z.array(z.string()).min(1).max(MAX_RESOLVE_PICKS),   // MAX_RESOLVE_PICKS = 10
```

and dedup in the service before the loop (`new Set(candidateIds)` at `:336`) so a repeat can never charge the limiter twice. A cap alone is not enough — dedup is what removes the amplification.

**Verified**: by code reading of the schema, the controller, the service loop and `admission.service.ts`'s stated exemption, plus confirming `@nestjs/throttler` is absent from food-service's `package.json`. Not executed against a deployed stage.

---

## F-SEC3

**Severity**: HIGH
**File**: `packages/services/recipe-service/package.json:54` and `prod.package.json:34` (`"sharp": "^0.34.5"`, installed **0.34.5**); sink at `packages/services/recipe-service/src/photos/photo-thumbnail.ts:44`; reached from `packages/services/recipe-service/src/photos/photos.service.ts:317`
**Title**: `sharp` 0.34.5 carries the known libvips CVEs and decodes attacker-supplied image bytes in-process on the recipe API task.

**Exploit scenario.** An authenticated user presigns a photo upload for their own recipe, PUTs a file whose first bytes are a valid JPEG/PNG/WebP signature but whose body is crafted against libvips, then calls `POST /api/v1/recipes/{id}/photos/confirm`. `confirm` validates _magic bytes_ (`:295-300`) and _object size_ (`:305-312`) — neither of which constrains the decoder's input — and then hands the bytes straight to `sharp(Buffer.from(bytes))` inside the API process (`photo-thumbnail.ts:44`).

`npm audit --omit=dev` reports for the installed tree:

```
sharp  range=<0.35.0  fix={"name":"sharp","version":"0.35.3","isSemVerMajor":true}
  "sharp inherited vulnerabilities in libvips: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591"
```

Installed: `sharp 0.34.5`, `libvips 8.17.3` (read from `sharp.versions`). The affected decoders are exactly the formats the allowlist admits, so the magic-byte check is not a mitigation — it is the _entry condition_. The `try/catch` around thumbnailing (`photos.service.ts`, "deliberately catch-all and non-fatal") catches JS exceptions; it does not catch native memory corruption or an abort.

**Why it happens.** The dependency is pinned `^0.34.5` and the fix is `0.35.x` — a **semver-major** bump, so `npm update` and a caret range will never take it. Dependabot was only just given a `cooldown` config on this branch (`.github/dependabot.yml`), and there is no CI gate that fails on a HIGH advisory in a production dependency (`.github/workflows/_ci.yml` runs no `npm audit` step).

**Smallest fix.** Bump `sharp` to `^0.35.3` in both `packages/services/recipe-service/package.json` and `prod.package.json` (they must move together — `prod.package.json` is what the image installs), re-run the photo confirm integration + e2e tiers. Then add a CI step: `npm audit --omit=dev --audit-level=high` on the service workspaces, so the next one fails the build instead of a review.

**Verified**: `npm audit --omit=dev --json` on the installed tree (advisory text and range quoted above); installed version read at runtime from `sharp.versions`; the call chain read end-to-end. The CVEs themselves were not reproduced.

---

## F-SEC4

**Severity**: MED
**File**: `packages/services/food-service/src/foods/foods.controller.ts:157-181`, `packages/services/food-service/src/foods/foods.service.ts:318-380`
**Title**: `PATCH /api/v1/foods/{id}` has no authorization beyond "is authenticated", and deliberately records no actor — any user can permanently set the shared nutrition record for a food they never requested, unattributably.

**Exploit scenario.** User A adds "chicken breast" and is handed a candidate set to disambiguate. Before A picks, User B — with no relationship to that food — sends `PATCH /api/v1/foods/{id} {"candidateIds":["<the wrong one>"]}`. The handler runs no ownership check, no requester check and no scope check; it validates only that the picks are members of _that food's_ candidate set (`:333-344`) and then writes the golden record. Status becomes `RESOLVED`, after which the route is an idempotent no-op (`:325-327`) — **the mistake is not correctable through this API**. Every user's recipe nutrition summary now derives from B's pick.

Compare the sibling route: `POST /api/v1/foods/{id}/refetch` requires `food:admin` (`:145-147`). `PATCH` — the one that writes — requires nothing.

**Why it happens.** The route's docstring (`:157-167`) argues at length that no requester should be _recorded_, on privacy grounds (`fetch_requesters` is the "user X asked for food Y" linkage the erasure leg deletes). That argument is sound and it is about **auditing**. It was then read as also settling **authorization**, which it never addresses — so the route ended up with neither. The consequence is that the write has no actor in the logs either, so the poisoning is also not attributable after the fact.

**Smallest fix.** Restrict the write to a caller with a stake in it: require the caller's ULID to appear in `fetch_requesters` for that `foodId` (a row that already exists, is already read by `AdmissionService.pendingCountForRequester`, and needs no new linkage) — else `403`. That keeps the privacy decision intact (no _new_ requester row is written) while removing the ambient capability. If the owner instead rules that any user may resolve any food, that is a legitimate product call but it needs to be **written down at the route as an authorization decision**, and it needs an actor in the audit log.

**Verified**: by code reading of the controller and `foods.service.patchResolve`; confirmed no guard, no `@RequireScopes`, no requester argument, and that `FoodAuthGuard` (the only middleware on this controller) asserts authentication only.

---

## F-SEC5

**Severity**: MED
**File**: `packages/services/identity/src/users/users.schema.ts:126` (`avatarUrl: z.union([z.url(), z.null()]).optional()`); same pattern at `packages/shared/recipe-core/src/recipe.types.ts:310` (`sourceUrl: z.string().url().optional()`)
**Title**: zod v4's `z.url()` accepts **any** scheme, so a stored, user-controlled `avatarUrl` can be `javascript:` or `data:text/html,...` — on a field the schema's own comment says is rendered as an image source.

**Exploit scenario.** `PATCH /api/v1/users/me {"avatarUrl":"javascript:alert(document.cookie)"}` is accepted, persisted, and returned by `GET /api/v1/users/me` to web and mobile. Measured against the installed zod 4.4.3:

```
"javascript:alert(1)"                      → accepted
"data:text/html,<script>alert(1)</script>" → accepted
"file:///etc/passwd"                       → accepted
"http://169.254.169.254/latest/meta-data/" → accepted
```

Today this is **latent, not live**: I traced every `avatarUrl` consumer and the only render site is a text `<input value={...}>` (`packages/apps/commise/web/src/components/auth/AccountEditForm.tsx:80`) and mobile's equivalent (`packages/apps/commise/mobile/src/screens/profile.tsx:97`). It becomes stored XSS the moment anyone renders it in an `<a href>` — which is precisely what the field is for, and what the schema's own comment at `:117-119` asserts already happens (_"the value is rendered as an image source"_). The `http://169.254.169.254` case matters for a different reason: when feature 004 lands, its import URL becomes `sourceUrl`, and `z.string().url()` is the schema that will gate the SSRF fetcher's input.

**Why it happens.** The comment at `:117-119` records this exact field being **tightened** from `class-validator`'s `@IsUrl()` to `z.url()` — a real improvement (a scheme is now required), and reasonably assumed to have brought scheme _restriction_ with it. It did not: zod v4's `z.url()` delegates to `new URL()`, which is happy with any scheme.

**Smallest fix.** zod v4 supports the constraint natively:

```ts
avatarUrl: z.union([z.url({ protocol: /^https$/, hostname: z.regexes.domain }), z.null()]).optional(),
```

Verified locally: this rejects `javascript:`, `http:` and `https://169.254.169.254/x`, and accepts `https://evil.com/x.png`. Apply the same to `recipeSchema.sourceUrl` in `recipe-core` **before** 004 merges, and add a rejection case to the boundary tests.

**Verified**: empirically — ran zod 4.4.3 (the installed version) against both the current and proposed schemas; output above. Render sites enumerated by grep across `packages/apps` and `packages/shared/ui`; no `<a href>`/`<img src>` consumer exists today.

---

## F-SEC6

**Severity**: MED
**File**: `packages/services/recipe-service/src/collections/collections.controller.ts:94, 106, 118, 129, 149, 165, 182, 196, 197` (`@Param('id') id: string`, no pipe); column `packages/services/recipe-service/src/database/schema/collections.ts:53` (`uuid('id')`); reached via `packages/services/recipe-service/src/collections/dal/collections.dal.ts:115`
**Title**: Nine collections routes pass an unvalidated path parameter into a `uuid` column comparison — a malformed id is a `500` with a full stack logged at ERROR, where every other id-taking route in the service returns `400`.

**Exploit scenario.** `GET /api/v1/collections/not-a-uuid` (authenticated, any user). `ZodValidationPipe` passes it through — a single-key `@Param('id')` has metatype `String`, which is exactly the documented trap (`packages/services/identity/src/admin/admin.controller.ts:31-37` records the same defect being fixed there). It reaches `findById` → `.where(eq(collections.id, 'not-a-uuid'))` → PostgreSQL resolves `$1` to `uuid` from the comparison and raises `22P02 invalid input syntax for type uuid`. `ApiExceptionFilter` has no branch for a raw `Error`, so it emits `500 INTERNAL_ERROR` **and logs the full stack at `logger.error`** (`api-exception.filter.ts:130-135`). That log group is subscribed to the Sentry drain (`WebhooksLogDrain`), so a trivial loop is a cheap way to bury the auth-provisioning pager the team relies on — the one alert `auth.middleware.ts:130-143` exists to raise — and to burn Sentry quota.

**Why it happens.** Two things line up. (a) The controller uses `@Req()` + a local `requirePrincipal` rather than the `@OwnerId()`/`ParseUUIDPipe` pair every other controller uses (recipes, photos, ratings, versions and ingredients all pass `ParseUUIDPipe`), so the omission does not look odd in isolation. (b) The test that appears to cover it does not: `collections/__tests__/clone-collection.service.test.ts:220-234` — _"surfaces a domain error rather than a raw throw when the source id is malformed"_ — sets `dal.findById.mockResolvedValue(undefined)`, i.e. it asserts the behaviour **on the assumption the DAL returns `undefined`**, which is the one thing the real DAL does not do for a malformed uuid. It is green and proves nothing about this path. `collections.controller.test.ts:5` states the opposite of the truth: _"malformed-input rejection is [handled at the] `ZodValidationPipe` framework seam"_.

**Smallest fix.** Add `ParseUUIDPipe` to all nine params, matching every sibling controller:

```ts
@Param('id', ParseUUIDPipe) id: string,
@Param('recipeId', ParseUUIDPipe) recipeId: string,
```

Then replace the mocked test with one that asserts a `400` for `not-a-uuid` through the real HTTP stack (the ingredients e2e already has the right shape: `tests/e2e/ingredients.e2e.test.ts:199`).

**Verified**: column type, controller signatures and DAL predicate read directly; the mocked test read in full. The `22P02` → `500` step is inferred from PostgreSQL parameter-type resolution and the filter's `resolve()` fallback — **it was not executed against a live database** (no local PostgreSQL or Docker available in this environment). Confidence high, but this one deserves the 5-minute integration check.

---

## F-SEC7

**Severity**: MED
**File**: `packages/services/recipe-service/src/versions/versions.controller.ts:53, 65` (`@Param('versionNumber', ParseIntPipe)`); column `packages/services/recipe-service/src/database/schema/versions.ts:51, 97` (`integer('version_number')`)
**Title**: `ParseIntPipe` with no bounds writes an out-of-int4-range value into an `integer` comparison — the exact "500 that owed a 400" ADR-0015 §5 forbids.

**Exploit scenario.** `GET /api/v1/recipes/{ownRecipeId}/versions/99999999999`. Nest's `ParseIntPipe` accepts it — its `isNumeric` is `/^-?\d+$/.test(value) && isFinite(value)` (`node_modules/@nestjs/common/pipes/parse-int.pipe.js:45-48`), with no range check at all — and returns `99999999999`. The ownership check passes (the recipe is the caller's), then `versions.dal` runs `eq(recipeVersions.versionNumber, 99999999999)` against `int4` → `22003 value out of range for type integer` → generic `500` + full stack at ERROR. `-1` likewise passes the pipe. Same log-flooding consequence as F-SEC6.

**Why it happens.** ADR-0015 §5 makes the column the floor and the ADR's own worked example is `servings: 9999999999`; `recipe-core` even exports `INT4_CEILING` for it (`packages/shared/recipe-core/src/recipeRequestBounds.ts:37`). The rule was applied thoroughly to **bodies and query strings** and not to **path params**, because a path param never goes through a `createZodDto` — and `VersionsController` is the one controller with no `@UsePipes` at all (deliberately, per its own docstring at `:10-21`, since it has no bodies).

**Smallest fix.** `ParseIntPipe` has no range option, so bounding it in place is not available. The minimal correct form is a bounded zod param DTO, matching what identity did for `AdminUserIdParamDto`:

```ts
export class VersionNumberParamDto extends createZodDto(
    z.object({ recipeId: z.uuid(), versionNumber: z.coerce.number().int().positive().max(INT4_CEILING) }),
) {}
```

and `@Param() params: VersionNumberParamDto` with `@UsePipes(ZodValidationPipe)` on the controller. That also closes the "this controller has no pipe" asymmetry. Extend `src/database/__tests__/storage-capacity.test.ts` — which already asserts the floor per column for bodies — to cover path params.

**Verified**: Nest's `ParseIntPipe` source read from `node_modules`; column types read from the drizzle schema. The `22003` step is inferred from PostgreSQL semantics, **not executed** (same environment limitation as F-SEC6).

---

## F-SEC8

**Severity**: MED
**File**: `packages/services/recipe-service/infra/lib/recipe-service-stack.ts:196-201`; consumed at `packages/services/recipe-service/src/auth/auth.middleware.ts:49-66`
**Title**: recipe-service is the only service that leaves the dev-auth bypass **armed** on every deployed non-prod stage; identity and food hard-set `NODE_ENV=production`.

**Exploit scenario.** Not directly reachable today — it needs a second condition. `resolveDevBypass()` returns a fully-authenticated principal, with **no token and no Clerk verification**, whenever `NODE_ENV !== 'production'` **and** `RECIPE_DEV_AUTH_USER_ID` is set. The stack sets `NODE_ENV: stage === 'prod' ? 'production' : 'staging'`, so on sandbox and on every `pr-{N}` the first condition is **permanently true** and only the absence of one environment variable stands between an internet-facing service and "every request is authenticated as an arbitrary owner ULID". Anyone who adds that variable to a task definition, an SSM parameter, or a `workflow_dispatch` input — for a debugging session, say — silently disables authentication on a public origin. Contrast: `packages/services/identity/infra/lib/identity-service-stack.ts:211` and `packages/services/food-service/infra/lib/food-service-stack.ts:277` both set `NODE_ENV: 'production'` unconditionally, so their identical bypasses are dead on every deployed stage.

**Why it happens.** `NODE_ENV` is overloaded to carry two unrelated decisions: recipe keys its `azp` posture on it (per-PR pattern mode requires non-`production`), and the bypass keys its kill switch on it. The stack comment at `:196-200` states the conflict and its own follow-up: _"consider aligning recipe's azp gating to food's STAGE-based rule."_

**Smallest fix.** Decouple the two. `STAGE` is already in the same environment block (`:202`), so gate the bypass on it and leave `azp` alone:

```ts
if (process.env['NODE_ENV'] === 'production' || (process.env['STAGE'] ?? '') !== 'local') return undefined;
```

i.e. the bypass is available **only** where `STAGE` is a local/test value, never on a stage that has an ALB in front of it. Add a synth test asserting no deployed task definition can carry `RECIPE_DEV_AUTH_USER_ID`.

**Verified**: by reading the three stacks and the middleware; confirmed by grep that `RECIPE_DEV_AUTH_USER_ID` appears in **no** infra file, workflow or script — only in the middleware, its tests, and the e2e harnesses. The risk is latent, not live.

---

## F-SEC9

**Severity**: MED
**File**: `packages/apps/commise/web/package.json:49` (`"next": "^15.0.0"`, installed **15.5.19**)
**Title**: The web app runs a Next.js version carrying several HIGH advisories, two of which touch surfaces this app uses.

**Exploit scenario.** `npm audit --omit=dev` reports for the installed tree, at HIGH:

> `Next.js: Server-Side Request Forgery in Server Actions on custom servers` · `Denial of Service in App Router using Server Actions` · `Unbounded Server Action payload in Edge runtime` · `Unauthenticated disclosure of internal Server Function endpoints` · `Cache confusion of response bodies for requests with bodies` · `Server-Side Request Forgery in rewrites via attacker-controlled destination hostname` · `Denial of Service in the Image Optimization API using SVGs`

This app is App Router, uses Server Actions (`next.config.ts` configures `experimental.serverActions.allowedOrigins`), and — per ADR-0001's "Update (2026-07-28)" — already has an unresolved Server-Action origin problem on previews. The Server-Action advisories are therefore on a live code path, not a theoretical one.

**Why it happens.** `^15.0.0` floats within 15.x but the fixed releases are outside the installed resolution, and there is no `npm audit` gate in CI (same root cause as F-SEC3).

**Smallest fix.** `npm audit fix` for `next` (`fixAvailable: true`, non-major), then a real `next build` — per this repo's own note, `@commise/web` changes need a build, not just typecheck. Pair it with the CI audit gate from F-SEC3 so this is caught, not reviewed.

**Verified**: `npm audit --omit=dev --json` on the installed tree; installed version from `node_modules/next/package.json`. Individual advisories not reproduced.

---

## F-SEC10

**Severity**: LOW
**File**: `packages/services/food-service/src/main.ts` (whole file), `packages/services/food-service/package.json`
**Title**: food-service has no rate limiting, no CORS policy and no security headers — it is the only public HTTP service with none of the three.

`main.ts` does contract-hash assertion → `NestFactory.create` → `listen`, and nothing else. There is no `enableCors` (recipe derives its allowlist from the `azp` boundary and **denies** when unconfigured — `recipe-service/src/main.ts:38-45`), no `@nestjs/throttler` (recipe has one; verified absent from food's `package.json`), and no `helmet` anywhere in the repo. Its only DoS control is the shedder from F-SEC1, which F-SEC1 shows is bypassable. Every authenticated route — including the enqueue routes and the resolve route from F-SEC2/F-SEC4 — is therefore unthrottled per user.

**Smallest fix.** Port recipe's `UserThrottlerGuard` + `throttle.config.ts` (they key on the app-user ULID, which food already resolves as `req.user.userId`), and add `buildCorsPolicy` — food is called cross-origin by the web app exactly as recipe is. `helmet` on all three services is a separate, cheap win.

**Verified**: by reading both `main.ts` files and both `package.json` files.

---

## F-SEC11

**Severity**: LOW
**File**: `packages/services/recipe-service/src/collections/collections.service.ts:394-406` vs `packages/services/recipe-service/src/recipes/recipes.service.ts:897-910`
**Title**: Collections leak resource existence via `403`, where recipes deliberately return `404`.

`requireOwned` throws `collectionNotOwnedError` (→ `403 NOT_OWNER`) for a collection that exists but is someone else's, while `recipes.assertOwner` returns `404` first for anything the caller cannot view — with an explicit anti-oracle rationale, and `cloneCollection` (`:249-251`) applies the _recipe_ rule correctly (_"a private one must not even be revealed to exist"_). So the same service enumerates collection ids and refuses to enumerate recipe ids. `GET /api/v1/collections/{guess}` distinguishes "exists, not yours" (403) from "does not exist" (404).

**Smallest fix.** Make `requireOwned` throw the `404` for a non-owned collection, matching `assertOwner` and `cloneCollection`.

**Verified**: by reading all three sites.

---

## F-SEC12

**Severity**: LOW
**File**: `packages/services/recipe-service/src/search/search.schema.ts:101, 104`; `packages/services/recipe-service/src/recipes/recipes.schema.ts:129, 131`
**Title**: Several user-controlled collections/strings carry no upper bound, relying on transport limits instead of the contract.

- `textFilterSchema` = `z.string().min(1)` and `listFilterSchema` = `z.array(z.string().min(1))` — no `.max()` on the string, the array, or its elements. `?query=` and `?tags=a,b,c…` are bounded only by the ALB's ~16 kB header limit; a CSV `tags` expands to one bound parameter per element.
- `createRecipeRequestBaseSchema.steps` and `.dietaryFlags` carry no cardinality bound while `ingredients` (100) and `tags` (50) do — the file's own comment at `:107-109` flags the asymmetry and defers it. At the 100 kB body default that is ~5,000 step rows inserted per request.

Impact is real but modest (each is capped by a transport limit, and the search route carries `@SearchRateLimit()`), which is why this is LOW rather than a sibling of F-SEC2. It is listed because it is the same _class_ as F-SEC2 — an unbounded collection whose length is a work multiplier — and because ADR-0015 §5's floor reasoning does not reach fields with no bounded column behind them.

**Smallest fix.** Add `.max(MAX_FOOD_NAME_LENGTH)`-style bounds to `textFilterSchema`, `.max(20)` to `listFilterSchema`, and a `MAX_RECIPE_STEPS` / `MAX_DIETARY_FLAGS` in `recipe-core` beside the existing `MAX_RECIPE_INGREDIENTS`.

**Verified**: by reading both schema files.

---

## F-SEC13

**Severity**: LOW
**File**: `packages/services/identity/src/users/avatar-upload.controller.ts:39-68`
**Title**: The avatar path never re-validates the uploaded bytes; the recipe-photo path does.

`confirm`-equivalent does not exist for avatars — the presign signs `ContentType` and `ContentLength` (so S3 rejects a mismatch) and the flow ends there. A user can therefore store arbitrary bytes under `avatars/{ownerId}/…` served as `image/png`. Recipe photos, by contrast, sniff magic bytes with `file-type` and re-check the size by S3 HEAD before persisting (`photos.service.ts:295-312`). Exploitability today is low — the `Content-Type` is pinned to an image type, so a browser will not treat the object as HTML — but the two paths implement the same requirement to different standards, and the weaker one is the one with no follow-up call to hang the check on.

**Smallest fix.** Either add a confirm step mirroring photos', or (cheaper, and it also covers the recipe path) set `X-Content-Type-Options: nosniff` on the CloudFront/S3 response for the media origin and note the accepted residual risk at the controller.

**Verified**: by reading both upload paths.

---

## F-SEC14

**Severity**: LOW
**File**: `packages/services/food-service/src/foods/foods.controller.ts:123, 132, 149, 172, 187` (`this.requireId(id)`), `:115` (`this.boundedNames(...)`); `packages/services/recipe-service/src/ingredients/ingredients.controller.ts:81-93` (`parseLimit`), `:119-128`, `:163-172` (bare `@Query('q')`/`@Query('limit')`); `packages/services/identity/src/users/avatar-upload.controller.ts:47-53`
**Title**: ADR-0015 §1/§2 residue — three route families still hand-roll per-method parsing that the ADR says must live in the pipe.

ADR-0015 §1 requires _one mechanism per service_ and §2 bans relocating the parse into the method body, precisely because _"a parse that each new method must remember to perform is a parse that eventually is not performed."_ Five food routes call `requireId` by hand, two ingredients routes take bare `@Query` strings and call a local `parseLimit`, and the avatar controller keeps its MIME allowlist and byte cap as controller policy (that one is _documented_ as a deliberate single-home decision at `avatar.schema.ts:9-14`, and I accept the reasoning).

No exploitable defect follows today — I checked each: `requireId` does validate ULID shape; `parseLimit`'s slack (`-1`, `1e9`, `2.5` all pass `Number.isFinite`) is caught downstream by `clampLimit`, which clamps to `[1, MAX_SEARCH_LIMIT]` (`ingredients/dal/ingredients.dal.ts:123-128`). It is listed as conformance debt, not a vulnerability: each is one forgotten call from becoming F-SEC6.

**Smallest fix.** Param/query DTOs (`createZodDto`) for the five food `:id` routes and the two ingredients query routes, matching `AdminUserIdParamDto`. Identity's `tests/admin-param-validation.test.ts` — which discovers every `:userId` route from Nest's own metadata and fails on a reverted bare string — is the right pattern to copy into both services.

**Verified**: by reading each site and tracing `parseLimit` → `clampLimit`.

---

## Dismissed (investigated, not findings)

- **D-1 — GitHub Actions template injection.** None. I parsed every `run:` block across all 16 workflows and found **zero** `${{ }}` expressions inside one; the single untrusted value in play (`github.event.pull_request.head.ref`, `sandbox-web-preview.yml:211`) is passed via `env:`, which is the correct pattern. There is no `pull_request_target` and no `workflow_run`. `zizmor.yml` is wired and this branch SHA-pins third-party actions. This is the strongest area of the repo.
- **D-2 — SQL injection.** None. `sql.raw` appears **zero** times in non-test source (`grep -rn "sql\.raw" packages/` → only two comments in `search.dal.ts` recording its removal, contra ADR-0015's "three call sites"). Every interpolation in every `db.execute(sql\`…\`)` is a bound parameter, including the ones that previously were not (`facetSampleSize`at`search.dal.ts:428`), and `orderByExpr`uses`Object.hasOwn`specifically to stop a prototype key becoming an`ORDER BY` fragment (`:305-311`). food's `ILIKE`patterns are escaped at the one place a pattern is built, with`ESCAPE '\'` (`food-search.dao.ts:108-110`, `:246-262`).
- **D-3 — SSRF.** **Not applicable to this branch.** Feature 004 has not shipped: there is no `imports/` directory, no `cheerio`/`microdata-node`/`@aws-sdk/client-textract`, and no `axios`/`got`/`node-fetch`/`http.request` anywhere in `packages/`. Every outbound URL in the tree is a config or env constant (`log-forwarder.ts:22` ← `LOG_DRAIN_DSN`; `erasure-fanout.ts:101` ← `RECIPE_SERVICE_BASE_URL`/`FOOD_SERVICE_BASE_URL`; `UsdaApiClient.ts:47` ← a hard-coded base, with user input reaching it only `encodeURIComponent`-ed). `sourceUrl` is stored attribution and is never fetched. The SSRF controls (`ssrf-guard.ts`, DNS-pinned `pinned-request.ts`, per-hop redirect re-validation) exist only on the unmerged `004-recipe-importing` worktree and are **out of scope here** — see "Not examined".
- **D-4 — Decompression-bomb DoS via recipe photo confirm.** I expected this and it does **not** reproduce. `photo-thumbnail.ts` never sets `limitInputPixels`, so sharp's default `268,402,689` px applies — nominally ~768 MB of RGB in a 1024 MiB task. Measured with the repo's own `generateThumbnail`: a 256 Mpx PNG compressing to **776 kB** (comfortably inside the 5 MB cap, with genuine PNG magic bytes) decoded and resized in **162 ms** with **82 MB** RSS growth — libvips streams the pipeline rather than materialising the frame. Extrapolated worst case ~139 MB. Not a DoS. Setting `limitInputPixels` explicitly is still worth doing as defence-in-depth (a future format or codepath may not stream), but it is a hardening note, not a finding.
- **D-5 — Mass assignment of `sourceType` / provenance / `ownerId` on recipe create.** Clean, and deliberately so. `createRecipeRequestBaseSchema` (`recipes.schema.ts:111-135`) is `z.strictObject` and has **no** `sourceType`, `sourceUrl`, `isPremium`, `hasSubstantiveEdit` or `ownerId` member — the docstring at `:100-102` records that `ownerId`'s absence is intentional and that a strict object `400`s anyone who sends one. `source_type` defaults to `'user_created'` in the column with a `CHECK` constraint (`database/schema/recipes.ts:100`, `:163-164`); ownership is stamped from the verified principal. The premium gate reads `principal.permissions` (`recipes.service.ts:478`, `:836`), which `clerk-verify` sources **only** from the token's signed `public_metadata` and explicitly never from user-editable `unsafe_metadata` (`clerkVerify.ts:9-12`, `:298`). Nothing here is client-settable.
- **D-6 — Collections membership IDOR (`POST /collections/:id/recipes`).** A candidate finding that does not survive reading the service: `collections.service.ts:193-195` checks `isRecipeViewableBy(recipe, ownerId)` **before** the insert and reports `404` (not `403`) so a private recipe's existence is never disclosed, with read-time `membershipPredicate` (`collections.dal.ts:415-422`) as the second layer. A DAL-only reading of `findActiveRecipe` (`:248`, existence-only) suggests a hole that the service closes.
- **Also dismissed**: IAM wildcards in `sandbox-scheduler-stack.ts:99` (read-only `Describe*`/`List*` actions that do not support resource-level scoping; every mutating statement is ARN-scoped); `iam.AnyPrincipal()` at `cost-guardrails-stack.ts:119` (a **DENY** on non-TLS publish); `whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw` in `svix.test.ts:4` (svix's own published documentation test vector, not a live secret); `?page=` overflow on search (zod 4's `.int()` caps at `MAX_SAFE_INTEGER`, so the resulting `OFFSET` stays inside `bigint`).

---

## What this changes about the PR

Nothing in this branch's diff **introduces** any finding above — it is overwhelmingly docs/specs plus real CI hardening (SHA-pinned actions, Dependabot `cooldown` with a correct rationale about security updates bypassing it). F-SEC1, F-SEC2, F-SEC4 and F-SEC6 are pre-existing and would block a production release, not this merge. F-SEC3 and F-SEC9 are one `npm audit fix`-plus-a-major-bump away and belong in this branch, because this branch is where the dependency-hygiene story is being told and it currently has no `npm audit` gate to go with it.

Suggested follow-ups: `ssec-1-security-engineer` to remediate F-SEC1/2/3/6, and `ciso` to rule on F-SEC4 (is "any authenticated user may resolve any food" an accepted risk, or an authorization gap?) and on the F-SEC8 `NODE_ENV` overload.

---

## Not examined

Stated explicitly so nothing here is read as coverage I did not have.

- **Feature 004 / the `004-recipe-importing` worktree.** Out of scope — it is a different branch. Its SSRF guard, DNS pinning, redirect policy, robots policy, Textract OCR adapter and file-parser were **located but not audited**. Two things spotted in passing and worth a dedicated review before it merges: `imports/ocr/ocr-image.ts:114` probes metadata with `limitInputPixels: false`, and `imports/dto/import-requests.dto.ts:24` validates the import URL as `z.string().trim().min(1).max(2048)` with no scheme constraint (see F-SEC5).
- **Runtime/deployed configuration.** No live system was touched. I did not read actual SSM parameter values, Secrets Manager contents, deployed task-definition environments, S3 bucket policies, CloudFront behaviours, security-group state or Clerk dashboard settings. F-SEC8's severity in particular depends on a deployed environment I could not inspect.
- **Git history secret scanning.** I grepped the working tree for credential patterns (clean). I did **not** run `gitleaks`/`trufflehog` over history, so a secret committed and later removed would not appear here.
- **The mobile app, `@commise/ui`, `@commise/features-*`, and web components** beyond tracing the two URL sinks in F-SEC5. No client-side XSS, deep-link, `expo-secure-store` or WebView review was performed.
- **`recipe-workers`, `identity-webhooks` handlers other than `identityWebhook.ts` and `log-forwarder.ts`**, and the food `change-refresh`/SQS consumers. ADR-0015 §3 puts these in scope for boundary validation and I sampled only two.
- **The CDK stacks as a whole.** I grepped for IAM wildcards and read the two hits plus the relevant env blocks. No `cdk synth` diff, no `cdk-nag` run (ADR-0013 records it as advisory), no review of encryption-at-rest, removal policies, SG rules or the shared-ALB listener rules.
- **CVE reproduction.** F-SEC3 and F-SEC9 rest on `npm audit`'s advisory data for the installed tree. I did not build a proof-of-concept for any of them.
- **Live-database verification of F-SEC6 and F-SEC7.** No PostgreSQL and no Docker were available in this environment; both rest on PostgreSQL type-resolution semantics and code reading.

**Confidence: Medium-High.** High on F-SEC1, F-SEC2, F-SEC5 and the dismissals (all either executed locally or proven by exhaustive search). Medium on F-SEC6 and F-SEC7 (mechanism unexecuted) and on F-SEC3/F-SEC9 (advisory data, reachability traced but not exploited).
