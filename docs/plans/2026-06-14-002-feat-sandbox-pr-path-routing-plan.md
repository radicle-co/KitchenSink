---
title: 'feat: Sandbox PR path routing — serve per-PR web previews under one origin'
type: feat
date: 2026-06-14
status: ready
depth: deep
origin: docs/architecture/decisions/0001-sandbox-front-end-addressing.md
---

# feat: Sandbox PR path routing

**Origin:** [ADR-0001](../architecture/decisions/0001-sandbox-front-end-addressing.md). This plan implements that decision's **path-routing** half. The manifest/static-resource mechanism and native mobile are explicitly out of scope here (separate, later).

## Summary

Make `https://sandbox.commise.app/pr-{N}/` route directly to the running web app for PR N, so every sandbox preview is live and usable under **one origin** (one Clerk `azp`). Each PR keeps its own build/deployment; a **singleton CloudFront distribution + CloudFront Function (runtime 2.0) + KeyValueStore (KVS)** at `sandbox.commise.app` dynamically selects that PR's origin from the path segment (host-swap only, path preserved). The web app builds with `basePath=/pr-{N}` so every route, asset, API call, and auth redirect already lives under the prefix — **including the Clerk middleware matcher, which `basePath` does NOT auto-prefix and which must be made prefix-aware explicitly.**

---

## Problem Frame

Sandbox previews must share **one origin** because Clerk's `azp` check is exact-string match (ADR-0001): per-PR subdomains would mint unlistable origins and 401 against the shared sandbox identity service. The chosen shape is one origin (`sandbox.commise.app`) with the PR in the URL path. The hard constraint the user set: **every in-app URL must be reachable under `/pr-{N}/`** — not just the landing page.

Research + a deep review of the live code (see Sources) establish the load-bearing facts:

1. Next.js `basePath` is the only clean way to get _all_ server-rendered paths under a prefix, and it is **build-time only** — so each PR needs its own build with its own `basePath`. A prefix-stripping proxy is documented-fragile; instead the app **natively owns** its `/pr-{N}` prefix and the router does a **host swap only**.
2. **`basePath` does NOT cover three things in this app**, all verified in-tree: `clerkMiddleware`'s `config.matcher` (Next applies basePath _after_ the matcher, so root-anchored patterns silently fail — turning protected routes public), client-side redirects that bypass the router (`api-client.ts` 401 → raw `/sign-in`; `LogoutButton` → `/`), and the Sentry `tunnelRoute`. These are fixed explicitly in U2, not assumed.
3. **Dynamic origin selection at the CloudFront edge no longer needs Lambda@Edge.** A CloudFront Function (JS runtime 2.0) on viewer-request can `cf.updateRequestOrigin({ domainName })` to an arbitrary external HTTPS host read from KVS — no cold starts, sub-millisecond, near-zero cost.
4. **Vercel Deployment Protection** is on for previews, so any external proxy must inject a **project-wide** `x-vercel-protection-bypass` token — which the CloudFront Function does on viewer-request, but a plain `vercel.json` rewrite cannot.

Today the web app is **Vercel-only** (not deployed to AWS, no CDK app in its workspace), `next.config.ts` sets no `basePath`, and Clerk uses default URLs — none of which work under a path prefix yet.

---

## Requirements

- **R1 — Single-origin reachability.** All sandbox PR previews are served from `https://sandbox.commise.app`, with PR N reachable at `/pr-{N}/`. (origin: ADR-0001)
- **R2 — Full-path coverage.** Every in-app URL — routes, `_next/static`, `next/image`, API/RSC requests, **middleware-protected routes**, and auth redirects — resolves and behaves correctly under `/pr-{N}/`. (user hard constraint)
- **R3 — One azp + auth integrity.** Every preview's browser origin is `sandbox.commise.app` (one `CLERK_AUTHORIZED_PARTIES` entry covers all PRs), and protected routes stay protected under the prefix. (origin: ADR-0001)
- **R4 — Per-PR isolation preserved.** Each PR runs its own app build/deployment behind the shared origin (not one runtime multiplexing PRs).
- **R5 — Portability / not Vercel-locked.** The routing layer and the app survive leaving Vercel; Vercel-specific logic is isolated to the CI capture step plus the bypass-token injection. (user steer: cost vs. long-term viability)
- **R6 — Lifecycle.** A PR's route appears when its preview is ready and is removed when the PR closes; the router itself is a long-lived singleton, deployed once.

