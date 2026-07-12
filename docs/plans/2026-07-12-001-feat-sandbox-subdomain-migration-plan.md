---
type: feat
origin: docs/brainstorms/2026-07-12-sandbox-subdomain-migration-requirements.md
date: 2026-07-12
---

# Sandbox previews → per-PR subdomains — migration plan (ADR-0001 GO)

> Authored autonomously (owner asleep). The code/infra units below are **implemented + verified** in
> commit `330323a`; the **cutover** section is a human-gated runbook, deliberately NOT executed here.

## Problem Frame

Migrate the shared sandbox from path routing (`sandbox.commise.app/pr-{N}`) to per-PR subdomains
(`pr-{N}.sandbox.commise.app`), keeping `azp` enforcement ON via the self-owned regex predicate. The
sandbox is shared (one identity env, one router, one Clerk dev instance serve every open PR), so this is a
**coordinated cutover of shared infra**, not a per-PR change: a careless flip 401s or 502s every live
preview at once. The whole plan is shaped around an ordered, reversible cutover with a transition window
in which BOTH addressing modes work. See origin brainstorm for decisions and scope.

## Key Technical Decisions

- **Transition window accepts both origins.** Backend `azp` and the edge router both accept the base apex
  (`sandbox.commise.app`, path-routed) AND `pr-{N}.sandbox.commise.app` (subdomain) simultaneously, so
  each cutover step is independently deployable and revertible with zero preview downtime.
- **One distribution, one wildcard record.** The existing singleton CloudFront router gains a
  `*.sandbox.commise.app` alias + wildcard A-record — no second distribution (ADR-0001 invariant), no
  per-PR DNS write. The deployed cert already carries the `*.sandbox` SAN (verified), so no cert change.
- **Cutover is an env/DNS flip, not a code change.** `CLERK_AZP_PREVIEW_MODE=transition` selects the
  apex-accepting pattern at deploy time; the router already serves both. Nothing in the cutover requires a
  new PR once these slices land.
- **basePath stays until last.** The web app keeps its `basePath` machinery through the window; it is
  retired only after every active preview serves on a subdomain (deferred unit U7).

## Implementation Units

### U1 — Transition azp predicate (shared) — ✅ DONE (330323a)

- **Goal:** a pattern that accepts the base apex + `pr-{N}` subdomains for the cutover window, plus a raw
  `previewMode` selector on the resolver that fails safe to strict.
- **Files:** `packages/shared/clerk-verify/src/clerkVerify.ts`, `.../src/index.ts`,
  `.../src/__tests__/clerkVerify.test.ts`.
- **Verification:** `buildTransitionAzpPattern` accepts apex + `pr-{N}`, rejects the same near-misses as
  strict; `resolveAzpEnforcement({previewMode})` widens only on exact `'transition'`. clerk-verify 41/41.

### U2 — Service wiring of CLERK_AZP_PREVIEW_MODE — ✅ DONE (330323a)

- **Goal:** identity/recipe/food pass the env selector into the shared resolver so cutover is an env flip.
- **Files:** `packages/services/{identity,recipe-service}/src/auth/clerk-auth.service.ts`,
  `packages/services/food-service/src/auth/food-auth.guard.ts`, plus their auth tests (identity
  `tests/clerk-auth.service.test.ts`, new `recipe-service/src/auth/__tests__/clerk-auth.service.test.ts`,
  `food-service/src/auth/__tests__/food-auth.guard.test.ts`).
- **Verification:** transition mode accepts the apex origin end-to-end; strict rejects it. Prod stages
  reject `CLERK_AZP_PATTERN` entirely (existing config guard) — no prod change. 14/6/9 auth tests pass.

### U3 — Host-based edge routing (router core + CFF) — ✅ DONE (330323a)

- **Goal:** resolve the PR from the Host `pr-{N}` label first, path second; both hit the same KVS.
- **Files:** `packages/apps/commise/web/router/src/resolve.ts`, `.../src/router.cff.js`,
  `.../router/tests/resolve.test.ts`.
- **Verification:** `parsePrKeyFromHost` anchored/case-insensitive/port-stripping; `resolveRoute` prefers
  host, falls back to path, 404s when neither carries a PR. router 17/17 (incl. cffShape contract).

### U4 — Router serves the wildcard subdomain (infra) — ✅ DONE (330323a)

