# 0047 — One CORS policy for every browser-facing service, and it holds only for a bearer-only service

- **Status:** Accepted
- **Date:** 2026-10-01
- **Relates to:** [ADR-0033](0033-sandbox-previews-on-per-pr-subdomains.md): the anchored `azp` pattern this policy is
  derived from. [ADR-0003](0003-shared-alb-per-stage.md): every service is on a public ALB, so CORS is a browser
  boundary and never an access control. [ADR-0020](0020-cloudfront-edge-and-internal-alb-hostnames.md): the production edge's cache keys.
- **Plan:** `docs/plans/2026-09-20-002-feat-ingredient-lookup-grain-and-food-search-decoupling-plan.md` (R41, S1, S4)

## Context

Recipe and identity each built their own CORS options. The two modules differed in one input only: how each decides
whether it is running on a deployed task. Food needs the same boundary before the apps can call it directly (R41). A
third copy can drift like the first two did.

Two mistakes had already shipped in those copies. An empty party list became `origin: true`, which reflects any origin
with credentials, on sandbox and on every preview. And `origin: false` looks like "closed" but takes the CORS
middleware out of the request path, so a denial becomes an accident of absence: no `Vary: Origin` for caches, and the
preflight answered by the router.

The origins a service must admit are the origins the Clerk `azp` check admits. Two lists can disagree.

On sandbox the policy admits a family of origins (the anchored preview pattern), and on a developer machine every
loopback origin. That is safe only while a page on an admitted origin has nothing to ride: no cookie, no session, and
no WebSocket. A browser sends cookies by itself, and it applies no CORS check to a WebSocket handshake. On sandbox the
Clerk development instance reflects any origin, so the anchored `azp` pattern is the real trust boundary there, not
CORS. Both copies said this in a comment, and each guarded it with its own test. The two tests had drifted: neither
looked for a WebSocket upgrade, and only recipe's proved that its scan reached the code that authenticates.

## Decision

1. **One policy.** `resolveCorsPolicy` in `@kitchensink/clerk-verify` decides the admitted origins. It sits beside
   `resolveAzpEnforcement` and is derived from it, so the CORS boundary and the `azp` boundary cannot differ. It has
   four named modes: an exact party list (prod), the anchored preview pattern (deployed non-prod), loopback (not
   deployed, nothing configured), and closed (deployed, nothing configured).
2. **The origin is always a list.** The type cannot express `true`, so a renamed parameter cannot turn prod into an
   any-origin reflector. Closed is an empty list, not `false`, so the middleware stays in the path and denies by
   failing the match.
3. **Credentials are off unless an adopter asks.** A bearer-only service has no cookie to send. With
   `Access-Control-Allow-Credentials: true`, a same-site cookie riding an `include` fetch would be readable by every
   admitted origin, which on sandbox is any preview page, the day a cookie read slipped past the guard. An adopter
   that still has a browser client sending `include` passes `credentials: true` and names that client beside it.
4. **The browser can read `Retry-After` and can cache a preflight.** The policy exposes `Retry-After`, which every
   `429` and `503` carries. It also sets a ten-minute `Access-Control-Max-Age`, so a browser stops sending a
   preflight before almost every request.
5. **Each adopter has an adapter, and the adapter decides one thing.** An adopter's `src/config/cors.ts` turns the
   variable its own config schema checks into `deployed`. An unrecognised value counts as deployed. The adapter adds no
   other behaviour, except that point 3 lets it ask for credentials. Identity asks today, because the web app's
   identity client sends `include`. `main.ts` installs the policy with `enableCors` before `listen`, and logs the
   mode. Which packages adopt the policy is not listed here: the guard in point 7 finds them.
6. **An adopter must be bearer-only.** A package that calls `resolveCorsPolicy` reads no cookie or session, declares no
   cookie, session or WebSocket package, and accepts no WebSocket upgrade. It authenticates from the `Authorization`
   header and nothing else.