## Success Criteria

- An unauthenticated visit to `https://sandbox.commise.app/pr-{N}/` redirects to `/pr-{N}/sign-in` (not `/sign-in`) and signs in; a protected route under the prefix is actually gated (not silently public).
- Navigating anywhere (deep links, client nav/RSC, refresh, assets, sign-out) stays under `/pr-{N}/` and works; the signed-in token's `azp` is `https://sandbox.commise.app` and passes the existing sandbox allowlist.
- Two PRs are simultaneously reachable at their own `/pr-{N}/` paths.
- Leaving Vercel later changes only what CI writes into KVS (Vercel host → ECS host) and drops the bypass token — not the router or the app.

---

## Key Technical Decisions

- **KTD1 — `basePath` per PR build, derived at build time.** Each PR build sets `basePath=/pr-{N}` and exposes `NEXT_PUBLIC_BASE_PATH=/pr-{N}` for runtime code; on Vercel the id comes from `VERCEL_GIT_PULL_REQUEST_ID` (or an explicit `PREVIEW_BASE_PATH` build arg off-Vercel); production gets none. Forced by `basePath` being build-time-inlined. Two consequences: the raw Vercel preview URL at _root_ 404s (cosmetic — users enter via the router), and because `typedRoutes` types are generated against the build's basePath, `npm run typecheck` (no PR id) types the no-prefix variant while preview builds are prefixed — a known env skew typecheck won't catch (noted in U1).
- **KTD2 — Router = singleton CloudFront + CloudFront Function (runtime 2.0) + KVS; host-swap only, no Lambda.** On viewer-request the function parses `/pr-{N}`, reads the PR's host from KVS, calls `cf.updateRequestOrigin({ domainName, customOriginConfig: { protocol: 'https', port: 443 }, hostHeader: host })` (the same host must drive **SNI**, not just the HTTP Host header, or Vercel TLS-routes the wrong deployment), injects the bypass header, and forwards the **unchanged** `/pr-{N}/...` URI. Caching is disabled (origin re-selected per request) — so CloudFront is a pure proxy here, not an asset CDN; acceptable at sandbox traffic. Chosen over Lambda@Edge and a Fargate proxy (Alternatives): cheapest (pennies/mo, no always-on cost), **no cold starts**, AWS-native, portable.
- **KTD3 — KVS holds per-PR host; the Vercel bypass secret is a single project-wide value, stored once.** `pr-{N} → host` per PR (written/cleared by CI); the bypass token is **one** project-wide secret (`VERCEL_AUTOMATION_BYPASS_SECRET`, not per-PR) stored under a fixed KVS key the function also reads, seeded once by the router deploy (KTD6). Rotating it is a **fleet-wide** event (rewrite the one key); do not model it as per-PR. When leaving Vercel, CI writes ECS hosts and the bypass key is removed — function and CloudFront unchanged (R5).
- **KTD4 — Vercel remains the (free) per-PR builder for now; portability prepared, not exercised.** The app gains `output: 'standalone'` + a Dockerfile so it is ECS-ready, but is not deployed to AWS here. Makes the exit a config change, not a rebuild.
- **KTD5 — App path-correctness is explicit, not inherited.** `basePath` auto-prefixes `next/link`, `next/router`, and (verified-by-test) server `redirect()`/`_next/*`. It does NOT cover: the `clerkMiddleware` `config.matcher` and `createRouteMatcher` patterns (must be rebuilt with the build-time prefix — else protection silently disables), Clerk URL props (`signInUrl` etc.), the Sentry `tunnelRoute`, and hardcoded client redirects (`api-client.ts`, `LogoutButton`, `navigation.ts`). `azp` itself needs nothing (origin-keyed).
- **KTD6 — Singleton router lifecycle is separate from the per-PR ephemeral model.** The distribution/function/KVS are deployed **once** (a persistent deploy, mirroring `sandbox-identity-deploy.yml`), never via the per-PR `sandbox-deploy.yml` (which destroys stacks on PR close and would tear the shared router down). Per-PR work is only KVS data writes (U5). This introduces the web workspace's first CDK app + `infra:*` scripts.

---

## High-Level Technical Design

Request flow for a signed-in user. The CloudFront Function host-swaps to the per-PR origin (preserving `/pr-{N}`) and injects the project-wide bypass token; the app, built with that `basePath`, owns every sub-path. Clerk talks to its FAPI directly from the browser (origin `sandbox.commise.app`), so `azp` is the single shared origin.

