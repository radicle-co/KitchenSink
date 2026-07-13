# 0001 — Sandbox front-end addressing: path-based PR routing, not per-PR subdomains

- **Status:** Accepted — _path routing implemented_ (per-PR `basePath` builds + a singleton CloudFront + CloudFront Function (runtime 2.0) + KeyValueStore router that host-swaps `/pr-{N}/*` to each PR's app, with the project-wide Vercel bypass token injected at the edge). The **manifest/static-resource mechanism** and **native mobile** remain deferred. **Revisited 2026-07-12** — a feasibility spike found per-PR **subdomains are viable** after all (see the Update below); migration to subdomains is planned. Path routing stays in place until it lands.
- **Date:** 2026-06-14
- **Area:** sandbox deploy topology · web/mobile serving · Clerk session-token auth
- **Related:** service-side Clerk session-token verification (PR #39), `.github/workflows/sandbox-deploy.yml`, `.github/workflows/sandbox-identity-deploy.yml`, `packages/services/identity/src/auth/clerk-auth.service.ts`, `packages/services/identity/src/config/env.schema.ts`, the Option B′ spike (`docs/brainstorms/2026-07-10-sandbox-subdomain-azp-spike-requirements.md`, `docs/plans/2026-07-11-001-feat-sandbox-subdomain-azp-spike-plan.md`)

## Update (2026-07-12) — spike revisited the premise: per-PR **subdomains are viable** (recommendation: GO)

The trap below rests on one claim: _"Clerk matches `azp` by exact string, so per-PR subdomains each mint an unbounded `azp` the shared allowlist can't enumerate → 401."_ A feasibility spike (Option B′) found that claim is true **at the SDK layer but not binding at ours**, and that the sandbox dev instance does not block subdomains:

- **The exact-match is OUR code, not a Clerk constraint.** `azp` enforcement runs in `@kitchensink/clerk-verify` only because _we_ pass `authorizedParties` to `verifyToken`. Validating the signature-verified `azp` ourselves against an **anchored regex** (`^https://pr-\d+\.sandbox\.commise\.app$`) accepts a bounded family of per-PR origins with enforcement still ON — no unbounded allowlist, no wildcard handed to Clerk. Built + unit-tested (`buildPreviewAzpPattern` / `resolveAzpEnforcement` in `@kitchensink/clerk-verify`), wired stage-gated into identity/food/recipe (prod stays exact-match).
- **The dev instance accepts subdomain origins with no toggle.** Probed live against the sandbox Frontend API (`nice-fowl-6.clerk.accounts.dev`): it reflects **any** `Origin` back in `Access-Control-Allow-Origin` — `sandbox.commise.app`, `pr-9001.sandbox.commise.app`, **and** an unrelated origin — with `allow-credentials: true`. So a sign-in served from a per-PR subdomain is accepted and mints a token with `azp = that subdomain`. Clerk's "allowed subdomains" toggle is **production-instance-only**, but the **dev instance doesn't need it** — it isn't origin-restricted. This is precisely why the regex-`azp` guard is _essential_ on the dev sandbox: the instance trusts any origin, so our backend check is the real trust boundary.

**Recommendation: GO** — migrate sandbox previews to per-PR subdomains, gated by the regex-`azp` predicate. Prod is unaffected (single origin, exact-match). **One empirical confirmation remains:** a real browser sign-in on a live `pr-N.sandbox.commise.app` to decode the minted token and see `azp` literally equal the subdomain (near-certain given the CORS result + Clerk's documented `azp = Origin`). The old "Wildcard / pattern `azp` — not possible" line under _Alternatives_ is corrected below.

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
- **Wildcard / pattern `azp`.** ~~Not possible — Clerk matches `azp` by exact string.~~ **Corrected (2026-07-12, see Update above):** the SDK matches by exact string, but `azp` enforcement is _our_ code — validating the signature-verified `azp` against an anchored regex ourselves makes bounded per-PR patterns viable with enforcement on. Combined with the dev instance reflecting any origin, this is what makes the subdomain migration the recommended path.

## Implementation guards

> **Migration in progress (2026-07-12, commit `330323a`).** The transition-safe subdomain slices have
> landed and are **OFF by default** — path routing remains the live posture until the human-gated cutover
> (see `docs/plans/2026-07-12-001-feat-sandbox-subdomain-migration-plan.md`). The router now ALSO serves
> `*.sandbox.commise.app` and resolves by Host-label first; the backend accepts the apex origin only when
> `CLERK_AZP_PREVIEW_MODE=transition`. Until cutover, the path-routing guards below still hold; `basePath`
> is retired last (plan U6/U7).
>
> **CUTOVER EXECUTED (2026-07-13).** The sandbox now serves previews on **subdomains**:
> `pr-{N}.sandbox.commise.app` at root, sandbox identity in **transition** mode (SSM
> `azp-preview-mode=transition`), Vercel/GitHub `SANDBOX_PREVIEW_MODE=subdomain`. The path form 404s by
> design. The guards below now describe the _rollback_ posture, not the live one. Remaining: the live
> `azp`-on-subdomain sign-in confirmation, then drain + tighten (`azp-preview-mode=strict`, retire path
> routing). See the plan's "Cutover — EXECUTED" section.

Path-routing guards are in place (`// ⚠️ DELIBERATE — see docs/architecture/decisions/0001`):

- `packages/apps/commise/web/next.config.ts` + `src/lib/base-path.ts` — the per-PR `basePath` derivation (do not drop it / move to subdomains).
- `packages/apps/commise/web/src/middleware.ts` — the prefix-aware Clerk matcher (do not "simplify" back to root-anchored patterns — it silently makes protected routes public).
- `packages/apps/commise/web/router/src/*` + `infra/lib/sandbox-router-stack.ts` — the host-swap router (do not switch to a prefix-stripping proxy or per-PR subdomains).

The **azp** tripwires the ADR originally listed — `clerk-auth.service.ts` (azp handling) and `env.schema.ts` (`CLERK_AUTHORIZED_PARTIES`) — are owned by the create-user-flow work (PR #39) and the `CLAUDE.md` "Deliberate decisions" entry; not duplicated here.

The **manifest/static-resource loader** guard lands with that deferred mechanism.