- **Goal:** the singleton distribution also answers `*.sandbox.commise.app`, with a wildcard A-record.
- **Files:** `packages/apps/commise/web/infra/lib/SandboxRouterStack.ts`,
  `.../infra/__tests__/SandboxRouterStack.test.ts`.
- **Verification:** distribution `Aliases` includes `*.sandbox.commise.app`; wildcard A-record present;
  still exactly one distribution. Cert unchanged (deployed SAN already covers it). router-infra 12/12.

### U5 — CI seeds host-routable KVS keys — ⏳ REMAINING (no code change expected)

- **Goal:** confirm the preview-deploy CI writes KVS key `pr-{N}` → host (it already does for path
  routing); host routing reuses the SAME key, so **no CI change is anticipated**. Verify by inspection of
  `.github/workflows/sandbox-web-preview.yml` / `sandbox-router-deploy.yml` at cutover.
- **Verification:** a `pr-{N}` KVS key exists for an open preview; `resolveRoute` by host resolves it.

### U6 — Preview build serves at subdomain root (drop basePath conditionally) — ⏳ REMAINING

- **Goal:** when a preview is built for subdomain serving, omit `basePath` (subdomain previews live at
  root); retain path-mode builds behind a build-time signal.
- **Files (planned):** `packages/apps/commise/web/next.config.ts`, `src/lib/base-path.ts`,
  `src/middleware.ts` (prefix matcher becomes root-anchored only in subdomain mode).
- **Execution note:** test-first; add a base-path resolver unit test for the subdomain branch. Gate on the
  same signal the deploy passes. Do NOT remove path-mode until U7.

### U7 — Retire path routing + basePath (post-cutover) — ⏳ DEFERRED

- **Goal:** once all active previews serve on subdomains, drop the path branch from `resolveRoute`, remove
  `basePath` machinery, and tighten `azp` back to strict (`CLERK_AZP_PREVIEW_MODE` unset). Update ADR-0001
  status to reflect subdomains as the shipped design.

## Cutover runbook (human-gated, ordered, reversible)

Each step is independently deployable and revertible; do them in order, validating between.

1. **Confirm azp on a live subdomain.** Sign in on a real `pr-N.sandbox.commise.app` and decode the minted
   token; confirm `azp` == the subdomain literally. (Near-certain from the live CORS result; this is the
   one empirical nail left. Everything below assumes it passes — if it fails, STOP; the migration is off.)
2. **Deploy the router (U3/U4).** Additive: the distribution now answers `*.sandbox` and the CFF resolves
   by host first. Path routing still works. Rollback = redeploy prior router stack.
3. **Flip services to transition (U2).** Set `CLERK_AZP_PREVIEW_MODE=transition` on the sandbox identity
   (and recipe/food if deployed) with `CLERK_AZP_PATTERN=sandbox.commise.app`. Now the backend accepts
   BOTH apex and subdomain tokens. Path-routed previews keep working. Rollback = unset the env + redeploy.
4. **Serve new previews at their subdomain (U6).** Build previews without basePath; validate a real
   preview end-to-end (sign in, authenticated navigation) on `pr-N.sandbox.commise.app`.
5. **Drain, then tighten (U7).** Once every active preview serves on a subdomain: unset
   `CLERK_AZP_PREVIEW_MODE` (back to strict, apex rejected), remove the path branch + basePath, update
   ADR-0001. Rollback before this step is trivial; after it, path routing is gone (intended).

## Scope Boundaries

- **Prod:** untouched — single origin, exact-match `azp`. No prod template diff.
- **Mobile:** unaffected — `@clerk/expo` tokens have no browser `azp`.
- **Manifest/static-resource mechanism (ADR-0001):** moot once each PR is its own origin; not built.

## Risks & Dependencies

- **Shared-instance blast radius:** every step touches the one shared sandbox. Mitigated by the
  both-origins transition window — no step has a flip-the-world moment.
- **azp confirmation (step 1):** the only remaining empirical unknown; gates the whole cutover.
- **Cert:** none — the deployed `*.sandbox.commise.app` SAN is verified ISSUED; the alias adds no cert op.
- **basePath interaction:** deferred to U6/U7 precisely so the fragile part changes last, on subdomains
  where it is simplest (root serving, no prefix).