```mermaid
sequenceDiagram
    participant B as Browser (sandbox.commise.app/pr-123/…)
    participant CF as CloudFront + CF Function (viewer-request)
    participant KVS as KVS (pr-N → host; vercel-bypass → secret)
    participant App as PR-123 build (basePath=/pr-123, Vercel preview)
    participant FAPI as Clerk FAPI (sandbox dev instance)
    participant IdSvc as Shared sandbox identity svc

    B->>CF: GET /pr-123/profile (+ /pr-123/_next/* , ?_rsc= …)
    CF->>KVS: get("pr-123"), get("vercel-bypass")
    KVS-->>CF: host=<preview>.vercel.app ; secret
    Note over CF: updateRequestOrigin({domainName,hostHeader,SNI})\n+ x-vercel-protection-bypass header
    CF->>App: GET <preview>/pr-123/profile  (URI unchanged)
    App-->>B: HTML/assets, all URLs under /pr-123/
    B->>FAPI: ClerkJS token refresh (Origin: sandbox.commise.app)
    FAPI-->>B: session JWT (azp = https://sandbox.commise.app)
    B->>IdSvc: GET /v1/users/me  Authorization: Bearer <jwt>
    IdSvc-->>B: 200 (azp in the existing sandbox allowlist)
```

Lifecycle — the router is deployed once; CI only writes per-PR KVS data:

```mermaid
flowchart LR
    Once[One-time: deploy router stack\nCloudFront+CFF+KVS singleton] -.persists.-> Live
    PR[PR push] --> V[Vercel builds preview\nbasePath from VERCEL_GIT_PULL_REQUEST_ID]
    V --> CI[CI: poll preview until READY, capture host]
    CI --> W[KVS put pr-N → host  (ETag read-modify-write)]
    W --> Live[/pr-N/ live via CloudFront/]
    Close[PR closed] --> Del[KVS delete pr-N]
```

---

## Implementation Units

### U1. Per-PR `basePath` + standalone output in `next.config`

**Goal:** Builds emit all paths under `/pr-{N}` for PR previews, none for prod; app is container-ready.
**Requirements:** R2, R4, R5.
**Dependencies:** none.
**Files:** `packages/apps/commise/web/next.config.ts`; `packages/apps/commise/web/tests/next-config.test.ts` (new).
**Approach:** Derive the prefix at build: PR previews → `/pr-${VERCEL_GIT_PULL_REQUEST_ID}` (or explicit `PREVIEW_BASE_PATH`); production/empty → none. Set `basePath` and expose `NEXT_PUBLIC_BASE_PATH` (same value, '' when absent). Add `output: 'standalone'` + `outputFileTracingRoot` (monorepo root). The existing `tunnelRoute: '/sentry-tunnel'` must also be prefixed (or its handling reconciled with the middleware matcher in U2). Keep the Sentry wrapper.
**Patterns to follow:** existing `next.config.ts` (`withSentryConfig`); bracket-notation env access per CLAUDE.md.
**Test scenarios:**

- `VERCEL_GIT_PULL_REQUEST_ID=123` → `basePath='/pr-123'`, `NEXT_PUBLIC_BASE_PATH='/pr-123'`.
- Explicit `PREVIEW_BASE_PATH=/pr-7` → `/pr-7`.
- Neither set (production) → `basePath` empty, `NEXT_PUBLIC_BASE_PATH=''`.
- `output` is `'standalone'`. `Covers R5.`
- The resolved `tunnelRoute` is prefixed when a basePath is set.

---

### U2. App path-prefix correctness — Clerk middleware, redirects, tunnel (security-critical)

