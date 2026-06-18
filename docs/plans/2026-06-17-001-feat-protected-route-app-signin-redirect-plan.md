---
title: 'feat: Bounce signed-out users on protected routes to the app /sign-in'
type: feat
date: 2026-06-17
status: planned
---

# feat: Bounce signed-out users on protected routes to the app /sign-in

## Summary

Protected routes (`/profile`, `/account`, `/settings`) currently bounce signed-out users to Clerk's **hosted Account Portal** (`*.accounts.dev` / the prod portal), because `clerkMiddleware`'s `auth.protect()` has no `signInUrl` configured. This is inconsistent with the rest of the app, which uses **custom** Clerk `<SignIn>`/`<SignUp>` pages — the home page already bounces signed-out users to the app's own `/sign-in`. This plan makes the middleware send protected-route bounces to the app `/sign-in` too, correctly prefixed under the preview `basePath`, and tightens the route-protection e2e tests (which today assert leniently _because_ of this gap) to lock the behavior in.

This was surfaced by the auth e2e suite added on `feat/reliable-create-user-flow` (the route-protection spec had to assert a lenient `sign-in|sign-up` surface because the bounce left the app origin entirely).

---

## Problem Frame

- **Today:** signed-out request to `/pr-{N}/profile` → `clerkMiddleware` `auth.protect()` → 307 to `https://<instance>.accounts.dev/sign-(in|up)?redirect_url=…` (the hosted portal, a different origin).
- **Wanted:** signed-out request to a protected route → redirect to the app's own `/sign-in` page (`/pr-{N}/sign-in` under a preview, `/sign-in` in production) — the same custom page the home-page bounce and the sign-up "Sign in" link already use.
- **Why it matters:** the app ships custom auth pages with bespoke appearance + redirect handling. Bouncing protected routes to the hosted portal is a jarring, inconsistent UX and bypasses that handling. The home page (`src/app/page.tsx`) already does the right thing via a Next server `redirect('/sign-in')`; the middleware is the lone outlier.

**In scope:** the middleware redirect destination for protected-route bounces, and the e2e assertions that pin it.
**Out of scope:** the sign-in/sign-up page flows themselves, the home-page redirect (already correct), and return-to-original-route behavior (see Scope Boundaries).

---

## Requirements

