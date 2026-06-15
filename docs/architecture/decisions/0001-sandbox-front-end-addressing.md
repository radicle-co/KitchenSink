# 0001 — Sandbox front-end addressing: path-based PR routing, not per-PR subdomains

- **Status:** Accepted — _path routing implemented_ (per-PR `basePath` builds + a singleton CloudFront + CloudFront Function (runtime 2.0) + KeyValueStore router that host-swaps `/pr-{N}/*` to each PR's app, with the project-wide Vercel bypass token injected at the edge). The **manifest/static-resource mechanism** and **native mobile** remain deferred.
- **Date:** 2026-06-14
- **Area:** sandbox deploy topology · web/mobile serving · Clerk session-token auth
- **Related:** service-side Clerk session-token verification (PR #39), `.github/workflows/sandbox-deploy.yml`, `.github/workflows/sandbox-identity-deploy.yml`, `packages/services/identity/src/auth/clerk-auth.service.ts`, `packages/services/identity/src/config/env.schema.ts`

## ⚠️ Before you change this — the trap

If you are about to "simplify" sandbox previews to **per-PR subdomains** (`pr-123.commise.app`), relax/remove `CLERK_AUTHORIZED_PARTIES` enforcement on sandbox, or change where the sandbox web app is served from — **stop and read this first.** It looks like ordinary subdomain-per-preview routing should apply here. It deliberately does not, and reverting to it will silently 401 every sandbox sign-in.

## Context

- The **sandbox identity service is a single shared, persistent environment** (`STAGE=sandbox`, `registration.identity.sandbox.commise.app`). Every per-PR front-end points at that one service. (See `sandbox-identity-deploy.yml` — "one shared sandbox env".)
- All sandbox front-ends authenticate against **one shared Clerk _dev_ instance** (`pk_test`).
- The identity service verifies the **Clerk session token** itself and enforces the token's **`azp` (authorized party)** claim against `CLERK_AUTHORIZED_PARTIES`. Critically, Clerk's check is **exact-string `Array.includes(azp)`** — **no wildcards, no glob, no subdomain matching** (verified in `@clerk/backend`). A token's `azp` is the **browser Origin where the web app (ClerkJS) is served**, and is independent of how that app addresses the API.
- Therefore: if sandbox web previews are served from **per-PR subdomains** (`pr-{N}.commise.app`), each mints tokens with a different, unbounded `azp`. The single shared `CLERK_AUTHORIZED_PARTIES` value on the shared identity service cannot enumerate unbounded future `pr-{N}` origins → every preview 401s. The `*.commise.app` wildcard **cert** does not help; `azp` is not certificate-based.
- Re-routing the **identity service** (domain vs. path) changes nothing here — `azp` keys on the **web app's** origin, not the API's address.

## Decision

1. **Serve all sandbox web previews from one stable origin** — `sandbox.commise.app` — and select the PR via the **URL path** (and/or cookie), e.g. `sandbox.commise.app/pr-123/…`, **not** via a per-PR subdomain. This pins the sandbox `azp` to a single value (`https://sandbox.commise.app`) that `CLERK_AUTHORIZED_PARTIES` can list, so `azp` enforcement stays **on** in sandbox (matching prod's posture) rather than being disabled.
2. **Manifest query params select static resources (proposed sub-mechanism).** Because previews share one origin, the app resolves which PR's static bundle/assets to load from a **manifest query param** (e.g. `?manifest=pr-123`) rather than from the host. This is the agreed direction; the exact param shape is to be finalized during implementation.
3. **Mobile is exempt by nature.** `@clerk/expo` tokens have no browser Origin; `azp` is typically absent, and Clerk **skips** the check when `azp` is absent. Confirm per build by decoding a real token, but mobile does not drive this decision.

## Consequences

**Positive**

- `azp` enforcement remains enabled in sandbox (defense-in-depth parity with prod) without an unbounded allowlist.
- One sandbox web origin ⇒ one TLS cert path, one Clerk allowed-origin, simpler CORS.

**Negative / costs**

- No per-PR-isolated front-end URL. Previews share an origin, so they share ClerkJS browser/session state per origin — running several PRs' UIs truly in parallel in one browser profile is harder.
- The app must carry PR/manifest context in the path or a param and route on it — more app-side routing logic than host-based selection.

## Alternatives considered

- **Per-PR subdomains + prod-only `azp` enforcement** (disable `azp` on sandbox; require it only on prod-like stages). Lower app-side complexity and keeps isolated preview URLs. **Rejected** here in favor of keeping `azp` enforced in sandbox — but this remains the natural fallback if path-routing proves too costly. If you switch to it, the change is: relax `CLERK_AUTHORIZED_PARTIES` to be required only on prod-like stages in `env.schema.ts`, keep `CLERK_JWT_KEY` required everywhere (signatures still verified via the shared sandbox key), and update this ADR's status to _Superseded_.
- **Wildcard / pattern `azp`.** Not possible — Clerk matches `azp` by exact string.

## Implementation guards

Path-routing guards are in place (`// ⚠️ DELIBERATE — see docs/architecture/decisions/0001`):

- `packages/apps/commise/web/next.config.ts` + `src/lib/base-path.ts` — the per-PR `basePath` derivation (do not drop it / move to subdomains).
- `packages/apps/commise/web/src/middleware.ts` — the prefix-aware Clerk matcher (do not "simplify" back to root-anchored patterns — it silently makes protected routes public).
- `packages/apps/commise/web/router/src/*` + `infra/lib/sandbox-router-stack.ts` — the host-swap router (do not switch to a prefix-stripping proxy or per-PR subdomains).

The **azp** tripwires the ADR originally listed — `clerk-auth.service.ts` (azp handling) and `env.schema.ts` (`CLERK_AUTHORIZED_PARTIES`) — are owned by the create-user-flow work (PR #39) and the `CLAUDE.md` "Deliberate decisions" entry; not duplicated here.

The **manifest/static-resource loader** guard lands with that deferred mechanism.