**Goal:** Every navigation/asset/auth redirect resolves under the prefix, AND protected routes stay protected under the prefix.
**Requirements:** R2, R3.
**Dependencies:** U1 (consumes `NEXT_PUBLIC_BASE_PATH`).
**Files:** `packages/apps/commise/web/src/middleware.ts` (**the matcher + `createRouteMatcher` patterns — basePath is NOT auto-applied here**); `packages/apps/commise/web/src/app/layout.tsx` (ClerkProvider URL props); `packages/apps/commise/web/src/lib/api-client.ts` (401 redirect already carries a prefixed `pathname`); `packages/apps/commise/web/src/lib/navigation.ts`; `packages/apps/commise/web/src/components/auth/LogoutButton.tsx`; new `packages/apps/commise/web/src/lib/base-path.ts`; any `next/image` `src`; `packages/apps/commise/web/tests/base-path.test.ts` + `packages/apps/commise/web/tests/middleware.test.ts` (new).
**Approach:** Add `withBasePath(path)` reading `NEXT_PUBLIC_BASE_PATH`. **Middleware (security-critical) — split the matcher concern:** `config.matcher` must stay _statically analyzable_ (Next reads it at build time, so an env-interpolated matcher is fragile/unsupported). Make it **prefix-tolerant with a literal regex** allowing an optional `pr-…/` segment before the exclusions — so the one static value works for both prod (no prefix) and previews. The protected-route check uses `createRouteMatcher`, which runs at module-eval (runtime), so build _its_ patterns WITH the prefix from `NEXT_PUBLIC_BASE_PATH` (inlined at build, readable at runtime). This keeps the matcher build-safe while protection is prefix-aware — no build-time-dynamic matcher. **Clerk URL props:** set `signInUrl`/`signUpUrl`/`signInFallbackRedirectUrl`/`signUpFallbackRedirectUrl`/`afterSignOutUrl` to prefixed values. **Client redirects:** `LogoutButton` `redirectUrl` and `navigation.ts` targets get `withBasePath`; in `api-client.ts`, prefix the `/sign-in` target but leave the `redirect_url` query value alone (it already contains the prefixed `window.location.pathname` — do not double-prefix). Leave `next/link`/`redirect()`/`useRouter` as-is but verify.

**Technical design** (directional, not implementation spec):

```js
const bp = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
// runtime call → prefix-aware protection
const isProtectedRoute = createRouteMatcher([`${bp}/profile(.*)`, `${bp}/account(.*)`, `${bp}/settings(.*)`]);
// static, prefix-tolerant exclusions (one value covers prod and /pr-N/)
export const config = {
    matcher: [
        '/((?!(?:pr-[^/]+/)?(?:_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|public/|sentry-tunnel)).*)',
        '/(?:pr-[^/]+/)?(api|trpc)(.*)',
    ],
};
```

**Execution note:** Write the failing `middleware.test.ts` first — assert `/pr-{N}/profile` is protected and `/pr-{N}/_next/static` / `/pr-{N}/sentry-tunnel` are excluded — since a silent matcher miss makes protected routes public.
**Patterns to follow:** existing `middleware.ts`, `lib/navigation.ts`, `lib/api-client.ts`; Clerk catch-all sign-in/up routes.
**Test scenarios:**

- `withBasePath('/sign-in')` → `/pr-123/sign-in` when set; `/sign-in` when empty (no `/undefined`, no double slash).
- **Middleware: `/pr-123/profile` is protected (`auth.protect` fires); `/pr-123/_next/static/x` and `/pr-123/sentry-tunnel` are excluded.** `Covers R3.`
- Unauthenticated GET `/pr-123/` server-redirects to `/pr-123/sign-in` (verifies `redirect()` basePath coverage). `Covers R2.`
- `api-client` 401 navigates to `/pr-123/sign-in?redirect_url=%2Fpr-123%2Fprofile` (prefix on target, not doubled on the param).
- ClerkProvider receives prefixed `signInUrl`/`afterSignOutUrl`; `LogoutButton` sign-out target is prefixed.
- Empty `NEXT_PUBLIC_BASE_PATH` (prod) leaves all of the above unchanged.

---

### U3. Per-PR preview build config + portability scaffolding

**Goal:** Vercel preview builds produce prefixed PR apps wired to sandbox backends; app is ECS-ready.
**Requirements:** R3, R4, R5.
**Dependencies:** U1.
**Files:** `packages/apps/commise/web/vercel.json`; Vercel project **Preview** env vars (documented here; set in dashboard); `packages/apps/commise/web/Dockerfile` (new, standalone); `packages/apps/commise/web/.env.template`.
**Approach:** Ensure preview builds expose `VERCEL_GIT_PULL_REQUEST_ID` so U1 derives basePath. Set Preview-scoped env: `NEXT_PUBLIC_API_BASE_URL` = the shared sandbox identity URL (one value, all PRs), sandbox Clerk `pk_test`. Record the project's Deployment Protection setting and where CI reads `VERCEL_AUTOMATION_BYPASS_SECRET` (KTD3). Add a Dockerfile running the standalone server (copying `.next/static` + `public`) for the future ECS path — built/validated, not deployed.
**Patterns to follow:** existing `vercel.json`; identity-service Dockerfile.
**Test scenarios:** `Test expectation: none — config/scaffolding.`
**Verification:** A preview build serves the app at `<preview>/pr-{N}/` with assets under the prefix; the Dockerfile builds and `node server.js` serves it under the prefix locally. (U1–U3 are independently validatable at `<preview>.vercel.app/pr-{N}/` before any router exists.)