7. **One guard enforces it, and it finds its own subjects.**
   `packages/infra/global/__tests__/bearerOnlyPrecondition.test.ts` scans the tree for every package that imports or
   calls `resolveCorsPolicy`. A new adopter is covered the day it adopts, with no step of its own. Every package that
   turns CORS on by any route must be one of them, so a hand-rolled CORS setup cannot escape. For each adopter the
   guard reads the TypeScript syntax tree of its own `src/` and of the `src/` of every workspace package it declares
   as a runtime dependency, followed to any depth. A cookie read in shared middleware is as reachable as one in the
   service. It does not search the text, because the prose that explains the rule names the things it forbids. It
   also flags Clerk's request authenticators (`authenticateRequest`, `clerkMiddleware`, `@clerk/express`), which read
   the session cookie when no bearer is sent. A second, independent walk finds every file that reads the
   `Authorization` header, and the guard proves that its scan reached each one and reached the package that declares
   the policy.
8. **The guard lives in a test package, not in `clerk-verify`.** It reads other packages' source. A library that scans
   its consumers inverts the dependency, and `clerk-verify` ships inside every service image. `packages/infra/global`
   already owns the repo-wide guards and the one shared walk they use (`serviceSources.ts`).
9. **A cache in front of a CORS-enabled service keys on `Origin`.** Every response the policy touches carries
   `Vary: Origin`. A cache that ignores it serves one origin's allow-origin to another origin. It can also serve a
   response that a caller with no `Origin` (the mobile app) filled to a browser, and the browser then blocks it.

### Rejected alternatives

- **A copy of the policy, or of its guard, in each service.** This is what existed, and both copies drifted.
- **The guard inside `clerk-verify`.** Then a shared runtime library reads the source of the packages that use it.
- **A list of adopting services in the guard.** A list cannot detect that it is incomplete. The next adopter is
  covered only when someone adds it to the list.
- **`origin: true` on non-prod.** It cannot tell "non-prod, permissive on purpose" from "prod, misconfigured".

## Consequences

**Positive**

- A policy change is one change in one package. Every deploy filter that decides a service deploy watches
  `clerk-verify` (`deployLegsWatchTheirLibraries.test.ts`).
- A new browser-facing service inherits the precondition check by calling the policy.
- A WebSocket upgrade is now caught. Neither earlier copy caught it.

**Negative, accepted**

- The guard follows runtime `dependencies` only. A workspace package an adopter reaches any other way, such as a
  devDependency an esbuild bundle pulls in, is not scanned. A service image installs runtime dependencies, so this
  matches what a service ships today.
- The detectors match shapes. Code written to hide a cookie read, such as a computed property name, is not caught.
- Identity still sends `Access-Control-Allow-Credentials: true`, because
  `packages/apps/commise/web/src/lib/identityServiceClient.ts` sends `credentials: 'include'`. It comes off in the
  change that drops `include` there.
- In prod the CloudFront edge answers a request with no valid token with its own `401`, which carries no CORS
  headers, so a browser reads it as a network failure rather than "sign in again". Answering CORS there means the
  edge adapter calls the policy, which makes `packages/infra/global` an adopter. That package ships a CDK app and
  several Lambdas, so the guard's model of one package shipping one service from `src/` does not fit it. The edge
  adapter needs its own package, or the guard needs to model a package that ships more than one artifact.
- The loopback and preview-pattern branches must be re-derived in the same change as any route that reads an ambient
  credential or accepts an upgrade. The guard makes that change fail. It cannot make the decision.

**Guards**

- `packages/infra/global/__tests__/bearerOnlyPrecondition.test.ts`: which packages adopt the policy, the packages that
  turn CORS on, the precondition for each adopter, and the scan reaching the authentication code.
- `packages/shared/clerk-verify/src/__tests__/corsPolicy.test.ts`: each mode's admitted and refused origins.
- Each adapter's own tests: its `deployed` decision, and, where one exists, a wiring test that its `main.ts` installs
  the policy.