- **R1.** A signed-out request to any protected route (`/profile`, `/account`, `/settings`, and their subpaths) redirects to the app's own `/sign-in` page, not the hosted Clerk portal.
- **R2.** Under a preview `basePath` (`/pr-{N}`), the redirect lands on `/pr-{N}/sign-in` exactly once — never the bare `/sign-in` (404 under basePath) and never the double-prefixed `/pr-{N}/pr-{N}/sign-in`.
- **R3.** In production (empty basePath), the redirect lands on `/sign-in`.
- **R4.** Signed-in users are still allowed through to protected routes (no regression to `auth.protect()`'s core behavior).
- **R5.** The `config.matcher` / basePath-stripping invariant documented in `middleware.ts` (ADR-0001) is preserved — the protected-route matcher stays root-anchored and is not given a `/pr-{N}` prefix.
- **R6.** The existing auth e2e suite (sign-in/up form completion, signed-in→home redirects, sign-out) stays green — the change must not disturb the dev-instance handshake or the signed-in flow.

---

## Key Technical Decisions

### KTD1 — Configure the redirect destination on `clerkMiddleware`, don't hand-roll a redirect

Prefer telling Clerk where the app's sign-in lives over replacing `auth.protect()` with a manual `NextResponse.redirect`. Two viable mechanisms (the exact one is an implementation-time choice, see Open Questions):

- **Preferred — `clerkMiddleware`'s `signInUrl` option:** `clerkMiddleware(handler, { signInUrl: <app-sign-in> })`. This also teaches Clerk which route _is_ the sign-in page (relevant to handshake/redirect logic), not just where to bounce. Mirrors the intent already declared on `ClerkProvider` (`signInUrl={withBasePath('/sign-in')}` in `src/app/layout.tsx`).
- **Fallback — `auth.protect({ unauthenticatedUrl })`:** pass an explicit absolute URL when the option-level `signInUrl` doesn't honor the basePath cleanly.

A fully hand-rolled `NextResponse.redirect` (Option C) is the last resort — it reintroduces the basePath/host concerns Clerk already handles and risks diverging from Clerk's handshake behavior.

### KTD2 — `signInUrl` carries the basePath (it's a locator), and BOTH preview and production shapes must be verified

The middleware runs on **basePath-stripped** paths (ADR-0001 comment in `middleware.ts`), but Clerk's `clerkMiddleware` builds the sign-in redirect as an **absolute URL** and emits it via `NextResponse.redirect`, which does **not** re-apply Next's `basePath` — unlike `next/navigation`'s server `redirect()`, which does (that is why the home page works with a bare path). `signInUrl` is therefore a **locator** prop consumed as-is, the same category as `ClerkProvider`'s `signInUrl={withBasePath('/sign-in')}` in `src/app/layout.tsx`. So the value must **carry the prefix**: use `withBasePath('/sign-in')` — a runtime-aware value that is a no-op `/sign-in` in production (empty base path) and `/pr-{N}/sign-in` under a preview. A bare `/sign-in` would 404 under a preview basePath; a hardcoded `/pr-{N}/sign-in` would break production. This is the same locator-vs-redirect distinction that governed the `forceRedirectUrl` fix and the reverted server-`redirect()` double-prefix (commit `9d8e86a`).

The route-protection e2e is the verification gate, but it must cover **both** shapes:

- **Preview** (`PREVIEW_BASE_PATH=/pr-e2e`, the default suite run) asserts `isRoute(pathname, '/sign-in')` AND `!hasDoublePrefix(pathname)`.
- **Production** (`E2E_BASE_PATH=''`) must **also** be run as a done-criterion — in that shape `hasDoublePrefix` is inert (empty prefix) and `isRoute('/sign-in')` accepts the bare path, so the prod path is NOT meaningfully verified by the default run. Prod correctness rests on the `E2E_BASE_PATH=''` run confirming the chosen value resolves to `/sign-in` on the app origin there too.

### KTD3 — After signing in, land on home (no return-to), matching current behavior

A signed-out user bounced from `/profile` to `/sign-in`, after authenticating, lands on the **home page** — not back on `/profile`. This matches the app's existing design: every `<SignIn>`/`<SignUp>` sets `forceRedirectUrl='/'`, which already overrides any `redirect_url`. Preserving/honoring a return-to is deferred (see Scope Boundaries) to keep this change minimal and behavior-consistent. Practically: we do not need to thread a `redirect_url` through; even the hosted portal's `redirect_url` is currently ignored by `forceRedirectUrl`.

---

## Implementation Units

### U1. Redirect protected-route bounces to the app `/sign-in` in the middleware

**Goal:** Signed-out users on protected routes are sent to the app's own `/sign-in` (correctly basePath-prefixed), not the hosted Clerk portal.

**Requirements:** R1, R2, R3, R4, R5, R6

**Dependencies:** none

**Files:**

- `packages/apps/commise/web/src/middleware.ts` (modify)

**Approach:**

- Configure `clerkMiddleware` with the app sign-in destination per KTD1 (preferred: the `signInUrl` option; fallback: `auth.protect({ unauthenticatedUrl })`).
- Use the basePath-aware value per KTD2 — `withBasePath('/sign-in')` (matching `ClerkProvider`'s `signInUrl` in `layout.tsx`), NOT a bare path: Clerk's middleware emits an absolute-URL redirect that bypasses Next's basePath, so the prefix must live in the value. Confirm against the e2e oracle in BOTH the preview and production shapes (U2).
- **Do not** alter `isProtectedRoute` or `config.matcher`, and do not add a `/pr-{N}` prefix to the matcher — preserve the ADR-0001 basePath-stripping invariant (R5). Keep / extend the existing explanatory comment to record why the `signInUrl` value is `withBasePath`-wrapped (locator prop, not a Next-router redirect), so the next reader doesn't "fix" it to a bare path.

**Patterns to follow:**

- `src/app/layout.tsx` — `ClerkProvider signInUrl={withBasePath('/sign-in')}` is the right precedent: a Clerk **locator** prop carries the basePath, and the middleware's `signInUrl` is the same category.
- `src/app/page.tsx` — the home page's bare `redirect('/sign-in')` works because `next/navigation`'s server `redirect()` auto-applies basePath; the middleware does NOT (it emits an absolute-URL `NextResponse.redirect`), so do not copy the bare form from here.
- The existing `middleware.ts` ADR-0001 comment block — keep its invariants intact.

**Execution note:** Confirm the redirect lands correctly via the U2 e2e in BOTH the preview (`/pr-e2e`) and production (`E2E_BASE_PATH=''`) shapes — the production shape is the one the default oracle run does not meaningfully verify.

**Test scenarios:** behavior is asserted by U2's e2e (this unit has no separate unit-test surface — `middleware.ts` is config wiring). `Test expectation: covered by U2 e2e.`

**Verification:**

- The U2 route-protection e2e passes under `PREVIEW_BASE_PATH=/pr-e2e`: protected routes land on `/pr-e2e/sign-in`, single-prefixed, on the app origin (not `accounts.dev`).
- The U2 route-protection e2e also passes under `E2E_BASE_PATH=''` (production shape): protected routes land on `/sign-in` on the app origin.
- The full existing web auth e2e suite stays green (signed-in→home redirects, sign-in/up form completion, sign-out) — confirming the dev-instance handshake and signed-in flow are undisturbed (R6).

### U2. Tighten the route-protection e2e to assert the app `/sign-in` destination

**Goal:** Lock in the corrected behavior — protected routes redirect to the app's own `/sign-in`, single-prefixed — replacing the lenient `sign-in|sign-up` assertion that exists only because of the current gap.

**Requirements:** R1, R2, R3

**Dependencies:** U1

**Files:**

- `packages/apps/commise/web/tests/e2e/route-protection.spec.ts` (modify)

**Approach:**

- For each protected route (`/profile`, `/account`, `/settings`): replace the lenient `toHaveURL(/sign-in|sign-up/)` + "protected heading not visible" check with the strict pair already used elsewhere in the suite: `await expect.poll(() => isRoute(pathnameOf(page), '/sign-in')).toBe(true)` and `expect(hasDoublePrefix(pathnameOf(page))).toBe(false)` (helpers in `tests/e2e/utils/base-path.ts`).
- Remove the "bounces to Clerk's hosted Account Portal" note now that the app `/sign-in` is the destination; keep a one-line note that the assertion intentionally pins the app origin.
- Keep the "home `/` redirects to the app sign-in" and "auth pages reachable" tests as-is.

**Patterns to follow:**

- `tests/e2e/route-protection.spec.ts`'s own "home / redirects to the app sign-in" test (already uses the strict `isRoute('/sign-in')` form).
- `tests/e2e/utils/base-path.ts` — `route`, `isRoute`, `hasDoublePrefix`, `pathnameOf`.

**Test scenarios:**

- Happy path: signed-out GET `/profile` → lands on `/pr-e2e/sign-in` (app origin), single-prefixed. (Covers R1, R2.)
- Repeat for `/account` and `/settings` (parameterized).
- Negative: the final pathname does NOT contain `/pr-e2e/pr-e2e` (no double-prefix). (Covers R2.)
- Negative: the final URL host is the app (localhost dev server), not `accounts.dev`. (Covers R1 — pins the app origin, not the hosted portal.)
- Production shape: the same protected-route assertions pass with `E2E_BASE_PATH=''` — the redirect lands on `/sign-in` on the app origin. Note `hasDoublePrefix` is inert under an empty prefix, so this run pins the prod path via `isRoute('/sign-in')` + app-origin, not via the double-prefix guard. (Covers R3.)
- Unchanged-by-design: home `/` → app `/sign-in`; `/sign-in` and `/sign-up` reachable without auth.

**Verification:** the route-protection spec is green in BOTH shapes — the default preview run (`PREVIEW_BASE_PATH=/pr-e2e`) and the production run (`E2E_BASE_PATH=''`) — with assertions now strict (app `/sign-in`, single-prefix, app origin). Running the spec against the _pre-U1_ middleware would fail — confirming the test actually pins the new behavior.

---

## Risks & Dependencies

- **basePath double-prefix / dropped-prefix (primary risk).** The `signInUrl` value could land on bare `/sign-in` (404 under basePath) or `/pr-{N}/pr-{N}/sign-in` (double-prefix). Mitigation: the U2 e2e oracle catches both; resolve the value empirically (KTD2). This is the highest-uncertainty part of the change.
- **Dev-instance handshake regression.** Setting `signInUrl` changes what Clerk considers the sign-in route, which interacts with the dev-instance handshake. Mitigation: R6 — the full existing auth suite (which exercises the handshake via sign-in token + form flows) must stay green.
- **ADR-0001 matcher invariant.** Touching `middleware.ts` risks a well-meaning edit to `config.matcher` / `isProtectedRoute` that silently turns protected routes public. Mitigation: U1 explicitly does not touch the matcher; the route-protection e2e would catch a public-route regression.
- **Prod vs preview divergence (oracle blind spot).** Production has an empty basePath; the fix must work in both. The default e2e run only exercises the preview shape, and `hasDoublePrefix` is inert under an empty prefix — so the production path is NOT verified unless the spec is also run with `E2E_BASE_PATH=''`. Mitigation: make the `E2E_BASE_PATH=''` run a required done-criterion (R3); the runtime-aware `withBasePath('/sign-in')` value (KTD2) is correct in both shapes, so a single value satisfies both runs.

---

## Scope Boundaries

### Deferred to Follow-Up Work

- **Return-to-original-route after sign-in.** Sending the user back to the originally-requested protected route (`/profile`) instead of home would require honoring a `redirect_url` and reconciling it with the `<SignIn>` `forceRedirectUrl='/'` that currently overrides it. Deferred per KTD3 to keep this change minimal and behavior-consistent.

### Out of Scope

- The sign-in / sign-up page flows and their `forceRedirectUrl` (already fixed on this branch).
- The home-page redirect (already targets the app `/sign-in`).
- Any change to which routes are protected (`isProtectedRoute` membership).

---

## Open Questions / Implementation-Time Unknowns

- **Exact mechanism (resolve at execution).** The redirect _value_ is settled — `withBasePath('/sign-in')` (KTD2). The remaining choice is the mechanism: `clerkMiddleware({ signInUrl })` (preferred) vs `auth.protect({ unauthenticatedUrl })` — both consume the same prefixed value, and both APIs exist in `@clerk/nextjs` ^6.39.4. If neither yields a single-prefixed, app-origin redirect under basePath (verify via the U2 e2e in both shapes), fall back to a hand-rolled `NextResponse.redirect(withBasePath('/sign-in'))`, accepting the documented basePath/host responsibility — do not leave "neither works" as an unhandled branch.