---

### U4. Singleton router stack (CloudFront + CloudFront Function + KVS)

**Goal:** `sandbox.commise.app/pr-{N}/*` selects that PR's origin and forwards, preserving the path and bypassing Vercel protection.
**Requirements:** R1, R2, R4, R5, R6.
**Dependencies:** U3 (origins to point at). The KVS it creates is populated by U5 (one-way: U4 provisions, U5 writes — not circular).
**Files:** `packages/apps/commise/web/infra/lib/sandbox-router-stack.ts`; `packages/apps/commise/web/infra/bin/app.ts`; `packages/apps/commise/web/router/src/resolve.ts` (pure parse+decide, injectable KVS getter); `packages/apps/commise/web/router/src/router.cff.js` (CFF runtime-2.0 shell, bundled); `packages/apps/commise/web/router/tests/resolve.test.ts`; `packages/apps/commise/web/infra/__tests__/sandbox-router-stack.test.ts`; web `package.json` (`infra:*` scripts + esbuild bundle step); `.github/workflows/sandbox-router-deploy.yml` (new — deploys this singleton stack once / on change, mirroring `sandbox-identity-deploy.yml`; NOT the per-PR `sandbox-deploy.yml`).
**Approach:** A CloudFront distribution on `sandbox.commise.app` (Route53 alias, a placeholder default origin, caching disabled) with a viewer-request CloudFront Function and an attached `KeyValueStore`. **Cert (resolved):** `DEFAULT_AWS_REGION=us-east-1` is confirmed and the existing `*.commise.app`/`*.sandbox.commise.app` cert is already in us-east-1 — **import it** and pin this stack's `env.region` to `us-east-1`; no new cert/validation. **Function:** parse `pr-{N}` from `request.uri`; KVS `get(host)` + `get(bypass)`; absent host → 404; else `updateRequestOrigin({ domainName: host, customOriginConfig:{protocol:'https',port:443}, originSslProtocols, hostHeader: host })` and set `request.headers['x-vercel-protection-bypass']`. Seed the single `vercel-bypass` KVS key as part of _this_ one-time deploy (not per-PR CI). Keep parse/decide in `resolve.ts` (unit-tested with an injected getter); the `.cff.js` shell does the CFF-global side effects and is **bundled by esbuild into a single self-contained <10 KB artifact** (repo precedent: the webhook esbuild bundling) since CFF has no module resolution.
**Patterns to follow:** `packages/services/identity/infra/lib/*` (ACM/Route53/CDK), the infra test harness in `packages/services/identity/infra/__tests__/stacks.test.ts`; `aws-cdk-lib` `KeyValueStore` + `FunctionRuntime.JS_2_0` + `Function.keyValueStore`; the webhook esbuild bundling for the function artifact.
**Test scenarios:**

- `resolve('/pr-123/profile', getter)` → host from KVS, URI unchanged (`/pr-123/profile`). `Covers parse/decide for R2` (origin-override + header injection are CFF side effects, verified by the smoke in Open Questions, not this unit test).
- Unknown PR (`pr-999` absent) → 404, no override. `Covers R6.`
- Malformed path (`/`, `/notapr/...`) → 404, never throws.
- An RSC-style request (`/pr-123/profile?_rsc=abc`) resolves the same host, URI+query preserved.
- CDK template: a CloudFront distribution with a viewer-request function association, an attached KeyValueStore, a us-east-1 ACM cert, caching disabled, and a Route53 alias for `sandbox.commise.app`. `Covers R1.`

---

### U5. CI lifecycle — populate/clear KVS per PR

**Goal:** A PR's `/pr-{N}/` route goes live when its preview is ready and is removed on close.
**Requirements:** R5, R6.
**Dependencies:** U4 (the KVS this writes to).
**Files:** `.github/workflows/sandbox-web-preview.yml` (new) and/or a job in `.github/workflows/sandbox-deploy.yml`; `packages/apps/commise/web/scripts/register-preview.ts` + `packages/apps/commise/web/scripts/__tests__/register-preview.test.ts`; web `package.json` (add `@aws-sdk/client-cloudfront-keyvaluestore`).
**Approach:** On PR sync, after the Vercel preview is `READY` (poll the Vercel API; token in CI secrets — greenfield, no repo precedent), capture its host and **read-modify-write** KVS: `DescribeKeyValueStore` → `PutKey` with the returned `IfMatch` ETag; retry on ETag conflict (concurrent PRs share the store). On PR close, `DeleteKey`. Discover the KVS ARN from the U4 stack's CloudFormation output. Seed the single `vercel-bypass` key once (out-of-band or in the router deploy). Keep the Vercel-specific capture isolated in `register-preview.ts` so the post-Vercel swap is one file (R5).
**Patterns to follow:** the per-service change-gated jobs + AWS-credential action in `sandbox-deploy.yml`; the CFN-output-read pattern for the KVS ARN.
**Test scenarios:**

- Given a ready host, `register-preview` issues `DescribeKeyValueStore` then `PutKey` for `pr-{N}` with the ETag (mock the SDK).
- ETag-conflict on `PutKey` → re-describe and retry; succeeds on the second attempt.
- Deregister path issues `DeleteKey` for `pr-{N}`.
- Missing/!READY preview → step fails loudly (no silent/empty write). `Covers R6.`
  **Verification:** With the router already deployed (U4/KTD6), opening a PR makes `sandbox.commise.app/pr-{N}/` resolve; closing it removes the route.

---

### U6. Record the architecture in ADR-0001 + point-of-edit guards

**Goal:** Update ADR-0001 to reflect the realized path-routing architecture and install the path-routing tripwires.
**Requirements:** R5 (preserve the decision against accidental reversion).
**Dependencies:** U1, U2, U4.
**Files:** `docs/architecture/decisions/0001-sandbox-front-end-addressing.md`; guard comments at `packages/apps/commise/web/next.config.ts`, `packages/apps/commise/web/src/middleware.ts`, and the router (`packages/apps/commise/web/router/src/router.cff.js` / `sandbox-router-stack.ts`).
**Approach:** Set the ADR status to `Accepted — path routing implemented (PR for this plan); manifest + mobile deferred` and replace the "implementation pending" framing with the realized mechanism (basePath-per-build + CloudFront/CFF/KVS host-swap + project-wide bypass injection). **Reconcile the ADR's "Implementation guards" list with reality:** the path-routing guard sites are `next.config.ts` (basePath derivation), `middleware.ts` (the prefix-aware matcher — the thing most likely to be "simplified" back into a security hole), and the router; the ADR's previously-listed `clerkAuth.service.ts` / `env.schema.ts` are the _azp_ tripwires already covered by PR #39 + the CLAUDE.md entry — note that, don't duplicate. Add the `// ⚠️ DELIBERATE — see docs/architecture/decisions/0001` comments at the three path-routing sites.
**Test scenarios:** `Test expectation: none — docs/comments.`
**Verification:** ADR status reflects reality; the three path-routing guard sites carry the comment; the ADR's guard list matches what was actually annotated.

---

## Scope Boundaries

**In scope:** per-PR `basePath` builds, app path-prefix correctness (Clerk middleware matcher, URL props, redirects, Sentry tunnel), the singleton CloudFront/CFF/KVS router + project-wide Vercel bypass handling, CI KVS lifecycle, portability scaffolding (`standalone` + Dockerfile), ADR closure + guards.

**Deferred for later** (origin ADR-0001):

- The **manifest query-param / static-resource mechanism** — separate implementation; explicitly excluded by the user.
- **Native mobile** PR-namespace routing (azp-exempt; rides with the manifest work).

### Deferred to Follow-Up Work

- **Actually leaving Vercel** — deploying the per-PR app to ECS/Fargate and writing ECS hosts into KVS (dropping the bypass key). Prepared here (`standalone` + Dockerfile + edge-local KVS map), not executed.

**Outside this change:** production routing/auth (prod is a single stable origin), identity-service token verification (shipped, PR #39).

---

## Risks & Dependencies

### Dependencies

- A **Vercel API token** in CI secrets (preview-URL capture) and the project-wide **`VERCEL_AUTOMATION_BYPASS_SECRET`** seeded into KVS once (KTD3).
- Vercel **Preview** env vars set (sandbox `pk_test`, `NEXT_PUBLIC_API_BASE_URL` = shared sandbox identity) — dashboard step, documented in U3.
- The existing **us-east-1** `*.commise.app`/`*.sandbox.commise.app` ACM cert (CloudFront constraint; confirmed `DEFAULT_AWS_REGION=us-east-1`, so reusable) — imported by the router stack (U4).
- `@aws-sdk/client-cloudfront-keyvaluestore` added to the web workspace (U5); the web workspace's **first** CDK app + `infra:*` scripts (U4).
- A **persistent deploy trigger** for the singleton router stack (mirror `sandbox-identity-deploy.yml`), distinct from the per-PR `sandbox-deploy.yml` (KTD6).

### Risks

- **`basePath` does NOT prefix the Clerk middleware matcher (verified).** Left unfixed, `createRouteMatcher` misses `/pr-{N}/profile` → protection silently disables (security inversion). **Mitigation (decided in U2):** a static, prefix-tolerant `config.matcher` regex (optional `pr-…/` segment — build-safe) + `createRouteMatcher` patterns built at runtime from `NEXT_PUBLIC_BASE_PATH`; test-first assertion that `/pr-{N}/profile` is protected and `/pr-{N}/_next/*` + `/pr-{N}/sentry-tunnel` are excluded.
- **Server `redirect()` basePath coverage is the unauth-landing gate.** **Mitigation:** explicit U2 test that `/pr-{N}/` redirects to `/pr-{N}/sign-in`; if Next doesn't prefix it, fall back to `withBasePath` at the redirect sites.
- **`updateRequestOrigin` to an external host — SNI + DNS.** Vercel routes by SNI/Host; the function must drive both, and the host must be DNS-resolvable or CloudFront 502s. **Mitigation:** U4 smoke test (Open Questions) before relying on it.
- **Bypass secret is project-wide; rotation is fleet-wide.** Rotating `VERCEL_AUTOMATION_BYPASS_SECRET` 401s all previews until the single KVS key is re-seeded. **Mitigation:** one key, documented rotation runbook; never log it.
- **Singleton router = SPOF for all sandbox previews; caching disabled = no asset CDN.** Acceptable at sandbox traffic/cost; run with CloudFront's managed availability.
- **CI preview-ready race + KVS ETag conflicts** (concurrent PRs). **Mitigation:** poll-until-READY, fail loudly; read-modify-write with retry (U5).
- **`typedRoutes` + env-derived basePath → typecheck/build skew** (KTD1) — typecheck runs the no-prefix variant. Low risk; note, don't gate.
- **basePath breaks the raw Vercel preview link** (root 404) — cosmetic; guarded in U6.

### Assumptions

- Vercel auto-builds a preview for every PR (GitHub integration connected — a passing "Vercel" check confirms it).
- All sandbox previews target the **one shared** sandbox identity service (single `NEXT_PUBLIC_API_BASE_URL`).
- The Vercel project uses Standard Deployment Protection on previews (the common default; confirmed in U3) and honors stateless header bypass without a redirect-to-set-cookie (verified in U4 smoke).

---

## Alternatives Considered

- **CloudFront + Lambda@Edge (origin-request).** The historically-required way to do dynamic origin selection. Superseded: cold starts, heavier replication/deploy, higher per-invoke cost; its edge (request-time DynamoDB/SSM, cache-miss-only) is unneeded — the map is tiny and edge-local in KVS. Keep only if routing needs a data source KVS can't hold.
- **Always-on Fargate reverse-proxy.** Simplest mental model, maximally portable, but ~$9/mo always-on + a SPOF task + config-reload overhead for no benefit over CFF+KVS at this traffic. Rejected on cost.
- **Vercel Middleware + Edge Config.** Zero marginal cost, cleanest bypass injection, but Vercel-locked (rebuilt on exit) and external-host `NextResponse.rewrite()` is doc-unverified. Rejected against R5.
- **Vercel rewrites (`vercel.json`).** Cannot inject the `x-vercel-protection-bypass` header (disqualifying) and forces a router redeploy per PR. Rejected.
- **API Gateway / ALB.** API Gateway needs a Lambda for dynamic upstream (no edge benefit); ALB cannot target external Vercel hosts and costs ~$16/mo fixed. Rejected.
- **Per-PR subdomains + prod-only `azp` (the ADR's own documented fallback).** One `env.schema.ts` change, zero CloudFront/CFF/basePath/bypass — far less surface than this plan. ADR-0001 rejected it to keep `azp` enforced in sandbox; **if U2/U4's correctness surface proves expensive in execution, reconsider this with the ADR owner rather than pushing through.** Recorded so the cheaper escape hatch stays visible.

---

## Open Questions (for implementation)

- **CFF runtime-2.0 `updateRequestOrigin` smoke to an external Vercel host** — confirm DNS re-resolution per request, that `hostHeader` + SNI both carry the Vercel host (correct deployment + TLS), caching-disabled behavior, and that the project-wide bypass header alone authenticates with no redirect-to-set-cookie. Settle in U4 before relying on KTD2. (This is the single biggest remaining unknown; everything else is verified or decided.)
- **Exact preview-ready capture** (Vercel API poll vs. a marketplace action) — execution detail for U5.

---

## Sources & Research

Codebase (verified in review): web is Vercel-only (`packages/apps/commise/web/vercel.json`; not in `sandbox-deploy.yml`; no CDK app/`infra:*` scripts in its `package.json`); `next.config.ts` has no `basePath`/`assetPrefix`/`output` and sets `typedRoutes:true` + `tunnelRoute:'/sentry-tunnel'`; `src/middleware.ts` uses a hardcoded root-anchored `config.matcher` + `createRouteMatcher(['/profile(.*)',…])` (not basePath-aware); server `redirect('/sign-in' as Route)` on `app/page.tsx` + `profile/account/settings`; `src/lib/api-client.ts` 401 → `navigateTo('/sign-in?redirect_url='+window.location.pathname)`; `src/lib/navigation.ts` raw `window.location.assign`; `LogoutButton` `signOut({redirectUrl:'/'})`; `*.commise.app`/`*.sandbox.commise.app` cert in `packages/infra/global/lib/identity/DomainStack.ts` created in `DEFAULT_AWS_REGION`; `aws-cdk-lib@2.254.x` has L2 `KeyValueStore` + `FunctionRuntime.JS_2_0`.

External (load-bearing):

- Next.js [`basePath`](https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath) (build-time-inlined; `next/image` `src`, raw `fetch`/`<a>`, and **middleware `config.matcher`** are not auto-prefixed), [`output: 'standalone'`](https://nextjs.org/docs/app/api-reference/config/next-config-js/output); reverse-proxy-prefix fragility [#16588](https://github.com/vercel/next.js/discussions/16588)/[#54751](https://github.com/vercel/next.js/discussions/54751).
- **CloudFront Function dynamic origin (runtime 2.0):** [origin-modification helpers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/helper-functions-origin-modification.html) — "the origin set by `updateRequestOrigin()` can be any HTTP endpoint"; [KeyValueStore](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions.html); [CFF restrictions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-function-restrictions.html). Pricing: CFF $0.10/M, KVS reads $0.03/M (2M free) vs [Lambda@Edge](https://aws.amazon.com/lambda/pricing/)/[Fargate](https://aws.amazon.com/fargate/pricing/)/[ALB](https://aws.amazon.com/elasticloadbalancing/pricing/).
- **Vercel Deployment Protection / bypass:** [Deployment Protection](https://vercel.com/docs/deployment-protection) ("authentication required for all requests, including Routing Middleware"); [Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation) (`x-vercel-protection-bypass`; project-wide `VERCEL_AUTOMATION_BYPASS_SECRET`); [Rewrites](https://vercel.com/docs/rewrites) (no header injection).
- Clerk [`<ClerkProvider>`](https://clerk.com/docs/nextjs/reference/components/clerk-provider) (URL props explicit, not basePath-aware), [`clerkMiddleware`](https://clerk.com/docs/references/nextjs/clerk-middleware), [`verifyToken`/`authorizedParties`](https://clerk.com/docs/reference/backend/verify-token) (`azp` origin-keyed).

_Unverified (gated by execution tests/smoke):_ server `redirect()` basePath coverage (U2 test); `clerkMiddleware` matcher behavior under `basePath` (U2 test-first); `updateRequestOrigin` external-host SNI/DNS + stateless bypass (U4 smoke); exact CFF compute-time budget.
